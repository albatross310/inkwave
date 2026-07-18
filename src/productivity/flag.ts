// Productivity-layer feature flags.
//
// Two independent lanes: the AI work report (`prodReport`, P1c) and the measured graphs
// (`prodGraphs`, P1a-viz).
//
//   • `prodReport` — DEFAULT ON (Peter, 2026-07-18: "take all the flags off … for everything";
//     CLAUDE.md "STOP FLAGGING EVERYTHING"). The free paste-back report (§A7.1 Path 1) is finished
//     and usable without a backend, so a writer sees it. `?prodReport=off` is a sticky opt-out.
//   • `prodGraphs` — DEFAULT ON (2026-07-18, feat/prodgraphs-panel). It USED to be default OFF for one
//     reason only: its sole caller was the `/productivity` ROUTE, and Peter's ethos is "no routes, all
//     panels" (the /music and /ledger routes were both retired for exactly this reason), so shipping it
//     meant shipping a route. That reason is GONE — the charts are now a portalled night-mode PANEL
//     reachable from the clock drop-up (the ledger surface), the `/productivity` route is retired, and
//     `prodGraphsEnabled()` is read on `/` to decide whether the drop-up offers the charts button. A
//     finished, backend-free measured-charts view over the writer's own ledger, so a writer sees it.
//     `?prodGraphs=off` is a sticky opt-out.
//
// ─── LOAD-PATH COST: ~760 B gzip, NOT ZERO. THE CLAIM HERE USED TO BE FALSE. ─────────────────────
// This comment previously read "off-by-default also means ZERO load-path cost for everyone else …
// since neither panel is imported unless asked for". It was measured FALSE in the built output on
// 2026-07-17 (`scripts/prodLoadPath.prove.mjs`): TiptapEditor.tsx STATICALLY imported
// ProductivityReportModal and productivity/demo, so the modal, report/compile.ts's prompt strings
// and fixtures.ts's synthetic prose were inlined into / preloaded alongside the editor chunk — the
// one every writer loads — for a measured 16.0 KB gzip with every flag off. `{reportOpen && …}` and
// `if (reportFlag) …` are RENDER and RUNTIME guards; NEITHER CAN STOP THE BUNDLER. The imports are
// dynamic now and the probe fails the build if they regress.
//
// With prodReport now DEFAULT ON, one thing changed: the demo import in TiptapEditor is gated on
// DEMO MODE (`prodReportDemo()`), not on the report flag — otherwise the demo/fixtures chunk would be
// fetched at runtime for every writer even though installProdReportDemo() no-ops outside demo mode.
// The heavy modal stays lazily imported, so the STATIC eager set (what prodLoadPath.prove.mjs
// measures) is unchanged.
//
// STICKY URL FLAGS (the `?auth` / `?snapThumbs` pattern, and the round-8 lesson behind it): a flag
// read fresh from the URL DIES the moment any local-first navigation rewrites it — which silently
// disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs round 8, bug 2).
// Resolve ONCE per load, persist, then read from storage. Don't reintroduce that bug.
//
//   prodGraphs (default ON)             prodReport (default ON)
//   ?prodGraphs=off   off (sticky '0')  ?prodReport=off   off (sticky, writes '0')
//   ?prodGraphs=1     on (clears '0')   ?prodReport=1     on (clears a prior opt-out)
//   ?prodGraphs=demo  on + demo         ?prodReport=demo  on + demo
//
// `demo` renders from a LABELLED synthetic fixture ledger — which is why no fixture in this repo may
// ever contain real writing: demo mode puts fixture data on screen. It is never silent.

type Pair = { on: boolean; demo: boolean }

// `defaultOn` inverts the reader and the off-path: an off-by-default flag is present-means-on
// (`=== '1'`, `off` → absence); an on-by-default flag is absent-means-on (`!== '0'`, `off` → a
// STICKY '0', because with the default ON removeItem would silently re-enable it).
function resolve(param: string, key: string, demoKey: string, defaultOn: boolean): Pair {
  let on = defaultOn, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get(param)
    if (p === 'off') {
      if (defaultOn) window.localStorage.setItem(key, '0') // explicit, sticky opt-out
      else window.localStorage.removeItem(key)
      window.localStorage.removeItem(demoKey)
    } else if (p === 'demo') {
      window.localStorage.setItem(key, '1')
      window.localStorage.setItem(demoKey, '1')
    } else if (p === '1') {
      window.localStorage.setItem(key, '1')
      window.localStorage.removeItem(demoKey)
    }
    on = defaultOn ? window.localStorage.getItem(key) !== '0' : window.localStorage.getItem(key) === '1'
    demo = window.localStorage.getItem(demoKey) === '1'
  } catch { /* SSR/prerender or private mode → stays at defaultOn */ }
  return { on, demo }
}

// ─── graphs (P1a-viz) ────────────────────────────────────────────────────────
let _graphs: Pair | null = null
function graphFlags(): Pair {
  // DEFAULT ON — a panel now, not a route (see the header). `?prodGraphs=off` is a sticky '0'.
  if (!_graphs) _graphs = resolve('prodGraphs', 'inkwave:prodGraphs', 'inkwave:prodGraphsDemo', true)
  return _graphs
}

/** Whether the productivity charts panel is available at all. Default ON. */
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
  // DEFAULT ON (2026-07-18) — finished, backend-free paste-back report.
  if (!_report) _report = resolve('prodReport', 'inkwave:prodReport', 'inkwave:prodReportDemo', true)
  return _report
}

export function prodReportEnabled(): boolean { return reportFlags().on }

/** `?prodReport=demo` — synthetic ledger data, labelled as such in the panel. Never silent. */
export function prodReportDemo(): boolean { return reportFlags().demo }

/** The escape hatch: `false` writes a STICKY '0' (not an absence), matching `?prodReport=off`. */
export function setProdReportEnabled(on: boolean): void {
  try {
    window.localStorage.setItem('inkwave:prodReport', on ? '1' : '0')
    if (!on) window.localStorage.removeItem('inkwave:prodReportDemo')
  } catch { /* private mode — flag stays session-only via _report */ }
  _report = { on, demo: on ? (_report?.demo ?? false) : false }
}

// ─── test hooks ──────────────────────────────────────────────────────────────
/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetFlagsForTest(): void { _graphs = null; _report = null }
/** Tests only. Kept as the P1c lane's name for it. */
export function __resetProdReportFlag(): void { _report = null }
