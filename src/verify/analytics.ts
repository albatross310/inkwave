// Provenance analytics for the /verify report (pure, framework-free). Turns a verified ExportBundle
// into the numbers + time-series the report graphs: a words-over-time curve anchored at snapshots,
// per-0.5s insert/delete activity (paid cadence), the kick old→new swaps, and summary stats.
//
// Everything here is DESCRIPTIVE, derived from the same signed/anchored data the verifier checks —
// it asserts nothing the cryptography doesn't already back. Cadence counts are CHARACTERS (the bins
// never hold text); "words" derived from them are an estimate (chars ÷ CHARS_PER_WORD), flagged as
// such in the UI. Word COUNTS at snapshots are exact.

import type { ExportBundle } from '../provenance/bundle'
import type { TiptapJSON } from '../types/document'
import { BIN_MS } from '../provenance/cadence'

const CHARS_PER_WORD = 5.5 // rough English word + space; only for the chars→words estimate
const PASTE_INS_PER_BIN = Math.round((240 * BIN_MS) / 1000) // matches verify/index.ts paste heuristic

export interface ActivityBin { t: number; ins: number; del: number } // t = epoch ms; ins/del = chars
export interface WordPoint { t: number; words: number }
export interface SnapshotMark { t: number; words: number; trigger: string }
export interface KickMark { t: number; old: string; replacement?: string; response: string; setVersion: number }

export interface ProvenanceStats {
  finalWords: number
  charsInserted: number
  charsDeleted: number
  wordsInserted: number // estimate from chars (paid cadence only)
  wordsDeleted: number
  churn: number // chars deleted ÷ chars inserted (how much was reworked)
  hasCadence: boolean
  totalKicks: number
  swaps: number
  kicksByResponse: Record<string, number>
  snapshots: number
  sessions: number
  periods: number
  durationMs: number | null
  avgDeliberationMs: number | null
  pasteSuspectBins: number
  bins: number
  wpm: number | null // final words ÷ active minutes
}

export interface Analytics {
  stats: ProvenanceStats
  activity: ActivityBin[] // per-0.5s gross chars in/out (empty when no cadence revealed)
  words: WordPoint[] // cumulative word count over time (start 0 + each snapshot)
  snapshots: SnapshotMark[]
  kicks: KickMark[]
  tMin: number
  tMax: number
}

function countWords(content: TiptapJSON): number {
  let text = ''
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as { text?: string; content?: unknown[] }
    if (typeof node.text === 'string') text += node.text + ' '
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(content)
  return (text.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length
}

const ms = (iso: string): number => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0 }

export function computeAnalytics(bundle: ExportBundle): Analytics {
  const receipts = [...bundle.receipts].sort((a, b) => ms(a.serverTime) - ms(b.serverTime))

  // ── per-0.5s activity from cadence bins, anchored so the last bin sits at the period close ──
  const activity: ActivityBin[] = []
  let charsInserted = 0, charsDeleted = 0, pasteSuspectBins = 0
  for (const r of receipts) {
    if (!r.cadence?.length) continue
    const end = ms(r.serverTime)
    const L = r.cadence.length
    r.cadence.forEach((b, i) => {
      const t = end - (L - 1 - i) * BIN_MS
      activity.push({ t, ins: b.ins, del: b.del })
      charsInserted += b.ins
      charsDeleted += b.del
      if (b.ins > PASTE_INS_PER_BIN) pasteSuspectBins++
    })
  }
  activity.sort((a, b) => a.t - b.t)
  const hasCadence = activity.length > 0

  // ── cumulative words over time, anchored at snapshots (exact word counts) ──
  const snaps = [...bundle.snapshots].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  const snapshots: SnapshotMark[] = snaps.map((s) => ({ t: ms(s.createdAt), words: s.wordCount, trigger: s.trigger }))

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
  const totalKicks = kicks.length
  const swaps = kicks.filter((k) => k.replacement).length

  // ── time bounds across every event, then prepend a 0-words origin ──
  const allT = [
    ...activity.map((a) => a.t),
    ...snapshots.map((s) => s.t),
    ...kicks.map((k) => k.t),
  ].filter((t) => t > 0)
  const tMin = allT.length ? Math.min(...allT) : 0
  const tMax = allT.length ? Math.max(...allT) : 0

  const words: WordPoint[] = [{ t: tMin, words: 0 }, ...snapshots.map((s) => ({ t: s.t, words: s.words }))]

  const finalWords = snaps.length ? snaps[snaps.length - 1].wordCount : countWords(bundle.document.contentJson)
  const durationMs = tMax > tMin ? tMax - tMin : null
  const wpm = durationMs && durationMs > 0 ? Math.round(finalWords / (durationMs / 60000)) : null

  const stats: ProvenanceStats = {
    finalWords,
    charsInserted,
    charsDeleted,
    wordsInserted: Math.round(charsInserted / CHARS_PER_WORD),
    wordsDeleted: Math.round(charsDeleted / CHARS_PER_WORD),
    churn: charsInserted > 0 ? Math.round((charsDeleted / charsInserted) * 100) / 100 : 0,
    hasCadence,
    totalKicks,
    swaps,
    kicksByResponse,
    snapshots: snaps.length,
    sessions: new Set(receipts.map((r) => r.sessionToken)).size,
    periods: receipts.length,
    durationMs,
    avgDeliberationMs: deliberationN > 0 ? Math.round(deliberationSum / deliberationN) : null,
    pasteSuspectBins,
    bins: activity.length,
    wpm,
  }

  return { stats, activity, words, snapshots, kicks, tMin, tMax }
}
