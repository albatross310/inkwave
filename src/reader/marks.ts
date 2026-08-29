// MARKUP ON A FETCHED SOURCE — highlights and sticky notes over the reader's text.
//
// Peter, 2026-08-28: "I want a tab at the bottom with roughly the same markup tools as for the pdfs
// ... basically try to reproduce the same ecosystem."
//
// THE ANCHORING IS THE WHOLE PROBLEM, and it is NOT the PDF's problem. A PDF highlight is a
// RECTANGLE on a page that will never change. A web page is refetched every time you open it, and
// the publisher can edit it between visits — so an offset into last week's text can silently land
// on different words. Two rules follow, and both are about refusing to be confidently wrong:
//   - a mark stores the TEXT IT COVERED, not just its offsets;
//   - on load a mark is re-found by that text (at its remembered offset first, then nearby). A mark
//     whose text is GONE is not re-placed at its old offset — it is reported ORPHANED, because a
//     highlight over words the author never highlighted is worse than one that admits it lost its
//     place.
// The same refusal the music module makes about bar numbers: carry what you know, resolve later,
// never fabricate the key.

// RANGE kinds paint over text the reader selected. POINT kinds insert the reader's OWN words beside
// it (Peter, 2026-08-28: "an input text which allows us to input coloured text at the cursor", "a
// textbox like in pdf mode which puts a textbox"). The difference is about ANCHORING, not painting:
// a range mark's `text` is what it COVERS, a point mark's `text` is the phrase it sits NEXT TO —
// an anchor, carried for exactly the same reason the covered text is. A caret offset into last
// week's article is a promise the publisher never made, so a point mark that cannot find its anchor
// is orphaned like any other rather than dropped at a remembered index.
// Both kinds re-find through the ONE `locateMark` below. Only the render position differs, so there
// is no second anchoring scheme here to drift out of step with this one.
export type MarkKind = 'highlight' | 'note' | 'text' | 'box'

/** True for the kinds that INSERT at an edge of their anchor instead of painting over it. */
export function isPointKind(k: MarkKind): boolean {
  return k === 'text' || k === 'box'
}

export type ReaderMark = {
  id: string
  kind: MarkKind
  color: string
  /** Index of the block in ReaderDoc.blocks. A hint, re-checked against `text`. */
  block: number
  /** Character offset within that block's plain text. A hint, re-checked against `text`. */
  start: number
  /** The text that identifies this mark: what it COVERS (range kinds) or what it sits NEXT TO
   *  (point kinds). Either way it is what is re-found on load, never the offset alone. */
  text: string
  /** A sticky note's body, or the words a 'text'/'box' mark inserts. Empty for a highlight. */
  body?: string
  /** Point kinds only: render at the anchor's START rather than its END. Set when the insertion sat
   *  at the very beginning of a block, where there is no preceding text to anchor to. */
  before?: boolean
  createdAt: string
}

export type Located = ReaderMark & { start: number; end: number }

/**
 * Re-find one mark in the CURRENT text of its block (or a nearby block if it moved). Returns null
 * when its text is gone — deliberately, rather than trusting the offset.
 */
export function locateMark(m: ReaderMark, blockTexts: string[]): Located | null {
  const needle = m.text
  if (!needle) return null
  const tryIn = (bi: number): Located | null => {
    const hay = blockTexts[bi]
    if (hay === undefined) return null
    // At the remembered offset first — the common case, and the only thing that can distinguish two
    // identical phrases in the same block.
    if (hay.startsWith(needle, m.start)) return { ...m, block: bi, start: m.start, end: m.start + needle.length }
    const at = hay.indexOf(needle)
    return at < 0 ? null : { ...m, block: bi, start: at, end: at + needle.length }
  }
  const inPlace = tryIn(m.block)
  if (inPlace) return inPlace
  // The block moved (a section was added above). Search OUTWARD from where it was, so the nearest
  // occurrence wins rather than the first in the document.
  for (let d = 1; d < blockTexts.length; d++) {
    const a = tryIn(m.block - d)
    if (a) return a
    const b = tryIn(m.block + d)
    if (b) return b
  }
  return null
}

