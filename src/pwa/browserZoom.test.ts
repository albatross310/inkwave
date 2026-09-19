import { describe, expect, it } from 'vitest'
import {
  BROWSER_ZOOM_BASELINE_KEY,
  browserZoomPercent,
  readOrCreateBrowserZoomBaseline,
} from './browserZoom'

describe('browser zoom readout', () => {
  it('reports DPR relative to the established 100% reference', () => {
    expect(browserZoomPercent(2, 2)).toBe(100)
    expect(browserZoomPercent(2.5, 2)).toBe(125)
    expect(browserZoomPercent(1.6, 2)).toBe(80)
  })

  it('reuses the old reference or establishes one once', () => {
    const values = new Map<string, string>()
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    } as Storage
    expect(readOrCreateBrowserZoomBaseline(store, 2)).toBe(2)
    expect(values.get(BROWSER_ZOOM_BASELINE_KEY)).toBe('2')
    expect(readOrCreateBrowserZoomBaseline(store, 2.5)).toBe(2)
  })
})
