// Productivity ledger — THE SCHEMA CONTRACT (build spec §A3.2).
//
// This module is the integration surface for the productivity layer: the graphs, the AI report and
// the email layer all read `SessionRow`. Treat the field names as a wire protocol — they are
// snake_case (not the repo's usual camelCase) BECAUSE they are a cross-agent/CSV contract, and the
// AI-report path emits/parses CSV keyed by exactly these column names. Do not "tidy" them.
//
// DATA MINIMISATION (§A3.2, §C1.3) — a hard product constraint, not a preference. A row carries
// only metadata about HOW the writer worked. It stores NONE of:
//   • geolocation (explicitly not collected — habits + whereabouts, for no feature benefit)
//   • IP address
//   • keystroke-level content
//   • the prose itself
// Anything added here later must clear the "does a real feature need this?" bar. What you don't
// hold can't leak or be subpoenaed.

/**
 * Which kind of document a session was spent in. `email` is set by the email layer (spec Part B).
 *
 * DECLARED IN `types/document.ts`, RE-EXPORTED HERE — not redeclared (feat/prod-integrate,
 * 2026-07-17). This lane and `feat/email-compose` wrote identical unions in parallel: a document
 * type is a property of the DOCUMENT, so the document model owns the classification and the ledger
 * reads it. Two identical declarations are not harmless — they agree today and drift the first time
 * one side gains a member, and the ledger would silently keep tagging rows against a stale union.
 * (The email lane deleted its own competing `docTypeOf` accessor for exactly this reason; the rule
 * that RESOLVES an absent docType to a row's `doc_type` stays in capture.ts, which owns the ledger.)
 */
export type { DocType } from '../types/document'
import type { DocType } from '../types/document'

/**
 * One session row — the atomic unit of the ledger (§A3.2).
 *
 * TIME ZONES (§A9): `start`/`end` are ISO-8601 WITH the writer's local UTC offset
 * (e.g. `2026-07-17T09:14:03.000+10:00`). That single field carries the UTC instant AND the offset,
 * so consumers can aggregate in the writer's local day (take the date part as written) without a
 * second field — which is why there is no separate `tz` column. Never emit a bare `Z` timestamp:
 * the local day is not recoverable from it.
 */
export interface SessionRow {
  session_id: string
  /** Stable document id — never the title, so a title can't leak into the ledger unbidden. */
  doc_id: string
  /**
   * User-visible title. OPTIONAL and suppressible per-doc — omitted entirely when suppressed.
   *
   * ⚠ THE SUPPRESSION IS NOT REACHABLE BY A WRITER (probed 2026-07-17). `isLabelSuppressed` IS wired
   * into the capture path (capture.ts closeDraft), so the mechanism works — but `setLabelSuppressed`
   * has ZERO non-test callers: no UI anywhere turns it on. §A3.2 promises "suppressible per-doc" and
   * the writer currently has no way to exercise it, so in practice every title travels.
   *
   * THIS IS TIER 1 (always included) WHILE `note`/`place` ARE TIER 2, and a title is writer-authored
   * prose too — compile.ts's own tier-2 rationale ("tiers 1 and 3 alone would let the writer's own
   * prose ride out inside 'metadata'") applies to it verbatim. The deliberate distinction: a label is
   * the IDENTIFIER of the thing being measured, not an extra disclosure about it. Drop a note and you
   * lose a diary line; drop the label and §B1's primary goal — "2h10m writing, of which 40m on email"
   * — cannot be read at all, because every row becomes `doc-a1b2f3`. It is also the one prose field
   * already on screen at the moment of consent: §A7.3's tick-box lists documents BY LABEL so the
   * writer can choose which to include.
   *
   * That reasoning covers the ordinary case, NOT the sharp one: a title can be far more revealing
   * than a note ("Chapter 3 — my mother's illness"). Which is precisely why §A3.2 asks for
   * per-doc suppression — and why the missing control is a real gap, not a nicety. RAISED WITH PETER
   * 2026-07-17; the placement of a consent control is his call, not an agent's guess.
   */
  doc_label?: string
  /** ISO-8601 with local offset. */
  start: string
  /** ISO-8601 with local offset. */
  end: string
  /** Time actually editing, excluding idle within the session. See activeMsOf() in sessionLogic. */
  active_minutes: number
  words_start: number
  words_end: number
  /** Gross word additions across the session (start→end word diff). */
  words_added: number
  /** Gross word deletions — the editing/restructuring signal. */
  words_deleted: number
  /** words_end - words_start. */
  net_words: number
  /** Discrete edit operations (content-changing transactions). */
  edit_events: number
  /** Gap since the previous session closed, in minutes. 0 for the first session in the ledger. */
  break_before_min: number
  /** True when this block was a timed Pomodoro work block. */
  pomodoro: boolean
  doc_type: DocType

