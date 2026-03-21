'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { format } from 'date-fns';
import clsx from 'clsx';
import { fetchLeads, createLead, deleteLead, convertLead } from '../../lib/api';
import type { Lead, LeadStatus } from '../../lib/types';
import LeadStatusBadge from '../../components/LeadStatusBadge';
import LeadForm from '../../components/LeadForm';

const STATUS_FILTERS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all',              label: 'All' },
  { value: 'researching',      label: 'Researching' },
  { value: 'contacted',        label: 'Contacted' },
  { value: 'waiting_response', label: 'Waiting' },
  { value: 'preparing_to_apply', label: 'Preparing' },
  { value: 'applied',          label: 'Applied' },
  { value: 'converted',        label: 'Converted' },
];

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  email:    'Email',
  referral: 'Referral',
  event:    'Event',
  other:    'Other',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy'); }
  catch { return d; }
}

export default function LeadsPage() {
  const [filter, setFilter]     = useState<LeadStatus | 'all'>('all');
  const [search, setSearch]     = useState('');
  const [showForm, setShowForm] = useState(false);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [deletingId, setDeletingId]     = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ['leads', filter],
    () => fetchLeads(filter === 'all' ? undefined : filter),
    { refreshInterval: 30000 }
  );

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleCreate(formData: Partial<Lead>) {
    await createLead(formData);
    await mutate();
    setShowForm(false);
    showToast('success', 'Lead created');
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteLead(id);
      await mutate();
    } catch {
      showToast('error', 'Failed to delete lead');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConvert(lead: Lead) {
    setConvertingId(lead.id);
    try {
      const result = await convertLead(lead.id);
      await mutate();
      showToast('success', `Converted to company: ${result.company.name}`);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConvertingId(null);
    }
  }

  const leads = (data?.leads ?? []).filter((l) =>
    l.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (l.role ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Leads</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Track potential opportunities before you apply</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Lead
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            'text-sm px-4 py-2.5 rounded-lg border',
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* New Lead form */}
      {showForm && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">New Lead</h2>
          <LeadForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            submitLabel="Create Lead"
          />
        </div>
      )}

      {/* Filters + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-brand/20 text-brand border border-brand/30'
                  : 'text-zinc-400 border border-surface-border hover:text-zinc-100 hover:bg-surface-elevated'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or role…"
          className="ml-auto w-52 bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-elevated" />
          ))}
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-red-400">Failed to load leads. Is the backend running?</p>
        </div>
      ) : leads.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-zinc-400 font-medium">No leads found</p>
          <p className="text-zinc-600 text-sm mt-1">
            {search || filter !== 'all'
              ? 'Try a different filter or search term'
              : 'Click "New Lead" to track your first opportunity'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Company</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide hidden sm:table-cell">Contact</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide hidden md:table-cell">Source</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide hidden lg:table-cell">First Contact</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide hidden sm:table-cell">Actions</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-surface-elevated/50 transition-colors group">
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-zinc-100 hover:text-brand transition-colors"
                    >
                      {lead.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{lead.role || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400 hidden sm:table-cell">{lead.contact_person || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400 hidden md:table-cell">
                    {lead.contact_source ? SOURCE_LABELS[lead.contact_source] ?? lead.contact_source : '—'}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 hidden lg:table-cell">{formatDate(lead.date_first_contacted)}</td>
                  <td className="px-4 py-3">
                    <LeadStatusBadge status={lead.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {lead.status !== 'converted' ? (
                      <button
                        onClick={() => handleConvert(lead)}
                        disabled={convertingId === lead.id}
                        className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {convertingId === lead.id ? 'Converting…' : 'Convert →'}
                      </button>
                    ) : lead.converted_company_id ? (
                      <Link
                        href={`/companies/${lead.converted_company_id}`}
                        className="text-xs text-brand hover:underline"
                      >
                        View Company →
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(lead.id)}
                      disabled={deletingId === lead.id}
                      title="Delete lead"
                      className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 disabled:opacity-50 transition-all"
                    >
                      {deletingId === lead.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
