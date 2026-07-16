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
import { prodLedgerEnabled } from './ledgerFlag'
import { isoWithOffset, localDayOf } from './sessionLogic'
import { hasAggregateSource, setAggregateSource } from './source'

let installed = false

export function installLedgerSource(): void {
  if (installed || !prodLedgerEnabled()) return
  // Never clobber the labelled demo fixtures if they got there first.
  if (hasAggregateSource()) return
  installed = true
  setAggregateSource(async (w) => {
    const today = localDayOf(isoWithOffset(Date.now(), -new Date().getTimezoneOffset()))
    return loadWindowFromLedger(w, today)
  })
}

/** Test seam. */
export function _resetInstallSource(): void {
  installed = false
}
