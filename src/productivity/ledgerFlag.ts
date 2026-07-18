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
// The OFF state is a STICKY '0', never an absence: with the default now ON, `removeItem` would mean
// "back to on", so a genuine opt-out has to be written down. `setProdLedgerEnabled(false)` and the
// clock menu's own "turn off" button both write '0'.
//
// STICKY-RESOLVED ONCE per load into localStorage, following the `?snapThumbs` / `?auth` pattern: a
// flag re-read from the URL on every call DIES the moment any local-first navigation rewrites the
// URL — which silently disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs
// round 8, bug 2). Don't reintroduce that.
//
// The resolved value is then CACHED in a module variable, because this gate sits on the editor's
// per-keystroke path and `localStorage.getItem` per keystroke is itself a typing cost. Measured at
// 0.07µs/keystroke when off (capture.perf.test.ts); ON now means session capture RUNS, but record()
// is proven O(steps) not O(doc) (capture.perf.test.ts), so the default flip adds no keystroke cost.
//
// SSR/prerender/node have no localStorage → OFF: capture must never run where there is no writer
// typing. The browser default (localStorage present) is ON.

const KEY = 'inkwave:prodLedger'

let _cached: boolean | null = null

function resolve(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('prodLedger')
      if (p === 'off') localStorage.setItem(KEY, '0')     // explicit, sticky opt-out
      else if (p === '1') localStorage.setItem(KEY, '1')  // clears a prior '0' opt-out
    }
    if (typeof localStorage === 'undefined') return false // SSR/prerender/node → capture never runs
    return localStorage.getItem(KEY) !== '0'              // ON unless explicitly turned off
  } catch {
    return false // private mode / no storage → off (safe for the keystroke path)
  }
}

/** True when session capture + the ledger are enabled. Default ON in the browser. */
export function prodLedgerEnabled(): boolean {
  if (_cached === null) _cached = resolve()
  return _cached
}

/** Re-read the flag (the clock menu's own toggle / tests). */
export function refreshProdLedgerFlag(): boolean {
  _cached = null
  return prodLedgerEnabled()
}

export function setProdLedgerEnabled(on: boolean): void {
  try {
    // '0' is a STICKY off, not an absence — with the default ON, removeItem would re-enable it.
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch { /* private mode — flag stays session-only via _cached */ }
  _cached = on
}

/** Test seam. */
export function _resetProdLedgerFlag(): void {
  _cached = null
}
