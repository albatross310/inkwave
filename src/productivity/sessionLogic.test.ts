import { describe, expect, it } from 'vitest'
import {
  ACTIVE_GAP_CAP_MS,
  REFLECT_AFTER_ACTIVE_MS,
  shouldOfferReflection,
  reflectionDue,
  unreflectedRows,
  DEFAULT_IDLE_MS,
  buildPostHocRow,
  buildRow,
  isIdleBoundary,
  isRecordable,
  isoWithOffset,
  localDayOf,
  localMonthOf,
  openDraft,
  recordEdit,
} from './sessionLogic'
import type { Reflection, SessionRow } from './types'

const T0 = Date.UTC(2026, 6, 17, 0, 0, 0) // 2026-07-17T00:00:00Z → 10:00 in Brisbane (+600)
const BNE = 600

function draftAt(at = T0, wordsStart = 100) {
  return openDraft({ sessionId: 's1', docId: 'd1', docType: 'essay', pomodoro: false, at, wordsStart })
}

describe('session boundaries (§A4)', () => {
  it('closes a session after the inactivity threshold, not before', () => {
    expect(isIdleBoundary(T0, T0 + DEFAULT_IDLE_MS - 1)).toBe(false)
    expect(isIdleBoundary(T0, T0 + DEFAULT_IDLE_MS)).toBe(true)
  })

  it('honours a custom idle threshold', () => {
    expect(isIdleBoundary(T0, T0 + 61_000, 60_000)).toBe(true)
    expect(isIdleBoundary(T0, T0 + 59_000, 60_000)).toBe(false)
  })
})

describe('active_minutes (§A3.2 — excludes idle within the session)', () => {
  it('accumulates the gaps between edits', () => {
    const d = draftAt()
    recordEdit(d, T0 + 10_000)
    recordEdit(d, T0 + 25_000)
    expect(d.activeMs).toBe(25_000)
    expect(d.editEvents).toBe(3) // the opening edit counts
  })

  it('caps a single thinking gap — idle inside a session is not editing time', () => {
    const d = draftAt()
    recordEdit(d, T0 + 3 * 60_000) // a 3-minute think: under the 5-min boundary, over the cap
    expect(d.activeMs).toBe(ACTIVE_GAP_CAP_MS)
    // KNOWN-NEGATIVE: an uncapped implementation would have banked the full 180s. Prove the cap is
    // what produced the number, so this test cannot pass on a rule that just sums raw gaps.
    expect(d.activeMs).not.toBe(3 * 60_000)
  })

  it('the first edit banks no active time (there is no gap yet)', () => {
    expect(draftAt().activeMs).toBe(0)
  })
})

describe('isoWithOffset (§A9 — store UTC + offset, aggregate in the local day)', () => {
  it('renders the local wall clock with its offset', () => {
    expect(isoWithOffset(T0, BNE)).toBe('2026-07-17T10:00:00.000+10:00')
  })

  it('handles negative and half-hour offsets', () => {
    expect(isoWithOffset(T0, -300)).toBe('2026-07-16T19:00:00.000-05:00') // New York (EST)
    expect(isoWithOffset(T0, 330)).toBe('2026-07-17T05:30:00.000+05:30') // Kolkata
  })

  it('round-trips to the same UTC instant it was given', () => {
    for (const off of [BNE, -300, 330, 0]) {
      expect(new Date(isoWithOffset(T0, off)).getTime()).toBe(T0)
    }
  })

  it('the local day differs from the UTC day — which is the whole point', () => {
    // 23:30 UTC on the 16th is already the 17th in Brisbane. A bare Z timestamp would file this
    // session under the wrong local day; the offset form files it correctly.
    const late = Date.UTC(2026, 6, 16, 23, 30)
    expect(new Date(late).toISOString().slice(0, 10)).toBe('2026-07-16')
    expect(localDayOf(isoWithOffset(late, BNE))).toBe('2026-07-17')
  })

  it('localMonthOf picks the local month (and so the local ledger)', () => {
    const eom = Date.UTC(2026, 6, 31, 20, 0) // 31 Jul 20:00Z = 1 Aug 06:00 in Brisbane
    expect(localMonthOf(isoWithOffset(eom, BNE))).toBe('2026-08')
    expect(localMonthOf(isoWithOffset(eom, 0))).toBe('2026-07')
  })
})

