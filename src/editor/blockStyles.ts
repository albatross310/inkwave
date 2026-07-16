// BLOCK STYLE HARVEST (2026-07-16 — the coverage unlock for headings + lists).
//
// WHY. The text renderer can only own a block whose HEIGHT it can compute. For a paragraph that's
// arithmetic (canvas advances + greedy wrap). For a heading or a list item it needs three facts CSS
// owns — the font it sets in, its margins, and its indent — and there is no honest way to guess them:
// a heading estimated at 120px instead of its real ~40px does not merely look wrong, IT MOVES EVERY
// PAGE BREAK BELOW IT. Measured 2026-07-16: with headings/lists estimated, the first break landed at
// 2075 vs the live editor's 2344 on a citation-heavy doc, while a prose-only doc was byte-identical.
// Wrong pages reported as right is the exact disease this codebase keeps catching.
//
// THE DISCIPLINE (same as citeBox / the font-certification table): measure ONCE from real rendered
// elements, cache by an immutable key, never re-measure on a normal render. A key that isn't cached
// returns null ⇒ the caller DEFERS that block to a labelled placeholder and marks the model's breaks
// unreliable. We never invent a height.
//
// WHY A TYPE KEY, NOT A NODE KEY. The established block-geometry cache (collectLines) is a WeakMap on
// PM NODE IDENTITY, which is right for the LIVE doc — but this renderer's whole purpose is drawing
// OTHER VERSIONS (snapshots), whose nodes are different objects entirely. What those versions share
// with the live doc is the CSS: an `h2` in version 3 sets in the same font as an `h2` today. So the
// key is the block TYPE (+ level + measurement base), which makes one harvest serve every version —
// and it stays correct because the harvest is re-run whenever the canonical context changes.
//
// NOT A FICTION. These are harvested from REAL rendered nodes in the live .ProseMirror, never from a
// detached probe element. A probe element inside .ProseMirror is precisely how
// canvasShapingMatchesEditor died (it inherited the zoom window's content-visibility, parked
// off-screen, and measured 177px against a true 1186px). If the live doc contains no h3, we do not
// synthesise one — h3 simply stays unharvested and any block using it defers.

export interface BlockStyle {
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  italic: boolean
  marginTopPx: number
  marginBottomPx: number
  lineHeightRatio: number // computed line-height ÷ font-size — headings often differ from body φ
  indentPx: number        // list padding-inline-start (0 for headings)
  paddingTopPx: number    // the refList wrapper's paddingTop (its rule above the entries)
  borderTopPx: number     // ditto its 1px rule — small, but it is real height
}

const cache = new Map<string, BlockStyle>()
const dbg = { harvested: 0, hits: 0, misses: 0, size: 0, keys: [] as string[] }
if (typeof window !== 'undefined') (window as unknown as { __iwBlockStyles?: unknown }).__iwBlockStyles = dbg

/** Drop everything — the canonical CONTEXT changed (fonts loaded, page settings, paper, zoom). */
export function clearBlockStyles(): void { cache.clear(); dbg.size = 0; dbg.keys = [] }

function keyOf(kind: string, basePx: number): string { return `${kind}|${basePx}` }

/** Cached style, or null ⇒ the caller MUST defer this block (placeholder + breaksReliable false). */
export function blockStyle(kind: string, basePx: number): BlockStyle | null {
  const r = cache.get(keyOf(kind, basePx)) ?? null
  if (r) dbg.hits++; else dbg.misses++
  return r
}

