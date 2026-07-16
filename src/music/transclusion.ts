// BAR-RANGE EXCERPTING BY TRANSCLUSION (build spec §B6) — the standout feature of the MusicXML path.
//
//   "The insert is a transclusion / reference — it stores (master_id, bar_start, bar_end) and
//    re-renders just those measures; it is NOT a copy of the XML. Single source of truth: fix the
//    master and every excerpt updates."
//
// ─── Why this file contains no notation ──────────────────────────────────────────────────────
// A `Transclusion` holds an id, a master id, two printed bar numbers, and a part index. That is the
// whole record. It carries NO pitches, NO measures, NO XML — not as an optimisation, but because a
// copy is the failure this feature exists to avoid, and a copy would be INVISIBLE: an excerpt that
// copied the XML renders identically to one that references it, right up until the master is fixed,
// at which point the copy quietly keeps showing the old, wrong bars. Nothing on screen would say so.
//
// That is this codebase's recurring disease (CLAUDE.md: sixteen checks that could not see their own
// failure). So the tests do not merely render an excerpt and compare it to the master — that passes
// BY CONSTRUCTION whether it is a reference or a copy. They fix the master and demand the excerpt
// change, and they inspect the SERIALISED record from outside for any note data. See
// `transclusion.test.ts` and `isReferenceOnly` below.
//
// ─── Addressing: printed bar numbers ─────────────────────────────────────────────────────────
// Excerpts address bars the way the writer does — "bars 12-16", "see m. 34" — so they store PRINTED
// numbers, not indices. Resolution maps printed → index through Inkwave's own parse of the master
// (music/parse.ts), not through the render engine, so "bar 12" has one definition that the engine
// cannot quietly disagree with. Ambiguous or missing numbers are reported, never guessed.

import { loadMasterXml, masterMeta, type MasterMeta } from './master'
import { indicesOfPrintedBar, parseMusicXml } from './parse'
import type { Score } from './score'

/**
 * An excerpt inserted into a document: a REFERENCE to a bar range of a master.
 *
 * Every field is an address or an id. If you ever find yourself adding notation to this interface,
 * the feature has been inverted — see the header.
 */
export interface Transclusion {
  /** Identity of this excerpt instance (a document may excerpt the same bars twice). */
  id: string
  /** WHICH master. Stable across master content replacement — that is what makes excerpts live. */
  masterId: string
  /** Printed bar number of the first bar, verbatim as the writer cited it. */
  barStart: string
  /** Printed bar number of the last bar (inclusive). */
  barEnd: string
  /** Which part of a multi-part score. Defaults to 0. */
  partIndex: number
  createdAt: string
}

export function makeTransclusion(
  masterId: string,
  barStart: string,
  barEnd: string,
  partIndex = 0,
): Transclusion {
  return {
    id: `tx_${crypto.randomUUID()}`,
    masterId,
    barStart: String(barStart),
    barEnd: String(barEnd),
    partIndex,
    createdAt: new Date().toISOString(),
  }
}

/** A fully resolved excerpt: everything needed to render, play, annotate and cite the range. */
export interface ResolvedExcerpt {
  transclusion: Transclusion
  meta: MasterMeta
  /** The master's CURRENT parse. Re-read on every resolve — this is why fixing the master works. */
  score: Score
  /** 0-based measure indices the printed range maps to, inclusive. */
  fromIndex: number
  toIndex: number
  /**
   * What to hand OSMD. OSMD's drawFrom/drawUpToMeasureNumber are 1-based COUNTS over the measure
   * list (it derives MinMeasureToDrawIndex = n-1, then compensates by +1 when the score opens with
   * an implicit pickup). We compute them from OUR indices so the mapping is explicit and checkable,
   * instead of passing the writer's printed string and hoping the engine agrees.
   */
  osmdFrom: number
  osmdTo: number
}

export class TransclusionError extends Error {}

