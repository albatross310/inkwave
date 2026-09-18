// ── Demo-data switches ────────────────────────────────────────────────────────────────────────
// What is LEFT after the feature flags came off (2026-09-18, Peter: "just remove all the flag
// logic and push all of them"). Every feature now ships unconditionally; these are not gates.
// They ask ONE panel to render SYNTHETIC, clearly-labelled fixture data instead of the writer's
// own — `?music=demo`, `?musicXml=demo`, `?prodGraphs=demo`, `?prodReport=demo`. Never silent:
// each panel says on its face that the numbers are fixtures.
//
// STICKY, deliberately, and for the same reason the flags were: local-first navigation REWRITES
// the URL, so a value read fresh from `location.search` is gone by the first in-app nav (the
// `/snapshot` scrub lost a flag exactly this way). One visit with the param and the panel stays in
// demo until `?<param>=off` clears it.
//
// ⚠ An OFF state here is an ABSENCE, not a sticky '0' — these all default to real data, so
// `removeItem` reads as "back to real", which is the right answer.

const cache = new Map<string, boolean>()

/** `?<param>=demo` (sticky) — synthetic fixture data for that one panel. `?<param>=off` clears it. */
export function demoParam(param: string, key: string, override?: string): boolean {
  if (typeof window === 'undefined') return false
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let on = false
  try {
    if (override && (window as unknown as Record<string, unknown>)[override] === true) on = true
    const v = new URLSearchParams(window.location.search).get(param)
    if (v === 'off') { localStorage.removeItem(key); on = on || false }
    else if (v === 'demo') { localStorage.setItem(key, '1'); on = true }
    else if (localStorage.getItem(key) === '1') on = true
  } catch { /* private window / denied storage → real data, never a crash */ }
  cache.set(key, on)
  return on
}

/** Tests only: forget the resolved values so a suite can re-resolve them. */
export function _resetDemoParams(): void { cache.clear() }
