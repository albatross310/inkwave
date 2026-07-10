// ─── Zoom zone + gesture latch (Peter, 2026-07-10) — shared by Scroll.tsx + SnapshotView ──────
//
// ZONE GEOMETRY v2 — X-BASED: the text column's left/right edges are two imaginary vertical
// lines. Cursor x OUTSIDE them → WATER zoom (side water, the page's own side margins, and the
// parts of page gaps / bottom margins beyond the lines); x INSIDE them → PAGE/FONT zoom (text,
// bottom margins, gap regions within the column's x-range). y never enters the test — that's
// the whole point: gaps and bottom margins belong to the page WITHIN the column and to the
// water OUTSIDE it. The lines come from the LIVE `.ProseMirror` rect (the paper's content box
// minus its side padding — the sheet's padding IS the side margin, so the ProseMirror border
// box is exactly the text column and custom margins are respected by construction). gBCR under
// the magnify transform returns VISUAL px, so the comparison against clientX is exact at any
// scale — no conversion. The fallback (no ProseMirror yet) insets the paper rect by the
// configured side margin converted to visual px via scaleFor.
//
// MODE LATCH + COOLDOWN: the FIRST zoom event of a gesture picks the mode and it stays LOCKED
// until 0.5s after the LAST zoom event — regardless of cursor movement. (Replaces the old
// 8px-cursor-movement latch: zooming moves the page under a stationary cursor, and a slow
// deliberate notching gesture must never flip between magnify and font-reflow mid-flight.)
// The latch also owns the ZOOM CURSOR: while latched the host carries .iw-zooming-water /
// .iw-zooming-text (+ .iw-zoom-out when the last step zoomed out) — pure class toggles on
// latch boundaries + direction flips, no per-frame style writes; index.css maps them to
// cursor: zoom-in / zoom-out over the whole surface.

import { getSideMarginPx } from './pageSettings'
import { scaleFor } from './magnify'

export type ZoomMode = 'water' | 'text'

/** Cooldown after the last zoom event before the gesture's mode (and cursor) release. */
export const ZOOM_LATCH_COOLDOWN_MS = 500

/**
 * The x-line rule: is `clientX` outside the text column of the (first) paper under `root`?
 * `root` is any ancestor of the paper — the live editor surface or the snapshot doc pane.
 */
export function isWaterAtX(root: HTMLElement, clientX: number): boolean {
  const pm = root.querySelector<HTMLElement>('.ProseMirror')
  if (pm) {
    const r = pm.getBoundingClientRect()
    if (r.width > 0) return clientX < r.left || clientX > r.right
  }
  // No ProseMirror yet (mid-mount) — inset the paper by the configured side margin instead.
  const paper = root.querySelector<HTMLElement>('.scroll-paper')
  if (!paper) return false
  const r = paper.getBoundingClientRect()
  const pad = getSideMarginPx() * scaleFor(paper)
  return clientX < r.left + pad || clientX > r.right - pad
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
     * Resolve the mode for one zoom event: the latched mode while a gesture is live, else
     * `compute()` fresh (and latch it). Re-arms the 0.5s cooldown and keeps the host's
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
