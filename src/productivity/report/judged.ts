// Judged-table validation — spec §A7.1.5, §A6.4, §A9.
//
// csv.ts answers "what shape is this text". This module answers the only question that matters
// for trust: IS THIS THE TABLE WE ASKED FOR? It is deliberately strict where csv.ts is forgiving.
//
// THREE RULES IT ENFORCES, none of which the prompt is trusted to secure on its own:
//   1. §A7.1.5 — the header is validated against the expected header. A table that does not
//      match is REJECTED, not coerced into looking right.
//   2. §A6.4 — a judged table carrying a MEASURED column is rejected outright. That is the
//      round-trip the data-integrity rule forbids: the moment a measured number comes back from
//      the model, Inkwave can no longer say its numbers are its own. Convenience does not buy
//      an exception.
//   3. §A9 — nothing is ever silently dropped. Every excluded row, every coerced value and every
//      row the model failed to judge becomes an Issue the panel shows.

import type { ReportWindow } from '../types'
import {
  EFFORT_VALUES, JUDGED_HEADER, MOMENTUM_VALUES, PHASE_VALUES, headerLine,
} from './prompt'
import { candidateCsvBlocks, parseDelimited } from './csv'

export interface JudgedRow {
  /** session_id (daily) or day (weekly/monthly). */
  key: string
  phase: typeof PHASE_VALUES[number]
  effort: typeof EFFORT_VALUES[number]
  momentum?: typeof MOMENTUM_VALUES[number]
  note: string
}

export type IssueKind =
  | 'no-block'          // no fenced block at all
  | 'truncated'         // the fence never closed — reply cut off
  | 'no-header'         // a block, but no row matching the expected header
  | 'header-mismatch'   // a header-ish row that is the wrong table
  | 'measured-column'   // §A6.4 — the model tried to hand back measured numbers
  | 'row-shape'         // wrong number of cells
  | 'unknown-value'     // an enum value we did not offer → coerced to 'unclear'
  | 'unknown-key'       // judged a row we never sent
  | 'duplicate-key'     // judged the same row twice
  | 'missing-key'       // a row we sent that the model did not judge (a gap, shown honestly)

export interface Issue {
  kind: IssueKind
  message: string
}

export interface JudgedResult {
  /** True only when a valid table was found. Rows may still be empty-ish; check issues. */
  ok: boolean
  rows: JudgedRow[]
  issues: Issue[]
  /** The header actually found, when there was one — shown in the failure message. */
  foundHeader?: string[]
}

// ─── §A6.4: the measured columns, which may never come back ─────────────────────────────────
// Every measured field name from §A3.2 (session rows) and §A3.3 (day aggregates). If the model
// emits any of these, the table is refused.
//
// PROBED (2026-07-17), because "which guard is actually holding?" is not a question to answer by
// reading: empty this list and a measured table is STILL refused — by the exact-header rule, as
// `header-mismatch`. So §A6.4 has TWO independent guards and this list is not a single point of
// failure; what it adds is the correct DIAGNOSIS ("Inkwave never takes its measurements back
// from an AI") instead of a generic "unexpected column". Both are tested; the list's test carries
// a non-empty assertion because an empty list made the per-column loop pass vacuously.
//
// `place` is here too: it is the writer's own field, not a judgement, so a model returning it is
// handing back input as if it were output — the same category error as returning a measurement.
// `note` is DELIBERATELY ABSENT: the ledger's diary `note` and the judged `note` column share a
// name, and reserving it would reject the correct header. That is safe — the rule this list
// enforces is about NUMBERS coming back, and the merged export keeps the two apart by prefix
// (`note` = the writer's diary line, `judged_note` = the model's). If prod-ledger renames its
// field, add the new name here.
export const MEASURED_COLUMNS: readonly string[] = [
  // §A3.2
  'doc_id', 'doc_label', 'start', 'end', 'active_minutes', 'words_start', 'words_end',
  'words_added', 'words_deleted', 'net_words', 'edit_events', 'break_before_min', 'pomodoro',
  'doc_type', 'place',
  // §A3.3
  'session_count', 'break_count', 'break_total_min', 'deep_shallow_ratio', 'busiest_hours',
]

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_')
}