describe('buildRow (§A3.2 schema)', () => {
  it('computes the row exactly, in the contract shape', () => {
    const d = draftAt(T0, 100)
    recordEdit(d, T0 + 30_000)
    const row = buildRow(
      { ...d, docLabel: 'Essay' },
      { at: T0 + 60_000, wordsEnd: 180, wordsAdded: 95, wordsDeleted: 15 },
      T0 - 10 * 60_000,
      BNE,
    )
    expect(row).toEqual({
      session_id: 's1',
      doc_id: 'd1',
      doc_label: 'Essay',
      start: '2026-07-17T10:00:00.000+10:00',
      end: '2026-07-17T10:01:00.000+10:00',
      active_minutes: 0.5,
      words_start: 100,
      words_end: 180,
      words_added: 95,
      words_deleted: 15,
      net_words: 80,
      edit_events: 2,
      break_before_min: 10,
      pomodoro: false,
      doc_type: 'essay',
      entered: 'timer',
    })
  })

  it('OMITS doc_label when suppressed — a suppressed title leaves no trace', () => {
    const row = buildRow(draftAt(), { at: T0, wordsEnd: 100, wordsAdded: 0, wordsDeleted: 0 }, null, BNE)
    expect('doc_label' in row).toBe(false)
    expect(JSON.stringify(row)).not.toContain('doc_label')
  })

  it('the first session in the ledger has no break before it', () => {
    const row = buildRow(draftAt(), { at: T0, wordsEnd: 100, wordsAdded: 0, wordsDeleted: 0 }, null, BNE)
    expect(row.break_before_min).toBe(0)
  })

  it('net_words goes negative on a cutting session — an honest number, never clamped', () => {
    const row = buildRow(
      draftAt(T0, 500),
      { at: T0 + 60_000, wordsEnd: 400, wordsAdded: 20, wordsDeleted: 120 },
      null,
      BNE,
    )
    expect(row.net_words).toBe(-100)
    expect(row.words_deleted).toBe(120)
  })

  it('carries pomodoro framing onto the row', () => {
    const d = openDraft({ sessionId: 's2', docId: 'd1', docType: 'email', pomodoro: true, at: T0, wordsStart: 0 })
    const row = buildRow(d, { at: T0 + 1000, wordsEnd: 5, wordsAdded: 5, wordsDeleted: 0 }, null, BNE)
    expect(row.pomodoro).toBe(true)
    expect(row.doc_type).toBe('email')
  })

  it('NO forbidden field can reach a row (§A3.2 data minimisation)', () => {
    const row = buildRow(
      { ...draftAt(), docLabel: 'Essay' },
      { at: T0 + 1000, wordsEnd: 101, wordsAdded: 1, wordsDeleted: 0 },
      null,
      BNE,
    )
    const keys = Object.keys(row).sort()
    // The contract, exactly — an extra field here breaks three agents and may breach minimisation.
    expect(keys).toEqual([
      'active_minutes', 'break_before_min', 'doc_id', 'doc_label', 'doc_type', 'edit_events',
      'end', 'entered', 'net_words', 'pomodoro', 'session_id', 'start', 'words_added',
      'words_deleted', 'words_end', 'words_start',
    ])
    const blob = JSON.stringify(row).toLowerCase()
    for (const forbidden of ['lat', 'lon', 'geo', 'ip', 'coord', 'keystroke', 'text', 'content', 'prose']) {
      expect(blob.includes(`"${forbidden}"`)).toBe(false)
    }
  })
})

describe('isRecordable', () => {
  it('a session with real edits is kept (§A5: a low-output session still counts)', () => {
    expect(isRecordable(draftAt())).toBe(true)
  })
})

describe('the reflection prompt fires on ACTIVE minutes, once per stretch (§A5b)', () => {
  it('offers at 25 ACTIVE minutes, not before', () => {
    expect(shouldOfferReflection(REFLECT_AFTER_ACTIVE_MS - 1)).toBe(false)
    expect(shouldOfferReflection(REFLECT_AFTER_ACTIVE_MS)).toBe(true)
    expect(REFLECT_AFTER_ACTIVE_MS).toBe(25 * 60_000)
  })

  it('a short spell is never interrupted', () => {
    expect(shouldOfferReflection(0)).toBe(false)
    expect(shouldOfferReflection(5 * 60_000)).toBe(false)
  })

  it('ACTIVE minutes, not wall clock — the distinction is the whole design', () => {
    // A writer who opens the app at 9am and types for 3 minutes has 3 active minutes, not 60. If
    // this counted the clock it would be a toll booth on anyone who leaves a tab open.
    const d = draftAt(T0, 0)
    recordEdit(d, T0 + 60 * 60_000) // an hour of wall clock, one edit
    expect(d.activeMs).toBe(ACTIVE_GAP_CAP_MS) // capped: one minute of it was work
    expect(shouldOfferReflection(d.activeMs)).toBe(false)
  })
})

