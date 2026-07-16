// The paste-back round trip, end to end — spec §A7.1.3-6.
//
// One entry point: the writer pastes the whole reply, and this returns everything the panel
// needs to render an honest report — the narrative, the validated judged rows, the merged model,
// and every issue found along the way.

import type { WindowAggregate } from '../types'
import { extractJudged, type Issue, type JudgedResult } from './judged'
import { findCausalClaims, findUnverifiedNumbers, type CausalClaim } from './claims'
import { expectedKeys, mergeReport, type MergedReport } from './merge'

export interface ParsedReply {
  /** The markdown narrative, fenced blocks removed. Rendered as the AI's words, labelled. */
  narrative: string
  judged: JudgedResult
  /** Non-null only when a valid judged table was found. */
  merged: MergedReport | null
  /** §A6.2 — daily only. Empty at weekly+, where pattern claims are legitimate. */
  causalClaims: CausalClaim[]
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
}

export function parseReply(reply: string, opts: ParseOpts): ParsedReply {
  const { agg, payload } = opts
  const narrative = narrativeOf(reply)
  const judged = extractJudged(reply, { window: agg.window, expectedKeys: expectedKeys(agg) })
  return {
    narrative,
    judged,
    merged: judged.ok ? mergeReport(agg, judged.rows) : null,
    causalClaims: agg.window === 'daily' ? findCausalClaims(narrative) : [],
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
