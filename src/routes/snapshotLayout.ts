// PURE RULES LIFTED OUT OF SnapshotView — the diff-edge split, the biggest-change pick, and the two
// minimap geometry rules.
//
// ⚠ THEY WERE UNTESTABLE, NOT UNTESTED. All four were module-private inside a 3,800-line route, so
// there was no way to assert any of them without mounting the whole snapshot view. Each encodes a
// decision with a stated reason — Peter's minimap band, the whitespace rule that stops an empty
// highlighted line — and none of those reasons was checkable. They are unchanged here, character for
// character; only their address moved.
//
// Nothing in this file touches the DOM, React, or the snapshot archive.

import type { DiffOp } from '../provenance/diff'

/**
 * Split a change's text into [lead whitespace, visible core, trail whitespace] so a highlight wraps
 * ONLY the core.
 *
 * ⚠ THE WHOLE POINT IS THE RETURN CHARACTER. Leading and trailing spaces — and especially newlines —
 * must never be painted, or a change that ends a paragraph draws an empty highlighted line across
 * the page. When the text is ENTIRELY whitespace there is no core to highlight, so it all becomes
 * `trail` and renders plain: `core` is '' and the caller draws nothing.
 */
export function splitEdges(text: string): { lead: string; core: string; trail: string } {
  const lead = /^\s+/.exec(text)?.[0] ?? ''
  if (lead.length === text.length) return { lead: '', core: '', trail: text }
  const trail = /\s+$/.exec(text)?.[0] ?? ''
  return { lead, core: text.slice(lead.length, text.length - trail.length), trail }
}

/**
 * The op (add or del) with the longest single character chain — the biggest contiguous change.
 * Returns its index in the ops array (= its `data-opidx` in the left pane), or null if nothing
 * changed. The index is the return value BECAUSE it is the DOM address: callers scroll to
 * `[data-opidx="N"]`, so an op's position in this array is load-bearing and must not be re-sorted.
 */
export function longestChangeOpIdx(ops: DiffOp[] | null): number | null {
  if (!ops) return null
  let best: number | null = null, bestLen = 0
  ops.forEach((op, i) => {
    if (op.type === 'same') return
    const len = op.text.length
    if (len > bestLen) { bestLen = len; best = i }
  })
  return best
}

/**
 * Column stack-height for the minimap: pages stack this many high per column, then wrap into
 * columns. ≤2→1, 3–6→2, 7–9→3, 10–16→4, 17+→⌈√pages⌉. Peter's spec — the bands are his, not derived.
 */
export function stackHeight(pages: number): number {
  if (pages <= 2) return 1
  if (pages <= 6) return 2
  if (pages <= 9) return 3
  if (pages <= 16) return 4
  return Math.ceil(Math.sqrt(pages))
}

/**
 * Pick rows×cols to tile `n` page thumbnails into a W×H panel so each CELL is portrait —
 * height:width clamped to Peter's band 1:2 … 1:4.
 *
 * ⚠ THE BAND IS TWO-SIDED AND BOTH SIDES ARE REAL (2026-07-10 revision). The earlier [3,5] band
 * rendered "longer than 1:5" on the phone's half-height panel, so MAX exists; MIN exists because a
 * squat cell stops reading as a page. `outside * 100` makes leaving the band dominate the score, so
 * distance-from-ideal only ever breaks ties WITHIN it — reverse that weighting and a wildly wrong
 * aspect wins whenever it happens to sit near 3.
 */
export function bestGrid(n: number, W: number, H: number): { rows: number; cols: number } {
  if (n <= 1 || W <= 0 || H <= 0) return { rows: Math.max(1, n), cols: 1 }
  const MIN = 2, MAX = 4, IDEAL = 3 // page thumbnail height:width
  let best = { rows: 1, cols: n }, bestScore = Infinity
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const ratio = (H / rows) / (W / cols) // cell height : width
    const outside = ratio < MIN ? MIN - ratio : ratio > MAX ? ratio - MAX : 0
    const score = outside * 100 + Math.abs(ratio - IDEAL)
    if (score < bestScore) { bestScore = score; best = { rows, cols } }
  }
  return best
}
