// HireTrack Service Worker
// Strategy:
//   - Static assets (_next/static, icons, fonts): cache-first
//   - Navigation (HTML pages): network-first, cache fallback
//   - API calls (/api/): network-only (never cache)

const CACHE_NAME = 'hiretrack-v1';

const STATIC_PREFIXES = ['/_next/static/', '/icons/', '/icon', '/apple-icon'];

function isStaticAsset(url) {
  const { pathname } = new URL(url);
  return (
    STATIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    /\.(js|css|woff2?|png|svg|ico|webp|jpg|jpeg)$/.test(pathname)
  );
}

function isApiCall(url) {
  const { pathname } = new URL(url);
  return pathname.startsWith('/api/');
}

// ── Install: skip waiting so the new SW activates immediately ────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Activate: purge stale caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET from the same origin
  if (request.method !== 'GET') return;
  try {
    if (new URL(request.url).origin !== self.location.origin) return;
  } catch {
    return;
  }

  // API calls: always go to network, never intercept
  if (isApiCall(request.url)) return;

  if (isStaticAsset(request.url)) {
    // Cache-first: serve from cache, populate on miss
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
  } else {
    // Network-first: try network, cache the response, fall back to cache
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
