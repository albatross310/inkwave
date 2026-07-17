// `?prodReport=demo` — install the synthetic ledger so the report path can be driven end to end
// before `feat/prod-ledger` lands.
//
// WHY THIS EXISTS AND WHY IT IS SAFE: a flag-gated feature with no data source is a feature
// nobody can look at, and CLAUDE.md's house disease is precisely features that silently do
// nothing while looking fine. So the demo makes the path drivable. It is honest by construction:
//   • It only installs under `?prodReport=demo` — never on the real flag, never by default.
//   • The panel renders a permanent "synthetic sample data, not your work" banner whenever
//     prodReportDemo() is true, so demo numbers can never be mistaken for measured ones.
//   • The fixtures are wholly invented (see fixtures.ts).
// Without the flag, loadWindow() returns null and the panel says the ledger isn't wired up yet.

import { setAggregateSource, setContentSource, setGoalsSource, setSnapshotSource } from './source'
import { DEMO_GOALS, DEMO_SNAPSHOTS, DEMO_TEXT, fixtureWindow } from './fixtures'
import { prodReportDemo } from './flag'

let installed = false

export function installProdReportDemo(): void {
  if (installed || !prodReportDemo()) return
  installed = true
  setAggregateSource(async w => fixtureWindow(w))
  setContentSource(async id => DEMO_TEXT[id] ?? '')
  setSnapshotSource(async id => DEMO_SNAPSHOTS[id] ?? [])
  setGoalsSource(async id => DEMO_GOALS[id] ?? null)
}
