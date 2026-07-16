// FLAT TEXT → PM SOURCE MAP, and the anchoring of diff ops onto it.
//
// WHY THIS EXISTS. /snapshot's doc pane renders a WORD-LEVEL DIFF, and the diff is computed over
// FLAT TEXT: `opsBetween` = `diffWords(pmToText(prev, true), pmToText(cur, true))`. That is why the
// pane has been a flat transcript for every version but the first (measured: headings 6→0, lists
// 6→0, paragraphs 48→0, top-level children 50→1 — panecontent.prove.mjs). Peter chose RICH pages, so
// the diff's char ranges have to be projected back onto the PM tree that produced the text. This
// module is that projection, and nothing else: it is PURE, it touches no DOM, and it needs no
// editor, no warm layer and no citeBox — which is what lets an UNVISITED version render.
//
// ── THE PROVENANCE BOUNDARY (read before touching anything here) ────────────────────────────────
// `pmToText` is hashed. bundle.ts folds it into the export bundle, verify/index.ts recomputes it,
// and M2 anchors that hash to Bitcoin via OpenTimestamps. Peter's receipts depend on its bytes. So:
//   • pmToText IS NOT MODIFIED — not "improved", not refactored, not called differently.
//   • This module MIRRORS its structure and emits the SAME string, and that claim is not trusted —
//     `textMap.test.ts` asserts `buildFlatMap(doc, r).text === pmToText(doc, r)` byte-for-byte, at
//     BOTH resolve settings, across every fixture including the empty/whitespace edge cases. If a
//     mirror ever drifts, that test fails LOUDLY rather than a snapshot rendering subtly wrong text.
//   • The one shared leaf — `citationText` — is IMPORTED, not re-implemented, so the citation form
//     (resolve → simpleInText; else prefix/keys/locator/suffix) cannot drift by construction.
// The three structural rules mirrored from pmToText's walk, each of which is load-bearing:
//   1. BLOCK types are exactly {paragraph, heading, listItem, blockquote, codeBlock}; a block's
//      content goes through `inline`, which FLATTENS everything below it. A `listItem` is checked
//      BEFORE recursion, so a paragraph nested inside one is consumed by `inline` and never walked
//      as its own block. (A bulletList is not a block type, so walk descends into its listItems.)
//   2. Each block is `.trim()`ed, and EMPTY blocks are dropped entirely — so a block's flat offsets
//      are shifted by its leading whitespace and it may not appear at all.
//   3. Blocks are joined with '\n\n' and the document ends with a trailing '\n'.

import type { TiptapJSON } from '../types/document'
import type { DiffOp } from './diff'
import { citationText } from './bundle'

/** One inline leaf's contribution to the flat text. `path` indexes `.content` from the doc root. */
export interface FlatSeg {
  path: number[]
  /** Offset within THIS leaf's own emitted text (non-zero only when a trim clipped its head). */
  nodeStart: number
  /** Offset in the flat document text. */
  flatStart: number
  len: number
}

/** One emitted block (post-trim, non-empty) and where its pieces came from. */
export interface FlatBlock {
  path: number[]
  flatStart: number
  flatEnd: number
  segs: FlatSeg[]
}

export interface FlatMap {
  /** Byte-identical to pmToText(doc, resolveCitations) — asserted by test, not assumed. */
  text: string
  blocks: FlatBlock[]
}

type N = { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }

// Mirrors pmToText's walk predicate EXACTLY. Kept as a frozen set so a stray edit is visible.
const BLOCK_TYPES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'])

interface RawSeg { path: number[]; rawStart: number; len: number }
interface RawBlock { path: number[]; raw: string; segs: RawSeg[] }

/**
 * Build the flat text AND the map back to source positions.
 *
 * `resolveCitations` mirrors pmToText's parameter and MUST match the one the ops were diffed under
 * (`displayTextOf` uses `true`). Asking for a map at `false` while the ops came from `true` would
 * align diff ranges against different bytes — so the caller passes the same value, and the
 * byte-identity test covers both.
 */
