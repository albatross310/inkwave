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
// 64 sessions, ground truth ~48% drafting), the DURATION half of that conjunction does not work:
//
//   rule                        precision   coverage   called-drafting
//   ratio + duration (spec e.g.)   100.0%      39.1%      84.0%   ← skews the mix badly
//   ratio only            SHIPPED  100.0%      81.3%      59.6%
//   duration only                   47.2%      82.8%      79.2%   ← worse than chance
//
// Session LENGTH does not track what the writer was doing — long revising sessions and short
// drafting bursts are both ordinary, so duration alone misclassifies (47% on a ~50/50 task, 28
// outright wrong calls). Conjoined with the ratio it never causes a wrong call, but it suppresses
// coverage to 39% AND skews the surviving calls to 84% drafting against a 48% truth — i.e. the
// spec's rule would have told a writer they spent their month drafting when they spent half of it
// editing. That is precisely "a number that looks meaningful and isn't".
//
// So: the add/delete ratio carries the entire signal and ships alone. The duration thresholds are
// retained below ONLY as the documented alternative the variants test scores against.
// ⚠ This is a deliberate, measured deviation from the spec's example — Peter to confirm.
//
// THE `unclear` BAND IS LOAD-BEARING. Between the two cut-points the session is genuinely
// ambiguous, and forcing a call there is exactly where precision breaks (measured: forcing every
// session into a binary costs real misclassifications, 95.3% precision and 3 wrong). A ratio that
// says "19% unclear" is worth more than one that says "81% drafting" by rounding away the doubt.

import type { LedgerSession } from './ledger'

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
export function classifySession(s: Pick<LedgerSession, 'words_added' | 'words_deleted'>): PhaseVerdict {
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
export function phaseMix(sessions: readonly LedgerSession[]): PhaseMix {
  const mix: PhaseMix = { drafting: 0, editing: 0, unclear: 0, total: sessions.length }
  for (const s of sessions) mix[classifySession(s).phase]++
  return mix
}
