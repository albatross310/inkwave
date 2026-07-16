// WHICH PROXY CARRIES THE RULE? — the probe behind the §A3.3 deviation, kept as a test so the
// answer stays true.
//
// This is the evidence for phase.ts shipping the add/delete ratio ALONE rather than the spec's
// example conjunction of ratio + session duration. It scores variants on the same labelled
// fixtures: drop one proxy at a time and watch what moves.
//
// It asserts the CONCLUSION, so a future change to the thresholds or the fixtures that invalidates
// it fails loudly here instead of silently making the shipped ratio wrong again.

import { describe, it, expect } from 'vitest'
import { makeLedger, type TruePhase } from './fixtures'
import { classifySession, PHASE_THRESHOLDS, type Phase } from './phase'

type Rule = (s: { words_added: number; words_deleted: number; active_minutes: number }) => Phase

const T = PHASE_THRESHOLDS
const ratio = (s: { words_added: number; words_deleted: number }) =>
  s.words_added + s.words_deleted === 0 ? 0 : s.words_added / (s.words_added + s.words_deleted)

/** The SHIPPED rule — the add/delete ratio alone (phase.ts). */
const ratioOnly: Rule = s => classifySession(s).phase

/** The spec's §A3.3 example rule, verbatim: both proxies must agree, or no call. */
const conjunctive: Rule = s => {
  const churn = s.words_added + s.words_deleted
  if (churn < 10) return 'unclear'
  const r = ratio(s), m = s.active_minutes
  if (r >= T.draftAddRatio && m >= T.longMinutes) return 'drafting'
  if (r <= T.editAddRatio && m <= T.shortMinutes) return 'editing'
  return 'unclear'
}

/** Variant B — duration ALONE. Ratio ignored entirely. */
const durationOnly: Rule = s => {
  if (s.words_added + s.words_deleted < 10) return 'unclear'
  if (s.active_minutes >= T.longMinutes) return 'drafting'
  if (s.active_minutes <= T.shortMinutes) return 'editing'
  return 'unclear'
}

/** Variant C — ratio alone, but splitting at the midpoint so it always commits. */
const ratioForced: Rule = s => {
  if (s.words_added + s.words_deleted < 10) return 'unclear'
  return ratio(s) >= 0.6 ? 'drafting' : 'editing'
}

interface V { name: string; precision: number; coverage: number; wrong: number; balance: number }

function evaluate(name: string, rule: Rule, seed = 20260716): V {
  const labelled = makeLedger({ seed })
  let right = 0, committed = 0, calledDrafting = 0, calledEditing = 0
  for (const { session, truth } of labelled) {
    const p = rule(session)
    if (p === 'unclear') continue
    committed++
    if (p === 'drafting') calledDrafting++; else calledEditing++
    if ((p as string) === (truth as string)) right++
  }
  return {
    name,
    precision: committed ? right / committed : 0,
    coverage: committed / labelled.length,
    wrong: committed - right,
    // Share of calls that were `drafting`. Ground truth here is ~48% drafting, so a rule reporting
    // far from that is systematically misrepresenting the writer's month even when each call is right.
    balance: committed ? calledDrafting / committed : 0,
  }
}

function truthBalance(seed = 20260716): number {
  const l = makeLedger({ seed })
  return l.filter(x => x.truth === ('drafting' as TruePhase)).length / l.length
}

describe('which proxy carries the rule', () => {
  it('reports every variant side by side', () => {
    const vs = [
      evaluate('ratio only (SHIPPED)', ratioOnly),
      evaluate('ratio+duration (spec e.g.)', conjunctive),
      evaluate('duration only', durationOnly),
      evaluate('ratio forced (no unclear)', ratioForced),
    ]
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6)
    console.log(`
  rule variants vs labelled truth (seed 20260716; true drafting share ${pct(truthBalance())})
  ${'rule'.padEnd(26)} ${'precision'.padStart(9)} ${'coverage'.padStart(9)} ${'wrong'.padStart(6)} ${'called-drafting'.padStart(16)}
${vs.map(v => `  ${v.name.padEnd(26)} ${pct(v.precision)}    ${pct(v.coverage)}    ${String(v.wrong).padStart(5)}   ${pct(v.balance)}`).join('\n')}
`)
    expect(vs).toHaveLength(4)
  })

  it('THE DURATION PROXY IS THE PROBLEM — dropping it roughly doubles coverage at no cost to precision', () => {
    // The justification for shipping ratio-only. If a future change makes the spec's conjunction
    // competitive again, this fails and the deviation should be revisited.
    const conj = evaluate('c', conjunctive)
    const ro = evaluate('r', ratioOnly)
    expect(ro.coverage).toBeGreaterThan(conj.coverage * 1.8)
    // And it stays perfectly precise: the add/delete ratio alone never made a wrong call here.
    expect(ro.wrong).toBe(0)
  })

  it('THE DURATION PROXY ALONE IS NEAR-WORTHLESS — it makes real mistakes', () => {
    // This is the decisive one. Session LENGTH does not track what the writer was doing: long
    // revising sessions and short drafting bursts are both common, so duration misclassifies.
    const d = evaluate('d', durationOnly)
    expect(d.wrong).toBeGreaterThan(5)
    expect(d.precision).toBeLessThan(0.8)
  })

  it("the spec's rule systematically over-reports drafting; the shipped rule is closer to the truth", () => {
    const truth = truthBalance()
    const conj = evaluate('c', conjunctive)
    const ro = evaluate('r', ratioOnly)
    // The spec rule's calls are ~84% drafting against a ~48% truth — it would tell a writer they
    // spent the month drafting when they spent half of it editing.
    expect(conj.balance - truth).toBeGreaterThan(0.3)
    // The shipped rule lands far closer to the real mix.
    expect(Math.abs(ro.balance - truth)).toBeLessThan(Math.abs(conj.balance - truth))
  })

  it('forcing a call (no unclear band) is where precision finally breaks', () => {
    // Justifies keeping `unclear`: the middle band is genuinely ambiguous, and a rule that refuses
    // to admit it starts being wrong.
    const f = evaluate('f', ratioForced)
    expect(f.coverage).toBeGreaterThan(0.95)
    expect(f.wrong).toBeGreaterThan(0)
  })
})
