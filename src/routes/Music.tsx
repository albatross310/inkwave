// `/music` — the music module's surface (build-spec §A1/§A2, build order step 1).
//
// A ROUTE, not editor chrome: it keeps every line of this lane OUT of the editor's render tree,
// where CLAUDE.md's typing and load invariants live. Same shape as `/productivity` and `/verify`.
//
// FLAG-GATED, DEFAULT OFF (`?music=1`, or `?music=demo` for a synthetic score). Off, the route
// renders a stub and — because the studio and its detector, pdf.js and canvas work are behind a lazy
// import — none of this lane's code is fetched or parsed at all.

import { lazy, Suspense, useEffect, useState } from 'react'
import { musicDemo, musicEnabled } from '../music/flag'

const MusicStudio = lazy(() => import('../music/MusicStudio').then(m => ({ default: m.MusicStudio })))

export function Music() {
  const [state, setState] = useState<{ enabled: boolean; demo: boolean } | null>(null)

  // Flags resolve against localStorage/location, which don't exist during prerender — read them
  // after mount so the static shell and the hydrated page agree.
  useEffect(() => { setState({ enabled: musicEnabled(), demo: musicDemo() }) }, [])

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: 'var(--iw-paper, #fcfaf6)' }}>
      {state?.enabled ? (
        <Suspense fallback={<Loading />}>
          <MusicStudio demo={state.demo} />
        </Suspense>
      ) : state ? (
        <p className="text-center font-serif" style={{ fontSize: 14, color: 'var(--iw-pill-fg, #78716c)' }}>
          The music module isn’t switched on. Add <code>?music=demo</code> to see it with a synthetic score.
        </p>
      ) : null}
    </main>
  )
}

function Loading() {
  return (
    <p className="text-center font-serif" style={{ fontSize: 14, color: 'var(--iw-pill-fg, #78716c)' }}>
      Opening your score…
    </p>
  )
}
