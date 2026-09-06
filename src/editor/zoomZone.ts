// ─── Zoom gesture mode + latch — shared by Scroll.tsx + SnapshotView ──────────────────────────
//
// Peter, 2026-09-06: cursor position is no longer a mode. A natural trackpad pinch performs text
// reflow, and Shift makes ANY two-finger direction perform the same reflow; ⌘+scroll/pinch performs
// whole-page magnify. Ordinary unmodified two-finger scroll remains ordinary document scrolling.
// trackpads a reliable scroll-shaped zoom gesture when their native pinch recogniser rejects an
// angled two-finger movement, and the mode can never flip because the page moved under the cursor.
//
// MODE LATCH + COOLDOWN: the FIRST zoom event of a gesture picks the mode and it stays LOCKED
// until 0.3s after the LAST zoom event. A slow deliberate gesture must never flip between
// magnify and font-reflow mid-flight.
// The latch also owns the ZOOM CURSOR: while latched the host carries .iw-zooming-water /
// .iw-zooming-text (+ .iw-zoom-out when the last step zoomed out) — pure class toggles on
// latch boundaries + direction flips, no per-frame style writes; index.css maps them to
// cursor: zoom-in / zoom-out over the whole surface.

export type ZoomMode = 'water' | 'text'

/** Cooldown after the last zoom event before the gesture's mode (and cursor) release. */
export const ZOOM_LATCH_COOLDOWN_MS = 300

/** Natural pinch or Shift+two-finger movement reflows text; Command selects whole-page magnify. */
export function zoomModeForWheel(
  input: Pick<WheelEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  canMagnify = true,
): ZoomMode | null {
  if (input.metaKey && canMagnify) return 'water'
  if (input.ctrlKey || input.shiftKey) return 'text'
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
  const primary = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX
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
 * One latch per zoom surface. `host()` resolves the element that carries the cursor classes
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
    host()?.classList.remove('iw-zooming-water', 'iw-zooming-text', 'iw-zoom-out')
  }
  return {
    /**
     * True when no gesture is currently latched (the NEXT `resolve()` call will be a fresh
     * gesture's first event). Callers that want to know "is this the very start of a gesture" —
     * e.g. to give the first committed zoom step a head start — must read this BEFORE calling
     * `resolve()`, since `resolve()` itself latches a mode on its first call.
     */
    isIdle(): boolean { return mode === null },
    /**
     * Resolve the mode for one zoom event: the latched mode while a gesture is live, else
     * `compute()` fresh (and latch it). Re-arms the 0.3s cooldown and keeps the host's
     * zoom-cursor classes in sync (`zoomOut` = this event's direction).
     */
    resolve(compute: () => ZoomMode, zoomOut: boolean): ZoomMode {
      const el = host()
      if (mode === null) {
        mode = compute()
        el?.classList.add(mode === 'water' ? 'iw-zooming-water' : 'iw-zooming-text')
      }
      if (el && zoomOut !== lastOut) { el.classList.toggle('iw-zoom-out', zoomOut); lastOut = zoomOut }
      if (timer) clearTimeout(timer)
      timer = setTimeout(clear, ZOOM_LATCH_COOLDOWN_MS)
      return mode
    },
    /** Unlatch immediately + drop the cursor classes (unmount cleanup). */
    dispose: clear,
  }
}
