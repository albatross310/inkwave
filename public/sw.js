// Inkwave service worker.
//
// IMPORTANT: HTML/navigations are NETWORK-FIRST. The previous version was cache-first on '/', so
// after a deploy returning visitors were served the STALE cached index.html — which referenced the
// old build's hashed asset URLs (now 404) → a white page. The HTML shell must always come from the
// network so it points at the CURRENT asset hashes. Content-hashed assets (/assets/*) are immutable,
// so those stay cache-first (fast + offline). Bump CACHE on any caching-behaviour change so the
// `activate` cleanup purges every older cache.
const CACHE = 'inkwave-v2'

self.addEventListener('install', () => {
  // Don't pre-cache '/': it must come from the network so it references the current asset hashes.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return

  const accept = req.headers.get('accept') || ''
  const isNavigation = req.mode === 'navigate' || accept.includes('text/html')

  if (isNavigation) {
    // NETWORK-FIRST: always fetch the fresh shell; fall back to cache only when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, clone))
          return res
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/'))),
    )
    return
  }

  // Hashed, immutable assets (/assets/*) and the like: cache-first.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, clone))
        }
        return res
      }),
    ),
  )
})
