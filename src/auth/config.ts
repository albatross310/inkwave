import { stickyFlag } from '../flags/stickyFlag'

// Auth is OPTIONAL and only needed for the paid (M6) tier — the free writing + sync tiers never
// require an Inkwave account. The whole auth layer is gated on the Clerk publishable key: until
// it's set the login UI is hidden and Clerk is never loaded (zero impact, like OneDrive).

export const CLERK_PUBLISHABLE_KEY = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// M6 is dormant, so even with a dev key set we must NOT pay Clerk's load on every free-tier page —
// its init (network handshake + hidden iframe + token polling) is seconds of background CPU on a dev
// instance (the startup "whirring"). So auth is OPT-IN: it stays off until requested with `?auth`
// (sticky — persisted so it survives later loads; `?auth=off` clears it). Wire this to the paid
// entitlement gate at launch. SSR/prerender has no localStorage/location → returns false.
//
// This is the ORIGINAL sticky flag — every other module's header cites "the `?auth` pattern" — and
// it now runs on the shared core like the rest. `cache: false` is load-bearing, not incidental:
// AccountControl writes `inkwave:auth` directly on a headless sign-in, long after boot, and a
// resolve-once cache would freeze the answer at "no" for the rest of the load.
//
// Only the FLAG moved. `authEnabled()` and the provider latch below stay here, because neither is
// a flag: one is the flag AND a build-time key, the other is a fact about what already mounted.
const authFlag = stickyFlag({
  key: 'inkwave:auth',
  param: 'auth',
  defaultOn: false,
  onParam: 'present',
  cache: false,
})

export function authRequested(): boolean {
  return authFlag.enabled()
}

export function authEnabled(): boolean {
  return !!CLERK_PUBLISHABLE_KEY && authRequested()
}

// Whether entry.client actually mounted <ClerkProvider> at boot. authEnabled() can flip true
// MID-SESSION (the headless sign-in sets the sticky flag) but the provider only mounts on load —
// components gating on @clerk/clerk-react hooks must check THIS, not authEnabled(), or they'd
// render provider-dependent hooks with no provider and throw. Set once, before hydration.
let providerMounted = false
export function markClerkProviderMounted(): void { providerMounted = true }
export function clerkProviderMounted(): boolean { return providerMounted }
