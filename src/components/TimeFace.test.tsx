// @vitest-environment jsdom
// THE PER-SECOND COUNTDOWN MUST NOT RE-RENDER ANYTHING (Peter's clock, `?prodLedger`, default OFF).
//
// WHY THIS EXISTS AS A UNIT TEST RATHER THAN A BROWSER PROBE: the in-browser typing A/B for this
// claim is UNREADABLE on this box. Measured (`ledger-ui.prove.mjs`): a deliberate per-second 40ms
// main-thread block — a cost far larger than anything here — moved keydown→rAF p95 only 1.20×, i.e.
// the harness could not see its OWN known-positive through the CPU contention of other agents'
// probes running concurrently (idle p50 wandered 4.8 → 9.2ms between runs). A per-second event also
// lands on ~1 of 50 keystrokes, so a median is structurally blind to it. Rather than report a
// meaningless "0.90×, no change", the claim is asserted where it is DECIDABLE.
//
// The claim: while a Pomodoro runs, the tick moves the NUMBER and re-renders NOTHING. That is what
// keeps a ticking clock off the writer's critical path (CLAUDE.md's `--wave-x` lesson: a small
// repeated write on the editor's surface recalculated the whole page subtree, p50 417→50ms).
// ~90ms, no browser. A green gate is not a guard unless something can fail.

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The store pulls in capture → the whole ledger; stub the one thing it calls on a phase flip.
vi.mock('../productivity/capture', () => ({
  getCapture: () => ({ close: async () => {}, pomodoroStart: async () => {}, pomodoroStop: async () => {} }),
}))
vi.mock('../productivity/chime', () => ({ playChime: () => {} }))

// @testing-library/react only auto-cleans with globals:true, which this repo does not set — without
// this every test silently measures the PREVIOUS test's still-mounted components (CLAUDE.md).
afterEach(cleanup)

let renders = 0

/** A component that owns the face and counts its OWN renders. */
function Host(): JSX.Element {
  renders++
  // Imported lazily inside the test file's module scope after mocks are registered.
  return <TimeFaceRef.current />
}
const TimeFaceRef: { current: () => JSX.Element } = { current: () => <span /> }

describe('the per-second tick re-renders nothing', () => {
  let store: typeof import('../productivity/pomodoroStore')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    store = await import('../productivity/pomodoroStore')
    const { TimeFace } = await import('./TimeFace')
    TimeFaceRef.current = () => <TimeFace />
    renders = 0
  })

  afterEach(() => {
    store._resetPomodoroStore()
    vi.useRealTimers()
  })

  it('advances the NUMBER without re-rendering its owner', () => {
    const { container } = render(<Host />)
    const rendersAfterMount = renders
    expect(container.textContent).toBe('25:00') // idle shows the block it would run

    store.startPomodoro()
    vi.advanceTimersByTime(5000)

    // The number moved...
    expect(container.textContent).toBe('24:55')
    // ...and nothing re-rendered to do it. THE CLAIM.
    expect(renders).toBe(rendersAfterMount)
  })

  it('KNOWN-POSITIVE: the counter CAN see a re-render — so the assertion above is not vacuous', () => {
    // If `renders` could never increase, the test above would pass on a component that never
    // mounted, a broken store, or a stubbed face. Prove the instrument first.
    const { rerender } = render(<Host />)
    const before = renders
    rerender(<Host />)
    expect(renders).toBeGreaterThan(before)
  })

  it('the tick fires at all — a frozen clock would also "not re-render"', () => {
    // The other way this could pass by construction: nothing ticking. Prove the number really moves.
    const { container } = render(<Host />)
    store.startPomodoro()
    const t0 = container.textContent
    vi.advanceTimersByTime(3000)
    expect(container.textContent).not.toBe(t0)
  })

  it('costs NOTHING while idle — no subscribers, no interval', () => {
    // The default state for every writer who never starts a block: the store must not hold a timer.
    render(<Host />)
    expect(vi.getTimerCount()).toBe(0)
    store.startPomodoro()
    expect(vi.getTimerCount()).toBe(1) // exactly one interval for the whole timer
    store.stopPomodoro()
    expect(vi.getTimerCount()).toBe(0) // ...and it is released again
  })

  it('a phase flip DOES notify state subscribers (the rare channel still works)', () => {
    const seen: number[] = []
    store.subscribe(() => seen.push(store.getPomodoroState().completed))
    store.startPomodoro()
    vi.advanceTimersByTime(25 * 60_000 + 1000) // run the work block out
    expect(store.getPomodoroState().phase).toBe('break')
    expect(seen[seen.length - 1]).toBe(1)
  })
})
