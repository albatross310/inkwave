import { describe, expect, it } from 'vitest'
import {
  ACTIVE_GAP_CAP_MS,
  DEFAULT_IDLE_MS,
  buildRow,
  isIdleBoundary,
  isRecordable,
  isoWithOffset,
  localDayOf,
  localMonthOf,
  openDraft,
  recordEdit,
} from './sessionLogic'

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
