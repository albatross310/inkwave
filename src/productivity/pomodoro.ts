// The Pomodoro timer (spec §A4, §A10) — a PURE state machine.
//
// No timers, no audio, no DOM: `tick(state, now)` is a pure function of the state and the clock, so
// every transition (including the long-break cadence and pause arithmetic) is unit-testable. The
// impure shell (an interval, the chime, React state) lives in usePomodoro.ts.
//
// §A5 — KIND, NON-SHAMING: this timer has no notion of a "failed" or "abandoned" Pomodoro. Stopping
// early is not recorded as a failure anywhere; `completed` counts only what the writer finished, and
// nothing in the model can produce a scolding. Streaks reward showing up, not raw output.

export interface PomodoroConfig {
  workMin: number
  breakMin: number
  longBreakMin: number
  /** A long break replaces the short one after this many completed work blocks (§A4 default 4). */
  longBreakEvery: number
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
}

export type PomodoroPhase = 'idle' | 'work' | 'break' | 'long-break'

export interface PomodoroState {
  phase: PomodoroPhase
  /** epoch ms when the current phase ends. Meaningless while `paused` or 'idle'. */
  endsAt: number
  /** Remaining ms, frozen while paused. */
  pausedRemainingMs: number | null
  /** Completed WORK blocks this cycle — drives the long-break cadence. */
  completed: number
  config: PomodoroConfig
}

export function initialPomodoro(config: PomodoroConfig = DEFAULT_POMODORO_CONFIG): PomodoroState {
  return { phase: 'idle', endsAt: 0, pausedRemainingMs: null, completed: 0, config }
}

export const isPaused = (s: PomodoroState): boolean => s.pausedRemainingMs !== null

/** Ms left in the current phase. 0 when idle. */
export function remainingMs(s: PomodoroState, now: number): number {
  if (s.phase === 'idle') return 0
  if (s.pausedRemainingMs !== null) return s.pausedRemainingMs
  return Math.max(0, s.endsAt - now)
}

const durationMs = (c: PomodoroConfig, phase: PomodoroPhase): number =>
  phase === 'work' ? c.workMin * 60_000 : phase === 'break' ? c.breakMin * 60_000 : phase === 'long-break' ? c.longBreakMin * 60_000 : 0

/** Start a work block (from idle, or restart the current phase's clock). */
export function start(s: PomodoroState, now: number): PomodoroState {
  return { ...s, phase: 'work', endsAt: now + durationMs(s.config, 'work'), pausedRemainingMs: null }
}

/** Pause — freezes the remaining time. No-op when idle or already paused. */
export function pause(s: PomodoroState, now: number): PomodoroState {
  if (s.phase === 'idle' || isPaused(s)) return s
  return { ...s, pausedRemainingMs: remainingMs(s, now) }
}

/** Resume from a pause — the frozen remainder becomes a fresh deadline. */
export function resume(s: PomodoroState, now: number): PomodoroState {
  if (!isPaused(s)) return s
  return { ...s, endsAt: now + s.pausedRemainingMs!, pausedRemainingMs: null }
}

/** Stop — back to idle. The completed count is KEPT (the writer's finished blocks are theirs). */
export function stop(s: PomodoroState): PomodoroState {
  return { ...s, phase: 'idle', endsAt: 0, pausedRemainingMs: null }
}

/** What a `tick` produced, so the shell knows when to chime and how to bound sessions. */
export interface TickResult {
  state: PomodoroState
  /** The phase that just ELAPSED (null when nothing elapsed) — the chime + session-close trigger. */
  elapsed: PomodoroPhase | null
}

/**
 * Advance the clock. When the current phase's deadline has passed, transition:
 *   work → long-break (every `longBreakEvery` completed blocks) or break
 *   break/long-break → work
 * A paused or idle timer never elapses.
 *
 * The next phase is anchored to the DEADLINE, not to `now`, so a late tick (a backgrounded tab, a
 * long task) cannot make the phases drift.
 */
export function tick(s: PomodoroState, now: number): TickResult {
  if (s.phase === 'idle' || isPaused(s) || now < s.endsAt) return { state: s, elapsed: null }

  const elapsed = s.phase
  if (elapsed === 'work') {
    const completed = s.completed + 1
    const next: PomodoroPhase = completed % s.config.longBreakEvery === 0 ? 'long-break' : 'break'
    return { state: { ...s, phase: next, endsAt: s.endsAt + durationMs(s.config, next), completed }, elapsed }
  }
  return { state: { ...s, phase: 'work', endsAt: s.endsAt + durationMs(s.config, 'work') }, elapsed }
}

/** Clamp a user-entered config to sane bounds (the Settings inputs are free text). */
export function sanitiseConfig(c: Partial<PomodoroConfig>): PomodoroConfig {
  const n = (v: unknown, dflt: number, max: number): number => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) && x >= 1 && x <= max ? x : dflt
  }
  return {
    workMin: n(c.workMin, DEFAULT_POMODORO_CONFIG.workMin, 180),
    breakMin: n(c.breakMin, DEFAULT_POMODORO_CONFIG.breakMin, 60),
    longBreakMin: n(c.longBreakMin, DEFAULT_POMODORO_CONFIG.longBreakMin, 120),
    longBreakEvery: n(c.longBreakEvery, DEFAULT_POMODORO_CONFIG.longBreakEvery, 12),
  }
}
