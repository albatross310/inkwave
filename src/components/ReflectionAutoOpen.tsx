// Surface the reflection AT THE END OF A LONGER SESSION (Peter, 2026-07-17: "at the end of every
// longer session"). A null component owned by the productivity lane.
//
// THE GAP IT CLOSES: the reflection prompt only ever rendered when the writer happened to OPEN the
// ledger drop-up. A writer who worked a long stretch and never opened it was never asked. This ties
// the offer to the natural end-of-session moment — a session closing writes a row and fires
// LEDGER_ROW_EVENT (a Pomodoro work block completing, or an inactivity boundary; capture.ts /
// pomodoroStore).
//
// GATED ON DUE, NOT ON EVERY ROW (§A5, "never nag"): it opens the panel ONLY when a reflection is
// genuinely due — ≥25 unreflected active minutes today (sessionLogic.reflectionDue, the SAME rule
// the drop-up uses to show the prompt, so opening and showing can't disagree). A stretch already
// reflected on, or a short one, does nothing. Once the panel is open, ReflectionPrompt's own
// once-per-stretch/skippable rules take over.
//
// NEVER BLOCKS TYPING: a session closes on an inactivity gap or a Pomodoro boundary — never while the
// writer is actively typing — and the ledger read is async, off any input path. It reuses the
// existing "open the ledger" setter (the countdown's precedent), so there is one owner of that state.

import { useEffect, useRef } from 'react'
import { LEDGER_ROW_EVENT } from '../productivity/capture'
import { loadLedger } from '../productivity/ledgerStore'
import { isoWithOffset, localDayOf, localMonthOf, reflectionDue } from '../productivity/sessionLogic'

export function ReflectionAutoOpen({ onDue }: { onDue: () => void }): null {
  // Hold the callback in a ref so a fresh `onDue` identity per editor render never re-subscribes the
  // listener (and never misses an event between renders).
  const cb = useRef(onDue)
  cb.current = onDue

  useEffect(() => {
    let live = true
    const check = async (): Promise<void> => {
      const nowLocal = isoWithOffset(Date.now(), -new Date().getTimezoneOffset())
      const l = await loadLedger(localMonthOf(nowLocal))
      if (live && reflectionDue(l.rows, l.reflections ?? [], localDayOf(nowLocal))) cb.current()
    }
    const on = (): void => void check()
    window.addEventListener(LEDGER_ROW_EVENT, on)
    return () => { live = false; window.removeEventListener(LEDGER_ROW_EVENT, on) }
  }, [])

  return null
}
