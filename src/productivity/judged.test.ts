// The measured/judged seam and the §A6.2 statistical-honesty gate.
//
// THE POINT OF THIS FILE. The gate is a NEGATIVE: it exists to stop something from rendering. A
// negative that cannot fire is not a negative — it is a feature silently disabled, and its absence
// looks exactly like the feature being unnecessary. So every test here checks BOTH directions:
// the gate blocks what it must block (it fires), AND it passes what it must pass (it isn't just
// returning empty forever). A gate that blocked everything would pass a one-sided suite.

import { describe, it, expect } from 'vitest'
import { allowsPatternClaims, comparePhases, selectClaims, type JudgedClaim, type JudgedSession, type ReportWindow } from './judged'
import { SERIES_STYLE, type Provenance } from './charts/series'

const descriptive: JudgedClaim = { id: 'd1', kind: 'descriptive', text: 'You wrote for 90 minutes across three sessions.' }
const pattern: JudgedClaim = { id: 'p1', kind: 'pattern', text: 'Your deepest writing comes in the 25 minutes after a break.' }
const pattern2: JudgedClaim = { id: 'p2', kind: 'pattern', text: 'Mornings are consistently your strongest hours.' }

describe('allowsPatternClaims (§A6.2)', () => {
  it('permits pattern claims at weekly and monthly', () => {
    expect(allowsPatternClaims('week')).toBe(true)
    expect(allowsPatternClaims('month')).toBe(true)
  })

  it('REFUSES pattern claims at daily — one day is statistically noise', () => {
    expect(allowsPatternClaims('day')).toBe(false)
  })
})

describe('selectClaims — the gate', () => {
  it('FIRES: a causal claim from one day’s data is withheld, not shown', () => {
    const sel = selectClaims([descriptive, pattern], 'day')
    expect(sel.shown.map(c => c.id)).toEqual(['d1'])
    expect(sel.withheld.map(c => c.id)).toEqual(['p1'])
  })

  it('withholds EVERY pattern claim, not just the first', () => {
    const sel = selectClaims([pattern, descriptive, pattern2], 'day')
    expect(sel.withheld.map(c => c.id)).toEqual(['p1', 'p2'])
    expect(sel.shown.map(c => c.id)).toEqual(['d1'])
  })

  it('does NOT block descriptive recap at daily — the daily window still works', () => {
    // The other half of the negative: a gate that blocked everything would also pass the test above.
    const sel = selectClaims([descriptive], 'day')
    expect(sel.shown).toHaveLength(1)
    expect(sel.withheld).toHaveLength(0)
  })

  it('PASSES pattern claims at weekly and monthly — the gate is not always-closed', () => {
    for (const w of ['week', 'month'] as ReportWindow[]) {
      const sel = selectClaims([descriptive, pattern, pattern2], w)
      expect(sel.shown, `window ${w}`).toHaveLength(3)
      expect(sel.withheld, `window ${w}`).toHaveLength(0)
    }
  })

  it('never silently drops a claim — shown + withheld accounts for all of them (§A9)', () => {
    const all = [descriptive, pattern, pattern2]
    for (const w of ['day', 'week', 'month'] as ReportWindow[]) {
      const sel = selectClaims(all, w)
      expect(sel.shown.length + sel.withheld.length, `window ${w}`).toBe(all.length)
    }
  })

  it('does not mutate its input', () => {
    const all = [descriptive, pattern]
    selectClaims(all, 'day')
    expect(all).toHaveLength(2)
  })

  it('is empty-safe', () => {
    expect(selectClaims([], 'day')).toEqual({ shown: [], withheld: [] })
  })
})

describe('the visual contract (§A6.1) is structural', () => {
  it('every provenance has a distinct legend sentence saying which is which', () => {
    const legends = (['measured', 'estimated', 'judged'] as Provenance[]).map(p => SERIES_STYLE[p].legend)
    expect(new Set(legends).size).toBe(3)
    for (const l of legends) expect(l.length).toBeGreaterThan(10)
  })

  it('ONLY the judged series is hatched — the mark that distinguishes AI output', () => {
    expect(SERIES_STYLE.judged.hatch).toBeTruthy()
    expect(SERIES_STYLE.measured.hatch).toBeNull()
    expect(SERIES_STYLE.estimated.hatch).toBeNull()
  })

  it('judged and measured differ in FILL, not merely in a caption', () => {
    // If these ever became equal, an AI overlay would paint identically to a measured bar and the
    // §A6.1 promise would be broken while every test about legends still passed.
    expect(SERIES_STYLE.judged.fill).not.toBe(SERIES_STYLE.measured.fill)
    expect(SERIES_STYLE.judged.stroke).not.toBe(SERIES_STYLE.measured.stroke)
  })

  it('the estimated (rule) series is distinct from BOTH — it is neither measurement nor AI', () => {
    expect(SERIES_STYLE.estimated.fill).not.toBe(SERIES_STYLE.measured.fill)
    expect(SERIES_STYLE.estimated.fill).not.toBe(SERIES_STYLE.judged.fill)
  })

  it('every colour is a theme token with a day fallback — no bare hex (CLAUDE.md THEMING)', () => {
    // A hard-coded hex here renders unreadable in night mode. Pin it.
    for (const p of ['measured', 'estimated', 'judged'] as Provenance[]) {
      const st = SERIES_STYLE[p]
      for (const c of [st.fill, st.stroke]) {
        if (c === 'none') continue
        expect(c, `${p} colour "${c}"`).toMatch(/^var\(--iw-[a-z-]+, #[0-9a-f]{6}\)$/)
      }
    }
  })
})

describe('comparePhases — rule vs AI', () => {
  const judged: JudgedSession[] = [
    { session_id: 'a', phase: 'deep' },
    { session_id: 'b', phase: 'shallow' },
    { session_id: 'c', phase: 'deep' },
  ]

  it('agrees when the rule and the model point the same way', () => {
    const ruled = new Map([['a', 'drafting' as const], ['b', 'editing' as const]])
    const out = comparePhases(ruled, judged)
    expect(out.map(c => c.agrees)).toEqual([true, true])
  })

  it('disagrees when they point opposite ways', () => {
    const ruled = new Map([['a', 'editing' as const], ['b', 'drafting' as const]])
    expect(comparePhases(ruled, judged).every(c => c.agrees)).toBe(false)
  })

  it('an UNCLEAR ruling can never count as agreement', () => {
    // The rule declined to call it. Scoring that as agreement would inflate the agreement rate with
    // sessions the rule said nothing about — the known-negative-that-scores-identically failure.
    const ruled = new Map([['a', 'unclear' as const], ['c', 'unclear' as const]])
    const out = comparePhases(ruled, judged)
    expect(out).toHaveLength(2)
    expect(out.every(c => c.agrees)).toBe(false)
  })

  it('ignores judged sessions the ledger has no row for — never invents a comparison', () => {
    expect(comparePhases(new Map(), judged)).toEqual([])
  })
})