  /**
   * HOW THE TIME GOT HERE — measured by the timer, or told to us afterwards (Peter, 2026-07-17:
   * "we can also add a manual add for if you forget to use the timer. But then it's flagged post-hoc").
   *
   * AN EXPLICIT UNION, WRITTEN ON EVERY ROW — never `entered?: 'post-hoc'` with absence meaning
   * timer. Absence-as-classification is the exact trap `doc_type` just escaped: it defaulted to
   * 'essay', so every unclassified session was FILED AS ESSAY WRITING whether it was or not. A field
   * whose commonest value is carried by silence cannot be read as a claim, and this one has to be.
   *
   * WHY THIS IS NOT A FOURTH `provenance` TAG, AND THE REASONING IS LOAD-BEARING (§A6.1's three tags
   * are `measured` / `estimated` / `judged`): **`estimated` means a deterministic rule WE ran that
   * anyone can recompute.** A post-hoc block is **testimony** — uncheckable, not recomputable. Different
   * epistemics, so it must not borrow that tag. It is a FLAG ON THE ROW, not a provenance: the row is
   * still measured-SHAPED (a duration, a category, a day); what differs is the SOURCE OF THE TIME.
   *
   * ⚠ IT MUST NEVER MERGE INTO THE MEASURED BARS (§A6.1). The report has to be able to say
   * "3h40m measured, plus 45m you added from memory". Silently totalling them is the lie. What
   * ENFORCES it: `aggregate.ts` sums the measured fields from TIMER ROWS ONLY and carries post-hoc
   * time in its own `posthoc_minutes` column — a different column, so conflation is unrepresentable
   * rather than merely discouraged.
   *
   * IT IS A REPAIR TOOL, NOT AN AUDIT (§A5's register: "a friend letting you correct the record, not
   * a supervisor auditing your timesheet"). Neither nag it nor scold its use.
   *
   * LEGACY ROWS: rows written before this field existed carry no `entered`. They predate the manual
   * add entirely, so every one of them was timer-entered — that is a fact about history, not a
   * default. `isPostHoc()` (aggregate.ts) is the ONE place that reads it, and it asks the positive
   * question ("did this row SAY post-hoc?") so no other code can accidentally re-derive a default.
   */
  entered: 'timer' | 'post-hoc'

  // ─── User-authored fields (Peter, 2026-07-17) — see LEDGER_PRIVATE_FIELDS ───
  // These two are categorically different from every field above: they are text the WRITER chose to
  // type, not telemetry derived from their editing. They are always optional, always omitted when
  // empty, and NEVER flow to an AI without a separate, explicit opt-in.

  /**
   * The writer's diary note for the session — "what I did", written at session end (§A5's reward
   * loop, not a compliance form). Optional; a skipped note is not a failure and is simply absent.
   *
   * This is the first user prose the ledger holds. §A3.2's "never document prose in the persistent
   * ledger" rule was about HARVESTED prose; a note the writer deliberately writes into their own
   * ledger is theirs by intent. It still gets document-grade care on the export path.
   */
  note?: string

