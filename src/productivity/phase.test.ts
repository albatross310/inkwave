// The deep-vs-shallow heuristic, scored against labelled synthetic writing.
//
// This suite exists to answer ONE question honestly: does the rule actually distinguish drafting
// from editing, or does it just produce a number that looks like it does? The fixtures are built to
// be able to say NO (see the header of fixtures.ts — the classes overlap in both proxies). The
// measured answer is recorded in the assertions below and printed in full by the confusion-matrix
// test. phase.variants.test.ts scores the alternatives, including the spec's example rule.

import { describe, it, expect } from 'vitest'
import { classifySession, phaseMix, PHASE_THRESHOLDS, type Phase } from './phase'
import { makeLedger, type TruePhase } from './fixtures'

describe('classifySession — the shipped rule', () => {
  it('calls a mostly-adding session drafting', () => {
    expect(classifySession({ words_added: 600, words_deleted: 60 }).phase).toBe('drafting')
  })

  it('calls a heavy-cutting session editing', () => {
    expect(classifySession({ words_added: 40, words_deleted: 90 }).phase).toBe('editing')
  })

  it('declines the unclaimed middle band', () => {
    // addRatio 0.6 — between the 0.50 and 0.70 cut-points. Genuinely ambiguous; say so.
    const v = classifySession({ words_added: 300, words_deleted: 200 })
    expect(v.phase).toBe('unclear')
    expect(v.reason).toMatch(/mix/)
  })

  it('refuses to classify a session with almost no writing in it', () => {
    const v = classifySession({ words_added: 3, words_deleted: 1 })
    expect(v.phase).toBe('unclear')
    expect(v.reason).toMatch(/too little/)
  })

  it('never divides by zero on an empty session', () => {
    const v = classifySession({ words_added: 0, words_deleted: 0 })
    expect(v.phase).toBe('unclear')
    expect(Number.isFinite(v.addRatio)).toBe(true)
  })

  it('IGNORES session duration — the proxy the variants probe measured as worse than chance', () => {
    // Same words, wildly different durations ⇒ identical verdict. This is the deviation from the
    // spec's example rule, pinned so it can't be quietly undone.
    const short = classifySession({ words_added: 180, words_deleted: 15, active_minutes: 4 } as never)
    const long = classifySession({ words_added: 180, words_deleted: 15, active_minutes: 400 } as never)
    expect(short).toEqual(long)
    expect(short.phase).toBe('drafting')
  })
})

describe('the thresholds are boundaries, not suggestions', () => {
  it('commits exactly AT each cut-point', () => {
    const draft = classifySession({ words_added: 70, words_deleted: 30 })
    expect(draft.addRatio).toBe(PHASE_THRESHOLDS.draftAddRatio)
    expect(draft.phase).toBe('drafting')

    const edit = classifySession({ words_added: 50, words_deleted: 50 })
    expect(edit.addRatio).toBe(PHASE_THRESHOLDS.editAddRatio)
    expect(edit.phase).toBe('editing')
  })

  it('a hair inside the band and it declines', () => {
    expect(classifySession({ words_added: 69, words_deleted: 31 }).phase).toBe('unclear')
    expect(classifySession({ words_added: 51, words_deleted: 49 }).phase).toBe('unclear')
  })
})

describe('phaseMix', () => {
  it('counts every session exactly once and carries its denominator', () => {
    const sessions = makeLedger({ seed: 7 }).map(l => l.session)
    const mix = phaseMix(sessions)
    expect(mix.drafting + mix.editing + mix.unclear).toBe(mix.total)
    expect(mix.total).toBe(sessions.length)
  })

  it('is empty-safe', () => {
    expect(phaseMix([])).toEqual({ drafting: 0, editing: 0, unclear: 0, total: 0 })
  })
})

// ─── THE MEASUREMENT ──────────────────────────────────────────────────────────

interface Score {
  /** Of the sessions the rule COMMITTED on, the share it got right. */
  precision: number
  /** Of all sessions, the share the rule committed on at all. */
  coverage: number
  /** Of the sessions it committed on and got wrong. */
  wrong: number
  matrix: Record<TruePhase, Record<Phase, number>>
  byProcess: Record<string, Record<Phase, number>>
  n: number
}

function score(seed: number): Score {
  const labelled = makeLedger({ seed })
  const matrix: Score['matrix'] = {
    drafting: { drafting: 0, editing: 0, unclear: 0 },
    editing: { drafting: 0, editing: 0, unclear: 0 },
  }
  const byProcess: Score['byProcess'] = {}
  for (const { session, truth, process } of labelled) {
    const p = classifySession(session).phase
    matrix[truth][p]++
    byProcess[process] ??= { drafting: 0, editing: 0, unclear: 0 }
    byProcess[process][p]++
  }
  const committed = matrix.drafting.drafting + matrix.drafting.editing + matrix.editing.drafting + matrix.editing.editing
  const right = matrix.drafting.drafting + matrix.editing.editing
  return {
    precision: committed ? right / committed : 0,
    coverage: labelled.length ? committed / labelled.length : 0,
    wrong: committed - right,
    matrix, byProcess, n: labelled.length,
  }
}

