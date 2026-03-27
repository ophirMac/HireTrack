'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { LeadContact, ContactStatus } from '../lib/types';

const CONTACT_STATUSES: { value: ContactStatus; label: string; color: string }[] = [
  { value: 'identified',  label: 'Identified',  color: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25' },
  { value: 'connected',   label: 'Connected',   color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  { value: 'messaged',    label: 'Messaged',    color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  { value: 'replied',     label: 'Replied',     color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  { value: 'referred',    label: 'Referred',    color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
];

function getStatusStyle(status: ContactStatus) {
  return CONTACT_STATUSES.find((s) => s.value === status)?.color ?? CONTACT_STATUSES[0].color;
}

function getStatusLabel(status: ContactStatus) {
  return CONTACT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

interface Props {
  contacts: LeadContact[];
  onAdd: (data: { name: string; role?: string; linkedin_url?: string; notes?: string }) => Promise<void>;
  onUpdateStatus: (contactId: number, status: ContactStatus) => Promise<void>;
  onDelete: (contactId: number) => Promise<void>;
}

export default function ContactsPanel({ contacts, onAdd, onUpdateStatus, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        role: role.trim() || undefined,
        linkedin_url: linkedinUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName('');
      setRole('');
      setLinkedinUrl('');
      setNotes('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contactId: number) {
    setDeletingId(contactId);
    try {
      await onDelete(contactId);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Contacts ({contacts.length})
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-brand/15 text-brand border border-brand/25 hover:bg-brand/25 transition-colors font-medium"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {showForm ? 'Cancel' : 'Add Contact'}
        </button>
      </div>

      {/* Add contact form */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-surface-elevated/50 rounded-lg p-4 space-y-3 border border-surface-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className={inputClass}
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Role / Title</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Engineering Manager"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">LinkedIn URL</label>
              <input
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Met at meetup, works on platform team"
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding…' : 'Add Contact'}
          </button>
        </form>
      )}

      {/* Status legend (compact) */}
      <div className="flex flex-wrap gap-1.5">
        {CONTACT_STATUSES.map((s) => (
          <span
            key={s.value}
            className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', s.color)}
          >
            {s.label}
          </span>
        ))}
      </div>

      {/* Contact list */}
      {contacts.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-zinc-500">No contacts yet</p>
          <p className="text-xs text-zinc-600 mt-1">Add people you can reach out to for this opportunity</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="flex items-center gap-3 bg-surface-elevated/40 rounded-lg px-4 py-3 group border border-transparent hover:border-surface-border transition-colors"
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-surface-border flex items-center justify-center text-xs font-semibold text-zinc-400 shrink-0">
                {contact.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100 truncate">{contact.name}</span>
                  {contact.linkedin_url && (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 shrink-0"
                      title="LinkedIn profile"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  )}
                </div>
                {(contact.role || contact.notes) && (
                  <p className="text-xs text-zinc-500 truncate mt-0.5">
                    {contact.role}
                    {contact.role && contact.notes && ' · '}
                    {contact.notes}
                  </p>
                )}
              </div>

              {/* Status selector */}
              <select
                value={contact.status}
                onChange={(e) => onUpdateStatus(contact.id, e.target.value as ContactStatus)}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded-lg border font-medium bg-transparent cursor-pointer focus:outline-none transition-colors shrink-0',
                  getStatusStyle(contact.status)
                )}
              >
                {CONTACT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>

              {/* Delete */}
              <button
                onClick={() => handleDelete(contact.id)}
                disabled={deletingId === contact.id}
                title="Remove contact"
                className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 disabled:opacity-50 transition-all shrink-0"
              >
                {deletingId === contact.id ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
