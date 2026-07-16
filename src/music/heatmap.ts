// ─── The practice heatmap (build-spec §A2 — distinctive, step 5) ─────────────
//
// "A dedicated heatmap screen where the student (or teacher) selects RANGES OF BARS and assigns
// CUSTOM COLOURS to build an at-a-glance map of what needs work."
//
// ⚠️ THE DEFINING CONSTRAINT, and it is the reason the feature is defensible at all:
// **"This is MANUAL ANNOTATION, NOT AN AI JUDGEMENT — nothing opaque to defend."**
// There is no field here the app computes, infers, scores or predicts, and none may be added. If a
// future change wants to colour a bar because Inkwave THINKS it is weak, that is a different feature
// with a different spec and a different conversation. The CV's only role (§A2) is optionally
// pre-detecting where the bars ARE, to make selection easier — never how hot they are. `reflow.ts`
// refuses even that where it cannot be sure.
//
// PURE — no DOM, no React. The screen renders it; this decides it.

import { hashCanonical } from '../provenance/hash'
import { isoWithOffset, type Author, type HeatmapEntry, type Piece } from './types'

// ─── Addressing bars across a Piece ──────────────────────────────────────────
//
// `bar_index` is a 0-based ordinal ACROSS THE WHOLE PIECE (see types.ts, BarRef) — page 0's first
// bar is 0 and the count runs on through every page. That is what lets a range be swept, sorted and
// joined; a per-page number could not be ranged across a page turn, which is exactly what "bars
// 30–34" does when 30 is at the foot of one page.

export interface BarAddress {
  bar_index: number
  page: number
  system: number
  /** Normalised to the SOURCE page image — the same space every anchor lives in. */
  region: { x: number; y: number; w: number; h: number }
  bar_label?: string
}

/** Every bar in the piece, in playing order. Empty where no page has a bar model yet. */
export function barsOfPiece(piece: Piece): BarAddress[] {
  const out: BarAddress[] = []
  piece.pages.forEach((page, pageIndex) => {
    // Sort by system, then down the page — a page's bars are stored in detection order, which is
    // not guaranteed to be playing order once a student has tapped extra ones in.
    const bars = [...page.bars].sort((a, b) =>
      a.system !== b.system ? a.system - b.system : a.region.x - b.region.x)
    for (const b of bars) {
      out.push({
        bar_index: out.length,       // RE-INDEXED across the piece, ignoring per-page numbering
        page: pageIndex,
        system: b.system,
        region: b.region,
        bar_label: b.bar_label,
      })
    }
  })
  return out
}

// ─── Reading the map ─────────────────────────────────────────────────────────

/**
 * The colour showing on a bar: the MOST RECENT entry covering it.
 *
 * Last-write-wins by timestamp, and the older entries are KEPT rather than overwritten. Two reasons,
 * both from §A2:
 *  1. The heatmap is "a timestamped record of how the student saw the piece OVER TIME" — an entry
 *     the teacher replaced is part of that record, not rubbish. Deleting it would destroy the very
 *     history the provenance anchor exists to attest.
 *  2. The teacher recolours MID-LESSON, on the student's iPad. Overwriting in place would silently
 *     erase what the student had marked before the lesson; layering shows both, attributed.
 *
 * Ties break toward the LATER entry in the array (a same-millisecond recolour is the one just made).
 */
export function colourAt(heatmap: readonly HeatmapEntry[], barIndex: number): HeatmapEntry | null {
  let best: HeatmapEntry | null = null
  for (const e of heatmap) {
    if (barIndex < e.bars[0] || barIndex > e.bars[1]) continue
    if (!best || e.ts >= best.ts) best = e
  }
  return best
}

/** Every entry covering a bar, oldest first — the bar's own history (§A2's record over time). */
export function historyAt(heatmap: readonly HeatmapEntry[], barIndex: number): HeatmapEntry[] {
  return heatmap
    .filter(e => barIndex >= e.bars[0] && barIndex <= e.bars[1])
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}

// ─── Writing the map ─────────────────────────────────────────────────────────

export interface PaintOptions {
  bars: [number, number]
  colour: string
  label?: string
  author: Author
  /** Injectable for tests. Real callers let it default. */
  now?: () => string
  id?: () => string
}

/**
 * Paint a range. Returns a NEW heatmap array — the entries are provenance material and are never
 * mutated in place.
 *
 * The range is NORMALISED (a Pencil sweep runs right-to-left as happily as left-to-right, and a
 * backwards range would silently cover nothing — `colourAt` would find no bar between 34 and 30).
 */
