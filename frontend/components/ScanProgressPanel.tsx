'use client';

import { format, formatDistanceToNow } from 'date-fns';
import type { ScanStatus, ScanRun } from '@/lib/types';
import { triggerScan } from '@/lib/api';
import { useState } from 'react';
import clsx from 'clsx';

interface Props {
  data: ScanStatus;
  onRefresh: () => void;
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    failed: 'text-red-400 bg-red-400/10 border-red-400/20',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium',
        colors[status] ?? colors.failed
      )}
    >
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-slow" />
      )}
      {status}
    </span>
  );
}

export default function ScanProgressPanel({ data, onRefresh }: Props) {
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const { syncState, activeRun, progressPercent, isRunning, recentRuns } = data;

  async function handleTrigger() {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await triggerScan();
      setTriggerMsg(res.message);
      setTimeout(onRefresh, 1000);
    } catch (err) {
      setTriggerMsg(err instanceof Error ? err.message : 'Failed to trigger scan');
    } finally {
      setTriggering(false);
    }
  }

  const historyDone = syncState.history_scan_completed === 1;

  return (
    <div className="space-y-6">
      {/* Overall status bar */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-zinc-100">
              {historyDone ? 'Incremental Sync' : 'Initial Historical Scan'}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {historyDone
                ? `Last synced: ${
                    syncState.last_scanned_after
                      ? formatDistanceToNow(new Date(syncState.last_scanned_after), {
                          addSuffix: true,
                        })
                      : 'never'
                  }`
                : 'Scanning inbox history from January 2026…'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isRunning && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Scanning…
              </span>
            )}
            <button
              onClick={handleTrigger}
              disabled={triggering || isRunning}
              className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
            >
              {triggering ? 'Starting…' : 'Trigger Scan'}
            </button>
          </div>
        </div>

        {/* Progress bar — only during historical scan */}
        {!historyDone && (
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
              <span>
                {syncState.total_processed_emails.toLocaleString()} /{' '}
                {syncState.total_estimated_emails > 0
                  ? syncState.total_estimated_emails.toLocaleString()
                  : '—'}{' '}
                emails
              </span>
              <span>{progressPercent != null ? `${progressPercent}%` : '—'}</span>
            </div>
            <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-brand rounded-full transition-all duration-500"
                style={{ width: `${progressPercent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {triggerMsg && (
          <p className="mt-3 text-xs text-zinc-400">{triggerMsg}</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            label: 'Total Processed',
            value: syncState.total_processed_emails.toLocaleString(),
          },
          {
            label: 'Est. Total Emails',
            value: syncState.total_estimated_emails > 0
              ? syncState.total_estimated_emails.toLocaleString()
              : '—',
          },
          {
            label: 'Progress',
            value: progressPercent != null ? `${progressPercent}%` : historyDone ? '100%' : '—',
          },
          {
            label: 'Scan Mode',
            value: historyDone ? 'Incremental' : 'Historical',
          },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-xl font-semibold text-zinc-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Active run */}
      {activeRun && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-100">Active Scan Run</h3>
            <RunStatusBadge status={activeRun.status} />
          </div>
          <ScanRunRow run={activeRun} />
        </div>
      )}

      {/* Scan run log table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h3 className="text-sm font-semibold text-zinc-100">Scan History</h3>
        </div>
        {recentRuns.length === 0 ? (
          <div className="px-5 py-8 text-center text-zinc-500 text-sm">
            No scan runs yet. Trigger a scan to begin.
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {recentRuns.map((run) => (
              <div key={run.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <RunStatusBadge status={run.status} />
                    <span className="text-xs text-zinc-400 capitalize">{run.scan_type}</span>
                    <span className="text-xs text-zinc-600">#{run.id}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-500 shrink-0">
                    <span>{run.emails_scanned.toLocaleString()} scanned</span>
                    <span className="text-emerald-500">{run.job_emails_detected} job emails</span>
                    <span>{format(new Date(run.started_at), 'MMM d · HH:mm')}</span>
                    {run.finished_at && (
                      <span className="text-zinc-600">
                        {Math.round(
                          (new Date(run.finished_at).getTime() -
                            new Date(run.started_at).getTime()) /
                            1000
                        )}
                        s
                      </span>
                    )}
                  </div>
                </div>
                {run.error_message && (
                  <p className="mt-1.5 text-xs text-red-400/80 pl-1">{run.error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScanRunRow({ run }: { run: ScanRun }) {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-400">
      <span className="capitalize">{run.scan_type} scan</span>
      <span>{run.emails_scanned.toLocaleString()} emails scanned</span>
      <span className="text-emerald-400">{run.job_emails_detected} job emails</span>
      <span>Started {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}</span>
    </div>
  );
}
