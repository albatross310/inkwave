// Development-only one-shot replacement for a stale production service worker.
// Deliberately NO fetch listener: once this worker claims a Safari tab, every request falls through
// to the live dev server even before the reload/unregister completes.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    await self.clients.claim()
    const clients = await self.clients.matchAll({ type: 'window' })
    await self.registration.unregister()
    for (const client of clients) {
      try { client.postMessage({ type: 'inkwave-dev-sw-cleared' }) } catch { /* closing tab */ }
    }
  })())
})