export function paint(heatmap: readonly HeatmapEntry[], opts: PaintOptions): HeatmapEntry[] {
  const [a, b] = opts.bars
  const entry: HeatmapEntry = {
    id: (opts.id ?? defaultId)(),
    bars: [Math.min(a, b), Math.max(a, b)],
    colour: opts.colour,
    ...(opts.label ? { label: opts.label } : {}),
    author: opts.author,
    ts: (opts.now ?? isoWithOffset)(),
  }
  return [...heatmap, entry]
}

/**
 * Remove a range's colour by painting `null`… no — by REMOVING the entries the student made.
 *
 * DELIBERATELY NOT a "clear" entry: an erase is the student saying "I never meant that", not a new
 * observation. But it only removes entries the given author OWNS — a student's erase must not delete
 * what their teacher marked during the lesson, and vice versa. Anything it cannot remove is
 * returned so the caller can say so rather than appearing to no-op.
 */
export function erase(
  heatmap: readonly HeatmapEntry[], id: string, author: Author,
): { heatmap: HeatmapEntry[]; removed: boolean; refusedAuthor: Author | null } {
  const target = heatmap.find(e => e.id === id)
  if (!target) return { heatmap: [...heatmap], removed: false, refusedAuthor: null }
  if (target.author !== author) {
    return { heatmap: [...heatmap], removed: false, refusedAuthor: target.author }
  }
  return { heatmap: heatmap.filter(e => e.id !== id), removed: true, refusedAuthor: null }
}

function defaultId(): string {
  // crypto.randomUUID is present in every browser this app supports and in node ≥19.
  return globalThis.crypto?.randomUUID?.() ?? `hm-${Math.random().toString(36).slice(2)}`
}

// ─── Provenance (§A2: "stored in the .studio provenance record") ─────────────

/**
 * The heatmap's hash, for the existing OTS spine (`provenance/`) to anchor.
 *
 * REUSES `hashCanonical` — RFC 8785 JCS + SHA-256, the same canonicalisation every other anchored
 * artefact in this app goes through. A second hashing rule would mean a second thing "anchored to
 * Bitcoin" that the open verifier cannot recompute.
 *
 * ⚠️ WHAT IS HASHED IS THE FULL ENTRY LIST, ORDER-INDEPENDENT. Entries are sorted by (ts, id)
 * first, because two devices can legitimately hold the same heatmap in different array orders (the
 * teacher's mid-lesson paints and a sync arriving out of order) — and a hash that changed with array
 * order would say the record had been tampered with when nothing about it had changed. The `v` tag
 * is there so a later shape change cannot silently re-interpret an already-anchored hash.
 */
export function heatmapHash(heatmap: readonly HeatmapEntry[]): Promise<string> {
  const sorted = [...heatmap].sort((a, b) =>
    a.ts !== b.ts ? (a.ts < b.ts ? -1 : 1) : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return hashCanonical({
    v: 1,
    entries: sorted.map(e => ({
      id: e.id, bars: e.bars, colour: e.colour, label: e.label ?? null, author: e.author, ts: e.ts,
    })),
  })
}

/** Fold the heatmap's hash into the Piece's provenance record. Returns a NEW Piece. */
export async function recordHeatmapProvenance(piece: Piece): Promise<Piece> {
  const hash = await heatmapHash(piece.heatmap)
  return {
    ...piece,
    provenance: { ...piece.provenance, hashes: { ...piece.provenance.hashes, heatmap: hash } },
  }
}

// ─── The palette ─────────────────────────────────────────────────────────────
//
// §A2 says "CUSTOM colours" and means it — these are a starting palette, not a fixed vocabulary, and
// the label is the student's own word. NOT a severity scale: naming them "level 1..5" would smuggle
// back the judgement the feature exists to avoid, and a scale invites the app to compute a score
// from it. They are just colours a person picked, with whatever meaning that person gives them.
//
// The suggested labels are suggestions. Nothing reads them.

export interface Swatch { colour: string; suggested: string }

export const HEATMAP_PALETTE: Swatch[] = [
  { colour: '#c94f4f', suggested: 'needs work' },
  { colour: '#e08b3a', suggested: 'shaky' },
  { colour: '#e3c13d', suggested: 'getting there' },
  { colour: '#5aa469', suggested: 'solid' },
  { colour: '#4a7fb5', suggested: 'memorised' },
  { colour: '#8a5cc4', suggested: 'ask my teacher' },
]
