// CLICK APPLIES, HOLD OPENS THE PALETTE — one implementation, shared by the style bar and the PDF
// markup toolbar. Extracted 2026-08-28 when the PDF toolbar needed the same gesture (Peter: "move
// highlight colour into click and hold on the highlight button"); a second copy of a press-timing
// rule is how two toolbars come to feel different for no reason anyone chose.

import { useRef } from 'react'

export const HOLD_MS = 175        // ms before a press becomes a long-press

export function useLongPress(onShortPress: () => void, onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)
  const clear = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }
  return {
    // stopPropagation prevents the outer toolbar div's onPointerDown from calling
    // e.preventDefault(), which on iOS suppresses the subsequent click event (causing
    // second-press deadlock when the editor is already focused).
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      firedRef.current = false
      timerRef.current = setTimeout(() => { firedRef.current = true; onLongPress() }, HOLD_MS)
    },
    // iOS can end a press WITHOUT a click (touch cancel, scroll, system long-press UI), which used
    // to leave the timer running → the drop-up popped open after the finger was gone. Clear on every
    // pointer end; short-press still lives in onClick (fires after pointerup on desktop AND touch,
    // gated by firedRef), so click behaviour is unchanged.
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick: () => {
      clear()
      if (!firedRef.current) onShortPress()
    },
  }
}
