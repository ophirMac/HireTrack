'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetchCompany, updateCompanyStatus as updateCompanyStatusApi, createCompanyContact, deleteCompanyContact, updateCompanySourceLead } from '@/lib/api';
import Timeline from '@/components/Timeline';
import StatusBadge from '@/components/StatusBadge';
import StatusSelect from '@/components/StatusSelect';
import CompanyContactsPanel from '@/components/CompanyContactsPanel';
import Image from 'next/image';
import { formatDistanceToNow, format } from 'date-fns';
import type { ApplicationStatus, Lead, LeadMove, LeadContact } from '@/lib/types';
import { useState, useCallback } from 'react';

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  email: 'Email',
  referral: 'Referral',
  event: 'Event',
  other: 'Other',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy'); }
  catch { return d; }
}

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

  // Lead edit state
  const [editingLead, setEditingLead] = useState(false);
  const [leadForm, setLeadForm] = useState<Partial<Lead>>({});
  const [savingLead, setSavingLead] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  const handleAddContact = useCallback(
    async (contactData: { name: string; role?: string; linkedin_url?: string; notes?: string }) => {
      if (!data) return;
      await createCompanyContact(id, contactData);
      mutate();
    },
    [id, data, mutate]
  );

  const handleDeleteContact = useCallback(
    async (contactId: number) => {
      if (!data) return;
      await deleteCompanyContact(id, contactId);
      mutate();
    },
    [id, data, mutate]
  );

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
          contacts: data.contacts,
          source_lead: data.source_lead,
          source_lead_moves: data.source_lead_moves,
          source_lead_contacts: data.source_lead_contacts,
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

  function startEditLead(lead: Lead) {
    setLeadForm({
      role: lead.role ?? '',
      job_url: lead.job_url ?? '',
      contact_person: lead.contact_person ?? '',
      contact_source: lead.contact_source ?? undefined,
      date_first_contacted: lead.date_first_contacted ?? '',
      notes: lead.notes ?? '',
    });
    setLeadError(null);
    setEditingLead(true);
  }

  async function handleSaveLead() {
    setSavingLead(true);
    setLeadError(null);
    try {
      await updateCompanySourceLead(id, {
        role: leadForm.role || null,
        job_url: leadForm.job_url || null,
        contact_person: leadForm.contact_person || null,
        contact_source: leadForm.contact_source || null,
        date_first_contacted: leadForm.date_first_contacted || null,
        notes: leadForm.notes || null,
      });
      await mutate();
      setEditingLead(false);
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingLead(false);
    }
  }

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
  const sourceLead: Lead | null = data.source_lead ?? null;
  const sourceLeadMoves: LeadMove[] = data.source_lead_moves ?? [];
  const sourceLeadContacts: LeadContact[] = data.source_lead_contacts ?? [];

  const latestStatus: ApplicationStatus = company.current_status;

  const contacts = data.contacts ?? [];

  const distinctRoles = Array.from(
    new Set(interactions.map((i) => i.role).filter(Boolean) as string[])
  );

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';

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

            {distinctRoles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {distinctRoles.map((role) => (
                  <span
                    key={role}
                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand/10 border border-brand/20 text-xs text-brand font-medium"
                  >
                    {role}
                  </span>
                ))}
              </div>
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

      {/* Lead Origin Section */}
      {sourceLead && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Converted from Lead
              </span>
              <h2 className="text-sm font-semibold text-zinc-300">Lead Details</h2>
            </div>
            {!editingLead && (
              <button
                onClick={() => startEditLead(sourceLead)}
                className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
              >
                Edit
              </button>
            )}
          </div>

          {editingLead ? (
            <div className="space-y-3">
              {leadError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {leadError}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Role / Position</label>
                  <input
                    type="text"
                    value={leadForm.role ?? ''}
                    onChange={(e) => setLeadForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="e.g. Senior Engineer"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={leadForm.contact_person ?? ''}
                    onChange={(e) => setLeadForm((f) => ({ ...f, contact_person: e.target.value }))}
                    placeholder="e.g. Jane Smith"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Job URL</label>
                  <input
                    type="url"
                    value={leadForm.job_url ?? ''}
                    onChange={(e) => setLeadForm((f) => ({ ...f, job_url: e.target.value }))}
                    placeholder="https://..."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Source</label>
                  <select
                    value={leadForm.contact_source ?? ''}
                    onChange={(e) => setLeadForm((f) => ({ ...f, contact_source: e.target.value as Lead['contact_source'] }))}
                    className={inputClass}
                  >
                    <option value="">— None —</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="email">Email</option>
                    <option value="referral">Referral</option>
                    <option value="event">Event</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">First Contacted</label>
                  <input
                    type="date"
                    value={leadForm.date_first_contacted ?? ''}
                    onChange={(e) => setLeadForm((f) => ({ ...f, date_first_contacted: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={leadForm.notes ?? ''}
                  onChange={(e) => setLeadForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Any notes about this opportunity…"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setEditingLead(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-zinc-400 hover:text-zinc-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLead}
                  disabled={savingLead}
                  className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-50 transition-colors"
                >
                  {savingLead ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">Role</p>
                <p className="text-zinc-200 font-medium">{sourceLead.role || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">Contact</p>
                <p className="text-zinc-200">{sourceLead.contact_person || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">Source</p>
                <p className="text-zinc-200">{sourceLead.contact_source ? (SOURCE_LABELS[sourceLead.contact_source] ?? sourceLead.contact_source) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">First Contacted</p>
                <p className="text-zinc-200">{formatDate(sourceLead.date_first_contacted)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-zinc-500 mb-0.5">Job URL</p>
                {sourceLead.job_url ? (
                  <a
                    href={sourceLead.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline text-xs break-all"
                  >
                    {sourceLead.job_url}
                  </a>
                ) : (
                  <p className="text-zinc-500">—</p>
                )}
              </div>
              {sourceLead.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Notes</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{sourceLead.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Lead Contacts */}
          {sourceLeadContacts.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-border">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Lead Contacts</p>
              <div className="space-y-2">
                {sourceLeadContacts.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg bg-surface-elevated">
                    <div className="w-7 h-7 rounded-full bg-brand/15 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-brand">{c.name[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-200">{c.name}</span>
                        {c.role && <span className="text-xs text-zinc-500">{c.role}</span>}
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400 capitalize">{c.status}</span>
                      </div>
                      {c.linkedin_url && (
                        <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline mt-0.5 block">
                          LinkedIn ↗
                        </a>
                      )}
                      {c.notes && <p className="text-xs text-zinc-500 mt-0.5">{c.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lead Move Timeline */}
          {sourceLeadMoves.length > 0 && (
            <div className="mt-5 pt-4 border-t border-surface-border">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Lead Activity Timeline</p>
              <div className="space-y-2">
                {sourceLeadMoves.map((m) => (
                  <div key={m.id} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 mt-1.5 shrink-0" />
                      <div className="w-px flex-1 bg-surface-border mt-1" />
                    </div>
                    <div className="pb-3 flex-1 min-w-0">
                      <p className="text-zinc-200">{m.description}</p>
                      <div className="flex gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs text-zinc-500">{formatDate(m.date)}</span>
                        {m.person_contacted && (
                          <span className="text-xs text-zinc-500">via {m.person_contacted}</span>
                        )}
                        {m.link && (
                          <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                            Link ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Interaction Timeline
        </h2>
        <Timeline interactions={interactions} />
      </div>

      {/* Contacts */}
      <div className="card p-5 mb-4">
        <CompanyContactsPanel
          contacts={contacts}
          onAdd={handleAddContact}
          onDelete={handleDeleteContact}
        />
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

