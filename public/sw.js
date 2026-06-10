// Inkwave service worker.
//
// HTML/navigations are NETWORK-FIRST: a deploy changes the hashed asset URLs, and a cache-first
// HTML shell would serve a stale index.html pointing at the old (now-404) assets → a white page.
// So the shell always comes from the network (cache is offline fallback only). Content-hashed
// assets (/assets/*) are immutable → cache-first (fast + offline).
//
// SELF-HEAL: when a NEW version activates (an update, not a first install), it purges old caches AND
// force-reloads every open tab once. That recovers any browser stranded on a stale shell by an
// earlier (cache-first) worker, with no manual "clear site data" needed. Fresh first installs are
// NOT reloaded (nothing to recover). Bump CACHE on any change so the update path fires.
const CACHE = 'inkwave-v3'

self.addEventListener('install', () => {
  // Don't pre-cache '/': it must come from the network so it references the current asset hashes.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    // A cache under a DIFFERENT name means a previous worker version existed → this is an UPDATE
    // (a returning browser, possibly stranded on a stale shell), not a first install.
    const isUpdate = keys.some((k) => k !== CACHE)
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
    if (isUpdate) {
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) {
        try { c.navigate(c.url) } catch { /* navigate unsupported / cross-origin — ignore */ }
      }
    }
  })())
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
