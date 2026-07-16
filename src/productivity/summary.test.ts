// The kind/non-shaming constraint (§A5, §C3), tested as a PROPERTY of the copy rather than trusted
// as an intention.
//
// "Productivity-guilt tooling gets deleted and is bad for users; this is a hard constraint, not a
// nicety." A hard constraint that lives only in a code comment is a hope. These tests sweep the
// whole range — empty day, light day, huge day — and assert the tone properties hold across all of
// it, so a future edit that reaches for "you only managed 18 minutes" fails the build.

import { describe, it, expect } from 'vitest'
import { aggregateDays } from './aggregate'
import { DAILY_CAVEAT, dayDetail, dayHeadline, describeCorrelation, formatMinutes } from './summary'
import { makeLightDay, makeSessionRows } from './fixtures'
import type { ChartDayAggregate as DayAggregate } from './aggregate'

const lightDay = aggregateDays(makeLightDay())[0]
const realDays = aggregateDays(makeSessionRows({ seed: 20260716 }))
const emptyDay: DayAggregate = {
  day: '2026-07-15', activeMinutes: 0, sessionCount: 0, wordsAdded: 0, wordsDeleted: 0, netWords: 0,
  editEvents: 0, breaks: { count: 0, totalMinutes: 0, medianMinutes: 0, longestMinutes: 0 },
  phases: { drafting: 0, editing: 0, unclear: 0, total: 0 }, hourHistogram: new Array(24).fill(0),
  pomodoroSessions: 0, minutesByDocType: {}, docCount: 0,
}

// ─── The tone matchers ────────────────────────────────────────────────────────
//
// Defined once, precisely, and PROVEN to fire (see "THE NEGATIVE FIRES" below). The first cut of
// these was written as one big `\b(...)\b` alternation and had a real hole: `down\s+\d\b` cannot
// match "down 40%" — `\b` after a single `\d` fails between "4" and "0" — so the single most
// obvious banned string in the spec ("a red 'productivity down' alert") sailed straight through.
// A matcher that can't catch the thing it names is the house disease in miniature. Hence: small,
// individually-checked patterns rather than one clever regex.

/**
 * Diminishing a quantity — "only 18 minutes", "only managed 18 minutes". Bare "only" is legitimate
 * scoping ("in this window only, not a cause"), so the pattern requires a QUANTITY within a couple
 * of words; that is what separates the diminisher from the qualifier.
 */
const SHAMING: RegExp[] = [
  /\b(only|just|merely|barely)\s+(\w+\s+){0,2}(a\s+)?(\d|few\b|handful\b)/i,
  /\b(failed|failure|unproductive|lazy|slacking|slipping)\b/i,
  /\b(poor|bad|worse|weak|disappointing)\s+(day|week|month|output|progress|effort)\b/i,
  /\blow\s+output\b/i,
  /\byou\s+(missed|failed|should\s+have|need\s+to\s+do\s+better)\b/i,
  /\bproductivity\s+(down|up)\b/i,
  /\b(down|up)\s+\d+\s*%/i,
  /\b(behind|falling\s+behind)\b/i,
]

const TARGETING: RegExp[] = [
  /\b(target|goal|quota|streak|benchmark|expected|par)\b/i,
  /\b(best|worst)\s+(day|week|month)\b/i,
  /\bcompared\s+to\b/i,
]

const SCORING: RegExp[] = [
  /\b(score|rating|grade|efficiency|performance)\b/i,
  /\bproductivity\s+(score|index|level)\b/i,
]

const CAUSAL: RegExp[] = [
  /\b(because|caused|leads?\s+to|led\s+to|due\s+to|thanks\s+to)\b/i,
  /\b(helps?|makes?|improves?|boosts?)\s+you\b/i,
]

/** The first pattern that matches, or null — so a failure names the rule it broke. */
function offends(line: string, patterns: RegExp[]): RegExp | null {
  return patterns.find(p => p.test(line)) ?? null
}

/** Every line of copy this module can produce, across the full range of days. */
function allCopy(): string[] {
  const days = [emptyDay, lightDay, ...realDays]
  const out: string[] = [DAILY_CAVEAT]
  for (const d of days) out.push(dayHeadline(d), ...dayDetail(d))
  for (const r of [-0.9, -0.5, -0.1, 0, 0.1, 0.5, 0.9]) out.push(describeCorrelation(r, 7))
  return out
}

