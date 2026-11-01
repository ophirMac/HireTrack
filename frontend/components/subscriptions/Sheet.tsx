'use client';

import { useEffect } from 'react';

/** Bottom sheet on phones, right-hand drawer on desktop. */
export default function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_.15s_ease-out]" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[460px] md:max-h-none md:rounded-none md:rounded-l-2xl bg-surface-card border-t md:border-t-0 md:border-l border-surface-border flex flex-col shadow-2xl animate-[sheetUp_.22s_cubic-bezier(.2,.8,.2,1)] md:animate-[sheetLeft_.22s_cubic-bezier(.2,.8,.2,1)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden flex justify-center pt-2.5">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 md:pt-5 border-b border-surface-border">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-surface-elevated transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
