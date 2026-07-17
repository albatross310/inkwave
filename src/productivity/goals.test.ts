// §A5b — the goals model. THE VERDICT IS THE THING BEING TESTED.
//
// `milestoneStatus` is a MEASURED field (§A6.4): whether the writer hit a date they set is a
// comparison of two dates they supplied, computed here and shipped to the model as a verdict rather
// than as two dates for a narrator to re-derive. So a wrong verdict is not a cosmetic bug — it is
// the report telling the writer they missed a deadline they made, in the wry register Peter asked
// for. These tests exist to make that unrepresentable.
//
// EVERY FIXTURE BELOW VARIES THE RULE IT CLAIMS TO TEST. CLAUDE.md's standing trap (phase.variants'
// F1, and staticPagination's "a test only sees a rule it VARIES") is that a fixture whose values
// sit in a void scores identically under the rule and under its mutant. The two rules here that can
// silently degrade are (a) met-vs-met-late, which only discriminates when done_at's LOCAL day
// differs from its UTC day, and (b) missed-vs-upcoming, which only discriminates across the date.
// Both are exercised at their boundary, deliberately.

import { describe, expect, it } from 'vitest'
import {
  addMilestone, daysBetween, hasGoals, milestoneStatus, removeMilestone, setGoal, setPlan,
  toggleMilestone, updateMilestone,
} from './goals'
import type { DocGoals, DocMilestone } from '../types/document'

const NOW = '2026-07-20T09:00:00+10:00'
const TODAY = '2026-07-20'

const m = (over: Partial<DocMilestone> = {}): DocMilestone =>
  ({ id: 'm1', text: 'finish the lit review', ...over })

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-07-20', '2026-07-23')).toBe(3)
    expect(daysBetween('2026-07-20', '2026-07-17')).toBe(-3)
    expect(daysBetween('2026-07-20', '2026-07-20')).toBe(0)
  })

  it('crosses a month and a DST-shaped boundary without drifting', () => {
    // Rounded, not floored: an implementation doing raw division over a 23/25-hour civil day would
    // land on 30.958… and truncate. These are UTC-parsed date strings so the hazard is latent —
    // pinned anyway, because the fix for a "24 hours is not a day" bug is usually to reach for
    // local parsing, which is where this breaks.
    expect(daysBetween('2026-03-31', '2026-05-01')).toBe(31)
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7)
  })
})