function sameSet(a: string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

/** Does this row look like it was MEANT to be the header? Used to tell "wrong table" (report the
 *  mismatch) from "prose above the table" (skip the line). */
function looksLikeHeader(cells: string[]): boolean {
  const n = cells.map(norm)
  return n.includes('phase') || n.includes('note') || n.includes('effort')
    || n.includes('session_id') || n.includes('day')
}

interface HeaderFind {
  index: number
  cells: string[]
}

function findHeader(rows: string[][], window: ReportWindow): HeaderFind | null {
  const want = JUDGED_HEADER[window]
  for (let i = 0; i < rows.length; i++) {
    if (sameSet(rows[i].map(norm), want)) return { index: i, cells: rows[i].map(norm) }
  }
  return null
}

function coerce<T extends string>(
  raw: string, allowed: readonly T[], column: string, key: string, issues: Issue[],
): T {
  const v = norm(raw)
  if ((allowed as readonly string[]).includes(v)) return v as T
  if (v !== '') {
    issues.push({
      kind: 'unknown-value',
      message: `Row "${key}": ${column} was "${raw.trim()}", which isn't one of `
        + `${allowed.join(', ')}. Recorded as "unclear".`,
    })
  }
  return 'unclear' as T
}

export interface ValidateOpts {
  window: ReportWindow
  /** The keys Inkwave asked about — session ids (daily) or days (weekly/monthly). */
  expectedKeys: string[]
}

/** Validate one already-parsed table. */
export function validateJudgedRows(rows: string[][], opts: ValidateOpts): JudgedResult {
  const { window, expectedKeys } = opts
  const issues: Issue[] = []
  const found = findHeader(rows, window)

  if (!found) {
    // Report the WRONG table distinctly from no table — the writer needs to know which.
    const headerish = rows.find(looksLikeHeader)
    if (headerish) {
      const cells = headerish.map(norm)
      const measured = cells.filter(c => MEASURED_COLUMNS.includes(c))
      if (measured.length) {
        issues.push({
          kind: 'measured-column',
          message: `That table contains measured columns (${measured.join(', ')}). Inkwave keeps `
            + `its own measurements and never takes them back from an AI, so this table was not `
            + `used. Expected header: ${headerLine(window)}`,
        })
        return { ok: false, rows: [], issues, foundHeader: cells }
      }
      const want = JUDGED_HEADER[window]
      const missing = want.filter(c => !cells.includes(c))
      const extra = cells.filter(c => !(want as readonly string[]).includes(c))
      issues.push({
        kind: 'header-mismatch',
        message: `The table's header didn't match. `
          + (missing.length ? `Missing: ${missing.join(', ')}. ` : '')
          + (extra.length ? `Unexpected: ${extra.join(', ')}. ` : '')
          + `Expected exactly: ${headerLine(window)}`,
      })
      return { ok: false, rows: [], issues, foundHeader: cells }
    }
    issues.push({
      kind: 'no-header',
      message: `Couldn't find the table. Expected a row reading exactly: ${headerLine(window)}`,
    })
    return { ok: false, rows: [], issues }
  }

  const header = found.cells
  const col = (name: string) => header.indexOf(name)
  const keyCol = col(window === 'daily' ? 'session_id' : 'day')
  const out: JudgedRow[] = []
  const seen = new Set<string>()
  const expected = new Set(expectedKeys)

  for (let i = found.index + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r.some(c => c.trim() !== '')) continue
    if (r.length !== header.length) {
      issues.push({
        kind: 'row-shape',
        message: `A row had ${r.length} column(s) where ${header.length} were expected, so it `
          + `wasn't used: ${r.join(' | ').slice(0, 120)}`,
      })
      continue
    }
    const key = r[keyCol].trim()
    if (expected.size && !expected.has(key)) {
      issues.push({
        kind: 'unknown-key',
        message: `The reply judged "${key}", which isn't in this window's data. It wasn't used.`,
      })
      continue
    }
    if (seen.has(key)) {
      issues.push({
        kind: 'duplicate-key',
        message: `"${key}" was judged more than once; the first judgement was kept.`,
      })
      continue
    }
    seen.add(key)
    const row: JudgedRow = {
      key,
      phase: coerce(r[col('phase')], PHASE_VALUES, 'phase', key, issues),
      effort: coerce(r[col('effort')], EFFORT_VALUES, 'effort', key, issues),
      note: r[col('note')].trim(),
    }
    if (window !== 'daily') {
      row.momentum = coerce(r[col('momentum')], MOMENTUM_VALUES, 'momentum', key, issues)
    }
    out.push(row)
  }

  // §A9 — gaps are shown honestly, never fabricated.
  for (const k of expectedKeys) {
    if (!seen.has(k)) {
      issues.push({ kind: 'missing-key', message: `The reply didn't judge "${k}".` })
    }
  }
  return { ok: true, rows: out, issues, foundHeader: header }
}

/**
 * Scan a whole pasted reply for the judged table and validate it. Tries csv-tagged blocks first,
 * then untagged ones — but a block is only ACCEPTED if it validates, so trying more blocks can
 * never lower the bar.
 */
export function extractJudged(reply: string, opts: ValidateOpts): JudgedResult {
  const blocks = candidateCsvBlocks(reply)
  if (!blocks.length) {
    return {
      ok: false,
      rows: [],
      issues: [{
        kind: 'no-block',
        message: 'No fenced table found in that reply. Paste the whole reply, including the '
          + '```csv block.',
      }],
    }
  }
  let firstFailure: JudgedResult | null = null
  for (const b of blocks) {
    const res = validateJudgedRows(parseDelimited(b.text), opts)
    if (res.ok) {
      if (!b.closed) {
        res.issues.unshift({
          kind: 'truncated',
          message: 'That reply looks cut off — the table\'s closing ``` is missing, so the last '
            + 'rows may be incomplete. Check the end of the reply.',
        })
      }
      return res
    }
    if (!firstFailure) firstFailure = res
  }
  return firstFailure as JudgedResult
}
