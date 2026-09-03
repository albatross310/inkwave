// Safari can keep an unregistered production worker alive for the lifetime of its controlled tab.
// Page-level unregister + reload therefore alternated between the old worker's half-cached shell
// and the dev server. Replace it with a one-shot worker that claims the tab but has NO fetch handler,
// clears CacheStorage, unregisters itself, then tells the page to reload through the network.

export const DEV_SW_CLEARED_MESSAGE = 'inkwave-dev-sw-cleared'

export async function repairDevServiceWorker(
  serviceWorker: ServiceWorkerContainer,
  cacheStorage: CacheStorage | undefined,
  buildId: string,
  reload: () => void,
): Promise<'clean' | 'replacement-requested'> {
  const registrations = await serviceWorker.getRegistrations()
  if (!registrations.length) {
    // Orphaned CacheStorage cannot control a page, but remove it so a later worker cannot inherit
    // stale assets. No reload: this page already arrived directly from the dev server.
    if (cacheStorage) {
      const keys = await cacheStorage.keys()
      await Promise.all(keys.map((key) => cacheStorage.delete(key)))
    }
    return 'clean'
  }

  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type !== DEV_SW_CLEARED_MESSAGE) return
    serviceWorker.removeEventListener('message', onMessage)
    reload()
  }
  serviceWorker.addEventListener('message', onMessage)
  try {
    // Same root scope as the old worker: registering a different script replaces the existing
    // registration. The build id defeats Safari's update cache during repeated local testing.
    await serviceWorker.register(`/sw-dev-cleanup.js?v=${encodeURIComponent(buildId)}`, { scope: '/' })
  } catch (error) {
    serviceWorker.removeEventListener('message', onMessage)
    throw error
  }
  return 'replacement-requested'
}
