// Synthetic ledger fixtures — for tests, for the heuristic's honest evaluation, and for the panel's
// demo mode while the `feat/prod-ledger` lane's real capture lands.
//
// NO REAL CONTENT, EVER. Every doc label here is invented. Peter's actual Honours writing must never
// enter the repo, fixtures, logs or screenshots, and metadata-only is the ledger's own rule (§A3.2).
//
// ─── WHY THE GENERATIVE MODEL IS BUILT THE WAY IT IS ─────────────────────────
//
// These fixtures are the measuring instrument for the deep-vs-shallow heuristic, so they are built
// to be capable of showing it FAILING. Two rules held throughout:
//
//   1. THE PARAMETERS COME FROM BEHAVIOUR, NOT FROM THE THRESHOLDS. Every range below is a claim
//      about how a person writes (a drafting stretch runs 18–90 minutes; you delete a bit as you
//      draft), chosen before looking at PHASE_THRESHOLDS. A fixture whose ranges are read off the
//      rule's own cut-points scores ~100% by construction and measures nothing but its own
//      circularity — the "known-negative that scored identically BY CONSTRUCTION" failure.
//
//   2. THE RANGES DELIBERATELY STRADDLE THE CUT-POINTS. Drafting runs from 18 minutes, so some
//      drafting sessions fall on the short side of the rule's 25-minute line. Editing deletes
//      80–160% of what it adds, so some editing sessions land above the rule's 0.50 add-ratio line.
//      The classes OVERLAP in both proxies, exactly as real writing does. If they didn't, the rule
//      could not fail here and this file would be a fiction that always reports success.
//
// Ground truth is the WRITER'S ACTIVITY — what the feature claims to detect — not what the proxies
// look like:
//   • drafting / burst  → composing new prose            → truth 'drafting'
//   • editing / revising → working over existing prose    → truth 'editing'
// `burst` (short but composing) and `revising` (long but cutting) are the honest hard cases: the
// spec's two proxies point OPPOSITE ways in both. They are ~35% of sessions here because they are
// common in real writing, not rare corners.

import type { DocType, LedgerSession } from './ledger'
import type { JudgedReport } from './judged'

/** The activity that actually generated a session — the label the heuristic is scored against. */
export type TruePhase = 'drafting' | 'editing'

/** The four generative processes. `burst` and `revising` are the proxy-disagreement cases. */
export type Process = 'drafting' | 'editing' | 'burst' | 'revising'

export interface LabelledSession {
  session: LedgerSession
  /** Ground truth — NEVER a field on the ledger row (that would be a schema fork, and a leak). */
  truth: TruePhase
  process: Process
}

/** Deterministic PRNG (mulberry32) — fixtures must be byte-identical run to run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const uni = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)

/**
 * The behavioural model. Each process is described in the units a writer would recognise:
 * how long they sat, how fast prose accrued, and how much they cut relative to what they put down.
 */
const PROCESS: Record<Process, {
  truth: TruePhase
  minutes: [number, number]
  /** Words ADDED per active minute. */
  wordsPerMin: [number, number]
  /** Words deleted as a fraction of words added. >1 = cutting more than adding. */
  deleteRatio: [number, number]
  /** Edit events per active minute — keystroke-batch operations, not keystrokes. */
  eventsPerMin: [number, number]
}> = {
  // A sustained compositional stretch. You delete as you go, but you're laying prose down.
  drafting: { truth: 'drafting', minutes: [18, 90], wordsPerMin: [7, 14], deleteRatio: [0.08, 0.25], eventsPerMin: [9, 18] },
  // Line-editing: tightening, cutting, reworking sentences that already exist.
  editing: { truth: 'editing', minutes: [8, 35], wordsPerMin: [2, 6], deleteRatio: [0.8, 1.6], eventsPerMin: [14, 28] },
  // A short compositional burst — twenty minutes between classes. Composing, but briefly.
  burst: { truth: 'drafting', minutes: [6, 14], wordsPerMin: [10, 16], deleteRatio: [0.05, 0.2], eventsPerMin: [10, 20] },
  // Deep restructuring: a long, heavy session working over existing text. Long AND delete-heavy.
  revising: { truth: 'editing', minutes: [40, 75], wordsPerMin: [6, 10], deleteRatio: [0.6, 1.1], eventsPerMin: [12, 22] },
}

/** Realistic mixture for an honours student's month. */
const MIX: [Process, number][] = [['drafting', 0.35], ['editing', 0.30], ['revising', 0.20], ['burst', 0.15]]

function pickProcess(r: () => number): Process {
  const x = r()
  let acc = 0
  for (const [p, w] of MIX) { acc += w; if (x < acc) return p }
  return 'drafting'
}

export interface FixtureOptions {
  seed?: number
  /** Local UTC offset written into every timestamp (§A9). Default Brisbane, +10:00, no DST. */
  offset?: string
  /** First local day, `YYYY-MM-DD`. */
  startDay?: string
  days?: number
}

/**
 * Generate a labelled synthetic month.
 *
 * The shape of a week is modelled too, because the weekly/monthly aggregates are only meaningful
 * against something week-shaped: weekends are lighter, some days are missed entirely (gaps are shown
 * honestly, never fabricated — §A9), and email sessions are sprinkled through so `doc_type` rollups
 * have something to roll up (§B2.1).
 */
