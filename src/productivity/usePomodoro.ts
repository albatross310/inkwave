// The React shell around the pure Pomodoro machine (pomodoro.ts).
//
// All the transition logic lives in the pure reducer; this hook owns only the impure parts: an
// interval, the chime, config persistence, and telling the capture engine when a timed block starts
// and stops (so the row it writes carries `pomodoro: true`).

import { useCallback, useEffect, useRef, useState } from 'react'
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

export function savePomodoroConfig(c: PomodoroConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
  } catch { /* private mode — config stays session-only */ }
}

/** 25:00 — the timer face. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export interface UsePomodoro {
  state: PomodoroState
  /** Ms left in the current phase, ticking once a second. */
  remaining: number
  paused: boolean
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  setConfig: (c: PomodoroConfig) => void
}

export function usePomodoro(): UsePomodoro {
  const [state, setState] = useState<PomodoroState>(() => initialPomodoro(loadPomodoroConfig()))
  const [remaining, setRemaining] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  // ONE interval for the whole timer, and it only runs while a phase is actually running. A 1s tick
  // is plenty: the pure machine anchors phases to their DEADLINE, so a late or coalesced tick (a
  // backgrounded tab) cannot make the schedule drift — it just catches up.
  useEffect(() => {
    if (state.phase === 'idle' || isPaused(state)) {
      setRemaining(remainingMs(state, Date.now()))
      return
    }
    const run = () => {
      const now = Date.now()
      const r = tick(stateRef.current, now)
      if (r.elapsed) {
        playChime(r.elapsed === 'work' ? 'work-end' : 'break-end')
        // A work block ending is a session boundary (§A4): close it so the row lands with
        // pomodoro: true, then let the next block open a fresh session on the next keystroke.
        void getCapture().close('pomodoro')
        setState(r.state)
        setRemaining(remainingMs(r.state, now))
        return
      }
      setRemaining(remainingMs(stateRef.current, now))
    }
    run()
    const id = setInterval(run, 1000)
    return () => clearInterval(id)
  }, [state])

  const doStart = useCallback(() => {
    void getCapture().pomodoroStart()
    setState((s) => start(s, Date.now()))
  }, [])

  const doPause = useCallback(() => setState((s) => pause(s, Date.now())), [])
  const doResume = useCallback(() => setState((s) => resume(s, Date.now())), [])

  const doStop = useCallback(() => {
    void getCapture().pomodoroStop()
    setState((s) => stop(s))
  }, [])

  const setConfig = useCallback((c: PomodoroConfig) => {
    const clean = sanitiseConfig(c)
    savePomodoroConfig(clean)
    // Applying a new length restarts the CURRENT phase's clock rather than retro-fitting a deadline
    // that has already passed — the honest reading of "I want 50-minute blocks from now on".
    setState((s) => (s.phase === 'idle' ? { ...s, config: clean } : { ...start({ ...s, config: clean }, Date.now()), phase: s.phase }))
  }, [])

  return { state, remaining, paused: isPaused(state), start: doStart, pause: doPause, resume: doResume, stop: doStop, setConfig }
}
