// @vitest-environment jsdom
//
// THE DROP-UP'S DAY SUMMARY — once the second place the day's minutes were summed; now the prose
// over `aggregate.ts dayTotals`, the one day sum (docs/REFACTOR-QUEUE.md item 2).
//
// WHY THIS FILE EXISTS, and it is CLAUDE.md's headline lesson made concrete: `pdfposthoc.prove.mjs`
// caught this panel reporting 45 REMEMBERED minutes back to Peter as "focused minutes" — §A6.1's
// merge, live on screen — while `pnpm test` stayed green at 1762 passed. The unit tests guarded
// `aggregate.ts`; `daySummary` never called it. **A browser probe that ran once is not a guard**: six
// weeks from now it is indistinguishable from one that never ran, and the gate says green either way.
// So the invariant it established is pinned HERE, in ~40ms, with no browser.
//
// MUTATION-PROVED, BOTH SIDES. A merge (post-hoc rows summed as measured) planted in `dayTotals`
// fails 5 guards in postHoc.test.ts AND 13 of the 31 tests here. Before the consolidation the same
// plant in `dayAggregate` failed 4 and 0 — which is the whole reason the drop-up now reads the
// shared sum instead of keeping a private reduce that only its own tests could see.

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

// ─── CHARACTERIZATION — written against the UNMOVED `daySummary` and proved green there BEFORE its
// arithmetic moved onto `dayTotals` (docs/REFACTOR-QUEUE.md item 2; CLAUDE.md "write the
// characterization test before the move"). Exact strings, every branch: the prose is the drop-up's
// whole face, so a refactor that changes a word — or a number by one — is a behaviour change on
// Peter's screen. Nothing below is a belief about the new code; it is what the old code SAID.
describe('daySummary — every sentence it can say, verbatim (characterization)', () => {
  const NOTHING = 'Nothing recorded yet today. Whenever you start, it will show up here.'

  it('an empty day', () => {
    expect(daySummary([])).toBe(NOTHING)
  })

  it('a day of only remembered time', () => {
    expect(daySummary([remembered(45)])).toBe('Nothing tracked today — but you added 45 minutes from memory.')
  })

  it('a day of only remembered time, singular', () => {
    expect(daySummary([remembered(1)])).toBe('Nothing tracked today — but you added 1 minute from memory.')
  })

  it('a zero-minute remembered block reads as nothing recorded — it added no time', () => {
    expect(daySummary([remembered(0)])).toBe(NOTHING)
  })

  it('remembered minutes are spoken WHOLE: 0.4 rounds to nothing, 0.5 rounds up to 1', () => {
    expect(daySummary([remembered(0.4)])).toBe(NOTHING)
    expect(daySummary([remembered(0.5)])).toBe('Nothing tracked today — but you added 1 minute from memory.')
  })

  it('a short spell: under 25 minutes, one session, words grew', () => {
    expect(daySummary([timed({ active_minutes: 20, net_words: 300 })]))
      .toBe('A short spell of work: 20 focused minutes across 1 session, and the writing grew by 300 words.')
  })

  it('every singular form at once: 1 minute, 1 session, 1 word', () => {
    expect(daySummary([timed({ active_minutes: 1, net_words: 1 })]))
      .toBe('A short spell of work: 1 focused minute across 1 session, and the writing grew by 1 word.')
  })

  it('the 25-minute cut: 24 is a short spell, 25 is a steady stretch', () => {
    expect(daySummary([timed({ active_minutes: 24 })])).toMatch(/^A short spell of work: 24 focused minutes/)
    expect(daySummary([timed({ active_minutes: 25 })])).toMatch(/^A steady stretch: 25 focused minutes/)
  })

  it('the 90-minute cut: 89 is a steady stretch, 90 is a long day', () => {
    expect(daySummary([timed({ active_minutes: 89 })])).toMatch(/^A steady stretch: 89 focused minutes/)
    expect(daySummary([timed({ active_minutes: 90 })])).toMatch(/^A long day at it: 90 focused minutes/)
  })

  it('the shape reads the ROUNDED whole minutes — 24.4 is a short spell of 24, 24.6 a steady stretch of 25', () => {
    expect(daySummary([timed({ active_minutes: 24.4 })])).toMatch(/^A short spell of work: 24 focused minutes/)
    expect(daySummary([timed({ active_minutes: 24.6 })])).toMatch(/^A steady stretch: 25 focused minutes/)
  })

  it('an exact half rounds UP, and the band follows it: 24.5 → 25 steady, 89.5 → 90 long', () => {
    expect(daySummary([timed({ active_minutes: 24.5 })])).toMatch(/^A steady stretch: 25 focused minutes/)
    expect(daySummary([timed({ active_minutes: 89.5 })])).toMatch(/^A long day at it: 90 focused minutes/)
  })

  it('a long day, verbatim', () => {
    expect(daySummary([timed({ active_minutes: 150, net_words: 1200 })]))
      .toBe('A long day at it: 150 focused minutes across 1 session, and the writing grew by 1200 words.')
  })

  it('two sessions: minutes and words sum, the count pluralises', () => {
    expect(daySummary([timed({ active_minutes: 30, net_words: 100 }), timed({ active_minutes: 30, net_words: 50 })]))
      .toBe('A steady stretch: 60 focused minutes across 2 sessions, and the writing grew by 150 words.')
  })

  it('the drop-up hands rows NEWEST FIRST — the sentence does not depend on order', () => {
    const rows = [timed({ active_minutes: 30, net_words: 100 }), timed({ active_minutes: 30, net_words: 50 }), remembered(15)]
    expect(daySummary([...rows].reverse())).toBe(daySummary(rows))
  })

  it('a cutting day: negative net words', () => {
    expect(daySummary([timed({ active_minutes: 60, net_words: -120 })]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, and you cut it back — editing is writing too.')
  })

  it('a shaping day: net words exactly zero', () => {
    expect(daySummary([timed({ active_minutes: 60, net_words: 0 })]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, spent shaping what was already there.')
  })

  it('net words are a SUM across sessions: +200 and −200 is a shaping day, not a growing one', () => {
    expect(daySummary([timed({ active_minutes: 30, net_words: 200 }), timed({ active_minutes: 30, net_words: -200 })]))
      .toBe('A steady stretch: 60 focused minutes across 2 sessions, spent shaping what was already there.')
  })

  it('a mixed day, verbatim: the remembered clause follows the full stop', () => {
    expect(daySummary([timed({ active_minutes: 60, net_words: 300 }), remembered(45)]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, and the writing grew by 300 words. You also added 45 minutes from memory.')
  })

  it('a mixed day with one remembered minute, singular', () => {
    expect(daySummary([timed({ active_minutes: 60, net_words: 300 }), remembered(1)]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, and the writing grew by 300 words. You also added 1 minute from memory.')
  })

  it('remembered minutes never move the SHAPE — 20 timed + 90 remembered is still a short spell', () => {
    expect(daySummary([timed({ active_minutes: 20, net_words: 0 }), remembered(90)]))
      .toBe('A short spell of work: 20 focused minutes across 1 session, spent shaping what was already there. You also added 90 minutes from memory.')
  })

  it('a remembered row\'s words never reach the words clause, even if a hand-built row carried some', () => {
    // buildPostHocRow zeroes every measured field; the TYPE does not, so this pins the rule at the
    // summary rather than trusting the builder.
    const rogue: SessionRow = { ...remembered(30), net_words: 999 }
    const s = daySummary([timed({ active_minutes: 60, net_words: 0 }), rogue])
    expect(s).toBe('A steady stretch: 60 focused minutes across 1 session, spent shaping what was already there. You also added 30 minutes from memory.')
    expect(s).not.toContain('999')
  })

  it('several remembered blocks sum in their own clause and count as no sessions', () => {
    expect(daySummary([timed({ active_minutes: 60, net_words: 300 }), remembered(45), remembered(45), remembered(15)]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, and the writing grew by 300 words. You also added 105 minutes from memory.')
  })

  it('a LEGACY row with no `entered` field is a focused session — testimony must CLAIM to be testimony', () => {
    const legacy = { ...timed({ active_minutes: 60, net_words: 300 }) } as Partial<SessionRow>
    delete legacy.entered
    expect(daySummary([legacy as SessionRow]))
      .toBe('A steady stretch: 60 focused minutes across 1 session, and the writing grew by 300 words.')
  })
})