describe('milestoneStatus — the measured verdict', () => {
  it('undated: a goal with no date is still a goal, never "missed"', () => {
    // The honest state. Inventing a deadline for an undated goal is exactly §A5b's banned
    // "invent a standard" — so `undated` must never decay into `missed` however old it gets.
    expect(milestoneStatus(m(), TODAY)).toEqual({ status: 'undated' })
  })

  it('undated + done: met, with no days_remaining to report', () => {
    expect(milestoneStatus(m({ done_at: NOW }), TODAY)).toEqual({ status: 'met' })
  })

  it('missed: past its date and still undone', () => {
    expect(milestoneStatus(m({ due: '2026-07-17' }), TODAY))
      .toEqual({ status: 'missed', days_remaining: -3 })
  })

  it('due-today is its OWN status, not "missed" and not "upcoming"', () => {
    // The boundary. An off-by-one in either direction lands here, and the copy differs sharply:
    // "due today. No pressure." vs "a day past its date".
    expect(milestoneStatus(m({ due: TODAY }), TODAY))
      .toEqual({ status: 'due-today', days_remaining: 0 })
  })

  it('upcoming: not yet due', () => {
    expect(milestoneStatus(m({ due: '2026-07-21' }), TODAY))
      .toEqual({ status: 'upcoming', days_remaining: 1 })
    expect(milestoneStatus(m({ due: '2026-08-01' }), TODAY))
      .toEqual({ status: 'upcoming', days_remaining: 12 })
  })

  it('met: done on or before the date the writer set', () => {
    expect(milestoneStatus(m({ due: '2026-07-20', done_at: '2026-07-20T23:30:00+10:00' }), TODAY).status)
      .toBe('met')
    expect(milestoneStatus(m({ due: '2026-07-20', done_at: '2026-07-18T09:00:00+10:00' }), TODAY).status)
      .toBe('met')
  })

  it('met-late is NOT met — the one thing a tracking report has to be honest about', () => {
    expect(milestoneStatus(m({ due: '2026-07-17', done_at: NOW }), TODAY).status).toBe('met-late')
  })

  // ── THE LOCAL-DAY RULE, AND THE MUTANT THAT SURVIVED ─────────────────────────────────────────
  // These two cases are the reason `milestoneStatus` calls `localDayOf`. Both timestamps are on the
  // WRITER's side of midnight and the UTC side's PREVIOUS/NEXT day; a fixture at midday Brisbane
  // cannot see the difference at all and would pass either way.
  //
  // ⚠ WHICH MUTANT KILLS THESE IS THE FINDING, and it is the opposite of the obvious guess.
  // Replacing `localDayOf(done_at)` with `done_at.slice(0, 10)` SURVIVES all 26 tests — and it is
  // not a hole: an ISO string with an offset carries the writer's WALL CLOCK in its first ten
  // characters, so slicing already IS the local day. `localDayOf` earns its keep by handling the
  // shapes the slice cannot (a bare `Z`, an offset-less string), not by being cleverer here.
  // The mutant that DOES kill them is the realistic one — reaching for `Date`:
  //     new Date(done_at).toISOString().slice(0, 10)   ⇒ these 2 fail, the on-time arm survives.
  // That is precisely the "fix" someone applies while tidying string handling, and it silently
  // moves the deadline by up to a day in whichever direction the writer's hemisphere lies.
  it('judges by the WRITER\'S local day: 08:00 Brisbane on the 21st is late for the 20th', () => {
    // UTC instant: 2026-07-20T22:00Z. Reading the UTC day (the 20th) would call this ON TIME.
    const late = m({ due: '2026-07-20', done_at: '2026-07-21T08:00:00+10:00' })
    expect(milestoneStatus(late, '2026-07-21').status).toBe('met-late')
  })

  it('judges by the WRITER\'S local day: 22:00 Brisbane on the 20th is on time for the 20th', () => {
    // UTC instant: 2026-07-20T12:00Z — same UTC day, so this arm alone cannot discriminate. It is
    // here as the POSITIVE half of the pair: without it, a mutant that always says "met-late" would
    // pass the test above and prove nothing. A negative needs its positive or it is decoration.
    const onTime = m({ due: '2026-07-20', done_at: '2026-07-20T22:00:00+10:00' })
    expect(milestoneStatus(onTime, '2026-07-20').status).toBe('met')
  })

  it('a writer west of UTC is judged on their own clock too', () => {
    // -07:00. done_at 23:00 on the 20th local = 06:00 on the 21st UTC. A UTC reader calls this LATE
    // for a goal due the 20th; the writer finished it before bed on the day they said. The two
    // hemispheres fail in OPPOSITE directions, which is why both are here.
    const onTime = m({ due: '2026-07-20', done_at: '2026-07-20T23:00:00-07:00' })
    expect(milestoneStatus(onTime, '2026-07-20').status).toBe('met')
  })

  it('done_at wins over the date having passed — a finished goal never reads as missed', () => {
    const done = m({ due: '2026-06-01', done_at: NOW })
    expect(milestoneStatus(done, TODAY).status).toBe('met-late')
    expect(milestoneStatus(done, TODAY).status).not.toBe('missed')
  })
})

describe('hasGoals — absent and empty are the same nothing', () => {
  it('false for undefined, {}, and all-blank', () => {
    expect(hasGoals(undefined)).toBe(false)
    expect(hasGoals({})).toBe(false)
    expect(hasGoals({ goal: '   ', plan: '\n\t ' })).toBe(false)
    expect(hasGoals({ milestones: [] })).toBe(false)
    // A milestone whose text is whitespace is not something the writer said.
    expect(hasGoals({ milestones: [m({ text: '  ' })] })).toBe(false)
  })

  it('true as soon as the writer has actually said ANY of the three things', () => {
    expect(hasGoals({ goal: 'a real goal' })).toBe(true)
    expect(hasGoals({ plan: 'a rough plan' })).toBe(true)
    expect(hasGoals({ milestones: [m()] })).toBe(true)
  })

  it('a goals object carrying ONLY an updatedAt stamp is still nothing', () => {
    // The mutators stamp `updatedAt` unconditionally, so an empty edit mints `{updatedAt}`. If that
    // counted, the report would say the writer shared a goal and show it an empty section — and the
    // prompt's whole no-goals branch (DESCRIBE, DO NOT PUSH) would be skipped over an empty box.
    expect(hasGoals({ updatedAt: NOW })).toBe(false)
  })
})

