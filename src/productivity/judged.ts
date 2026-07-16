// The measured/judged seam and the statistical-honesty gate — build-spec §A6.1, §A6.2, §C3.
//
// The AI half of the report ships separately (the `feat/prod-ai-report` lane owns the prompt, the
// paste-back parse, and the model call). This module is the CONTRACT it lands against, built now and
// deliberately: the rules below are the product's credibility, and a rule that arrives after the
// renderers it constrains arrives too late to constrain them.
//
// TWO RULES, both enforced STRUCTURALLY rather than by prompt or convention — a prompt is a request,
// and a convention is a comment that compiles:
//
//   1. §A6.1 — judged (AI) data is never mixed into measured bars as if measured. Enforced in
//      charts/series.ts: a series' style is a FUNCTION of its provenance tag, not a caller-supplied
//      prop, so there is no argument a caller can pass that paints AI output as measurement.
//
//   2. §A6.2 — one day is statistically noise, so the daily window is a descriptive recap and must
//      not assert causal/pattern claims. Enforced by selectClaims() below, which is what the panel
//      renders through. "Enforce this in the UI, not just the prompt — if a component CAN render a
//      causal claim from one day's data, it eventually will."

import type { PhaseVerdict } from './phase'

/** The report window (§A6.2). Daily = recap; weekly = the sweet spot; monthly = trend. */
export type ReportWindow = 'day' | 'week' | 'month'

/**
 * What a claim asserts.
 *  - `descriptive` — restates what happened ("you wrote for 90 minutes across 3 sessions").
 *    Always permitted: it makes no inferential leap beyond the ledger.
 *  - `pattern` — asserts a regularity or a causal link ("your best writing follows a break",
 *    "mornings are your deep hours"). Needs enough sessions to be more than noise.
 */
export type ClaimKind = 'descriptive' | 'pattern'

/** A single AI-authored claim. The narrative markdown is separate; these are the assertions. */
export interface JudgedClaim {
  id: string
  text: string
  kind: ClaimKind
}

/**
 * Windows at which a `pattern` claim has enough data behind it to be worth asserting (§A6.2:
 * "Confident pattern claims … are permitted only at weekly+").
 */
export function allowsPatternClaims(w: ReportWindow): boolean {
  return w === 'week' || w === 'month'
}

export interface ClaimSelection {
  /** Claims the window supports. The ONLY list a renderer may draw. */
  shown: JudgedClaim[]
  /** Claims withheld because the window can't support them. Surfaced honestly, never silently dropped. */
  withheld: JudgedClaim[]
}

/**
 * The gate. Every claim rendered by the panel passes through here.
 *
 * Withheld claims are RETURNED, not discarded (§A9: never silently drop data) — the panel tells the
 * reader that a pattern claim exists but that one day can't support it, and points at the weekly
 * view. That is the honest move: the claim isn't wrong because it's daily, it's *unsupported*, and
 * hiding its existence would be its own small dishonesty.
 */
export function selectClaims(claims: readonly JudgedClaim[], window: ReportWindow): ClaimSelection {
  if (allowsPatternClaims(window)) return { shown: [...claims], withheld: [] }
  const shown: JudgedClaim[] = [], withheld: JudgedClaim[] = []
  for (const c of claims) (c.kind === 'pattern' ? withheld : shown).push(c)
  return { shown, withheld }
}

// ─── Judged per-session fields (§A6.1) ────────────────────────────────────────

/**
 * The AI's own per-session phase call — the judged counterpart to phase.ts's rule.
 *
 * These are DIFFERENT THINGS and the panel must never merge them: `phase.ts` is a rule anyone can
 * re-run on the ledger; this is a model's opinion. Where they disagree, that disagreement is
 * information (and is shown), not something to average away.
 */
export interface JudgedSession {
  session_id: string
  phase: 'deep' | 'shallow'
  /** Optional model-supplied confidence, 0–1. Absent is normal — don't fabricate one. */
  confidence?: number
  note?: string
}

export interface PhaseComparison {
  session_id: string
  /** The client rule's verdict — reproducible from the ledger. */
  ruled: PhaseVerdict['phase']
  /** The model's verdict — interpretation. */
  judged: JudgedSession['phase']
  /** True when the two independent estimates point the same way. */
  agrees: boolean
}

/**
 * Compare the rule's phase estimate with the AI's, per session.
 *
 * Mapping: the rule's `drafting` ↔ the AI's `deep`, `editing` ↔ `shallow`. An `unclear` ruling can
 * never "agree" — the rule declined to call it, and counting a declination as agreement would
 * inflate the agreement rate with sessions the rule said nothing about. (That is exactly the
 * known-negative-that-scores-identically failure this codebase keeps getting burned by.)
 */
export function comparePhases(
  ruled: ReadonlyMap<string, PhaseVerdict['phase']>,
  judged: readonly JudgedSession[],
): PhaseComparison[] {
  const out: PhaseComparison[] = []
  for (const j of judged) {
    const r = ruled.get(j.session_id)
    if (!r) continue
    const agrees = (r === 'drafting' && j.phase === 'deep') || (r === 'editing' && j.phase === 'shallow')
    out.push({ session_id: j.session_id, ruled: r, judged: j.phase, agrees })
  }
  return out
}

/** The AI half of a report, as the panel consumes it. Absent until the user runs the AI path. */
export interface JudgedReport {
  /** The model's narrative, markdown. Rendered in its own labelled region, never as a chart. */
  narrative?: string
  claims: JudgedClaim[]
  sessions: JudgedSession[]
}
