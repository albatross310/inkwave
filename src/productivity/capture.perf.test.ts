// THE PER-KEYSTROKE COST OF SESSION CAPTURE — asserted STRUCTURALLY, not by the clock.
//
// "Typing performance is sacred" (CLAUDE.md): a productivity tracker that makes typing worse is a
// failed feature. This file exists so that claim is GUARDED, and so anyone who later adds a doc walk
// to the capture path finds out here rather than from Peter on a phone.
//
// ─── WHY THERE ARE NO TIMING ASSERTIONS IN THE GATE ANY MORE (2026-07-17) ────────────────────
// There were, and they were a FLAKE GENERATOR: `record() is O(steps)` passed here and FAILED in the
// coordinator's gate, and the only difference was load — his box runs seven lanes. A timing
// assertion fails when the box is busy and passes when it isn't, which teaches everyone to re-run
// rather than read it. That is worse than no test: a red gate that is not a finding trains people to
// ignore red gates. (It is the mirror of "a green gate is not a guard".)
//
// It is also the SAME failure I had already found and reported one lane over: the browser typing A/B
// could not see its own known-positive through contention, and I declared it VOID rather than
// publish its number. The lesson generalises — **a measurement whose verdict depends on who else is
// running is not a guard, wherever it lives.** Probing it did not save the assertions either: under
// 8 deliberately-busy cores this box still passed at ratio 4251×, i.e. I could not reproduce the
// coordinator's failure ON DEMAND — which is exactly the property that makes a flake a flake.
//
// So the gate now asserts the STRUCTURE, which is decidable at any load, on any box, in ~10ms:
// **a keystroke never reaches the document.** Capture can only reach it through `binding.getDoc()`,
// so that call is the choke point, and counting it is an exact proxy for "no O(doc) work". The
// numbers still exist — run them deliberately, on a quiet box:
//
//     IW_PERF=1 npx vitest run src/productivity/capture.perf.test.ts
//
// Last quiet-box reading: record 0.30µs/keystroke, flat 200→40k words, known-positive O(doc) walk
// 1.97ms (6581×), disabled flag gate 0.07µs.

import { describe, expect, it, vi } from 'vitest'
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

/** A capture whose every reach for the document is counted. */
function countingCapture(doc: InkwaveDocument) {
  let getDocCalls = 0
  let now = 1_000_000
  const cap = new SessionCapture({
    clock: () => (now += 1), // 1ms per keystroke — fast typing, never an idle boundary
    offsetMin: () => 600,
    placeFn: () => undefined,
    sink: () => { /* the write path is not on the keystroke path */ },
  })
  const bind = () => cap.bindDoc({ docId: doc.id, getDoc: () => { getDocCalls++; return doc } })
  return { cap, bind, calls: () => getDocCalls, reset: () => { getDocCalls = 0 } }
}

describe('a keystroke never reaches the document', () => {
  it('record() NEVER calls getDoc — 5,000 keystrokes, zero reaches', async () => {
    const h = countingCapture(bigDoc(13_000))
    await h.bind()
    h.reset() // the baseline read at bind() is legitimate and counted separately below

    for (let i = 0; i < 5_000; i++) h.cap.record([insertStep()])

    // THE CLAIM, exactly. `getDoc` is the ONLY route from capture to the document, so zero calls
    // means zero doc walks — no countWords, no pmToText, no getJSON — regardless of how busy the
    // machine is. A future edit that "just checks the word count here" fails this line.
    expect(h.calls()).toBe(0)
    expect(h.cap.editEvents).toBe(5_000) // ...and it really did process them all
  })

  it('KNOWN-POSITIVE: closing DOES reach the document — so the counter can see a call', async () => {
    // Without this, `toBe(0)` above would pass on a broken counter, an unbound capture, or a
    // record() that silently did nothing. A negative that cannot fail is not a negative.
    const h = countingCapture(bigDoc(200))
    await h.bind()
    h.cap.record([insertStep()])
    h.reset()

    await h.cap.close('manual')
    expect(h.calls()).toBeGreaterThan(0)
  })

  it('the baseline is taken ONCE per document, at bind — not per keystroke', async () => {
    // This is what makes `words_start` free: the count at the previous close IS the next session's
    // start, so opening a session costs nothing. If bind ever became per-keystroke work, the whole
    // design's justification would be gone while every test still passed.
    const h = countingCapture(bigDoc(13_000))
    await h.bind()
    expect(h.calls()).toBe(1)

    for (let i = 0; i < 1_000; i++) h.cap.record([insertStep()])
    expect(h.calls()).toBe(1) // still one. The document was read once, ever.
  })

  it('record() allocates no timer per keystroke', async () => {
    // The idle boundary is found by ONE low-frequency interval, never by a clearTimeout/setTimeout
    // churn per input. Structural, and load-independent.
    vi.useFakeTimers()
    try {
      const h = countingCapture(bigDoc(200))
      await h.bind()
      const before = vi.getTimerCount()
      for (let i = 0; i < 500; i++) h.cap.record([insertStep()])
      expect(vi.getTimerCount()).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('with no browser storage (SSR/prerender/node) the gate is OFF — capture never runs there', () => {
    // The browser default is now ON (2026-07-18 graduation; mutation-proved in ledgerFlag.test.ts).
    // But where there is no writer typing — prerender, SSR, this node test — the gate must stay OFF
    // so capture cannot run on the load path. `prodLedgerEnabled()` reads that fallback here because
    // node has no localStorage. If a future edit made the no-storage fallback default-on, this fires.
    expect(prodLedgerEnabled()).toBe(false)
  })
})

// ─── The numbers. Deliberate, opt-in, quiet-box only. ────────────────────────
// Not in the gate: see the header. `IW_PERF=1 npx vitest run src/productivity/capture.perf.test.ts`

describe.skipIf(!process.env.IW_PERF)('MEASURED per-keystroke cost (IW_PERF=1)', () => {
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

  it('reports record() against an O(doc) known-positive', async () => {
    const doc = bigDoc(13_000)
    const h = countingCapture(doc)
    await h.bind()
    timePerOp(2_000, () => h.cap.record([insertStep()])) // warm: never report the JIT

    const capture = timePerOp(20_000, () => h.cap.record([insertStep()]))
    const docWalk = timePerOp(200, () => { countWords(doc.contentJson) })

    // eslint-disable-next-line no-console
    console.log(
      `[ledger perf] capture.record: ${(capture * 1000).toFixed(2)}µs/keystroke | ` +
      `known-positive O(doc) walk: ${docWalk.toFixed(2)}ms | ratio: ${(docWalk / capture).toFixed(0)}×`,
    )
    // A sanity floor only — the STRUCTURAL guard above is what protects the invariant. This exists
    // so a run that measured nothing at all is visible rather than silently encouraging.
    expect(docWalk).toBeGreaterThan(0)
    expect(capture).toBeGreaterThan(0)
  })
})
