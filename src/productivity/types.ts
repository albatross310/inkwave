// Productivity ledger — THE SCHEMA CONTRACT (build spec §A3.2).
//
// The graphs, the AI report and the email layer all read `SessionRow`, so:
//   • FIELD NAMES ARE A WIRE PROTOCOL — snake_case, not the repo's camelCase, because the
//     AI-report path emits and parses CSV keyed by exactly these columns. Do not "tidy" them.
//   • DATA MINIMISATION IS A HARD CONSTRAINT (§A3.2, §C1.3), not a preference. A row carries only
//     HOW the writer worked — never geolocation, IP, keystroke content, or the prose itself.
//     Anything added later must clear "does a real feature need this?".
//     → docs/archive/productivity-email-build.md

/**
 * Which kind of document a session was spent in. `email` is set by the email layer (spec Part B).
 *
 * ⚠ RE-EXPORTED, NEVER REDECLARED. A document type is a property of the DOCUMENT, so
 * `types/document.ts` owns it and the ledger reads it. Two identical unions agree today and drift
 * the first time one side gains a member — the ledger would go on tagging rows against a stale one.
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
   * ⚠ TIER 1 (always sent) because a label IDENTIFIES the thing measured: without it §B1's "2h10m
   * writing, of which 40m on email" is unreadable, since every row reads `doc-a1b2f3`. But
   * `setLabelSuppressed` has NO non-test caller, so in practice every title travels — a real §A3.2
   * gap (a title can be sharper than a note), raised with Peter; the control's placement is his call.
   * → docs/archive/productivity-email-build.md#types-doc-label
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
   * HOW THE TIME GOT HERE — measured by the timer, or told to us afterwards.
   *
   * ⚠ EXPLICIT ON EVERY ROW — never absence-means-timer (R8; `doc_type`'s silent 'essay' default
   * filed every unclassified session as essay writing). A post-hoc block is TESTIMONY, not
   * `estimated` (which means a rule anyone can recompute), so it is a FLAG on a measured-shaped
   * row and NOT a fourth provenance — and it must never merge into the measured bars: `aggregate.ts`
   * sums TIMER ROWS ONLY and carries post-hoc time in its own `posthoc_minutes` column. Read it ONLY
   * through `isPostHoc()`, which asks the positive question, so nothing re-derives a default for the
   * legacy rows that predate the field. A repair tool, not an audit: never nag it, never scold it.
   * → docs/archive/productivity-email-build.md#types-entered
   */
  entered: 'timer' | 'post-hoc'

  // ─── User-authored fields — gated by the allow-list above ───
  // Categorically different from every field above: text the WRITER chose to type, not telemetry
  // derived from their editing. Always optional, always omitted when empty, and NEVER flow to an AI
  // without a separate, explicit opt-in.

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

// ─── WHAT KEEPS `note`/`place` OUT OF AN EXPORT (§A7.3) ──────────────────────
// ⚠ THE ALLOW-LIST IN `report/compile.ts`, AND NOTHING ELSE — every field that leaves is NAMED
// there, so a prose field the ledger gains tomorrow is simply not emitted until someone adds it and
// picks a consent tier. DO NOT REINTRODUCE A DENY-LIST HERE: the last one had zero live callers
// while `/privacy` cited it as the enforcing mechanism (R4), and it fails the opposite way, silently.
// → docs/archive/productivity-email-build.md#types-no-deny-list

// ─── Provenance attestation (§A3.1) ──────────────────────────────────────────
// The ledger doubles as a signed provenance ledger: rows hash into a chain so the ledger is
// tamper-evident and OTS-anchorable, reusing the existing spine (provenance/hash.ts, ots.ts) —
// never a parallel mechanism. One block per LOCAL day (§A9 aggregates in the local day).

import type { OtsProofState } from '../types/document'

/**
 * One day's attestation block.
 *
 * ⚠ DAYS ARE INDEPENDENT, NEVER CHAINED TO EACH OTHER. Late appends are the NORMAL case (§A9: two
 * devices sync through the writer's own cloud), and a cross-day prevHash would burn the Bitcoin
 * anchor on every later day. Each block hashes only its own rows, bound to its month + day so it
 * cannot be replayed elsewhere — exactly how snapshots already work.
 * → docs/archive/productivity-email-build.md#types-attestation-days
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
/**
 * The writer's reflection on a STRETCH of work — "what did I actually do?"
 *
 * ⚠ ITS OWN OBJECT, NOT A FIELD ON A ROW: a reflection spans many rows, and the writer thinks in
 * CATEGORIES, not in session ids they have never seen. It is also what rescues `misc` — the
 * measured stretch is the recall prompt and they NAME it, after the fact. §A5: always skippable,
 * never re-prompted, and no reflection is a failure.
 * → docs/archive/productivity-email-build.md#types-reflection
 */
export interface Reflection {
  reflection_id: string
  /** Local day 'YYYY-MM-DD' the stretch falls in. */
  day: string
  /** The stretch it reflects on — ISO-8601 with local offset, like every other time here. */
  from: string
  to: string
  /**
   * One line per category the writer chose to comment on. A category they said nothing about is
   * ABSENT — never an empty string. Their words; never generated, never graded.
   */
  notes: Array<{ doc_type: DocType; text: string }>
}

export interface MonthLedger {
  v: 1
  /** 'YYYY-MM' — the calendar month this ledger covers. */
  month: string
  rows: SessionRow[]
  /**
   * The writer's own prose about their stretches (§A7.3 tier 2 — its own consent tick, off by
   * default). Append-only and merged grow-only by `reflection_id`, exactly like rows.
   */
  reflections?: Reflection[]
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
   * ⚠ A SEPARATE COLUMN IS THE ENFORCEMENT (§A6.1): never summed with the measured fields, so a
   * grand total is a choice a caller writes, not a lie the schema told for them.
   * → docs/archive/productivity-email-build.md#types-posthoc-minutes
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
   * Session rows — supplied for the DAILY window only, whose judged rows are per-session.
   *
   * ⚠ `[]` AT WEEKLY/MONTHLY; opted-in notes travel as `note_digest` instead. Rows there would put a
   * SECOND copy of every measured number beside the day rollups (§A6.4), which is how a narrative
   * ends up contradicting the bars — ONE representation of measurement, always. "Where do I work
   * best" is a CLIENT-SIDE by-place rollup, never inferred by the model from raw rows.
   * → docs/archive/productivity-email-build.md#types-sessions-empty
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
