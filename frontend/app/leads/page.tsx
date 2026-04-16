'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { format } from 'date-fns';
import clsx from 'clsx';
import { fetchLeads, createLead, deleteLead, convertLead, extractJobUrl } from '../../lib/api';
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
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [deletingId, setDeletingId]     = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);

  // Quick-add state
  const [quickUrl, setQuickUrl] = useState('');
  const [quickCompany, setQuickCompany] = useState('');
  const [quickRole, setQuickRole] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [extracted, setExtracted] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    ['leads', filter],
    () => fetchLeads(filter === 'all' ? undefined : filter),
    { refreshInterval: 30000 }
  );

  function showToast(type: 'success' | 'error' | 'warning', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleExtract() {
    if (!quickUrl.trim()) {
      showToast('error', 'Please enter a job URL');
      return;
    }
    setExtracting(true);
    setToast(null);
    try {
      const result = await extractJobUrl(quickUrl.trim());
      setQuickCompany(result.company_name || '');
      setQuickRole(result.role || '');
      setExtracted(true);
      if (result.warning) {
        showToast('warning', result.warning);
      }
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to extract URL');
    } finally {
      setExtracting(false);
    }
  }

  async function handleQuickSave() {
    if (!quickCompany.trim()) {
      showToast('error', 'Company name is required');
      return;
    }
    setQuickSaving(true);
    try {
      await createLead({
        company_name: quickCompany.trim(),
        role: quickRole.trim() || null,
        job_url: quickUrl.trim() || null,
        status: 'researching',
        contact_source: 'linkedin',
      });
      await mutate();
      setQuickUrl('');
      setQuickCompany('');
      setQuickRole('');
      setExtracted(false);
      setShowQuickAdd(false);
      showToast('success', 'Lead created from URL');
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save lead');
    } finally {
      setQuickSaving(false);
    }
  }

  function handleQuickKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExtract();
    }
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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-white">Leads</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Track potential opportunities before you apply</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setShowQuickAdd(true); setShowForm(false); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0A66C2] text-white text-sm font-medium hover:bg-[#004182] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            Quick Add
          </button>
          <button
            onClick={() => { setShowForm(true); setShowQuickAdd(false); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Lead
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            'text-sm px-4 py-2.5 rounded-lg border',
            toast.type === 'success' && 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
            toast.type === 'error' && 'bg-red-500/10 border-red-500/20 text-red-400',
            toast.type === 'warning' && 'bg-amber-500/10 border-amber-500/20 text-amber-400'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* Quick Add from URL */}
      {showQuickAdd && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              <h2 className="text-sm font-semibold text-zinc-300">Quick Add from URL</h2>
            </div>
            <button
              onClick={() => { setShowQuickAdd(false); setExtracted(false); setQuickUrl(''); setQuickCompany(''); setQuickRole(''); }}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Job Listing URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={quickUrl}
                onChange={(e) => setQuickUrl(e.target.value)}
                onKeyDown={handleQuickKeyDown}
                placeholder="https://www.linkedin.com/jobs/view/..."
                className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
                autoFocus
              />
              <button
                onClick={handleExtract}
                disabled={extracting || !quickUrl.trim()}
                className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {extracting ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Extracting…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Extract
                  </span>
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-1.5">Paste a LinkedIn, Indeed, Glassdoor, or any job listing URL</p>
          </div>

          {(extracted || quickCompany || quickRole) && (
            <div className="space-y-4 pt-2 border-t border-surface-border">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-zinc-400">
                  {extracted ? 'Extracted Details' : 'Lead Details'} — edit if needed
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Company Name *</label>
                  <input
                    type="text"
                    value={quickCompany}
                    onChange={(e) => setQuickCompany(e.target.value)}
                    placeholder="Company name"
                    className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Role / Position</label>
                  <input
                    type="text"
                    value={quickRole}
                    onChange={(e) => setQuickRole(e.target.value)}
                    placeholder="Software Engineer"
                    className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleQuickSave}
                  disabled={quickSaving || !quickCompany.trim()}
                  className="px-5 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
                >
                  {quickSaving ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Saving…
                    </span>
                  ) : (
                    'Save Lead'
                  )}
                </button>
                <button
                  onClick={() => { setShowQuickAdd(false); setExtracted(false); setQuickUrl(''); setQuickCompany(''); setQuickRole(''); }}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
          className="w-full sm:w-52 sm:ml-auto bg-surface border border-surface-border rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
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
        <div className="card overflow-x-auto">
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
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium text-zinc-100 hover:text-brand transition-colors"
                      >
                        {lead.company_name}
                      </Link>
                      {lead.job_url && (
                        <a
                          href={lead.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View job listing"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 text-zinc-500 hover:text-[#0A66C2] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                          </svg>
                        </a>
                      )}
                    </div>
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
