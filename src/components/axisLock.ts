// ONE AXIS AT A TIME — the reading scroll, for panes where diagonal drift is noise.
//
// Peter, 2026-08-28: "restrict the scroll in pdf mode so that you can only go down and up or left to
// right at a time", then, on the first cut: "the vertical only guardrails aren't really working
// properly. We need a time delay or something before it starts accepting horizontal. And horizontal
// should exclude vertical motion and vice versa. After scrolling a bit it just snaps back into the
// scroll in any direction mode. That shouldn't exist."
//
// THREE THINGS THE FIRST CUT GOT WRONG, and they are all the same mistake — treating a scroll as a
// stream of independent events rather than as a gesture:
//   1. THE GAP WAS FAR TOO SHORT (160ms). A trackpad flick is a burst, then momentum, and momentum
//      arrives in clumps with real pauses between them. Every pause ended the gesture and re-opened
//      the axis, which IS "after scrolling a bit it snaps back into scroll-in-any-direction".
//   2. AN UNDECIDED EVENT WAS PASSED THROUGH to the browser, which scrolls BOTH axes. So the start
//      of every gesture — the part where a hand is least steady — was unconstrained. Undecided
//      deltas now ACCUMULATE instead: nothing moves until there is enough evidence to say which way
//      this gesture is going, and then the whole accumulation is spent on that axis.
//   3. THE CROSS-AXIS DELTA WAS SILENTLY DROPPED. Correct, and it needs saying: once the gesture is
//      vertical, horizontal motion does not scroll, does not accumulate and does not vote. That is
//      what "horizontal should exclude vertical motion and vice versa" means.
//
// Pure, so the rule is testable without a browser or a trackpad.

/** How long a pause ends a gesture. Long enough to survive trackpad momentum (which arrives in
 *  clumps hundreds of ms apart), short enough that a deliberate change of direction — where the
 *  hand actually leaves the surface — starts a new one. */
export const AXIS_GESTURE_GAP_MS = 450
/** Accumulated travel before the gesture commits to an axis. Below this nothing scrolls at all. */
export const AXIS_DECISIVE_PX = 6

export type AxisState = { axis: 'x' | 'y' | null; last: number; ax: number; ay: number }

export const newAxisState = (): AxisState => ({ axis: null, last: -Infinity, ax: 0, ay: 0 })

export type AxisMove = { axis: 'x' | 'y'; delta: number } | null

/**
 * Feed one wheel event. Returns the axis this gesture owns and HOW FAR to move along it — or null
 * while the gesture has not yet committed (in which case nothing should scroll, and the caller must
 * still preventDefault, or the browser will scroll both axes underneath the lock).
 */
export function lockAxis(s: AxisState, dx: number, dy: number, now: number): AxisMove {
  if (now - s.last > AXIS_GESTURE_GAP_MS) { s.axis = null; s.ax = 0; s.ay = 0 }
  s.last = now
  if (s.axis === 'x') return { axis: 'x', delta: dx }   // cross-axis motion is DROPPED, not banked
  if (s.axis === 'y') return { axis: 'y', delta: dy }
  s.ax += dx
  s.ay += dy
  const ax = Math.abs(s.ax), ay = Math.abs(s.ay)
  if (Math.max(ax, ay) < AXIS_DECISIVE_PX) return null  // not enough evidence yet — hold everything
  s.axis = ay >= ax ? 'y' : 'x'                          // ties go to VERTICAL: reading is vertical
  // Spend the whole accumulation on the chosen axis so the gesture does not lose its first few px.
  const delta = s.axis === 'y' ? s.ay : s.ax
  s.ax = 0; s.ay = 0
  return { axis: s.axis, delta }
}
