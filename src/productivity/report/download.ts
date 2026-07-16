// "Download .md / .csv" — spec §A7.1.6. The buttons exist to reinforce that the data is the
// writer's to keep, so the files are self-explanatory on their own, away from the app.
//
// CSV over JSON is deliberate (§A7.1.4): the data is flat, and the writer can open it in Excel.
// The measured/judged split (§A6.1) survives the export: every judged column is PREFIXED
// `judged_`, so a column in a spreadsheet still says which of the two things it is. A blank
// judged cell means the AI judged nothing — not zero.

import type { DayAggregate, SessionRow } from '../types'
import type { MergedReport } from './merge'
import type { ParsedReply } from './report'

function esc(v: string | number | boolean): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function row(cells: (string | number | boolean)[]): string {
  return cells.map(esc).join(',')
}

// `place` and `note` are the writer's own words. They are in the DOWNLOAD — this file never
// leaves the device, and the whole point of the button is that the data is theirs to keep — but
// they only reach a PAYLOAD behind tier 2's tick (compile.ts). Different direction, different
// rule. `note` here is the writer's diary line; the model's is `judged_note`.
const SESSION_COLS: (keyof SessionRow)[] = [
  'session_id', 'doc_id', 'doc_label', 'start', 'end', 'active_minutes', 'words_start',
  'words_end', 'words_added', 'words_deleted', 'net_words', 'edit_events', 'break_before_min',
  'pomodoro', 'doc_type', 'place', 'note',
]
const DAY_COLS: (keyof DayAggregate)[] = [
  'day', 'active_minutes', 'session_count', 'words_added', 'words_deleted', 'net_words',
  'edit_events', 'break_count', 'break_total_min', 'deep_shallow_ratio',
]

/** The merged table: measured columns as measured, judged columns prefixed and clearly the AI's. */
export function toCsv(merged: MergedReport): string {
  const daily = merged.window === 'daily'
  const measuredCols = (daily ? SESSION_COLS : DAY_COLS) as string[]
  const judgedCols = daily
    ? ['judged_phase', 'judged_effort', 'judged_note']
    : ['judged_phase', 'judged_effort', 'judged_momentum', 'judged_note']

  const lines = [row([...measuredCols, ...judgedCols])]
  for (const r of merged.rows) {
    const m = r.measured as unknown as Record<string, string | number | boolean | undefined>
    const measured = measuredCols.map(c => m[c] ?? '')
    const j = r.judged
    const judged = daily
      ? [j?.phase ?? '', j?.effort ?? '', j?.note ?? '']
      : [j?.phase ?? '', j?.effort ?? '', j?.momentum ?? '', j?.note ?? '']
    lines.push(row([...measured, ...judged]))
  }
  return lines.join('\n') + '\n'
}

const WINDOW_TITLE = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const

/** The whole report as markdown — narrative, measured table, judged table, and the caveats. */
export function toMarkdown(parsed: ParsedReply): string {
  const m = parsed.merged
  const out: string[] = []
  const title = m ? WINDOW_TITLE[m.window] : 'Report'
  out.push(`# Inkwave — ${title} report`)
  if (m) out.push('', `${m.from} to ${m.to}`)
  out.push(
    '',
    '> Measured figures are Inkwave\'s own, computed on this device from your work ledger.',
    '> Anything marked AI ASSESSMENT is an interpretation written by the AI you ran this in —',
    '> it is not a measurement.',
  )

  out.push('', '## Narrative — AI ASSESSMENT', '', parsed.narrative || '_(no narrative)_')

  if (parsed.causalClaims.length) {
    out.push(
      '',
      '### Flagged in this narrative',
      '',
      'This is a single day, which cannot show a pattern or a cause. Inkwave flagged these '
      + 'sentences for claiming one:',
      '',
      ...parsed.causalClaims.map(c => `- ("${c.marker}") ${c.sentence}`),
    )
  }
  if (parsed.unverifiedNumbers.length) {
    out.push(
      '',
      '### Numbers Inkwave couldn\'t confirm',
      '',
      'These numerals appear in the narrative but not in the data Inkwave sent, so it cannot '
      + `vouch for them: ${parsed.unverifiedNumbers.join(', ')}.`,
    )
  }

  if (m) {
    const daily = m.window === 'daily'
    out.push('', `## ${daily ? 'Sessions' : 'Days'} — MEASURED, with AI assessment alongside`, '')
    const cols = daily
      ? ['session_id', 'active_minutes', 'net_words', 'AI phase', 'AI effort', 'AI note']
      : ['day', 'active_minutes', 'net_words', 'AI phase', 'AI effort', 'AI note']
    out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`)
    for (const r of m.rows) {
      const mm = r.measured as unknown as Record<string, string | number>
      const j = r.judged
      out.push(`| ${[
        r.key, mm.active_minutes, mm.net_words,
        j?.phase ?? '—', j?.effort ?? '—', (j?.note ?? '—').replace(/\|/g, '\\|'),
      ].join(' | ')} |`)
    }
    const unjudged = m.rows.filter(r => !r.judged).length
    if (unjudged) {
      out.push('', `_${unjudged} row(s) the AI didn't judge are shown with — rather than a guess._`)
    }
  }
  return out.join('\n') + '\n'
}

/** Trigger a download. Kept here so the panel stays declarative. */
export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
