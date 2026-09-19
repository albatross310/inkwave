// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  anchoredScrollTarget,
  createWheelMomentumRouter,
  createZoomLatch,
  cursorZoomAnchor,
  omnidirectionalZoomDelta,
  projectedZoomDelta,
  readingZoomAnchor,
  textZoomDelta,
  wheelIsMomentum,
  zoomModeForWheel,
  ZOOM_LATCH_COOLDOWN_MS,
} from './zoomZone'

describe('modifier-selected zoom mode', () => {
  it('natural pinch and Command are text reflow; Shift is whole-page magnify', () => {
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: true, shiftKey: true })).toBe('text')
    expect(zoomModeForWheel({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe('text')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe('text')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe('water')
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: false, shiftKey: false })).toBeNull()
  })

  it('does not silently turn Command zoom into text reflow on a non-magnifying surface', () => {
    expect(zoomModeForWheel({ metaKey: false, ctrlKey: false, shiftKey: true }, false)).toBeNull()
  })

  it('makes diagonal pinch movement responsive without inventing a horizontal zoom direction', () => {
    expect(projectedZoomDelta(8, -4)).toBeCloseTo(-Math.hypot(4, 8))
    expect(projectedZoomDelta(100, 4)).toBeCloseTo(Math.hypot(4, 8)) // cross-axis boost is bounded
    expect(projectedZoomDelta(20, 0)).toBe(0)
  })

  it('reverses Command-scroll vertically without reversing a natural pinch or horizontal residue', () => {
    expect(textZoomDelta(0, -8, false)).toBe(8)
    expect(textZoomDelta(0, 8, false)).toBe(-8)
    expect(textZoomDelta(0, -8, true)).toBe(-8)
    expect(textZoomDelta(-8, 0, false)).toBe(-8)
  })

  it('gives Shift motion a direction and magnitude on every axis, with vertical reversed', () => {
    expect(omnidirectionalZoomDelta(0, -8)).toBe(8)
    expect(omnidirectionalZoomDelta(0, 8)).toBe(-8)
    expect(omnidirectionalZoomDelta(8, 0)).toBe(8)
    expect(omnidirectionalZoomDelta(-8, 2)).toBeCloseTo(-Math.hypot(8, 2))
  })

  it('pins text zoom to the quarter-height reading line except near the document top', () => {
    expect(readingZoomAnchor(100, 800, 500)).toEqual({ y: 300, topLocked: false })
    expect(readingZoomAnchor(100, 800, 0)).toEqual({ y: 300, topLocked: true })
    expect(readingZoomAnchor(100, 800, 199)).toEqual({ y: 300, topLocked: true })
    expect(readingZoomAnchor(100, 800, 201)).toEqual({ y: 300, topLocked: false })
  })

  it('uses the pointer for water zoom and clamps an edge/outside point to the surface', () => {
    const rect = { left: 10, right: 210, top: 20, bottom: 420 }
    expect(cursorZoomAnchor(70, 140, rect)).toEqual({ x: 70, y: 140 })
    expect(cursorZoomAnchor(-50, 900, rect)).toEqual({ x: 10, y: 420 })
  })

  it('remembers an unclamped water anchor so reversing the same gesture restores both edges', () => {
    // Top edge: zooming out wants -90, which the browser displays as 0; returning to scale 1
    // reconstructs the original 0 from the stable page-local point rather than from the clamp.
    const topLocal = (200 - 20) / 1
    expect(anchoredScrollTarget(20, 0, 200, topLocal, 0.5)).toBe(-90)
    expect(anchoredScrollTarget(20, 0, 200, topLocal, 1)).toBe(0)

    // Bottom edge: the same page-local point moves the scroll position upward as the page shrinks,
    // then returns exactly to the original bottom position when scale is restored.
    const bottomLocal = (200 - (-480)) / 1
    expect(anchoredScrollTarget(-480, 500, 200, bottomLocal, 0.5)).toBe(160)
    expect(anchoredScrollTarget(-140, 160, 200, bottomLocal, 1)).toBe(500)
  })
})

