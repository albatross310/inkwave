import { describe, it, expect } from 'vitest'
import { lockAxis, newAxisState, AXIS_GESTURE_GAP_MS } from './axisLock'

describe('lockAxis', () => {
  it('a mostly-vertical gesture stays vertical even as the hand wobbles', () => {
    // THE BUG, as a sequence: reading down a zoomed page with a real hand on a trackpad.
    const s = newAxisState()
    expect(lockAxis(s, 2, 40, 0)).toBe('y')
    expect(lockAxis(s, 9, 30, 12)).toBe('y')
    expect(lockAxis(s, 14, 6, 24)).toBe('y')   // a wobble that WOULD have flipped a per-event rule
    expect(lockAxis(s, 18, 2, 36)).toBe('y')
  })

  it('KNOWN-NEGATIVE: deciding per event really does flip on that wobble', () => {
    const perEvent = (dx: number, dy: number) => (Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x')
    expect(perEvent(2, 40)).toBe('y')
    expect(perEvent(14, 6)).toBe('x')          // ⇒ the sideways drift
  })

  it('a deliberate horizontal gesture is horizontal', () => {
    const s = newAxisState()
    expect(lockAxis(s, 40, 3, 0)).toBe('x')
    expect(lockAxis(s, 30, 11, 12)).toBe('x')
  })

  it('a pause starts a new gesture, so changing direction still works', () => {
    const s = newAxisState()
    expect(lockAxis(s, 2, 40, 0)).toBe('y')
    expect(lockAxis(s, 40, 2, AXIS_GESTURE_GAP_MS + 50)).toBe('x')
  })

  it('sub-pixel jitter decides nothing — it waits for a real move', () => {
    const s = newAxisState()
    expect(lockAxis(s, 0.4, 0.2, 0)).toBeNull()
    expect(lockAxis(s, 0.1, 0.3, 8)).toBeNull()
    expect(lockAxis(s, 1, 30, 16)).toBe('y')   // …and then commits on the first real one
  })

  it('a perfect diagonal reads as vertical — reading is vertical', () => {
    const s = newAxisState()
    expect(lockAxis(s, 20, 20, 0)).toBe('y')
  })
})
