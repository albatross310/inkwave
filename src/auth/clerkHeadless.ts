// Headless (no-provider) Clerk for the mid-session sign-in. The free tier boots WITHOUT
// ClerkProvider (see entry.client + CLAUDE.md load-performance rules), so the first "Sign in"
// click used to arm the sticky flag and location.reload() — a visible full-page reload. Instead,
// this module lazy-loads @clerk/clerk-js ON THAT CLICK, builds one Clerk instance and opens the
// modal in the current session. Nothing here runs until armHeadless() is called, so the
// keep-startup-fast rule holds: zero Clerk code on free-tier loads.
//
// On FUTURE loads the sticky flag makes entry.client mount the real ClerkProvider as before —
// this instance only ever serves the session in which auth was first requested.

import type { Clerk as ClerkInstance } from '@clerk/clerk-js'
import { CLERK_PUBLISHABLE_KEY } from './config'
import { CITATION_TOAST_EVENT } from '../citations/citationToast'

export type HeadlessClerk = ClerkInstance

let instance: HeadlessClerk | null = null
let loading: Promise<HeadlessClerk | null> | null = null

// ─── CSP tripwire ────────────────────────────────────────────────────────────────
// Clerk's UI swallows network-LEVEL failures: a fetch the browser refuses (CSP, extension block)
// rejects before Clerk gets a response, and the modal quietly resets to "Continue" — no error, no
// console hint beyond the violation report. That was the 2026-07-10 incident: the production
// frontend API (clerk.iwzero.me) was missing from middleware.ts connect-src, and sign-in silently
// no-oped in every browser. The domain is fixed there; this guard makes the failure MODE loud if a
// domain ever goes missing again — a developer console error plus one writer-visible toast.
let cspGuardInstalled = false
export function installClerkCspGuard(): void {
  if (cspGuardInstalled || typeof document === 'undefined') return
  cspGuardInstalled = true
  let toasted = false
  document.addEventListener('securitypolicyviolation', (e) => {
    if (!/clerk/i.test(e.blockedURI)) return
    console.error(
      `[inkwave] Clerk request blocked by CSP: ${e.blockedURI} (${e.violatedDirective}). ` +
      'Sign-in cannot work — add this origin to the policy in middleware.ts.',
    )
    if (toasted) return // one toast per session; the console keeps the full stream
    toasted = true
    window.dispatchEvent(new CustomEvent(CITATION_TOAST_EVENT, {
      detail: { text: 'Sign-in is blocked by a security policy on this site — a configuration bug on our side, not your browser. Please try again after the next update.' },
    }))
  })
}

/** The live headless instance, if armHeadless() has completed (null otherwise). */
export function getHeadless(): HeadlessClerk | null {
  return instance
}

/**
 * Load clerk-js (lazy, once) and return the loaded singleton. Safe to call repeatedly — concurrent
 * calls share one in-flight load; a failed load clears itself so a later click can retry.
 * Returns null when auth isn't configured, on SSR, or if Clerk fails to initialise.
 */
export async function armHeadless(): Promise<HeadlessClerk | null> {
  if (typeof window === 'undefined' || !CLERK_PUBLISHABLE_KEY) return null
  if (instance) return instance
  if (!loading) {
    loading = (async () => {
      try {
        installClerkCspGuard() // armed before the first Clerk network call, so nothing fails silently
        const { Clerk } = await import('@clerk/clerk-js')
        const clerk = new Clerk(CLERK_PUBLISHABLE_KEY)
        await clerk.load()
        // The npm module does NOT set window.Clerk (only Clerk's CDN bundle entry does — verified
        // against clerk-js 5.127 dist). entitlement.ts reads window.Clerk.session.getToken() for
        // every /api call, so publish the instance there. Never clobber an existing one.
        const w = window as unknown as { Clerk?: unknown }
        if (!w.Clerk) w.Clerk = clerk
        instance = clerk
        return clerk
      } catch {
        loading = null // transient (offline, blocked script) — let the next click retry
        return null
      }
    })()
  }
  return loading
}
