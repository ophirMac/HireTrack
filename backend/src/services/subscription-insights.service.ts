/**
 * Subscription insights: normalized monthly cost, totals, upcoming renewals
 * and rule-based "what to cancel and when" recommendations.
 *
 * All money is normalized to USD here; the frontend converts to the display
 * currency using the same FX table (returned with the payload).
 */
import type { BillingCycle, SubscriptionWithStats } from '../db/subscriptions';
import { addCycle } from './subscription-scanner.service';

// Units of currency per 1 USD. Approximate — good enough for budgeting.
const DEFAULT_FX: Record<string, number> = {
  USD: 1,
  ILS: 3.7,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.53,
  CAD: 1.39,
  NZD: 1.68,
  CHF: 0.88,
  JPY: 150,
  INR: 84,
  SEK: 10.6,
  NOK: 10.9,
  DKK: 6.9,
  PLN: 4.0,
  BRL: 5.5,
  SGD: 1.34,
};

export function fxRates(): Record<string, number> {
  try {
    const override = process.env.SUBSCRIPTION_FX_RATES
      ? (JSON.parse(process.env.SUBSCRIPTION_FX_RATES) as Record<string, number>)
      : {};
    return { ...DEFAULT_FX, ...override };
  } catch {
    return DEFAULT_FX;
  }
}

const MONTHLY_FACTOR: Record<BillingCycle, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
  unknown: 1,
};

export function toUsd(amount: number, currency: string, fx = fxRates()): number {
  const rate = fx[currency?.toUpperCase()] ?? 1;
  return amount / rate;
}

export interface EnrichedSubscription extends SubscriptionWithStats {
  monthly_usd: number;
  yearly_usd: number;
  /** Day before the next renewal — the latest safe day to cancel. */
  cancel_by: string | null;
  days_until_renewal: number | null;
  /** Active but no charge seen for well over one cycle. */
  looks_inactive: boolean;
}

export type RecommendationKind =
  | 'planned_cancel'
  | 'trial_ending'
  | 'payment_issue'
  | 'yearly_renewal'
  | 'overlap'
  | 'price_increase'
  | 'looks_inactive'
  | 'big_ticket'
  | 'switch_to_annual';

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  priority: 'high' | 'medium' | 'low';
  subscription_ids: number[];
  title: string;
  detail: string;
  action: 'cancel' | 'review' | 'fix_payment' | 'confirm' | 'switch_plan';
  act_by: string | null;
  yearly_savings_usd: number | null;
}

export interface SubscriptionsSummary {
  active_count: number;
  monthly_usd: number;
  yearly_usd: number;
  planned_cancel_yearly_usd: number;
  potential_savings_yearly_usd: number;
  renewing_next_30d_usd: number;
  by_category: Array<{ category: string; monthly_usd: number; count: number }>;
}

const DAY = 86_400_000;

function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(fromIso: string, to: Date): number {
  return Math.round((new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime() - to.getTime()) / DAY);
}

function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Rolls a past renewal date forward by whole cycles until it's today or later. */
function rollForward(iso: string, cycle: BillingCycle, today: Date): string {
  let cur = iso.slice(0, 10);
  for (let i = 0; i < 60 && daysBetween(cur, today) < 0; i++) {
    const next = addCycle(cur, cycle === 'unknown' ? 'monthly' : cycle);
    if (!next) break;
    cur = next;
  }
  return cur;
}

