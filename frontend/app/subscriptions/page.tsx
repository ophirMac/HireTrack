'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { API_BASE, GOOGLE_AUTH_URL } from '@/lib/api';
import {
  CATEGORY_META,
  CURRENCIES,
  CYCLE_SHORT,
  createSubscription,
  daysFromToday,
  fetchSubscriptions,
  fromUsd,
  money,
  relDays,
  shortDate,
  startSubscriptionScan,
  updateSubscription,
  type Recommendation,
  type Subscription,
  type SubscriptionsResponse,
} from '@/lib/subscriptions';
import SubLogo from '@/components/subscriptions/SubLogo';
import Sheet from '@/components/subscriptions/Sheet';
import SubscriptionForm from '@/components/subscriptions/SubscriptionForm';
import SubscriptionDetail, { SheetTitle } from '@/components/subscriptions/SubscriptionDetail';

type Tab = 'active' | 'cancelled' | 'all';
type Sort = 'cost' | 'renewal' | 'name';

const CURRENCY_KEY = 'subs.displayCurrency';

export default function SubscriptionsPage() {
  const { data, error, isLoading, mutate } = useSWR<SubscriptionsResponse>('subscriptions', fetchSubscriptions, {
    refreshInterval: (d) => (d?.scan.isRunning ? 2_500 : 60_000),
  });

  const [currency, setCurrency] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [sort, setSort] = useState<Sort>('cost');
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAllRecs, setShowAllRecs] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Display currency: saved choice, else the currency you spend most in.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (saved) setCurrency(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const displayCurrency = useMemo(() => {
    if (currency) return currency;
    const spend = new Map<string, number>();
    for (const s of data?.subscriptions ?? []) spend.set(s.currency, (spend.get(s.currency) ?? 0) + s.monthly_usd);
    return [...spend.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
  }, [currency, data?.subscriptions]);
  const chooseCurrency = (c: string) => {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore */
    }
  };

  const fx = data?.fx ?? { USD: 1 };
  const conv = useCallback((usd: number) => fromUsd(usd, displayCurrency, fx), [displayCurrency, fx]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2_800);
  };

  const subs = data?.subscriptions ?? [];
  const byId = useMemo(() => new Map(subs.map((s) => [s.id, s])), [subs]);
  const openSub = openId != null ? byId.get(openId) ?? null : null;

  const list = useMemo(() => {
    const filtered = subs.filter((s) =>
      tab === 'all' ? true : tab === 'cancelled' ? s.status === 'cancelled' : s.status !== 'cancelled'
    );
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'renewal')
        return (a.days_until_renewal ?? 1e9) - (b.days_until_renewal ?? 1e9);
      return b.monthly_usd - a.monthly_usd;
    });
  }, [subs, tab, sort]);

  const upcoming = useMemo(
    () =>
      subs
        .filter((s) => s.status !== 'cancelled' && s.days_until_renewal != null && s.days_until_renewal <= 35)
        .sort((a, b) => a.days_until_renewal! - b.days_until_renewal!),
    [subs]
  );

  const counts = {
    active: subs.filter((s) => s.status !== 'cancelled').length,
    cancelled: subs.filter((s) => s.status === 'cancelled').length,
  };

  const scan = data?.scan;
  const startScan = async (full = false) => {
    try {
      await startSubscriptionScan(full);
      flash(full ? 'Full rescan started' : 'Scanning your inbox…');
      mutate();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to start scan');
    }
  };

  const setDecision = async (id: number, patch: Parameters<typeof updateSubscription>[1], msg: string) => {
    try {
      await updateSubscription(id, patch);
      flash(msg);
      mutate();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const recs = data?.recommendations ?? [];
  const visibleRecs = showAllRecs ? recs : recs.slice(0, 4);
  const summary = data?.summary;
  const empty = !isLoading && !error && subs.length === 0;

  return (
    <div className="px-4 sm:px-6 py-5 sm:py-6 max-w-5xl mx-auto pb-24">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-zinc-100">Subscriptions</h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-0.5 truncate">
            {scan?.isRunning
              ? 'Scanning your inbox…'
              : scan?.state.last_run_finished_at
                ? `Updated ${formatDistanceToNow(new Date(scan.state.last_run_finished_at), { addSuffix: true })}`
                : 'From your Gmail receipts'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label="Display currency"
            value={displayCurrency}
            onChange={(e) => chooseCurrency(e.target.value)}
            className="h-9 px-2 rounded-lg bg-surface-card border border-surface-border text-xs font-medium text-zinc-300 focus:outline-none focus:border-brand/50"
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={() => startScan(false)}
            disabled={scan?.isRunning}
            title="Scan Gmail now"
            className="h-9 w-9 sm:w-auto sm:px-3 flex items-center justify-center gap-2 rounded-lg bg-surface-card border border-surface-border text-zinc-300 hover:text-white hover:bg-surface-elevated disabled:opacity-60 transition-colors"
          >
            <svg
              className={clsx('w-4 h-4', scan?.isRunning && 'animate-spin')}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline text-xs font-medium">Scan</span>
          </button>
          <button
            onClick={() => setAdding(true)}
            title="Add manually"
            className="h-9 w-9 sm:w-auto sm:px-3 flex items-center justify-center gap-2 rounded-lg bg-brand hover:bg-brand-hover text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            <span className="hidden sm:inline text-xs font-medium">Add</span>
          </button>
        </div>
      </div>

      {/* ── Banners ────────────────────────────────────────────────────── */}
      {scan && !scan.gmailConnected && (
        <Banner tone="amber" title="Gmail not connected" body="Connect Gmail so receipts can be detected automatically.">
          <a href={GOOGLE_AUTH_URL} className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium whitespace-nowrap">
            Connect →
          </a>
        </Banner>
      )}
      {scan && scan.gmailConnected && !scan.aiConfigured && (
        <Banner tone="amber" title="AI not configured" body="Set OPENAI_API_KEY on the backend to enable receipt detection. You can still add subscriptions manually." />
      )}
      {scan?.isRunning && (
        <div className="card p-4 mb-5 border-brand/30 bg-brand/5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-brand font-medium">Reading billing emails…</span>
            <span className="text-zinc-500 tabular-nums">
              {scan.progress.scanned}/{scan.progress.total || '…'} · {scan.progress.matches} matches
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-border overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-500"
              style={{ width: `${scan.progress.total ? (scan.progress.scanned / scan.progress.total) * 100 : 4}%` }}
            />
          </div>
        </div>
      )}
      {scan?.state.last_run_status === 'failed' && !scan.isRunning && (
        <Banner tone="red" title="Last scan failed" body={scan.state.last_error ?? 'Unknown error'}>
          <button onClick={() => startScan(false)} className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium">
            Retry
          </button>
        </Banner>
      )}

      {error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-red-400">Failed to load subscriptions.</p>
          <p className="text-xs text-zinc-600 mt-1">Is the backend reachable at {API_BASE}?</p>
        </div>
      ) : isLoading ? (
        <Skeleton />
      ) : empty ? (
        <EmptyState scanning={!!scan?.isRunning} canScan={!!scan?.gmailConnected && !!scan?.aiConfigured} onScan={() => startScan(false)} onAdd={() => setAdding(true)} />
      ) : (
        summary && (
          <>
            {/* ── Hero ───────────────────────────────────────────────────── */}
            <section className="relative overflow-hidden rounded-2xl border border-surface-border bg-gradient-to-br from-brand/20 via-surface-card to-surface-card p-5 sm:p-6 mb-3">
              <div className="absolute -top-24 -right-16 w-64 h-64 rounded-full bg-brand/20 blur-3xl pointer-events-none" />
              <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">You pay</p>
                  <p className="mt-1 text-4xl sm:text-5xl font-bold tracking-tight tabular-nums text-white">
                    {money(conv(summary.monthly_usd), displayCurrency)}
                    <span className="text-lg sm:text-xl font-medium text-zinc-400"> /month</span>
                  </p>
                  <p className="text-sm text-zinc-400 mt-1.5">
                    <span className="text-zinc-200 font-medium">{money(conv(summary.yearly_usd), displayCurrency, true)}</span> a year
                    across <span className="text-zinc-200 font-medium">{summary.active_count}</span> active subscription
                    {summary.active_count === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* Category bar */}
              {summary.monthly_usd > 0 && (
                <div className="relative mt-5">
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-border gap-[2px]">
                    {summary.by_category.map((c) => (
                      <div
                        key={c.category}
                        title={CATEGORY_META[c.category]?.label}
                        style={{
                          width: `${(c.monthly_usd / summary.monthly_usd) * 100}%`,
                          background: CATEGORY_META[c.category]?.color ?? '#71717a',
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                    {summary.by_category.map((c) => (
                      <span key={c.category} className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <span className="w-2 h-2 rounded-full" style={{ background: CATEGORY_META[c.category]?.color }} />
                        {CATEGORY_META[c.category]?.label ?? c.category}
                        <span className="text-zinc-500 tabular-nums">{money(conv(c.monthly_usd), displayCurrency, true)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── KPI tiles ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-7">
              <Kpi label="Next 30 days" value={money(conv(summary.renewing_next_30d_usd), displayCurrency, true)} hint={`${upcoming.filter((s) => s.days_until_renewal! <= 30).length} renewals`} />
              <Kpi
                label="Could also save"
                value={money(conv(summary.potential_savings_yearly_usd), displayCurrency, true)}
                hint="per year"
                tone={summary.potential_savings_yearly_usd > 0 ? 'emerald' : undefined}
              />
              <Kpi
                label="Planned cancels"
                value={money(conv(summary.planned_cancel_yearly_usd), displayCurrency, true)}
                hint="per year"
                tone={summary.planned_cancel_yearly_usd > 0 ? 'red' : undefined}
              />
            </div>

            {/* ── Recommendations ───────────────────────────────────────── */}
            {recs.length > 0 && (
              <section className="mb-8">
                <SectionTitle title="Suggestions" count={recs.length} />
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {visibleRecs.map((r) => (
                    <RecCard
                      key={r.id}
                      rec={r}
                      subs={r.subscription_ids.map((id) => byId.get(id)).filter(Boolean) as Subscription[]}
                      displayCurrency={displayCurrency}
                      conv={conv}
                      onOpen={setOpenId}
                      onDecision={setDecision}
                    />
                  ))}
                </div>
                {recs.length > 4 && (
                  <button onClick={() => setShowAllRecs((v) => !v)} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300">
                    {showAllRecs ? 'Show less' : `Show all ${recs.length}`}
                  </button>
                )}
              </section>
            )}

            {/* ── Upcoming ──────────────────────────────────────────────── */}
            {upcoming.length > 0 && (
              <section className="mb-8">
                <SectionTitle title="Coming up" />
                <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-2.5 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 sm:scroll-px-0">
                  {upcoming.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setOpenId(s.id)}
                      className="snap-start shrink-0 w-[44%] sm:w-auto card p-3.5 text-left flex flex-col justify-start hover:border-zinc-600 transition-colors"
                    >
                      <div className="w-full flex items-center justify-between">
                        <SubLogo name={s.name} domain={s.vendor_domain} category={s.category} size="sm" />
                        <span
                          className={clsx(
                            'text-[11px] font-medium px-1.5 py-0.5 rounded',
                            s.days_until_renewal! <= 3 ? 'bg-red-500/15 text-red-400' : 'bg-surface-elevated text-zinc-400'
                          )}
                        >
                          {shortDate(s.next_renewal_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-zinc-100 mt-3 truncate">{s.name}</p>
                      <p className="text-xs text-zinc-500 tabular-nums">
                        {money(s.amount, s.currency)} · {relDays(s.days_until_renewal)}
                      </p>
                      {s.decision === 'cancel' && <p className="text-[11px] text-red-400 mt-1">Cancel by {shortDate(s.cancel_by)}</p>}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ── All subscriptions ─────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-1 bg-surface-card border border-surface-border rounded-lg p-0.5">
                  {(
                    [
                      ['active', `Active ${counts.active}`],
                      ['cancelled', `Ended ${counts.cancelled}`],
                      ['all', 'All'],
                    ] as Array<[Tab, string]>
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setTab(v)}
                      className={clsx(
                        'px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                        tab === v ? 'bg-brand/20 text-brand' : 'text-zinc-500 hover:text-zinc-300'
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-8 px-2 rounded-lg bg-surface-card border border-surface-border text-xs text-zinc-400 focus:outline-none"
                >
                  <option value="cost">By cost</option>
                  <option value="renewal">By renewal</option>
                  <option value="name">By name</option>
                </select>
              </div>

              {list.length === 0 ? (
                <div className="card p-8 text-center text-sm text-zinc-500">Nothing here.</div>
              ) : (
                <ul className="card divide-y divide-surface-border overflow-hidden">
                  {list.map((s) => (
                    <SubRow key={s.id} s={s} displayCurrency={displayCurrency} conv={conv} onOpen={() => setOpenId(s.id)} />
                  ))}
                </ul>
              )}
              {scan?.gmailConnected && scan.aiConfigured && (
                <p className="text-[11px] text-zinc-600 mt-3 text-center">
                  Missing something?{' '}
                  <button onClick={() => setAdding(true)} className="text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline">
                    Add it manually
                  </button>{' '}
                  or{' '}
                  <button onClick={() => startScan(true)} className="text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline">
                    rescan the last 14 months
                  </button>
                  .
                </p>
              )}
            </section>
          </>
        )
      )}

      {/* ── Sheets ───────────────────────────────────────────────────────── */}
      <Sheet open={!!openSub} onClose={() => setOpenId(null)} title={openSub ? <SheetTitle sub={openSub} /> : null}>
        {openSub && (
          <SubscriptionDetail
            key={openSub.id}
            sub={openSub}
            displayCurrency={displayCurrency}
            fx={fx}
            onChanged={() => mutate()}
            onDeleted={() => {
              setOpenId(null);
              flash('Removed');
              mutate();
            }}
          />
        )}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title={<p className="font-semibold text-zinc-100">Add subscription</p>}>
        <SubscriptionForm
          initial={{ currency: displayCurrency }}
          submitLabel="Add"
          onCancel={() => setAdding(false)}
          onSubmit={async (d) => {
            await createSubscription(d);
            setAdding(false);
            flash('Added');
            mutate();
          }}
        />
      </Sheet>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 shadow-xl" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SubRow({
  s,
  displayCurrency,
  conv,
  onOpen,
}: {
  s: Subscription;
  displayCurrency: string;
  conv: (usd: number) => number;
  onOpen: () => void;
}) {
  const cancelled = s.status === 'cancelled';
  return (
    <li>
      <button onClick={onOpen} className="w-full flex items-center gap-3 px-3.5 sm:px-4 py-3 text-left hover:bg-surface-elevated/60 active:bg-surface-elevated transition-colors">
        <SubLogo name={s.name} domain={s.vendor_domain} category={s.category} dim={cancelled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className={clsx('text-sm font-medium truncate', cancelled ? 'text-zinc-500' : 'text-zinc-100')}>{s.name}</p>
            {s.plan_name && <span className="hidden sm:inline text-xs text-zinc-500 truncate">· {s.plan_name}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-zinc-500 min-w-0">
            <StatusPill s={s} />
            <span className="truncate">
              {cancelled
                ? s.last_charged_at
                  ? `Last paid ${shortDate(s.last_charged_at)}`
                  : 'Ended'
                : s.next_renewal_at
                  ? `Renews ${shortDate(s.next_renewal_at)} · ${relDays(s.days_until_renewal)}`
                  : CATEGORY_META[s.category]?.label}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={clsx('text-sm font-semibold tabular-nums', cancelled ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100')}>
            {money(s.amount, s.currency)}
            <span className="text-xs font-normal text-zinc-500">{CYCLE_SHORT[s.billing_cycle]}</span>
          </p>
          {!cancelled && (s.billing_cycle !== 'monthly' || s.currency !== displayCurrency) && (
            <p className="text-[11px] text-zinc-500 tabular-nums">≈ {money(conv(s.monthly_usd), displayCurrency)}/mo</p>
          )}
        </div>
        <svg className="hidden sm:block w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </li>
  );
}

function StatusPill({ s }: { s: Subscription }) {
  const pill = (text: string, cls: string) => (
    <span className={clsx('shrink-0 text-[10px] font-medium px-1.5 py-px rounded', cls)}>{text}</span>
  );
  if (s.status === 'cancelled') return pill('Ended', 'bg-zinc-500/15 text-zinc-400');
  if (s.decision === 'cancel') return pill('To cancel', 'bg-red-500/15 text-red-400');
  if (s.status === 'payment_issue') return pill('Payment issue', 'bg-red-500/15 text-red-400');
  if (s.status === 'trial') return pill('Trial', 'bg-violet-500/15 text-violet-400');
  if (s.looks_inactive) return pill('Inactive?', 'bg-amber-500/15 text-amber-400');
  if (s.decision === 'keep') return pill('Keep', 'bg-emerald-500/15 text-emerald-400');
  return null;
}

const REC_STYLE: Record<string, { dot: string; ring: string }> = {
  high: { dot: 'bg-red-400', ring: 'border-red-500/25' },
  medium: { dot: 'bg-amber-400', ring: 'border-amber-500/20' },
  low: { dot: 'bg-sky-400', ring: 'border-surface-border' },
};

function RecCard({
  rec,
  subs,
  displayCurrency,
  conv,
  onOpen,
  onDecision,
}: {
  rec: Recommendation;
  subs: Subscription[];
  displayCurrency: string;
  conv: (usd: number) => number;
  onOpen: (id: number) => void;
  onDecision: (id: number, patch: Parameters<typeof updateSubscription>[1], msg: string) => void;
}) {
  const style = REC_STYLE[rec.priority];
  const single = subs.length === 1 ? subs[0] : null;
  const actDays = rec.act_by ? daysFromToday(rec.act_by) : null;

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors';

  return (
    <div className={clsx('card p-4 flex flex-col', style.ring)}>
      <div className="flex items-start gap-3">
        <div className="flex -space-x-2 shrink-0">
          {subs.slice(0, 3).map((s) => (
            <div key={s.id} className="ring-2 ring-surface-card rounded-lg">
              <SubLogo name={s.name} domain={s.vendor_domain} category={s.category} size="sm" />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', style.dot)} />
            <p className="text-sm font-medium text-zinc-100 leading-snug">{rec.title}</p>
          </div>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{rec.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {rec.act_by && actDays != null && actDays >= 0 && (
          <span className={clsx('text-[11px] px-2 py-0.5 rounded-md', actDays <= 3 ? 'bg-red-500/15 text-red-400' : 'bg-surface-elevated text-zinc-400')}>
            ⏱ by {shortDate(rec.act_by)} · {relDays(actDays)}
          </span>
        )}
        {rec.yearly_savings_usd != null && rec.yearly_savings_usd > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400">
            save {money(conv(rec.yearly_savings_usd), displayCurrency, true)}/yr
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-surface-border">
        {rec.kind === 'planned_cancel' && single ? (
          <>
            {single.cancel_url && (
              <a href={single.cancel_url} target="_blank" rel="noopener noreferrer" className={clsx(btn, 'bg-brand text-white hover:bg-brand-hover')}>
                Cancel now ↗
              </a>
            )}
            <button className={clsx(btn, 'bg-surface-elevated text-zinc-200 hover:bg-zinc-700')} onClick={() => onDecision(single.id, { status: 'cancelled' }, `${single.name} marked as cancelled`)}>
              Done, I cancelled
            </button>
          </>
        ) : rec.kind === 'looks_inactive' && single ? (
          <>
            <button className={clsx(btn, 'bg-surface-elevated text-zinc-200 hover:bg-zinc-700')} onClick={() => onDecision(single.id, { status: 'cancelled' }, `${single.name} marked as ended`)}>
              It&apos;s cancelled
            </button>
            <button className={clsx(btn, 'text-zinc-400 hover:text-zinc-200')} onClick={() => onDecision(single.id, { decision: 'keep' }, 'Got it')}>
              Still active
            </button>
          </>
        ) : single ? (
          <>
            {rec.action !== 'fix_payment' && single.decision !== 'cancel' && (
              <button className={clsx(btn, 'bg-red-500/15 text-red-400 hover:bg-red-500/25')} onClick={() => onDecision(single.id, { decision: 'cancel' }, `Planned: cancel ${single.name}`)}>
                Plan to cancel
              </button>
            )}
            {rec.action !== 'fix_payment' && (
              <button className={clsx(btn, 'text-zinc-400 hover:text-zinc-200')} onClick={() => onDecision(single.id, { decision: 'keep' }, `Keeping ${single.name}`)}>
                Keep
              </button>
            )}
            <button className={clsx(btn, 'text-zinc-400 hover:text-zinc-200 ml-auto')} onClick={() => onOpen(single.id)}>
              Details →
            </button>
          </>
        ) : (
          subs.map((s) => (
            <button key={s.id} className={clsx(btn, 'bg-surface-elevated text-zinc-300 hover:bg-zinc-700')} onClick={() => onOpen(s.id)}>
              {s.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'emerald' | 'red' }) {
  return (
    <div className="card p-3 sm:p-4 min-w-0">
      <p className="text-[11px] sm:text-xs text-zinc-500 truncate">{label}</p>
      <p
        className={clsx(
          'text-base sm:text-xl font-bold tabular-nums mt-0.5 truncate',
          tone === 'emerald' ? 'text-emerald-400' : tone === 'red' ? 'text-red-400' : 'text-zinc-100'
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-zinc-600 truncate">{hint}</p>
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
      {title}
      {count != null && <span className="px-1.5 py-px rounded bg-surface-elevated text-zinc-400 normal-case tracking-normal">{count}</span>}
    </h2>
  );
}

function Banner({
  tone,
  title,
  body,
  children,
}: {
  tone: 'amber' | 'red';
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={clsx('card p-4 mb-5 flex items-center justify-between gap-3', tone === 'amber' ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
      <div className="min-w-0">
        <p className={clsx('text-sm font-medium', tone === 'amber' ? 'text-amber-400' : 'text-red-400')}>{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5 break-words">{body}</p>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ scanning, canScan, onScan, onAdd }: { scanning: boolean; canScan: boolean; onScan: () => void; onAdd: () => void }) {
  return (
    <div className="card p-8 sm:p-12 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-brand/15 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-brand" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h2m3 0h2M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-base font-medium text-zinc-100">{scanning ? 'Looking through your receipts…' : 'No subscriptions yet'}</p>
      <p className="text-sm text-zinc-500 mt-1 max-w-sm mx-auto">
        {scanning
          ? 'This takes a minute or two the first time. Results appear here as they are found.'
          : 'Scan your Gmail for receipts, renewals and trial emails from the last 14 months, or add one by hand.'}
      </p>
      {!scanning && (
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
          {canScan && (
            <button onClick={onScan} className="px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-sm font-medium text-white">
              Scan my inbox
            </button>
          )}
          <button onClick={onAdd} className="px-4 py-2.5 rounded-lg border border-surface-border text-sm text-zinc-300 hover:bg-surface-elevated">
            Add manually
          </button>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="card h-40 animate-pulse" />
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-20 animate-pulse" />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card h-16 animate-pulse" />
      ))}
    </div>
  );
}
