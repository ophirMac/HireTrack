import clsx from 'clsx';
import type { LeadStatus } from '../lib/types';

const CONFIG: Record<LeadStatus, { label: string; classes: string }> = {
  researching:       { label: 'Researching',       classes: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  contacted:         { label: 'Contacted',          classes: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  waiting_response:  { label: 'Waiting Response',   classes: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
  preparing_to_apply:{ label: 'Preparing to Apply', classes: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' },
  applied:           { label: 'Applied',            classes: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' },
  converted:         { label: 'Converted',          classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
};

interface Props {
  status: LeadStatus | string;
  size?: 'sm' | 'md';
}

export default function LeadStatusBadge({ status, size = 'md' }: Props) {
  const cfg = CONFIG[status as LeadStatus] ?? CONFIG.researching;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        cfg.classes
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {cfg.label}
    </span>
  );
}
