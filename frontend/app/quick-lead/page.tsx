'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { extractJobUrl, createLead } from '../../lib/api';

export default function QuickLeadPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);

  function showToast(type: 'success' | 'error' | 'warning', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }

  async function handleExtract() {
    if (!url.trim()) {
      showToast('error', 'Please enter a job URL');
      return;
    }

    setExtracting(true);
    setToast(null);
    try {
      const result = await extractJobUrl(url.trim());
      setCompanyName(result.company_name || '');
      setRole(result.role || '');
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

  async function handleSave() {
    if (!companyName.trim()) {
      showToast('error', 'Company name is required');
      return;
    }

    setSaving(true);
    try {
      const { lead } = await createLead({
        company_name: companyName.trim(),
        role: role.trim() || null,
        job_url: url.trim() || null,
        status: 'researching',
        contact_source: 'linkedin',
      });
      router.push(`/leads/${lead.id}`);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save lead');
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExtract();
    }
  }

  const inputClass =
    'w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors';

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Quick Lead</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Paste a job listing URL to quickly save it as a lead
        </p>
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

      {/* URL Input */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            Job Listing URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://www.linkedin.com/jobs/view/..."
              className={clsx(inputClass, 'flex-1')}
              autoFocus
            />
            <button
              onClick={handleExtract}
              disabled={extracting || !url.trim()}
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
          <p className="text-xs text-zinc-600 mt-1.5">
            Paste a LinkedIn, Indeed, Glassdoor, or any job listing URL
          </p>
        </div>
      </div>

      {/* Extracted / Manual Fields */}
      {(extracted || companyName || role) && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <h2 className="text-sm font-medium text-zinc-300">
              {extracted ? 'Extracted Details' : 'Lead Details'}
            </h2>
            <span className="text-xs text-zinc-600">— edit if needed</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Company Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company name"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Role / Position
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Software Engineer"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !companyName.trim()}
              className="px-5 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </span>
              ) : (
                'Save Lead & Add Contacts'
              )}
            </button>
            <button
              onClick={() => {
                setUrl('');
                setCompanyName('');
                setRole('');
                setExtracted(false);
                setToast(null);
              }}
              className="px-4 py-2.5 rounded-lg border border-surface-border text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-surface-elevated transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Instructions */}
      {!extracted && !companyName && (
        <div className="card p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">How it works</h3>
          <ol className="space-y-2.5 text-sm text-zinc-500">
            <li className="flex gap-2.5">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand text-xs font-semibold shrink-0">1</span>
              <span>Paste a job listing URL and click <strong className="text-zinc-300">Extract</strong></span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand text-xs font-semibold shrink-0">2</span>
              <span>Review &amp; edit the company name and role</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand text-xs font-semibold shrink-0">3</span>
              <span>Save the lead, then add contacts you can reach out to</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/15 text-brand text-xs font-semibold shrink-0">4</span>
              <span>Track each contact&apos;s reaching phase as you progress</span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
