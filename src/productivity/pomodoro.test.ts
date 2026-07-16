import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POMODORO_CONFIG,
  initialPomodoro,
  isPaused,
  pause,
  remainingMs,
  resume,
  sanitiseConfig,
  start,
  stop,
  tick,
} from './pomodoro'

const T0 = 1_000_000
const MIN = 60_000

describe('pomodoro defaults (§A4: 25/5, long break 15 after 4)', () => {
  it('ships the specced defaults', () => {
    expect(DEFAULT_POMODORO_CONFIG).toEqual({ workMin: 25, breakMin: 5, longBreakMin: 15, longBreakEvery: 4 })
  })
})

describe('start / pause / resume / stop', () => {
  it('start begins a work block of the configured length', () => {
    const s = start(initialPomodoro(), T0)
    expect(s.phase).toBe('work')
    expect(remainingMs(s, T0)).toBe(25 * MIN)
  })

  it('pause freezes the remainder; time passing while paused does not consume it', () => {
    const s = pause(start(initialPomodoro(), T0), T0 + 10 * MIN)
    expect(isPaused(s)).toBe(true)
    expect(remainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN)
    expect(remainingMs(s, T0 + 60 * MIN)).toBe(15 * MIN) // an hour later: still 15 min left
  })

  it('a paused timer never elapses', () => {
    const s = pause(start(initialPomodoro(), T0), T0 + 10 * MIN)
    expect(tick(s, T0 + 999 * MIN).elapsed).toBeNull()
  })

  it('resume restores exactly the frozen remainder', () => {
    const paused = pause(start(initialPomodoro(), T0), T0 + 10 * MIN)
    const r = resume(paused, T0 + 60 * MIN)
    expect(isPaused(r)).toBe(false)
    expect(remainingMs(r, T0 + 60 * MIN)).toBe(15 * MIN)
    expect(tick(r, T0 + 75 * MIN - 1).elapsed).toBeNull()
    expect(tick(r, T0 + 75 * MIN).elapsed).toBe('work')
  })

  it('stop returns to idle but KEEPS the blocks already completed (§A5: no punishment)', () => {
    const done = tick(start(initialPomodoro(), T0), T0 + 25 * MIN).state
    const s = stop(done)
    expect(s.phase).toBe('idle')
    expect(s.completed).toBe(1)
    expect(remainingMs(s, T0)).toBe(0)
  })

  it('an idle timer never elapses', () => {
    expect(tick(initialPomodoro(), T0 + 999 * MIN).elapsed).toBeNull()
  })
})

describe('phase cadence', () => {
  it('work → short break, and reports the elapsed phase (the chime trigger)', () => {
    const r = tick(start(initialPomodoro(), T0), T0 + 25 * MIN)
    expect(r.elapsed).toBe('work')
    expect(r.state.phase).toBe('break')
    expect(r.state.completed).toBe(1)
    expect(remainingMs(r.state, T0 + 25 * MIN)).toBe(5 * MIN)
  })

  it('does not elapse one tick early', () => {
    expect(tick(start(initialPomodoro(), T0), T0 + 25 * MIN - 1).elapsed).toBeNull()
  })

  it('the 4th work block earns the LONG break', () => {
    let s = initialPomodoro()
    let now = T0
    const phases: string[] = []
    s = start(s, now)
    // Walk four full work+break cycles, always stepping exactly to the deadline.
    for (let i = 0; i < 8; i++) {
      now = s.endsAt
      const r = tick(s, now)
      s = r.state
      phases.push(r.elapsed!)
      if (s.phase !== 'idle') phases.push(`→${s.phase}`)
    }
    expect(s.completed).toBe(4)
    expect(phases).toEqual([
      'work', '→break', 'break', '→work',
      'work', '→break', 'break', '→work',
      'work', '→break', 'break', '→work',
      'work', '→long-break', 'long-break', '→work',
    ])
  })

  it('phases anchor to the DEADLINE, not to `now` — a late tick cannot drift the schedule', () => {
    const s = start(initialPomodoro(), T0)
    // The tab was backgrounded: the tick arrives 3 minutes after the work block ended.
    const r = tick(s, T0 + 28 * MIN)
    expect(r.state.phase).toBe('break')
    // The break ends 30 min after start (25 work + 5 break) — NOT 33 (28 + 5).
    expect(r.state.endsAt).toBe(T0 + 30 * MIN)
    // KNOWN-NEGATIVE: a `now`-anchored implementation would say T0+33min. Pin it, so this test
    // cannot pass on the drifting rule.
    expect(r.state.endsAt).not.toBe(T0 + 33 * MIN)
  })
})

describe('sanitiseConfig', () => {
  it('accepts sane custom lengths (§A4: configurable)', () => {
    expect(sanitiseConfig({ workMin: 50, breakMin: 10, longBreakMin: 30, longBreakEvery: 3 })).toEqual({
      workMin: 50, breakMin: 10, longBreakMin: 30, longBreakEvery: 3,
    })
  })

  it('falls back to the defaults on garbage, never to 0 or NaN', () => {
    expect(sanitiseConfig({ workMin: 0, breakMin: -5, longBreakMin: NaN, longBreakEvery: 999 })).toEqual(
      DEFAULT_POMODORO_CONFIG,
    )
    expect(sanitiseConfig({ workMin: 'abc' as unknown as number })).toEqual(DEFAULT_POMODORO_CONFIG)
  })

  it('rounds fractional input', () => {
    expect(sanitiseConfig({ ...DEFAULT_POMODORO_CONFIG, workMin: 24.6 }).workMin).toBe(25)
  })
})
