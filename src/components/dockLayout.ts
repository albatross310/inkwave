// THE DOCK — one set of rules for every panel that sits beside the writing.
//
// Peter, 2026-08-28: "can you get it to open in the side or below with same width and placing as
// the pdf reader?" The only way to make "the same" true rather than nearly-true is to make it the
// SAME RULES: this module owns the orientation choice, the persisted preferences, the panel's
// geometry and the room it carves out of the editor, and BOTH the PDF viewer and the source reader
// read from it. A second copy of these numbers is how the two panels would drift apart the first
// time one of them was tuned — the failure this codebase has documented in pmToText/textMap, in the
// three copies of the page-break rule, and in the two copies of the line filter.
//
// Everything here is PURE except `applyDockRoom`, which writes the four CSS variables the editor
// surface and the floating chrome already read. Pure, so the geometry can be asserted without a
// browser; shared, so it cannot diverge.

export type DockOrientation = 'bottom' | 'side' | 'top'
export type DockSide = 'left' | 'right'

export const DOCK_MIN_W = 320
export const DOCK_MIN_H = 200
/** ⚠ THE KEYS ARE SHARED ON PURPOSE. Peter asked for the reader to open where the PDF opens; a
 *  separate key would make that true only until he moved one of them. */
export const DOCK_ORIENT_KEY = 'inkwave:pdfPanelOrientation'
export const DOCK_SIDE_KEY = 'inkwave:pdfDockSide'
/** Phone top dock height: dvh tracks iOS's dynamic URL bar (vh fallback for old WebKit). */
export const PHONE_TOP_H =
  typeof CSS !== 'undefined' && CSS.supports?.('height', '50dvh') ? '50dvh' : '50vh'
/** Wide enough to put a panel beside the page rather than under it. */
export const WIDE_QUERY = '(min-width: 1024px)'

/**
 * Wide enough for the reader's 220px section COLUMN. Tailwind's `md`, but stated once here because
 * it now has TWO consumers: the column itself, and the tap-to-open section list that stands in for
 * it below this width. It was a bare `hidden md:flex` and the fallback keyed off `isPhone`
 * (pointer: coarse) — two rules that nearly agree and disagree exactly in the gap that matters, a
 * narrow DESKTOP window, where the column is hidden and the device is not a phone, so there was no
 * route to the sections at all. Same shape as the footer's `--iw-bar-budget`: one constant, two
 * consumers, because two constraints computed from nearly-the-same number is what produces a dead
 * range where neither holds.
 */
export const NAV_COLUMN_QUERY = '(min-width: 768px)'

/**
 * PHONE = TOP dock, always (panel above, editor in the bottom half). A non-touch narrow window
 * keeps the bottom dock; only a wide screen honours the stored bottom/side preference.
 */
export function resolveOrientation(isPhone: boolean, isWide: boolean, stored: 'bottom' | 'side'): DockOrientation {
  if (isPhone) return 'top'
  return isWide ? stored : 'bottom'
}

export type DockRoom = { right: string; left: string; bottom: string; top: string }

/**
 * The space the editor must give up. FULLSCREEN never squeezes — the pane COVERS the editor, so its
 * layout (and the reading line the scroll anchor holds) is untouched.
 */
export function dockRoom(o: {
  open: boolean; fullscreen: boolean; orientation: DockOrientation
  dockSide: DockSide; width: number; height: number
}): DockRoom {
  const none: DockRoom = { right: '0px', left: '0px', bottom: '0px', top: '0px' }
  if (!o.open || o.fullscreen) return none
  if (o.orientation === 'top') return { ...none, top: PHONE_TOP_H }
  if (o.orientation === 'side') {
    return o.dockSide === 'left'
      ? { ...none, left: `${o.width}px` }
      : { ...none, right: `${o.width}px` }
  }
  return { ...none, bottom: `${o.height}px` }
}

/** Write the room onto the document root. The ONLY impure function here. */
export function applyDockRoom(room: DockRoom): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--iw-pdf-room', room.right)
  root.style.setProperty('--iw-pdf-room-left', room.left)
  root.style.setProperty('--iw-pdf-room-bottom', room.bottom)
  root.style.setProperty('--iw-pdf-room-top', room.top)
}

export const NO_DOCK_ROOM: DockRoom = { right: '0px', left: '0px', bottom: '0px', top: '0px' }

