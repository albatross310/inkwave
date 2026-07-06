// Auth is OPTIONAL and only needed for the paid (M6) tier — the free writing + sync tiers never
// require an Inkwave account. The whole auth layer is gated on the Clerk publishable key: until
// it's set the login UI is hidden and Clerk is never loaded (zero impact, like OneDrive).

export const CLERK_PUBLISHABLE_KEY = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// M6 is dormant, so even with a dev key set we must NOT pay Clerk's load on every free-tier page —
// its init (network handshake + hidden iframe + token polling) is seconds of background CPU on a dev
// instance (the startup "whirring"). So auth is OPT-IN: it stays off until requested with `?auth`
// (sticky — persisted so it survives later loads; `?auth=off` clears it). Wire this to the paid
// entitlement gate at launch. SSR/prerender has no localStorage/location → returns false.
export function authRequested(): boolean {
  try {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    if (params?.get('auth') === 'off') localStorage.removeItem('inkwave:auth')
    else if (params?.has('auth')) localStorage.setItem('inkwave:auth', '1')
    return localStorage.getItem('inkwave:auth') === '1'
  } catch { return false }
}

export function authEnabled(): boolean {
  return !!CLERK_PUBLISHABLE_KEY && authRequested()
}
