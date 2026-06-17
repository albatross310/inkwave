// Provenance analytics for the /verify report (pure, framework-free). Descriptive only — derived from
// the same signed/anchored data the verifier checks, asserting nothing the cryptography doesn't back.
//
// Added/deleted words are computed from the SNAPSHOTS alone (their hash-verified content), as a LOWER
// BOUND: between two snapshots we only see the net change, so add/delete churn that cancels out is
// invisible — hence "at least N added / at least M deleted". (A higher-resolution figure would need
// per-period content the bundle doesn't carry.) Word counts AT snapshots are exact.

import type { ExportBundle } from '../provenance/bundle'
import { pmToText } from '../provenance/bundle'

export interface IntervalBar { t: number; added: number; removed: number } // per snapshot interval, words
export interface WordPoint { t: number; words: number }
export interface SnapshotMark { t: number; words: number; trigger: string }
export interface KickMark { t: number; old: string; replacement?: string; response: string; setVersion: number }

export interface ProvenanceStats {
  finalWords: number
  addedWords: number // ≥ lower bound (snapshot diffs)
  deletedWords: number // ≥ lower bound
  churn: number // deletedWords ÷ addedWords (0..1+)
  totalKicks: number
  swaps: number
  kicksByResponse: Record<string, number>
  snapshots: number
  sessions: number
  periods: number
  durationMs: number | null
  avgDeliberationMs: number | null
  wpm: number | null // final words ÷ active minutes
}

export interface Analytics {
  stats: ProvenanceStats
  words: WordPoint[] // cumulative word count over time (0 start + each snapshot)
  intervals: IntervalBar[] // per-snapshot added/deleted (lower bound)
  snapshots: SnapshotMark[]
  kicks: KickMark[]
  tMin: number
  tMax: number
}

const ms = (iso: string): number => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0 }
const tokens = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// Minimum word insertions/deletions to turn `prev` into `cur` by word MULTISET — a true lower bound
// (case-folded so a capitalisation change isn't counted as churn). O(words), no LCS.
function multisetDiff(prev: string, cur: string): { added: number; removed: number } {
  const fp = new Map<string, number>(), fc = new Map<string, number>()
  for (const w of tokens(prev)) fp.set(w, (fp.get(w) ?? 0) + 1)
  for (const w of tokens(cur)) fc.set(w, (fc.get(w) ?? 0) + 1)
  let added = 0, removed = 0
  for (const w of new Set([...fp.keys(), ...fc.keys()])) {
    const d = (fc.get(w) ?? 0) - (fp.get(w) ?? 0)
    if (d > 0) added += d; else removed += -d
  }
  return { added, removed }
}

export function computeAnalytics(bundle: ExportBundle): Analytics {
  const snaps = [...bundle.snapshots].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  const receipts = [...bundle.receipts].sort((a, b) => ms(a.serverTime) - ms(b.serverTime))

  // ── per-snapshot added/deleted (lower bound), and the running totals ──
  const snapshots: SnapshotMark[] = []
  const intervals: IntervalBar[] = []
  let addedWords = 0, deletedWords = 0
  let prevText = ''
  for (const s of snaps) {
    const t = ms(s.createdAt)
    const curText = pmToText(s.contentJson)
    const { added, removed } = multisetDiff(prevText, curText)
    addedWords += added; deletedWords += removed
    intervals.push({ t, added, removed })
    snapshots.push({ t, words: s.wordCount, trigger: s.trigger })
    prevText = curText
  }

  // ── kicks (old → new), at their period's signed time ──
  const kicks: KickMark[] = []
  const kicksByResponse: Record<string, number> = {}
  let deliberationSum = 0, deliberationN = 0
  for (const r of receipts) {
    const t = ms(r.serverTime)
    for (const k of r.kicks) {
      kicks.push({ t, old: k.lemma, replacement: k.replacement, response: k.response, setVersion: k.setVersion })
      kicksByResponse[k.response] = (kicksByResponse[k.response] ?? 0) + 1
      if (Number.isFinite(k.deliberationMs)) { deliberationSum += k.deliberationMs; deliberationN++ }
    }
  }

  const allT = [...snapshots.map((s) => s.t), ...kicks.map((k) => k.t)].filter((t) => t > 0)
  const tMin = allT.length ? Math.min(...allT) : 0
  const tMax = allT.length ? Math.max(...allT) : 0
  const words: WordPoint[] = [{ t: tMin, words: 0 }, ...snapshots.map((s) => ({ t: s.t, words: s.words }))]

  const finalWords = snaps.length ? snaps[snaps.length - 1].wordCount : 0
  const durationMs = tMax > tMin ? tMax - tMin : null
  const wpm = durationMs && durationMs > 0 ? Math.round(finalWords / (durationMs / 60000)) : null

  const stats: ProvenanceStats = {
    finalWords,
    addedWords,
    deletedWords,
    churn: addedWords > 0 ? Math.round((deletedWords / addedWords) * 100) / 100 : 0,
    totalKicks: kicks.length,
    swaps: kicks.filter((k) => k.replacement).length,
    kicksByResponse,
    snapshots: snaps.length,
    sessions: new Set(receipts.map((r) => r.sessionToken)).size,
    periods: receipts.length,
    durationMs,
    avgDeliberationMs: deliberationN > 0 ? Math.round(deliberationSum / deliberationN) : null,
    wpm,
  }

  return { stats, words, intervals, snapshots, kicks, tMin, tMax }
}
