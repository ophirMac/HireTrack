'use client';

import { useState } from 'react';
import type { CompanyContact } from '../lib/types';
import { extractLinkedInProfile } from '../lib/api';

interface Props {
  contacts: CompanyContact[];
  onAdd: (data: { name: string; role?: string; linkedin_url?: string; notes?: string }) => Promise<void>;
  onDelete: (contactId: number) => Promise<void>;
}

export default function CompanyContactsPanel({ contacts, onAdd, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'manual' | 'linkedin'>('manual');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractWarning, setExtractWarning] = useState<string | null>(null);
  const [extractedBio, setExtractedBio] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';

  function resetForm() {
    setName('');
    setRole('');
    setLinkedinUrl('');
    setNotes('');
    setExtractWarning(null);
    setExtractedBio(null);
    setShowForm(false);
  }

  async function handleExtractLinkedIn() {
    if (!linkedinUrl.trim()) return;
    setExtracting(true);
    setExtractWarning(null);
    try {
      const result = await extractLinkedInProfile(linkedinUrl.trim());
      setName(result.name);
      setRole(result.role);
      if (result.bio) {
        setExtractedBio(result.bio);
        setNotes(result.bio);
      }
      if (result.warning) setExtractWarning(result.warning);
    } catch (err) {
      setExtractWarning(err instanceof Error ? err.message : 'Failed to extract profile info');
    } finally {
      setExtracting(false);
    }
  }

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
      resetForm();
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
          onClick={() => { setShowForm((v) => !v); setExtractWarning(null); }}
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
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                mode === 'manual'
                  ? 'bg-brand/20 text-brand border-brand/35'
                  : 'bg-transparent text-zinc-500 border-surface-border hover:text-zinc-300'
              }`}
            >
              Enter manually
            </button>
            <button
              type="button"
              onClick={() => setMode('linkedin')}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
                mode === 'linkedin'
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/35'
                  : 'bg-transparent text-zinc-500 border-surface-border hover:text-zinc-300'
              }`}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              From LinkedIn
            </button>
          </div>

          {/* LinkedIn URL input */}
          {mode === 'linkedin' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">LinkedIn Profile URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/..."
                  className={inputClass}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleExtractLinkedIn}
                  disabled={extracting || !linkedinUrl.trim()}
                  className="shrink-0 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/35 text-xs font-medium hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                >
                  {extracting ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    'Extract'
                  )}
                </button>
              </div>
              {extractWarning && (
                <p className="mt-1.5 text-xs text-amber-400">{extractWarning}</p>
              )}
              {extractedBio && !extractWarning && (
                <p className="mt-1.5 text-xs text-zinc-400 italic">
                  <span className="text-zinc-500 not-italic">Bio extracted: </span>{extractedBio}
                </p>
              )}
            </div>
          )}

          {/* Name + Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className={inputClass}
                autoFocus={mode === 'manual'}
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
          </div>

          {/* LinkedIn URL (manual mode) */}
          {mode === 'manual' && (
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
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Recruiter, hiring manager, referral…"
              className={inputClass}
            />
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

      {/* Contact list */}
      {contacts.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-zinc-500">No contacts yet</p>
          <p className="text-xs text-zinc-600 mt-1">Add people who can help you through the process</p>
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
                  {contact.linkedin_url ? (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-zinc-100 hover:text-brand transition-colors truncate"
                    >
                      {contact.name}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-zinc-100 truncate">{contact.name}</span>
                  )}
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

              {/* Delete */}
              <button
                onClick={() => handleDelete(contact.id)}
                disabled={deletingId === contact.id}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-50"
                title="Remove contact"
              >
                {deletingId === contact.id ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
