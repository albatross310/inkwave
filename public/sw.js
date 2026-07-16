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
// NOT reloaded (nothing to recover).
//
// The cache name is derived from the ?v=<build-id> the worker was registered with (see
// entry.client.tsx). Every deploy ⇒ a new build id ⇒ a new cache name ⇒ the update/self-heal path
// fires automatically — no manual bump, no "unregister" needed to see changes.
const VERSION = (() => {
  try { return new URL(self.location.href).searchParams.get('v') || 'v0' } catch { return 'v0' }
})()
const CACHE = `inkwave-${VERSION}`

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
      // Don't blanket-reload: the tab that JUST loaded the new build registers this worker and would
      // get reloaded ~2s in for nothing (the visible "loads twice" on every deploy). Instead tell
      // each tab our version; the page compares against its own build id and reloads ONLY if it's
      // genuinely stale (an old tab stranded on the previous build). See entry.client.tsx.
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) {
        try { c.postMessage({ type: 'inkwave-sw-version', version: VERSION }) } catch { /* ignore */ }
      }
    }
  })())
})

// Serve a /wave/ clip cache-first, honouring Range with a real 206 sliced from the cached body.
// The clip is fetched ONCE (full, 200) and cached; every later request — including the iOS Range
// probes — is answered from that cached buffer. No network after first load.
async function handleWave(req) {
  const cache = await caches.open(CACHE)
  let full = await cache.match(req.url)
  if (!full) {
    try {
      const net = await fetch(req.url) // full GET (no Range) → a cacheable 200
      if (net && net.ok) { await cache.put(req.url, net.clone()); full = net }
      else return net // 404/500 — pass the origin's answer through (waveVideo falls back to CSS)
    } catch (e) { return new Response('offline', { status: 504 }) } // offline → CSS water
  }
  const range = req.headers.get('range')
  if (!range) return full // non-Range GET (our warm fetch, or a non-iOS full load)
  const buf = await full.arrayBuffer()
  const total = buf.byteLength
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  let start = m && m[1] ? parseInt(m[1], 10) : 0
  let end = m && m[2] ? parseInt(m[2], 10) : total - 1
  if (isNaN(start) || start < 0) start = 0
  if (isNaN(end) || end >= total) end = total - 1
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
  const body = buf.slice(start, end + 1)
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000',
    },
  })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return

  // Wave videos (/wave/*): CACHE-FIRST **with Range/206 support** (2026-07-16). waveVideo.ts now
  // sets the <video src> to the DIRECT same-origin URL (NOT a blob) — because iOS Safari canNOT
  // decode a blob-URL <video>: it Range-requests into the media to read the moov atom, and a blob
  // has no Range → readyState stuck at 0 (Peter's iPhone 8: fetch 200, readyState 0, decode
  // timeout — reproduced via the ?waveVideo=debug overlay). iOS WILL send `Range: bytes=…`, and a
  // 200-only answer ALSO breaks it, so we cache the full clip once and SERVE 206 slices from cache.
  // Zero network after the first fetch; the cache is version-named so a deploy refreshes the clips.
  if (new URL(req.url).pathname.startsWith('/wave/')) { event.respondWith(handleWave(req)); return }

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
