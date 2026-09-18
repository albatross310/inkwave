// A small word-level diff (LCS) for showing what changed between two versions of the writing —
// e.g. a snapshot vs the current document. Pure + framework-free. Tokenises on whitespace runs
// (keeping the whitespace as part of each token) so re-joining the `text` fields reproduces the
// original exactly.

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string }

// Split into tokens of [word][trailing-whitespace] so spacing survives a round-trip.
function tokenize(s: string): string[] {
  return s.match(/\S+\s*|\s+/g) ?? []
}

// LCS table area cap for the (already prefix/suffix-trimmed) middle. Beyond this a wholesale
// rewrite would allocate a gigantic quadratic table for a diff nobody could read anyway — emit a
// coarse del+add of the middles instead. 4M cells ≈ a ~2000-token edit region on each side.
const LCS_MAX_CELLS = 4_000_000

/** Word-level diff: returns ops in reading order. `add` = present only in `next`, `del` = only in `prev`. */
export function diffWords(prev: string, next: string): DiffOp[] {
  const a = tokenize(prev)
  const b = tokenize(next)

  const ops: DiffOp[] = []
  const push = (type: DiffOp['type'], text: string) => {
    if (!text) return
    const last = ops[ops.length - 1]
    if (last && last.type === type) last.text += text
    else ops.push({ type, text })
  }

  // ── Common prefix/suffix trim (2026-07-10 — the /snapshot open-time + memory fix) ────────────
  // Adjacent snapshots share almost all their text, but the LCS table below is O(n·m) MEMORY:
  // ~9M cells on a 3k-word document and hundreds of MB on a thesis-sized one. One such diff per
  // navigation was borderline; the snapshot view's ±20 read-ahead turned it into a per-open storm
  // that ground the page for seconds (and crashed headless renderers outright). Trimming the
  // shared ends first makes the table proportional to the EDIT REGION (typically a few hundred
  // tokens between adjacent snapshots), not the whole document.
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let hiA = a.length
  let hiB = b.length
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) { hiA--; hiB-- }
  if (lo) push('same', a.slice(0, lo).join(''))

  const ma = a.slice(lo, hiA)
  const mb = b.slice(lo, hiB)
  const n = ma.length
  const m = mb.length
  if (n * m > LCS_MAX_CELLS) {
    push('del', ma.join(''))
    push('add', mb.join(''))
  } else if (n || m) {
    // LCS length table (rows over `ma`, cols over `mb`).
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = ma[i] === mb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
    // Walk the table to emit ops, coalescing runs of the same type.
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ma[i] === mb[j]) { push('same', ma[i]); i++; j++ }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('del', ma[i]); i++ }
      else { push('add', mb[j]); j++ }
    }
    while (i < n) { push('del', ma[i]); i++ }
    while (j < m) { push('add', mb[j]); j++ }
  }

  if (hiA < a.length) push('same', a.slice(hiA).join(''))
  return ops
}

/**
 * Break each CHANGE op (add/del) that spans a paragraph return into one op per line-segment, so a change
 * crossing a return becomes two (or three, …) separate diffs — each its own bijection lock point in the
 * snapshot view, giving tighter alignment than a single centre for a tall multi-paragraph change. Trailing
 * newlines stay attached to their segment (so `\n\n` paragraph breaks don't spawn empty pieces), and the
 * concatenated `text` is byte-identical to the input, so nothing downstream of display is affected.
 * `same` ops are left whole. O(total text length).
 */
export function splitChangesAtReturns(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = []
  for (const op of ops) {
    if (op.type === 'same' || !op.text.includes('\n')) { out.push(op); continue }
    // Each match is "text + its trailing newline run" or a final newline-less chunk → no empty pieces.
    const segs = op.text.match(/[^\n]*\n+|[^\n]+/g) ?? [op.text]
    for (const text of segs) out.push({ type: op.type, text })
  }
  return out
}

/** A compact tally for a summary line ("+N words / −M words"). */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  const words = (t: string) => (t.match(/\S+/g) ?? []).length
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added += words(op.text)
    else if (op.type === 'del') removed += words(op.text)
  }
  return { added, removed }
}
