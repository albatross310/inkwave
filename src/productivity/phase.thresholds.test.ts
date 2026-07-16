// THE FIXTURE MUST BE ABLE TO FEEL A WRONG THRESHOLD.
//
// This file exists because it didn't. An external audit mutated `draftAddRatio` 0.70 → 0.65 / 0.75 /
// 0.78 and `editAddRatio` 0.50 → 0.79 and EVERY MUTANT SURVIVED GREEN. The cause was not the
// assertions — it was the fixture: the generative `deleteRatio` bands were DISJOINT across the truth
// classes (editing topped at addRatio 0.624, drafting started at 0.803, ZERO of 64 sessions in the
// gap), so every threshold in that void produced numerically identical output. `expect(wrong).toBe(0)`
// was a tautology of the data, and the whole §A3.3 deviation rested on it.
//
// The guards below pin the PROPERTY that makes the evidence real — the classes overlap in the proxy
// the rule actually uses — so the void can never silently come back. A threshold suite whose fixture
// cannot discriminate is not weak; it is decorative.

import { describe, it, expect } from 'vitest'
import { makeLedger, type TruePhase } from './fixtures'
import { PHASE_THRESHOLDS } from './phase'

const ratio = (s: { words_added: number; words_deleted: number }) =>
  s.words_added + s.words_deleted === 0 ? 0 : s.words_added / (s.words_added + s.words_deleted)

/** Score an arbitrary threshold pair over the fixture — the same shape the shipped rule uses. */
function score(draftT: number, editT: number, seed = 20260716) {
  const rows = makeLedger({ seed })
  let right = 0, committed = 0, calledDrafting = 0
  for (const { session, truth } of rows) {
    if (session.words_added + session.words_deleted < 10) continue
    const r = ratio(session)
    const p = r >= draftT ? 'drafting' : r <= editT ? 'editing' : 'unclear'
    if (p === 'unclear') continue
    committed++
    if (p === 'drafting') calledDrafting++
    if (p === (truth as string)) right++
  }
  return {
    precision: committed ? right / committed : 0,
    coverage: committed / rows.length,
    wrong: committed - right,
    balance: committed ? calledDrafting / committed : 0,
  }
}

function ratiosByTruth(seed = 20260716) {
  const by: Record<TruePhase, number[]> = { drafting: [], editing: [] }
  for (const { session, truth } of makeLedger({ seed })) by[truth].push(ratio(session))
  return by
}

describe('the fixture can discriminate — the property F1 was missing', () => {
  it('the truth classes OVERLAP in addRatio, the proxy the shipped rule reads', () => {
    // THE load-bearing assertion. If drafting's floor ever rises above editing's ceiling again, the
    // classes are linearly separable, every threshold between them scores identically, and every
    // number in phase.ts's header becomes a tautology.
    const by = ratiosByTruth()
    const draftMin = Math.min(...by.drafting)
    const editMax = Math.max(...by.editing)
    expect(draftMin, `drafting floor ${draftMin.toFixed(3)} vs editing ceiling ${editMax.toFixed(3)}`)
      .toBeLessThan(editMax)
  })

  it('the contested band holds a meaningful share of sessions, not a token one or two', () => {
    const by = ratiosByTruth()
    const lo = Math.max(Math.min(...by.drafting), Math.min(...by.editing))
    const hi = Math.min(Math.max(...by.drafting), Math.max(...by.editing))
    const all = [...by.drafting, ...by.editing]
    const contested = all.filter(r => r >= lo && r <= hi).length
    expect(contested / all.length).toBeGreaterThan(0.08)
  })

  it('BOTH truth classes are represented in the contested band — an overlap of one class is no overlap', () => {
    // A band containing only drafting sessions would still be separable in practice: no threshold
    // inside it could ever trade precision against coverage.
    const by = ratiosByTruth()
    const lo = Math.max(Math.min(...by.drafting), Math.min(...by.editing))
    const hi = Math.min(Math.max(...by.drafting), Math.max(...by.editing))
    expect(by.drafting.filter(r => r >= lo && r <= hi).length).toBeGreaterThan(0)
    expect(by.editing.filter(r => r >= lo && r <= hi).length).toBeGreaterThan(0)
  })
})

