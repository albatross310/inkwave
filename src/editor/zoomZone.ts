// ─── Zoom gesture mode + latch — shared by Scroll.tsx + SnapshotView ──────────────────────────
//
// Peter, 2026-09-06: cursor position is no longer a mode. A natural trackpad pinch and
// Command+scroll perform text reflow; Shift makes ANY two-finger direction perform whole-page
// magnify. Ordinary unmodified two-finger scroll remains ordinary document scrolling.
// trackpads a reliable scroll-shaped zoom gesture when their native pinch recogniser rejects an
// angled two-finger movement, and the mode can never flip because the page moved under the cursor.
//
// MODE + CURSOR COOLDOWN: every event applies its current modifier-selected mode immediately.
// The 0.3s cooldown governs only when an idle cursor disappears; it must never delay a deliberate
// Shift ↔ Command mode change.
// The state holder also owns the ZOOM CURSOR: while active the host carries
// data-iw-zoom-mode="water|text" (+ data-iw-zoom-out when the last step zoomed out). Imperative
// data attributes survive unrelated React className writes; index.css maps them to
// cursor: zoom-in / zoom-out over the whole surface.

export type ZoomMode = 'water' | 'text'

export type WheelMomentumDecision =
  | { kind: 'plain' | 'zoom' }
  | { kind: 'discard'; interrupt: boolean }
  | { kind: 'coast'; scale: number }

export type ControlledCoastProfile = 'low' | 'medium' | 'fast'

const CONTROLLED_COAST_SCALE: Record<ControlledCoastProfile, readonly number[]> = {
  low: [0.50, 0.30, 0.16],
  medium: [0.30, 0.18, 0.10],
  fast: [0.18, 0.10, 0.05],
}

/** Trusted macOS trackpad events carry this Blink field even in Chrome builds where it is absent
 * from WheelEvent.prototype and synthetic WheelEventInit. Never infer it from timing/delta shape. */
export function wheelIsMomentum(event: unknown): boolean {
  return typeof event === 'object' && event !== null
    && (event as { momentum?: unknown }).momentum === true
}

/** Own a native momentum tail once it intersects zoom. This prevents post-lift inertia from
 * becoming either zoom (modifier still held) or ordinary page scroll (modifier released), while
 * the first next physical event re-arms immediately with no time gate. */
export function createWheelMomentumRouter() {
  let ownsTail = false
  let coastScale: readonly number[] | null = null
  let coastIndex = 0
  let discardingMomentum = false
  return {
    route(zoomRequested: boolean, momentum: boolean, coastProfile: ControlledCoastProfile | null = null): WheelMomentumDecision {
      if (zoomRequested) {
        const enteredFromUnownedMomentum = momentum && !ownsTail
        ownsTail = true
        if (!momentum) {
          coastScale = coastProfile ? CONTROLLED_COAST_SCALE[coastProfile] : null
          coastIndex = 0
          discardingMomentum = false
          return { kind: 'zoom' }
        }
        if (coastScale && coastIndex < coastScale.length)
          return { kind: 'coast', scale: coastScale[coastIndex++] }
        const interrupt = enteredFromUnownedMomentum && !discardingMomentum
        discardingMomentum = true
        return { kind: 'discard', interrupt }
      }
      if (momentum && ownsTail) return { kind: 'discard', interrupt: false }
      if (!momentum) {
        ownsTail = false
        coastScale = null
        coastIndex = 0
        discardingMomentum = false
      }
      return { kind: 'plain' }
    },
    reset(): void { ownsTail = false; coastScale = null; coastIndex = 0; discardingMomentum = false },
  }
}

/** Desktop text reflow is pinned to the line where people normally read, not to the pointer. */
export const READING_ZOOM_LINE_FRACTION = 0.25

/**
 * Pick the desktop text-reflow anchor. Near the beginning of a document there is too little
 * preceding text for a content anchor to be useful, so preserve the current top offset exactly;
 * farther down, pin the text line one quarter of the way down the viewport.
 */
export function readingZoomAnchor(viewTop: number, viewHeight: number, scrollTop: number): {
  y: number
  topLocked: boolean
} {
  const height = Number.isFinite(viewHeight) ? Math.max(0, viewHeight) : 0
  const top = Number.isFinite(viewTop) ? viewTop : 0
  const scroll = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  return {
    y: top + height * READING_ZOOM_LINE_FRACTION,
    topLocked: scroll <= height * READING_ZOOM_LINE_FRACTION,
  }
}

/** Keep a cursor zoom's focal point inside the surface it controls. */
export function cursorZoomAnchor(
  x: number,
  y: number,
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : (rect.left + rect.right) / 2
  const safeY = Number.isFinite(y) ? y : (rect.top + rect.bottom) / 2
  return {
    x: Math.min(rect.right, Math.max(rect.left, safeX)),
    y: Math.min(rect.bottom, Math.max(rect.top, safeY)),
  }
}

/**
 * Scroll position that places one stable page-local point back at its gesture-start viewport Y.
 * The returned value is deliberately NOT clamped: the browser may hit the top/bottom, but keeping
 * the stable local point lets an opposite step in the same gesture reconstruct the original
 * position instead of treating the clamped frame as a new anchor.
 */
