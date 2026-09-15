// The toolbar's side reserve is MEASURED from the two side pills, not assumed (see sidePill.ts).
// These pin the arithmetic the editor's effect feeds `--iw-side-reserve` from, plus the registry.
import { describe, it, expect } from 'vitest'
import { sideReserve, registerSidePill, sidePillElements, subscribeSidePills, SIDE_RESERVE_FALLBACK_PX } from './sidePill'

describe('sideReserve — the wider pill bounds a CENTRED toolbar', () => {
  it('takes the wider side, measured from that side’s own edge', () => {
    // left pill ends 60px in; right pill starts 90px from the right edge of a 430px viewport
    expect(sideReserve(430, { right: 60 }, { left: 340 })).toBe(90)
    // and symmetric: the wider one is on the left this time
    expect(sideReserve(430, { right: 120 }, { left: 340 })).toBe(120)
  })

  it('is far smaller than the historical fixed reserve on a narrow window — the whole point', () => {
    expect(sideReserve(430, { right: 60 }, { left: 340 })).toBeLessThan(SIDE_RESERVE_FALLBACK_PX)
  })

  it('a side with no pill mounted claims nothing', () => {
    expect(sideReserve(430, null, { left: 340 })).toBe(90)
    expect(sideReserve(430, { right: 60 }, null)).toBe(60)
    expect(sideReserve(430, null, null)).toBe(0)
  })

  it('never goes negative when a rect sits past its edge', () => {
    expect(sideReserve(430, { right: -5 }, { left: 440 })).toBe(0)
  })
})

describe('registry — mount, unmount, notify', () => {
  it('tracks the current element per side and notifies on change only', () => {
    const a = {} as HTMLElement, b = {} as HTMLElement
    let n = 0
    const off = subscribeSidePills(() => { n++ })
    registerSidePill('left', a)
    expect(sidePillElements().get('left')).toBe(a)
    expect(n).toBe(1)
    registerSidePill('left', a) // same element again — a re-render's ref call — is not a change
    expect(n).toBe(1)
    registerSidePill('left', b)
    expect(n).toBe(2)
    registerSidePill('left', null)
    expect(sidePillElements().has('left')).toBe(false)
    expect(n).toBe(3)
    off()
    registerSidePill('right', a)
    expect(n).toBe(3)
    registerSidePill('right', null)
  })
})
