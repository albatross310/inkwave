// The transparent prompt — spec §A7.1.2.
//
// The payload the writer copies has two halves:
//   1. A FIXED first half, generated here and shown VERBATIM in the export panel before it is
//      copied. The writer must be able to see exactly what Inkwave asks their AI to do. It is
//      the same text every time for a given window/content choice — no hidden steering.
//   2. An OPTIONAL user-written second half, layered over sensible defaults so that most
//      writers never write a prompt at all.
//
// Three of the spec's hard rules are baked into the fixed half, and NONE of them is trusted to
// the prompt alone — a prompt is a request, not a guarantee, so each is also enforced on the
// reply, client-side:
//   • §A5/§C3 kind, non-shaming        → asked here; not machine-enforced (see report.ts notes)
//   • §A6.2 statistical honesty        → asked here; enforced by claims.ts on daily replies
//   • §A6.4 never round-trip measured  → asked here; enforced by judged.ts (measured columns are
//                                        REJECTED) and claims.ts (invented numbers are flagged)

import type { ReportWindow } from '../types'

// ─── The judged schema (§A7.1.4) ────────────────────────────────────────────────────────────
// Rows are sessions (daily) or days (weekly/monthly), per the spec's "rows = sessions/days".
// These are JUDGED columns only: every one of them is something the client cannot compute.

/** The exact first line the model must emit in its ```csv block, per window. */
export const JUDGED_HEADER: Record<ReportWindow, readonly string[]> = {
  daily: ['session_id', 'phase', 'effort', 'note'],
  weekly: ['day', 'phase', 'effort', 'momentum', 'note'],
  monthly: ['day', 'phase', 'effort', 'momentum', 'note'],
}

export const PHASE_VALUES = ['deep', 'shallow', 'mixed', 'unclear'] as const
export const EFFORT_VALUES = ['light', 'steady', 'intense', 'unclear'] as const
export const MOMENTUM_VALUES = ['building', 'holding', 'easing', 'unclear'] as const

export function headerLine(window: ReportWindow): string {
  return JUDGED_HEADER[window].join(',')
}

// ─── The fixed half ─────────────────────────────────────────────────────────────────────────

export interface FixedPromptOpts {
  window: ReportWindow
  /** True when the writer ticked content for at least one document (§A7.3). */
  contentIncluded: boolean
  /** True when the writer opted into their diary notes + place labels (tier 2). */
  notesIncluded?: boolean
}

/** §A6.2 — daily is a descriptive recap; pattern claims are permitted only at weekly+. */
function claimRules(window: ReportWindow): string {
  if (window === 'daily') {
    return [
      'WHAT YOU MAY CLAIM — this is a SINGLE DAY',
      '',
      'One day is statistically noise, so describe, do not explain. Recap what the day looked',
      'like. Do not claim that anything caused, drove, helped or hurt anything else. Do not name',
      'a best or worst time of day. Do not assert habits, patterns, trends or correlations — one',
      'day cannot show one. If you are tempted to write "the break helped", write what happened',
      'and leave the cause alone. Inkwave scans daily replies for causal and pattern language and',
      'flags it to the writer rather than presenting it as a finding.',
    ].join('\n')
  }
  const span = window === 'weekly' ? 'week' : 'month'
  return [
    `WHAT YOU MAY CLAIM — this is a ${span.toUpperCase()}`,
    '',
    `A ${span} holds enough sessions to support genuine pattern claims — breaks and output, time`,
    'of day, drafting versus editing — so make them where the data actually shows them, and say',
    'plainly when it does not. Two data points are not a pattern; do not manufacture one. Where',
    'days are missing they are gaps, not zeros: say so rather than filling them in. Prefer',
    '"you tended to" over "you always"; keep the strength of the claim inside the strength of',
    'the evidence.',
  ].join('\n')
}

function columnDoc(window: ReportWindow): string {
  const keyCol = window === 'daily'
    ? '  session_id  Copy verbatim from the session table below. One row per session, no others.'
    : '  day         Copy verbatim from the day table below (YYYY-MM-DD). One row per day present.'
  const momentum = window === 'daily'
    ? ''
    : '\n  momentum    building | holding | easing | unclear — where this day sat in the window\'s arc.'
  return [
    keyCol,
    '  phase       deep | shallow | mixed | unclear — the kind of attention the work suggests.',
    '  effort      light | steady | intense | unclear — how hard it reads, NOT how good it is.',
  ].join('\n') + momentum + [
    '',
    '  note        A short kind sentence, 140 characters or fewer. Quote it if it contains a comma.',
  ].join('\n')
}

