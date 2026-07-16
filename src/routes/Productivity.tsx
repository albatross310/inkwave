// `/productivity` — the report surface for the productivity layer (build-spec §A3.3, §A8).
//
// A ROUTE, not a footer popover: this is a multi-chart report over daily/weekly/monthly windows
// (§A6.2's "report windows"), the same shape as the app's existing `/verify` and `/snapshot`
// surfaces. It also keeps every line of this lane OUT of the editor's render tree, where CLAUDE.md's
// typing/load invariants live.
//
// FLAG-GATED, DEFAULT OFF (`?prodGraphs=1`, or `?prodGraphs=demo` for the fixture ledger). Off, the
// route renders a stub and — because the panel and its aggregation are behind a lazy import — none
// of this lane's code is fetched or parsed at all.

import { lazy, Suspense, useEffect, useState } from 'react'
import { prodGraphsDemo, prodGraphsEnabled } from '../productivity/flag'

const Report = lazy(() => import('../productivity/Report').then(m => ({ default: m.Report })))

export function Productivity() {
  const [state, setState] = useState<{ enabled: boolean; demo: boolean } | null>(null)

  // Flags resolve against localStorage/location, which don't exist during prerender — read them
  // after mount so the static shell and the hydrated page agree.
  useEffect(() => { setState({ enabled: prodGraphsEnabled(), demo: prodGraphsDemo() }) }, [])

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: 'var(--iw-paper, #fcfaf6)' }}>
      {state?.enabled ? (
        <Suspense fallback={<Loading />}>
          <Report demo={state.demo} />
        </Suspense>
      ) : state ? (
        <p className="text-center text-sm font-serif" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          The writing report isn’t switched on. Add <code>?prodGraphs=demo</code> to see it with sample data.
        </p>
      ) : null}
    </main>
  )
}

function Loading() {
  return (
    <p className="text-center text-sm font-serif" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
      Reading your writing record…
    </p>
  )
}
