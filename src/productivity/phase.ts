// The deep-vs-shallow (drafting-vs-editing) heuristic — build-spec §A3.3.
//
// ⚠ AN INFERENCE, NOT A MEASUREMENT, and not AI either — a deterministic rule anyone can re-run on
// the ledger. It is therefore neither of §A6.1's two categories and is painted as neither: its own
// legend entry, `estimated (rule)`. → docs/archive/productivity-email-build.md#phase-three-provenances
//
// ⚠ RATIO ONLY — NO DURATION. A deliberate, MEASURED deviation from §A3.3's `e.g.` (Peter to
// confirm): session LENGTH does not track what the writer was doing, and duration alone scored
// WORSE THAN CHANCE. Conjoined it never causes a wrong call but skews the mix to 82% drafting
// against a 48% truth — the spec's rule would tell a writer they spent the month drafting when
// they spent half of it editing. `longMinutes`/`shortMinutes` survive ONLY as the scored
// alternative. → docs/archive/productivity-email-build.md#phase-ratio-only
//
// ⚠ READ BEFORE MOVING A CUT-POINT. A synthetic fixture can prove a rule INSENSITIVE; it cannot
// CALIBRATE one — and check the classes OVERLAP in the proxy the rule actually READS. The original
// fixture's classes were disjoint in addRatio, so the 0.70 cut sat in a void and every mutant of it
// stayed green. → docs/archive/productivity-email-build.md#phase-fixture-void
//
// ⚠ THE `unclear` BAND IS LOAD-BEARING and a first-class share, never a rendering failure: forcing
// a call there is exactly where precision breaks. "22% unclear" is worth more than "78% drafting"
// arrived at by rounding away the doubt.

import type { SessionRow } from './types'

export type Phase = 'drafting' | 'editing' | 'unclear'

/**
 * Chosen A PRIORI from what the proxies MEAN — never fitted to a fixture (a rule tuned on the same
 * data that scores it proves only that it memorised it). ≥0.70: laying down substantially more than
 * you cut ⇒ composition. ≤0.50: cutting at least as much as you add ⇒ restructuring. The band
 * between is deliberately unclaimed. `longMinutes`/`shortMinutes` are NOT used by the shipped rule.
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