/**
 * The exact fixed first half of the payload. Shown verbatim to the writer before it is copied
 * — if you change this text, the panel shows the change; there is no second, hidden copy.
 */
export function fixedPrompt(opts: FixedPromptOpts): string {
  const { window, contentIncluded, notesIncluded } = opts
  const parts: string[] = [
    'You are helping a writer reflect on how they worked. Inkwave, a local-first writing app,',
    'compiled the data below from the work ledger on their own device. The writer is running this',
    'in their own AI session and pasting your reply back; Inkwave itself sends nothing.',
    '',
    'HOW TO REPLY',
    '',
    'Reply with exactly two things, in this order:',
    '  1. A markdown narrative under the heading "## Narrative".',
    '  2. One fenced CSV block tagged ```csv, holding your judged fields and nothing else.',
    '',
    'TONE — a hard rule, not a preference',
    '',
    'Be kind, warm and reflective. This is a closing reflection, not a report card. A low-output',
    'day is a lighter day and must read as understanding — "a lighter day: forty focused minutes',
    'on the introduction" — never as a scolding, a warning, or a deficit to be corrected. Do not',
    'score, rank or grade the writer, and do not compare them to anyone. Avoid the vocabulary of',
    'productivity guilt entirely: "only", "just", "failed to", "should have", "fell short",',
    '"wasted", "unproductive". Thinking-heavy days with few words are real work; deleting and',
    'restructuring are writing. If the data looks thin, the honest and kind reading is usually',
    'that the day was thin, not that the writer was.',
    '',
    claimRules(window),
    '',
    'NUMBERS — do not restate them',
    '',
    'Inkwave already holds the measured numbers and graphs them itself; they are exact, and they',
    'are the thing it is trusted for. Do not put any measured number in the CSV. Do not recompute,',
    'total, average, round, tidy or estimate one anywhere. In the narrative, use a number only if',
    'it appears verbatim in the data below. Inkwave flags every number in your reply that it',
    'cannot find in what it sent you, so an invented one will be visible.',
    '',
    'THE CSV — judged fields only',
    '',
    'Emit exactly one ```csv block. Its first line must be exactly:',
    '',
    `  ${headerLine(window)}`,
    '',
    columnDoc(window),
    '',
    'Nothing else belongs in the block: no measured columns, no totals row, no commentary, no',
    'blank trailing columns. Judge every row the table below lists, and no rows it does not. If a',
    'row genuinely cannot be judged, write "unclear" rather than guessing.',
  ]
  if (notesIncluded) {
    parts.push(
      '',
      'THE WRITER\'S NOTES',
      '',
      'The writer has chosen to include their own end-of-session diary lines, and the place they',
      'typed for each. These are their words about their own day: treat them as context for how',
      'the work felt, and let them soften the reading rather than sharpen it. A note saying the',
      'day was hard is the writer telling you something true. Do not grade a note, do not turn one',
      'into a task list, and do not read a place label as anything more than a word they typed.',
    )
  }
  if (contentIncluded) {
    parts.push(
      '',
      'DOCUMENT TEXT',
      '',
      'The writer has chosen to include the text of some documents, marked below. Use it to speak',
      'to what the writing is doing — its structure, its argument, where it got to. Do not quote it',
      'back at length, do not critique its worth, and do not treat it as an assignment to mark.',
    )
  }
  return parts.join('\n')
}

// ─── The optional user half ─────────────────────────────────────────────────────────────────

/**
 * The default second half. Most writers never touch the prompt, so the defaults have to carry
 * them: this is what a good, plain request looks like, and it is pre-filled and editable.
 */
export const DEFAULT_USER_PROMPT =
  'Keep it brief — a few short paragraphs. Speak to me directly, in plain language.'

export interface AssembleOpts extends FixedPromptOpts {
  /** The writer's own words. Empty/whitespace → the section is omitted entirely. */
  userPrompt?: string
  /** The compiled data section (rollups; and document text if ticked). */
  data: string
}

/** Fixed half + optional user half + data, in that order. */
export function assemblePrompt(opts: AssembleOpts): string {
  const user = (opts.userPrompt ?? '').trim()
  const blocks = [fixedPrompt(opts)]
  if (user) {
    blocks.push(
      [
        'WHAT THE WRITER ASKED FOR',
        '',
        'The writer added this. Follow it where it does not conflict with the rules above; where it',
        'does, the rules above win.',
        '',
        user,
      ].join('\n'),
    )
  }
  blocks.push(opts.data)
  return blocks.join('\n\n' + '─'.repeat(78) + '\n\n')
}