  /**
   * A place label the writer TYPES — "library", "home", "cafe". Serves "where do I work best".
   *
   * NOT geolocation. There is no `navigator.geolocation` call, no coordinates, no reverse
   * geocoding, no permission prompt, and no auto-capture anywhere in this layer. This is a word the
   * writer chose, in the same class as `note` — which is why §A3.2's location argument ("habits +
   * whereabouts", sensitivity for no feature benefit) does not bite: we hold no whereabouts, only a
   * label. Do not "upgrade" this to real location later without re-reading §A3.2 and asking Peter.
   */
  place?: string
}

// ─── WHAT ACTUALLY KEEPS `note`/`place` OUT OF AN EXPORT (§A7.3) ─────────────────────────────────
//
// THE ALLOW-LIST IN `report/compile.ts`, and nothing else. Every field that leaves is NAMED there
// (`sessionRows()` lists its 12 columns literally); nothing iterates a row and emits what it finds.
// So a prose field the ledger gains tomorrow cannot leak by default — it is simply not emitted
// until someone adds it there, which forces them to choose a consent tier. The writer's opt-in
// (`includeNotes`, default false) gates the one section that may carry prose.
//
// A DENY-LIST USED TO SIT HERE — `LEDGER_PRIVATE_FIELDS = ['note','place']`, `stripPrivateFields()`,
// `PublicSessionRow` — described as "the DEFAULT payload shape". It was REMOVED on 2026-07-17
// because it was never the default, or anything else: it had ZERO non-test callers on every branch
// including master, and `/privacy`'s own header cited it as the enforcing mechanism. The privacy
// property held the whole time (the allow-list is real), so this was not a leak — it was worse in a
// quieter way: **editing `LEDGER_PRIVATE_FIELDS` to protect a new field would have done nothing at
// all, silently**, while reading like the guard that mattered. Two rules for one question, only one
// live, and the docs pointed at the dead one.
//
// DO NOT REINTRODUCE A DENY-LIST HERE. compile.ts's own banner has the argument: a deny-list fails
// the opposite way, and that failure is silent. If a future path must export rows, name its columns
// there. `report/compile.test.ts` pins the allow-list property directly — including that an
// unforeseen prose field cannot ride out even with tier 2 ON.

// ─── Provenance attestation (§A3.1) ──────────────────────────────────────────
// The ledger doubles as a signed provenance ledger: rows hash into a chain so the ledger is
// tamper-evident and OTS-anchorable, reusing the existing spine (provenance/hash.ts, ots.ts) —
// never a parallel mechanism. One block per LOCAL day (§A9 aggregates in the local day).

import type { OtsProofState } from '../types/document'

/**
 * One day's attestation block.
 *
 * WHY DAYS ARE INDEPENDENT AND NOT CHAINED TO EACH OTHER (a design decision a failing test forced,
 * and the right one): a cross-day prevHash chain means ANY late append invalidates every later
 * day's blockHash — and late appends are the NORMAL case here, because §A9 says the ledger syncs
 * through the writer's own cloud and two devices append concurrently. Yesterday's row arriving from
 * a phone would burn the Bitcoin anchor on every day after it, forcing a re-stamp of the whole
 * month. So each day's block hashes only its own rows (bound to its month + day, so a block cannot
 * be replayed elsewhere) and is independently OTS-anchorable.
 *
 * This is exactly how the existing spine already works — snapshots are NOT chained to one another;
 * each snapshot's bundleHash is independently OTS-anchored, and the hash CHAIN lives inside a
 * signing session (receipts). Ordering evidence comes from Bitcoin's own timestamps, which is
 * stronger than a self-asserted prevHash anyway.
 */
export interface LedgerAttestation {
  v: 1
  /** Local day 'YYYY-MM-DD' — the day this block attests. */
  day: string
  /** sha256Hex(JCS(row)) per row, in the block's row order. */
  rowHashes: string[]
  /** sha256Hex(JCS({v,month,day,rowHashes})) — what OTS anchors. */
  blockHash: string
  /** OTS proof over blockHash → Bitcoin, via the existing relay. Stamped on demand, never on load. */
  ots: OtsProofState
}

