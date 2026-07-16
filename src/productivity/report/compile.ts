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
// THREE TIERS (Peter, 2026-07-17):
//   1. session metadata (times, words, edits) — always included
//   2. place label + diary notes            — opt-in, OFF by default   ← `includeNotes`
//   3. per-document text                    — opt-in, OFF by default, per document (§A7.3)
// Tier 2 exists because tiers 1 and 3 alone would let the writer's own prose ride out inside
// "metadata": "metadata only" would quietly mean "and what I wrote about my day". Note that the
// place label is text the WRITER TYPED — not geolocation, nothing harvested (§C1.4).

import type { DayAggregate, SessionRow, WindowAggregate, WindowDoc } from '../types'
import { assemblePrompt, fixedPrompt } from './prompt'

export interface CompileOpts {
  agg: WindowAggregate
  /**
   * TIER 2 — include the writer's diary notes and typed place labels. OFF by default: absent or
   * false means not one word of either leaves.
   */
  includeNotes?: boolean
  /** Doc ids the writer ticked for content (§A7.3). Off by default; per-document, never blanket. */
  contentDocIds?: string[]
  /** Plain text per doc id, supplied by the caller for ticked docs only. */
  contentText?: Record<string, string>
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
  /** True when any note or place label is in the payload. */
  notesIncluded: boolean
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
    d.deep_shallow_ratio.toFixed(2),
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

// ─── Tier 2: the writer's notes and place labels ────────────────────────────────────────────

/** Sessions carrying a note or a place, in payload order. Empty ⇒ the section is omitted. */
function sessionsWithNotes(sessions: SessionRow[]): SessionRow[] {
  return sessions.filter(s => (s.note && s.note.trim()) || (s.place && s.place.trim()))
}

/**
 * The place label is rendered as the plain string the writer typed. It is deliberately NOT
 * parsed, geocoded or interpreted — it is a word, and treating it as anything more would be the
 * beginning of exactly the claim we must not make.
 */
function notesSection(sessions: SessionRow[]): string {
  const rows = sessionsWithNotes(sessions).map(s => [
    s.session_id,
    s.start,
    (s.place ?? '').trim() || '—',
    (s.note ?? '').trim() || '—',
  ])
  return [
    'THE WRITER\'S OWN NOTES (they chose to include these)',
    '',
    'These are the writer\'s words, written at the end of each session — their diary line and the',
    'place they typed for it. Read them as context for how the work felt. Do not treat a note as',
    'a task list, do not grade it, and do not repeat it back at length.',
    '',
    table(['session_id', 'start', 'place', 'note'], rows),
  ].join('\n')
}

function contentSection(docs: WindowDoc[], included: string[], text: Record<string, string>): string {
  const blocks = included.map(id => {
    const doc = docs.find(d => d.doc_id === id)
    const body = (text[id] ?? '').trim()
    return [
      `--- ${labelOf(id, doc?.doc_label)} (${doc?.doc_type ?? 'other'}) ---`,
      body || '(this document has no text)',
    ].join('\n')
  })
  return ['DOCUMENT TEXT (the writer chose to include these)', '', blocks.join('\n\n')].join('\n')
}

/** Build the data section — the compact rollups, plus whatever the writer opted into. */
export function compileData(
  opts: CompileOpts,
): { data: string; includedDocIds: string[]; notesIncluded: boolean } {
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
    table(
      ['day', 'active_minutes', 'sessions', 'words_added', 'words_deleted', 'net_words',
        'edit_events', 'breaks', 'break_total_min', 'deep_shallow_ratio'],
      dayRows(agg.days),
    ),
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

  // TIER 2 — only on an explicit opt-in, and only where there is something to say. Note this
  // reads `agg.sessions` at EVERY window: a note is per-session, so weekly/monthly need the rows
  // to list them (the day rollups above are still the only measured data sent).
  const noted = opts.includeNotes ? sessionsWithNotes(agg.sessions) : []
  const notesIncluded = noted.length > 0
  if (notesIncluded) parts.push('', notesSection(agg.sessions))

  if (includedDocIds.length) {
    parts.push('', contentSection(agg.docs, includedDocIds, opts.contentText ?? {}))
  }
  return { data: parts.join('\n'), includedDocIds, notesIncluded }
}

/** Compile the whole payload: fixed prompt + optional user prompt + data. */
export function compilePayload(opts: CompileOpts): CompiledPayload {
  const { data, includedDocIds, notesIncluded } = compileData(opts)
  const contentIncluded = includedDocIds.length > 0
  const promptOpts = { window: opts.agg.window, contentIncluded, notesIncluded }
  return {
    text: assemblePrompt({ ...promptOpts, userPrompt: opts.userPrompt, data }),
    // The SAME call the payload's first half is built from — the panel cannot show one text and
    // copy another.
    fixed: fixedPrompt(promptOpts),
    data,
    contentIncluded,
    notesIncluded,
    includedDocIds,
  }
}
