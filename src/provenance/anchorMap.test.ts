import { describe, it, expect } from 'vitest'
import { survivingNeighbourSig, offsetOfNearest } from './anchorMap'
import type { Snapshot } from '../types/document'

// A snapshot whose pmToText/displayTextOf output is exactly `text` — one paragraph of plain text
// (displayTextOf runs the real pmToText, so this is the real extraction path, not a stub).
let n = 0
const snap = (text: string): Snapshot => ({
  id: `snap-${++n}`,
  createdAt: new Date().toISOString(),
  contentHash: `hash-${n}`,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
} as unknown as Snapshot)

describe('offsetOfNearest', () => {
  it('finds the occurrence nearest the bias, not merely the first', () => {
    const text = 'alpha ' + 'x'.repeat(100) + ' alpha'
    expect(offsetOfNearest(text, 'alpha', 0)).toBe(0)
    expect(offsetOfNearest(text, 'alpha', 1)).toBe(text.lastIndexOf('alpha'))
  })
  it('reports absence as -1 rather than guessing', () => {
    expect(offsetOfNearest('the quick brown fox', 'zebra', 0.5)).toBe(-1)
  })
})

describe('survivingNeighbourSig — the fallback when the anchor has no counterpart', () => {
  // The reader is anchored on text that the next version DELETES outright. There is nothing to
  // land on; the rule must hand back the nearest text that does survive, never null/top.
  it('returns surviving text next to a deleted anchor', () => {
    const before = 'keep the opening section here. DOOMED ANCHOR PHRASE. keep the closing section too.'
    const after = 'keep the opening section here. keep the closing section too.'
    const sig = survivingNeighbourSig(snap(before), snap(after), 'DOOMED ANCHOR PHRASE', 0.5)
    expect(sig).toBeTruthy()
    // Whatever it picks must actually EXIST in the target — that is the whole contract.
    expect(after.includes(sig!.slice(0, 20))).toBe(true)
  })

  it('picks the NEAREST survivor, not just any survivor', () => {
    const far = 'FAR distant opening material that survives unchanged. '
    const near = 'NEAR adjacent material that survives unchanged. '
    const before = far + 'x'.repeat(400) + near + 'GONE ANCHOR TEXT HERE.'
    const after = far + 'x'.repeat(400) + near
    const sig = survivingNeighbourSig(snap(before), snap(after), 'GONE ANCHOR TEXT HERE', 1)
    expect(sig).toBeTruthy()
    // The anchor sat at the END, so the survivor bitten must come from the tail (NEAR), not FAR.
    expect(sig).toContain('NEAR')
    expect(sig).not.toContain('FAR distant opening')
  })

  it('returns null when the anchor is not in the active version at all', () => {
    expect(survivingNeighbourSig(snap('alpha beta gamma'), snap('alpha beta'), 'nowhere-text', 0.5)).toBeNull()
  })

  it('returns null when nothing survives (total rewrite) instead of inventing an anchor', () => {
    const sig = survivingNeighbourSig(
      snap('aaaa bbbb cccc dddd eeee'), snap('zzzz yyyy xxxx wwww vvvv'), 'bbbb cccc', 0.5,
    )
    expect(sig).toBeNull()
  })

  it('never returns a run shorter than the usable minimum', () => {
    // The only surviving run is a single space — too weak to anchor on.
    const sig = survivingNeighbourSig(snap('aaaa ANCHOR bbbb'), snap('zzzz yyyy'), 'ANCHOR', 0.5)
    if (sig !== null) expect(sig.trim().length).toBeGreaterThanOrEqual(12)
  })
})
