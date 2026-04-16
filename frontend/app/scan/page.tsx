'use client';

import useSWR from 'swr';
import { API_BASE, fetchScanStatus } from '@/lib/api';
import ScanProgressPanel from '@/components/ScanProgressPanel';

export default function ScanPage() {
  const { data, error, isLoading, mutate } = useSWR(
    'scan-status',
    fetchScanStatus,
    {
      // Poll every 5 seconds while scanning, 30s otherwise
      refreshInterval: (data) =>
        data?.isRunning ? 5_000 : 30_000,
    }
  );

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Scan Monitor</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Track email scanning progress and history
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="card h-32 animate-pulse bg-surface-elevated" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card h-20 animate-pulse bg-surface-elevated" />
            ))}
          </div>
          <div className="card h-48 animate-pulse bg-surface-elevated" />
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-red-400">Failed to load scan status.</p>
          <p className="text-xs text-zinc-600 mt-1">Is the backend reachable at {API_BASE}?</p>
        </div>
      ) : data ? (
        <ScanProgressPanel data={data} onRefresh={() => mutate()} />
      ) : null}
    </div>
  );
}
