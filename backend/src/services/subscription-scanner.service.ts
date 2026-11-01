/**
 * SubscriptionScanner
 *
 * Pipeline (per Gmail message):
 *   Gmail search (billing keywords, no promotions)  →  skip if already in ledger
 *   →  fetch full message  →  gpt-4o-mini extraction  →  upsert subscription
 *   →  store event  →  recompute subscription state from its full event history
 *
 * Recomputing from history (instead of patching incrementally) makes the result
 * independent of the order Gmail returns messages in, and lets re-scans heal.
 */
import { gmailService, type ParsedEmail } from './gmail.service';
import { subscriptionExtractor, type SubscriptionExtraction } from './subscription-extractor.service';
import {
  createSubscription,
  getSubscription,
  getSubscriptionByKey,
  getSubscriptionScanState,
  insertSubscriptionEvent,
  listSubscriptionEvents,
  listSubscriptions,
  markEmailScanned,
  updateSubscription,
  updateSubscriptionScanState,
  wasEmailScanned,
  type BillingCycle,
  type Subscription,
  type SubscriptionStatus,
} from '../db/subscriptions';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

/** How far back the very first scan looks (months). */
const INITIAL_LOOKBACK_MONTHS = parseInt(process.env.SUBSCRIPTION_LOOKBACK_MONTHS ?? '14', 10) || 14;
const MAX_MESSAGES_PER_RUN = parseInt(process.env.SUBSCRIPTION_MAX_MESSAGES ?? '1500', 10) || 1500;
const MIN_CONFIDENCE = 0.55;
const CONCURRENCY = 5;

const SEARCH_TERMS = [
  'subject:(receipt OR invoice OR subscription OR renewal OR renewed OR renews OR "your plan" OR membership OR trial OR billing OR payment OR charged OR "auto-renew" OR "price change" OR cancelled OR canceled OR declined)',
  '"manage subscription"',
  '"manage your subscription"',
  '"next billing date"',
  '"renews on"',
  '"cancel anytime"',
].join(' OR ');

/** Senders that only ever relay purchases for other products. */
const AGGREGATOR_DOMAINS = new Set([
  'apple.com', 'google.com', 'stripe.com', 'paypal.com', 'paypal.co.il', 'paddle.com',
  'gumroad.com', 'lemonsqueezy.com', 'fastspring.com', 'chargebee.com', 'recurly.com',
]);

const CYCLE_DAYS: Record<BillingCycle, number | null> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  unknown: null,
};

export function serviceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/\b(inc|ltd|llc|pbc|corp|corporation|co|gmbh|pty|limited|subscription|membership|plan)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function addCycle(isoDate: string, cycle: BillingCycle): string | null {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  switch (cycle) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    default:
      return null;
  }
  return d.toISOString().slice(0, 10);
}

