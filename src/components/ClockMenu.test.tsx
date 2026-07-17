// @vitest-environment jsdom
//
// THE DROP-UP'S OWN DAY SUMMARY — the second place the day's minutes are summed.
//
// WHY THIS FILE EXISTS, and it is CLAUDE.md's headline lesson made concrete: `pdfposthoc.prove.mjs`
// caught this panel reporting 45 REMEMBERED minutes back to Peter as "focused minutes" — §A6.1's
// merge, live on screen — while `pnpm test` stayed green at 1762 passed. The unit tests guard
// `aggregate.ts`; `daySummary` never calls it. **A browser probe that ran once is not a guard**: six
// weeks from now it is indistinguishable from one that never ran, and the gate says green either way.
// So the invariant it established is pinned HERE, in ~40ms, with no browser.
//
// MUTATION-PROVED: restore the original `reduce` over ALL rows and the two §A6.1 tests below fail.

import { describe, expect, it } from 'vitest'
import { _daySummaryForTest as daySummary } from './ClockMenu'
import { buildPostHocRow } from '../productivity/sessionLogic'
import type { SessionRow } from '../productivity/types'

const AT = Date.parse('2026-07-17T14:00:00+10:00')

function timed(over: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: `t-${Math.random().toString(36).slice(2, 8)}`,
    doc_id: 'doc-1', doc_label: 'Seminar paper',
    start: '2026-07-17T09:00:00+10:00', end: '2026-07-17T10:00:00+10:00',
    active_minutes: 60, words_start: 100, words_end: 400,
    words_added: 320, words_deleted: 20, net_words: 300,
    edit_events: 250, break_before_min: 0, pomodoro: true, doc_type: 'essay',
    entered: 'timer', ...over,
  }
}
const remembered = (minutes: number) =>
  buildPostHocRow({ minutes, docType: 'reading' }, { sessionId: `p-${minutes}`, at: AT, offsetMin: 600 })

describe('daySummary — §A6.1 on the writer\'s own screen', () => {
  it('REMEMBERED MINUTES ARE NOT REPORTED AS FOCUSED MINUTES (the bug the probe found)', () => {
    const s = daySummary([timed({ active_minutes: 60 }), remembered(45)])
    expect(s).toContain('60 focused minutes')
    expect(s).not.toContain('105 focused minutes') // 60 + 45 — the merge
  })

  it('the remembered time is still SHOWN — hiding it would be its own dishonesty', () => {
    const s = daySummary([timed({ active_minutes: 60 }), remembered(45)])
    expect(s).toMatch(/added 45 minutes from memory/i)
  })

  it('post-hoc blocks are not counted as tracked SESSIONS either', () => {
    const s = daySummary([timed(), remembered(45)])
    expect(s).toContain('across 1 session')
    expect(s).not.toContain('across 2 sessions')
  })

  it('a day of ONLY remembered time does not claim any tracked work', () => {
    const s = daySummary([remembered(45)])
    expect(s).toMatch(/nothing tracked today/i)
    expect(s).toMatch(/45 minutes from memory/i)
    expect(s).not.toContain('focused minute')
  })

  it('an ordinary tracked day is unchanged — no stray clause about memory', () => {
    const s = daySummary([timed({ active_minutes: 60 })])
    expect(s).toContain('60 focused minutes')
    expect(s).not.toMatch(/memory/i)
  })

  it('an empty day still reads as an invitation, not a reproach (§A5)', () => {
    expect(daySummary([])).toMatch(/nothing recorded yet today/i)
  })

  it('§A5: no scolding anywhere, however the day went', () => {
    // The post-hoc add is a repair tool, not an audit. Using it must never be editorialised.
    for (const rows of [[remembered(45)], [timed(), remembered(45)], [timed()], []]) {
      const s = daySummary(rows).toLowerCase()
      for (const bad of ['forgot', 'failed', 'should have', 'lapse', 'only managed', 'poor', 'try to']) {
        expect(s).not.toContain(bad)
      }
    }
  })

  it('THE FIXTURE CAN TELL THE RULES APART (not a tautology)', () => {
    // If the merged and split rules agreed on this fixture, every assertion above would be a property
    // of the data. 105 ≠ 60, so they cannot.
    const rows = [timed({ active_minutes: 60 }), remembered(45)]
    const mergedMinutes = Math.round(rows.reduce((a, r) => a + r.active_minutes, 0))
    expect(mergedMinutes).toBe(105)
    expect(daySummary(rows)).toContain('60 focused minutes')
  })
})
