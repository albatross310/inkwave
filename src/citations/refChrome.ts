// REFERENCE-LIST CHROME — COMPUTED, not harvested per version (2026-07-17, round 2).
//
// WHAT THE CHROME IS. ReferenceListNodeView injects three things into each rendered entry that
// citeproc never emitted: the `↩ 4 5.1` back-reference group, an `esp. pp 2, 4–6` span, and the
// `+`/`✎` note button. None is prose and none may be shaped as body text.
//
// WHY THEY CANNOT SIMPLY BE OMITTED. "Honest omission" is available for a GLYPH; it is not available
// for a BOX. The chrome occupies real advance and RAISES its line (see the demand note below), so we
// omit the DRAWING and keep the BOX.
//
// ⚠ STATUS (2026-07-17, round 2): `backrefBox` IS NOT WIRED INTO THE RENDERER, and must not be until
// the refusal below is resolved. Its ARITHMETIC is proved (`reflchrome.prove.mjs` CLAIM A: composed
// == the browser's own rect to 0.055px across every single-line group, with dropMark/dropQuote/
// extraMark negatives all firing, on a fixture carrying real quote previews). Its PRECONDITION is
// not:
//
//   THE BACK-REF GROUP IS NOT AN UNBREAKABLE BOX. `.iw-backref-group` DECLARES `white-space: nowrap`
//   — and that declaration is DEAD. The group carries `contenteditable="false"`, and
//   prosemirror-view's injected `.ProseMirror [contenteditable="false"] { white-space: normal }`
//   (0,2,0) OUT-SPECIFIES `.iw-backref-group` (0,1,0). Verified by asking the CASCADE, not by
//   reasoning about it. So the group WRAPS — measured, 6/13 groups occupy more than one line — and
//   `getBoundingClientRect()` on it returns a UNION OF LINES, not an advance. (That union is what
//   made this probe's first cut report 300+px errors and blame the quote term.) This is the IDENTICAL
//   trap citeBox.ts documents for the citation label; CitationNodeView pins `nowrap` inline to win
//   it, and the back-ref group never got that fix.
//
//   AND THE CHIP FIX IS NOT AVAILABLE HERE. Pinning `nowrap` would make the group one opaque
//   advance — but the widest observed group is 631.8px against a 601.69px column, i.e. ALREADY WIDER
//   THAN THE PAGE. Pinning it would overflow the sheet, not fix the model. The honest model is
//   therefore RUNS (breakable text: arrow @1.15em, labels @600 with the link's 0.22em padding, quote
//   previews @0.86em italic), which is what the composition below already computes the pieces of.
//   A product change (shortening the preview, or dropping the group to one line) is Peter's call.
//
// ── WHY THIS IS COMPUTED RATHER THAN HARVESTED ───────────────────────────────────────────────────
// Round 1 harvested each entry's chrome box from the live DOM, keyed by PM doc identity. That was
// CORRECT but USELESS for the renderer's actual purpose: back-ref labels are DOCUMENT PAGE NUMBERS
// (`occurrencePages` reads document.getElementById + `docPageOf` off the live pagination widgets), so
// a version we have never rendered has no harvestable chrome — and the renderer exists to paint the
// 115 versions Peter scrubs, not the one in the editor. Harvest-by-version means the refList stops
// estimating on the live doc and defers forever on every snapshot. That is not the goal.
//
// So the chrome is COMPUTED. The labels come from the MODEL's own pagination (the renderer already
// knows every citation's page — that is exactly what `occurrencePages` scrapes from the DOM), and the
// box is composed from CSS SUB-STYLES that are VERSION-INDEPENDENT: `.iw-backref-arrow`'s 1.15em,
// `.iw-cite-link`'s `padding: 0 0.22em`, `.iw-backref-quote`'s 0.86em italic, the button's
// border+padding. Those are properties of the STYLESHEET, identical for every version, so one harvest
// serves them all — the same argument blockStyles.ts makes for keying on block TYPE.
//
// THIS IS STILL NOT A HAND-DERIVATION. The sub-styles are READ from real rendered elements (never a
// detached probe — that is how canvasShapingMatchesEditor died); only their COMPOSITION is arithmetic,
// and that composition is proved against the live DOM's own rects per entry (reflchrome.prove.mjs),
// with a known-negative that must fire. A sub-style that was never harvested returns null ⇒ DEFER.
//
// ── THE DEMAND RULE, AND THE 3.42px IT COST TO LEARN ─────────────────────────────────────────────
// `lineHeightDemand` IS NOT THE ELEMENT'S RECT HEIGHT. Round 1 used `getBoundingClientRect().height`
// — the obvious reading of the engine's "the line-box height this element forces" — and it is wrong
// by 3.42px PER ENTRY, silently (~48px over a bibliography, which moves every break below it).
// PROVED causally (`reflarrow.prove.mjs`, negative fires): an entry measures 49.13px, not the 45.71px
// its 2 x 22.8528 line-height implies, because `.iw-backref-arrow` sets `font-size: 1.15em` while
// `.csl-bib-body` sets a UNITLESS `line-height: 1.38` — and a unitless line-height INHERITS AS A
// RATIO, so the arrow's line box is 16.56 x 1.15 x 1.38 = 26.2807. The group's own rect is 22px
// (getBoundingClientRect on an INLINE element returns its text's content box, NOT its line box), so
// the rect could never have seen the 26.28. Shrinking the arrow to 1em drops the entry to 45.688 —
// the mechanism, not a coincidence. The `+` button (17.73px) does NOT bind and is NOT the cause.

