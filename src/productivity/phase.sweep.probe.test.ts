// PROBE (reporting, not asserting): the fixture's addRatio distribution, the gap between the truth
// classes, and a full threshold sweep. This is the instrument the F1 audit finding demanded — it
// exists to show whether the fixture can FEEL a wrong threshold at all.
//
// Delete-able: it asserts almost nothing. Its output is the evidence.

import { describe, it, expect } from 'vitest'
import { makeLedger, type TruePhase } from './fixtures'

const ratio = (s: { words_added: number; words_deleted: number }) =>
  s.words_added + s.words_deleted === 0 ? 0 : s.words_added / (s.words_added + s.words_deleted)

describe('PROBE — can the fixture feel a wrong threshold?', () => {
  it('reports the addRatio distribution per truth class, and the gap between them', () => {
    const rows = makeLedger({ seed: 20260716 })
    const by: Record<TruePhase, number[]> = { drafting: [], editing: [] }
    for (const { session, truth } of rows) by[truth].push(ratio(session))
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      return { n: s.length, min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] }
    }
    const d = stat(by.drafting), e = stat(by.editing)
    // How many sessions sit in the contested band where the two classes actually overlap?
    const lo = Math.min(d.min, e.min), hi = Math.max(d.max, e.max)
    const overlapLo = Math.max(d.min, e.min), overlapHi = Math.min(d.max, e.max)
    const inOverlap = [...by.drafting, ...by.editing].filter(r => r >= overlapLo && r <= overlapHi).length
    console.log(`
  addRatio by TRUTH class (seed 20260716, n=${rows.length})
    drafting  n=${d.n}  min ${d.min.toFixed(3)}  p50 ${d.p50.toFixed(3)}  max ${d.max.toFixed(3)}
    editing   n=${e.n}  min ${e.min.toFixed(3)}  p50 ${e.p50.toFixed(3)}  max ${e.max.toFixed(3)}
    full range [${lo.toFixed(3)}, ${hi.toFixed(3)}]
    OVERLAP band [${overlapLo.toFixed(3)}, ${overlapHi.toFixed(3)}] contains ${inOverlap} of ${rows.length} sessions
    ${overlapLo > overlapHi ? '*** DISJOINT — every threshold in the void scores identically ***' : ''}
`)
    expect(rows.length).toBeGreaterThan(40)
  })

  it('sweeps draftAddRatio × editAddRatio and reports precision/coverage/balance', () => {
    const rows = makeLedger({ seed: 20260716 })
    const truthDrafting = rows.filter(r => r.truth === 'drafting').length / rows.length

    const score = (draftT: number, editT: number) => {
      let right = 0, committed = 0, calledDrafting = 0
      for (const { session, truth } of rows) {
        const churn = session.words_added + session.words_deleted
        if (churn < 10) continue
        const r = ratio(session)
        const p = r >= draftT ? 'drafting' : r <= editT ? 'editing' : 'unclear'
        if (p === 'unclear') continue
        committed++
        if (p === 'drafting') calledDrafting++
        if (p === truth) right++
      }
      return {
        precision: committed ? right / committed : 0,
        coverage: committed / rows.length,
        wrong: committed - right,
        balance: committed ? calledDrafting / committed : 0,
      }
    }

    const grid = [0.50, 0.55, 0.58, 0.60, 0.62, 0.65, 0.68, 0.70, 0.75, 0.78, 0.80]
    const lines: string[] = []
    for (const dT of grid) {
      for (const eT of grid) {
        if (eT > dT) continue
        const s = score(dT, eT)
        lines.push(
          `    draft≥${dT.toFixed(2)} edit≤${eT.toFixed(2)}  prec ${(s.precision * 100).toFixed(1).padStart(5)}%  cov ${(s.coverage * 100).toFixed(1).padStart(5)}%  wrong ${String(s.wrong).padStart(2)}  balance ${(s.balance * 100).toFixed(1).padStart(5)}%`,
        )
      }
    }
    console.log(`
  THRESHOLD SWEEP (truth drafting share ${(truthDrafting * 100).toFixed(1)}%)
${lines.join('\n')}
`)
    expect(lines.length).toBeGreaterThan(10)
  })
})
