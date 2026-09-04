// The ticking number — written IMPERATIVELY, never rendered.
//
// This is the one piece that touches the writing surface once a second, so it does not re-render:
// it subscribes to the store's tick channel and writes `textContent`. That is the counterElRef
// pattern /snapshot's flipbook uses for exactly the same reason. A `setState` here would re-render
// its owner every second for as long as a Pomodoro runs — while someone is typing.

import { useEffect, useRef } from 'react'
import { formatRemaining, subscribeTick } from '../productivity/pomodoroStore'
import type { PomodoroState } from '../productivity/pomodoro'

/** The text a face shows: an idle timer shows the work length it WOULD run, not 0:00. */
export function faceText(ms: number, s: PomodoroState): string {
  return s.phase === 'idle' ? formatRemaining(s.config.workMin * 60_000) : formatRemaining(ms)
}

export function TimeFace({ className, style }: { className?: string; style?: React.CSSProperties }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      subscribeTick((ms, s) => {
        const el = ref.current
        if (!el) return
        const text = faceText(ms, s)
        // Compare before writing: an identical assignment still dirties the node.
        if (el.textContent !== text) el.textContent = text
      }),
    [],
  )
  return <span ref={ref} className={className} style={style} />
}

/** The progress ring — same imperative rule, writing one style property per second. */
export function TimeRing({ size = 132, stroke = 3 }: { size?: number; stroke?: number }): JSX.Element {
  const ref = useRef<SVGCircleElement>(null)
  const r = (size - stroke) / 2 - 6
  const c = 2 * Math.PI * r

  useEffect(
    () =>
      subscribeTick((ms, s) => {
        const el = ref.current
        if (!el) return
        const total =
          s.phase === 'work' ? s.config.workMin * 60_000
          : s.phase === 'break' ? s.config.breakMin * 60_000
          : s.phase === 'long-break' ? s.config.longBreakMin * 60_000
          : 0
        // Idle draws a full, quiet ring — the shape of the block you're about to start.
        const done = total > 0 ? 1 - Math.max(0, Math.min(1, ms / total)) : 0
        el.style.strokeDashoffset = String(c * (1 - done))
      }),
    [c],
  )

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ display: 'block' }}>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        stroke="var(--iw-nightable-border, #e7e5e4)" opacity={0.7}
      />
      <circle
        ref={ref}
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        stroke="var(--iw-light, #41425b)"
        strokeDasharray={c} strokeDashoffset={c}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.9s linear' }}
      />
    </svg>
  )
}
