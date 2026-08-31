// Feature flag for session capture + the ledger — DEFAULT ON (Peter, 2026-07-18: "take all the
// flags off for music and everything"; CLAUDE.md "STOP FLAGGING EVERYTHING — FINISHED FEATURES SHIP
// LIVE"). This is the main productivity surface: the clock drop-up, the countdown overlay, session
// capture, the ledger, goals and reflection. It is finished and tested, so a writer sees it.
//
// NAMED `ledgerFlag`, not `flags`, on purpose: `flag.ts` next door is the AI REPORT's flag, and a
// `flag.ts`/`flags.ts` pair in one directory is how someone imports the wrong feature and never
// notices. Two features, two flags, two unmistakable names.
//
//   (nothing)        on — the default
//   ?prodLedger=off  off — an EXPLICIT, sticky opt-out (writes '0', not an absence)
//   ?prodLedger=1    on — clears a prior opt-out
//
// The OFF state is a STICKY '0', never an absence: with the default ON, `removeItem` would mean
// "back to on", so a genuine opt-out has to be written down. `setProdLedgerEnabled(false)` and the
// clock menu's own "turn off" button both write '0'. The shared core derives that from `defaultOn`.
//
// The resolved value is CACHED, because this gate sits on the editor's per-keystroke path and
// `localStorage.getItem` per keystroke is itself a typing cost. Measured at 0.07µs/keystroke when
// off (capture.perf.test.ts); ON now means session capture RUNS, but record() is proven O(steps)
// not O(doc), so the default flip adds no keystroke cost.
//
// ─── `onFault: false` IS THE ONE FIELD THAT ARGUES WITH ITS NEIGHBOURS ───────────────────────
// Every other default-ON flag in the repo — music, liveFrame, textRender, prodGraphs, prodReport —
// falls back to its default (ON) when storage is denied, reasoning that a writer in a private
// window should get the feature rather than a silent downgrade. This one falls to OFF on the same
// fault, and on SSR/prerender/node, because it reasons the other way: capture must never run where
// we cannot read the writer's choice. Both arguments are right for their own flag. That is exactly
// why it is a named field here and not a shared assumption — a single fallback rule would have
// silently picked one of the two for both.
import { stickyFlag } from '../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:prodLedger',
  param: 'prodLedger',
  defaultOn: true,
  onFault: false,
})

/** True when session capture + the ledger are enabled. Default ON in the browser. */
export function prodLedgerEnabled(): boolean { return flag.enabled() }

/** Re-read the flag (the clock menu's own toggle / tests). */
export function refreshProdLedgerFlag(): boolean {
  flag.reset()
  return flag.enabled()
}

export function setProdLedgerEnabled(on: boolean): void { flag.set(on) }

/** Test seam. */
export function _resetProdLedgerFlag(): void { flag.reset() }