describe('the pure mutators — the UI hands the result to the editor\'s autosave', () => {
  it('setGoal / setPlan store the writer\'s words and stamp when', () => {
    const g = setGoal(undefined, '  Chapter 3   done by August ', NOW)
    expect(g.goal).toBe('Chapter 3 done by August')
    expect(g.updatedAt).toBe(NOW)
    expect(setPlan(g, 'draft, then cut', NOW).goal).toBe('Chapter 3 done by August')
  })

  it('a blank goal CLEARS rather than storing an empty string', () => {
    expect(setGoal({ goal: 'old' }, '   ', NOW).goal).toBeUndefined()
  })

  it('never mutates the input — the editor holds the old doc until autosave takes the new one', () => {
    const before: DocGoals = { goal: 'original', milestones: [m()] }
    const frozen = JSON.stringify(before)
    setGoal(before, 'changed', NOW)
    addMilestone(before, 'another', '2026-08-01', NOW)
    toggleMilestone(before, 'm1', NOW)
    removeMilestone(before, 'm1', NOW)
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('addMilestone refuses a blank and keeps the goals it was handed', () => {
    const g: DocGoals = { goal: 'keep me' }
    expect(addMilestone(g, '   ', undefined, NOW)).toEqual(g)
    expect(addMilestone(undefined, '', undefined, NOW)).toEqual({})
  })

  it('addMilestone omits `due` entirely when undated — never stores ""', () => {
    const g = addMilestone(undefined, 'someday', undefined, NOW)
    expect(g.milestones![0]).not.toHaveProperty('due')
    // ...which is what keeps `milestoneStatus` on its `undated` branch rather than parsing ''.
    expect(milestoneStatus(g.milestones![0], TODAY).status).toBe('undated')
  })

  it('addMilestone gives each milestone its own id', () => {
    const g = addMilestone(addMilestone(undefined, 'one', undefined, NOW), 'two', undefined, NOW)
    const [a, b] = g.milestones!
    expect(a.id).not.toBe(b.id)
  })

  it('updateMilestone with an empty due REMOVES the deadline (they took it off)', () => {
    const g: DocGoals = { milestones: [m({ due: '2026-07-30' })] }
    const next = updateMilestone(g, 'm1', { due: '' }, NOW)
    expect(next.milestones![0]).not.toHaveProperty('due')
    expect(milestoneStatus(next.milestones![0], TODAY).status).toBe('undated')
  })

  it('updateMilestone touches only the named milestone', () => {
    const g: DocGoals = { milestones: [m(), m({ id: 'm2', text: 'other' })] }
    const next = updateMilestone(g, 'm2', { text: 'renamed' }, NOW)
    expect(next.milestones!.map(x => x.text)).toEqual(['finish the lit review', 'renamed'])
  })

  it('toggleMilestone records WHEN, and un-ticking DELETES it rather than storing false', () => {
    const on = toggleMilestone({ milestones: [m({ due: '2026-07-17' })] }, 'm1', NOW)
    expect(on.milestones![0].done_at).toBe(NOW)
    expect(milestoneStatus(on.milestones![0], TODAY).status).toBe('met-late')

    const off = toggleMilestone(on, 'm1', NOW)
    // `done_at: undefined` would survive JSON.stringify as an absent key anyway — but `done: false`
    // or a retained stamp would make a re-ticked goal claim a completion date it did not have.
    expect(off.milestones![0]).not.toHaveProperty('done_at')
    expect(milestoneStatus(off.milestones![0], TODAY).status).toBe('missed')
  })

  it('removeMilestone drops exactly one and stamps the edit', () => {
    const g: DocGoals = { milestones: [m(), m({ id: 'm2' })] }
    const next = removeMilestone(g, 'm1', NOW)
    expect(next.milestones!.map(x => x.id)).toEqual(['m2'])
    expect(next.updatedAt).toBe(NOW)
  })
})