export function anchoredScrollTarget(
  boxViewportTop: number,
  scrollTop: number,
  anchorViewportY: number,
  anchorLocalY: number,
  scale: number,
): number {
  if (![boxViewportTop, scrollTop, anchorViewportY, anchorLocalY, scale].every(Number.isFinite))
    return scrollTop
  const boxDocumentTop = boxViewportTop + scrollTop
  return boxDocumentTop - (anchorViewportY - anchorLocalY * scale)
}

/** Cooldown after the last zoom event before the gesture's mode (and cursor) release. */
export const ZOOM_LATCH_COOLDOWN_MS = 300

/** Natural pinch or Command reflows text; Shift selects whole-page magnify. */
export function zoomModeForWheel(
  input: Pick<WheelEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  canMagnify = true,
): ZoomMode | null {
  if (input.metaKey || input.ctrlKey) return 'text'
  if (input.shiftKey && canMagnify) return 'water'
  return null
}

/**
 * Shift deliberately removes direction dead-zones: whichever wheel axis carries more movement
 * becomes zoom direction and the full vector supplies magnitude. This accepts vertical,
 * horizontal and diagonal two-finger movement without guessing that the browser preserved deltaY.
 */
export function omnidirectionalZoomDelta(deltaX: number, deltaY: number): number {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return 0
  if (deltaX === 0 && deltaY === 0) return 0
  // Peter, 2026-09-06: Shift's VERTICAL axis is deliberately reversed while its horizontal axis
  // retains the established direction. Whichever axis dominates still supplies the direction, so
  // diagonal gestures remain decisive rather than falling into a dead zone.
  const primary = Math.abs(deltaY) >= Math.abs(deltaX) ? -deltaY : deltaX
  return Math.sign(primary) * Math.hypot(deltaX, deltaY)
}

/**
 * Trackpad pinches can arrive with both axes when the fingers approach on an angle. The browser's
 * deltaY still says IN versus OUT; fold a bounded amount of deltaX into its magnitude so diagonal
 * pinches do not feel dead, while a purely horizontal gesture (no scale direction at all) remains
 * ignored. The 2× bound prevents a sideways wobble from exploding into a huge zoom step.
 */
export function projectedZoomDelta(deltaX: number, deltaY: number): number {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || deltaY === 0) return 0
  const cross = Math.min(Math.abs(deltaX), Math.abs(deltaY) * 2)
  return Math.sign(deltaY) * Math.hypot(deltaY, cross)
}

/**
 * Text reflow shares one pipeline but has two inputs: a natural pinch keeps the browser's scale
 * direction, while Command/physical-Control scrolling reverses its vertical axis. A purely
 * horizontal residue retains its established direction because the requested reversal is up/down.
 */
export function textZoomDelta(deltaX: number, deltaY: number, naturalPinch: boolean): number {
  const vertical = projectedZoomDelta(deltaX, deltaY)
  if (vertical) return naturalPinch ? vertical : -vertical
  return Number.isFinite(deltaX) ? deltaX : 0
}

/**
 * One zoom-mode state holder per surface. `host()` resolves the element that carries the cursor classes
 * (resolved per call — refs may not be attached when the latch is constructed).
 */
export function createZoomLatch(host: () => HTMLElement | null) {
  let mode: ZoomMode | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastOut: boolean | undefined
  const clear = () => {
    mode = null
    lastOut = undefined
    if (timer) { clearTimeout(timer); timer = undefined }
    const el = host()
    el?.removeAttribute('data-iw-zoom-mode')
    el?.removeAttribute('data-iw-zoom-out')
    // Remove the former class state too so HMR cannot leave an old cursor behind.
    el?.classList.remove('iw-zooming-water', 'iw-zooming-text', 'iw-zoom-out')
  }
  return {
    /**
     * True when no gesture is currently latched (the NEXT `resolve()` call will be a fresh
     * gesture's first event). Callers that want to know "is this the very start of a gesture" —
     * e.g. to give the first committed zoom step a head start — must read this BEFORE calling
     * `resolve()`, since `resolve()` itself latches a mode on its first call.
     */
    isIdle(): boolean { return mode === null },
    /** The active mode before the next event; callers use this to reset mode-specific input state. */
    activeMode(): ZoomMode | null { return mode },
    /**
     * Resolve the mode for one zoom event immediately. A physical modifier keeps the session open
     * until key-up; a lone pinch re-arms the 0.3s idle release. Keeps the host's zoom-cursor
     * classes in sync (`zoomOut` = this event's direction).
     */
    resolve(compute: () => ZoomMode, zoomOut: boolean, modifierHeld = false): ZoomMode {
      const el = host()
      const next = compute()
      if (mode !== next) {
        mode = next
        lastOut = undefined
        el?.setAttribute('data-iw-zoom-mode', mode)
      }
      if (el && zoomOut !== lastOut) { el.toggleAttribute('data-iw-zoom-out', zoomOut); lastOut = zoomOut }
      if (timer) clearTimeout(timer)
      timer = modifierHeld ? undefined : setTimeout(clear, ZOOM_LATCH_COOLDOWN_MS)
      return mode
    },
    /** Unlatch immediately + drop the cursor classes (unmount cleanup). */
    dispose: clear,
  }
}