/**
 * A per-month ledger (§A3.1) — e.g. `inkwave-ledger-2026-07`. Stored exactly like any other
 * Inkwave document: in the writer's own storage. Inkwave's servers never hold it.
 *
 * MERGE-SAFETY (§A9): the file lives in the writer's own cloud sync, so two devices can append
 * concurrently. `rows` is APPEND-ONLY and keyed by `session_id`; every write-back unions with the
 * target's existing rows FIRST (grow-only — see mergeLedgerRows). CLAUDE.md documents a real
 * 2026-07-05 data-loss incident where a snapshot write-back truncated the archive; the ledger
 * inherits that invariant deliberately.
 */
export interface MonthLedger {
  v: 1
  /** 'YYYY-MM' — the calendar month this ledger covers. */
  month: string
  rows: SessionRow[]
  /** Recomputed deterministically from `rows` on every write; existing OTS proofs are preserved. */
  attestations: LedgerAttestation[]
}


// ─── Derived aggregates (§A3.3) — the report/graphs seam ─────────────────────
// Contributed by `feat/prod-ai-report` as a type-only mirror while this branch was in flight; the
// SessionRow/DocType mirrors it carried are now gone, superseded by the real schema above. These
// aggregate shapes are kept verbatim so its imports keep resolving.

/** Spec §A3.3 — the per-day rollup computed CLIENT-SIDE from the ledger. */
export interface DayAggregate {
  /** Local calendar day, `YYYY-MM-DD` (§A9: store UTC + offset, aggregate in the user's local day). */
  day: string
  /**
   * MEASURED minutes — timer rows ONLY. Post-hoc time is NOT in here and must never be added to it;
   * it has its own column below. §A6.1: "3h40m measured, plus 45m you added from memory" — two
   * numbers, two columns, so a total that silently merges them cannot be written by accident.
   */
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
  /** 24 buckets, index = local hour, value = active minutes. MEASURED rows only. */
  busiest_hours: number[]

  /**
   * Minutes the writer ADDED FROM MEMORY (`entered: 'post-hoc'`) — testimony, not measurement.
   *
   * A SEPARATE COLUMN, and that is the whole enforcement (§A6.1). Every other number on this
   * aggregate comes from rows the timer watched; this one comes from the writer telling us
   * afterwards. They are never summed here, and a consumer that wants a grand total has to write the
   * addition itself — at which point it is a choice someone made, not a lie the schema told for them.
   */
  posthoc_minutes: number
  /** How many blocks he added from memory. Never added to `session_count`. */
  posthoc_session_count: number
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
   * Session rows — supplied for the DAILY window, whose judged rows are per-session.
   *
   * CONTRACT (decided by prod-ledger, 2026-07-17, answering the note-digest question): at
   * WEEKLY/MONTHLY this is `[]` and opted-in notes travel as `note_digest` instead. Two reasons,
   * and the first is the serious one:
   *   • §A6.4. Shipping full session rows at monthly puts a SECOND copy of every measured number
   *     in the payload alongside the day rollups. The rule that measured numbers never round-trip
   *     through the model exists because it silently tidies them — and two copies is precisely how
   *     a narrative ends up contradicting the bars. One representation of measurement, always.
   *   • §A6/§A7. "Compact rollups, not raw logs" is what keeps a monthly payload bounded. The note
   *     TEXT dominates tokens either way, so the digest costs the writer's own words and nothing
   *     more — it just stops the schema from dragging 150 rows of measurement along with them.
   * NB "where do I work best" must be computed CLIENT-SIDE as a measured by-place rollup, not
   * inferred by the model from raw rows — same §A6.4 rule.
   */
  sessions: SessionRow[]
  /**
   * The writer's opted-in notes/places, rolled up per LOCAL day. Present ONLY when tier 2 is on;
   * absent otherwise, so a payload that never opted in has no place to carry prose at all.
   */
  note_digest?: DayNoteDigest[]
  docs: WindowDoc[]
}

/** Tier-2 carrier (§A7.3): the writer's own words for one local day, and nothing measured. */
export interface DayNoteDigest {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  /** The day's session notes, in session order. Sessions without a note contribute nothing. */
  notes: string[]
  /** Distinct place labels the writer typed that day. */
  places: string[]
}
