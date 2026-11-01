'use client';

import { useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import SubLogo from './SubLogo';
import SubscriptionForm from './SubscriptionForm';
import {
  CATEGORY_META,
  CYCLE_LABEL,
  CYCLE_SHORT,
  deleteSubscription,
  deleteSubscriptionEvent,
  fetchSubscription,
  fromUsd,
  longDate,
  money,
  relDays,
  resetSubscription,
  updateSubscription,
  type Subscription,
  type SubscriptionDecision,
  type SubscriptionInput,
} from '@/lib/subscriptions';

const EVENT_LABEL: Record<string, { label: string; cls: string }> = {
  charge: { label: 'Charged', cls: 'text-emerald-400 bg-emerald-500/10' },
  one_off: { label: 'Add-on', cls: 'text-sky-400 bg-sky-500/10' },
  renewal_notice: { label: 'Renewal notice', cls: 'text-zinc-300 bg-zinc-500/10' },
  trial_started: { label: 'Trial started', cls: 'text-violet-400 bg-violet-500/10' },
  trial_ending: { label: 'Trial ending', cls: 'text-violet-400 bg-violet-500/10' },
  price_change: { label: 'Price change', cls: 'text-amber-400 bg-amber-500/10' },
  payment_failed: { label: 'Payment failed', cls: 'text-red-400 bg-red-500/10' },
  cancelled: { label: 'Cancelled', cls: 'text-zinc-400 bg-zinc-500/10' },
  signup: { label: 'Signed up', cls: 'text-brand bg-brand/10' },
};

export default function SubscriptionDetail({
  sub,
  displayCurrency,
  fx,
  onChanged,
  onDeleted,
}: {
  sub: Subscription;
  displayCurrency: string;
  fx: Record<string, number>;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { data, mutate } = useSWR(['subscription', sub.id], () => fetchSubscription(sub.id));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = data?.subscription ?? sub;
  const events = data?.events ?? [];
  const cancelled = s.status === 'cancelled';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: SubscriptionInput) => run(() => updateSubscription(s.id, p));

  if (editing) {
    return (
      <SubscriptionForm
        initial={s}
        submitLabel="Save changes"
        onCancel={() => setEditing(false)}
        onSubmit={async (d) => {
          await updateSubscription(s.id, d);
          await mutate();
          onChanged();
          setEditing(false);
        }}
      />
    );
  }

  const showMonthlyEq = s.billing_cycle !== 'monthly' || s.currency !== displayCurrency;

  return (
    <div className="space-y-5">
      {/* Price block */}
      <div className="rounded-xl bg-surface p-4 border border-surface-border">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-bold tabular-nums tracking-tight text-zinc-50">
              {money(s.amount, s.currency)}
              <span className="text-base font-medium text-zinc-500">{CYCLE_SHORT[s.billing_cycle]}</span>
            </p>
            {showMonthlyEq && !cancelled && (
              <p className="text-xs text-zinc-500 mt-1">
                ≈ {money(fromUsd(s.monthly_usd, displayCurrency, fx), displayCurrency)}/mo ·{' '}
                {money(fromUsd(s.yearly_usd, displayCurrency, fx), displayCurrency, true)}/yr
              </p>
            )}
            {!showMonthlyEq && !cancelled && (
              <p className="text-xs text-zinc-500 mt-1">
                {money(fromUsd(s.yearly_usd, displayCurrency, fx), displayCurrency, true)} per year
              </p>
            )}
          </div>
          <span
            className="text-[11px] px-2 py-1 rounded-md font-medium"
            style={{
              color: CATEGORY_META[s.category]?.color,
              background: `${CATEGORY_META[s.category]?.color}1f`,
            }}
          >
            {CATEGORY_META[s.category]?.label ?? s.category}
          </span>
        </div>
        {s.previous_amount != null && s.amount != null && s.amount !== s.previous_amount && (
          <p className={clsx('text-xs mt-2', s.amount > s.previous_amount ? 'text-amber-400' : 'text-emerald-400')}>
            {s.amount > s.previous_amount ? '↑' : '↓'} was {money(s.previous_amount, s.currency)}
          </p>
        )}
      </div>

      {/* Decision */}
      {!cancelled && (
        <div>
          <p className="text-xs font-medium text-zinc-400 mb-2">Your call</p>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface border border-surface-border">
            {(
              [
                ['keep', 'Keep'],
                ['undecided', 'Not sure'],
                ['cancel', 'Cancel it'],
              ] as Array<[SubscriptionDecision, string]>
            ).map(([value, text]) => (
              <button
                key={value}
                disabled={busy}
                onClick={() => patch({ decision: value })}
                className={clsx(
                  'py-2 rounded-lg text-xs font-medium transition-colors',
                  s.decision === value
                    ? value === 'cancel'
                      ? 'bg-red-500/15 text-red-400'
                      : value === 'keep'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-surface-elevated text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {text}
              </button>
            ))}
          </div>
          {s.decision === 'cancel' && s.cancel_by && (
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Best time: <span className="text-red-400 font-medium">{longDate(s.cancel_by)}</span> — the day before it
              renews, so you keep what you&apos;ve already paid for.
            </p>
          )}
        </div>
      )}

      {/* Facts */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Fact label={cancelled ? 'Status' : 'Next renewal'}>
          {cancelled ? (
            <span className="text-zinc-400">Cancelled</span>
          ) : s.next_renewal_at ? (
            <>
              {longDate(s.next_renewal_at)}
              <span className="block text-xs text-zinc-500">{relDays(s.days_until_renewal)}</span>
            </>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="Billing">{CYCLE_LABEL[s.billing_cycle]}</Fact>
        <Fact label="Last charged">{longDate(s.last_charged_at)}</Fact>
        <Fact label="Tracked since">{longDate(s.first_seen_at)}</Fact>
        {s.total_spent != null && s.total_spent > 0 && (
          <Fact label="Spent (tracked)">
            {money(s.total_spent, s.currency)}
            <span className="block text-xs text-zinc-500">{s.charge_count} payments</span>
          </Fact>
        )}
        {s.plan_name && <Fact label="Plan">{s.plan_name}</Fact>}
      </dl>

      {s.notes && <p className="text-sm text-zinc-400 whitespace-pre-wrap">{s.notes}</p>}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        {s.cancel_url && (
          <a
            href={s.cancel_url}
            target="_blank"
            rel="noopener noreferrer"
            className="col-span-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-sm font-medium text-white transition-colors"
          >
            Manage / cancel on {s.vendor_domain ?? 'vendor site'}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-9 9M5 9v10h10" />
            </svg>
          </a>
        )}
        <button
          disabled={busy}
          onClick={() => patch(cancelled ? { status: 'active' } : { status: 'cancelled' })}
          className={clsx(
            'px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
            cancelled
              ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
              : 'border-surface-border text-zinc-200 hover:bg-surface-elevated'
          )}
        >
          {cancelled ? 'Reactivate' : 'I cancelled it'}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="px-4 py-2.5 rounded-lg border border-surface-border text-sm font-medium text-zinc-200 hover:bg-surface-elevated transition-colors"
        >
          Edit
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-zinc-400">From your inbox</p>
          {s.user_edited === 1 && s.source === 'email' && (
            <button
              disabled={busy}
              onClick={() => run(() => resetSubscription(s.id))}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Reset to email data
            </button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-zinc-600">{data ? 'No emails linked — added manually.' : 'Loading…'}</p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-xl border border-surface-border overflow-hidden">
            {events.map((e) => {
              const meta = EVENT_LABEL[e.event_type] ?? { label: e.event_type, cls: 'text-zinc-400 bg-zinc-500/10' };
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', meta.cls)}>{meta.label}</span>
                      <span className="text-xs text-zinc-500">{longDate(e.occurred_at)}</span>
                    </div>
                    {e.gmail_message_id ? (
                      <a
                        href={`https://mail.google.com/mail/u/0/#all/${e.gmail_message_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-zinc-400 hover:text-zinc-200 truncate mt-1"
                      >
                        {e.subject ?? '(no subject)'}
                      </a>
                    ) : (
                      <p className="text-xs text-zinc-400 truncate mt-1">{e.subject}</p>
                    )}
                  </div>
                  {e.amount != null && (
                    <span className="text-sm tabular-nums text-zinc-200">{money(e.amount, e.currency ?? s.currency)}</span>
                  )}
                  <button
                    title="Not related — remove"
                    disabled={busy}
                    onClick={() => run(() => deleteSubscriptionEvent(s.id, e.id))}
                    className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Danger */}
      <div className="pt-2 pb-2">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 flex-1">Remove from the list? Future scans won&apos;t re-add these emails.</span>
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs text-zinc-400">
              No
            </button>
            <button
              onClick={async () => {
                await deleteSubscription(s.id);
                onDeleted();
              }}
              className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium"
            >
              Remove
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-zinc-600 hover:text-red-400">
            Not a subscription? Remove it
          </button>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 mb-0.5">{label}</dt>
      <dd className="text-zinc-200">{children}</dd>
    </div>
  );
}

export function SheetTitle({ sub }: { sub: Subscription }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <SubLogo name={sub.name} domain={sub.vendor_domain} category={sub.category} size="lg" />
      <div className="min-w-0">
        <p className="font-semibold text-zinc-100 truncate">{sub.name}</p>
        <p className="text-xs text-zinc-500 truncate">
          {[sub.plan_name, sub.vendor_domain].filter(Boolean).join(' · ') || 'Subscription'}
        </p>
      </div>
    </div>
  );
}
