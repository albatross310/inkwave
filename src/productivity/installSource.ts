// Install the REAL ledger as the report/graphs aggregate source (spec §A3.3).
//
// `source.ts` is the AI-report path's seam: until someone calls setAggregateSource, its panel
// honestly says the ledger isn't wired up. This is prod-ledger filling it in with measured data.
//
// GATED ON THE LEDGER FLAG, deliberately: with capture off there is no ledger, and a source that
// resolves to an empty window would make the panel claim "you did nothing" instead of "tracking is
// off" — a false statement dressed as a measurement. No source ⇒ the panel tells the truth.
// The demo source (`?prodReport=demo`) installs itself independently and is labelled synthetic;
// this never overwrites it.

import { loadWindowFromLedger } from './aggregate'
import { readDocument } from '../storage/opfs'
import { prodLedgerEnabled } from './ledgerFlag'
import { isoWithOffset, localDayOf } from './sessionLogic'
import { hasAggregateSource, setAggregateSource, setGoalsSource } from './source'

let installed = false

export function installLedgerSource(): void {
  if (installed || !prodLedgerEnabled()) return
  // Never clobber the labelled demo fixtures if they got there first.
  if (hasAggregateSource()) return
  installed = true
  const todayLocal = (): string => localDayOf(isoWithOffset(Date.now(), -new Date().getTimezoneOffset()))
  setAggregateSource(async (w) => loadWindowFromLedger(w, todayLocal()))
  // §A5b — goals are a DOCUMENT property (types/document.ts DocGoals), declared once by the report
  // lane and READ here. This lane authors them (the clock drop-up) and fills the seam; the report
  // owns the prompt and the tick-box. Reading straight from OPFS is race-free: the editor's own
  // autosave is what keeps the active document's copy current, so there is no second writer.
  setGoalsSource(async (docId) => {
    // DocRead is `found | absent | error` with no null member — an ERROR is not "no goal". A doc we
    // could not read must yield null (⇒ §A5b's honest branch: describe, don't push), never an
    // invented empty goal, and never a throw that takes the whole compile down.
    const read = await readDocument(docId)
    return read.kind === 'found' ? (read.doc.goals ?? null) : null
  })
}

/** Test seam. */
export function _resetInstallSource(): void {
  installed = false
}
