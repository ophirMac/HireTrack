'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetchCompany, updateCompanyStatus as updateCompanyStatusApi } from '@/lib/api';
import Timeline from '@/components/Timeline';
import StatusBadge from '@/components/StatusBadge';
import StatusSelect from '@/components/StatusSelect';
import Image from 'next/image';
import { formatDistanceToNow, format } from 'date-fns';
import type { ApplicationStatus } from '@/lib/types';
import { useState, useCallback } from 'react';

export default function CompanyDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = parseInt(params.id as string, 10);

  const { data, error, isLoading, mutate } = useSWR(
    isNaN(id) ? null : `company-${id}`,
    () => fetchCompany(id),
    { refreshInterval: 30_000 }
  );
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const handleStatusChange = useCallback(
    async (status: ApplicationStatus) => {
      if (!data?.company) return;
      setIsUpdatingStatus(true);
      setStatusError(null);
      const snapshot = data;

      mutate(
        {
          company: { ...data.company, current_status: status },
          interactions: data.interactions,
        },
        false
      );

      try {
        await updateCompanyStatusApi(data.company.id, status);
        mutate();
      } catch (err) {
        mutate(snapshot, false);
        setStatusError(err instanceof Error ? err.message : 'Failed to update status');
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [data, mutate]
  );

  if (isNaN(id)) {
    return (
      <div className="px-6 py-6">
        <p className="text-red-400">Invalid company ID.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-6 py-6 max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 rounded-lg animate-pulse bg-surface-elevated" />
        <div className="card h-24 animate-pulse bg-surface-elevated" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-20 animate-pulse bg-surface-elevated" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 py-6">
        <p className="text-red-400">Company not found.</p>
      </div>
    );
  }

  const { company, interactions } = data;

  const latestStatus: ApplicationStatus = company.current_status;

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        All companies
      </button>

      {/* Company header */}
      <div className="card p-5 mb-6">
        <div className="flex items-start gap-4">
          {/* Logo / Avatar */}
          <div className="w-12 h-12 rounded-xl overflow-hidden bg-surface-elevated border border-surface-border shrink-0 flex items-center justify-center">
            {company.logo_url ? (
              <Image
                src={company.logo_url}
                alt={company.name}
                width={48}
                height={48}
                className="object-contain"
                unoptimized
              />
            ) : (
              <span className="text-lg font-bold text-zinc-400">
                {company.name[0]?.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-semibold text-zinc-100">{company.name}</h1>
              <StatusBadge status={latestStatus} />
              <StatusSelect
                value={latestStatus}
                onChange={handleStatusChange}
                disabled={isUpdatingStatus}
              />
            </div>

            {company.domain && (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-brand transition-colors"
              >
                {company.domain} ↗
              </a>
            )}
          </div>

          {/* Stats */}
          <div className="flex gap-4 text-center shrink-0">
            <div>
              <p className="text-xs text-zinc-500">Interactions</p>
              <p className="text-xl font-bold text-zinc-100">{interactions.length}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">First contact</p>
              <p className="text-xs font-medium text-zinc-300 mt-1">
                {company.first_interaction_at
                  ? format(new Date(company.first_interaction_at), 'MMM d, yyyy')
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Last activity</p>
              <p className="text-xs font-medium text-zinc-300 mt-1">
                {company.last_interaction_at
                  ? formatDistanceToNow(new Date(company.last_interaction_at), {
                      addSuffix: true,
                    })
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Interaction Timeline
        </h2>
        <Timeline interactions={interactions} />
      </div>

      {statusError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm shadow-lg">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{statusError}</span>
          <button
            onClick={() => setStatusError(null)}
            className="ml-1 text-red-400/60 hover:text-red-400 transition-colors"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
