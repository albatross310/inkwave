// The measured writing-charts panel — build-spec §A3.3, §A6.2, §A8.
//
// WHAT THIS IS (Peter's words): the productivity charts / "progress tracking". It USED to be the
// `/productivity` ROUTE, gated behind `?prodGraphs`. Peter's ethos is "no routes, all panels" (the
// /music and /ledger routes were both retired for exactly this), so it is now a portalled, night-mode
// PANEL reached from the clock drop-up (the ledger surface). The route is gone; a stale bookmark
// falls through the catch-all to the editor.
//
// LOAD PATH (CLAUDE.md, sacred): this file, its charts and the fixtures are NEVER on the editor's
// eager graph. TiptapEditor imports it LAZILY (`lazy(() => import(...))`), and the fixtures are a
// dynamic import even from here. `scripts/prodLoadPath.prove.mjs` fails the build if the fixture prose
// or report strings regress onto the load path. The button that opens this lives in ClockMenu, which
// IS eager — so that button only calls a callback and imports nothing from this lane.
//
// THEMING (CLAUDE.md, mandatory): `iw-nightable` opts the surface into the themed palette; every
// custom colour is a token with a day fallback. `iw-touch-guard` keeps a tap here from blurring the
// contenteditable (iOS retracts the keyboard and the docked toolbar walks to the screen bottom).
//
// DATA: demo mode (`?prodGraphs=demo`) renders a LABELLED synthetic fixture ledger; otherwise it
// reads the writer's OWN ledger — the recent months' rows, aggregated CLIENT-SIDE (§A6.4: these
// numbers are measured ground truth and never round-trip through an LLM). A failed read is its OWN
// state, never "you did nothing" — the entry point (the clock drop-up) already requires session
// capture to be on, so an EMPTY ledger is honestly "nothing recorded yet", not "tracking is off".

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { aggregateLedger, monthsSpanning, type LedgerAggregates } from '../productivity/aggregate'
import { loadLedger } from '../productivity/ledgerStore'
import { prodGraphsDemo } from '../productivity/flag'
import { isoWithOffset, localDayOf } from '../productivity/sessionLogic'
import type { SessionRow } from '../productivity/types'
import { ProductivityPanel } from '../productivity/ProductivityPanel'

const muted = 'var(--iw-pill-fg, #78716c)'
const border = 'var(--iw-nightable-border, #e7e5e4)'

/** How many trailing calendar months of ledger to load — enough that the month view is real and a
 *  week straddling a month boundary is whole. Missing months read back empty; they never throw. */
const MONTHS_BACK = 2

/**
 * Load the writer's recent ledger rows. A missing month's ledger returns empty (never throws); a
 * genuinely FAILED read (corrupt/foreign file, storage error) throws out of `loadLedger` and is
 * surfaced by the caller as a read-failure state, never flattened into "no data".
 */
async function loadRecentRows(): Promise<SessionRow[]> {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const from = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`
  const today = localDayOf(isoWithOffset(Date.now(), -new Date().getTimezoneOffset()))
  const rows: SessionRow[] = []
  for (const month of monthsSpanning(from, today)) rows.push(...(await loadLedger(month)).rows)
  return rows
}

export function ProductivityGraphsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const demo = prodGraphsDemo()
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  // A failed read is its OWN state (the 2026-07-15 shape): collapsing it into "no rows" would tell
  // the writer they did nothing when the ledger exists and merely could not be read.
  const [readFailed, setReadFailed] = useState(false)

  useEffect(() => {
    let live = true
    setReadFailed(false)
    setSessions(null)
    void (async () => {
      try {
        if (demo) {
          // Dynamic even from this lazy chunk: the fixture prose must never ride the load path, and
          // `prodLoadPath.prove.mjs` fails the build if it does.
          const { makeSessionRows } = await import('../productivity/fixtures')
          if (live) setSessions(makeSessionRows())
        } else {
          const rows = await loadRecentRows()
          if (live) setSessions(rows)
        }
      } catch (err) {
        console.warn('[inkwave] could not read the ledger for the charts:', err)
        if (live) setReadFailed(true)
      }
    })()
    return () => { live = false }
  }, [demo])

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Pure and deterministic — recomputed only when the rows change.
  const aggregates = useMemo<LedgerAggregates | null>(
    () => (sessions ? aggregateLedger(sessions) : null),
    [sessions],
  )

  return createPortal(
    <>
      <div className="fixed inset-0 z-[130]" style={{ background: 'rgba(35,25,50,0.35)' }} aria-hidden="true" onMouseDown={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="Your writing in charts"
        // iw-nightable: themed surface. iw-touch-guard: taps here must not blur the editor on iOS.
        // iw-no-print: this is a live panel, not part of the printed document.
        className="iw-nightable iw-touch-guard iw-no-print fixed z-[131] overflow-y-auto font-serif"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(48rem, calc(100vw - 2rem))', maxHeight: 'calc(100vh - 3rem)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* The close affordance floats over the ProductivityPanel card (which owns its own chrome). */}
        <button
          type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-[1] leading-none px-1"
          style={{ fontSize: 22, color: muted, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ×
        </button>

        {readFailed ? (
          <div
            className="iw-nightable bg-white rounded-lg shadow-lg p-5 max-w-3xl mx-auto"
            style={{ border: `1px solid ${border}` }}
          >
            <p className="leading-relaxed text-sm" style={{ color: muted }}>
              Your writing record couldn&rsquo;t be read just now, so there&rsquo;s nothing to chart yet.
              Your records are still on this device — nothing has been changed or lost. Try again in a moment.
            </p>
          </div>
        ) : aggregates ? (
          <ProductivityPanel aggregates={aggregates} sessions={sessions ?? undefined} demo={demo} />
        ) : (
          <div
            className="iw-nightable bg-white rounded-lg shadow-lg p-5 max-w-3xl mx-auto"
            style={{ border: `1px solid ${border}` }}
          >
            <p className="text-center text-sm" style={{ color: muted }}>Reading your writing record…</p>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
