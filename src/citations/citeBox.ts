// CITATION OPAQUE-BOX CACHE (2026-07-16 — the citation-eligibility unlock, Peter's own call).
//
// WHY THIS EXISTS. The arithmetic layout engine can only own a block when every element in it
// supplies a box from a source needing NO per-pagination reflow. A citation label had none: it is a
// React NodeView whose text resolves from the bibliography (unresolved → resolved on hydration) and
// re-renders on a CSL style switch, and — the real blocker — its `[contenteditable=false]` subtree
// runs in `white-space: normal` (PM's injected sheet) while the body text around it is
// `break-spaces`, so its label FLOWED IN THE PARENT'S LINE under a different wrap rule. Every
// citation-bearing paragraph therefore deferred to the full DOM reflow — which on Peter's thesis
// (174 citations) meant the arithmetic path never engaged at all.
//
// CitationNodeView now pins `white-space: nowrap` on that subtree, so the label has NO internal
// break opportunity: the parent line can only break BEFORE or AFTER it. That makes it a genuinely
// OPAQUE INLINE BOX — one unbreakable advance — and an opaque box is measurable ONCE and cached.
//
// THE DISCIPLINE (same as the font-certification table / the math box): measure once, cache by an
// IMMUTABLE key, never re-measure on a normal pagination. The box is harvested during a DOM
// CANONICAL measure — the only context where the rendered width IS the canonical width (the arith
// path deliberately skips forceCanonicalContext, so it can never measure a canonical rect itself) —
// and the harvest rides that measure's existing layout, costing one getBoundingClientRect per node.
//
// SELF-HEALING BY CONSTRUCTION: a key that isn't cached (new citekey, bibliography hydration, style
// switch) returns null ⇒ that block DEFERS to the DOM measure ⇒ that measure harvests the box ⇒ the
// next measure is arithmetic. We never guess a width that is about to change.

import type { Node as PMNode } from '@tiptap/pm/model'

export interface CiteInlineBox { advanceWidth: number; lineHeightDemand: number }

// key = citekeys + CSL style + hydration epoch + the node's own FONT SIGNATURE. The first three
// change the label's TEXT; the fourth changes the glyphs it is set in. Real citations DO carry marks
// (Peter's thesis: a textStyle{fontFamily} mark on ~all 174 of them — an early "marked ⇒ skip" gate
// silently skipped 216/218 and the arith path never engaged), and the label renders `font: inherit`,
// so a marked citation's advance is genuinely different. Keying on it lets marked citations cache
// CORRECTLY instead of deferring, while a font the box wasn't measured at simply misses ⇒ defers.
export function citeFontKey(marks: readonly { type: { name: string }; attrs?: Record<string, unknown> }[]): string {
  let fam = '', size = '', weight = '', ital = ''
  for (const m of marks || []) {
    if (m.type.name === 'bold') weight = 'b'
    else if (m.type.name === 'italic') ital = 'i'
    else if (m.type.name === 'textStyle' && m.attrs) {
      if (m.attrs.fontFamily) fam = String(m.attrs.fontFamily)
      if (m.attrs.fontSize) size = String(m.attrs.fontSize)
    }
  }
  return `${fam}/${size}/${weight}${ital}`
}

function keyOf(citekeys: readonly string[], style: string, epoch: number, fontKey: string): string {
  return `${citekeys.join(';')}|${style}|${epoch}|${fontKey}`
}

const cache = new Map<string, CiteInlineBox>()
// debug counters (window.__iwCiteBox) — zero cost, read by probes
const dbg = { harvested: 0, skippedNoRect: 0, skippedMarked: 0, hits: 0, misses: 0, size: 0 }
if (typeof window !== 'undefined') (window as unknown as { __iwCiteBox?: unknown }).__iwCiteBox = dbg

/** Drop everything — the canonical CONTEXT changed (fonts loaded, page settings, paper). */
export function clearCiteBoxes(): void { cache.clear() }

/** Cached box for this citation, or null ⇒ the caller MUST defer the block to the DOM measure. */
export function citeBox(citekeys: readonly string[], style: string, epoch: number, fontKey: string): CiteInlineBox | null {
  const r = cache.get(keyOf(citekeys, style, epoch, fontKey)) ?? null
  if (r) dbg.hits++; else dbg.misses++
  return r
}

/**
 * Harvest one citation's box from its RENDERED node. MUST be called inside a forced canonical
 * context (otherwise the rect is the render width, not the canonical one). No-op when already
 * cached, so a warm doc pays nothing.
 *
 * The advance is the label's MARGIN box: the inner span carries `margin: 0 2px` (kept outside the
 * hit box so a click beside a citation lands the caret — see CitationNodeView), and inline margins
 * contribute to the line's advance while getBoundingClientRect returns only the border box.
 */
export function harvestCiteBox(dom: HTMLElement, citekeys: readonly string[], style: string, epoch: number, fontKey: string): void {
  const key = keyOf(citekeys, style, epoch, fontKey)
  if (cache.has(key)) return
  // The NodeViewWrapper is a bare display:inline span; the label (and its margins) live on the
  // contentEditable=false child.
  const inner = (dom.querySelector('[contenteditable="false"]') as HTMLElement | null) ?? dom
  const r = inner.getBoundingClientRect()
  if (!(r.width > 0) || !(r.height > 0)) { dbg.skippedNoRect++; return } // not rendered/hydrated ⇒ defer
  const cs = getComputedStyle(inner)
  const advanceWidth = r.width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0)
  cache.set(key, { advanceWidth, lineHeightDemand: r.height })
  dbg.harvested++; dbg.size = cache.size
}

/**
 * Walk the doc's citation nodes and harvest each box. Call from the DOM canonical measure, AFTER
 * its line collection (so it rides the same layout pass). `nodeDOM` is view.nodeDOM.
 *
 * A marked citation is harvested under its own font key (see citeFontKey) — its label inherits the
 * mark's font, so it is a DIFFERENT box, not an unmeasurable one. An unresolved/unrendered label
 * (zero rect) stays uncached ⇒ its block defers.
 */
export function harvestCiteBoxes(
  doc: PMNode,
  nodeDOM: (pos: number) => Node | null,
  style: string,
  epoch: number,
): void {
  doc.descendants((node, pos) => {
    if (node.type.name !== 'citation') return true
    const el = nodeDOM(pos)
    if (el && el.nodeType === 1) harvestCiteBox(el as HTMLElement, (node.attrs.citekeys as string[]) ?? [], style, epoch, citeFontKey(node.marks))
    return false
  })
}
