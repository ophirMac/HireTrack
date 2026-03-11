import { format } from 'date-fns';
import type { JobInteraction } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface Props {
  interactions: JobInteraction[];
}

export default function Timeline({ interactions }: Props) {
  if (interactions.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No interactions recorded yet.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-0 bottom-0 w-px bg-surface-border" />

      <div className="space-y-6">
        {interactions.map((interaction, idx) => {
          const date = interaction.received_at
            ? new Date(interaction.received_at)
            : new Date(interaction.created_at);

          return (
            <div key={interaction.id} className="flex gap-4 relative">
              {/* Timeline dot */}
              <div className="relative z-10 mt-1 w-8 h-8 shrink-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-brand" />
              </div>

              {/* Card */}
              <div className="flex-1 card p-4 mb-1">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {interaction.subject ?? '(no subject)'}
                    </p>
                    {interaction.role && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Role: <span className="text-zinc-400">{interaction.role}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={interaction.status} size="sm" />
                  </div>
                </div>

                {interaction.snippet && (
                  <p className="text-xs text-zinc-500 line-clamp-2 mb-2">
                    {interaction.snippet}
                  </p>
                )}

                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  {interaction.from_address && (
                    <span className="truncate max-w-[200px]">
                      {interaction.from_name
                        ? `${interaction.from_name} <${interaction.from_address}>`
                        : interaction.from_address}
                    </span>
                  )}
                  <span className="shrink-0">
                    {format(date, 'MMM d, yyyy · h:mm a')}
                  </span>
                  {interaction.extracted_confidence != null && (
                    <span className="shrink-0 text-zinc-700">
                      {Math.round(interaction.extracted_confidence * 100)}% confidence
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
