// Productivity-layer feature flags — ALL DEFAULT OFF.
//
// Two independent lanes ship dark and land separately, so they get independent flags: the measured
// graphs (`prodGraphs`, P1a-viz) and the AI report that overlays them (`prodReport`, P1c). The
// ledger that feeds both (`feat/prod-ledger`) lands separately again. Nothing here reaches a writer
// until the pieces agree — and off-by-default also means ZERO load-path cost for everyone else
// (CLAUDE.md: load performance is sacred), since neither panel is imported unless asked for.
//
// STICKY URL FLAGS (the `?auth` / `?snapThumbs` pattern, and the round-8 lesson behind it): a flag
// read fresh from the URL DIES the moment any local-first navigation rewrites it — which silently
// disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs round 8, bug 2).
// Resolve ONCE per load, persist, then read from storage. Don't reintroduce that bug.
//
//   ?prodGraphs=1     on          ?prodReport=1     on
//   ?prodGraphs=demo  on + demo   ?prodReport=demo  on + demo
//   ?prodGraphs=off   clears      ?prodReport=off   clears
//
// `demo` renders from a LABELLED synthetic fixture ledger — which is why no fixture in this repo may
// ever contain real writing: demo mode puts fixture data on screen. It is never silent.

type Pair = { on: boolean; demo: boolean }

function resolve(param: string, key: string, demoKey: string): Pair {
  let on = false, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get(param)
    if (p === 'off') {
      window.localStorage.removeItem(key)
      window.localStorage.removeItem(demoKey)
    } else if (p === 'demo') {
      window.localStorage.setItem(key, '1')
      window.localStorage.setItem(demoKey, '1')
    } else if (p === '1') {
      window.localStorage.setItem(key, '1')
      window.localStorage.removeItem(demoKey)
    }
    on = window.localStorage.getItem(key) === '1'
    demo = window.localStorage.getItem(demoKey) === '1'
  } catch { /* SSR/prerender or private mode → stays off */ }
  return { on, demo }
}

// ─── graphs (P1a-viz) ────────────────────────────────────────────────────────
let _graphs: Pair | null = null
function graphFlags(): Pair {
  if (!_graphs) _graphs = resolve('prodGraphs', 'inkwave:prodGraphs', 'inkwave:prodGraphsDemo')
  return _graphs
}

/** Whether the productivity panel is available at all. Default OFF. */
export function prodGraphsEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwProdGraphs?: boolean }) : null
  if (w && typeof w.__iwProdGraphs === 'boolean') return w.__iwProdGraphs
  return graphFlags().on
}

/** `?prodGraphs=demo` — render from the synthetic fixture ledger instead of a real one. */
export function prodGraphsDemo(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwProdGraphsDemo?: boolean }) : null
  if (w && typeof w.__iwProdGraphsDemo === 'boolean') return w.__iwProdGraphsDemo
  return graphFlags().demo
}

// ─── AI report (P1c) ─────────────────────────────────────────────────────────
let _report: Pair | null = null
function reportFlags(): Pair {
  if (!_report) _report = resolve('prodReport', 'inkwave:prodReport', 'inkwave:prodReportDemo')
  return _report
}

export function prodReportEnabled(): boolean { return reportFlags().on }

/** `?prodReport=demo` — synthetic ledger data, labelled as such in the panel. Never silent. */
export function prodReportDemo(): boolean { return reportFlags().demo }

// ─── test hooks ──────────────────────────────────────────────────────────────
/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetFlagsForTest(): void { _graphs = null; _report = null }
/** Tests only. Kept as the P1c lane's name for it. */
export function __resetProdReportFlag(): void { _report = null }
