// The email layer's feature flag — DEFAULT OFF (P1b ships dark).
//
// Follows the repo's sticky-flag pattern exactly (`?auth`, src/auth/config.ts): resolve the URL
// param on every read and persist it, so the flag survives the URL being rewritten by later
// navigation. Reading the URL fresh WITHOUT persisting is the bug that silently disabled the
// snapshot thumbnails the moment a scrub rewrote the URL (CLAUDE.md, /snapshot round 8) — the flag
// died exactly when the feature started being used, and its absence looked like the feature being
// unnecessary. Persisting is what makes the flag survive that.
//
//   ?email / ?email=1   enable (sticky)
//   ?email=off          disable + clear
//
// UNSET ⇒ OFF. SSR/prerender has no localStorage/location → false.

export function emailEnabled(): boolean {
  try {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    if (params?.get('email') === 'off') localStorage.removeItem('inkwave:email')
    else if (params?.has('email')) localStorage.setItem('inkwave:email', '1')
    return localStorage.getItem('inkwave:email') === '1'
  } catch { return false }
}
