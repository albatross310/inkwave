// The version-scrub detent — ONE rule, shared by the trackpad and the touch scrubbers.
//
// WHY IT IS ITS OWN MODULE. /snapshot had two hand-rolled copies of "first detent, then a step
// every N px", one in the horizontal-wheel handler and one in the touch handler, differing only in
// their constants. That is the shape this codebase has been bitten by repeatedly (pmToText/textMap,
// the three copies of the page-break rule): two implementations of one rule drift the first time
// somebody tunes one of them, and nothing detects it. Pure, so it is testable without a browser.
//
// ⚠ THE BUFFER (2026-08-28, Peter: "make the scroll scrub in versions mode have a small buffer
// after the first step so you can do one step at a time"). Before it, the trackpad had NO
// single-step semantics whatever: any horizontal swipe past the 34px detent immediately entered the
// continuous scrubber at one version per 7px, so the shortest deliberate flick a hand can make flew
// through half a dozen versions and stepping to the NEXT one was not a gesture the surface offered.
// (Touch already had one — an unarmed flick is exactly one step — which is why this only ever
// bit the trackpad.) The dead zone after the first step is what makes a short swipe mean one
// version: cross FIRST → one step, then nothing at all until BUFFER more px have gone by, and only
// then does the continuous cadence begin. So a deliberate nudge steps once and a committed drag
// still scrubs freely.
//
// ⚠ THE SPEED TRIM (same day, same message: "take 40% off the net scroll speed for trackpad/
// phone"). Applied to REST only — the per-step cadence — never to FIRST. Trimming the arming
// distance would make the scrub HARDER to start, which is the opposite of what was asked; the
// complaint is about how fast it runs once started.

/** Peter's 40%, then his correction. ROUND 1 asked for "40% off the net scroll speed"; ROUND 2, on
 *  feeling it: "I'm still finding the first scroll too hard to find and subsequent notches go past
 *  too quickly." Those pull in OPPOSITE directions and the single knob could not serve both — the
 *  arming distance and the cadence are different complaints about different moments, so they are
 *  different numbers now (see the configs at the bottom). The trim remains what scales the CADENCE. */
export const SCRUB_SPEED_TRIM = 0.6

export type DetentConfig = {
  first: number   // px of travel that commits the FIRST step (arms the gesture)
  buffer: number  // dead zone after that first step, before continuous stepping begins
  rest: number    // px per step thereafter
}

/** Mutable per-gesture state. Callers keep this in a REF, never in effect-local scope: the
 *  /snapshot effects re-subscribe on every step, and effect-local state reset the detent
 *  mid-gesture (round 3 — a 22-step scrub degenerated to ~3 hops). */
export type DetentState = { accum: number; started: boolean; buffered: boolean }

export const newDetent = (): DetentState => ({ accum: 0, started: false, buffered: false })
export const resetDetent = (s: DetentState): void => { s.accum = 0; s.started = false; s.buffered = false }

/** Scale a base cadence by the speed trim. Rounded, because these are px thresholds compared with
 *  `>=` — a fractional threshold buys nothing and reads as a tuning knob nobody chose. */
export const trimmed = (px: number): number => Math.round(px / SCRUB_SPEED_TRIM)

/**
 * Feed one input delta; returns the NET number of steps in the delta's own direction (callers
 * negate for their own axis convention). Zero while inside the arming distance or the buffer.
 */
export function stepDetent(s: DetentState, delta: number, cfg: DetentConfig): number {
  s.accum += delta
  let net = 0
  if (!s.started) {
    if (Math.abs(s.accum) < cfg.first) return 0
    const sign = s.accum > 0 ? 1 : -1
    s.accum -= sign * cfg.first
    s.started = true
    net += sign
  }
  if (!s.buffered) {
    if (Math.abs(s.accum) < cfg.buffer) return net   // the dead zone — one step and no more
    const sign = s.accum > 0 ? 1 : -1
    s.accum -= sign * cfg.buffer
    s.buffered = true
  }
  while (Math.abs(s.accum) >= cfg.rest) {
    const sign = s.accum > 0 ? 1 : -1
    s.accum -= sign * cfg.rest
    net += sign
  }
  return net
}

// The two surfaces' constants, in one place.
//
// FIRST — "too hard to find" (Peter, round 2). Nearly halved from the 34/38 that shipped for years:
// the first version has to arrive under a small, ordinary nudge, because it is the ONLY thing most
// swipes are asking for. What used to protect against a stray touch is now the BUFFER's job, which
// is the better place for it — an accidental brush costs you one version and stops, where before it
// cost nothing and then, one pixel later, cost you six.
//
// REST — "subsequent notches go past too quickly". Doubled again on top of round 1's 40%: 7 → 24px
// on the trackpad, so a step now costs 3.4× the travel it did before any of this. A scrubber that
// overshoots is worse than one that is slow, because overshooting makes you hunt.
//
// BUFFER — ~2.5× FIRST, so the dead zone is unmistakably a dead zone at the scale of the gesture
// that just armed it, and a light flick cannot leave it.
export const TRACKPAD_DETENT: DetentConfig = { first: 18, buffer: 46, rest: trimmed(14) } // rest 23
export const TOUCH_DETENT: DetentConfig    = { first: 22, buffer: 54, rest: trimmed(16) } // rest 27
