import { API_BASE } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'unknown';
export type SubscriptionStatus = 'active' | 'trial' | 'payment_issue' | 'paused' | 'cancelled';
export type SubscriptionDecision = 'undecided' | 'keep' | 'cancel';

export interface Subscription {
  id: number;
  name: string;
  plan_name: string | null;
  vendor_domain: string | null;
  category: string;
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
  charge_count: number;
  total_spent: number | null;
  monthly_usd: number;
  yearly_usd: number;
  cancel_by: string | null;
  days_until_renewal: number | null;
  looks_inactive: boolean;
}

export interface SubscriptionEvent {
  id: number;
  event_type: string;
  amount: number | null;
  currency: string | null;
  occurred_at: string;
  subject: string | null;
  from_address: string | null;
  gmail_message_id: string | null;
}

export interface Recommendation {
  id: string;
  kind: string;
  priority: 'high' | 'medium' | 'low';
  subscription_ids: number[];
  title: string;
  detail: string;
  action: 'cancel' | 'review' | 'fix_payment' | 'confirm' | 'switch_plan';
  act_by: string | null;
  yearly_savings_usd: number | null;
}

export interface ScanInfo {
  state: {
    initial_scan_completed: number;
    last_run_started_at: string | null;
    last_run_finished_at: string | null;
    last_run_status: string | null;
    last_run_emails_scanned: number;
    last_run_matches: number;
    last_error: string | null;
  };
  isRunning: boolean;
  progress: { scanned: number; total: number; matches: number };
  gmailConnected: boolean;
  aiConfigured: boolean;
}

export interface SubscriptionsResponse {
  subscriptions: Subscription[];
  summary: {
    active_count: number;
    monthly_usd: number;
    yearly_usd: number;
    planned_cancel_yearly_usd: number;
    potential_savings_yearly_usd: number;
    renewing_next_30d_usd: number;
    by_category: Array<{ category: string; monthly_usd: number; count: number }>;
  };
  recommendations: Recommendation[];
  fx: Record<string, number>;
  scan: ScanInfo;
}

export type SubscriptionInput = Partial<
  Pick<
    Subscription,
    | 'name'
    | 'plan_name'
    | 'vendor_domain'
    | 'category'
    | 'amount'
    | 'currency'
    | 'billing_cycle'
    | 'status'
    | 'decision'
    | 'next_renewal_at'
    | 'trial_ends_at'
    | 'cancel_url'
    | 'notes'
  >
>;

// ─── API ──────────────────────────────────────────────────────────────────────

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchSubscriptions = () => req<SubscriptionsResponse>('/api/subscriptions');
export const fetchSubscription = (id: number) =>
  req<{ subscription: Subscription; events: SubscriptionEvent[] }>(`/api/subscriptions/${id}`);
export const createSubscription = (data: SubscriptionInput) =>
  req<{ subscription: Subscription }>('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) });
export const updateSubscription = (id: number, data: SubscriptionInput) =>
  req<{ subscription: Subscription }>(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSubscription = (id: number) =>
  req<{ success: boolean }>(`/api/subscriptions/${id}`, { method: 'DELETE' });
export const resetSubscription = (id: number) =>
  req<{ subscription: Subscription }>(`/api/subscriptions/${id}/reset`, { method: 'POST' });
export const deleteSubscriptionEvent = (id: number, eventId: number) =>
  req<{ subscription: Subscription }>(`/api/subscriptions/${id}/events/${eventId}`, { method: 'DELETE' });
export const startSubscriptionScan = (full = false) =>
  req<{ message: string }>(`/api/subscriptions/scan${full ? '?full=1' : ''}`, { method: 'POST' });

// ─── Formatting ───────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  ai: { label: 'AI', color: '#8b5cf6' },
  developer: { label: 'Developer', color: '#6366f1' },
  cloud_storage: { label: 'Cloud storage', color: '#0ea5e9' },
  streaming_video: { label: 'Video', color: '#ef4444' },
  music: { label: 'Music', color: '#22c55e' },
  news_reading: { label: 'News & reading', color: '#f59e0b' },
  education: { label: 'Education', color: '#14b8a6' },
  fitness_health: { label: 'Fitness', color: '#f97316' },
  productivity: { label: 'Productivity', color: '#3b82f6' },
  security_vpn: { label: 'Security', color: '#64748b' },
  gaming: { label: 'Gaming', color: '#ec4899' },
  shopping_delivery: { label: 'Shopping', color: '#eab308' },
  telecom: { label: 'Telecom', color: '#06b6d4' },
  finance: { label: 'Finance', color: '#10b981' },
  other: { label: 'Other', color: '#71717a' },
};

export const CATEGORIES = Object.keys(CATEGORY_META);
export const CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP', 'AUD', 'CAD'];

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  unknown: 'Unknown',
};
export const CYCLE_SHORT: Record<BillingCycle, string> = {
  weekly: '/wk',
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
  unknown: '',
};

export function money(amount: number | null | undefined, currency: string, compact = false): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: compact && Math.abs(amount) >= 100 ? 0 : 2,
      minimumFractionDigits: compact && Math.abs(amount) >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Converts a USD figure into the display currency. */
export function fromUsd(usd: number, currency: string, fx: Record<string, number>): number {
  return usd * (fx[currency] ?? 1);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function relDays(days: number | null | undefined): string {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `${-days}d ago`;
  if (days < 45) return `in ${days} days`;
  const months = Math.round(days / 30);
  return `in ${months} mo`;
}

export function daysFromToday(iso: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - today) / 86_400_000);
}

export function logoUrl(domain: string | null): string | null {
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;
}
