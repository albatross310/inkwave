// Compile — spec §A7.1.1. Assembles the analysis-ready payload for a window.
//
// COMPACT ROLLUPS, NOT RAW LOGS (§A3.3): this is what keeps the payload small regardless of
// window, and it is why a monthly report neither blows up token counts nor degrades. Session
// rows go out ONLY for the daily window, where the judged rows are per-session and there are a
// handful of them; weekly and monthly send day rollups alone.
//
// ON §A6.4: measured numbers DO go out — the model cannot narrate a day it cannot see. What the
// rule forbids is the ROUND TRIP: they must not come BACK. That half is enforced in judged.ts
// (a judged table carrying measured columns is rejected outright) and claims.ts (numbers in the
// narrative that Inkwave did not send are flagged). Nothing here is graphed from the reply.
//
// ─── THE PAYLOAD IS AN ALLOW-LIST, AND THAT IS THE POINT ────────────────────────────────────
// Every field that leaves is NAMED in this file. Nothing iterates a ledger row and emits what it
// finds. So a field the ledger gains tomorrow — a place label, a diary note, whatever comes
// after — cannot leak by default: it is simply not emitted until someone deliberately adds it
// here, and adding it means choosing a consent tier for it. A deny-list would have the opposite
// failure mode, and that failure is silent.
//
// FOUR TIERS (Peter, 2026-07-17 — notes and places SPLIT on his instruction):
//   1. session metadata (times, words, edits) — always included
//   2a. diary notes                          — opt-in, OFF by default   ← `includeNotes`
//   2b. place labels                         — opt-in, OFF by default   ← `includePlaces`
//   3. per-document text                     — opt-in, OFF by default, per document (§A7.3)
//   3b. per-session excerpts                 — the ledger+doc combo; gated by 3, daily only
// Tier 2 exists because tiers 1 and 3 alone would let the writer's own prose ride out inside
// "metadata": "metadata only" would quietly mean "and what I wrote about my day".
//
// WHY 2a AND 2b ARE SEPARATE (Peter: "separate session notes from places into two tick boxes"):
// they are one tier by provenance — both are words the writer typed — and two different
// disclosures by SENSITIVITY. A place label is one word ("library"); a diary note is a paragraph
// about the writer's day, and may be about anything at all. Bundling them forced an
// all-or-nothing choice across a real gap in exposure. Note the place label is text the WRITER
// TYPED — not geolocation, nothing harvested (§C1.4).

import type { DocGoals } from '../../types/document'
import type { DayAggregate, SessionRow, WindowAggregate, WindowDoc } from '../types'
import { milestoneStatus, type GoalStatus } from '../goals'
import { isoWithOffset, localDayOf } from '../sessionLogic'
import { assemblePrompt, fixedPrompt } from './prompt'
import { BASELINE_WARN_MIN, type SessionExcerpt } from './excerpts'

export interface CompileOpts {
  agg: WindowAggregate
  /**
   * TIER 2a — include the writer's end-of-session diary notes. OFF by default: absent or false
   * means not one word of them leaves.
   */
  includeNotes?: boolean
  /**
   * TIER 2b — include the place labels the writer typed. OFF by default, and INDEPENDENT of
   * `includeNotes`: a writer may share where they worked without sharing what they wrote about
   * their day, or the reverse.
   */
  includePlaces?: boolean
  /** Doc ids the writer ticked for content (§A7.3). Off by default; per-document, never blanket. */
  contentDocIds?: string[]
  /** Plain text per doc id, supplied by the caller for ticked docs only. */
  contentText?: Record<string, string>
  /**
   * TIER 3, finer slice — what each session PRODUCED, paired from the snapshot record
   * (excerpts.ts). Supplied by the caller for ticked documents only, and only at the daily
   * window. Absent ⇒ no pairing section, exactly as before.
   */
  excerpts?: SessionExcerpt[]
  /**
   * TIER 2c (§A5b) — the writer's goal + rough plan per doc id. Supplied by the caller only when
   * the goals tick is on. Absent/empty ⇒ the payload says NO GOALS WERE SHARED and the prompt
   * forbids inventing a standard. Do not synthesise an entry to "fill the section".
   */
  goals?: Record<string, DocGoals>
  /** The optional user-written second half of the prompt (§A7.1.2). */
  userPrompt?: string
}

