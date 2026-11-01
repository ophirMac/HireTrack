import { Router, Request, Response } from 'express';
import {
  BILLING_CYCLES,
  SUB_CATEGORIES,
  SUB_DECISIONS,
  SUB_STATUSES,
  createSubscription,
  deleteSubscription,
  deleteSubscriptionEvent,
  getSubscription,
  getSubscriptionByKey,
  getSubscriptionScanState,
  listSubscriptionEvents,
  listSubscriptions,
  mergeSubscriptions,
  resetSubscriptionScanLedger,
  updateSubscription,
  type Subscription,
} from '../db/subscriptions';
import { buildInsights } from '../services/subscription-insights.service';
import { recomputeSubscription, serviceKey, subscriptionScanner } from '../services/subscription-scanner.service';
import { gmailService } from '../services/gmail.service';
import { logger } from '../utils/logger';

const router = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Validated = { ok: true; patch: Partial<Subscription> } | { ok: false; error: string };

/** Validates a create/update body. Unknown keys are ignored. */
function validate(body: Record<string, unknown>): Validated {
  const patch: Partial<Subscription> = {};

  const str = (k: keyof Subscription, max = 200): string | null | undefined => {
    if (!(k in body)) return undefined;
    const v = body[k];
    if (v === null || v === '') return null;
    if (typeof v !== 'string') throw new Error(`${k} must be a string`);
    return v.trim().slice(0, max);
  };
  const oneOf = <T extends string>(k: keyof Subscription, allowed: readonly T[]): T | undefined => {
    if (!(k in body)) return undefined;
    if (!(allowed as readonly unknown[]).includes(body[k])) throw new Error(`${k} must be one of ${allowed.join(', ')}`);
    return body[k] as T;
  };
  const date = (k: keyof Subscription): string | null | undefined => {
    const v = str(k, 10);
    if (v && !ISO_DATE.test(v)) throw new Error(`${k} must be YYYY-MM-DD`);
    return v;
  };

  try {
    const name = str('name', 120);
    if (name !== undefined) {
      if (!name) throw new Error('name cannot be empty');
      patch.name = name;
    }
    const plan = str('plan_name', 120);
    if (plan !== undefined) patch.plan_name = plan;
    const domain = str('vendor_domain', 120);
    if (domain !== undefined) patch.vendor_domain = domain?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? null;
    const notes = str('notes', 2000);
    if (notes !== undefined) patch.notes = notes;
    const cancelUrl = str('cancel_url', 500);
    if (cancelUrl !== undefined) {
      if (cancelUrl && !/^https?:\/\//.test(cancelUrl)) throw new Error('cancel_url must be an http(s) URL');
      patch.cancel_url = cancelUrl;
    }
    if ('amount' in body) {
      const a = body.amount;
      if (a === null || a === '') patch.amount = null;
      else {
        const n = typeof a === 'number' ? a : parseFloat(String(a));
        if (!Number.isFinite(n) || n < 0) throw new Error('amount must be a non-negative number');
        patch.amount = Math.round(n * 100) / 100;
      }
    }
    const currency = str('currency', 3);
    if (currency !== undefined) {
      if (!currency || !/^[A-Za-z]{3}$/.test(currency)) throw new Error('currency must be a 3-letter code');
      patch.currency = currency.toUpperCase();
    }
    const cycle = oneOf('billing_cycle', BILLING_CYCLES);
    if (cycle) patch.billing_cycle = cycle;
    const category = oneOf('category', SUB_CATEGORIES);
    if (category) patch.category = category;
    const status = oneOf('status', SUB_STATUSES);
    if (status) patch.status = status;
    const decision = oneOf('decision', SUB_DECISIONS);
    if (decision) patch.decision = decision;
    const next = date('next_renewal_at');
    if (next !== undefined) patch.next_renewal_at = next;
    const trial = date('trial_ends_at');
    if (trial !== undefined) patch.trial_ends_at = trial;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid input' };
  }
  return { ok: true, patch };
}

function parseId(req: Request): number | null {
  const id = parseInt(req.params.id, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function scanPayload() {
  return {
    state: getSubscriptionScanState(),
    isRunning: subscriptionScanner.isRunning(),
    progress: subscriptionScanner.getProgress(),
    gmailConnected: gmailService.isAuthenticated(),
    aiConfigured: subscriptionScanner.isConfigured(),
  };
}

// GET /api/subscriptions — everything the dashboard needs in one call
router.get('/', (_req: Request, res: Response) => {
  const insights = buildInsights(listSubscriptions());
  res.json({ ...insights, scan: scanPayload() });
});

// GET /api/subscriptions/scan/status
router.get('/scan/status', (_req: Request, res: Response) => {
  res.json(scanPayload());
});

// POST /api/subscriptions/scan — start a Gmail scan (?full=1 re-reads the whole lookback window)
router.post('/scan', (req: Request, res: Response) => {
  if (!subscriptionScanner.isConfigured()) {
    res.status(503).json({ error: 'OpenAI is not configured. Set OPENAI_API_KEY to enable scanning.' });
    return;
  }
  if (!gmailService.isAuthenticated()) {
    res.status(403).json({ error: 'Gmail not connected. Connect Gmail first.' });
    return;
  }
  if (subscriptionScanner.isRunning()) {
    res.status(409).json({ error: 'A subscription scan is already running' });
    return;
  }
  if (req.query.full === '1') resetSubscriptionScanLedger();

  subscriptionScanner.run().catch((err) => {
    logger.error('[subscriptions] manual scan failed', { error: String(err) });
  });
  res.json({ message: 'Subscription scan started' });
});

// POST /api/subscriptions — add one manually
router.post('/', (req: Request, res: Response) => {
  const v = validate(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  if (!v.patch.name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  let key = serviceKey(v.patch.name) || `manual${Date.now()}`;
  if (getSubscriptionByKey(key)) key = `${key}${Date.now()}`;

  const sub = createSubscription({
    ...v.patch,
    name: v.patch.name,
    service_key: key,
    source: 'manual',
    user_edited: 1,
    first_seen_at: new Date().toISOString().slice(0, 10),
  });
  res.status(201).json({ subscription: sub });
});

// GET /api/subscriptions/:id — detail + full event history
router.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req);
  const sub = id ? getSubscription(id) : undefined;
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  const enriched = buildInsights(listSubscriptions()).subscriptions.find((s) => s.id === sub.id);
  res.json({ subscription: enriched ?? sub, events: listSubscriptionEvents(sub.id) });
});

// PATCH /api/subscriptions/:id
router.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req);
  if (!id || !getSubscription(id)) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  const v = validate(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const patch = { ...v.patch };
  // Editing price/identity pins those fields against future scans.
  if (['name', 'amount', 'currency', 'billing_cycle', 'category', 'plan_name'].some((k) => k in patch)) {
    patch.user_edited = 1;
  }
  if ('status' in patch) patch.status_manual_at = new Date().toISOString().slice(0, 10);
  // Marking cancelled settles the decision.
  if (patch.status === 'cancelled' && !('decision' in patch)) patch.decision = 'undecided';

  res.json({ subscription: updateSubscription(id, patch) });
});

