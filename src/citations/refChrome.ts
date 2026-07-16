// REFERENCE-LIST CHROME BOXES (2026-07-17) — the citeBox treatment, applied to the bibliography's
// non-text furniture.
//
// WHAT THE CHROME IS. ReferenceListNodeView injects three things into each rendered entry that
// citeproc never emitted: the `↩ 4 5.1` back-reference group, an `esp. pp 2, 4–6` span, and the
// `+`/`✎` note button. None is prose and none may be shaped as text.
//
// WHY THEY CANNOT SIMPLY BE OMITTED. "Honest omission" is available for a GLYPH; it is not available
// for a BOX. Measured in the real app (reflistcensus.mjs), the note button is a `<button>` with its
// own border+padding standing 17.73px tall on a 22.85px line — it RAISES that line to 26.28px, so a
// 2-line entry is 49.13px, not the 45.71px its line-height implies. Drop the button and every entry
// loses 3.42px; over a 14-entry bibliography that is ~48px of silent drift, and a wrong height moves
// every break below it. The back-ref group is worse: it is `white-space: nowrap` and 35-100px wide,
// so removing it can pull a whole line back. So: we omit the DRAWING, and we keep the BOX.
//
// WHY IT IS HARVESTED AND NOT COMPUTED. Each of these is a composite of CSS this module does not
// own: a button's border+padding, `.iw-cite-link`'s `padding: 0 0.22em`, `.iw-backref-arrow`'s
// 1.15em, `.iw-backref-quote`'s 0.86em italic. Re-deriving that chain by hand is exactly how
// blockStyles.ts's preamble says a height becomes a guess. So the box is MEASURED once from the real
// rendered element and cached by an immutable key — the same discipline, and the same self-healing
// contract, as citeBox: a key that isn't cached returns null ⇒ the caller DEFERS.
//
// THE KEY, and the trap it exists to avoid. A back-ref group reads `↩ 4 5.1` — those are DOCUMENT
// PAGE NUMBERS, and `occurrencePages` gets them by `document.getElementById(...)` + `docPageOf`,
// i.e. from the LIVE DOM's own pagination widgets. So this chrome is NOT a function of
// (entries, style, epoch) the way a citeBox is: it is a function of THE WHOLE DOCUMENT'S PAGINATION.
// Two different versions of a thesis share their citekeys and their CSL style, and their back-refs
// still differ, because the citations sit on different pages.
//
// Therefore the key is scoped to the DOCUMENT VERSION the chrome was harvested from — a WeakMap on
// the PM doc node (persistent structures: same reference ⇔ unchanged content, the same identity rule
// collectLines' line cache uses). Keying on citekey alone would have been the disaster: every
// snapshot version shares the live doc's citekeys, so every lookup would HIT the live document's
// chrome and hand a different version a confidently wrong height — a cache that cannot miss is the
// bake counter reporting 116/116 while every lookup was wrong. Here a version we have not rendered
// MISSES and defers, which is the true answer: we have not measured that version's chrome, so we do
// not know its height.

import type { CiteInlineBox } from './citeBox'
import type { Node as PMNode } from '@tiptap/pm/model'

export type ChromeKind = 'backref' | 'esp' | 'note'

// key = kind + the entry's citekey + the measurement base. The base joins the key for the same
// reason it joins citeBox's: these boxes inherit `em` sizes from the entry's font, so a box measured
// at the canonical 18px base is not the box at the phone's 22.5px render base. The DOC is the outer
// key (the WeakMap), not part of this string.
function keyOf(kind: ChromeKind, citekey: string, basePx: number): string {
  return `${kind}|${citekey}|${basePx}`
}

// doc → its own chrome boxes. WeakMap so a superseded version's boxes are collected with it.
const byDoc = new WeakMap<PMNode, Map<string, CiteInlineBox>>
const dbg = { harvested: 0, skippedNoRect: 0, hits: 0, misses: 0, docs: 0, entries: 0 }
if (typeof window !== 'undefined') (window as unknown as { __iwRefChrome?: unknown }).__iwRefChrome = dbg

/**
 * Cached box for this entry's chrome IN THIS DOCUMENT VERSION, or null ⇒ the caller MUST defer the
 * refList. A box harvested from another version is NOT a match — see the key note above.
 */
export function refChromeBox(doc: PMNode, kind: ChromeKind, citekey: string, basePx: number): CiteInlineBox | null {
  const m = byDoc.get(doc)
  const r = m?.get(keyOf(kind, citekey, basePx)) ?? null
  if (r) dbg.hits++; else dbg.misses++
  return r
}

/** True when this version's chrome has been harvested at all (used to report WHY we deferred). */
export function hasRefChrome(doc: PMNode): boolean { return byDoc.has(doc) }

