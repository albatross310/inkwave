// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createZoomLatch, omnidirectionalZoomDelta, projectedZoomDelta, zoomModeForWheel, ZOOM_LATCH_COOLDOWN_MS } from './zoomZone'

describe('modifier-selected zoom mode', () => {
  it('natural pinch and Shift+two-finger motion are text reflow; Command is whole-page magnify', () => {
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: true, shiftKey: true })).toBe('text')
    expect(zoomModeForWheel({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe('water')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe('text')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe('text')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: false, shiftKey: false })).toBeNull()
  })

  it('does not silently turn Command zoom into text reflow on a non-magnifying surface', () => {
    expect(zoomModeForWheel({ metaKey: true, ctrlKey: false, shiftKey: false }, false)).toBeNull()
  })

  it('makes diagonal pinch movement responsive without inventing a horizontal zoom direction', () => {
    expect(projectedZoomDelta(8, -4)).toBeCloseTo(-Math.hypot(4, 8))
    expect(projectedZoomDelta(100, 4)).toBeCloseTo(Math.hypot(4, 8)) // cross-axis boost is bounded
    expect(projectedZoomDelta(20, 0)).toBe(0)
  })

  it('gives Shift motion a direction and magnitude on every axis', () => {
    expect(omnidirectionalZoomDelta(0, -8)).toBe(-8)
    expect(omnidirectionalZoomDelta(8, 0)).toBe(8)
    expect(omnidirectionalZoomDelta(-8, 2)).toBeCloseTo(-Math.hypot(8, 2))
  })
})

// ── createZoomLatch: gesture stickiness + 0.5s cooldown + cursor classes ──────
describe('createZoomLatch', () => {
  let host: HTMLElement
  beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div') })
  afterEach(() => { vi.useRealTimers() })

  it('latches the first mode and holds it for the whole gesture, ignoring the compute fn', () => {
    const latch = createZoomLatch(() => host)
    expect(latch.resolve(() => 'water', false)).toBe('water')
    // Later events mid-gesture: compute says text (cursor drifted / page moved) — mode holds.
    expect(latch.resolve(() => 'text', false)).toBe('water')
    vi.advanceTimersByTime(ZOOM_LATCH_COOLDOWN_MS - 100)
    expect(latch.resolve(() => 'text', false)).toBe('water') // still inside the cooldown
  })

  it('releases 0.3s after the LAST zoom event (cooldown re-arms per event)', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', false)
    vi.advanceTimersByTime(200)
    latch.resolve(() => 'water', false)         // re-arms the cooldown
    vi.advanceTimersByTime(200)
    expect(latch.resolve(() => 'text', false)).toBe('water') // 400ms after start, 200 after last
    vi.advanceTimersByTime(ZOOM_LATCH_COOLDOWN_MS + 1)       // full cooldown elapses untouched
    expect(latch.resolve(() => 'text', false)).toBe('text')  // fresh gesture re-computes
  })

  it('sets the mode cursor class while latched and removes it at cooldown expiry', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'text', false)
    expect(host.classList.contains('iw-zooming-text')).toBe(true)
    expect(host.classList.contains('iw-zooming-water')).toBe(false)
    vi.advanceTimersByTime(ZOOM_LATCH_COOLDOWN_MS + 1)
    expect(host.classList.contains('iw-zooming-text')).toBe(false)
    expect(host.classList.contains('iw-zoom-out')).toBe(false)
  })

  it('tracks the last direction as .iw-zoom-out', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', true) // zoom out
    expect(host.classList.contains('iw-zoom-out')).toBe(true)
    latch.resolve(() => 'water', false) // direction flips to zoom in
    expect(host.classList.contains('iw-zoom-out')).toBe(false)
  })

  it('dispose() unlatches immediately and drops the classes', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', true)
    latch.dispose()
    expect(host.classList.contains('iw-zooming-water')).toBe(false)
    expect(host.classList.contains('iw-zoom-out')).toBe(false)
    expect(latch.resolve(() => 'text', false)).toBe('text') // fresh compute after dispose
  })
})
