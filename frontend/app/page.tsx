'use client';

import useSWR from 'swr';
import { fetchCompanies, fetchAuthStatus } from '@/lib/api';
import CompanyCard from '@/components/CompanyCard';
import StatusBadge from '@/components/StatusBadge';
import type { ApplicationStatus } from '@/lib/types';
import { useState, useMemo } from 'react';
import clsx from 'clsx';

const STATUS_FILTERS: Array<{ label: string; value: ApplicationStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Applied', value: 'applied' },
  { label: 'Interview', value: 'interview' },
  { label: 'Offer', value: 'offer' },
  { label: 'Rejection', value: 'rejection' },
  { label: 'Recruiter', value: 'recruiter_reachout' },
];

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR('companies', fetchCompanies, {
    refreshInterval: 30_000,
  });
  const { data: authData } = useSWR('auth-status', fetchAuthStatus);

  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const companies = useMemo(() => {
    if (!data?.companies) return [];
    return data.companies.filter((c) => {
      const matchesStatus = filter === 'all' || c.current_status === filter;
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.domain ?? '').toLowerCase().includes(search.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [data?.companies, filter, search]);

  // Summary counts
  const totalCompanies = data?.companies.length ?? 0;
  const totalInteractions =
    data?.companies.reduce((sum, c) => sum + c.interaction_count, 0) ?? 0;
  const activeApplications =
    data?.companies.filter((c) =>
      ['applied', 'interview', 'assignment'].includes(c.current_status)
    ).length ?? 0;
  const offers = data?.companies.filter((c) => c.current_status === 'offer').length ?? 0;

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">Job Pipeline</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {totalCompanies} companies · {totalInteractions} total emails
        </p>
      </div>

      {/* Auth banner */}
      {authData && !authData.authenticated && (
        <div className="mb-6 card p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-400">Gmail not connected</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Connect your Gmail to begin scanning job emails.
              </p>
            </div>
            <a
              href="http://localhost:3001/auth/google"
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-medium transition-colors"
            >
              Connect Gmail →
            </a>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Companies', value: totalCompanies },
          { label: 'Active', value: activeApplications, highlight: true },
          { label: 'Total Signals', value: totalInteractions },
          { label: 'Offers', value: offers, accent: 'emerald' },
        ].map(({ label, value, highlight, accent }) => (
          <div key={label} className="card p-3.5">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p
              className={clsx(
                'text-2xl font-bold tabular-nums',
                highlight && 'text-brand',
                accent === 'emerald' && value > 0 ? 'text-emerald-400' : !highlight && 'text-zinc-100'
              )}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-card border border-surface-border rounded-lg p-0.5">
          {STATUS_FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                filter === value
                  ? 'bg-brand/20 text-brand'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] max-w-[280px] px-3 py-2 rounded-lg bg-surface-card border border-surface-border text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand/50 transition-colors"
        />
      </div>

      {/* Company list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 h-16 animate-pulse bg-surface-elevated" />
          ))}
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-red-400">Failed to load companies.</p>
          <p className="text-xs text-zinc-600 mt-1">Is the backend running on port 3001?</p>
        </div>
      ) : companies.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-zinc-500">
            {filter !== 'all' || search
              ? 'No companies match your filter.'
              : 'No job interactions found yet. Run a scan to get started.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}
