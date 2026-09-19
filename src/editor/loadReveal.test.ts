import { describe, expect, it } from 'vitest'
import { canBeginEditorReveal, DESKTOP_COAST_BEFORE_REVEAL_MS } from './loadReveal'

describe('editor load reveal gate', () => {
  it('gives desktop a visible slowdown beat before revealing over the compositor coast', () => {
    expect(DESKTOP_COAST_BEFORE_REVEAL_MS).toBeGreaterThanOrEqual(300)
    expect(canBeginEditorReveal({ ready: true, continued: true, waterRested: false, coastVisible: false, touch: false })).toBe(false)
    expect(canBeginEditorReveal({ ready: true, continued: true, waterRested: false, coastVisible: true, touch: false })).toBe(true)
  })

  it('keeps the touch shell until its only water owner has rested', () => {
    expect(canBeginEditorReveal({ ready: true, continued: true, waterRested: false, coastVisible: true, touch: true })).toBe(false)
    expect(canBeginEditorReveal({ ready: true, continued: true, waterRested: true, coastVisible: true, touch: true })).toBe(true)
  })

  it('never reveals before readiness and continuation', () => {
    expect(canBeginEditorReveal({ ready: false, continued: true, waterRested: true, coastVisible: true, touch: false })).toBe(false)
    expect(canBeginEditorReveal({ ready: true, continued: false, waterRested: true, coastVisible: true, touch: false })).toBe(false)
  })
})
