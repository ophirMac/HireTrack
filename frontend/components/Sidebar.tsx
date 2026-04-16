'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { GOOGLE_AUTH_URL } from '@/lib/api';

const nav = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/quick-lead',
    label: 'Quick Lead',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: '/leads',
    label: 'Leads',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/scan',
    label: 'Scan Progress',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];

const logoIcon = (
  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navLinks = nav.map(({ href, label, icon }) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={clsx(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-brand/15 text-brand'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-surface-elevated'
        )}
      >
        {icon}
        {label}
      </Link>
    );
  });

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-surface-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
            {logoIcon}
          </div>
          <span className="font-semibold text-sm tracking-tight text-white">HireTrack</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navLinks}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-surface-border">
        <a
          href={GOOGLE_AUTH_URL}
          className="block text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Reconnect Gmail →
        </a>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar (hidden on md+) ─────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-surface-card border-b border-surface-border flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-surface-elevated transition-colors"
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-brand flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-white">HireTrack</span>
        </div>
      </div>

      {/* ── Mobile backdrop ────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar panel ─────────────────────────────────────────── */}
      {/* Desktop: flex in normal flow as w-56.
          Mobile: hidden by default; when mobileOpen, fixed overlay from left. */}
      <aside
        className={clsx(
          'shrink-0 flex-col border-r border-surface-border bg-surface-card',
          // Always visible on desktop
          'md:flex md:w-56 md:h-full',
          // Mobile: overlay when open, hidden when closed
          mobileOpen
            ? 'flex fixed inset-y-0 left-0 z-50 w-64 h-full'
            : 'hidden'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
