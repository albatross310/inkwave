// The deep-vs-shallow (drafting-vs-editing) heuristic — build-spec §A3.3.
//
// WHAT THIS IS, EXACTLY. A RULE OVER MEASURED FIELDS: deterministic, auditable, computed
// client-side — but an INFERENCE, not a measurement. A session's phase is not something the ledger
// observed; it is a guess from a proxy. So it is neither of the spec's two honesty categories
// (§A6.1 measured / judged-by-AI) and is painted as neither: not a solid measured bar (it isn't
// measured) and not an AI overlay (no model touched it — anyone can re-run it on the ledger). It
// gets its own legend entry, `estimated (rule)`. See charts/series.ts.
//
// ─── DEVIATION FROM THE SPEC'S EXAMPLE RULE — MEASURED, NOT PREFERRED ────────
//
// §A3.3 offers the rule as an example: "high add-to-delete ratio + long sessions → drafting; high
// delete + short → editing". Scored against labelled synthetic writing (phase.variants.test.ts,
// 64 sessions, ground truth 48.4% drafting), the DURATION half of that conjunction does not work:
//
//   rule                        precision   coverage   called-drafting
//   ratio + duration (spec e.g.)   100.0%      34.4%      81.8%   ← skews the mix badly
//   ratio only            SHIPPED  100.0%      78.1%      50.0%   ← mix ≈ the 48.4% truth
//   duration only                   47.2%      82.8%      79.2%   ← worse than chance, 28 wrong
//
// Session LENGTH does not track what the writer was doing — long revising sessions and short
// drafting bursts are both ordinary, so duration alone misclassifies (47% on a ~50/50 task, 28
// outright wrong calls). Conjoined with the ratio it never causes a wrong call, but it suppresses
// coverage to 34% AND skews the surviving calls to 82% drafting against a 48% truth — i.e. the
// spec's rule would have told a writer they spent their month drafting when they spent half of it
// editing. That is precisely "a number that looks meaningful and isn't".
//
// So: the add/delete ratio carries the entire signal and ships alone. The duration thresholds are
// retained below ONLY as the documented alternative the variants test scores against.
// ⚠ This is a deliberate, measured deviation from the spec's example — Peter to confirm.
//
// ─── THE NUMBERS ABOVE WERE ONCE UNSUPPORTED. READ THIS BEFORE CHANGING A CUT-POINT. ───
//
// An external audit found the fixture behind this table could not feel a wrong threshold: its
// generative bands were DISJOINT in addRatio across the truth classes (editing topped at 0.624,
// drafting started at 0.803, nothing between), so the 0.70 cut sat in a void and EVERY value in
// [0.625, 0.800] scored identically. Mutating 0.70 → 0.65/0.75/0.78 left the suite green: the
// evidence was a tautology of the data. The fixture now overlaps genuinely (drafting reaches down
// to ~0.58, editing up to ~0.69, ~14% of sessions contested) and `phase.thresholds.test.ts` pins
// that property AND proves each of those four mutants now FAILS.
//
// Re-derived on the corrected fixture, the conclusion HELD and sharpened: ratio-only keeps 100%
// precision across 7 seeds (448 sessions, 0 wrong) and its mix lands at 47.9% against a 47.6%
// truth — the closest of every candidate tried. The audit's own suggestion that `editAddRatio:
// 0.65` beats 0.50 was itself an artifact of the void: on the corrected fixture it costs 35 wrong
// calls across those seeds (90.5% precision). The thresholds did not move.
//
// THE `unclear` BAND IS LOAD-BEARING. Between the two cut-points the session is genuinely
// ambiguous, and forcing a call there is exactly where precision breaks (measured: forcing every
// session into a binary costs real misclassifications, 93.8% precision and 4 wrong). A ratio that
// says "22% unclear" is worth more than one that says "78% drafting" by rounding away the doubt.
// What it declines is honest: the HARD drafting sessions that cut most of what they lay down, and
// deep restructuring — sessions where the add/delete ratio genuinely does not carry the answer.

import type { SessionRow } from './types'

export type Phase = 'drafting' | 'editing' | 'unclear'

/**
 * Chosen a priori from what the proxies MEAN — not fitted to any fixture (a rule tuned on the same
 * data that scores it proves only that it memorised it):
 *  - addRatio ≥ 0.70: laying down substantially more than you cut → composition.
 *  - addRatio ≤ 0.50: cutting at least as much as you add → restructuring.
 *  - The band between is deliberately unclaimed.
 * `longMinutes`/`shortMinutes` are NOT used by the shipped rule — see the deviation note above.
 */
export const PHASE_THRESHOLDS = {
  draftAddRatio: 0.70,
  editAddRatio: 0.50,
  /** Retained for the scored alternative only; the shipped rule ignores duration. */
  longMinutes: 25,
  shortMinutes: 15,
} as const

/** A session with no writing in it at all can't be classified — don't invent a phase for it. */
export const MIN_WORDS_TO_CLASSIFY = 10

export interface PhaseVerdict {
  phase: Phase
  /** words_added / (words_added + words_deleted) — 1 = pure addition, 0 = pure deletion. */
  addRatio: number
  /** Why it landed where it did — surfaced in the UI so the rule is never a black box. */
  reason: string
}

/**
 * Classify one session by its add-to-delete ratio. Pure; no clock, no storage, no I/O.
 * Deliberately does not read `active_minutes` — see the deviation note above.
 */
export function classifySession(s: Pick<SessionRow, 'words_added' | 'words_deleted'>): PhaseVerdict {
  const churn = s.words_added + s.words_deleted
  if (churn < MIN_WORDS_TO_CLASSIFY) {
    return { phase: 'unclear', addRatio: churn === 0 ? 0 : s.words_added / churn, reason: 'too little writing to tell' }
  }
  const addRatio = s.words_added / churn
  const T = PHASE_THRESHOLDS
  if (addRatio >= T.draftAddRatio) return { phase: 'drafting', addRatio, reason: 'mostly adding new words' }
  if (addRatio <= T.editAddRatio) return { phase: 'editing', addRatio, reason: 'cutting as much as adding' }
  return { phase: 'unclear', addRatio, reason: 'a mix of adding and cutting' }
}

export interface PhaseMix {
  drafting: number
  editing: number
  unclear: number
  /** Total sessions counted — so a share is never read without its denominator. */
  total: number
}

/** The deep-vs-shallow ratio for a set of sessions (§A3.3), with `unclear` kept as a first-class share. */
export function phaseMix(sessions: readonly SessionRow[]): PhaseMix {
  const mix: PhaseMix = { drafting: 0, editing: 0, unclear: 0, total: sessions.length }
  for (const s of sessions) mix[classifySession(s).phase]++
  return mix
}