export interface CompiledPayload {
  /** The whole thing, ready to copy. */
  text: string
  /** The fixed, publicly-visible first half — shown verbatim in the panel. */
  fixed: string
  /** The data section alone. Also the allow-list source for the invented-number check. */
  data: string
  contentIncluded: boolean
  /** True when at least one diary note is in the payload. */
  notesIncluded: boolean
  /** True when at least one place label is in the payload. */
  placesIncluded: boolean
  /** True when the session→prose pairing is in the payload. */
  excerptsIncluded: boolean
  /** True when at least one goal/plan is in the payload — what licenses the report to push. */
  goalsIncluded: boolean
  /** Exactly the docs whose text is in the payload. */
  includedDocIds: string[]
}

function pad(s: string | number, n: number): string {
  const v = String(s)
  return v.length >= n ? v : v + ' '.repeat(n - v.length)
}

function table(headers: string[], rows: (string | number)[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)))
  const line = (cells: (string | number)[]) =>
    cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()
  return [line(headers), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

function dayRows(days: DayAggregate[]): (string | number)[][] {
  return days.map(d => [
    d.day, d.active_minutes, d.session_count, d.words_added, d.words_deleted,
    d.net_words, d.edit_events, d.break_count, d.break_total_min,
    d.deep_shallow_ratio.toFixed(2), d.posthoc_minutes,
  ])
}

/** Non-zero hours only — a 24-column histogram per day is mostly zeros and pure token cost. */
function hoursSection(days: DayAggregate[]): string {
  const lines = days
    .map(d => {
      const busy = d.busiest_hours
        .map((mins, hour) => ({ mins, hour }))
        .filter(h => h.mins > 0)
        .map(h => `${String(h.hour).padStart(2, '0')}h ${h.mins}m`)
      return busy.length ? `${d.day}: ${busy.join(', ')}` : `${d.day}: no active minutes recorded`
    })
  return lines.join('\n')
}

function sessionRows(sessions: SessionRow[]): (string | number)[][] {
  return sessions.map(s => [
    s.session_id, labelOf(s.doc_id, s.doc_label), s.doc_type,
    s.start, s.end, s.active_minutes, s.words_added, s.words_deleted, s.net_words,
    s.edit_events, s.break_before_min, s.pomodoro ? 'yes' : 'no',
  ])
}

/** A doc whose label is suppressed travels as its id — §A3.2 keeps titles optional on purpose. */
function labelOf(docId: string, label?: string): string {
  return label && label.trim() ? label : docId
}

function docsSection(docs: WindowDoc[], included: Set<string>): string {
  return table(
    ['document', 'type', 'active_minutes', 'sessions', 'text'],
    docs.map(d => [
      labelOf(d.doc_id, d.doc_label), d.doc_type, d.active_minutes, d.session_count,
      included.has(d.doc_id) ? 'included below' : 'metadata only',
    ]),
  )
}

// ─── Tier 2a/2b: the writer's diary notes and place labels, gated INDEPENDENTLY ─────────────

/** One rendered tier-2 line. `place`/`note` are '' when that tier is off — never a placeholder. */
interface NoteLine { when: string; place: string; note: string }

/**
 * THE TIER-2 CARRIER (§A7.3) — read from the ledger's `note_digest` first, sessions second.
 *
 * WHY BOTH, and why the digest leads (feat/prod-integrate, 2026-07-17): this module was built while
 * `feat/prod-ledger` was still in flight, and it asked that branch for session rows at every window
 * because a note is per-session. The ledger lane ANSWERED — `sessions` is `[]` at weekly/monthly and
 * opted-in notes travel as `note_digest`, per LOCAL day — because rows at monthly would put a SECOND
 * copy of every measured number beside the day rollups (§A6.4), and two copies is how a narrative
 * ends up contradicting the bars. This function is that answer being honoured.
 *
 * It was a SILENT break, which is why it is worth this comment: reading only `agg.sessions`, a
 * writer who ticked "include my notes" on a WEEKLY or MONTHLY report got a payload with no notes in
 * it, `notesIncluded: false`, and no error anywhere — the tick-box simply did nothing. Both lanes'
 * suites were green; the demo fixtures still carried the old shape, so the path a developer eyeballs
 * worked while the real ledger's did not. Proved end-to-end in emailLedger.integration.test.ts.
 *
 * The session fallback is kept deliberately: DAILY rows legitimately carry notes, and a source that
 * predates the digest (the `?prodReport=demo` fixtures) must not silently lose them either.
 *
 * THE TWO GATES ARE APPLIED HERE, AT THE READ (Peter's split, 2026-07-17). `notes`/`places` are
 * read only when their own tick is on, so an un-ticked field is never in the returned data at all —
 * not filtered out later, not blanked at render. There is no downstream place for it to leak from.
 */
function noteLines(agg: WindowAggregate, wantNotes: boolean, wantPlaces: boolean): NoteLine[] {
  const lines: NoteLine[] = []
  if (agg.note_digest && agg.note_digest.length) {
    for (const d of agg.note_digest) {
      const place = wantPlaces ? d.places.join(', ').trim() : ''
      const notes = wantNotes ? d.notes.map(n => n.trim()).filter(Boolean) : []
      // A day with places but no note still says where the writer worked — it is their word either
      // way, and dropping it would quietly discard part of what they opted into.
      if (!notes.length) {
        if (place) lines.push({ when: d.day, place, note: '' })
        continue
      }
      for (const n of notes) lines.push({ when: d.day, place, note: n })
    }
    return lines
  }
  for (const s of agg.sessions) {
    const place = wantPlaces ? (s.place ?? '').trim() : ''
    const note = wantNotes ? (s.note ?? '').trim() : ''
    if (place || note) lines.push({ when: s.start, place, note })
  }
  return lines
}

/**
 * The place label is rendered as the plain string the writer typed. It is deliberately NOT
 * parsed, geocoded or interpreted — it is a word, and treating it as anything more would be the
 * beginning of exactly the claim we must not make.
 *
 * The COLUMNS follow the ticks: a payload with places and no notes carries no `note` column at
 * all. An empty column would tell the model a note existed and was withheld, which is a different
 * (and wrong) statement from "the writer did not share notes".
 */
function notesSection(lines: NoteLine[], hasNotes: boolean, hasPlaces: boolean): string {
  const headers = ['when', ...(hasPlaces ? ['place'] : []), ...(hasNotes ? ['note'] : [])]
  const rows = lines.map(l => [
    l.when,
    ...(hasPlaces ? [l.place || '—'] : []),
    ...(hasNotes ? [l.note || '—'] : []),
  ])
  const what = hasNotes && hasPlaces
    ? 'their diary line and the place they typed for it'
    : hasNotes ? 'their diary line for each session' : 'the place they typed for each session'
  const intro = [
    `THE WRITER'S OWN WORDS (they chose to include ${hasNotes && hasPlaces ? 'these' : 'this'})`,
    '',
    `These are the writer's words: ${what}. Read them as context for how the work felt. Do not`,
    'treat a note as a task list, do not grade it, and do not repeat it back at length.',
  ]
  // §A9 + honest degradation: say what is ABSENT, so the model cannot mistake a withheld field
  // for a fact about the writer. Without this, "they never recorded where they worked" and "they
  // chose not to share it" are indistinguishable — and the first is a claim we'd be inventing.
  if (!hasPlaces) {
    intro.push(
      '',
      'The writer did NOT share their place labels, so you do not know where they worked. Do not',
      'guess, and do not say anything about where — not even that it is unknown to them.',
    )
  }
  if (!hasNotes) {
    intro.push(
      '',
      'The writer did NOT share their diary notes, so you do not know how the sessions felt to',
      'them or what was going on around them. Do not infer it from the place alone.',
    )
  }
  return [
    ...intro,
    '',
    // Keyed by WHEN, not by session_id: the digest is per-day and carries no session id (§A6.4 —
    // it holds the writer's words and nothing measured, so there is no row to point at).
    table(headers, rows),
  ].join('\n')
}

// ─── The ledger+doc combo: what each session produced (Peter, 2026-07-17) ───────────────────

/**
 * Pairs each session with the prose that appeared during it. §A7.3 gates every word: the caller
 * supplies excerpts for TICKED documents only, so this renders what it is handed and never reads
 * a document itself.
 *
 * Sessions whose excerpt is missing are LISTED, not omitted (§A9). A silent gap would read to the
 * model — and to the writer — as "nothing happened here", when the truth is "the snapshot record
 * has no boundary here"; the measured words_added for that session may be substantial. Saying so
 * is the difference between an honest gap and a fabricated zero.
 */
function excerptsSection(sessions: SessionRow[], excerpts: SessionExcerpt[]): string {
  const byId = new Map(excerpts.map(e => [e.session_id, e]))
  const blocks = sessions.flatMap(s => {
    const e = byId.get(s.session_id)
    if (!e) return []
    const head = `--- ${s.session_id} · ${labelOf(s.doc_id, s.doc_label)} · ${s.start} → ${s.end} `
      + `(${s.active_minutes} min) ---`
    if (!e.added) {
      const why = e.reason === 'no-change'
        ? 'The record shows no new text for this session (it may have been editing rather than adding).'
        : 'No snapshot boundary falls in this session, so the record cannot say what it produced. '
          + 'That is a gap in the record, NOT the writer doing nothing.'
      return [`${head}\n(${why})`]
    }
    const wide = e.baselineAgeMin !== undefined && e.baselineAgeMin > BASELINE_WARN_MIN
      ? `\n(NB the last snapshot before this session was ${e.baselineAgeMin} minutes earlier, so `
        + `this excerpt may include work from before it — do not pin it precisely.)`
      : ''
    return [`${head}${wide}\n${e.added}`]
  })
  return [
    'WHAT EACH SESSION PRODUCED (from Inkwave\'s snapshot record, for the documents the writer',
    'chose to include)',
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

/**
 * §A5b — the writer's goals, verbatim.
 *
 * Rendered as the writer typed them. Nothing here summarises, normalises or interprets a goal:
 * the entire legitimacy of §A5's reversed tone rests on the model quoting the writer's OWN
 * standard back at them, and a goal we paraphrased is no longer theirs.
 */
/**
 * §A6.4 — Inkwave computes whether a dated milestone was MET (a comparison of two dates the writer
 * supplied); the model is handed the VERDICT, never the raw dates to compare. "Did I hit my
 * deadline" is exactly the claim an LLM must not silently re-derive. The due date rides along as
 * context (it is the writer's own datum), but the met/missed judgement is Inkwave's.
 */
function milestoneVerdict(status: GoalStatus, days?: number): string {
  const d = Math.abs(days ?? 0)
  const day = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  switch (status) {
    case 'met': return 'MET (done on or before the date)'
    case 'met-late': return 'MET BUT LATE (done, after the date the writer set)'
    case 'missed': return `MISSED (${day(d)} past the date, still not done)`
    case 'due-today': return 'DUE TODAY (not yet done)'
    case 'upcoming': return `not yet due (${day(d)} to go)`
    case 'undated': return 'no date set'
  }
}

function goalsSection(docs: WindowDoc[], goals: Record<string, DocGoals>, today: string): string {
  const blocks = Object.entries(goals).map(([id, g]) => {
    const doc = docs.find(d => d.doc_id === id)
    // `misc`, not `other`: `other` is a kind we recognise and haven't enumerated; `misc` is an
    // honest "we don't know". A doc we cannot find in the window is the second (types/document.ts
    // warns not to collapse them).
    const lines = [`--- ${labelOf(id, doc?.doc_label)} (${doc?.doc_type ?? 'misc'}) ---`]
    if ((g.goal ?? '').trim()) lines.push(`GOAL: ${g.goal!.trim()}`)
    if ((g.plan ?? '').trim()) lines.push(`PLAN: ${g.plan!.trim()}`)
    // THE TIMELINE (Peter, 2026-07-17: "goals should include a timeline and then ai can fill in how
    // they actually do" — the "kick up the butt" is impossible without this reaching the model). It
    // was authored and stored on the document and SILENTLY DROPPED here before the model saw it.
    const ms = (g.milestones ?? []).filter(m => (m.text ?? '').trim())
    if (ms.length) {
      lines.push('MILESTONES (the writer\'s timeline — Inkwave computed each verdict; report against it, do not re-judge the dates yourself):')
      for (const m of ms) {
        const { status, days_remaining } = milestoneStatus(m, today)
        const due = m.due ? ` [due ${m.due}]` : ''
        lines.push(`  • ${m.text!.trim()}${due} — ${milestoneVerdict(status, days_remaining)}`)
      }
    }
    if (g.updatedAt) lines.push(`(the writer last revised this on ${g.updatedAt})`)
    return lines.join('\n')
  })
  return [
    "THE WRITER'S GOALS AND PLANS (their own words — they chose to include these)",
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

function contentSection(docs: WindowDoc[], included: string[], text: Record<string, string>): string {
  const blocks = included.map(id => {
    const doc = docs.find(d => d.doc_id === id)
    const body = (text[id] ?? '').trim()
    return [
      `--- ${labelOf(id, doc?.doc_label)} (${doc?.doc_type ?? 'misc'}) ---`,
      body || '(this document has no text)',
    ].join('\n')
  })
  return ['DOCUMENT TEXT (the writer chose to include these)', '', blocks.join('\n\n')].join('\n')
}

/** Build the data section — the compact rollups, plus whatever the writer opted into. */
export function compileData(
  opts: CompileOpts,
): {
  data: string
  includedDocIds: string[]
  notesIncluded: boolean
  placesIncluded: boolean
  excerptsIncluded: boolean
  goalsIncluded: boolean
} {
  const { agg } = opts
  // Only ever include a doc that is actually IN the window — a stale tick must not smuggle a
  // document the writer is not looking at into the payload.
  const inWindow = new Set(agg.docs.map(d => d.doc_id))
  const includedDocIds = (opts.contentDocIds ?? []).filter(id => inWindow.has(id))
  const included = new Set(includedDocIds)

  const parts: string[] = [
    'DATA — measured by Inkwave on this device',
    '',
    `Window: ${agg.window}, ${agg.from} to ${agg.to} (the writer's local days).`,
    'These are the exact measured numbers. Inkwave graphs them itself; you narrate them.',
    '',
    'DAYS',
    '',
    // `posthoc_minutes` is a SEPARATE COLUMN and the prose below says what it is. The report has to
    // be able to say "3h40m measured, plus 45m you added from memory"; totalling them silently is
    // the lie (§A6.1). Naming it here is also what stops the model doing the addition for us — it is
    // told the two are different KINDS of number, not two parts of one.
    table(
      ['day', 'active_minutes', 'sessions', 'words_added', 'words_deleted', 'net_words',
        'edit_events', 'breaks', 'break_total_min', 'deep_shallow_ratio', 'posthoc_minutes'],
      dayRows(agg.days),
    ),
    '',
    'ABOUT posthoc_minutes',
    '',
    'active_minutes is time Inkwave TIMED. posthoc_minutes is time the writer added afterwards from',
    'memory, because they forgot to start the timer — their recollection, which nothing can check.',
    'Never add the two into one total, and never describe posthoc_minutes as measured or tracked. You',
    'may mention it alongside ("3h40m tracked, plus 45m they added from memory"). Adding time from',
    'memory is ordinary record-keeping: do not treat it as a lapse, and do not comment on how often',
    'they use it.',
    '',
    'ACTIVE MINUTES BY LOCAL HOUR',
    '',
    hoursSection(agg.days),
  ]

  // §A3.3/§A6.3: raw session rows only where the judged rows are per-session.
  if (agg.window === 'daily') {
    parts.push(
      '',
      'SESSIONS',
      '',
      table(
        ['session_id', 'document', 'type', 'start', 'end', 'active_minutes', 'words_added',
          'words_deleted', 'net_words', 'edit_events', 'break_before_min', 'pomodoro'],
        sessionRows(agg.sessions),
      ),
    )
  }

  parts.push('', 'DOCUMENTS IN THIS WINDOW', '', docsSection(agg.docs, included))

  // TIER 2a/2b — each on its own explicit opt-in, and only where there is something to say. The
  // carrier is `note_digest` (per local day) with a session-row fallback; see noteLines(). The day
  // rollups above remain the only measured data sent, at every window.
  const wantNotes = opts.includeNotes === true
  const wantPlaces = opts.includePlaces === true
  const noted = wantNotes || wantPlaces ? noteLines(agg, wantNotes, wantPlaces) : []
  const notesIncluded = noted.some(l => l.note !== '')
  const placesIncluded = noted.some(l => l.place !== '')
  if (notesIncluded || placesIncluded) {
    parts.push('', notesSection(noted, notesIncluded, placesIncluded))
  }

  // TIER 3 — document text, per ticked document.
  if (includedDocIds.length) {
    parts.push('', contentSection(agg.docs, includedDocIds, opts.contentText ?? {}))
  }

  // TIER 2c (§A5b) — goals, only on their own tick, and only for docs in this window. A stale
  // tick must not smuggle in the goal of a document the writer is not looking at.
  const goals = Object.fromEntries(
    Object.entries(opts.goals ?? {}).filter(([id]) => inWindow.has(id)),
  )
  const goalsIncluded = Object.keys(goals).length > 0
  // `today` is the writer's LOCAL day now — the report is compiled at request time, and milestone
  // verdicts are "as of today". Computed once so every milestone in the payload judges against the
  // same day.
  const today = localDayOf(isoWithOffset(Date.now(), -new Date().getTimezoneOffset()))
  if (goalsIncluded) parts.push('', goalsSection(agg.docs, goals, today))

  // THE LEDGER+DOC COMBO — only where it can be honest. Two independent conditions, and both are
  // structural rather than stylistic:
  //   • the writer ticked a document (§A7.3 — an excerpt IS document prose), and
  //   • there are session rows to pair against, which the ledger contract supplies at the DAILY
  //     window only (`sessions: []` at weekly/monthly, §A6.4). So per-session pairing is a daily
  //     artifact by construction, and §A7.3's own "content is best on the daily window" agrees.
  const excerpts = (opts.excerpts ?? []).filter(e => included.has(sessionDoc(agg, e.session_id)))
  const excerptsIncluded = includedDocIds.length > 0 && excerpts.length > 0
  if (excerptsIncluded) parts.push('', excerptsSection(agg.sessions, excerpts))

  return {
    data: parts.join('\n'), includedDocIds, notesIncluded, placesIncluded, excerptsIncluded,
    goalsIncluded,
  }
}

/** The doc a session belongs to — '' when unknown, which can never match a ticked id. */
function sessionDoc(agg: WindowAggregate, sessionId: string): string {
  return agg.sessions.find(s => s.session_id === sessionId)?.doc_id ?? ''
}

/** Compile the whole payload: fixed prompt + optional user prompt + data. */
export function compilePayload(opts: CompileOpts): CompiledPayload {
  const {
    data, includedDocIds, notesIncluded, placesIncluded, excerptsIncluded, goalsIncluded,
  } = compileData(opts)
  const contentIncluded = includedDocIds.length > 0
  const promptOpts = {
    window: opts.agg.window, contentIncluded, notesIncluded, placesIncluded, excerptsIncluded,
    goalsIncluded,
  }
  return {
    text: assemblePrompt({ ...promptOpts, userPrompt: opts.userPrompt, data }),
    // The SAME call the payload's first half is built from — the panel cannot show one text and
    // copy another.
    fixed: fixedPrompt(promptOpts),
    data,
    contentIncluded,
    notesIncluded,
    placesIncluded,
    excerptsIncluded,
    goalsIncluded,
    includedDocIds,
  }
}
