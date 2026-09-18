// The measured graphs panel (P1a-viz) and the paste-back AI work report (P1c) ship LIVE — both
// graduated 2026-07-18 and the last of their flag plumbing came off 2026-09-18. Nothing gates
// either surface now.
//
// NAMED `flag.ts` next to `ledgerFlag.ts` on purpose, and the pair is still worth the warning: the
// LEDGER's own switch lives next door and is a real writer-facing setting (the clock menu's "turn
// off" button), not a flag. Two files, two unmistakable names.
//
// What is left here is the DEMO data switch for each panel, which is not a gate: it swaps in a
// synthetic fixture ledger so a screenshot or a probe never has to touch Peter's real measurements.
// Both panels LABEL demo data on their face. See flags/demoParam.ts.
import { demoParam } from '../flags/demoParam'

/** `?prodGraphs=demo` — render from the synthetic fixture ledger instead of a real one. */
export function prodGraphsDemo(): boolean { return demoParam('prodGraphs', 'inkwave:prodGraphsDemo', '__iwProdGraphsDemo') }

/** `?prodReport=demo` — synthetic ledger data, labelled as such in the panel. Never silent. */
export function prodReportDemo(): boolean { return demoParam('prodReport', 'inkwave:prodReportDemo') }
