'use client';

import useSWR from 'swr';
import {
  fetchCompanies,
  fetchAuthStatus,
  deleteCompany as deleteCompanyApi,
} from '@/lib/api';
import CompanyCard from '@/components/CompanyCard';
import StatusBadge from '@/components/StatusBadge';
import type { ApplicationStatus, Company } from '@/lib/types';
import { useState, useMemo, useCallback } from 'react';
import clsx from 'clsx';

const STATUS_FILTERS: Array<{ label: string; value: ApplicationStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Applied', value: 'applied' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Offer', value: 'offer' },
];

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useSWR('companies', fetchCompanies, {
    refreshInterval: 30_000,
  });
  const { data: authData } = useSWR('auth-status', fetchAuthStatus);

  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Company | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = useCallback((company: Company) => {
    setConfirmDelete(company);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(target.id);
    setDeleteError(null);

    // Snapshot for rollback
    const snapshot = data;
    // Optimistic removal
    if (data) {
      mutate({ companies: data.companies.filter((c) => c.id !== target.id) }, false);
    }

    try {
      await deleteCompanyApi(target.id);
      mutate(); // revalidate from server
    } catch (err) {
      mutate(snapshot, false); // rollback
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete company');
    } finally {
      setDeletingId(null);
    }
  }, [confirmDelete, data, mutate]);


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
    data?.companies.filter((c) => c.current_status === 'applied').length ?? 0;
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
            <CompanyCard
              key={company.id}
              company={company}
              onDeleteClick={handleDeleteClick}
              isDeleting={deletingId === company.id}
            />
          ))}
        </div>
      )}

      {/* Delete error toast */}
      {deleteError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm shadow-lg">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{deleteError}</span>
          <button
            onClick={() => setDeleteError(null)}
            className="ml-1 text-red-400/60 hover:text-red-400 transition-colors"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}


      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm mx-4 card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-zinc-100 mb-2">Delete company?</h2>
            <p className="text-sm text-zinc-400 mb-6">
              This will permanently remove{' '}
              <span className="font-medium text-zinc-200">{confirmDelete.name}</span> and
              all its related application data.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
