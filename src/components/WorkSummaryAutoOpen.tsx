// Open the ledger drop-up when a Start-work block ends, so it can ask for the block summary
// (Peter, 2026-07-18: "At the END of the pomodoro, asks you to briefly SUMMARISE what you did.").
//
// A null component, the ReflectionAutoOpen precedent exactly: it listens for WORK_SUMMARY_EVENT (fired
// by workSession.ts when a Start-work block it armed has closed) and calls the SAME "open the ledger"
// setter the countdown, the clock slot and the reflection auto-open all share — one owner of that
// state. The drop-up then lands on the work view because pendingSummary() is set, and shows the prompt.
//
// It never blocks typing: a block ends on the timer's own tick or a manual stop, never mid-keystroke,
// and this does no work at all until that event fires.

import { useEffect, useRef } from 'react'
import { WORK_SUMMARY_EVENT } from '../productivity/workSession'

export function WorkSummaryAutoOpen({ onDue }: { onDue: () => void }): null {
  // Hold the callback in a ref so a fresh identity per editor render never re-subscribes (and never
  // misses an event between renders) — the same rule ReflectionAutoOpen documents.
  const cb = useRef(onDue)
  cb.current = onDue

  useEffect(() => {
    const on = (): void => cb.current()
    window.addEventListener(WORK_SUMMARY_EVENT, on)
    return () => window.removeEventListener(WORK_SUMMARY_EVENT, on)
  }, [])

  return null
}