describe('moving either threshold CHANGES the outcome — the mutants the audit ran', () => {
  const shipped = () => score(PHASE_THRESHOLDS.draftAddRatio, PHASE_THRESHOLDS.editAddRatio)

  it('the shipped thresholds are what phase.ts says they are', () => {
    // Pins the constants the mutation checks below are relative to.
    expect(PHASE_THRESHOLDS.draftAddRatio).toBe(0.70)
    expect(PHASE_THRESHOLDS.editAddRatio).toBe(0.50)
  })

  it('draftAddRatio 0.70 → 0.65 is FELT (the audit mutant that survived)', () => {
    const base = shipped(), mut = score(0.65, PHASE_THRESHOLDS.editAddRatio)
    expect(mut.precision).not.toBe(base.precision)
    expect(mut.wrong).toBeGreaterThan(base.wrong)
  })

  it('draftAddRatio 0.70 → 0.75 and 0.78 are FELT (the other two audit mutants)', () => {
    for (const t of [0.75, 0.78]) {
      const mut = score(t, PHASE_THRESHOLDS.editAddRatio)
      // Raising the bar cannot create wrong calls here, but it must visibly cost coverage.
      expect(mut.coverage, `draftAddRatio ${t}`).toBeLessThan(shipped().coverage - 0.05)
    }
  })

  it('editAddRatio 0.50 → 0.65 is FELT (the mutant that "beat" the shipped value on the old fixture)', () => {
    const base = shipped(), mut = score(PHASE_THRESHOLDS.draftAddRatio, 0.65)
    expect(mut.wrong).toBeGreaterThan(base.wrong)
    expect(mut.precision).toBeLessThan(base.precision)
  })

  it('editAddRatio 0.50 → 0.79 is FELT', () => {
    const mut = score(PHASE_THRESHOLDS.draftAddRatio, 0.79)
    expect(mut.wrong).toBeGreaterThan(shipped().wrong)
  })
})

describe('the shipped thresholds, re-derived on the corrected fixture', () => {
  // ─── WHAT THIS DOES AND DOES NOT CLAIM ──────────────────────────────────────
  // The fixture is SYNTHETIC. It can show a rule is insensitive; it cannot calibrate a cut-point —
  // tuning thresholds to maximise a score on data invented by the same author who chose the
  // thresholds is circular. These are sensitivity results, not a calibration. Real calibration needs
  // real ledger rows with the writer's own account of what they were doing.

  it('holds 100% precision across seven seeds — the claim the deviation actually rests on', () => {
    for (const seed of [1, 42, 777, 20260716, 999999, 31337, 8888]) {
      const s = score(PHASE_THRESHOLDS.draftAddRatio, PHASE_THRESHOLDS.editAddRatio, seed)
      expect(s.wrong, `seed ${seed}`).toBe(0)
    }
  })

  it('reports the mix closer to ground truth than the alternatives the audit proposed', () => {
    // The metric the whole §A3.3 deviation is about: does the rule's drafting/editing MIX resemble
    // the writer's actual month? Measured (7 seeds, truth 47.6%): shipped 47.9%, edit≤0.65 43.5%.
    const rows = makeLedger({ seed: 20260716 })
    const truth = rows.filter(r => r.truth === 'drafting').length / rows.length
    const shippedBal = score(PHASE_THRESHOLDS.draftAddRatio, PHASE_THRESHOLDS.editAddRatio).balance
    const loose = score(0.65, 0.65).balance
    expect(Math.abs(shippedBal - truth)).toBeLessThan(Math.abs(loose - truth))
  })
})