/** Locate every mark; the ones whose text has vanished come back flagged, never silently dropped. */
export function locateAll(marks: ReaderMark[], blockTexts: string[]): { placed: Located[]; orphaned: ReaderMark[] } {
  const placed: Located[] = []
  const orphaned: ReaderMark[] = []
  for (const m of marks) {
    const l = locateMark(m, blockTexts)
    if (l) placed.push(l)
    else orphaned.push(m)
  }
  return { placed, orphaned }
}

/**
 * How much text a point mark remembers as its anchor. Long enough that the phrase is very unlikely
 * to repeat inside one block — the only thing that could re-place a mark on the wrong words — and
 * short enough that an ordinary edit nearby does not destroy it.
 */
export const ANCHOR_LEN = 48

/**
 * The anchor phrase for an insertion made at `offset` inside a run of the article's own text.
 *
 * ⚠ A CARET IS A NUMBER AND A NUMBER IS NOT AN ANCHOR. This file refuses to place a highlight by
 * remembered offset because the publisher can rewrite the page between visits; a caret is that same
 * problem with nothing at all to hold on to. So an insertion remembers the WORDS it was made
 * against — behind the caret by preference, because that is the text the reader had just finished
 * reading when they decided to write — and is re-found by them, or reported lost like any other.
 *
 * Returns null when there is nothing to anchor to (a caret in whitespace at a block edge). That is
 * a REFUSAL, not a failure: the caller declines to place the mark rather than inventing a position
 * for it, which is the same choice `locateMark` makes at the other end of the mark's life.
 */
export function anchorSlice(nodeText: string, offset: number): { phrase: string; before: boolean } | null {
  const at = Math.max(0, Math.min(nodeText.length, offset))
  // `before: false` ⇒ render at the anchor's END, which is exactly the caret. Preferred.
  const back = nodeText.slice(Math.max(0, at - ANCHOR_LEN), at)
  if (back.trim().length >= 3) return { phrase: back, before: false }
  // At a block's very start there is nothing behind the caret, so anchor FORWARD instead and render
  // at that phrase's start — the same point, described from the other side.
  const fwd = nodeText.slice(at, at + ANCHOR_LEN)
  if (fwd.trim().length >= 3) return { phrase: fwd, before: true }
  return null
}

/** Where a POINT mark renders inside its block: the far edge of its anchor, or the near one when
 *  the insertion was made at a block's very start. Clamped, so a stale offset can only ever land
 *  inside the block it was found in. */
export function pointAt(m: Located, len: number): number {
  return Math.max(0, Math.min(len, m.before ? m.start : m.end))
}

/**
 * Split a block's [0,len) into runs carrying the marks covering each. Overlapping marks are allowed
 * (a note inside a highlight), so a run carries a LIST and the boundaries are every mark edge —
 * which is what makes overlap render correctly instead of the last one silently winning.
 *
 * `cuts` adds boundaries that no range mark asked for — the positions of POINT marks, so an
 * inserted note has an exact seam to be emitted at instead of being placed by a nearby guess.
 */
export function markRuns(
  len: number,
  marks: Located[],
  cuts: number[] = [],
): Array<{ from: number; to: number; marks: Located[] }> {
  if (len <= 0 || (!marks.length && !cuts.length)) return [{ from: 0, to: len, marks: [] }]
  const edges = new Set<number>([0, len])
  for (const m of marks) {
    if (m.start > 0 && m.start < len) edges.add(m.start)
    if (m.end > 0 && m.end < len) edges.add(m.end)
  }
  for (const c of cuts) if (c > 0 && c < len) edges.add(c)
  const bounds = [...edges].sort((a, b) => a - b)
  const out: Array<{ from: number; to: number; marks: Located[] }> = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i], to = bounds[i + 1]
    if (to <= from) continue
    out.push({ from, to, marks: marks.filter((m) => m.start <= from && m.end >= to) })
  }
  return out
}