export function makeLedger(opts: FixtureOptions = {}): LabelledSession[] {
  const { seed = 20260716, offset = '+10:00', startDay = '2026-07-01', days = 31 } = opts
  const r = rng(seed)
  const out: LabelledSession[] = []
  let n = 0

  for (let dayIdx = 0; dayIdx < days; dayIdx++) {
    const dayKey = addDays(startDay, dayIdx)
    const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay() // 0 = Sunday
    const weekend = dow === 0 || dow === 6

    // Some days have no writing at all. That is a real day in a real month, and the aggregates must
    // cope with it rather than being handed a tidy unbroken run.
    if (r() < (weekend ? 0.55 : 0.12)) continue

    const sessionCount = weekend ? Math.floor(uni(r, 1, 3)) : Math.floor(uni(r, 1, 5))
    // Writing starts somewhere in the morning; the day drifts later from there.
    let clock = uni(r, 8, 11) * 60
    let prevEnd: number | null = null

    for (let s = 0; s < sessionCount; s++) {
      const proc = pickProcess(r)
      const cfg = PROCESS[proc]
      const active = uni(r, cfg.minutes[0], cfg.minutes[1])
      // A session's wall-clock span exceeds its active minutes — you stare out the window.
      const span = active * uni(r, 1.05, 1.45)

      const breakBefore = prevEnd === null
        ? (dayIdx === 0 ? 0 : uni(r, 600, 900)) // overnight
        : Math.max(1, clock - prevEnd)

      const added = Math.round(active * uni(r, cfg.wordsPerMin[0], cfg.wordsPerMin[1]))
      const deleted = Math.round(added * uni(r, cfg.deleteRatio[0], cfg.deleteRatio[1]))
      const wordsStart = 800 + n * 37 // a doc that grows over the month
      const net = added - deleted

      // Email is short and mostly compositional; it rides the same schema (§B2.1).
      const isEmail = r() < 0.14 && (proc === 'burst' || proc === 'editing')
      const docType: DocType = isEmail ? 'email' : proc === 'burst' && r() < 0.3 ? 'note' : 'essay'
      const docId = isEmail ? `doc-email-${dayIdx}-${s}` : docType === 'note' ? 'doc-notes-01' : 'doc-essay-01'

      const start = isoAt(dayKey, clock, offset)
      const end = isoAt(dayKey, clock + span, offset)

      out.push({
        truth: cfg.truth,
        process: proc,
        session: {
          session_id: `s-${String(++n).padStart(4, '0')}`,
          doc_id: docId,
          doc_label: isEmail ? 'Email — supervisor check-in' : docType === 'note' ? 'Reading notes' : 'Chapter draft',
          start,
          end,
          active_minutes: round1(active),
          words_start: wordsStart,
          words_end: wordsStart + net,
          words_added: added,
          words_deleted: deleted,
          net_words: net,
          edit_events: Math.round(active * uni(r, cfg.eventsPerMin[0], cfg.eventsPerMin[1])),
          break_before_min: round1(breakBefore),
          pomodoro: r() < 0.35,
          doc_type: docType,
        },
      })

      prevEnd = clock + span
      clock = prevEnd + uni(r, 5, 95) // the break before the next session
    }
  }
  return out
}

/** Just the ledger rows — what a consumer of the real ledger would see (no labels attached). */
export function makeLedgerSessions(opts: FixtureOptions = {}): LedgerSession[] {
  return makeLedger(opts).map(l => l.session)
}

/**
 * A deliberately LIGHT day — the §A5 case that must never read as a scolding: one short session,
 * few words. Used to test that the panel's copy stays kind when the numbers are small.
 */
export function makeLightDay(offset = '+10:00'): LedgerSession[] {
  return [{
    session_id: 's-light-1',
    doc_id: 'doc-essay-01',
    doc_label: 'Chapter draft',
    start: isoAt('2026-07-14', 20 * 60 + 10, offset),
    end: isoAt('2026-07-14', 20 * 60 + 32, offset),
    active_minutes: 18,
    words_start: 4210, words_end: 4244,
    words_added: 61, words_deleted: 27, net_words: 34,
    edit_events: 143,
    break_before_min: 640,
    pomodoro: false,
    doc_type: 'essay',
  }]
}

/**
 * A synthetic AI report — the shape the `feat/prod-ai-report` lane will produce (§A6.1).
 *
 * Exists so the measured/judged seam and the §A6.2 gate are VISIBLE in demo mode rather than being
 * dead code that first runs the day the AI lane lands. The `pattern` claims below are exactly what
 * the daily window must refuse to show; the `descriptive` one is what it may.
 */
export function makeJudgedReport(sessions: readonly LedgerSession[] = []): JudgedReport {
  return {
    narrative:
      'A steady stretch. The long Tuesday and Thursday sessions carried most of the new prose, and the shorter ' +
      'sessions in between look like tidying rather than composing — which is often how a chapter settles.',
    claims: [
      { id: 'c-desc-1', kind: 'descriptive', text: 'Most of this week’s writing happened before midday.' },
      { id: 'c-pat-1', kind: 'pattern', text: 'Your longest stretches of new prose consistently follow a break of 20 minutes or more.' },
      { id: 'c-pat-2', kind: 'pattern', text: 'Mornings are where your drafting happens; afternoons are mostly editing.' },
    ],
    // A model opinion on the first few sessions, so rule-vs-AI disagreement has something to show.
    sessions: sessions.slice(0, 6).map((s, i) => ({
      session_id: s.session_id,
      phase: i % 3 === 0 ? 'shallow' : 'deep',
      confidence: 0.6 + (i % 4) * 0.1,
    })),
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` + minutes-since-local-midnight → an ISO string carrying `offset`. */
function isoAt(dayKey: string, minutesFromMidnight: number, offset: string): string {
  const total = Math.round(minutesFromMidnight)
  const dayShift = Math.floor(total / 1440)
  const m = ((total % 1440) + 1440) % 1440
  const key = dayShift ? addDays(dayKey, dayShift) : dayKey
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${key}T${hh}:${mm}:00${offset}`
}

function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