import type { CiteInlineBox } from './citeBox'
import { cssFontOf, type Measure } from '../editor/arithmeticLayout'

/** One inline element's computed geometry — everything needed to compose it into a line. */
export interface InlineStyle {
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  italic: boolean
  /** Computed line-height in px — the line box this element demands. NOT its rect height. */
  lineHeightPx: number
  marginLeftPx: number
  marginRightPx: number
  paddingLeftPx: number
  paddingRightPx: number
  borderLeftPx: number
  borderRightPx: number
  borderTopPx: number
  borderBottomPx: number
  /** inline / inline-block — an inline-block sits its MARGIN BOX on the baseline. */
  display: string
}

/** The chrome classes whose CSS the composition needs. Version-independent by construction. */
const SUB: Array<[string, string]> = [
  ['group', '.node-referenceList .iw-backref-group'],
  ['arrow', '.node-referenceList .iw-backref-arrow'],
  ['link', '.node-referenceList .iw-backref-group .iw-cite-link'],
  ['quote', '.node-referenceList .iw-backref-quote'],
  ['note', '.node-referenceList .iw-note-add'],
  ['esp', '.node-referenceList .iw-esp'],
]

const cache = new Map<string, InlineStyle>()
const dbg = { harvested: 0, hits: 0, misses: 0, size: 0, keys: [] as string[] }
if (typeof window !== 'undefined') (window as unknown as { __iwRefChrome?: unknown }).__iwRefChrome = dbg

function keyOf(kind: string, basePx: number): string { return `${kind}|${basePx}` }

/** Drop everything — the canonical CONTEXT changed (fonts, page settings, paper, zoom). */
export function clearRefChrome(): void { cache.clear(); dbg.size = 0; dbg.keys = [] }

/** A harvested sub-style, or null ⇒ the caller MUST defer. Never a guess. */
export function chromeStyle(kind: string, basePx: number): InlineStyle | null {
  const r = cache.get(keyOf(kind, basePx)) ?? null
  if (r) dbg.hits++; else dbg.misses++
  return r
}

function readInline(el: HTMLElement): InlineStyle | null {
  const cs = getComputedStyle(el)
  const fontSizePx = parseFloat(cs.fontSize)
  if (!(fontSizePx > 0)) return null
  const lh = parseFloat(cs.lineHeight)
  return {
    fontFamily: cs.fontFamily,
    fontSizePx,
    fontWeight: parseInt(cs.fontWeight, 10) || 400,
    italic: cs.fontStyle === 'italic',
    // A `normal` line-height has no px value. We cannot read the font's own here, and inventing a
    // ratio is the guess this module exists to avoid — so refuse, and let the caller defer.
    lineHeightPx: Number.isFinite(lh) ? lh : NaN,
    marginLeftPx: parseFloat(cs.marginLeft) || 0,
    marginRightPx: parseFloat(cs.marginRight) || 0,
    paddingLeftPx: parseFloat(cs.paddingLeft) || 0,
    paddingRightPx: parseFloat(cs.paddingRight) || 0,
    borderLeftPx: parseFloat(cs.borderLeftWidth) || 0,
    borderRightPx: parseFloat(cs.borderRightWidth) || 0,
    borderTopPx: parseFloat(cs.borderTopWidth) || 0,
    borderBottomPx: parseFloat(cs.borderBottomWidth) || 0,
    display: cs.display,
  }
}

/**
 * Harvest the chrome sub-styles from the REAL rendered bibliography. Call from inside the DOM
 * canonical measure, beside harvestCiteBoxes/harvestBlockStyles — one getComputedStyle per distinct
 * class, not per entry.
 *
 * Only classes PRESENT in the live DOM are harvested (an entry with no `esp` leaves `esp`
 * unharvested); an absent class stays absent ⇒ any entry needing it defers, rather than being
 * synthesised from a fabricated element.
 */
export function harvestRefChromeStyles(root: HTMLElement, basePx: number): void {
  for (const [kind, sel] of SUB) {
    const key = keyOf(kind, basePx)
    if (cache.has(key)) continue
    let el: HTMLElement | null = null
    try { el = root.querySelector(sel) as HTMLElement | null } catch { el = null }
    if (!el) continue
    if (!el.getClientRects().length) continue // no box (display:none / not laid out) ⇒ defer
    const s = readInline(el)
    if (!s || !Number.isFinite(s.lineHeightPx)) continue
    cache.set(key, s)
    dbg.harvested++; dbg.size = cache.size
    if (!dbg.keys.includes(kind)) dbg.keys.push(kind)
  }
}

