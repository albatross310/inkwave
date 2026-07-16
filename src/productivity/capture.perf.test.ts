// The per-keystroke cost of session capture — MEASURED, with a proven instrument.
//
// "Typing performance is sacred" (CLAUDE.md): a productivity tracker that makes typing worse is a
// failed feature. This file exists so that claim is a number, and so anyone who later adds a doc
// walk to the capture path finds out here rather than from Peter on a phone.
//
// THE HOUSE DISEASE APPLIES TO BENCHMARKS TOO: a harness that cannot see a cost reports zero, and
// "0.000ms" looks exactly like success. So every timing here is bracketed by a KNOWN-POSITIVE — the
// same harness measuring a deliberate O(doc) walk — and the test asserts the harness CAN see that
// cost before any verdict about the real path is trusted. The bounds are deliberately loose (they
// must not flake on a busy shared box); they catch a CLASS change (O(steps) → O(doc)), not drift.

import { describe, expect, it } from 'vitest'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { countWords } from '../provenance/snapshots'
import { SessionCapture } from './capture'
import { prodLedgerEnabled } from './ledgerFlag'

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
const insertStep = (): Step => new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text('x')), 0, 0))

/** A thesis-scale document — the doc Peter actually writes in (~13k words). */
function bigDoc(words: number): InkwaveDocument {
  const para = (n: number): TiptapJSON => ({
    type: 'paragraph',
    content: [{ type: 'text', text: Array.from({ length: n }, (_, i) => `word${i}`).join(' ') }],
  })
  return {
    id: 'big',
    title: 'Thesis',
    contentJson: { type: 'doc', content: Array.from({ length: Math.ceil(words / 100) }, () => para(100)) },
  } as InkwaveDocument
}

/** Median of a timed run — median, not mean: one GC pause must not become "the cost". */
function timePerOp(iterations: number, fn: (i: number) => void): number {
  const samples: number[] = []
  const batch = 200
  for (let b = 0; b < iterations / batch; b++) {
    const t0 = performance.now()
    for (let i = 0; i < batch; i++) fn(b * batch + i)
    samples.push((performance.now() - t0) / batch)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

describe('per-keystroke cost of session capture', () => {
  const doc = bigDoc(13_000)

  function capture() {
    let now = 1_000_000
    const cap = new SessionCapture({
      clock: () => (now += 1), // 1ms per keystroke — fast typing, never an idle boundary
      offsetMin: () => 600,
      placeFn: () => undefined,
      sink: () => { /* the write path is not on the keystroke path */ },
    })
    return cap
  }

  it('record() is O(steps) — and the harness PROVES it can see an O(doc) cost', async () => {
    const cap = capture()
    await cap.bindDoc({ docId: 'big', getDoc: () => doc })

    const ITER = 20_000
    // WARM: never report the first pass — it measures JIT, not the code.
    timePerOp(2_000, () => cap.record([insertStep()]))

    const capturePerKeystroke = timePerOp(ITER, () => cap.record([insertStep()]))

    // THE KNOWN-POSITIVE: the same harness, same loop, measuring what capture DOESN'T do — one
    // whole-document word count per keystroke. This is the shape of the bug this design avoids
    // (and exactly what a naive "count words each edit" implementation would cost).
    const docWalkPerKeystroke = timePerOp(200, () => { countWords(doc.contentJson) })

    // The instrument works: it resolves the O(doc) walk as a large, unmistakable cost. If this
    // assertion fails, EVERY number in this file is unreadable and the verdict below is void.
    expect(docWalkPerKeystroke).toBeGreaterThan(0.1)

    // eslint-disable-next-line no-console
    console.log(
      `[ledger perf] capture.record: ${(capturePerKeystroke * 1000).toFixed(2)}µs/keystroke | ` +
      `known-positive O(doc) walk: ${docWalkPerKeystroke.toFixed(2)}ms/keystroke | ` +
      `ratio: ${(docWalkPerKeystroke / capturePerKeystroke).toFixed(0)}×`,
    )

    // THE VERDICT: capture must be in a different COST CLASS from a doc walk — orders of magnitude,
    // not a few percent. A 50× floor is far below the measured ratio and far above any noise.
    expect(docWalkPerKeystroke / capturePerKeystroke).toBeGreaterThan(50)
    // And in absolute terms it must be a rounding error against a ~16ms frame.
    expect(capturePerKeystroke).toBeLessThan(0.05)
  })

  it('the cost does NOT grow with document size — the O(doc) regression guard', async () => {
    // If someone later walks the document in record(), this ratio blows up. It is the single
    // assertion that would catch it.
    const small = bigDoc(200)
    const huge = bigDoc(40_000)

    const measure = async (d: InkwaveDocument): Promise<number> => {
      const cap = capture()
      await cap.bindDoc({ docId: d.id, getDoc: () => d })
      timePerOp(2_000, () => cap.record([insertStep()]))
      return timePerOp(10_000, () => cap.record([insertStep()]))
    }

    const tSmall = await measure(small)
    const tHuge = await measure(huge)
    // eslint-disable-next-line no-console
    console.log(`[ledger perf] 200 words: ${(tSmall * 1000).toFixed(2)}µs | 40k words: ${(tHuge * 1000).toFixed(2)}µs`)

    // A 200× document must not cost meaningfully more per keystroke. Loose (timer noise at the µs
    // scale is real), but a doc walk would be ~100×+, not 5×.
    expect(tHuge).toBeLessThan(Math.max(tSmall * 5, 0.02))
  })

  it('the DISABLED path is a single cached boolean — the default-off cost', () => {
    // The gate in onTransaction is `if (prodLedgerEnabled())`. It must not touch localStorage per
    // keystroke, which is why the flag is cached in a module variable.
    const t = timePerOp(20_000, () => { prodLedgerEnabled() })
    // eslint-disable-next-line no-console
    console.log(`[ledger perf] flag gate (default OFF): ${(t * 1000).toFixed(3)}µs/keystroke`)
    expect(prodLedgerEnabled()).toBe(false) // default OFF — and the gate short-circuits everything
    expect(t).toBeLessThan(0.005)
  })
})
