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
//   prodGraphs (default ON)             prodReport (default ON)
//   ?prodGraphs=off   off (sticky '0')  ?prodReport=off   off (sticky, writes '0')
//   ?prodGraphs=1     on (clears '0')   ?prodReport=1     on (clears a prior opt-out)
//   ?prodGraphs=demo  on + demo         ?prodReport=demo  on + demo
//
// `demo` renders from a LABELLED synthetic fixture ledger — which is why no fixture in this repo may
// ever contain real writing: demo mode puts fixture data on screen. It is never silent.
//
// ─── ONE DIFFERENCE BETWEEN THE TWO LANES, PRESERVED DELIBERATELY ────────────────────────────
// `prodGraphs` honours `window.__iwProdGraphs` / `__iwProdGraphsDemo`; `prodReport` honours no
// global at all. Same file, same resolver, different surface — the graphs lane wanted an A/B seam
// for its probes and the report lane never did. Giving prodReport one here would be adding a live
// override with no consumer, which is the thing this repo refuses to do; it is left absent and
// pinned by a test so its absence stays a decision rather than an oversight.
import { stickyFlag } from '../flags/stickyFlag'

// ─── graphs (P1a-viz) ────────────────────────────────────────────────────────
const graphs = stickyFlag({
  key: 'inkwave:prodGraphs',
  param: 'prodGraphs',
  defaultOn: true,
  companionKey: 'inkwave:prodGraphsDemo',
  override: '__iwProdGraphs',
  companionOverride: '__iwProdGraphsDemo',
})

/** Whether the productivity charts panel is available at all. Default ON. */
export function prodGraphsEnabled(): boolean { return graphs.enabled() }

/** `?prodGraphs=demo` — render from the synthetic fixture ledger instead of a real one. */
export function prodGraphsDemo(): boolean { return graphs.demo() }

// ─── AI report (P1c) ─────────────────────────────────────────────────────────
const report = stickyFlag({
  key: 'inkwave:prodReport',
  param: 'prodReport',
  defaultOn: true,
  companionKey: 'inkwave:prodReportDemo',
})

export function prodReportEnabled(): boolean { return report.enabled() }

/** `?prodReport=demo` — synthetic ledger data, labelled as such in the panel. Never silent. */
export function prodReportDemo(): boolean { return report.demo() }

/** The escape hatch: `false` writes a STICKY '0' (not an absence), matching `?prodReport=off`. */
export function setProdReportEnabled(on: boolean): void { report.set(on) }

// ─── test hooks ──────────────────────────────────────────────────────────────
/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetFlagsForTest(): void { graphs.reset(); report.reset() }
/** Tests only. Kept as the P1c lane's name for it. */
export function __resetProdReportFlag(): void { report.reset() }
