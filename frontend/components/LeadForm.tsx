'use client';

import { useState } from 'react';
import type { Lead, LeadStatus, LeadSource } from '../lib/types';

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'researching',        label: 'Researching' },
  { value: 'contacted',          label: 'Contacted' },
  { value: 'waiting_response',   label: 'Waiting Response' },
  { value: 'preparing_to_apply', label: 'Preparing to Apply' },
  { value: 'applied',            label: 'Applied' },
];

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'linkedin',  label: 'LinkedIn' },
  { value: 'email',     label: 'Email' },
  { value: 'referral',  label: 'Referral' },
  { value: 'event',     label: 'Event' },
  { value: 'other',     label: 'Other' },
];

interface Props {
  initial?: Partial<Lead>;
  onSubmit: (data: Partial<Lead>) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export default function LeadForm({ initial = {}, onSubmit, onCancel, submitLabel = 'Save' }: Props) {
  const [company_name, setCompanyName]   = useState(initial.company_name ?? '');
  const [role, setRole]                   = useState(initial.role ?? '');
  const [job_url, setJobUrl]              = useState(initial.job_url ?? '');
  const [contact_person, setContact]      = useState(initial.contact_person ?? '');
  const [contact_source, setSource]       = useState<LeadSource | ''>(initial.contact_source ?? '');
  const [date_first_contacted, setDate]   = useState(initial.date_first_contacted?.slice(0, 10) ?? '');
  const [status, setStatus]               = useState<LeadStatus>(initial.status ?? 'researching');
  const [notes, setNotes]                 = useState(initial.notes ?? '');
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!company_name.trim()) { setError('Company name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        company_name: company_name.trim(),
        role: role.trim() || null,
        job_url: job_url.trim() || null,
        contact_person: contact_person.trim() || null,
        contact_source: (contact_source as LeadSource) || null,
        date_first_contacted: date_first_contacted || null,
        status,
        notes: notes.trim() || null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';
  const labelClass = 'block text-xs font-medium text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Company Name *</label>
          <input
            type="text"
            value={company_name}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
            className={inputClass}
            required
          />
        </div>

        <div>
          <label className={labelClass}>Job Role / Opportunity</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Software Engineer"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Job Listing URL</label>
          <input
            type="url"
            value={job_url}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://linkedin.com/jobs/view/..."
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Contact Person</label>
          <input
            type="text"
            value={contact_person}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Jane Smith"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Contact Source</label>
          <select
            value={contact_source}
            onChange={(e) => setSource(e.target.value as LeadSource | '')}
            className={inputClass}
          >
            <option value="">— Select source —</option>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Date First Contacted</label>
          <input
            type="date"
            value={date_first_contacted}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add any context, actions taken, or next steps…"
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-surface-border text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-surface-elevated transition-colors"
        >
          Cancel
        </button>
        <div></div>
      </div>
    </form>
  );
}