/**
 * Resolve an excerpt against the CURRENT master (§B6).
 *
 * Always re-reads and re-parses the master. That is deliberate: a cached parse would make an excerpt
 * stop tracking its master the moment the master changed — reintroducing the copy this design
 * exists to avoid, only with extra steps. Caching belongs above this call, keyed on the master's
 * contentHash, never inside it.
 *
 * Throws (never silently renders stale or empty) when the master is gone, or the bars don't resolve.
 */
export async function resolveTransclusion(tx: Transclusion): Promise<ResolvedExcerpt> {
  const meta = await masterMeta(tx.masterId)
  if (!meta) {
    throw new TransclusionError(
      `This excerpt points at a score that isn’t on this device any more (${tx.masterId}). Re-import the score to bring its excerpts back.`,
    )
  }
  const xml = await loadMasterXml(tx.masterId)
  if (xml === null) {
    throw new TransclusionError(
      `The score “${meta.title || meta.fileName}” is listed but its file is missing on this device.`,
    )
  }

  const score = parseMusicXml(xml)
  return resolveAgainstScore(tx, meta, score)
}

/**
 * The pure half of resolution — Score + Transclusion → indices. Separated from storage so the bar
 * mapping can be tested without OPFS, and so `resolveTransclusion` has nothing in it but I/O.
 */
export function resolveAgainstScore(tx: Transclusion, meta: MasterMeta, score: Score): ResolvedExcerpt {
  const part = score.parts[tx.partIndex]
  if (!part) {
    throw new TransclusionError(
      `This excerpt refers to part ${tx.partIndex + 1}, but “${meta.title || meta.fileName}” has ${score.parts.length}.`,
    )
  }

  const fromIndex = onlyIndexOf(score, tx.barStart, tx.partIndex, meta)
  const toIndex = onlyIndexOf(score, tx.barEnd, tx.partIndex, meta)

  if (toIndex < fromIndex) {
    throw new TransclusionError(
      `This excerpt runs from bar ${tx.barStart} to bar ${tx.barEnd}, which is backwards in “${meta.title || meta.fileName}”.`,
    )
  }

  return {
    transclusion: tx,
    meta,
    score,
    fromIndex,
    toIndex,
    // OSMD counts from 1 over the measure list; our indices count from 0.
    osmdFrom: fromIndex + 1,
    osmdTo: toIndex + 1,
  }
}

/** Map one printed bar number to exactly one index, or explain why it can't. */
function onlyIndexOf(score: Score, printed: string, partIndex: number, meta: MasterMeta): number {
  const hits = indicesOfPrintedBar(score, printed, partIndex)
  const name = meta.title || meta.fileName
  if (hits.length === 0) {
    throw new TransclusionError(`“${name}” has no bar numbered ${printed}.`)
  }
  if (hits.length > 1) {
    // Repeat endings ('8a'/'8b') and multi-movement files can repeat a printed number. Guessing the
    // first hit would render the wrong bars while looking completely normal.
    throw new TransclusionError(
      `“${name}” has ${hits.length} bars numbered ${printed}, so this excerpt is ambiguous. Cite the bar by its position instead.`,
    )
  }
  return hits[0]
}

/**
 * STRUCTURAL GUARD — is this record a reference rather than a copy?
 *
 * A negative that cannot fire is not a negative (CLAUDE.md). This one CAN: it inspects the
 * serialised record from OUTSIDE the type system, so it catches a copy smuggled in as an untyped
 * extra field — which is exactly how a "just cache the XML here for speed" change would arrive, and
 * TypeScript would not say a word about it once the object crossed a JSON boundary.
 *
 * `transclusion.test.ts` proves it fires by feeding it a deliberate copy.
 */
export function isReferenceOnly(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false
  const allowed = new Set(['id', 'masterId', 'barStart', 'barEnd', 'partIndex', 'createdAt'])
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (!allowed.has(key)) return false
    // Every legal field is a primitive address. Notation would have to arrive as a string of XML,
    // or as a nested structure — both are caught here.
    if (typeof value === 'object' && value !== null) return false
    if (typeof value === 'string' && /<\s*(score-partwise|note|measure|pitch)\b/i.test(value)) return false
  }
  return true
}
