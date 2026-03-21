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
  rejected: {
    label: 'Rejected',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
    dot: 'bg-red-400',
  },
  offer: {
    label: 'Offer',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
};

interface Props {
  status: ApplicationStatus | string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const config = STATUS_CONFIG[status as ApplicationStatus] ?? STATUS_CONFIG.applied;

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