/** One back-reference mark: its label ("4", "5.1") and the first-few-words quote preview, if any. */
export interface BackrefMark { label: string; quote: string }

/**
 * Compose the back-ref group's box ARITHMETICALLY from the harvested sub-styles.
 *
 * Mirrors `backrefHtml`'s structure exactly — that shape is the contract:
 *   <span .iw-backref-group><span .iw-backref-arrow>↩</span> MARK MARK …</span>
 *   MARK = <a .iw-cite-link>LABEL[ <span .iw-backref-quote>WORDS…</span>]</a>
 *
 * ⚠ RETURNS THE GROUP'S TOTAL ADVANCE — i.e. the width it would occupy IF it were unbreakable. It is
 * NOT. See the refusal at the top of this file: the group's `nowrap` is dead, it wraps, and a group
 * can exceed the column. So this value is CORRECT ARITHMETIC for a group that happens to fit on one
 * line (proved to 0.055px) and is the right sum to build a RUNS model out of — but it MUST NOT be
 * handed to the engine as an atom `box`, or every wrapping group silently claims one line it does
 * not have. Wiring this in as-is is the bug this comment exists to prevent.
 *
 * Returns null when any sub-style it needs is unharvested ⇒ the caller DEFERS the refList.
 */
export function backrefBox(marks: readonly BackrefMark[], measure: Measure, basePx: number): CiteInlineBox | null {
  if (!marks.length) return { advanceWidth: 0, lineHeightDemand: 0 } // no back-refs ⇒ no box, a real answer
  const group = chromeStyle('group', basePx)
  const arrow = chromeStyle('arrow', basePx)
  const link = chromeStyle('link', basePx)
  if (!group || !arrow || !link) return null
  const quoteNeeded = marks.some(m => m.quote)
  const quote = quoteNeeded ? chromeStyle('quote', basePx) : null
  if (quoteNeeded && !quote) return null

  const groupFont = cssFontOf(group)
  const arrowFont = cssFontOf(arrow)
  const linkFont = cssFontOf(link)
  const spaceW = measure(' ', groupFont)

  let w = group.marginLeftPx + group.marginRightPx
  w += measure('↩', arrowFont)
  w += spaceW // the literal space after the arrow span
  marks.forEach((m, i) => {
    w += link.marginLeftPx + link.borderLeftPx + link.paddingLeftPx
    w += measure(m.label, linkFont)
    if (m.quote && quote) {
      // The preview is INSIDE the <a>: a space in the link's font, then the quote span's own face.
      w += measure(' ', linkFont)
      w += measure(`${m.quote}…`, cssFontOf(quote))
    }
    w += link.paddingRightPx + link.borderRightPx + link.marginRightPx
    if (i < marks.length - 1) w += spaceW // marks.join(' ')
  })

  // The line box must fit EVERY inline box on it — the max, not the sum. This is where the arrow's
  // 1.15em x unitless 1.38 = 26.2807 enters, and it is the whole reason an entry is 49.13 not 45.71.
  let demand = Math.max(group.lineHeightPx, arrow.lineHeightPx, link.lineHeightPx)
  if (quote) demand = Math.max(demand, quote.lineHeightPx)
  return { advanceWidth: w, lineHeightDemand: demand }
}

/**
 * The `+`/`✎` note button's box. An inline-block `<button>`: its margin box sits ON the baseline.
 *
 * ⚠ THE DEMAND HERE IS A CONSERVATIVE FLOOR AND IS NOT PROVED. A baseline-aligned inline-block
 * demands (its box height + the strut's descent below the baseline), not its height — but at 17.73px
 * it is DOMINATED by the arrow's 26.28 on every real entry, so it never binds and no probe can see
 * the rule (remove the button: nothing moves — measured). It is left as the box height and flagged
 * here rather than dressed up. If chrome ever appears whose box exceeds the arrow's line, THIS is
 * the line that will be wrong; prove it before trusting it.
 *
 * The box height itself IS verified arithmetic: borderTop + borderBottom + fontSize x line-height(1)
 * = 1 + 1 + 15.732 = 17.73, matching the measured rect exactly.
 */
export function noteBox(glyph: string, measure: Measure, basePx: number): CiteInlineBox | null {
  const note = chromeStyle('note', basePx)
  if (!note) return null
  const w = note.marginLeftPx + note.borderLeftPx + note.paddingLeftPx
    + measure(glyph, cssFontOf(note))
    + note.paddingRightPx + note.borderRightPx + note.marginRightPx
  const h = note.borderTopPx + note.borderBottomPx + note.lineHeightPx
  return { advanceWidth: w, lineHeightDemand: h }
}
