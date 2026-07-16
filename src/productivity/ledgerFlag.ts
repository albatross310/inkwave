// Feature flag for session capture + the ledger — DEFAULT OFF.
//
// NAMED `ledgerFlag`, not `flags`, on purpose: `flag.ts` next door is the AI REPORT's flag, and a
// `flag.ts`/`flags.ts` pair in one directory is how someone imports the wrong feature and never
// notices. Two features, two flags, two unmistakable names.
//
//   ?prodLedger=1    on
//   ?prodLedger=off  off
//
// STICKY-RESOLVED ONCE per load into localStorage, following the `?snapThumbs` / `?auth` pattern: a
// flag re-read from the URL on every call DIES the moment any local-first navigation rewrites the
// URL — which silently disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs
// round 8, bug 2). Don't reintroduce that.
//
// The resolved value is then CACHED in a module variable, because this gate sits on the editor's
// per-keystroke path and `localStorage.getItem` per keystroke is itself a typing cost. Measured at
// 0.07µs/keystroke when off (capture.perf.test.ts).

const KEY = 'inkwave:prodLedger'

let _cached: boolean | null = null

function resolve(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('prodLedger')
      if (p === 'off') localStorage.removeItem(KEY)
      else if (p === '1') localStorage.setItem(KEY, '1')
    }
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch {
    return false // private mode / no storage → off
  }
}

/** True when session capture + the ledger are enabled. Default OFF. */
export function prodLedgerEnabled(): boolean {
  if (_cached === null) _cached = resolve()
  return _cached
}

/** Re-read the flag (the ledger page's own toggle / tests). */
export function refreshProdLedgerFlag(): boolean {
  _cached = null
  return prodLedgerEnabled()
}

export function setProdLedgerEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch { /* private mode — flag stays session-only */ }
  _cached = on
}

/** Test seam. */
export function _resetProdLedgerFlag(): void {
  _cached = null
}
