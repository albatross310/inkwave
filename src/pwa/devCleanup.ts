// A production service worker can still own the FIRST navigation after a developer returns to
// localhost. Dev already removes workers/caches, but without a reload that first page remains the
// stale worker's half-cached response: document data can hydrate while CSS/editor chunks do not.
// Return whether anything was removed so entry.client can reload exactly once after cleanup.

export async function clearDevServiceWorkerState(
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>,
  cacheStorage?: Pick<CacheStorage, 'keys' | 'delete'>,
): Promise<boolean> {
  const registrations = serviceWorker ? await serviceWorker.getRegistrations() : []
  const cacheKeys = cacheStorage ? await cacheStorage.keys() : []
  if (!registrations.length && !cacheKeys.length) return false

  await Promise.all([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheKeys.map((key) => cacheStorage!.delete(key)),
  ])
  return true
}

const REPAIR_RELOAD_KEY = 'inkwave:dev-sw-repair-reload'

/** Claim the one automatic reload allowed for this repair. The retiring worker can recreate its
 *  cache while that reload is in flight; the marker makes the second dev boot stay put and finish
 *  cleanup instead of entering a reload loop. */
export function claimDevServiceWorkerRepairReload(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): boolean {
  try {
    if (storage.getItem(REPAIR_RELOAD_KEY) === '1') {
      storage.removeItem(REPAIR_RELOAD_KEY)
      return false
    }
    storage.setItem(REPAIR_RELOAD_KEY, '1')
    return true
  } catch {
    // Private-mode storage failure: cleanup still happened; require a manual refresh rather than
    // risking an automatic loop we cannot latch.
    return false
  }
}
