// @vitest-environment jsdom
//
// THE BURST RECORDER IS PROVED BEFORE IT IS READ — known-positive, then known-negative. ~20ms.
//
// Round 10 (docs/archive/snapshot-scrub-rounds.md#raster-recorder): Peter's mid-scrub overlay capture
// came back byte-identical to his idle one, because the overlay is a DOM node repainting on the thread
// the scrub saturates — every number anyone had was an AT-REST sample. The presenter's preallocated
// ring buffer is the fix, and `probe-recorder.mjs` (now docs/archive/probes/) refused to read a single
// real burst until the recorder had seen a known-positive (17 show()s → exactly 17 presents per pane)
// and a known-negative (reset → 0). That gate is now here, where it runs on every `pnpm test`; the
// real-burst numbers it then read were measurements and stay in the archive.
//
// jsdom has no canvas: `getContext('2d')` is stubbed to a plain object so `registerSurface` accepts a
// host (a null context makes it refuse the surface, which is the known-negative below).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createScrubPresenter, summariseRecord, type ScrubPresenter } from './scrubRaster'

const realGetContext = HTMLCanvasElement.prototype.getContext
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof realGetContext
})
afterEach(() => { HTMLCanvasElement.prototype.getContext = realGetContext })

const IDS = Array.from({ length: 36 }, (_, i) => `snap-${i}`)

function presenterWithPanes(kinds: Array<'doc' | 'diff' | 'map'>): ScrubPresenter {
  const p = createScrubPresenter({ touch: false, getLiveId: () => null })
  for (const k of kinds) {
    const host = document.createElement('div'); document.body.appendChild(host)
    const el = document.createElement('div'); document.body.appendChild(el)
    p.registerSurface(k, host, () => el, () => 1)
  }
  p.setOrder(IDS)
  return p
}

describe('scrub presenter burst recorder', () => {
  it('KNOWN-POSITIVE: 17 show() calls record exactly 17 presents PER PANE, across all three panes', () => {
    const p = presenterWithPanes(['doc', 'diff', 'map'])
    p.resetRecord()
    for (let i = 0; i < 17; i++) p.show(IDS[10 + (i % 20)])
    const rec = p.record()
    const panes = new Set(rec.map((r) => r.pane))
    expect([...panes].sort()).toEqual(['diff', 'doc', 'map'])
    expect(rec.length / panes.size).toBe(17)
    // Every row carries the COMMANDED index — the thing `shown` (nearest cached bitmap) is blind to.
    expect(rec.map((r) => r.want)).not.toContain(-1)
    p.dispose()
  })

  it('KNOWN-NEGATIVE: resetRecord() reads zero — the recorder is not always-on noise', () => {
    const p = presenterWithPanes(['doc'])
    for (let i = 0; i < 5; i++) p.show(IDS[i])
    expect(p.record().length).toBe(5)
    p.resetRecord()
    expect(p.record()).toEqual([])
    p.dispose()
  })

  it('resetBurst() (a non-rapid notch) also clears the ring — which is why probe-reverse read phase 2 in its own window', () => {
    const p = presenterWithPanes(['doc'])
    for (let i = 0; i < 5; i++) p.show(IDS[i])
    p.resetBurst()
    expect(p.record()).toEqual([])
    p.dispose()
  })

  it('a presenter with NO registered surface records nothing on show() (the instrument needs a pane to see)', () => {
    const p = createScrubPresenter({ touch: false, getLiveId: () => null })
    p.setOrder(IDS)
    for (let i = 0; i < 5; i++) p.show(IDS[i])
    expect(p.record()).toEqual([])
    p.dispose()
  })

  it('the ring serialises oldest→newest and the pure roll-up reads it (the overlay and a harness share one verdict)', () => {
    const p = presenterWithPanes(['doc'])
    p.resetRecord()
    for (const i of [3, 4, 5, 6]) p.show(IDS[i])
    const rec = p.record()
    expect(rec.map((r) => r.want)).toEqual([3, 4, 5, 6])
    const sum = summariseRecord(rec)
    expect(sum.presents).toBe(4)
    expect(sum.commandedDistinct).toBe(4)
    p.dispose()
  })
})
