import Link from 'next/link';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import type { Company } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface Props {
  company: Company;
  onDeleteClick?: (company: Company) => void;
  isDeleting?: boolean;
}

function CompanyAvatar({ company }: { company: Company }) {
  if (company.logo_url) {
    return (
      <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-elevated border border-surface-border shrink-0 flex items-center justify-center">
        <Image
          src={company.logo_url}
          alt={company.name}
          width={40}
          height={40}
          className="object-contain"
          unoptimized
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // Initials fallback
  const initials = company.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Deterministic color from company name char codes
  const colors = [
    'from-indigo-500 to-violet-600',
    'from-sky-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
  ];
  const colorIdx =
    company.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    colors.length;

  return (
    <div
      className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center shrink-0 text-white text-sm font-semibold`}
    >
      {initials}
    </div>
  );
}

export default function CompanyCard({
  company,
  onDeleteClick,
  isDeleting,
}: Props) {
  const lastSeen = company.last_interaction_at
    ? formatDistanceToNow(new Date(company.last_interaction_at), { addSuffix: true })
    : 'No activity';

  return (
    <Link href={`/companies/${company.id}`} className="block">
      <div className="card p-4 hover:border-zinc-600 hover:bg-surface-elevated transition-all duration-150 cursor-pointer group">
        <div className="flex items-start gap-3">
          <CompanyAvatar company={company} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm text-zinc-100 truncate group-hover:text-white transition-colors flex-1 min-w-0">
                {company.name}
              </h3>
              <StatusBadge status={company.current_status} size="sm" />
              {onDeleteClick && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteClick(company);
                  }}
                  disabled={isDeleting}
                  aria-label={`Delete ${company.name}`}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeleting ? (
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
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{company.domain ?? 'unknown domain'}</span>
              <span className="flex items-center gap-3">
                <span className="text-zinc-600">
                  {company.interaction_count}{' '}
                  {company.interaction_count === 1 ? 'interaction' : 'interactions'}
                </span>
                <span>{lastSeen}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
