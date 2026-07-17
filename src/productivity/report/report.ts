// The paste-back round trip, end to end — spec §A7.1.3-6.
//
// One entry point: the writer pastes the whole reply, and this returns everything the panel
// needs to render an honest report — the narrative, the validated judged rows, the merged model,
// and every issue found along the way.

import type { WindowAggregate } from '../types'
import { extractJudged, type Issue, type JudgedResult } from './judged'
import {
  findCausalClaims, findPersonVerdicts, findUnverifiedNumbers,
  type CausalClaim, type PersonVerdict,
} from './claims'
import { expectedKeys, mergeReport, type MergedReport } from './merge'

export interface ParsedReply {
  /** The markdown narrative, fenced blocks removed. Rendered as the AI's words, labelled. */
  narrative: string
  judged: JudgedResult
  /** Non-null only when a valid judged table was found. */
  merged: MergedReport | null
  /**
   * §A6.2 — daily only. Empty at weekly+, where pattern claims are legitimate.
   *
   * NB daily now DESCRIBES co-occurrence deliberately (Peter, 2026-07-17: "I want correlations on
   * daily too. Just more brief") — the markers still fire only on CAUSE and GENERALISATION, which
   * one day still cannot support. "After your 3pm break you wrote for forty minutes" trips
   * nothing; "the break helped" does.
   */
  causalClaims: CausalClaim[]
  /** §A5 — sentences that judge the WRITER rather than the week. Every window. */
  personVerdicts: PersonVerdict[]
  /** §A6.4 — numerals in the narrative that Inkwave never sent. */
  unverifiedNumbers: string[]
}

/** Strip fenced blocks; the judged table is data, not prose, and must not be read as either. */
function narrativeOf(reply: string): string {
  return reply
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, '')
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, '')   // an unclosed (truncated) block
    .trim()
}

export interface ParseOpts {
  agg: WindowAggregate
  /** The compiled payload text that was copied — the allow-list for the number check. */
  payload: string
  /**
   * Whether document text went out (§A7.3). Decides which judged header is expected and whether
   * a quality/insight verdict is admissible at all (§A6.1). Pass `CompiledPayload.contentIncluded`
   * — the SAME value the payload was built from, so the reply is judged against what was actually
   * sent rather than against what the panel currently has ticked.
   */
  contentIncluded?: boolean
  /**
   * The CSV pasted on its own, from the AI's copy-code button. Optional — the whole reply in
   * `reply` still works.
   */
  table?: string
}

/**
 * Parse what the writer pasted back.
 *
 * TWO PASTE TARGETS (Peter, 2026-07-17: "it also needs to incorporate a 'copy the report back'
 * and 'copy the csv back' into the same window"). Both are optional and either alone works:
 *   • `reply`  — the report. May be the WHOLE reply (fenced ```csv and all), which is the old
 *                single-box behaviour and still the path if he only pastes once.
 *   • `table`  — the CSV alone, from the AI's copy-code button. NO FENCE, because that is what
 *                the button puts on the clipboard — hence `allowUnfenced` for this box only.
 * `table` WINS when it parses, because a writer who deliberately pasted the table meant that one;
 * if it fails we fall back to scanning `reply`, so pasting the whole thing into the first box and
 * nothing into the second still works exactly as before.
 */
export function parseReply(reply: string, opts: ParseOpts): ParsedReply {
  const { agg, payload } = opts
  const narrative = narrativeOf(reply)
  const validate = {
    window: agg.window,
    expectedKeys: expectedKeys(agg),
    contentIncluded: opts.contentIncluded ?? false,
  }
  const pastedTable = (opts.table ?? '').trim()
  const fromTable = pastedTable
    ? extractJudged(pastedTable, { ...validate, allowUnfenced: true })
    : null
  // Only fall back when the table box was empty or unreadable — never silently prefer a stale
  // fenced block over a table the writer explicitly pasted (§A9: its failure must be the one
  // reported, or they'd be debugging the wrong box).
  const judged = fromTable?.ok
    ? fromTable
    : (reply.trim() ? extractJudged(reply, validate) : (fromTable ?? extractJudged('', validate)))
  return {
    narrative,
    judged,
    merged: judged.ok ? mergeReport(agg, judged.rows) : null,
    causalClaims: agg.window === 'daily' ? findCausalClaims(narrative) : [],
    personVerdicts: findPersonVerdicts(narrative),
    unverifiedNumbers: findUnverifiedNumbers(narrative, payload),
  }
}

/** The graceful failure message (§A7.1.5 / §A9) — always paired with the expected format. */
export function failureHelp(judged: JudgedResult, headerLine: string): string {
  const first = judged.issues[0]
  return [
    first ? first.message : 'Couldn\'t read the table in that reply.',
    '',
    'Paste the FULL reply, including the fenced block. Inkwave is looking for:',
    '',
    '```csv',
    headerLine,
    '…one row per item, judged fields only',
    '```',
  ].join('\n')
}

/** Every issue, deduped by message — the panel lists these; nothing is dropped in silence. */
export function allIssues(parsed: ParsedReply): Issue[] {
  const seen = new Set<string>()
  return parsed.judged.issues.filter(i => !seen.has(i.message) && seen.add(i.message))
}
