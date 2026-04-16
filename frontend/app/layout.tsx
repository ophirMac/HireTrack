import type { Metadata, Viewport } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import SwRegister from '@/components/SwRegister';

export const metadata: Metadata = {
  title: 'HireTrack',
  description: 'Job application tracking — powered by your Gmail inbox',
  // Shown in mobile browser chrome and PWA titlebar
  applicationName: 'HireTrack',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HireTrack',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches brand color — tints the browser chrome on Android/PWA
  themeColor: '#6366f1',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex h-screen overflow-hidden bg-surface">
        <SwRegister />
        <Sidebar />
        {/* pt-12 offsets the fixed mobile top-bar; md:pt-0 removes it on desktop */}
        <main className="flex-1 overflow-y-auto pt-12 md:pt-0 min-w-0">{children}</main>
      </body>
    </html>
  );
}