// ─── reflectionDue / unreflectedRows — the session-close gate (§A5b) ─────────────────────────────
// Peter: "at the end of every longer session." The watcher (ReflectionAutoOpen) reads THIS rule to
// decide whether a closed session is worth surfacing the reflection for, and the drop-up reads the
// same `unreflectedRows` to decide what to show — one rule, so opening and showing cannot disagree.
describe('reflectionDue / unreflectedRows — the end-of-longer-session gate', () => {
  const TODAY = '2026-07-17'
  const row = (over: Partial<SessionRow> = {}): SessionRow => ({
    session_id: `s-${Math.random().toString(36).slice(2, 8)}`,
    doc_id: 'doc-1', doc_label: 'Paper',
    start: `${TODAY}T09:00:00+10:00`, end: `${TODAY}T09:40:00+10:00`,
    active_minutes: 40, words_start: 0, words_end: 100,
    words_added: 100, words_deleted: 0, net_words: 100,
    edit_events: 50, break_before_min: 0, pomodoro: true, doc_type: 'essay',
    entered: 'timer', ...over,
  })
  const reflectedTo = (to: string): Reflection =>
    ({ reflection_id: 'r1', day: TODAY, from: `${TODAY}T00:00:00+10:00`, to, notes: [{ doc_type: 'essay', text: 'x' }] })

  it('a longer unreflected stretch today IS due', () => {
    expect(reflectionDue([row({ active_minutes: 40 })], [], TODAY)).toBe(true)
  })

  it('a short stretch is NOT due', () => {
    expect(reflectionDue([row({ active_minutes: 10 })], [], TODAY)).toBe(false)
  })

  it('a stretch already spoken for by a later reflection does NOT re-trigger', () => {
    const r = row({ end: `${TODAY}T09:40:00+10:00`, active_minutes: 40 })
    expect(reflectionDue([r], [reflectedTo(`${TODAY}T09:40:00+10:00`)], TODAY)).toBe(false)
  })

  it('NEW work after the last reflection re-triggers (every longer session, not just the first)', () => {
    const done = row({ end: `${TODAY}T09:40:00+10:00`, active_minutes: 40 })
    const fresh = row({ start: `${TODAY}T10:00:00+10:00`, end: `${TODAY}T10:40:00+10:00`, active_minutes: 40 })
    expect(reflectionDue([done, fresh], [reflectedTo(`${TODAY}T09:40:00+10:00`)], TODAY)).toBe(true)
  })

  it('another day\'s rows do not count toward today', () => {
    const yesterday = row({ start: '2026-07-16T09:00:00+10:00', end: '2026-07-16T09:40:00+10:00', active_minutes: 40 })
    expect(unreflectedRows([yesterday], [], TODAY)).toHaveLength(0)
    expect(reflectionDue([yesterday], [], TODAY)).toBe(false)
  })

  // ── §A6.1 ON THE RECALL PROMPT — and the guard that could not fail ────────────────────────────
  // This block replaces one that read `row({ entered: 'post-hoc', active_minutes: 0 })` and said
  // "a remembered block carries 0 active_minutes, so it cannot inflate the gate". That premise is
  // FALSE, and sessionLogic's own buildPostHocRow comment says so: the WORDS are zero, "the minutes
  // live in `active_minutes` and are kept out of the measured bars by `entered`, never by being
  // blank". The fixture hand-set the one field that made the assertion true, so it passed on a build
  // where a real 45-minute block DID open the prompt and DID get printed back as focused minutes.
  //
  // R6, exactly: the pass condition was satisfiable by the broken mechanism. So the rows below come
  // from the REAL builder — the shape the writer actually creates — and never from a literal.
  const remembered = (minutes: number) =>
    buildPostHocRow({ minutes, docType: 'reading' },
      { sessionId: `p-${minutes}`, at: Date.parse(`${TODAY}T14:00:00+10:00`), offsetMin: 600 })

  it('KNOWN-POSITIVE: a real remembered block DOES carry its minutes (the old fixture did not)', () => {
    // Without this, every assertion below could be a property of an accidentally-empty row.
    expect(remembered(45).active_minutes).toBe(45)
    expect(remembered(45).entered).toBe('post-hoc')
  })

  it('remembered minutes never make a reflection due', () => {
    // Else "add the time you forgot" pops a recall prompt about work we never watched (§A5: never nag).
    expect(reflectionDue([remembered(45)], [], TODAY)).toBe(false)
  })

  it('remembered minutes are never handed to the prompt, which calls them FOCUSED minutes', () => {
    expect(unreflectedRows([remembered(45)], [], TODAY)).toHaveLength(0)
  })

  it('…and a measured row beside one still comes through — the filter is on PROVENANCE, not on rows', () => {
    const measured = row({ active_minutes: 40 })
    expect(unreflectedRows([measured, remembered(45)], [], TODAY)).toEqual([measured])
    expect(reflectionDue([measured, remembered(45)], [], TODAY)).toBe(true)
  })

  it('THE FIXTURE DISCRIMINATES: the merged rule would answer differently', () => {
    // 45 remembered minutes clear REFLECT_AFTER_ACTIVE_MS on their own, so a gate that summed all
    // rows would say `true` here. If it could not, the three assertions above would be free.
    expect(shouldOfferReflection(remembered(45).active_minutes * 60_000)).toBe(true)
  })
})
