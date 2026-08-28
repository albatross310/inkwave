// ONE AXIS AT A TIME — the reading scroll, for panes where diagonal drift is noise.
//
// Peter, 2026-08-28: "restrict the scroll in pdf mode so that you can only go down and up or left to
// right at a time. So the downwards scroll isn't subject to arbitrary drift left and right."
//
// A trackpad reports both axes on every event and a human hand is never perfectly vertical, so
// reading down a zoomed page slides it sideways a few px at a time until the column is off-centre.
// The fix is a per-GESTURE decision, not a per-event one: the first decisive event picks the axis
// and the rest of the gesture is committed to it. Deciding per event would let a wobble flip the
// axis mid-scroll, which is the same drift wearing a different hat.
//
// Pure, so the rule is testable without a browser or a trackpad.

/** How long a pause ends a gesture. A trackpad streams at ~8-16ms; 160ms is well clear of that and
 *  short enough that a deliberate change of direction starts a new gesture. */
export const AXIS_GESTURE_GAP_MS = 160
/** Below this the event carries no opinion — a 0.4px stray must not decide the whole gesture. */
export const AXIS_DECISIVE_PX = 1.5

export type AxisState = { axis: 'x' | 'y' | null; last: number }

export const newAxisState = (): AxisState => ({ axis: null, last: -Infinity })

/**
 * Decide which axis this event may move. Returns 'x' or 'y'; mutates `s` to remember the gesture.
 * A gesture that has not yet been decided (only sub-pixel jitter so far) stays undecided rather
 * than committing to whichever axis happened to be a hair larger.
 */
export function lockAxis(s: AxisState, dx: number, dy: number, now: number): 'x' | 'y' | null {
  if (now - s.last > AXIS_GESTURE_GAP_MS) s.axis = null   // a pause ended the last gesture
  s.last = now
  if (s.axis) return s.axis
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (Math.max(ax, ay) < AXIS_DECISIVE_PX) return null    // nothing decisive yet — decide later
  s.axis = ay >= ax ? 'y' : 'x'                            // ties go to VERTICAL: reading is vertical
  return s.axis
}