function fmtGmailDate(d: Date): string {
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

function senderDomain(addr: string | null): string | null {
  const m = addr?.toLowerCase().match(/@([^>\s]+)/);
  if (!m) return null;
  const parts = m[1].split('.');
  return parts.slice(-2).join('.') === 'co.il' ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

// ─── Recompute ────────────────────────────────────────────────────────────────

const STATUS_FROM_EVENT: Partial<Record<string, SubscriptionStatus>> = {
  charge: 'active',
  signup: 'active',
  renewal_notice: 'active',
  price_change: 'active',
  trial_started: 'trial',
  trial_ending: 'trial',
  payment_failed: 'payment_issue',
  cancelled: 'cancelled',
};

/**
 * Derives amount / cycle / status / dates for one subscription from all of its
 * events. Fields the user edited by hand are left alone.
 */
export function recomputeSubscription(id: number): Subscription | undefined {
  const sub = getSubscription(id);
  if (!sub) return undefined;
  const events = listSubscriptionEvents(id).slice().reverse(); // oldest → newest
  if (events.length === 0) return sub;

  const charges = events.filter((e) => e.event_type === 'charge');
  const lastCharge = charges[charges.length - 1];
  const patch: Partial<Subscription> = {};

  patch.first_seen_at = events[0].occurred_at;
  if (lastCharge) patch.last_charged_at = lastCharge.occurred_at;

  if (!sub.user_edited) {
    // Price: latest charge, overridden by a newer explicit price change.
    const priced = events.filter(
      (e) => ['charge', 'signup', 'price_change', 'renewal_notice'].includes(e.event_type) && e.amount != null
    );
    const latestPriced = priced[priced.length - 1];
    if (latestPriced) {
      patch.amount = latestPriced.amount;
      patch.currency = latestPriced.currency ?? sub.currency;
      // Flag a price change only when the immediately preceding price differs.
      const prev = priced
        .slice(0, -1)
        .reverse()
        .find((e) => (e.currency ?? patch.currency) === patch.currency);
      patch.previous_amount = prev && prev.amount !== latestPriced.amount ? prev.amount : null;
    }

    const cycled = events.filter((e) => e.billing_cycle && e.billing_cycle !== 'unknown');
    if (cycled.length) {
      patch.billing_cycle = cycled[cycled.length - 1].billing_cycle!;
    } else if (charges.length >= 2) {
      // Infer from the gap between the last two charges.
      const a = new Date(charges[charges.length - 2].occurred_at).getTime();
      const b = new Date(lastCharge.occurred_at).getTime();
      const days = (b - a) / 86_400_000;
      patch.billing_cycle = days < 10 ? 'weekly' : days < 45 ? 'monthly' : days < 120 ? 'quarterly' : 'yearly';
    }

    const latestPlan = [...events].reverse().find((e) => e.plan_name)?.plan_name;
    if (latestPlan) patch.plan_name = latestPlan;
  }

  const latestCancelUrl = [...events].reverse().find((e) => e.cancel_url)?.cancel_url;
  if (latestCancelUrl) patch.cancel_url = latestCancelUrl;

  // Status: latest status-bearing event (unless the user set it more recently).
  const statusEvents = events.filter((e) => STATUS_FROM_EVENT[e.event_type]);
  const latestStatus = statusEvents[statusEvents.length - 1];
  if (latestStatus && (!sub.status_manual_at || latestStatus.occurred_at > sub.status_manual_at)) {
    patch.status = STATUS_FROM_EVENT[latestStatus.event_type]!;
  }

  const trialEnd = [...events].reverse().find((e) => e.trial_ends_at)?.trial_ends_at ?? null;
  patch.trial_ends_at = trialEnd;

  // Next renewal: explicit hint on/after the last charge wins, else last charge + cycle.
  const cycle = (patch.billing_cycle ?? sub.billing_cycle) as BillingCycle;
  const lastChargeDate = lastCharge?.occurred_at ?? '';
  const hint = [...events]
    .reverse()
    .find((e) => e.next_renewal_at && e.next_renewal_at > lastChargeDate)?.next_renewal_at;
  const status = patch.status ?? sub.status;
  if (status === 'cancelled') {
    patch.next_renewal_at = null;
  } else if (hint) {
    patch.next_renewal_at = hint;
  } else if (lastCharge) {
    patch.next_renewal_at = addCycle(lastCharge.occurred_at, cycle);
  } else if (status === 'trial' && trialEnd) {
    patch.next_renewal_at = trialEnd;
  }

  return updateSubscription(id, patch);
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

class SubscriptionScannerService {
  private running = false;
  private progress = { scanned: 0, total: 0, matches: 0 };

  isRunning(): boolean {
    return this.running;
  }

  getProgress(): { scanned: number; total: number; matches: number } {
    return { ...this.progress };
  }

  isConfigured(): boolean {
    return subscriptionExtractor.isConfigured();
  }

  async run(): Promise<void> {
    if (this.running) throw new Error('Subscription scan already running');
    if (!subscriptionExtractor.isConfigured()) throw new Error('OPENAI_API_KEY is not set');
    if (!gmailService.isAuthenticated()) throw new Error('Gmail not authenticated');

    this.running = true;
    this.progress = { scanned: 0, total: 0, matches: 0 };
    const startedAt = new Date();
    updateSubscriptionScanState({
      last_run_started_at: startedAt.toISOString(),
      last_run_status: 'running',
      last_error: null,
    });

    try {
      gmailService.loadTokens();
      const state = getSubscriptionScanState();

      // Re-read 3 days of overlap so late-arriving mail is never missed.
      let after: Date;
      if (state.initial_scan_completed && state.last_scanned_after) {
        after = new Date(new Date(state.last_scanned_after).getTime() - 3 * 86_400_000);
      } else {
        after = new Date();
        after.setUTCMonth(after.getUTCMonth() - INITIAL_LOOKBACK_MONTHS);
      }

      const query = `after:${fmtGmailDate(after)} -category:promotions -category:social -in:sent -in:chats (${SEARCH_TERMS})`;
      logger.info('[subscriptions] scan started', { query });

      // 1. Collect candidate IDs.
      const ids: string[] = [];
      let pageToken: string | null = null;
      do {
        const page = await gmailService.listMessageIds(query, pageToken, 200);
        for (const id of page.messageIds) if (!wasEmailScanned(id)) ids.push(id);
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN);

      const todo = ids.slice(0, MAX_MESSAGES_PER_RUN);
      this.progress.total = todo.length;
      const touched = new Set<number>();

      // 2. Fetch + extract with small concurrency.
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const batch = todo.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map((id) => this.processMessage(id)));
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            if (r.value != null) {
              touched.add(r.value);
              this.progress.matches++;
            }
          } else {
            logger.warn('[subscriptions] message failed', { id: batch[idx], error: String(r.reason) });
          }
        });
        this.progress.scanned = Math.min(i + CONCURRENCY, todo.length);
        if (i + CONCURRENCY < todo.length) await sleep(250);
      }

      for (const id of touched) recomputeSubscription(id);

      const finishedAt = new Date();
      updateSubscriptionScanState({
        last_scanned_after: startedAt.toISOString(),
        initial_scan_completed: ids.length > MAX_MESSAGES_PER_RUN ? state.initial_scan_completed : 1,
        last_run_finished_at: finishedAt.toISOString(),
        last_run_status: 'completed',
        last_run_emails_scanned: this.progress.scanned,
        last_run_matches: this.progress.matches,
      });
      logger.info('[subscriptions] scan completed', this.progress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSubscriptionScanState({
        last_run_finished_at: new Date().toISOString(),
        last_run_status: 'failed',
        last_error: message,
        last_run_emails_scanned: this.progress.scanned,
        last_run_matches: this.progress.matches,
      });
      logger.error('[subscriptions] scan failed', { error: message });
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** Returns the subscription id the message was attached to, or null. */
  private async processMessage(messageId: string): Promise<number | null> {
    const email = await gmailService.fetchMessage(messageId);
    const ex = await subscriptionExtractor.extract(email);

    if (!ex.is_subscription || !ex.service_name || ex.confidence < MIN_CONFIDENCE || ex.event_type === 'other') {
      markEmailScanned(messageId, false);
      return null;
    }

    const sub = this.findOrCreate(ex, email);
    if (!sub) {
      markEmailScanned(messageId, false);
      return null;
    }

    insertSubscriptionEvent({
      subscription_id: sub.id,
      gmail_message_id: messageId,
      event_type: ex.event_type,
      amount: ex.amount,
      currency: ex.currency,
      billing_cycle: ex.billing_cycle,
      plan_name: ex.plan_name,
      next_renewal_at: ex.next_renewal_at,
      trial_ends_at: ex.trial_ends_at,
      cancel_url: ex.cancel_url,
      occurred_at: ex.occurred_at ?? (email.receivedAt ?? new Date().toISOString()).slice(0, 10),
      subject: email.subject,
      from_address: email.fromAddress,
    });
    markEmailScanned(messageId, true);
    return sub.id;
  }

  private findOrCreate(ex: SubscriptionExtraction, email: ParsedEmail): Subscription | null {
    const key = serviceKey(ex.service_name!);
    if (!key) return null;

    const exact = getSubscriptionByKey(key);
    if (exact) return exact;

    // Fuzzy: "claude" vs "claudepro" from the same vendor.
    const domain = ex.vendor_domain ?? (() => {
      const d = senderDomain(email.fromAddress);
      return d && !AGGREGATOR_DOMAINS.has(d) ? d : null;
    })();
    const fuzzy = listSubscriptions().find(
      (s) =>
        key.length >= 4 &&
        s.service_key.length >= 4 &&
        (s.service_key.startsWith(key) || key.startsWith(s.service_key)) &&
        (!domain || !s.vendor_domain || s.vendor_domain === domain)
    );
    if (fuzzy) return fuzzy;

    // A one-off add-on alone never creates a subscription.
    if (ex.event_type === 'one_off') return null;

    return createSubscription({
      service_key: key,
      name: ex.service_name!,
      plan_name: ex.plan_name,
      vendor_domain: domain,
      category: ex.category,
      amount: ex.amount,
      currency: ex.currency ?? 'USD',
      billing_cycle: ex.billing_cycle === 'unknown' ? 'monthly' : ex.billing_cycle,
      status: 'active',
      source: 'email',
    });
  }
}

export const subscriptionScanner = new SubscriptionScannerService();
