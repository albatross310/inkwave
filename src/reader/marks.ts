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

export type MarkKind = 'highlight' | 'note'

export type ReaderMark = {
  id: string
  kind: MarkKind
  color: string
  /** Index of the block in ReaderDoc.blocks. A hint, re-checked against `text`. */
  block: number
  /** Character offset within that block's plain text. A hint, re-checked against `text`. */
  start: number
  /** The exact text the mark covered — the thing that actually identifies it. */
  text: string
  /** Sticky-note body. Empty for a highlight. */
  body?: string
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
 * Split a block's [0,len) into runs carrying the marks covering each. Overlapping marks are allowed
 * (a note inside a highlight), so a run carries a LIST and the boundaries are every mark edge —
 * which is what makes overlap render correctly instead of the last one silently winning.
 */
export function markRuns(len: number, marks: Located[]): Array<{ from: number; to: number; marks: Located[] }> {
  if (!marks.length || len <= 0) return [{ from: 0, to: len, marks: [] }]
  const edges = new Set<number>([0, len])
  for (const m of marks) {
    if (m.start > 0 && m.start < len) edges.add(m.start)
    if (m.end > 0 && m.end < len) edges.add(m.end)
  }
  const cuts = [...edges].sort((a, b) => a - b)
  const out: Array<{ from: number; to: number; marks: Located[] }> = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i], to = cuts[i + 1]
    if (to <= from) continue
    out.push({ from, to, marks: marks.filter((m) => m.start <= from && m.end >= to) })
  }
  return out
}
