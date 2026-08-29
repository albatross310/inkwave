// ── WHEN MAY THE ZOOM WARM RUN? ────────────────────────────────────────────────────────────────
// The rule behind PaginationExtension's between-notch warm of `liveCache`, extracted as a PURE
// function so the gate can keep it. The measurement that motivates it is in the browser probe
// (`pnpm prove:zoomcost`) — but a browser probe is not a guard, and this rule is exactly the part
// that a later edit could quietly break in a way no rendering test would notice: warming too eagerly
// puts a ~100ms measure back onto the input path it was moved off, and warming never at all silently
// restores the old cost while every pixel stays correct.
//
// WHAT THE WARM IS FOR (measured, 13k words / 325 blocks / 55 gaps): one zoom notch's synchronous
// commit is ~105ms, of which ~70 is the band measure — the step cache's MISS path, on 11 of 12
// notches. The idle precompute cannot help: it fills `stepCache`, while a live gesture reads
// `liveCache`, because the placeholder regime is a different geometry regime and the two must never
// be mixed. A gesture is monotonic and a real wheel leaves 150–260ms between notches, so the next
// step is nearly always ±1 in the same direction and there is idle time to measure it in.
//
// THE THREE THINGS THIS RULE HAS TO GET RIGHT:
//  1. NEVER COMPETE WITH THE GESTURE. The warm is a full hypothetical reflow; if it is still running
//     when the next notch arrives, that notch waits for it and the writer feels exactly the lag this
//     removes. So it is scheduled after a DELAY that comfortably exceeds a trackpad's ~16ms cadence
//     (a fast stream cancels the timer before it ever fires), and it is only scheduled at all when
//     the observed cadence leaves room for the warm's OWN measured cost — self-calibrating, because
//     that cost is a property of the writer's machine and document, not a constant we can guess.
//  2. NEVER PREDICT WITHOUT EVIDENCE. No direction ⇒ no warm. Guessing a direction wastes a reflow
//     and, worse, fills liveCache with a step the writer is walking away from.
//  3. NEVER BE LOAD-BEARING. A step that is not warmed is a MISS, and a miss measures live in the
//     same task exactly as before. This makes the miss rarer; it never makes the answer different.

export interface WarmInputs {
  /** Feature switch — `window.__iwLiveWarm === false` is the probe's live known-negative. */
  enabled: boolean
  /** True only inside the gesture's `.iw-zoom-live` placeholder regime (liveCache's regime). */
  placeholders: boolean
  /** Phone pinch commits every frame; there is no idle gap to spend, and the reflow is dearer. */
  phone: boolean
  /** The step just committed. */
  step: number
  /** The step committed before it, or null when there is no trustworthy predecessor. */
  from: number | null
  /** ms since the previous committed step (Infinity for the first of a gesture). */
  gapMs: number
  /** The scheduling delay this warm would use. */
  delayMs: number
  /** What the last warm actually cost on this machine, 0 before any has run. */
  lastWarmMs: number
  /** Lattice bounds — a step outside them is not reachable, so warming it is wasted work. */
  minStep: number
  maxStep: number
  /** Whether the predicted step is already in liveCache. */
  cached: boolean
}

export type WarmPlan =
  | { warm: false; why: 'disabled' | 'not-live' | 'phone' | 'no-direction' | 'out-of-range' | 'cached' | 'too-fast' }
  | { warm: true; step: number }

/** Headroom on the last warm's cost: a machine that took 100ms last time may take a little longer. */
export const WARM_COST_MARGIN = 1.2

export function planLiveWarm(i: WarmInputs): WarmPlan {
  if (!i.enabled) return { warm: false, why: 'disabled' }
  // liveCache's regime ONLY. Warming outside it would measure full-layout geometry and file it under
  // the placeholder cache — the exact mixing the two caches exist to prevent.
  if (!i.placeholders) return { warm: false, why: 'not-live' }
  if (i.phone) return { warm: false, why: 'phone' }
  const dir = i.from === null ? 0 : Math.sign(i.step - i.from)
  if (!dir) return { warm: false, why: 'no-direction' }
  const next = i.step + dir
  if (next < i.minStep || next > i.maxStep) return { warm: false, why: 'out-of-range' }
  if (i.cached) return { warm: false, why: 'cached' }
  // THE CADENCE GATE. `gapMs` is Infinity on a gesture's first notch, so that one always warms —
  // it is the notch a writer notices most, and there is by definition no stream to compete with yet.
  // After that the writer's own observed cadence decides: if the warm cannot finish in the gap they
  // are leaving, it must not start, because a warm the next notch waits on is worse than a miss.
  if (i.gapMs < i.delayMs + i.lastWarmMs * WARM_COST_MARGIN) return { warm: false, why: 'too-fast' }
  return { warm: true, step: next }
}