// POST /api/subscriptions/:id/reset — drop manual edits, re-derive from emails
router.post('/:id/reset', (req: Request, res: Response) => {
  const id = parseId(req);
  if (!id || !getSubscription(id)) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  updateSubscription(id, { user_edited: 0, status_manual_at: null });
  res.json({ subscription: recomputeSubscription(id) });
});

// POST /api/subscriptions/:id/merge { from_id } — fold a duplicate into this one
router.post('/:id/merge', (req: Request, res: Response) => {
  const id = parseId(req);
  const fromId = Number(req.body?.from_id);
  if (!id || !getSubscription(id) || !Number.isFinite(fromId) || !getSubscription(fromId) || fromId === id) {
    res.status(400).json({ error: 'Valid id and from_id are required' });
    return;
  }
  mergeSubscriptions(id, fromId);
  res.json({ subscription: recomputeSubscription(id) });
});

// DELETE /api/subscriptions/:id/events/:eventId — remove a mis-detected email
router.delete('/:id/events/:eventId', (req: Request, res: Response) => {
  const id = parseId(req);
  const eventId = parseInt(req.params.eventId, 10);
  if (!id || !deleteSubscriptionEvent(id, eventId)) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ subscription: recomputeSubscription(id) });
});

// DELETE /api/subscriptions/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = parseId(req);
  if (!id || !deleteSubscription(id)) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
