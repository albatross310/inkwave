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
/** Real DOM elements have this; unit-test fakes for every OTHER target don't need to. */
export interface ClassListLike { classList?: { toggle(name: string, force?: boolean): boolean } }

export interface CanonicalTargets {
  /** The mm-width parchment div (sheet.parentElement in Scroll.tsx) — phone renders it fluid. */
  paper?: ElementLike | null
  /** .scroll-paper — its side padding IS the text margin (phone renders a slim 1.25rem). */
  sheet?: ElementLike | null
  /** .inkwave-editor-surface — carries --iw-editor-zoom (Ctrl+wheel / pinch) and --iw-magnify. */
  surface?: (ElementLike & ClassListLike) | null
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
  // Defensive: any transient transform on the paper (gesture effects, future previews) must never
  // leak VISUAL-scaled rects into a measure — force it untransformed, restored exactly.
  set(targets.paper, 'transform', 'none')
  set(targets.sheet, 'padding-left', `${geom.sideMarginPx}px`)
  set(targets.sheet, 'padding-right', `${geom.sideMarginPx}px`)
  set(targets.surface, '--iw-editor-zoom', '1')
  set(targets.surface, '--iw-magnify', '1') // canonical implies scale=1 (hybrid-zoom branches)
  // ⚠ 2026-08-20 — THE `iw-magnified` CLASS GATES --iw-magnify'S CSS EFFECT AND IS A SEPARATE PIECE
  // OF STATE (index.css: `.iw-magnified .iw-magnify-box > div { transform: scale(var(--iw-magnify)) }`
  // — gated on the class, deliberately, so scale=1 renders with NO transform at all rather than a
  // no-op scale(1), which would still open a new containing-block/stacking-context). Scroll.tsx's own
  // `apply()` keeps class and variable in lockstep — but ONLY on its OWN writes. The reveal chain
  // mounts THREE separate `<Scroll fill>` instances in sequence (LoadingVeil, Edit.tsx's shell,
  // TiptapEditor's real editor) and each one's layoutEffect cleanup unconditionally strips the class
  // from ITS OWN surface node on teardown — reproduced live: the class can end up removed with
  // nothing re-adding it, while THIS function's restore (below) puts the CSS VARIABLE back exactly
  // right regardless, since it never touched the class at all. The visible result: every number is
  // correct (0.5695, matching the fit-to-width ratio) and the page simply never visually shrinks —
  // "the zoom snap doesn't work" from the outside. Fixed HERE rather than chasing the exact mount
  // that drops the class: this module runs on every pagination pass (load, every edit needing
  // re-measure — frequent), so keeping the class synced to the variable on every force AND every
  // restore self-heals the visible state regardless of what caused the drift, without polluting the
  // pure capture/set/restore contract for callers that pass a non-DOM fake (ClassListLike is optional
  // and duck-typed; a fake target with no classList is untouched, so existing unit tests are unaffected).
  targets.surface?.classList?.toggle('iw-magnified', false) // canonical window: always scale=1, never magnified
  set(targets.editor, 'font-size', CANONICAL_FONT_SIZE)
  // LIVE-REFLOW WINDOW invariant (Peter's lazy off-screen pinch, 2026-07-10): if a zoom gesture's
  // content-visibility window were ever active during a measure, skipped blocks would report
  // collapsed rects. --iw-cv inherits into `.iw-zoom-live > *` (index.css reads it via var()),
  // so forcing it on the editor makes every block fully laid out for the window — break
  // measurement (and the step cache's hypothetical reflows, which run through this same context
  // owner's var conventions) always sees true geometry.
  set(targets.editor, '--iw-cv', 'visible')
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (let i = saved.length - 1; i >= 0; i--) {
      const { el, prop, value } = saved[i]
      if (value) el.style.setProperty(prop, value)
      else el.style.removeProperty(prop)
    }
    // Restore the class to match whatever --iw-magnify was actually put back to (its captured
    // value, or removed entirely — either way this reads it back off the style rather than
    // re-deriving from `saved`, so it's correct regardless of restore order). See the force-time
    // comment above for why this class needs restoring at all.
    const v = parseFloat(targets.surface?.style.getPropertyValue('--iw-magnify') || '') || 1
    targets.surface?.classList?.toggle('iw-magnified', v !== 1)
  }
}