describe('native wheel momentum routing', () => {
  it('reads only the browser momentum marker, never delta shape or timing', () => {
    expect(wheelIsMomentum({ momentum: true })).toBe(true)
    expect(wheelIsMomentum({ momentum: false })).toBe(false)
    expect(wheelIsMomentum({})).toBe(false)
  })

  it('discards zoom momentum and its post-keyup tail, then immediately accepts real input', () => {
    const router = createWheelMomentumRouter()
    expect(router.route(true, false)).toEqual({ kind: 'zoom' })
    expect(router.route(true, true)).toEqual({ kind: 'discard', interrupt: false })
    expect(router.route(false, true)).toEqual({ kind: 'discard', interrupt: false })
    expect(router.route(false, false)).toEqual({ kind: 'plain' })
    expect(router.route(true, false)).toEqual({ kind: 'zoom' })
  })

  it('cancels pre-existing scroll inertia without swallowing the next physical zoom event', () => {
    const router = createWheelMomentumRouter()
    expect(router.route(false, true)).toEqual({ kind: 'plain' })
    expect(router.route(true, true)).toEqual({ kind: 'discard', interrupt: true })
    expect(router.route(true, true)).toEqual({ kind: 'discard', interrupt: false })
    expect(router.route(true, false)).toEqual({ kind: 'zoom' })
  })

  it('replaces only a fast wave release with a tiny bounded three-sample coast', () => {
    const router = createWheelMomentumRouter()
    expect(router.route(true, false, 'fast')).toEqual({ kind: 'zoom' })
    expect(router.route(true, true)).toEqual({ kind: 'coast', scale: 0.18 })
    expect(router.route(true, true)).toEqual({ kind: 'coast', scale: 0.10 })
    expect(router.route(true, true)).toEqual({ kind: 'coast', scale: 0.05 })
    expect(router.route(true, true)).toEqual({ kind: 'discard', interrupt: false })
  })

  it('adds no coast below the release-speed threshold', () => {
    const router = createWheelMomentumRouter()
    expect(router.route(true, false, null)).toEqual({ kind: 'zoom' })
    expect(router.route(true, true)).toEqual({ kind: 'discard', interrupt: false })
  })

  it('gives medium and low releases more relative coast while keeping three bounded samples', () => {
    const medium = createWheelMomentumRouter()
    medium.route(true, false, 'medium')
    expect(medium.route(true, true)).toEqual({ kind: 'coast', scale: 0.30 })
    expect(medium.route(true, true)).toEqual({ kind: 'coast', scale: 0.18 })
    expect(medium.route(true, true)).toEqual({ kind: 'coast', scale: 0.10 })

    const low = createWheelMomentumRouter()
    low.route(true, false, 'low')
    expect(low.route(true, true)).toEqual({ kind: 'coast', scale: 0.50 })
    expect(low.route(true, true)).toEqual({ kind: 'coast', scale: 0.30 })
    expect(low.route(true, true)).toEqual({ kind: 'coast', scale: 0.16 })
  })
})

// ── createZoomLatch: immediate mode + delayed cursor release ─────────────────
describe('createZoomLatch', () => {
  let host: HTMLElement
  beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div') })
  afterEach(() => { vi.useRealTimers() })

  it('switches mode and cursor class immediately inside the cooldown window', () => {
    const latch = createZoomLatch(() => host)
    expect(latch.resolve(() => 'water', false)).toBe('water')
    expect(latch.activeMode()).toBe('water')
    expect(host.getAttribute('data-iw-zoom-mode')).toBe('water')
    vi.advanceTimersByTime(100)
    expect(latch.resolve(() => 'text', false)).toBe('text')
    expect(latch.activeMode()).toBe('text')
    expect(host.getAttribute('data-iw-zoom-mode')).toBe('text')
  })

  it('releases the cursor 0.3s after the LAST zoom event (cooldown re-arms per event)', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', false)
    vi.advanceTimersByTime(200)
    latch.resolve(() => 'text', false)          // switches immediately and re-arms the cooldown
    vi.advanceTimersByTime(200)
    expect(latch.activeMode()).toBe('text')
    expect(host.getAttribute('data-iw-zoom-mode')).toBe('text')
    vi.advanceTimersByTime(101)
    expect(latch.activeMode()).toBeNull()
    expect(host.hasAttribute('data-iw-zoom-mode')).toBe(false)
  })

  it('keeps a keyboard zoom session alive through wheel pauses until key-up disposes it', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', false, true)
    vi.advanceTimersByTime(ZOOM_LATCH_COOLDOWN_MS * 3)
    expect(latch.activeMode()).toBe('water')
    expect(host.getAttribute('data-iw-zoom-mode')).toBe('water')
    latch.dispose() // physical key-up
    expect(latch.activeMode()).toBeNull()
    expect(host.hasAttribute('data-iw-zoom-mode')).toBe(false)
  })

  it('sets the mode cursor class while latched and removes it at cooldown expiry', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'text', false)
    expect(host.getAttribute('data-iw-zoom-mode')).toBe('text')
    vi.advanceTimersByTime(ZOOM_LATCH_COOLDOWN_MS + 1)
    expect(host.hasAttribute('data-iw-zoom-mode')).toBe(false)
    expect(host.hasAttribute('data-iw-zoom-out')).toBe(false)
  })

  it('tracks the last direction as data-iw-zoom-out', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', true) // zoom out
    expect(host.hasAttribute('data-iw-zoom-out')).toBe(true)
    latch.resolve(() => 'water', false) // direction flips to zoom in
    expect(host.hasAttribute('data-iw-zoom-out')).toBe(false)
  })

  it('dispose() unlatches immediately and drops the classes', () => {
    const latch = createZoomLatch(() => host)
    latch.resolve(() => 'water', true)
    latch.dispose()
    expect(host.hasAttribute('data-iw-zoom-mode')).toBe(false)
    expect(host.hasAttribute('data-iw-zoom-out')).toBe(false)
    expect(latch.resolve(() => 'text', false)).toBe('text') // fresh compute after dispose
  })
})
