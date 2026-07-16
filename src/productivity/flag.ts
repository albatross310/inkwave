// The productivity-graphs feature flag — DEFAULT OFF.
//
// P1a-viz ships dark: the ledger that feeds it (`feat/prod-ledger`) and the AI half that overlays it
// (`feat/prod-ai-report`) land separately, and nothing here should reach a writer until all three
// agree. Off by default also means ZERO cost on the load path for everyone else (CLAUDE.md: load
// performance is sacred) — the panel and its aggregation are never imported unless asked for.
//
// STICKY URL FLAGS (the `?auth` / `?snapThumbs` pattern, and the round-8 lesson behind it): a flag
// read fresh from the URL dies the moment anything rewrites it, silently disabling the feature
// exactly when you started using it. Resolve ONCE per load, persist, then read from storage.
//   ?prodGraphs=1     on
//   ?prodGraphs=demo  on, with the synthetic fixture ledger (no real capture needed)
//   ?prodGraphs=off   clears both

const FLAG = 'inkwave:prodGraphs'
const DEMO_FLAG = 'inkwave:prodGraphsDemo'

let _flags: { on: boolean; demo: boolean } | null = null

function flags(): { on: boolean; demo: boolean } {
  if (_flags) return _flags
  let on = false, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get('prodGraphs')
    if (p === 'off') { window.localStorage.removeItem(FLAG); window.localStorage.removeItem(DEMO_FLAG) }
    else if (p === 'demo') { window.localStorage.setItem(FLAG, '1'); window.localStorage.setItem(DEMO_FLAG, '1') }
    else if (p === '1') window.localStorage.setItem(FLAG, '1')
    on = window.localStorage.getItem(FLAG) === '1'
    demo = window.localStorage.getItem(DEMO_FLAG) === '1'
  } catch { /* SSR/prerender or private mode → stays off */ }
  _flags = { on, demo }
  return _flags
}

/** Whether the productivity panel is available at all. Default OFF. */
export function prodGraphsEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwProdGraphs?: boolean }) : null
  if (w && typeof w.__iwProdGraphs === 'boolean') return w.__iwProdGraphs
  return flags().on
}

/**
 * `?prodGraphs=demo` — render from the synthetic fixture ledger instead of a real one.
 * This is how the panel is reviewable before `feat/prod-ledger` lands, and it is why no fixture in
 * this repo may ever contain real writing: demo mode puts fixture data on screen.
 */
export function prodGraphsDemo(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwProdGraphsDemo?: boolean }) : null
  if (w && typeof w.__iwProdGraphsDemo === 'boolean') return w.__iwProdGraphsDemo
  return flags().demo
}

/** Test-only: forget the resolved flags so a suite can re-resolve them. */
export function __resetFlagsForTest(): void { _flags = null }
