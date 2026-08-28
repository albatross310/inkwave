import { describe, it, expect } from 'vitest'
import { lockAxis, newAxisState, AXIS_GESTURE_GAP_MS } from './axisLock'

/** Feed a stream and total the movement per axis. */
function run(events: Array<[number, number, number]>) {
  const s = newAxisState()
  let x = 0, y = 0
  for (const [dx, dy, t] of events) {
    const m = lockAxis(s, dx, dy, t)
    if (!m) continue
    if (m.axis === 'x') x += m.delta; else y += m.delta
  }
  return { x, y }
}

describe('lockAxis', () => {
  it('THE COMPLAINT: momentum gaps no longer re-open the axis', () => {
    // A flick, then momentum arriving in clumps 300ms apart with sideways drift in each. The first
    // cut ended the gesture at 160ms, so every clump re-decided and the drift got through.
    const { x, y } = run([
      [2, 40, 0], [3, 30, 12], [4, 20, 24],
      [9, 6, 330],            // momentum clump: mostly sideways drift
      [11, 4, 660],
      [12, 2, 990],
    ])
    expect(x).toBe(0)          // not one pixel sideways
    expect(y).toBeGreaterThan(90)
  })

  it('nothing scrolls until the gesture commits — no free-for-all at the start', () => {
    // Undecided events used to be handed to the browser, which scrolls BOTH axes.
    const s = newAxisState()
    expect(lockAxis(s, 1, 1, 0)).toBeNull()
    expect(lockAxis(s, 1, 1, 8)).toBeNull()
  })

  it('…and the held-back travel is not lost, it lands on the chosen axis', () => {
    const { x, y } = run([[1, 2, 0], [1, 3, 8], [0, 4, 16]])
    expect(x).toBe(0)
    expect(y).toBe(9)          // 2+3+4 — every px accounted for
  })

  it('horizontal excludes vertical, and vice versa', () => {
    expect(run([[40, 3, 0], [30, 11, 12], [20, 25, 24]]).y).toBe(0)
    expect(run([[3, 40, 0], [11, 30, 12], [25, 20, 24]]).x).toBe(0)
  })

  it('a REAL pause starts a new gesture, so changing direction still works', () => {
    const { x, y } = run([[2, 40, 0], [40, 2, AXIS_GESTURE_GAP_MS + 100]])
    expect(y).toBe(40)
    expect(x).toBe(40)
  })

  it('KNOWN-NEGATIVE: the old 160ms gap would have leaked on that same stream', () => {
    // Restated so the first assertion cannot pass for an unrelated reason.
    const gaps = [0, 12, 24, 330, 660, 990]
    const brokenBy160 = gaps.filter((t, i) => i > 0 && t - gaps[i - 1] > 160)
    expect(brokenBy160.length).toBe(3)     // three re-decisions the old rule allowed
  })

  it('a perfect diagonal reads as vertical — reading is vertical', () => {
    const { x, y } = run([[20, 20, 0]])
    expect(x).toBe(0)
    expect(y).toBe(20)
  })
})