function readStyle(el: HTMLElement): BlockStyle | null {
  const cs = getComputedStyle(el)
  const fontSizePx = parseFloat(cs.fontSize)
  if (!(fontSizePx > 0)) return null
  const lh = parseFloat(cs.lineHeight)
  return {
    fontFamily: cs.fontFamily,
    fontSizePx,
    // Computed font-weight is a number string ('400'/'700'); 'bold' never survives getComputedStyle.
    fontWeight: parseInt(cs.fontWeight, 10) || 400,
    italic: cs.fontStyle === 'italic',
    marginTopPx: parseFloat(cs.marginTop) || 0,
    marginBottomPx: parseFloat(cs.marginBottom) || 0,
    // A `normal` line-height has no number — fall back to the body ratio rather than invent one.
    lineHeightRatio: Number.isFinite(lh) && fontSizePx > 0 ? lh / fontSizePx : 1.618,
    indentPx: parseFloat(cs.paddingInlineStart) || 0,
    paddingTopPx: parseFloat(cs.paddingTop) || 0,
    borderTopPx: parseFloat(cs.borderTopWidth) || 0,
  }
}

/**
 * Harvest block styles from the live editor's REAL rendered nodes. Call from inside the DOM canonical
 * measure (the one context where a rendered value IS the canonical value), the same way
 * harvestCiteBoxes rides it — it costs one getComputedStyle per distinct kind, not per node.
 *
 * Only kinds actually PRESENT in the live DOM are harvested. An absent kind stays absent (⇒ defers)
 * rather than being synthesised from a fabricated element.
 */
export function harvestBlockStyles(root: HTMLElement, basePx: number): void {
  const want: Array<[string, string]> = [
    ['heading:1', 'h1'], ['heading:2', 'h2'], ['heading:3', 'h3'],
    ['heading:4', 'h4'], ['heading:5', 'h5'], ['heading:6', 'h6'],
    ['bulletList', 'ul:not([data-type="taskList"])'], ['orderedList', 'ol'],
    ['listItemPara', 'li > p'],
    ['blockquote', 'blockquote'],
    // ── referenceList sub-styles (2026-07-17) ────────────────────────────────────────────────
    // Harvested from the REAL rendered bibliography rather than re-deriving its ems by hand: the
    // wrapper is 2.5em/1em/1px-border, the header row 0.6em, the body 0.92em/1.38, each entry
    // 0.6em — nested ems that resolve against DIFFERENT bases (an entry's 0.6em is 0.6 x 16.56,
    // the header's is 0.6 x 18). Hand-computing that chain is exactly how a height becomes a guess.
    // ⚠ `.node-referenceList` is the REACT-RENDERER DIV, not the styled box. MEASURED 2026-07-17:
    // it computes marginTop/paddingTop/borderTop = 0/0/0, while the NodeViewWrapper `<section>`
    // INSIDE it carries the real 45px/18px/1px (2.5em/1em/1px). Harvesting the wrapper from the
    // outer div therefore read three zeros and called them the refList's box — a silent −64px. The
    // section is the element with the box, so the section is what we harvest.
    ['refList:wrap', '.node-referenceList > section'],
    ['refList:h2', '.node-referenceList h2'],
    // The header ROW is the h2's flex parent (its own 0.6em margin-bottom spaces the list); the h2
    // is a different element with a different font size. They were the SAME selector, so the row's
    // margin-bottom silently read as the h2's (0px) — the row is the parent, not the heading, and
    // it now carries `iw-bib-header` precisely so it can be selected.
    ['refList:headerRow', '.node-referenceList .iw-bib-header'],
    ['refList:body', '.node-referenceList .csl-bib-body'],
    ['refList:entry', '.node-referenceList .iw-bib-entry'],
  ]
  for (const [kind, sel] of want) {
    const key = keyOf(kind, basePx)
    if (cache.has(key)) continue
    let el: HTMLElement | null = null
    try { el = root.querySelector(sel) as HTMLElement | null } catch { el = null }
    if (!el) continue
    // An element with no box (display:none, not yet laid out) would harvest zeros — skip, defer.
    if (!el.getClientRects().length) continue
    const s = readStyle(el)
    if (!s) continue
    cache.set(key, s)
    dbg.harvested++; dbg.size = cache.size
    if (!dbg.keys.includes(kind)) dbg.keys.push(kind)
  }
}
