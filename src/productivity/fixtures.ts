// Synthetic ledger fixtures — for tests and for the labelled `?prodReport=demo` mode.
//
// WHOLLY INVENTED. No real document text, no real titles, no writer's data of any kind may ever
// be added here: this module is imported by the demo UI and by tests whose output gets pasted
// into reports. It is deterministic (no Date.now, no randomness) so tests can assert on it.

import type { DayAggregate, SessionRow, WindowAggregate, WindowDoc } from './types'

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
  { day: '2026-07-06', active_minutes: 92, session_count: 3, words_added: 640, words_deleted: 120, net_words: 520, edit_events: 412, break_count: 2, break_total_min: 25, deep_shallow_ratio: 1.8, busiest_hours: hours({ 9: 45, 10: 30, 16: 17 }) },
  { day: '2026-07-07', active_minutes: 24, session_count: 1, words_added: 90, words_deleted: 210, net_words: -120, edit_events: 180, break_count: 0, break_total_min: 0, deep_shallow_ratio: 0.4, busiest_hours: hours({ 21: 24 }) },
  { day: '2026-07-08', active_minutes: 118, session_count: 4, words_added: 810, words_deleted: 95, net_words: 715, edit_events: 530, break_count: 3, break_total_min: 40, deep_shallow_ratio: 2.1, busiest_hours: hours({ 8: 50, 9: 40, 14: 28 }) },
  { day: '2026-07-09', active_minutes: 0, session_count: 0, words_added: 0, words_deleted: 0, net_words: 0, edit_events: 0, break_count: 0, break_total_min: 0, deep_shallow_ratio: 0, busiest_hours: hours({}) },
  { day: '2026-07-10', active_minutes: 39, session_count: 2, words_added: 150, words_deleted: 300, net_words: -150, edit_events: 260, break_count: 1, break_total_min: 12, deep_shallow_ratio: 0.5, busiest_hours: hours({ 11: 22, 15: 17 }) },
]

// `note` and `place` are the writer's own words (tier 2) — invented here, and deliberately the
// kind of thing that must NOT travel without an explicit tick.
const SESSIONS: SessionRow[] = [
  { session_id: 's-1', doc_id: 'doc-essay', doc_label: 'Seminar paper draft', start: '2026-07-06T09:05:00+10:00', end: '2026-07-06T09:50:00+10:00', active_minutes: 45, words_start: 1200, words_end: 1560, words_added: 400, words_deleted: 40, net_words: 360, edit_events: 210, break_before_min: 0, pomodoro: true, doc_type: 'essay', place: 'library', note: 'Finally got the third step of the argument down.' },
  { session_id: 's-2', doc_id: 'doc-essay', doc_label: 'Seminar paper draft', start: '2026-07-06T10:10:00+10:00', end: '2026-07-06T10:40:00+10:00', active_minutes: 30, words_start: 1560, words_end: 1700, words_added: 190, words_deleted: 50, net_words: 140, edit_events: 150, break_before_min: 20, pomodoro: true, doc_type: 'essay', place: 'library', note: 'Tired by the end of this one.' },
  { session_id: 's-3', doc_id: 'doc-journal', doc_label: 'Journal', start: '2026-07-06T16:30:00+10:00', end: '2026-07-06T16:47:00+10:00', active_minutes: 17, words_start: 0, words_end: 20, words_added: 50, words_deleted: 30, net_words: 20, edit_events: 52, break_before_min: 350, pomodoro: false, doc_type: 'note' },
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
    // Session rows are PRESENT at weekly/monthly (tier 2 needs them to list notes) but must not
    // appear in the payload as raw logs — which is exactly what compile.test.ts pins.
    sessions: SESSIONS,
    docs: DOCS,
  }
}
