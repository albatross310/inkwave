// The data source for the productivity report — everything below the flag gate.
//
// Split from the route so the route stays a thin, eagerly-loaded stub and ALL of this lane's code
// (aggregation, charts, fixtures) sits in one lazy chunk that is never fetched unless the flag is
// on. Default-OFF then costs nothing at all, which is the point (CLAUDE.md: load performance).

import { useEffect, useMemo, useState } from 'react'
import { aggregateLedger } from './aggregate'
import type { JudgedReport } from './judged'
import type { LedgerSession } from './ledger'
import { ProductivityPanel } from './ProductivityPanel'

export function Report({ demo }: { demo: boolean }) {
  const [sessions, setSessions] = useState<LedgerSession[] | null>(null)
  const [judged, setJudged] = useState<JudgedReport | undefined>()

  useEffect(() => {
    let live = true
    void (async () => {
      const { makeJudgedReport, makeLedgerSessions } = await import('./fixtures')
      if (!live) return

      // ─── THE LEDGER SEAM ───────────────────────────────────────────────────
      // The real per-month ledger (§A3.1) is owned by the `feat/prod-ledger` lane and does not
      // exist yet. When it lands, THIS is the line that changes — read its rows here instead of the
      // fixtures. Everything downstream (aggregation, charts, the honesty gate) already builds
      // against the spec'd §A3.2 row shape and needs no edit.
      const rows = makeLedgerSessions()
      setSessions(rows)

      // The AI half (§A6.1) is owned by `feat/prod-ai-report`. In demo mode we render a synthetic
      // one so the measured/judged seam and the §A6.2 gate are visible rather than theoretical.
      setJudged(demo ? makeJudgedReport(rows) : undefined)
    })()
    return () => { live = false }
  }, [demo])

  // Pure and deterministic — recomputed only when the ledger changes, never per render, and never
  // on the load path (§A6.4: these numbers are ground truth and are computed HERE, client-side).
  const aggregates = useMemo(() => (sessions ? aggregateLedger(sessions) : null), [sessions])

  if (!aggregates) {
    return (
      <p className="text-center text-sm font-serif" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        Reading your writing record…
      </p>
    )
  }
  return <ProductivityPanel aggregates={aggregates} sessions={sessions ?? undefined} judged={judged} demo={demo} />
}