export function buildFlatMap(doc: TiptapJSON, resolveCitations = true): FlatMap {
  const raws: RawBlock[] = []

  // Mirrors pmToText's `inline`, additionally recording each leaf's span.
  const inline = (node: N, path: number[], acc: { raw: string; segs: RawSeg[] }): void => {
    if (node.type === 'text') {
      const t = node.text ?? ''
      if (t) { acc.segs.push({ path, rawStart: acc.raw.length, len: t.length }); acc.raw += t }
      return
    }
    if (node.type === 'hardBreak') {
      acc.segs.push({ path, rawStart: acc.raw.length, len: 1 }); acc.raw += '\n'
      return
    }
    if (node.type === 'citation') {
      const t = citationText(node.attrs, resolveCitations)
      if (t) { acc.segs.push({ path, rawStart: acc.raw.length, len: t.length }); acc.raw += t }
      return
    }
    const kids = (node.content as N[] | undefined) ?? []
    kids.forEach((c, i) => inline(c, [...path, i], acc))
  }

  // Mirrors pmToText's `walk`.
  const walk = (node: N, path: number[]): void => {
    const t = node.type
    if (t && BLOCK_TYPES.has(t)) {
      const acc = { raw: '', segs: [] as RawSeg[] }
      const kids = (node.content as N[] | undefined) ?? []
      kids.forEach((c, i) => inline(c, [...path, i], acc))
      raws.push({ path, raw: acc.raw, segs: acc.segs })
    } else if (Array.isArray(node.content)) {
      ;(node.content as N[]).forEach((c, i) => walk(c, [...path, i]))
    }
  }
  walk(doc as N, [])

  // Emit: trim each block, DROP the empties, join with '\n\n', end with '\n'.
  const parts: string[] = []
  const blocks: FlatBlock[] = []
  let flat = 0
  for (const b of raws) {
    const trimmed = b.raw.trim()
    if (!trimmed.length) continue // pmToText's .filter(b => b.length > 0)
    if (parts.length) flat += 2 // the '\n\n' join
    const lead = b.raw.length - b.raw.trimStart().length
    const keepEnd = lead + trimmed.length // exclusive, in RAW coords
    const blockStart = flat
    const segs: FlatSeg[] = []
    for (const s of b.segs) {
      // Clip each leaf to the surviving [lead, keepEnd) window — a seg can be dropped entirely
      // (pure leading whitespace) or partially (its head/tail trimmed).
      const from = Math.max(s.rawStart, lead)
      const to = Math.min(s.rawStart + s.len, keepEnd)
      if (to <= from) continue
      segs.push({ path: s.path, nodeStart: from - s.rawStart, flatStart: blockStart + (from - lead), len: to - from })
    }
    parts.push(trimmed)
    flat += trimmed.length
    blocks.push({ path: b.path, flatStart: blockStart, flatEnd: flat, segs })
  }
  return { text: parts.join('\n\n') + '\n', blocks }
}

// ── Anchoring the diff ─────────────────────────────────────────────────────────────────────────
//
// THE DELETION PROBLEM, which is the whole difficulty of rendering this pane rich. `diffWords(prev,
// cur)` yields ops whose non-`del` text concatenates to CUR and whose non-`add` text concatenates to
// PREV. A `same` or `add` op therefore OCCUPIES a range of cur's text and maps onto cur's tree
// directly. A `del` op occupies NOTHING in cur — it exists only in prev — so it has no home in the
// tree we are rendering. It is not a range; it is a POINT, and the point is wherever the cursor had
// reached when it was removed.
//
// Hence: one cursor over CUR, advanced by `same` and `add` and NOT by `del`. A del's curStart ===
// curEnd === that cursor. Get this wrong and a deletion renders in the wrong paragraph — which is a
// WRONG DOCUMENT, not a cosmetic bug, and it would look exactly like the diff being wrong rather
// than the projection being wrong.
export interface AnchoredOp {
  type: DiffOp['type']
  text: string
  /** Range in CUR's flat text. For a `del` this is EMPTY (curStart === curEnd): a splice point. */
  curStart: number
  curEnd: number
}

export function anchorOps(ops: readonly DiffOp[]): AnchoredOp[] {
  let cur = 0
  const out: AnchoredOp[] = []
  for (const op of ops) {
    const curStart = cur
    if (op.type !== 'del') cur += op.text.length // dels occupy nothing in cur
    out.push({ type: op.type, text: op.text, curStart, curEnd: cur })
  }
  return out
}

/**
 * The op ranges overlapping [from, to) of the flat text, clipped to it, in order — plus any `del`
 * anchors that fall inside. This is what a renderer walks to split one text node into marked runs.
 *
 * A `del` anchored exactly at `to` is EXCLUDED and one at `from` is included, so adjacent segments
 * cannot both claim the same deletion (it would render twice).
 */
export function opsInRange(anchored: readonly AnchoredOp[], from: number, to: number): AnchoredOp[] {
  const out: AnchoredOp[] = []
  for (const op of anchored) {
    if (op.type === 'del') {
      if (op.curStart >= from && op.curStart < to) out.push(op)
      continue
    }
    const s = Math.max(op.curStart, from)
    const e = Math.min(op.curEnd, to)
    if (e <= s) continue
    out.push({ type: op.type, text: op.text.slice(s - op.curStart, e - op.curStart), curStart: s, curEnd: e })
  }
  return out
}
