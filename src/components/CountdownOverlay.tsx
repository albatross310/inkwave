// The countdown, faint grey, top-right of the desktop editor (Peter, 2026-07-17).
//
// ─── IT MUST NOT COST TYPING ─────────────────────────────────────────────────────────────────
// This is a ticking clock pinned over the editor, i.e. a per-second write on the writing surface —
// precisely the shape of CLAUDE.md's `--wave-x` finding, where a per-frame write on the surface
// invalidated the whole 100-page page subtree (scroll frames p50 417→50ms once firebroken). Three
// rules keep it out of the editor's way, and all three are structural, not hopeful:
//   1. PORTALLED TO document.body — it is a SIBLING of the editor, never a descendant. A write in
//      here cannot invalidate the ProseMirror subtree because it is not inside it.
//   2. NO REACT RE-RENDER PER SECOND — the number is written by TimeFace via textContent off the
//      store's imperative tick channel. This component re-renders only when the timer starts/stops.
//   3. `contain: layout style paint` + position:fixed — the browser is told the element's effects
//      end at its own box, so a text change cannot reach the page's layout at all.
//
// PHONE: not rendered. Peter asked for "the top right corner of the desktop"; on a phone the same
// pixels are the writing area and the editor is already edge-to-edge, so a floating clock would sit
// on the prose. The drop-up's own face is the phone's countdown.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/Scroll'
import { subscribe, getPomodoroState } from '../productivity/pomodoroStore'
import { TYPE } from '../music/typeScale'
import { TimeFace } from './TimeFace'

const SHOW_KEY = 'inkwave:ledgerCountdown'

/** Default ON: a countdown you have to switch on is not a countdown. */
export function countdownShown(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== '0'
  } catch {
    return true
  }
}

export function setCountdownShown(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SHOW_KEY)
    else localStorage.setItem(SHOW_KEY, '0')
  } catch { /* private mode */ }
  try {
    window.dispatchEvent(new Event(COUNTDOWN_TOGGLE_EVENT))
  } catch { /* no-op */ }
}

export const COUNTDOWN_TOGGLE_EVENT = 'inkwave:countdown-toggle'

export function CountdownOverlay({ onOpen }: { onOpen: () => void }): JSX.Element | null {
  const [, bump] = useState(0)
  const [shown, setShown] = useState(countdownShown)

  // STATE changes only — start/stop/phase. Not the tick. This component must not re-render per second.
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  useEffect(() => {
    const on = () => setShown(countdownShown())
    window.addEventListener(COUNTDOWN_TOGGLE_EVENT, on)
    return () => window.removeEventListener(COUNTDOWN_TOGGLE_EVENT, on)
  }, [])

  if (isTouchDevice() || !shown) return null
  // Only while a block is actually running: parking 25:00 over the prose forever is noise, and this
  // app's whole argument is calm. Idle → the toolbar clock is where the timer lives.
  if (getPomodoroState().phase === 'idle') return null

  return createPortal(
    <button
      type="button"
      onClick={onOpen}
      title="Your ledger — click to open"
      className="iw-no-print fixed z-30 font-serif tabular-nums transition-opacity"
      style={{
        top: 10,
        right: 14,
        // Faint grey, per Peter.
        //
        // ⚠ THIS TOKEN DOES NOT RESOLVE, AND THE COMMENT THAT USED TO SIT HERE WAS WRONG. It claimed
        // "a token so night mode lightens it rather than leaving it invisible charcoal-on-charcoal".
        // MEASURED (headless Chromium, real built stylesheet, `data-theme="night"`): this element is
        // portalled to `document.body`, and the night palette is scoped to
        // `:root[data-theme="night"] .iw-nightable` — NOT to :root (see music/theme.test.ts, which
        // records that scoping as load-bearing). With no `.iw-nightable` ancestor the var falls back
        // to its DAY value: rgb(168,162,158) at night, where the intended token is rgb(223,227,233).
        // So the countdown renders its day grey on the charcoal page — dimmer than designed. Legible,
        // not invisible, which is why nobody caught it.
        //
        // NOT FIXED HERE, deliberately: the obvious fix (add `iw-nightable`) ALSO applies that block's
        // `background-color: #454e59 !important`, which beats the inline `background: none` below and
        // puts a grey box over the prose. The real fix is a :root-level token for chrome that lives
        // outside a nightable surface — a theming decision, and Peter checks night mode personally.
        color: 'var(--iw-pill-fg, #a8a29e)',
        opacity: 0.55,
        // The ramp's floor (Peter: "every font proportionally up"). Desktop-only — `isTouchDevice()`
        // returns null above — so the iOS rule never binds here; it is on the ramp because a
        // productivity surface reading 15px next to a panel reading 16px is the drift the ramp exists
        // to stop, not because 15 was dangerous.
        fontSize: TYPE.meta,
        letterSpacing: '0.02em',
        background: 'none',
        border: 'none',
        padding: '2px 4px',
        cursor: 'pointer',
        // The whole point: this element's layout/paint/style effects stop at its own box, so the
        // per-second text write can never reach the editor's subtree.
        contain: 'layout style paint',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.55' }}
    >
      <TimeFace />
    </button>,
    document.body,
  )
}
