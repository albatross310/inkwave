// The productivity layer's data contract — spec §A3.2 (session rows) and §A3.3 (derived
// aggregates).
//
// ─── THIS IS A CONSUMED SEAM, NOT A FORK ────────────────────────────────────────────────────
// The ledger itself is owned by `feat/prod-ledger`; the client-side aggregates and the measured
// graphs are owned by `feat/prod-graphs`. Neither had landed when the AI-report path was built,
// so these are TYPE-ONLY mirrors of the spec's tables — no ledger reader, no aggregator, and no
// measured chart is implemented here. They are structural, so the real modules' objects satisfy
// them as-is: when those branches land, delete the mirrors and re-point the imports at the real
// types. If a field below is missing from the real schema, that is a contract disagreement to
// raise — do NOT add it here unilaterally.
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Spec §A3.2 — the atomic ledger row.
 *
 * TWO FIELDS ARE THE WRITER'S OWN PROSE (Peter, 2026-07-17), so §A3.2's "never document prose in
 * the persistent ledger" no longer strictly holds:
 *   • `note`  — a free-text diary line the writer adds at the end of a session.
 *   • `place` — a label the writer TYPES ("library", "home"). It is NOT geolocation: there is no
 *     GPS, no coordinates, no permission prompt, and nothing is harvested. It is a word the
 *     writer wrote, of exactly the same class as the note. Any copy that implies Inkwave
 *     collects whereabouts is FALSE and must not be written (§C1.4 — precise claims).
 *
 * Both would otherwise ride out inside "metadata", which is always included — making "metadata
 * only" quietly mean "and what I wrote about my day". So both are gated behind their own opt-in
 * on the way out (report/compile.ts, tier 2). Do not fold either into the always-included tier.
 *
 * FIELD NAMES ARE OWNED BY `feat/prod-ledger` and not yet final. `note`/`place` are placeholders
 * pending its report; the export path reads them in exactly one place each (compileData's
 * sensitive section), so re-pointing is a two-line change. Do not guess further.
 */
export interface SessionRow {
  session_id: string
  doc_id: string
  /** User-visible title; may be suppressed per-doc, hence optional. */
  doc_label?: string
  /** ISO-8601. */
  start: string
  /** ISO-8601. */
  end: string
  active_minutes: number
  words_start: number
  words_end: number
  words_added: number
  words_deleted: number
  net_words: number
  edit_events: number
  break_before_min: number
  pomodoro: boolean
  doc_type: DocType
  /** TIER 2 — the writer's own prose. Never exported without its own explicit opt-in. */
  note?: string
  /** TIER 2 — a place label the writer TYPED. Not geolocation. Same gate as `note`. */
  place?: string
}

export type DocType = 'note' | 'essay' | 'email' | 'other'

/** Spec §A3.3 — the per-day rollup computed CLIENT-SIDE from the ledger. */
export interface DayAggregate {
  /** Local calendar day, `YYYY-MM-DD` (§A9: store UTC + offset, aggregate in the user's local day). */
  day: string
  active_minutes: number
  session_count: number
  words_added: number
  words_deleted: number
  net_words: number
  edit_events: number
  break_count: number
  break_total_min: number
  /** Spec §A3.3's drafting-vs-editing heuristic. MEASURED (a deterministic client-side rule) —
   *  not to be confused with the model's judged `phase`. */
  deep_shallow_ratio: number
  /** 24 buckets, index = local hour, value = active minutes. */
  busiest_hours: number[]
}

/** The window a report covers (§A6.2). */
export type ReportWindow = 'daily' | 'weekly' | 'monthly'

/** A document that appears in the window, for the per-document content tick-box (§A7.3). */
export interface WindowDoc {
  doc_id: string
  doc_label?: string
  doc_type: DocType
  /** Measured, from the ledger — shown so the writer knows what each doc cost them. */
  active_minutes: number
  session_count: number
}

/** Everything the report path reads for a window. Produced by the graphs/ledger seam. */
export interface WindowAggregate {
  window: ReportWindow
  /** Inclusive local-day bounds, `YYYY-MM-DD`. */
  from: string
  to: string
  days: DayAggregate[]
  /**
   * Session rows. Required for the DAILY window, whose judged rows are per-session.
   *
   * CONTRACT NOTE for prod-ledger/prod-graphs: they are ALSO required at weekly/monthly when the
   * writer opts into tier 2 (notes + place), because a note is per-session and there is nowhere
   * else to read it from. Weekly/monthly payloads still send day ROLLUPS only (§A3.3) — the
   * session rows are used solely to list the opted-in notes, never as raw logs. If supplying
   * them at weekly+ is a problem, say so and we can define a per-day note digest instead.
   */
  sessions: SessionRow[]
  docs: WindowDoc[]
}
