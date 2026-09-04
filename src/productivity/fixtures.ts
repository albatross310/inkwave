// Synthetic ledger fixtures — for tests, for the heuristic's honest evaluation, and for the panel's
// demo mode.
//
// ⚠ NO REAL CONTENT, EVER. Every doc label here is invented: Peter's actual Honours writing must
// never enter the repo, fixtures, logs or screenshots, and metadata-only is the ledger's own rule
// (§A3.2).
//
// This file is the MEASURING INSTRUMENT for the deep-vs-shallow heuristic, so it is built to be
// capable of showing that rule FAILING. Two rules hold throughout:
//  1. ⚠ THE PARAMETERS COME FROM BEHAVIOUR, NEVER FROM THE THRESHOLDS. Every range is a claim about
//     how a person writes, chosen before looking at PHASE_THRESHOLDS. Ranges read off the rule's own
//     cut-points score ~100% by construction and measure nothing but their own circularity.
//  2. ⚠ THE CLASSES MUST OVERLAP IN THE PROXY THE RULE ACTUALLY USES — not "in both proxies", in the
//     SHIPPED one. This file's first version got (1) right and (2) wrong, and the 0.70 cut sat in a
//     void where every mutant scored identically.
//     → docs/archive/productivity-email-build.md#phase-fixture-void
//
// GROUND TRUTH IS THE WRITER'S ACTIVITY, not what the proxies look like: drafting/burst ⇒ 'drafting',
// editing/revising ⇒ 'editing'. `burst` (short but composing) and `revising` (long but cutting) are
// the honest hard cases — the spec's two proxies point OPPOSITE ways in both — and they are ~35% of
// sessions because they are common in real writing, not rare corners.
//
// ⚠ WHAT IT CANNOT SETTLE: being synthetic, it can prove a rule INSENSITIVE and show a rule's shape,
// but it CANNOT calibrate a threshold — tuning cut-points on data invented by the same author who
// chose them is circular the other way. Read the sweep as a sensitivity analysis, never a
// recommendation.

import type { DocGoals, Snapshot } from '../types/document'
import type { DocType, SessionRow } from './types'
import type { JudgedReport } from './judged'

/** The activity that actually generated a session — the label the heuristic is scored against. */
export type TruePhase = 'drafting' | 'editing'

/** The four generative processes. `burst` and `revising` are the proxy-disagreement cases. */
export type Process = 'drafting' | 'editing' | 'burst' | 'revising'

export interface LabelledSession {
  session: SessionRow
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
  // A sustained compositional stretch. An EASY one cuts ~8% of what it lays down; a HARD one —
  // wrestling the same paragraph of an argument into shape, which is most of thesis writing — cuts
  // most of it and still ends the session with new prose on the page. That upper reach (0.75 ⇒
  // addRatio 0.57) is why drafting overlaps editing at all, and it is the honest part: a hard
  // drafting hour genuinely LOOKS like editing to a word counter.
  drafting: { truth: 'drafting', minutes: [18, 90], wordsPerMin: [7, 14], deleteRatio: [0.08, 0.75], eventsPerMin: [9, 18] },
  // Line-editing: tightening, cutting, reworking sentences that already exist. Usually net-negative,
  // but rewriting a sentence in place adds nearly as much as it removes (0.65 ⇒ addRatio 0.61).
  editing: { truth: 'editing', minutes: [8, 35], wordsPerMin: [2, 6], deleteRatio: [0.65, 2.5], eventsPerMin: [14, 28] },
  // A short compositional burst — twenty minutes between classes. Composing, and little
  // second-guessing: this is the least ambiguous class in the ratio proxy.
  burst: { truth: 'drafting', minutes: [6, 14], wordsPerMin: [10, 16], deleteRatio: [0.04, 0.35], eventsPerMin: [10, 20] },
  // Deep restructuring: a long, heavy session working over existing text. Cutting hard, but also
  // writing the new connective prose that restructuring demands — so it can add well over what it
  // cuts (0.45 ⇒ addRatio 0.69) while the writer is unambiguously working over what's already there.
  // Capped at 0.45: below that the writer is composing more than restructuring and the 'editing'
  // truth label would stop being defensible. The fixture must not manufacture errors by mislabelling.
  revising: { truth: 'editing', minutes: [40, 75], wordsPerMin: [6, 10], deleteRatio: [0.45, 1.5], eventsPerMin: [12, 22] },
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
 * Generate a labelled synthetic month. A WEEK is modelled too, because the weekly/monthly
 * aggregates are only meaningful against something week-shaped: weekends are lighter, some days are
 * missed entirely (gaps shown honestly, never fabricated — §A9), and email sessions are sprinkled
 * through so `doc_type` rollups have something to roll up (§B2.1).
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
          entered: 'timer',
        },
      })

      prevEnd = clock + span
      clock = prevEnd + uni(r, 5, 95) // the break before the next session
    }
  }
  return out
}

