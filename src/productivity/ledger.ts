// The productivity ledger schema — build-spec §A3.2.
//
// ⚠ CONTRACT, NOT OURS TO CHANGE. The ledger (capture + per-month persistence) is owned by the
// `feat/prod-ledger` lane; this file mirrors the spec'd row shape so the aggregation/graph lane can
// build against it without waiting. When the ledger lands, this type should be REPLACED by an import
// from its module — the field names/units here are the spec's, verbatim, so that swap is mechanical.
// If a graph needs a field that isn't here, ASK: a silent schema fork breaks four lanes at once.
//
// Data minimisation (§A3.2): metadata only — never prose, never geolocation, never keystrokes.

/** §A3.2 `doc_type`. Email sessions are flagged here (Part B). */
export type DocType = 'note' | 'essay' | 'email' | 'other'

/** One session row — the atomic unit of the ledger (§A3.2). */
export interface LedgerSession {
  session_id: string
  doc_id: string
  /** User-visible title; suppressible per-doc, so treat as optional at every use site. */
  doc_label?: string
  /** ISO-8601. Carries a UTC offset (§A9: store UTC + offset, aggregate in the user's local day). */
  start: string
  /** ISO-8601. */
  end: string
  /** Time actually editing — excludes idle within the session. */
  active_minutes: number
  words_start: number
  words_end: number
  /** Gross additions. */
  words_added: number
  /** Deletions — the editing/restructuring signal. */
  words_deleted: number
  /** `words_end - words_start`. May be negative on a cutting session; that is not a failure. */
  net_words: number
  edit_events: number
  /** Gap since the previous session, in minutes. */
  break_before_min: number
  pomodoro: boolean
  doc_type: DocType
}

// ─── Local-day resolution (§A9) ───────────────────────────────────────────────
//
// Aggregates roll up by the WRITER'S local day, not by UTC day — a 9pm Brisbane session belongs to
// that evening, not to the next UTC date. The offset in the ISO string is the source of truth when
// present, so aggregation is a pure function of the ledger's own bytes and does NOT depend on the
// machine's TZ. (A test suite that silently passes only in Australia/Brisbane is the kind of check
// that can't see its own failure — the fixtures therefore carry explicit offsets.)

/** Matches a trailing `Z` or `±HH:MM` / `±HHMM` offset on an ISO-8601 timestamp. */
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/

/**
 * The local calendar day (`YYYY-MM-DD`) an ISO timestamp falls in, honouring its own UTC offset.
 * Falls back to the runtime's local day when the string carries no offset at all.
 */
export function localDayOf(iso: string): string {
  const m = OFFSET_RE.exec(iso.trim())
  if (!m) {
    // No offset in the data → the only meaning available is the runtime's local day.
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const offMin = m[1] === 'Z' ? 0 : offsetMinutes(m[1])
  // Shift into the writer's wall clock, then read the date parts in UTC.
  const shifted = new Date(t + offMin * 60_000)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** The local wall-clock hour (0–23) an ISO timestamp falls in — the busiest-hours histogram's bucket. */
export function localHourOf(iso: string): number {
  const m = OFFSET_RE.exec(iso.trim())
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  if (!m) return new Date(iso).getHours()
  const offMin = m[1] === 'Z' ? 0 : offsetMinutes(m[1])
  return new Date(t + offMin * 60_000).getUTCHours()
}

function offsetMinutes(off: string): number {
  const sign = off[0] === '-' ? -1 : 1
  const body = off.slice(1).replace(':', '')
  return sign * (Number(body.slice(0, 2)) * 60 + Number(body.slice(2, 4)))
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** ISO weekday index for a `YYYY-MM-DD` day key: 0 = Monday … 6 = Sunday. */
export function weekdayOf(dayKey: string): number {
  const d = new Date(`${dayKey}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

/** The Monday (`YYYY-MM-DD`) of the ISO week containing `dayKey`. */
export function weekStartOf(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weekdayOf(dayKey))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** The `YYYY-MM` month a day key falls in. */
export function monthOf(dayKey: string): string { return dayKey.slice(0, 7) }
