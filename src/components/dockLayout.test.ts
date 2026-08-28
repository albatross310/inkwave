// The dock's geometry, asserted without a browser — and asserted to be THE SAME for both panels,
// which is the whole reason this module exists (Peter: "same width and placing as the pdf reader").

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveOrientation, dockRoom, dockPanelPos, dockHandlePos, dockResize,
  DOCK_MIN_W, DOCK_MIN_H, PHONE_TOP_H, DOCK_ORIENT_KEY, DOCK_SIDE_KEY,
} from './dockLayout'

describe('orientation', () => {
  it('phone is always the TOP dock — the editor keeps the bottom half', () => {
    expect(resolveOrientation(true, true, 'side')).toBe('top')
    expect(resolveOrientation(true, false, 'bottom')).toBe('top')
  })
  it('a narrow desktop window is always BOTTOM, whatever is stored', () => {
    expect(resolveOrientation(false, false, 'side')).toBe('bottom')
  })
  it('only a wide screen honours the stored preference', () => {
    expect(resolveOrientation(false, true, 'side')).toBe('side')
    expect(resolveOrientation(false, true, 'bottom')).toBe('bottom')
  })
})

describe('the room the editor gives up', () => {
  const base = { open: true, fullscreen: false, dockSide: 'right' as const, width: 500, height: 300 }
  it('side dock insets from the edge it lives on', () => {
    expect(dockRoom({ ...base, orientation: 'side' })).toEqual({ right: '500px', left: '0px', bottom: '0px', top: '0px' })
    expect(dockRoom({ ...base, orientation: 'side', dockSide: 'left' })).toEqual({ right: '0px', left: '500px', bottom: '0px', top: '0px' })
  })
  it('bottom dock takes height, phone takes the top half', () => {
    expect(dockRoom({ ...base, orientation: 'bottom' }).bottom).toBe('300px')
    expect(dockRoom({ ...base, orientation: 'top' }).top).toBe(PHONE_TOP_H)
  })
  it('FULLSCREEN never squeezes — it covers, so the reading line is untouched', () => {
    expect(dockRoom({ ...base, orientation: 'side', fullscreen: true })).toEqual({ right: '0px', left: '0px', bottom: '0px', top: '0px' })
  })
  it('closed gives everything back', () => {
    expect(dockRoom({ ...base, orientation: 'side', open: false }).right).toBe('0px')
  })
})

describe('panel geometry', () => {
  it('the side dock is `width` wide on the chosen edge — this is the "same width" promise', () => {
    const l = dockPanelPos({ orientation: 'side', dockSide: 'left', width: 640, height: 300 })
    const r = dockPanelPos({ orientation: 'side', dockSide: 'right', width: 640, height: 300 })
    expect(l.width).toBe(640); expect(l.left).toBe(0); expect(r.right).toBe(0)
    expect(l.right).toBeUndefined(); expect(r.left).toBeUndefined()
  })
  it('the bottom dock spans the width and is `height` tall', () => {
    const b = dockPanelPos({ orientation: 'bottom', dockSide: 'right', width: 640, height: 300 })
    expect(b.left).toBe(0); expect(b.right).toBe(0); expect(b.height).toBe(300)
  })
  it('the handle rides the edge FACING the editor, and flips with the dock side', () => {
    expect(dockHandlePos('side', 'left').right).toBe(0)
    expect(dockHandlePos('side', 'right').left).toBe(0)
    expect(dockHandlePos('bottom', 'right').top).toBe(0)
  })
})

describe('resize', () => {
  it('clamps to the minimums rather than collapsing the panel', () => {
    expect(dockResize('x', 400, -1000)).toBe(DOCK_MIN_W)
    expect(dockResize('y', 400, -1000)).toBe(DOCK_MIN_H)
    expect(dockResize('x', 400, 120)).toBe(520)
  })
})

describe('the preferences are SHARED with the PDF panel', () => {
  it('uses the pdf panel’s own storage keys, deliberately', () => {
    // A separate key would make "opens where the PDF opens" true only until one was moved.
    expect(DOCK_ORIENT_KEY).toBe('inkwave:pdfPanelOrientation')
    expect(DOCK_SIDE_KEY).toBe('inkwave:pdfDockSide')
  })
})

describe('click-to-read preference', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    })
    vi.stubGlobal('window', { dispatchEvent: () => true })
    vi.resetModules()
  })
  it('is OFF until it is ticked — a click already means something else', async () => {
    const m = await import('./dockLayout')
    expect(m.citeClickOpensReader()).toBe(false)
    m.setCiteClickOpensReader(true)
    expect(m.citeClickOpensReader()).toBe(true)
    m.setCiteClickOpensReader(false)
    expect(m.citeClickOpensReader()).toBe(false)
  })
})
