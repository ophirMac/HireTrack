import clsx from 'clsx';
import type { ApplicationStatus } from '@/lib/types';

const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; className: string; dot: string }
> = {
  applied: {
    label: 'Applied',
    className: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
    dot: 'bg-indigo-400',
  },
  confirmation: {
    label: 'Confirmed',
    className: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    dot: 'bg-sky-400',
  },
  recruiter_reachout: {
    label: 'Recruiter',
    className: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    dot: 'bg-violet-400',
  },
  interview: {
    label: 'Interview',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    dot: 'bg-amber-400',
  },
  assignment: {
    label: 'Assignment',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    dot: 'bg-orange-400',
  },
  rejection: {
    label: 'Rejected',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
    dot: 'bg-red-400',
  },
  offer: {
    label: 'Offer',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
    dot: 'bg-zinc-500',
  },
};

interface Props {
  status: ApplicationStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-full border',
        config.className,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      )}
    >
      <span className={clsx('rounded-full shrink-0', config.dot, size === 'sm' ? 'w-1.5 h-1.5' : 'w-1.5 h-1.5')} />
      {config.label}
    </span>
  );
}
