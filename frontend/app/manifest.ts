import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HireTrack',
    short_name: 'HireTrack',
    description: 'Job application tracking — powered by your Gmail inbox',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0e0e10',
    theme_color: '#6366f1',
    categories: ['productivity', 'business'],
    icons: [
      {
        src: '/icons/192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