const fmtMoney = (amount: number | null, currency: string): string => {
  if (amount == null) return 'an unknown amount';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const CYCLE_SHORT: Record<BillingCycle, string> = {
  weekly: '/wk',
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
  unknown: '',
};

const fmtDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const isLive = (s: { status: string }): boolean => s.status !== 'cancelled' && s.status !== 'paused';

/** Categories where holding two at once is usually redundant. */
const OVERLAP_CATEGORIES = new Set(['ai', 'cloud_storage', 'streaming_video', 'music', 'security_vpn', 'news_reading']);
const CATEGORY_LABEL: Record<string, string> = {
  ai: 'AI assistants',
  cloud_storage: 'cloud storage',
  streaming_video: 'video streaming',
  music: 'music streaming',
  security_vpn: 'VPN / security',
  news_reading: 'news & reading',
};

export function buildInsights(subs: SubscriptionWithStats[]): {
  subscriptions: EnrichedSubscription[];
  summary: SubscriptionsSummary;
  recommendations: Recommendation[];
  fx: Record<string, number>;
} {
  const fx = fxRates();
  const today = todayUtc();

  const enriched: EnrichedSubscription[] = subs.map((s) => {
    const monthly = s.amount != null ? toUsd(s.amount, s.currency, fx) * MONTHLY_FACTOR[s.billing_cycle] : 0;
    let next = s.next_renewal_at;
    let looksInactive = false;

    if (isLive(s) && next && daysBetween(next, today) < 0) {
      // Renewal date passed without a new receipt. Allow a grace period
      // (receipts can lag / be filtered) before calling it inactive.
      const overdue = -daysBetween(next, today);
      const grace = s.billing_cycle === 'yearly' ? 45 : s.billing_cycle === 'weekly' ? 10 : 20;
      looksInactive = s.source === 'email' && overdue > grace;
      next = rollForward(next, s.billing_cycle, today);
    }

    const live = isLive(s);
    return {
      ...s,
      next_renewal_at: live ? next : s.next_renewal_at,
      monthly_usd: live ? monthly : 0,
      yearly_usd: live ? monthly * 12 : 0,
      cancel_by: live && next ? minusDays(next, 1) : null,
      days_until_renewal: live && next ? daysBetween(next, today) : null,
      looks_inactive: looksInactive,
    };
  });

  const live = enriched.filter(isLive);
  const recs: Recommendation[] = [];
  const add = (r: Recommendation): void => {
    if (!recs.some((x) => x.id === r.id)) recs.push(r);
  };

  for (const s of live) {
    const price = `${fmtMoney(s.amount, s.currency)}${CYCLE_SHORT[s.billing_cycle]}`;

    if (s.decision === 'cancel') {
      add({
        id: `planned_cancel:${s.id}`,
        kind: 'planned_cancel',
        priority: s.days_until_renewal != null && s.days_until_renewal <= 7 ? 'high' : 'medium',
        subscription_ids: [s.id],
        title: s.cancel_by ? `Cancel ${s.name} by ${fmtDate(s.cancel_by)}` : `Cancel ${s.name}`,
        detail: s.cancel_by
          ? `You marked it to cancel. Doing it the day before it renews keeps the time you already paid for and avoids the next ${price} charge.`
          : `You marked it to cancel. No renewal date detected — cancel whenever convenient.`,
        action: 'cancel',
        act_by: s.cancel_by,
        yearly_savings_usd: s.yearly_usd,
      });
      continue; // other advice is moot
    }

    if (s.status === 'payment_issue') {
      add({
        id: `payment:${s.id}`,
        kind: 'payment_issue',
        priority: 'high',
        subscription_ids: [s.id],
        title: `${s.name} has a payment problem`,
        detail: `Your last payment failed. If you still want it, update your card; if not, cancel it so it doesn't retry or pile up a balance.`,
        action: 'fix_payment',
        act_by: null,
        yearly_savings_usd: s.yearly_usd,
      });
    }

    if (s.decision === 'keep') continue; // user already decided

    if (s.status === 'trial' && s.trial_ends_at) {
      const d = daysBetween(s.trial_ends_at, today);
      if (d >= -1 && d <= 14) {
        add({
          id: `trial:${s.id}`,
          kind: 'trial_ending',
          priority: d <= 3 ? 'high' : 'medium',
          subscription_ids: [s.id],
          title: `${s.name} trial ends ${fmtDate(s.trial_ends_at)}`,
          detail: `Decide before it converts to a paid plan (${price}). Cancel by ${fmtDate(minusDays(s.trial_ends_at, 1))} if you won't use it.`,
          action: 'cancel',
          act_by: minusDays(s.trial_ends_at, 1),
          yearly_savings_usd: s.yearly_usd,
        });
      }
    }

    if (s.billing_cycle === 'yearly' && s.days_until_renewal != null && s.days_until_renewal <= 30) {
      add({
        id: `yearly:${s.id}`,
        kind: 'yearly_renewal',
        priority: s.days_until_renewal <= 7 ? 'high' : 'medium',
        subscription_ids: [s.id],
        title: `${s.name} renews for ${fmtMoney(s.amount, s.currency)} on ${fmtDate(s.next_renewal_at!)}`,
        detail: `Annual charges are easy to forget. If you haven't used it much this year, cancel by ${fmtDate(s.cancel_by!)}.`,
        action: 'review',
        act_by: s.cancel_by,
        yearly_savings_usd: s.yearly_usd,
      });
    }

    if (s.previous_amount != null && s.amount != null && s.amount > s.previous_amount * 1.02) {
      const pct = Math.round(((s.amount - s.previous_amount) / s.previous_amount) * 100);
      add({
        id: `price:${s.id}`,
        kind: 'price_increase',
        priority: pct >= 20 ? 'medium' : 'low',
        subscription_ids: [s.id],
        title: `${s.name} went up ${pct}%`,
        detail: `From ${fmtMoney(s.previous_amount, s.currency)} to ${fmtMoney(s.amount, s.currency)}. Check whether a cheaper tier or annual plan fits${s.cancel_by ? `, before ${fmtDate(s.cancel_by)}` : ''}.`,
        action: 'review',
        act_by: s.cancel_by,
        yearly_savings_usd: null,
      });
    }

    if (s.looks_inactive) {
      add({
        id: `inactive:${s.id}`,
        kind: 'looks_inactive',
        priority: 'low',
        subscription_ids: [s.id],
        title: `Is ${s.name} still active?`,
        detail: `No receipt since ${s.last_charged_at ? fmtDate(s.last_charged_at) : 'a while'}. If you already cancelled, mark it cancelled so totals stay accurate.`,
        action: 'confirm',
        act_by: null,
        yearly_savings_usd: null,
      });
    }

    if (s.billing_cycle === 'monthly' && s.monthly_usd >= 8 && s.charge_count >= 6 && !s.looks_inactive) {
      add({
        id: `annual:${s.id}`,
        kind: 'switch_to_annual',
        priority: 'low',
        subscription_ids: [s.id],
        title: `Consider annual billing for ${s.name}`,
        detail: `You've paid ${s.charge_count} months in a row. If the vendor offers an annual plan, it typically saves around 15–20%.`,
        action: 'switch_plan',
        act_by: s.cancel_by,
        yearly_savings_usd: s.yearly_usd * 0.15,
      });
    }
  }

  // Overlaps within a category.
  const byCat = new Map<string, EnrichedSubscription[]>();
  for (const s of live) {
    if (s.decision === 'cancel' || !OVERLAP_CATEGORIES.has(s.category)) continue;
    byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
  }
  for (const [cat, group] of byCat) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.monthly_usd - a.monthly_usd);
    const candidate = sorted.find((s) => s.decision !== 'keep') ?? sorted[0];
    add({
      id: `overlap:${cat}`,
      kind: 'overlap',
      priority: 'medium',
      subscription_ids: group.map((s) => s.id),
      title: `${group.length} ${CATEGORY_LABEL[cat] ?? cat} subscriptions`,
      detail: `You pay for ${group.map((s) => s.name).join(', ')}. Keep the one you use most and drop the rest${candidate.cancel_by ? ` — e.g. ${candidate.name} renews ${fmtDate(candidate.next_renewal_at!)}, so cancel by ${fmtDate(candidate.cancel_by)}` : ''}.`,
      action: 'review',
      act_by: candidate.cancel_by,
      yearly_savings_usd: candidate.yearly_usd,
    });
  }

  // One subscription eating a big share of the budget.
  const totalMonthly = live.reduce((a, s) => a + s.monthly_usd, 0);
  if (live.length >= 3) {
    for (const s of live) {
      if (s.decision !== 'undecided') continue;
      if (s.monthly_usd / totalMonthly >= 0.35 && s.monthly_usd >= 15) {
        add({
          id: `big:${s.id}`,
          kind: 'big_ticket',
          priority: 'low',
          subscription_ids: [s.id],
          title: `${s.name} is ${Math.round((s.monthly_usd / totalMonthly) * 100)}% of your spend`,
          detail: `Your biggest subscription. Worth a quick check that you're on the right tier.`,
          action: 'review',
          act_by: s.cancel_by,
          yearly_savings_usd: null,
        });
      }
    }
  }

  const prioRank = { high: 0, medium: 1, low: 2 } as const;
  recs.sort(
    (a, b) =>
      prioRank[a.priority] - prioRank[b.priority] ||
      (a.act_by ?? '9999').localeCompare(b.act_by ?? '9999')
  );

  const catMap = new Map<string, { monthly_usd: number; count: number }>();
  for (const s of live) {
    const c = catMap.get(s.category) ?? { monthly_usd: 0, count: 0 };
    c.monthly_usd += s.monthly_usd;
    c.count += 1;
    catMap.set(s.category, c);
  }

  const plannedCancel = live.filter((s) => s.decision === 'cancel').reduce((a, s) => a + s.yearly_usd, 0);
  // Count each subscription at most once, even if several suggestions target it.
  // Subscriptions you already plan to cancel are counted separately.
  const savingsBySub = new Map<number, number>();
  for (const r of recs) {
    if (r.kind === 'planned_cancel' || r.yearly_savings_usd == null) continue;
    if (!(r.action === 'cancel' || ['overlap', 'payment_issue', 'yearly_renewal'].includes(r.kind))) continue;
    const target =
      r.kind === 'overlap'
        ? live.find((s) => r.subscription_ids.includes(s.id) && Math.abs(s.yearly_usd - r.yearly_savings_usd!) < 0.01)?.id
        : r.subscription_ids[0];
    if (target != null) savingsBySub.set(target, Math.max(savingsBySub.get(target) ?? 0, r.yearly_savings_usd));
  }
  const potential = [...savingsBySub.values()].reduce((a, v) => a + v, 0);

  const renewingSoon = live
    .filter((s) => s.days_until_renewal != null && s.days_until_renewal <= 30)
    .reduce((a, s) => a + (s.amount != null ? toUsd(s.amount, s.currency, fx) : 0), 0);

  return {
    subscriptions: enriched,
    summary: {
      active_count: live.length,
      monthly_usd: totalMonthly,
      yearly_usd: totalMonthly * 12,
      planned_cancel_yearly_usd: plannedCancel,
      potential_savings_yearly_usd: potential,
      renewing_next_30d_usd: renewingSoon,
      by_category: [...catMap.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.monthly_usd - a.monthly_usd),
    },
    recommendations: recs,
    fx,
  };
}
