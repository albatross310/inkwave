// Browser page zoom has no standard percentage API. On desktop Chrome/Safari it changes DPR, so a
// persisted reference DPR gives a stable, deliberately approximate test readout. This is the old
// counter-scale baseline key: existing writers keep their established 100% reference, but nothing
// consumes it to resize UI any more.

export const BROWSER_ZOOM_BASELINE_KEY = 'inkwave:dpr-baseline-v2'

export function browserZoomPercent(devicePixelRatio: number, baseline: number): number {
  if (!(devicePixelRatio > 0) || !(baseline > 0)) return 100
  return Math.max(25, Math.min(500, Math.round((devicePixelRatio / baseline) * 100)))
}

export function readOrCreateBrowserZoomBaseline(store: Storage, devicePixelRatio: number): number {
  const current = devicePixelRatio > 0 ? devicePixelRatio : 1
  try {
    const existing = parseFloat(store.getItem(BROWSER_ZOOM_BASELINE_KEY) || '')
    if (existing > 0) return existing
    store.setItem(BROWSER_ZOOM_BASELINE_KEY, String(current))
  } catch { /* private mode */ }
  return current
}
