'use client';

import { useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_META,
  CURRENCIES,
  CYCLE_LABEL,
  type BillingCycle,
  type Subscription,
  type SubscriptionInput,
} from '@/lib/subscriptions';

const input =
  'w-full px-3 py-2.5 rounded-lg bg-surface border border-surface-border text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand/60 transition-colors';
const label = 'block text-xs font-medium text-zinc-400 mb-1.5';

export default function SubscriptionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<Subscription>;
  submitLabel: string;
  onSubmit: (data: SubscriptionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    plan_name: initial?.plan_name ?? '',
    category: initial?.category ?? 'other',
    amount: initial?.amount != null ? String(initial.amount) : '',
    currency: initial?.currency ?? 'USD',
    billing_cycle: (initial?.billing_cycle ?? 'monthly') as BillingCycle,
    next_renewal_at: initial?.next_renewal_at?.slice(0, 10) ?? '',
    vendor_domain: initial?.vendor_domain ?? '',
    cancel_url: initial?.cancel_url ?? '',
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        plan_name: form.plan_name.trim() || null,
        category: form.category,
        amount: form.amount === '' ? null : Number(form.amount),
        currency: form.currency,
        billing_cycle: form.billing_cycle,
        next_renewal_at: form.next_renewal_at || null,
        vendor_domain: form.vendor_domain.trim() || null,
        cancel_url: form.cancel_url.trim() || null,
        notes: form.notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const currencies = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES];

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={label}>Service</label>
          <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Netflix" autoFocus />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={label}>Plan</label>
          <input className={input} value={form.plan_name} onChange={(e) => set('plan_name', e.target.value)} placeholder="Premium" />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className={label}>Price</label>
          <input
            className={input}
            inputMode="decimal"
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="9.99"
          />
        </div>
        <div>
          <label className={label}>Currency</label>
          <select className={input} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Billing</label>
          <select
            className={input}
            value={form.billing_cycle}
            onChange={(e) => set('billing_cycle', e.target.value as BillingCycle)}
          >
            {(['monthly', 'yearly', 'quarterly', 'weekly'] as BillingCycle[]).map((c) => (
              <option key={c} value={c}>
                {CYCLE_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Category</label>
          <select className={input} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Next renewal</label>
          <input className={input} type="date" value={form.next_renewal_at} onChange={(e) => set('next_renewal_at', e.target.value)} />
        </div>
        <div>
          <label className={label}>Website</label>
          <input className={input} value={form.vendor_domain} onChange={(e) => set('vendor_domain', e.target.value)} placeholder="netflix.com" />
        </div>
      </div>

      <div>
        <label className={label}>Manage / cancel link</label>
        <input className={input} value={form.cancel_url} onChange={(e) => set('cancel_url', e.target.value)} placeholder="https://…" />
      </div>

      <div>
        <label className={label}>Notes</label>
        <textarea className={`${input} resize-none`} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-lg border border-surface-border text-sm text-zinc-300 hover:bg-surface-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-sm font-medium text-white disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
