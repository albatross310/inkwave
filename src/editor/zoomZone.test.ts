// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isWaterAtX, createZoomLatch, ZOOM_LATCH_COOLDOWN_MS } from './zoomZone'

// ── isWaterAtX: the x-line rule ───────────────────────────────────────────────
// jsdom has no layout, so rects are stubbed: the text column (.ProseMirror) spans x 100…500.
function makeSurface(pmRect: Partial<DOMRect> | null): HTMLElement {
  const root = document.createElement('div')
  if (pmRect) {
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.getBoundingClientRect = () => ({ left: 100, right: 500, top: 0, bottom: 1000, width: 400, height: 1000, x: 100, y: 0, toJSON: () => ({}) , ...pmRect }) as DOMRect
    root.appendChild(pm)
  }
  return root
}

describe('isWaterAtX (zone geometry v2 — x-based)', () => {
  it('x outside the text-column lines is water, regardless of y-band', () => {
    const root = makeSurface({})
    expect(isWaterAtX(root, 50)).toBe(true)    // side water / left page margin
    expect(isWaterAtX(root, 99.5)).toBe(true)  // just outside the left line
    expect(isWaterAtX(root, 550)).toBe(true)   // right of the right line
  })

  it('x inside the lines is page — bottom margins/gaps within the column are font zoom', () => {
    const root = makeSurface({})
    expect(isWaterAtX(root, 100)).toBe(false) // on the line = inside
    expect(isWaterAtX(root, 300)).toBe(false) // over the text column
    expect(isWaterAtX(root, 500)).toBe(false)
  })

  it('no paper at all → never water (degenerate surface)', () => {
    expect(isWaterAtX(makeSurface(null), 300)).toBe(false)
  })

  it('zero-width ProseMirror (mid-mount) falls through without claiming water', () => {
    const root = makeSurface({ left: 0, right: 0, width: 0 })
    expect(isWaterAtX(root, 300)).toBe(false) // no .scroll-paper fallback either
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