describe('formatMinutes', () => {
  it('reads as time, not as a decimal', () => {
    expect(formatMinutes(0)).toBe('0m')
    expect(formatMinutes(18)).toBe('18m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(80)).toBe('1h 20m')
    expect(formatMinutes(130.4)).toBe('2h 10m')
  })
})

describe('dayHeadline', () => {
  it('describes a light day by what WAS done — the spec’s own framing', () => {
    const h = dayHeadline(lightDay)
    expect(h).toBe('A lighter day — 18m of focused writing.')
  })

  it('treats a day with no writing as legitimate, not as a failure', () => {
    expect(dayHeadline(emptyDay)).toMatch(/rest counts/)
  })

  it('reports a full day plainly, without praise or scoring', () => {
    const big = { ...lightDay, activeMinutes: 130, sessionCount: 4 }
    expect(dayHeadline(big)).toBe('2h 10m of focused writing across 4 sessions.')
  })
})

describe('dayDetail', () => {
  it('frames cut words as shaping, never as loss', () => {
    const lines = dayDetail(lightDay).join(' ')
    expect(lines).toMatch(/cut while shaping it/)
    expect(lines).not.toMatch(/lost|wasted|destroyed|undone/i)
  })

  it('surfaces the doc-type split so "40m on email" can be read off the day (§B2.1)', () => {
    const d = { ...lightDay, minutesByDocType: { essay: 90, email: 40 } }
    expect(dayDetail(d).join(' ')).toMatch(/1h 30m on essay · 40m on email/)
  })

  it('says nothing at all about a day with no sessions', () => {
    expect(dayDetail(emptyDay)).toEqual([])
  })
})

// ─── THE HARD CONSTRAINT ──────────────────────────────────────────────────────

describe('the copy is kind and non-shaming (§A5, §C3) — swept across every day shape', () => {
  it('never uses shaming or judgemental vocabulary', () => {
    for (const line of allCopy()) {
      expect(offends(line, SHAMING), `shaming language in: "${line}"`).toBeNull()
    }
  })

  it('never compares the writer to a target, goal, quota or streak', () => {
    for (const line of allCopy()) {
      expect(offends(line, TARGETING), `target comparison in: "${line}"`).toBeNull()
    }
  })

  it('never presents an output score or a productivity verdict', () => {
    for (const line of allCopy()) {
      expect(offends(line, SCORING), `scoring language in: "${line}"`).toBeNull()
    }
  })

  it('THE NEGATIVE FIRES — every matcher catches the copy it exists to forbid', () => {
    // Proof the three sweeps above do work rather than passing over strings that could never fail.
    // Each line is copy this feature must never produce; each must be caught by its own matcher.
    const banned: [string, RegExp[]][] = [
      ['You only managed 18 minutes today.', SHAMING],
      ['A lighter day — just 3 words written.', SHAMING],
      ['Productivity down 40% on last week.', SHAMING],   // the multi-digit case the first cut missed
      ['Productivity up 12% — nice.', SHAMING],
      ['A poor week for progress.', SHAMING],
      ['You failed to write today.', SHAMING],
      ['You are falling behind.', SHAMING],
      ['Unproductive day.', SHAMING],
      ['You missed your daily goal.', SHAMING],
      ['You hit 60% of your target.', TARGETING],
      ['Your 5-day streak ended.', TARGETING],
      ['Your worst week this month.', TARGETING],
      ['Compared to last week, output fell.', TARGETING],
      ['Your productivity score is 62.', SCORING],
      ['Writing efficiency: 480 words/hour.', SCORING],
      ['You wrote more because you took breaks.', CAUSAL],
      ['Breaks help you write more.', CAUSAL],
    ]
    for (const [line, patterns] of banned) {
      expect(offends(line, patterns), `should have caught: "${line}"`).not.toBeNull()
    }
    // And the sweep's own corpus is non-trivial — it isn't passing because it's empty.
    expect(allCopy().length).toBeGreaterThan(30)
  })
})

describe('the daily window makes no pattern claim (§A6.2)', () => {
  it('the standing caveat points the reader at the weekly view', () => {
    expect(DAILY_CAVEAT).toMatch(/one day/)
    expect(DAILY_CAVEAT).toMatch(/weekly/)
  })

  it('no daily copy asserts a cause', () => {
    const daily = [dayHeadline(lightDay), ...dayDetail(lightDay), ...realDays.flatMap(d => [dayHeadline(d), ...dayDetail(d)])]
    for (const line of daily) {
      expect(offends(line, CAUSAL), `causal claim in daily copy: "${line}"`).toBeNull()
    }
  })
})

describe('describeCorrelation — descriptive only (§A3.3)', () => {
  it('states an association and explicitly disclaims cause', () => {
    const s = describeCorrelation(0.7, 12)
    expect(s).toMatch(/went with/)
    expect(s).toMatch(/not a cause/)
  })

  it('reports a weak relationship as weak rather than spinning it', () => {
    expect(describeCorrelation(0.05, 9)).toMatch(/little visible relationship/)
  })

  it('always carries its sample size', () => {
    for (const r of [-0.9, 0, 0.9]) expect(describeCorrelation(r, 7)).toMatch(/7 days/)
  })

  it('never phrases the association as advice', () => {
    const advice = /\b(you should|try to|make sure|aim for|recommend)\b/i
    for (const r of [-0.9, -0.5, 0, 0.5, 0.9]) expect(describeCorrelation(r, 10)).not.toMatch(advice)
  })
})
