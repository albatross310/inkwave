// @vitest-environment jsdom
//
// THE START-WORK → SUMMARY FLOW's claim rule (Peter, 2026-07-18: "at the END of the pomodoro, asks
// you to briefly SUMMARISE"). This pins the ONE piece that could quietly attach the summary to the
// wrong session: workSession only claims a POMODORO row that started at/after Start-work was pressed.
//
// WHY THE TIME FILTER IS LOAD-BEARING, and why the test can see it fail: starting a block first
// FLUSHES any prior open session (pomodoroStart closes it), which fires the SAME LEDGER_ROW_EVENT the
// block's own close fires later. Without the "started at/after our start" filter, the flush's row —
// an EARLIER, unrelated session — would be claimed, and the writer would be asked to summarise work
// they finished before they pressed Start. The negative below arms at T and feeds a row that started
// before T; the rule must refuse it. Remove the filter and it is claimed — the test fails.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRow } from './types'

const annotate = vi.fn(async (_month: string, _sessionId: string, _patch: { note?: string }) => true)
let rows: SessionRow[] = []

vi.mock('./ledgerStore', () => ({
  loadLedger: async () => ({ rows, reflections: [] }),
  annotateRow: (month: string, sessionId: string, patch: { note?: string }) => annotate(month, sessionId, patch),
}))

// Imported AFTER the mock is registered (vi.mock is hoisted, so this is fine at top level).
import { _armForTest, _claimForTest, _resetWorkSession, dismissSummary, pendingSummary, submitSummary, WORK_SUMMARY_EVENT } from './workSession'

const T = Date.parse('2026-07-18T10:00:00+10:00')

function row(over: Partial<SessionRow>): SessionRow {
  return {
    session_id: 'sess', doc_id: 'doc', doc_label: 'A doc',
    start: new Date(T).toISOString(), end: new Date(T + 25 * 60_000).toISOString(),
    active_minutes: 25, words_start: 0, words_end: 0, words_added: 0, words_deleted: 0, net_words: 0,
    edit_events: 0, break_before_min: 0, pomodoro: true, doc_type: 'essay', entered: 'timer', ...over,
  }
}

beforeEach(() => { _resetWorkSession(); annotate.mockClear(); rows = [] })
afterEach(() => { _resetWorkSession() })

describe('workSession — claiming the right block', () => {
  it('claims a pomodoro block that started at/after Start-work, and fires the summary event', async () => {
    rows = [row({ session_id: 'ours', start: new Date(T).toISOString() })]
    _armForTest({ startedAtMs: T, intention: 'draft the intro' })
    const fired = new Promise<void>((res) => window.addEventListener(WORK_SUMMARY_EVENT, () => res(), { once: true }))
    await _claimForTest('ours', '2026-07')
    await fired
    expect(pendingSummary()).toEqual({ sessionId: 'ours', month: '2026-07', intention: 'draft the intro' })
  })

  it('REFUSES the prior-session flush — a row that started BEFORE our start (the whole point)', async () => {
    // The flush fires the same event; its row started 10 minutes before we pressed Start.
    rows = [row({ session_id: 'earlier', start: new Date(T - 10 * 60_000).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('earlier', '2026-07')
    expect(pendingSummary()).toBeNull()
  })

  it('REFUSES a non-pomodoro row even at the right time (a typing session is not a work block)', async () => {
    rows = [row({ session_id: 'typed', pomodoro: false, start: new Date(T).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('typed', '2026-07')
    expect(pendingSummary()).toBeNull()
  })

  it('a small clock slack does not filter out our own block', async () => {
    // The row's `start` is stamped a hair after the start call; a few ms earlier must still claim.
    rows = [row({ session_id: 'ours', start: new Date(T - 2_000).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('ours', '2026-07')
    expect(pendingSummary()?.sessionId).toBe('ours')
  })
})

describe('workSession — the summary lands as the ledger note', () => {
  it('submitSummary writes the note through the annotate path, then clears', async () => {
    rows = [row({ session_id: 'ours', start: new Date(T).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('ours', '2026-07')
    await submitSummary('  wrote two paragraphs  ')
    expect(annotate).toHaveBeenCalledWith('2026-07', 'ours', { note: 'wrote two paragraphs' })
    expect(pendingSummary()).toBeNull()
  })

  it('an empty summary writes NOTHING (a skipped note is not a failure)', async () => {
    rows = [row({ session_id: 'ours', start: new Date(T).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('ours', '2026-07')
    await submitSummary('   ')
    expect(annotate).not.toHaveBeenCalled()
    expect(pendingSummary()).toBeNull()
  })

  it('dismiss clears the offer and records nothing', async () => {
    rows = [row({ session_id: 'ours', start: new Date(T).toISOString() })]
    _armForTest({ startedAtMs: T })
    await _claimForTest('ours', '2026-07')
    dismissSummary()
    expect(pendingSummary()).toBeNull()
    expect(annotate).not.toHaveBeenCalled()
  })
})
