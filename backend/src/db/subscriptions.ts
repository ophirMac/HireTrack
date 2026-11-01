/**
 * Subscriptions data layer.
 *
 * Tables are created lazily (CREATE IF NOT EXISTS) so existing deployments
 * pick the feature up on the next boot without a manual migration.
 */
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './index';

// ─── Types ────────────────────────────────────────────────────────────────────

export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly', 'unknown'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUB_STATUSES = ['active', 'trial', 'payment_issue', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUB_STATUSES)[number];

export const SUB_DECISIONS = ['undecided', 'keep', 'cancel'] as const;
export type SubscriptionDecision = (typeof SUB_DECISIONS)[number];

export const SUB_CATEGORIES = [
  'ai',
  'developer',
  'cloud_storage',
  'streaming_video',
  'music',
  'news_reading',
  'education',
  'fitness_health',
  'productivity',
  'security_vpn',
  'gaming',
  'shopping_delivery',
  'telecom',
  'finance',
  'other',
] as const;
export type SubscriptionCategory = (typeof SUB_CATEGORIES)[number];

export const CHARGE_EVENTS = [
  'charge',
  'renewal_notice',
  'trial_started',
  'trial_ending',
  'price_change',
  'payment_failed',
  'cancelled',
  'signup',
  'one_off',
  'other',
] as const;
export type ChargeEvent = (typeof CHARGE_EVENTS)[number];

