'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import type { LeadMove } from '../lib/types';

interface Props {
  moves: LeadMove[];
  onAdd: (data: { date: string; description: string; person_contacted?: string; link?: string }) => Promise<void>;
  onDelete: (moveId: number) => Promise<void>;
}

export default function LeadMoveTimeline({ moves, onAdd, onDelete }: Props) {
  const [showForm, setShowForm]       = useState(false);
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [person, setPerson]           = useState('');
  const [link, setLink]               = useState('');
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<number | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setFormError('Description is required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      await onAdd({
        date,
        description: description.trim(),
        person_contacted: person.trim() || undefined,
        link: link.trim() || undefined,
      });
      setDescription('');
      setPerson('');
      setLink('');
      setDate(new Date().toISOString().slice(0, 10));
      setShowForm(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';

  function formatDate(d: string) {
    try { return format(new Date(d), 'MMM d, yyyy'); }
    catch { return d; }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-300">Action Timeline</h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25 font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Action'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card p-4 mb-4 space-y-3">
          {formError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Person Contacted</label>
              <input type="text" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Jane (Recruiter)" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Description *</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Messaged recruiter on LinkedIn"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Link / Reference</label>
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={inputClass} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Add Action'}
            </button>
          </div>
        </form>
      )}

      {moves.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4">No actions logged yet. Add your first action above.</p>
      ) : (
        <ol className="relative border-l border-surface-border space-y-0">
          {moves.map((move) => (
            <li key={move.id} className="ml-4 pb-6 last:pb-0 group">
              <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-surface-card border-2 border-brand" />
              <div className="card p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-100 leading-snug">{move.description}</p>
                  <button
                    onClick={() => handleDelete(move.id)}
                    disabled={deletingId === move.id}
                    className="shrink-0 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                    title="Delete action"
                  >
                    {deletingId === move.id ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <span>{formatDate(move.date)}</span>
                  {move.person_contacted && <span>· {move.person_contacted}</span>}
                  {move.link && (
                    <a
                      href={move.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline truncate max-w-xs"
                    >
                      {move.link}
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