describe('the heuristic scored against labelled writing — the honest verdict', () => {
  it('reports its full behaviour (confusion matrix + per-process breakdown)', () => {
    const s = score(20260716)
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`
    const rows = Object.entries(s.byProcess)
      .map(([proc, m]) => `    ${proc.padEnd(9)} → drafting ${String(m.drafting).padStart(3)} | editing ${String(m.editing).padStart(3)} | unclear ${String(m.unclear).padStart(3)}`)
      .join('\n')
    // Printed so the verdict is READ, not inferred from a green tick.
    console.log(`
  deep-vs-shallow heuristic (SHIPPED: add/delete ratio) — ${s.n} labelled sessions (seed 20260716)
    precision (of the calls it made, share correct): ${pct(s.precision)}
    coverage  (share of sessions it called at all):  ${pct(s.coverage)}
    outright wrong calls:                            ${s.wrong}
  by generative process:
${rows}
  truth=drafting → ${JSON.stringify(s.matrix.drafting)}
  truth=editing  → ${JSON.stringify(s.matrix.editing)}
`)
    expect(s.n).toBeGreaterThan(40)
  })

  it('WHEN IT COMMITS, IT IS RIGHT — no outright misclassifications across five seeds', () => {
    // The unclear band is what buys this: a `drafting` badge in the UI is trustworthy.
    for (const seed of [1, 42, 777, 20260716, 999999]) {
      const s = score(seed)
      expect(s.wrong, `seed ${seed} produced ${s.wrong} wrong calls`).toBe(0)
      expect(s.precision).toBe(1)
    }
  })

  it('AND IT CALLS ROUGHLY TWO SESSIONS IN THREE, across five seeds', () => {
    // Measured 66–78% on the corrected fixture (it was ~81% on the old one, whose truth classes did
    // not overlap in addRatio — that number was flattered by a fixture that couldn't be wrong).
    for (const seed of [1, 42, 777, 20260716, 999999]) {
      const s = score(seed)
      expect(s.coverage, `seed ${seed} coverage`).toBeGreaterThan(0.6)
      // ...and it never declines nearly everything: a rule that abstains is not a rule.
      expect(s.coverage, `seed ${seed} coverage`).toBeLessThan(0.95)
    }
  })

  it('what it declines is the genuinely ambiguous middle, not one whole class of writing', () => {
    // The residual failure mode, stated honestly and MEASURED on a fixture whose classes overlap:
    //   • `burst` (short, little second-guessing) — always called; the ratio is unambiguous there.
    //   • `drafting` — declined ~25% of the time. These are the HARD drafting sessions that cut most
    //     of what they lay down; to a word counter they are indistinguishable from editing, and the
    //     rule correctly refuses rather than guessing.
    //   • `revising` — declined ~half the time. Deep restructuring sits ON the boundary by nature.
    // This is the shape of an honest limit, not a bug: every one of these declines is a session
    // where the shipped proxy genuinely does not carry the answer.
    const s = score(20260716)
    const declineRate = (p: string) => {
      const m = s.byProcess[p]
      const t = m.drafting + m.editing + m.unclear
      return t ? m.unclear / t : 0
    }
    expect(declineRate('burst')).toBeLessThan(0.1)
    expect(declineRate('drafting')).toBeGreaterThan(0.1)
    expect(declineRate('drafting')).toBeLessThan(0.45)
    expect(declineRate('revising')).toBeGreaterThan(0.3)
  })
})

// ─── The negative must be able to fire (house rule: a negative that cannot fail is not a negative) ─

describe('the scorer itself can detect a broken rule', () => {
  it('a deliberately inverted rule scores badly on the SAME fixtures', () => {
    // If the fixtures were structurally blind — if drafting and editing were indistinguishable in
    // them — an INVERTED classifier would score the same as the real one and the suite above would
    // be measuring nothing. It does not: inverting produces wrong calls on exactly the sessions the
    // real rule gets right. This is what makes the 100% precision a finding rather than an artefact.
    const labelled = makeLedger({ seed: 20260716 })
    let wrong = 0, committed = 0
    for (const { session, truth } of labelled) {
      const p = classifySession(session).phase
      const inverted: Phase = p === 'drafting' ? 'editing' : p === 'editing' ? 'drafting' : 'unclear'
      if (inverted === 'unclear') continue
      committed++
      if (inverted !== truth) wrong++
    }
    expect(committed).toBeGreaterThan(20)   // the negative actually ran
    expect(wrong).toBe(committed)           // and it fired on every single call
  })
})
