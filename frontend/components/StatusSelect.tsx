import clsx from 'clsx';
import type { ApplicationStatus } from '@/lib/types';

export const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'applied', label: 'Applied' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'offer', label: 'Offer' },
];

interface Props {
  value: ApplicationStatus;
  onChange: (value: ApplicationStatus) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export default function StatusSelect({
  value,
  onChange,
  disabled,
  size = 'md',
}: Props) {
  return (
    <div
      className={clsx(
        'relative inline-flex items-center',
        disabled && 'opacity-60'
      )}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ApplicationStatus)}
        disabled={disabled}
        className={clsx(
          'appearance-none bg-surface-card border border-surface-border text-zinc-200 rounded-full font-medium cursor-pointer',
          'hover:border-zinc-500 focus:outline-none focus:border-brand/60 transition-colors',
          size === 'sm' ? 'text-xs pl-2.5 pr-6 py-1' : 'text-xs pl-3 pr-7 py-1.5'
        )}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        className={clsx(
          'absolute right-2 text-zinc-500 pointer-events-none',
          size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
        )}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.1l3.71-3.87a.75.75 0 111.08 1.04l-4.24 4.41a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