/** Just the ledger rows — what a consumer of the real ledger would see (no labels attached). */
export function makeSessionRows(opts: FixtureOptions = {}): SessionRow[] {
  return makeLedger(opts).map(l => l.session)
}

/**
 * A deliberately LIGHT day — the §A5 case that must never read as a scolding: one short session,
 * few words. Used to test that the panel's copy stays kind when the numbers are small.
 */
export function makeLightDay(offset = '+10:00'): SessionRow[] {
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
    entered: 'timer',
  }]
}

/**
 * A synthetic AI report — the §A6.1 shape. It exists so the measured/judged seam and the §A6.2 gate
 * are VISIBLE in demo mode rather than dead code that first runs the day the AI lane lands. The
 * `pattern` claims below are exactly what the daily window must refuse; `descriptive` is what it may.
 */
export function makeJudgedReport(sessions: readonly SessionRow[] = []): JudgedReport {
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

// ─── P1c (AI report) demo fixtures ───────────────────────────────────────────
// Merged from the prod-ai-report lane: independent of the generative model above, these are
// the deterministic WindowAggregate + demo prose the report panel's `?prodReport=demo` reads.
// No export names collide with the graphs lane's; the two are complementary.

// `SessionRow`/`DocType` are already imported at the top of this file — both lanes now read the
// ONE schema (types.ts), so there is nothing left to import twice.
import type { DayAggregate, DayNoteDigest, WindowAggregate, WindowDoc } from './types'

const DOCS: WindowDoc[] = [
  { doc_id: 'doc-essay', doc_label: 'Seminar paper draft', doc_type: 'essay', active_minutes: 214, session_count: 5 },
  { doc_id: 'doc-journal', doc_label: 'Journal', doc_type: 'note', active_minutes: 38, session_count: 3 },
  { doc_id: 'doc-mail', doc_label: 'Email to supervisor', doc_type: 'email', active_minutes: 21, session_count: 2 },
]

/** Deterministic filler prose for the content tick-box demo. Invented; means nothing. */
export const DEMO_TEXT: Record<string, string> = {
  'doc-essay': 'The argument so far runs in three steps. First, the distinction only does work if '
    + 'the middle case is genuinely excluded rather than merely unnamed. Second, the examples in '
    + 'the literature are all drawn from one side. Third, and this is the part still missing, the '
    + 'objection has to be met on its own terms rather than restated.',
  'doc-journal': 'Slow start. Read for an hour before writing anything. The paragraph about the '
    + 'second objection still is not right but I know what it is trying to say now.',
  'doc-mail': 'Thanks for the notes on the draft — I have restructured the middle section and will '
    + 'send it through before Friday.',
}

function hours(spec: Record<number, number>): number[] {
  const h = new Array(24).fill(0)
  for (const [k, v] of Object.entries(spec)) h[Number(k)] = v
  return h
}

const DAYS: DayAggregate[] = [
  { day: '2026-07-06', active_minutes: 92, session_count: 3, words_added: 640, words_deleted: 120, net_words: 520, edit_events: 412, break_count: 2, break_total_min: 25, deep_shallow_ratio: 1.8, busiest_hours: hours({ 9: 45, 10: 30, 16: 17 }), posthoc_minutes: 0, posthoc_session_count: 0 },
  { day: '2026-07-07', active_minutes: 24, session_count: 1, words_added: 90, words_deleted: 210, net_words: -120, edit_events: 180, break_count: 0, break_total_min: 0, deep_shallow_ratio: 0.4, busiest_hours: hours({ 21: 24 }), posthoc_minutes: 0, posthoc_session_count: 0 },
  { day: '2026-07-08', active_minutes: 118, session_count: 4, words_added: 810, words_deleted: 95, net_words: 715, edit_events: 530, break_count: 3, break_total_min: 40, deep_shallow_ratio: 2.1, busiest_hours: hours({ 8: 50, 9: 40, 14: 28 }), posthoc_minutes: 0, posthoc_session_count: 0 },
  { day: '2026-07-09', active_minutes: 0, session_count: 0, words_added: 0, words_deleted: 0, net_words: 0, edit_events: 0, break_count: 0, break_total_min: 0, deep_shallow_ratio: 0, busiest_hours: hours({}), posthoc_minutes: 0, posthoc_session_count: 0 },
  { day: '2026-07-10', active_minutes: 39, session_count: 2, words_added: 150, words_deleted: 300, net_words: -150, edit_events: 260, break_count: 1, break_total_min: 12, deep_shallow_ratio: 0.5, busiest_hours: hours({ 11: 22, 15: 17 }), posthoc_minutes: 45, posthoc_session_count: 1 },
]

// `note` and `place` are the writer's own words (tier 2) — invented here, and deliberately the
// kind of thing that must NOT travel without an explicit tick.
const SESSIONS: SessionRow[] = [
  { session_id: 's-1', doc_id: 'doc-essay', doc_label: 'Seminar paper draft', start: '2026-07-06T09:05:00+10:00', end: '2026-07-06T09:50:00+10:00', active_minutes: 45, words_start: 1200, words_end: 1560, words_added: 400, words_deleted: 40, net_words: 360, edit_events: 210, break_before_min: 0, pomodoro: true, doc_type: 'essay', entered: 'timer', place: 'library', note: 'Finally got the third step of the argument down.' },
  { session_id: 's-2', doc_id: 'doc-essay', doc_label: 'Seminar paper draft', start: '2026-07-06T10:10:00+10:00', end: '2026-07-06T10:40:00+10:00', active_minutes: 30, words_start: 1560, words_end: 1700, words_added: 190, words_deleted: 50, net_words: 140, edit_events: 150, break_before_min: 20, pomodoro: true, doc_type: 'essay', entered: 'timer', place: 'library', note: 'Tired by the end of this one.' },
  // s-4 deliberately falls AFTER the last snapshot, so the record has no boundary for it: the
  // demo must show the honest "the record cannot say what this produced" gap, not only the happy
  // path. words_added is non-zero on purpose — the gap is in the RECORD, not in the work.
  { session_id: 's-4', doc_id: 'doc-essay', doc_label: 'Seminar paper draft', start: '2026-07-06T16:00:00+10:00', end: '2026-07-06T16:30:00+10:00', active_minutes: 25, words_start: 1700, words_end: 1810, words_added: 130, words_deleted: 20, net_words: 110, edit_events: 88, break_before_min: 320, pomodoro: false, doc_type: 'essay', entered: 'timer' },
  { session_id: 's-3', doc_id: 'doc-journal', doc_label: 'Journal', start: '2026-07-06T16:30:00+10:00', end: '2026-07-06T16:47:00+10:00', active_minutes: 17, words_start: 0, words_end: 20, words_added: 50, words_deleted: 30, net_words: 20, edit_events: 52, break_before_min: 350, pomodoro: false, doc_type: 'note', entered: 'timer' },
]

/**
 * The weekly/monthly tier-2 carrier — the SAME days/notes/places the SESSIONS above hold, rolled up
 * per local day exactly as `aggregate.ts`'s `noteDigest()` does it from a real ledger.
 */
const NOTE_DIGEST: DayNoteDigest[] = [
  {
    day: '2026-07-06',
    notes: SESSIONS.filter(s => s.note).map(s => s.note!),
    places: [...new Set(SESSIONS.filter(s => s.place).map(s => s.place!))],
  },
]

export function fixtureWindow(window: 'daily' | 'weekly' | 'monthly'): WindowAggregate {
  if (window === 'daily') {
    return {
      window, from: '2026-07-06', to: '2026-07-06',
      days: [DAYS[0]], sessions: SESSIONS, docs: DOCS.slice(0, 2),
    }
  }
  return {
    window,
    from: '2026-07-06',
    to: window === 'weekly' ? '2026-07-12' : '2026-07-31',
    days: DAYS,
    // ⚠ `sessions` IS EMPTY AT WEEKLY/MONTHLY — the decided contract (§A6.4), and these fixtures
    // must MIRROR it: carrying the pre-answer shape is what made the weekly/monthly notes break
    // invisible, because `?prodReport=demo` kept working off rows the real ledger never sends.
    // A demo whose shape the real source never produces is a fiction to build against.
    // → docs/archive/productivity-email-build.md#compile-note-digest
    sessions: [],
    note_digest: NOTE_DIGEST,
    docs: DOCS,
  }
}

// ─── §A5b demo goals, and the snapshots the ledger+doc combo pairs against ──────────────────
// WHOLLY INVENTED, like everything else here. Note `doc-journal` deliberately has NO goal: the
// no-goal branch ("describe, don't push") is the DEFAULT state of every real document today —
// nothing authors goals yet — so the demo must be able to show it rather than only the happy path.

export const DEMO_GOALS: Record<string, DocGoals> = {
  'doc-essay': {
    goal: 'A publishable 6,000-word seminar paper on the excluded middle. Done means the third '
      + 'objection is answered on its own terms, not restated.',
    plan: 'Rough: argument skeleton by the 8th, full draft by the 15th, then a week of cutting. '
      + 'The middle section is the hard part and I keep avoiding it.',
    updatedAt: '2026-07-01T09:00:00+10:00',
  },
}

const demoDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

function demoSnap(id: string, createdAt: string, text: string): Snapshot {
  return {
    id,
    documentId: 'doc-essay',
    createdAt,
    trigger: 'paragraph',
    wordCount: text.split(/\s+/).filter(Boolean).length,
    contentHash: `demo-${id}`,
    contentJson: demoDoc(text),
  } as Snapshot
}

const ESSAY_V1 = 'The argument so far runs in three steps.'
const ESSAY_V2 = ESSAY_V1 + ' First, the distinction only does work if the middle case is '
  + 'genuinely excluded rather than merely unnamed.'
const ESSAY_V3 = ESSAY_V2 + ' Second, the examples in the literature are all drawn from one side.'

/** Snapshots bracketing the fixture's sessions, so excerptForSession has real boundaries. */
export const DEMO_SNAPSHOTS: Record<string, Snapshot[]> = {
  'doc-essay': [
    demoSnap('d1', '2026-07-06T09:00:00+10:00', ESSAY_V1),   // just before s-1
    demoSnap('d2', '2026-07-06T09:45:00+10:00', ESSAY_V2),   // inside s-1
    demoSnap('d3', '2026-07-06T10:35:00+10:00', ESSAY_V3),   // inside s-2
  ],
}
