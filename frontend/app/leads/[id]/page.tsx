'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { format } from 'date-fns';
import clsx from 'clsx';
import {
  fetchLead,
  updateLead,
  deleteLead,
  createLeadMove,
  deleteLeadMove,
  convertLead,
  createLeadContact,
  updateLeadContact,
  deleteLeadContact,
} from '../../../lib/api';
import type { Lead, LeadStatus, LeadSource, ContactStatus } from '../../../lib/types';
import LeadStatusBadge from '../../../components/LeadStatusBadge';
import LeadForm from '../../../components/LeadForm';
import LeadMoveTimeline from '../../../components/LeadMoveTimeline';
import ContactsPanel from '../../../components/ContactsPanel';

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'researching',        label: 'Researching' },
  { value: 'contacted',          label: 'Contacted' },
  { value: 'waiting_response',   label: 'Waiting Response' },
  { value: 'preparing_to_apply', label: 'Preparing to Apply' },
  { value: 'applied',            label: 'Applied' },
];

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', email: 'Email', referral: 'Referral', event: 'Event', other: 'Other',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  try { return format(new Date(d), 'MMM d, yyyy'); }
  catch { return d; }
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = parseInt(params.id as string, 10);

  const [editing, setEditing]       = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    isNaN(id) ? null : ['lead', id],
    () => fetchLead(id),
    { refreshInterval: 30000 }
  );

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleUpdate(formData: Partial<Lead>) {
    await updateLead(id, formData);
    await mutate();
    setEditing(false);
    showToast('success', 'Lead updated');
  }

  async function handleStatusChange(status: LeadStatus) {
    await updateLead(id, { status });
    await mutate();
  }

  async function handleDelete() {
    if (!confirm('Delete this lead? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteLead(id);
      router.push('/leads');
    } catch {
      showToast('error', 'Failed to delete lead');
      setDeleting(false);
    }
  }

  async function handleConvert() {
    if (!confirm('Convert this lead to an application? This will create or link a company in the dashboard.')) return;
    setConverting(true);
    try {
      const result = await convertLead(id);
      await mutate();
      showToast('success', `Converted → ${result.company.name}. View it in the dashboard.`);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  }

  async function handleAddMove(moveData: { date: string; description: string; person_contacted?: string; link?: string }) {
    await createLeadMove(id, moveData);
    await mutate();
  }

  async function handleDeleteMove(moveId: number) {
    await deleteLeadMove(id, moveId);
    await mutate();
  }

  async function handleAddContact(contactData: { name: string; role?: string; linkedin_url?: string; notes?: string }) {
    await createLeadContact(id, contactData);
    await mutate();
  }

  async function handleUpdateContactStatus(contactId: number, status: ContactStatus) {
    await updateLeadContact(id, contactId, { status });
    await mutate();
  }

  async function handleDeleteContact(contactId: number) {
    await deleteLeadContact(id, contactId);
    await mutate();
  }

  if (isNaN(id)) {
    return <div className="p-6 text-red-400 text-sm">Invalid lead ID.</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-surface-elevated rounded animate-pulse" />
        <div className="card h-40 animate-pulse" />
        <div className="card h-60 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="card p-6 text-center">
          <p className="text-sm text-red-400">Failed to load lead. Is the backend running?</p>
          <Link href="/leads" className="mt-3 inline-block text-xs text-brand hover:underline">← Back to Leads</Link>
        </div>
      </div>
    );
  }

  const { lead, moves, contacts } = data;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Leads
      </Link>

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
          {toast.type === 'success' && lead.converted_company_id && (
            <Link href={`/companies/${lead.converted_company_id}`} className="ml-2 underline">
              View Company →
            </Link>
          )}
        </div>
      )}

      {/* Header card */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-semibold text-white truncate">{lead.company_name}</h1>
              <LeadStatusBadge status={lead.status} />
            </div>
            {lead.role && <p className="text-sm text-zinc-400">{lead.role}</p>}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {lead.status !== 'converted' && (
              <>
                <select
                  value={lead.status}
                  onChange={(e) => handleStatusChange(e.target.value as LeadStatus)}
                  className="bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-brand transition-colors"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                <button
                  onClick={handleConvert}
                  disabled={converting}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-sm font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {converting ? 'Converting…' : 'Convert to Application'}
                </button>
              </>
            )}

            {lead.status === 'converted' && lead.converted_company_id && (
              <Link
                href={`/companies/${lead.converted_company_id}`}
                className="px-3 py-1.5 rounded-lg bg-brand/15 text-brand border border-brand/25 text-sm font-medium hover:bg-brand/25 transition-colors"
              >
                View in Dashboard →
              </Link>
            )}

            <button
              onClick={() => setEditing((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-surface-elevated transition-colors"
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>

            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-sm font-medium text-red-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>

        {/* Edit form */}
        {editing && (
          <div className="border-t border-surface-border pt-4">
            <LeadForm
              initial={lead}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(false)}
              submitLabel="Save Changes"
            />
          </div>
        )}

        {/* Meta grid */}
        {!editing && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-surface-border pt-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Contact Person</p>
              <p className="text-sm text-zinc-200">{lead.contact_person || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Source</p>
              <p className="text-sm text-zinc-200">
                {lead.contact_source ? SOURCE_LABELS[lead.contact_source] ?? lead.contact_source : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">First Contacted</p>
              <p className="text-sm text-zinc-200">{formatDate(lead.date_first_contacted)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Actions Logged</p>
              <p className="text-sm text-zinc-200">{moves.length}</p>
            </div>
          </div>
        )}

        {/* Job URL */}
        {!editing && lead.job_url && (
          <div className="border-t border-surface-border pt-4">
            <p className="text-xs text-zinc-500 mb-1">Job Listing</p>
            <a
              href={lead.job_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              View Job Listing →
            </a>
          </div>
        )}

        {/* Notes */}
        {!editing && lead.notes && (
          <div className="border-t border-surface-border pt-4">
            <p className="text-xs text-zinc-500 mb-1">Notes</p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{lead.notes}</p>
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="card p-5">
        <ContactsPanel
          contacts={contacts ?? []}
          onAdd={handleAddContact}
          onUpdateStatus={handleUpdateContactStatus}
          onDelete={handleDeleteContact}
        />
      </div>

      {/* Move Timeline */}
      <div className="card p-5">
        <LeadMoveTimeline
          moves={moves}
          onAdd={handleAddMove}
          onDelete={handleDeleteMove}
        />
      </div>
    </div>
  );
}