/**
 * Harvest every chrome box in the live bibliography, ATTRIBUTED TO `doc` — the document version
 * currently rendered. MUST run inside the forced canonical context (otherwise the rects are render
 * widths, not canonical ones), from the DOM canonical measure, so it rides that measure's existing
 * layout pass: ~3 getBoundingClientRect per entry, no extra reflow.
 *
 * REPLACES the version's whole set rather than merging: a back-ref's text changes when the pagination
 * moves, and a merge would leave the previous label's box in place under the same key. A stale box
 * is the one thing this cache must not be able to serve.
 *
 * The advance is the MARGIN box (inline margins contribute to the line's advance while
 * getBoundingClientRect returns only the border box — the same correction harvestCiteBox makes for
 * the citation label's `margin: 0 2px`).
 *
 * ⚠ `lineHeightDemand` IS NOT THE ELEMENT'S RECT HEIGHT. The first cut of this module used
 * `getBoundingClientRect().height` — the obvious reading of the engine's "the line-box height this
 * element forces" — and it is WRONG BY 3.42px PER ENTRY, silently. PROVED causally
 * (`reflarrow.prove.mjs`, with the negative firing): an entry measures 49.13px, not the 45.71px its
 * 2 x 22.8528 line-height implies, because `.iw-backref-arrow` sets `font-size: 1.15em` while
 * `.csl-bib-body` sets a UNITLESS `line-height: 1.38` — and a unitless line-height INHERITS AS A
 * RATIO, so the arrow's line box is 16.56 x 1.15 x 1.38 = 26.2807. The group's own rect is 22px
 * (getBoundingClientRect on an inline element returns its text's content box, NOT its line box), so
 * the rect could never have seen the 26.28. Shrinking the arrow to 1em drops the entry to 45.688 —
 * the mechanism, not a coincidence. So the demand is computed from each descendant's OWN computed
 * font-size x its own computed line-height, which is what the browser actually does.
 */
function lineDemandOf(el: HTMLElement): number {
  // The line box must fit EVERY inline box on it — so the demand is the max over the subtree.
  let max = 0
  const visit = (n: HTMLElement) => {
    const cs = getComputedStyle(n)
    if (cs.display === 'inline-block' || cs.display === 'inline-flex') {
      // ⚠ UNVERIFIED RULE. An inline-block on `vertical-align: baseline` sits its MARGIN BOX on the
      // baseline, so it demands (box height + the strut's descent) — not its height. The `+` note
      // button is the only such chrome here and at 17.73px it is DOMINATED by the arrow's 26.28, so
      // it never binds and this branch is NOT EXERCISED on any real bibliography. It is therefore
      // measured by nothing: the probe that proved the arrow could not see this rule at all (remove
      // the button, nothing moves). Left as the box height — the conservative floor — and flagged
      // here rather than dressed up. If chrome ever appears whose box exceeds the arrow's line, this
      // is the line that will be wrong, and it must be proved before it is trusted.
      const r = n.getBoundingClientRect()
      max = Math.max(max, r.height)
      return
    }
    const fs = parseFloat(cs.fontSize) || 0
    const lh = parseFloat(cs.lineHeight)
    // A `normal` line-height has no px value — it is the font's own, which we cannot read here.
    // Fall back to the element's rect rather than invent a ratio.
    max = Math.max(max, Number.isFinite(lh) ? lh : (fs > 0 ? n.getBoundingClientRect().height : 0))
    for (const c of Array.from(n.children)) visit(c as HTMLElement)
  }
  visit(el)
  return max
}

export function harvestRefChromes(root: HTMLElement, doc: PMNode, basePx: number): void {
  const entries = root.querySelectorAll<HTMLElement>('.node-referenceList .iw-bib-entry')
  if (!entries.length) return // nothing rendered (unhydrated / no citations) ⇒ leave it unharvested
  const m = new Map<string, CiteInlineBox>()
  const sel: Array<[string, ChromeKind]> = [
    ['.iw-backref-group', 'backref'],
    ['.iw-esp', 'esp'],
    ['.iw-note-add', 'note'],
  ]
  let n = 0
  entries.forEach(entry => {
    // The entry's citekey comes from the anchor id the NodeView injected (`iwbib-<key>`) — the same
    // id the renderer holds from bibFormat, so harvest and lookup name the entry identically.
    const anchor = entry.querySelector('[id^="iwbib-"]')
    const citekey = anchor ? anchor.id.slice('iwbib-'.length) : ''
    if (!citekey) return
    n++
    for (const [s, kind] of sel) {
      const el = entry.querySelector<HTMLElement>(s)
      if (!el) continue // this entry has no esp / no back-refs — a real absence, not a miss
      const r = el.getBoundingClientRect()
      if (!(r.width > 0) || !(r.height > 0)) { dbg.skippedNoRect++; continue }
      const cs = getComputedStyle(el)
      const advanceWidth = r.width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0)
      m.set(keyOf(kind, citekey, basePx), { advanceWidth, lineHeightDemand: lineDemandOf(el) })
      dbg.harvested++
    }
  })
  byDoc.set(doc, m)
  dbg.docs++; dbg.entries = n
}
