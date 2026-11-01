'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { CATEGORY_META, logoUrl } from '@/lib/subscriptions';

export default function SubLogo({
  name,
  domain,
  category,
  size = 'md',
  dim = false,
}: {
  name: string;
  domain: string | null;
  category: string;
  size?: 'sm' | 'md' | 'lg';
  dim?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl(domain);
  const color = CATEGORY_META[category]?.color ?? '#71717a';
  const box = size === 'lg' ? 'w-12 h-12 rounded-xl' : size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl';

  return (
    <div
      className={clsx(
        box,
        'shrink-0 flex items-center justify-center overflow-hidden border border-white/5',
        dim && 'opacity-50 grayscale'
      )}
      style={{ background: `linear-gradient(135deg, ${color}33, ${color}14)` }}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className={size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-sm font-semibold" style={{ color }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
