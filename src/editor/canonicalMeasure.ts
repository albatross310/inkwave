// The CANONICAL measurement context — force the live editor DOM into the ONE reference layout
// (true mm paper width, desktop print side margins, editor zoom 1, the 1.125rem base font) for the
// duration of a page-break measure, then restore it exactly. Breaks measured here are DOCUMENT
// positions independent of device width and editor zoom: the same words land on page N on an
// iPhone, on a zoomed desktop, and in the printed PDF. Live zoom / phone width then affect
// rendering only (the break widgets ride their document positions through any reflow).
//
// Pure over structural types (no DOM import) so the capture/set/restore contract is unit-testable
// without a browser — PaginationExtension passes the real elements.

// The desktop .ProseMirror base font (index.css: calc(1.125rem * var(--iw-editor-zoom, 1))).
// Forcing it INLINE defeats both the zoom var and the phone's ×1.25 media-query boost in one move
// (inline style beats every stylesheet rule). Custom font-size marks stay proportional (em-based).
export const CANONICAL_FONT_SIZE = '1.125rem'

export interface StyleLike {
  getPropertyValue(name: string): string
  setProperty(name: string, value: string): void
  removeProperty(name: string): string
}
export interface ElementLike { style: StyleLike }

export interface CanonicalTargets {
  /** The mm-width parchment div (sheet.parentElement in Scroll.tsx) — phone renders it fluid. */
  paper?: ElementLike | null
  /** .scroll-paper — its side padding IS the text margin (phone renders a slim 1.25rem). */
  sheet?: ElementLike | null
  /** .inkwave-editor-surface — carries --iw-editor-zoom (Ctrl+wheel / pinch) and --iw-magnify. */
  surface?: ElementLike | null
  /** .ProseMirror (view.dom) — the font-size target. */
  editor?: ElementLike | null
}

export interface CanonicalGeometry {
  pageWidthPx: number   // pageModel's canonical mm→px width for the current paper/orientation
  sideMarginPx: number  // desktop getSideMarginPx() — the print margins
}

/**
 * Capture the touched inline styles, set the canonical ones, and return a restore function that
 * puts every captured value back EXACTLY (removing properties that were unset). Idempotent —
 * calling the restore twice is a no-op. Callers must keep set → measure → restore synchronous
 * (one task, no awaits) so the forced layout never paints.
 */
export function forceCanonicalContext(targets: CanonicalTargets, geom: CanonicalGeometry): () => void {
  const saved: Array<{ el: ElementLike; prop: string; value: string }> = []
  const set = (el: ElementLike | null | undefined, prop: string, value: string) => {
    if (!el) return
    saved.push({ el, prop, value: el.style.getPropertyValue(prop) })
    el.style.setProperty(prop, value)
  }
  set(targets.paper, 'width', `${geom.pageWidthPx}px`)
  set(targets.sheet, 'padding-left', `${geom.sideMarginPx}px`)
  set(targets.sheet, 'padding-right', `${geom.sideMarginPx}px`)
  set(targets.surface, '--iw-editor-zoom', '1')
  set(targets.surface, '--iw-magnify', '1') // canonical implies scale=1 (hybrid-zoom branches)
  set(targets.editor, 'font-size', CANONICAL_FONT_SIZE)
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (let i = saved.length - 1; i >= 0; i--) {
      const { el, prop, value } = saved[i]
      if (value) el.style.setProperty(prop, value)
      else el.style.removeProperty(prop)
    }
  }
}
