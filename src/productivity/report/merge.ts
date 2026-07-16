// Merge — spec §A7.1.6, §A6.1.
//
// The merged model is the honesty core made structural. Measured and judged never share a field:
// every row carries `measured` (ground truth, computed on this device, never round-tripped) and
// an OPTIONAL `judged` (the model's interpretation, or null where it judged nothing). A renderer
// physically cannot mix them up by accident, and a row the model skipped is null — not zero, not
// a guess (§A9: gaps are shown honestly, not fabricated).

import type { DayAggregate, ReportWindow, SessionRow, WindowAggregate } from '../types'
import type { JudgedRow } from './judged'

/** One merged row: the measured record, plus what the AI made of it (if anything). */
export interface MergedRow<M> {
  /** session_id (daily) or day (weekly/monthly). */
  key: string
  /** MEASURED — Inkwave's own. Graph this as hard data. */
  measured: M
  /** JUDGED — the AI's assessment. Always label it as such; never plot it as a measured bar. */
  judged: JudgedRow | null
}

export interface MergedReport {
  window: ReportWindow
  from: string
  to: string
  /** Daily → one row per session. Weekly/monthly → one row per day. */
  rows: MergedRow<SessionRow | DayAggregate>[]
  /** Always the day rollups — the measured series the graphs draw, whatever the window. */
  days: DayAggregate[]
  /** Judged rows that matched nothing measured. Should be empty (judged.ts rejects unknown keys
   *  first); kept as a belt-and-braces signal rather than a silent drop. */
  orphanJudged: JudgedRow[]
}

/** The keys Inkwave asks the model to judge, in payload order. */
export function expectedKeys(agg: WindowAggregate): string[] {
  return agg.window === 'daily'
    ? agg.sessions.map(s => s.session_id)
    : agg.days.map(d => d.day)
}

/** Join measured rows to judged rows by key. Measured is the spine: a judged row can only ever
 *  attach to a measured row, never create one. */
export function mergeReport(agg: WindowAggregate, judged: JudgedRow[]): MergedReport {
  const byKey = new Map(judged.map(j => [j.key, j]))
  const used = new Set<string>()
  const base: { key: string; measured: SessionRow | DayAggregate }[] =
    agg.window === 'daily'
      ? agg.sessions.map(s => ({ key: s.session_id, measured: s }))
      : agg.days.map(d => ({ key: d.day, measured: d }))

  const rows = base.map(({ key, measured }) => {
    const j = byKey.get(key) ?? null
    if (j) used.add(key)
    return { key, measured, judged: j }
  })
  return {
    window: agg.window,
    from: agg.from,
    to: agg.to,
    rows,
    days: agg.days,
    orphanJudged: judged.filter(j => !used.has(j.key)),
  }
}
