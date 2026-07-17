// The live Pomodoro — ONE module-level store, driving every surface that shows the timer.
//
// WHY A STORE AND NOT A HOOK'S useState (this is the load-bearing part):
// The timer ticks once a second, and it is now on the WRITING surface — a footer button, a drop-up,
// and a countdown pinned over the editor. A per-second `setState` in a component inside
// TiptapEditor's tree re-renders that tree every second, forever, while someone is typing. That is
// the shape CLAUDE.md's `--wave-x` finding warns about: a small per-frame/per-second write on the
// editor's surface recalculated the whole 100-page subtree (p50 417→50ms once firebroken).
//
// So there are TWO channels, deliberately:
//   • `subscribe(fn)`   — STATE changes only (start/pause/phase flip/config). RARE. React may use it.
//   • `subscribeTick(fn)` — the ticking NUMBER, once a second. Consumers write `textContent`
//     IMPERATIVELY and never re-render (the counterElRef pattern from /snapshot's flipbook).
// Nothing in this module calls React. Measured in capture.perf.test.ts: with a Pomodoro running,
// the keystroke path is unmoved.
//
// The machine itself stays PURE in pomodoro.ts; this is only its clock and its subscribers.

import { getCapture } from './capture'
import { playChime } from './chime'
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
  type PomodoroConfig,
  type PomodoroState,
} from './pomodoro'

const CONFIG_KEY = 'inkwave:pomodoroConfig'

export function loadPomodoroConfig(): PomodoroConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? sanitiseConfig(JSON.parse(raw) as Partial<PomodoroConfig>) : DEFAULT_POMODORO_CONFIG
  } catch {
    return DEFAULT_POMODORO_CONFIG
  }
}

function savePomodoroConfig(c: PomodoroConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
  } catch { /* private mode — config stays session-only */ }
}

/** 25:00 — the timer face. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

let state: PomodoroState = initialPomodoro(typeof localStorage === 'undefined' ? DEFAULT_POMODORO_CONFIG : loadPomodoroConfig())
let timer: ReturnType<typeof setInterval> | null = null

const stateSubs = new Set<() => void>()
const tickSubs = new Set<(ms: number, s: PomodoroState) => void>()

/** Subscribe to STATE changes (rare). Returns an unsubscribe. Safe for useSyncExternalStore. */
export function subscribe(fn: () => void): () => void {
  stateSubs.add(fn)
  return () => stateSubs.delete(fn)
}

/**
 * Subscribe to the per-second tick. For IMPERATIVE consumers only — write to the DOM, do not
 * setState. Fires immediately with the current value so a fresh mount paints without waiting a
 * second. Returns an unsubscribe.
 */
export function subscribeTick(fn: (ms: number, s: PomodoroState) => void): () => void {
  tickSubs.add(fn)
  fn(remainingMs(state, Date.now()), state)
  return () => tickSubs.delete(fn)
}

export const getPomodoroState = (): PomodoroState => state
export const getRemaining = (): number => remainingMs(state, Date.now())

function emitState(): void {
  for (const fn of stateSubs) fn()
  emitTick() // a state change moves the number too (start/resume/stop)
}

function emitTick(): void {
  if (tickSubs.size === 0) return
  const ms = remainingMs(state, Date.now())
  for (const fn of tickSubs) fn(ms, state)
}

function setState(next: PomodoroState): void {
  state = next
  ensureTimer()
  emitState()
}

/** The interval runs ONLY while a phase is actually counting down. Idle/paused costs nothing. */
function ensureTimer(): void {
  const shouldRun = state.phase !== 'idle' && !isPaused(state)
  if (shouldRun && timer === null) {
    timer = setInterval(onTick, 1000)
  } else if (!shouldRun && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function onTick(): void {
  const now = Date.now()
  const r = tick(state, now)
  if (r.elapsed) {
    state = r.state
    playChime(r.elapsed === 'work' ? 'work-end' : 'break-end')
    // A work block ending is a session boundary (§A4): close it so the row lands with
    // pomodoro: true, and let the next block open a fresh session on the next keystroke.
    void getCapture().close('pomodoro')
    ensureTimer()
    emitState()
    return
  }
  emitTick() // the ordinary case: only the NUMBER moved — no state change, no React
}

// ─── Commands ────────────────────────────────────────────────────────────────

export function startPomodoro(): void {
  void getCapture().pomodoroStart()
  setState(start(state, Date.now()))
}

export function pausePomodoro(): void {
  setState(pause(state, Date.now()))
}

export function resumePomodoro(): void {
  setState(resume(state, Date.now()))
}

export function stopPomodoro(): void {
  void getCapture().pomodoroStop()
  setState(stop(state))
}

export function setPomodoroConfig(c: PomodoroConfig): void {
  const clean = sanitiseConfig(c)
  savePomodoroConfig(clean)
  // Applying a new length restarts the CURRENT phase's clock rather than retro-fitting a deadline
  // that has already passed — the honest reading of "I want 50-minute blocks from now on".
  setState(
    state.phase === 'idle'
      ? { ...state, config: clean }
      : { ...start({ ...state, config: clean }, Date.now()), phase: state.phase },
  )
}

/** Test seam. */
export function _resetPomodoroStore(): void {
  if (timer) clearInterval(timer)
  timer = null
  state = initialPomodoro(DEFAULT_POMODORO_CONFIG)
  stateSubs.clear()
  tickSubs.clear()
}
