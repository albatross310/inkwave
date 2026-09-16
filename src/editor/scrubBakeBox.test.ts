// @vitest-environment jsdom
//
// THE BAKE-BOX GUARD FIRES ON A KNOWN DIVERGENCE AND IS SILENT ON A HEALTHY TREE. ~60ms, fake timers.
//
// The thumbnail bake keys every bitmap to the SURFACE's box (the one `hydrate()`/`show()` look up
// against), never the captured element's — and refuses a bake whose captured box diverges from the
// surface by more than 2px, because a wrong-sized bitmap under a right-looking key LOOKS registered
// (→ docs/archive/snapshot-scrub-rounds.md#raster-key). A guard of the form "measure X, compare to Y,
// refuse if they differ" is the exact shape that silently disabled arithLayout for months: it never
// fires in a healthy tree, and never-fires is indistinguishable from not-needed (R3). So a harness may
// inject a KNOWN divergence (`window.__iwBakeBoxNudge`) and the guard MUST fire. `probe-bakebox.mjs`
// (retired to docs/archive/probes/) proved that in a browser; this proves it on every `pnpm test`.
//
// The capture itself cannot run in jsdom (SVG foreignObject → Image → canvas); the guard sits BEFORE
// it, and the healthy cell only needs the guard's silence plus the job reaching the capture step.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createScrubPresenter } from './scrubRaster'

type W = Window & { __iwPerf?: Array<[string, number, number]>; __iwThumbTrace?: string[]; __iwBakeBoxNudge?: number }
const w = window as unknown as W
const realGetContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestIdleCallback', 'cancelIdleCallback'] })
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof realGetContext
  w.__iwPerf = []; w.__iwThumbTrace = []; delete w.__iwBakeBoxNudge
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
afterEach(() => {
  vi.useRealTimers()
  HTMLCanvasElement.prototype.getContext = realGetContext
  delete w.__iwPerf; delete w.__iwThumbTrace; delete w.__iwBakeBoxNudge
})

function box(el: HTMLElement, wpx: number, hpx: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: wpx })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: hpx })
}

/** One queued capture job for the doc pane, run to the point the guard decides. */
async function runCell(nudge: number) {
  if (nudge) w.__iwBakeBoxNudge = nudge
  const p = createScrubPresenter({ touch: false, getLiveId: () => null })
  const host = document.createElement('div'); document.body.appendChild(host)
  const surfaceEl = document.createElement('div'); document.body.appendChild(surfaceEl); box(surfaceEl, 800, 600)
  const capturedEl = document.createElement('div'); document.body.appendChild(capturedEl); box(capturedEl, 800, 600)
  p.registerSurface('doc', host, () => surfaceEl, () => 1)
  p.setOrder(['s1'])
  p.queueCapture('doc', 's1', () => capturedEl)
  // pump: 60ms → idle (setTimeout 180 under jsdom, no rIC) → runOne (async).
  await vi.advanceTimersByTimeAsync(400)
  const labels = (w.__iwPerf ?? []).map(([l]) => l)
  const out = {
    mismatch: labels.filter((l) => l.startsWith('scrub.bake.boxMismatch.')),
    refused: labels.filter((l) => l.startsWith('scrub.bake.refused.')),
    reachedCapture: labels.some((l) => l.startsWith('scrub.capture.') || l === 'scrub.mem'),
    trace: (w.__iwThumbTrace ?? []).filter((t) => t.includes('boxMismatch')),
  }
  p.dispose()
  return out
}

describe('bake-box guard (probe-bakebox.mjs, as a unit)', () => {
  it('NEGATIVE — healthy tree: the guard is silent and the job proceeds to the capture step', async () => {
    const r = await runCell(0)
    expect(r.mismatch).toEqual([])
    expect(r.refused).toEqual([])
    // The job was not dropped before the guard: it went on to capture (which jsdom then fails/throws —
    // either outcome is recorded, and either proves the guard let it through).
    expect(r.reachedCapture).toBe(true)
  })

  it('POSITIVE — an injected 6px divergence: the guard FIRES, traces it, and REFUSES the bake', async () => {
    const r = await runCell(6)
    expect(r.mismatch).toEqual(['scrub.bake.boxMismatch.doc'])
    expect(r.refused).toEqual(['scrub.bake.refused.doc'])
    expect(r.trace.length).toBe(1)
    expect(r.trace[0]).toContain('BAKE.boxMismatch s1|doc|captured 800x600|surface 800x600')
    expect(r.reachedCapture).toBe(false) // refused means no bitmap under a plausible key
  })

  it('a sub-pixel divergence (≤2px) is traced but NOT refused — cosmetic, keep the coverage', async () => {
    const r = await runCell(1)
    expect(r.mismatch).toEqual(['scrub.bake.boxMismatch.doc'])
    expect(r.refused).toEqual([])
    expect(r.reachedCapture).toBe(true)
  })
})