export interface Subscription {
  id: number;
  service_key: string;
  name: string;
  plan_name: string | null;
  vendor_domain: string | null;
  category: SubscriptionCategory;
  amount: number | null;
  currency: string;
  previous_amount: number | null;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  decision: SubscriptionDecision;
  first_seen_at: string | null;
  last_charged_at: string | null;
  next_renewal_at: string | null;
  trial_ends_at: string | null;
  cancel_url: string | null;
  notes: string | null;
  source: 'email' | 'manual';
  user_edited: number;
  status_manual_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionWithStats extends Subscription {
  charge_count: number;
  total_spent: number | null;
}

export interface SubscriptionEvent {
  id: number;
  subscription_id: number;
  gmail_message_id: string | null;
  event_type: ChargeEvent;
  amount: number | null;
  currency: string | null;
  billing_cycle: BillingCycle | null;
  plan_name: string | null;
  next_renewal_at: string | null;
  trial_ends_at: string | null;
  cancel_url: string | null;
  occurred_at: string;
  subject: string | null;
  from_address: string | null;
  created_at: string;
}

export interface SubscriptionScanState {
  id: number;
  last_scanned_after: string | null;
  initial_scan_completed: number;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_emails_scanned: number;
  last_run_matches: number;
  last_error: string | null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

let _ready = false;

function db(): DatabaseSync {
  const d = getDb();
  if (!_ready) {
    ensureSubscriptionTables(d);
    _ready = true;
  }
  return d;
}

export function ensureSubscriptionTables(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      service_key      TEXT    NOT NULL UNIQUE,
      name             TEXT    NOT NULL,
      plan_name        TEXT,
      vendor_domain    TEXT,
      category         TEXT    NOT NULL DEFAULT 'other',
      amount           REAL,
      currency         TEXT    NOT NULL DEFAULT 'USD',
      previous_amount  REAL,
      billing_cycle    TEXT    NOT NULL DEFAULT 'monthly',
      status           TEXT    NOT NULL DEFAULT 'active',
      decision         TEXT    NOT NULL DEFAULT 'undecided',
      first_seen_at    TEXT,
      last_charged_at  TEXT,
      next_renewal_at  TEXT,
      trial_ends_at    TEXT,
      cancel_url       TEXT,
      notes            TEXT,
      source           TEXT    NOT NULL DEFAULT 'email',
      user_edited      INTEGER NOT NULL DEFAULT 0,
      status_manual_at TEXT,
      created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

    CREATE TABLE IF NOT EXISTS subscription_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      gmail_message_id TEXT    UNIQUE,
      event_type       TEXT    NOT NULL,
      amount           REAL,
      currency         TEXT,
      billing_cycle    TEXT,
      plan_name        TEXT,
      next_renewal_at  TEXT,
      trial_ends_at    TEXT,
      cancel_url       TEXT,
      occurred_at      TEXT    NOT NULL,
      subject          TEXT,
      from_address     TEXT,
      created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sub_events_sub ON subscription_events(subscription_id, occurred_at DESC);

    -- Every Gmail message the subscription scanner has looked at (idempotency).
    CREATE TABLE IF NOT EXISTS subscription_scanned_emails (
      gmail_message_id TEXT PRIMARY KEY,
      matched          INTEGER NOT NULL DEFAULT 0,
      scanned_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS subscription_scan_state (
      id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
      last_scanned_after       TEXT,
      initial_scan_completed   INTEGER NOT NULL DEFAULT 0,
      last_run_started_at      TEXT,
      last_run_finished_at     TEXT,
      last_run_status          TEXT,
      last_run_emails_scanned  INTEGER NOT NULL DEFAULT 0,
      last_run_matches         INTEGER NOT NULL DEFAULT 0,
      last_error               TEXT
    );
    INSERT OR IGNORE INTO subscription_scan_state (id) VALUES (1);
  `);
}

const plain = <T>(o: unknown): T => Object.assign({}, o) as T;

// ─── Subscriptions ────────────────────────────────────────────────────────────

export function listSubscriptions(): SubscriptionWithStats[] {
  return db()
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM subscription_events e
                WHERE e.subscription_id = s.id AND e.event_type = 'charge') AS charge_count,
              (SELECT SUM(e.amount) FROM subscription_events e
                WHERE e.subscription_id = s.id AND e.event_type IN ('charge','one_off')
                  AND (e.currency IS NULL OR e.currency = s.currency)) AS total_spent
         FROM subscriptions s
        ORDER BY s.name COLLATE NOCASE`
    )
    .all()
    .map((r) => plain<SubscriptionWithStats>(r));
}

export function getSubscription(id: number): Subscription | undefined {
  const r = db().prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(id);
  return r ? plain<Subscription>(r) : undefined;
}

export function getSubscriptionByKey(key: string): Subscription | undefined {
  const r = db().prepare(`SELECT * FROM subscriptions WHERE service_key = ?`).get(key);
  return r ? plain<Subscription>(r) : undefined;
}

export function createSubscription(data: Partial<Subscription> & { service_key: string; name: string }): Subscription {
  const d = db();
  const res = d
    .prepare(
      `INSERT INTO subscriptions
         (service_key, name, plan_name, vendor_domain, category, amount, currency,
          billing_cycle, status, decision, first_seen_at, last_charged_at,
          next_renewal_at, trial_ends_at, cancel_url, notes, source, user_edited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.service_key,
      data.name,
      data.plan_name ?? null,
      data.vendor_domain ?? null,
      data.category ?? 'other',
      data.amount ?? null,
      data.currency ?? 'USD',
      data.billing_cycle ?? 'monthly',
      data.status ?? 'active',
      data.decision ?? 'undecided',
      data.first_seen_at ?? null,
      data.last_charged_at ?? null,
      data.next_renewal_at ?? null,
      data.trial_ends_at ?? null,
      data.cancel_url ?? null,
      data.notes ?? null,
      data.source ?? 'email',
      data.user_edited ?? 0
    );
  return getSubscription(Number(res.lastInsertRowid))!;
}

const UPDATABLE: Array<keyof Subscription> = [
  'name',
  'plan_name',
  'vendor_domain',
  'category',
  'amount',
  'currency',
  'previous_amount',
  'billing_cycle',
  'status',
  'decision',
  'first_seen_at',
  'last_charged_at',
  'next_renewal_at',
  'trial_ends_at',
  'cancel_url',
  'notes',
  'user_edited',
  'status_manual_at',
];

export function updateSubscription(id: number, patch: Partial<Subscription>): Subscription | undefined {
  const keys = UPDATABLE.filter((k) => k in patch);
  if (keys.length === 0) return getSubscription(id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (patch[k] === undefined ? null : (patch[k] as string | number | null)));
  db()
    .prepare(
      `UPDATE subscriptions SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    )
    .run(...values, id);
  return getSubscription(id);
}

export function deleteSubscription(id: number): boolean {
  return db().prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id).changes > 0;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function listSubscriptionEvents(subscriptionId: number, limit = 500): SubscriptionEvent[] {
  return db()
    .prepare(
      `SELECT * FROM subscription_events WHERE subscription_id = ?
        ORDER BY occurred_at DESC LIMIT ?`
    )
    .all(subscriptionId, limit)
    .map((r) => plain<SubscriptionEvent>(r));
}

export function deleteSubscriptionEvent(subscriptionId: number, eventId: number): boolean {
  return (
    db()
      .prepare(`DELETE FROM subscription_events WHERE id = ? AND subscription_id = ?`)
      .run(eventId, subscriptionId).changes > 0
  );
}

/** Moves every event of `fromId` onto `intoId`, then deletes `fromId`. */
export function mergeSubscriptions(intoId: number, fromId: number): void {
  const d = db();
  d.prepare(`UPDATE subscription_events SET subscription_id = ? WHERE subscription_id = ?`).run(intoId, fromId);
  d.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(fromId);
}

export function insertSubscriptionEvent(data: Omit<SubscriptionEvent, 'id' | 'created_at'>): boolean {
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO subscription_events
         (subscription_id, gmail_message_id, event_type, amount, currency, billing_cycle,
          plan_name, next_renewal_at, trial_ends_at, cancel_url, occurred_at, subject, from_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.subscription_id,
      data.gmail_message_id,
      data.event_type,
      data.amount,
      data.currency,
      data.billing_cycle,
      data.plan_name,
      data.next_renewal_at,
      data.trial_ends_at,
      data.cancel_url,
      data.occurred_at,
      data.subject,
      data.from_address
    );
  return res.changes > 0;
}

// ─── Scanned-email ledger ─────────────────────────────────────────────────────

export function wasEmailScanned(gmailMessageId: string): boolean {
  return !!db()
    .prepare(`SELECT 1 FROM subscription_scanned_emails WHERE gmail_message_id = ?`)
    .get(gmailMessageId);
}

export function markEmailScanned(gmailMessageId: string, matched: boolean): void {
  db()
    .prepare(
      `INSERT INTO subscription_scanned_emails (gmail_message_id, matched) VALUES (?, ?)
       ON CONFLICT(gmail_message_id) DO UPDATE SET matched = excluded.matched`
    )
    .run(gmailMessageId, matched ? 1 : 0);
}

/** Forget every scanned email so the next scan re-reads the whole lookback window. */
export function resetSubscriptionScanLedger(): void {
  db().exec(`
    DELETE FROM subscription_scanned_emails;
    UPDATE subscription_scan_state SET last_scanned_after = NULL, initial_scan_completed = 0 WHERE id = 1;
  `);
}

// ─── Scan state ───────────────────────────────────────────────────────────────

export function getSubscriptionScanState(): SubscriptionScanState {
  return plain<SubscriptionScanState>(
    db().prepare(`SELECT * FROM subscription_scan_state WHERE id = 1`).get()
  );
}

export function updateSubscriptionScanState(patch: Partial<Omit<SubscriptionScanState, 'id'>>): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db()
    .prepare(`UPDATE subscription_scan_state SET ${sets} WHERE id = 1`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | number | null));
}