/** Where the panel itself sits. Returned as a plain style object so it can be asserted directly. */
export function dockPanelPos(o: {
  orientation: DockOrientation; dockSide: DockSide; width: number; height: number
  fullscreen?: boolean; fullscreenWidth?: number
}): Record<string, string | number> {
  // ⚠ THE DIVIDING LINE PETER ASKED FOR ALREADY EXISTED — as a literal, and it was invisible in the
  // theme that needed it (2026-08-30: "make sure … there's a dividing line between"). `#5c2d8a33` is
  // a 20%-alpha DARK purple: over cream it reads as a faint edge, over the night panel it composites
  // to very nearly the panel itself, so a docked reader butted onto the night editor with nothing
  // between them. It is a token now, and the night value is a LIGHT grey-blue.
  // NB `.iw-nightable { border-color: … !important }` would otherwise beat this inline value — the
  // `.iw-dock-panel` rule in index.css is what lets the token win at night. A panel using this
  // MUST carry that class, or its divider silently reverts to the chrome border colour.
  const border = '1px solid var(--iw-reader-divider, #cfc7dc)'
  if (o.fullscreen) {
    return { top: 0, bottom: 0, left: '50%', width: o.fullscreenWidth ?? 800, transform: 'translateX(-50%)',
      borderRadius: 0, borderLeft: border, borderRight: border, boxShadow: '0 14px 52px rgba(0,0,0,0.35)', overflow: 'hidden' }
  }
  if (o.orientation === 'top') {
    return { top: 0, left: 0, right: 0, height: PHONE_TOP_H, paddingTop: 'env(safe-area-inset-top)',
      borderBottom: border, boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }
  }
  if (o.orientation === 'side') {
    return o.dockSide === 'left'
      ? { top: 0, left: 0, bottom: 0, width: o.width, maxWidth: '100vw', borderRight: border, boxShadow: '4px 0 24px rgba(0,0,0,0.18)' }
      : { top: 0, right: 0, bottom: 0, width: o.width, maxWidth: '100vw', borderLeft: border, boxShadow: '-4px 0 24px rgba(0,0,0,0.18)' }
  }
  return { left: 0, right: 0, bottom: 0, height: o.height, maxHeight: '92vh', borderTop: border, boxShadow: '0 -4px 24px rgba(0,0,0,0.18)' }
}

/** The resize handle rides the panel's INNER edge — the one facing the editor. */
export function dockHandlePos(orientation: DockOrientation, dockSide: DockSide): Record<string, string | number> {
  return orientation === 'side'
    ? { ...(dockSide === 'left' ? { right: 0 } : { left: 0 }), top: 0, bottom: 0, width: 10, cursor: 'col-resize' }
    : { left: 0, right: 0, top: 0, height: 10, cursor: 'row-resize' }
}

/** Clamp a drag to the minimums, in the axis the orientation actually resizes. */
export function dockResize(axis: 'x' | 'y', startSize: number, delta: number): number {
  return axis === 'x' ? Math.max(DOCK_MIN_W, startSize + delta) : Math.max(DOCK_MIN_H, startSize + delta)
}

export function readStoredOrientation(): 'bottom' | 'side' {
  try { return localStorage.getItem(DOCK_ORIENT_KEY) === 'side' ? 'side' : 'bottom' } catch { return 'bottom' }
}
export function writeStoredOrientation(v: 'bottom' | 'side'): void {
  try { localStorage.setItem(DOCK_ORIENT_KEY, v) } catch { /* private mode */ }
}
export function readStoredDockSide(): DockSide {
  try { return localStorage.getItem(DOCK_SIDE_KEY) === 'left' ? 'left' : 'right' } catch { return 'right' }
}
export function writeStoredDockSide(v: DockSide): void {
  try { localStorage.setItem(DOCK_SIDE_KEY, v) } catch { /* private mode */ }
}

// ── "Click a citation to read the source here" ───────────────────────────────────────────────────
// Peter, 2026-08-28: "make a tick box on the refs panel to turn on click to view in browser. And
// make it just on click not click and hold plus read here." OFF by default, because a plain click
// currently opens the PDF panel and silently changing what a click does to someone's citations is
// not ours to decide — the tick box is where they decide it.
// ⚠ DEFAULT ON (Peter, 2026-08-28, twice: "make it just on click not click and hold plus read
// here", then "what I mean is no click and hold. Just click the main text of the link should go
// there"). I shipped it default-OFF on the reasoning that changing what a click does to someone's
// citations is not ours to decide — which is right in general and wrong here, because HE decided,
// and then had to say so again. The tick box stays: it is how you turn it back off, and it is what
// makes the default a choice rather than an imposition.
// A source with a PDF attached still opens the PDF: that is the reader you chose for it, and
// it is the one that can see your selection. The web page is the fallback, not the override.
const CLICK_READER_KEY = 'inkwave:citeClickOpensReader'
export function citeClickOpensReader(): boolean {
  try { return localStorage.getItem(CLICK_READER_KEY) !== '0' } catch { return true }
}
export function setCiteClickOpensReader(v: boolean): void {
  try { localStorage.setItem(CLICK_READER_KEY, v ? '1' : '0') } catch { /* private mode */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('inkwave:cite-click-pref'))
}
