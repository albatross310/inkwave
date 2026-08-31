// CHARACTERIZATION — written against the SHIPPED auth/config.ts, before any refactor touched it,
// and run green there. `?auth` is the ORIGINAL sticky-flag in this repo; every other flag's header
// comment cites it as "the `?auth` pattern", so it is the one whose behaviour must not drift.
//
// Two things here are not shared with the other flags, and a core that absorbed them would be
// absorbing a decision it cannot see:
//   1. `authRequested()` is NOT CACHED, and that is load-bearing rather than incidental.
//      AccountControl writes `inkwave:auth` directly on a headless sign-in, mid-session, and
//      entry.client's boot read has long since happened. A resolve-once cache would freeze the
//      answer at "no" for the rest of the load.
//   2. `authEnabled()` is the FLAG **and** a build-time Clerk key, and `clerkProviderMounted()` is a
//      third, separate latch — because authEnabled() can flip true mid-session while the provider
//      only ever mounts at boot, so a component reading the wrong one renders Clerk hooks with no
//      provider and throws. Three answers, deliberately not one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  authRequested, authEnabled, CLERK_PUBLISHABLE_KEY,
  markClerkProviderMounted, clerkProviderMounted,
} from './config'

const KEY = 'inkwave:auth'

function stubEnv(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('authRequested — DEFAULT OFF, sticky, uncached', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('is OFF with no param and nothing stored', () => {
    stubEnv('')
    expect(authRequested()).toBe(false)
  })

  it('is OFF for an unrelated param', () => {
    stubEnv('?music=1&email=1')
    expect(authRequested()).toBe(false)
  })

  it('a BARE ?auth turns it on and persists "1" (presence, not an exact "1")', () => {
    const store = stubEnv('?auth')
    expect(authRequested()).toBe(true)
    expect(store[KEY]).toBe('1')
  })

  it('?auth=1 turns it on', () => {
    stubEnv('?auth=1')
    expect(authRequested()).toBe(true)
  })

  it('?auth=off clears the key — an absence, not a sticky "0"', () => {
    const store = stubEnv('?auth=off', { [KEY]: '1' })
    expect(authRequested()).toBe(false)
    expect(KEY in store).toBe(false)
  })

  it('the stored "1" survives the URL being rewritten', () => {
    const store = stubEnv('?auth')
    expect(authRequested()).toBe(true)
    stubEnv('', store)
    expect(authRequested()).toBe(true)
  })

  // (1) above — AccountControl's headless sign-in writes the key mid-session and expects to be seen.
  it('is NOT cached: a mid-session storage write is seen on the next call', () => {
    const store = stubEnv('')
    expect(authRequested()).toBe(false)
    store[KEY] = '1' // what AccountControl does on a headless sign-in
    expect(authRequested()).toBe(true)
  })

  it('is OFF (never throws) when storage is denied — private mode', () => {
    vi.stubGlobal('location', { search: '?auth=1' })
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(authRequested()).toBe(false)
  })

  it('is OFF with no location/localStorage at all (node/prerender)', () => {
    vi.unstubAllGlobals()
    expect(authRequested()).toBe(false)
  })
})

// (2) above. The Clerk key is a BUILD-TIME env var, absent in this suite, so authEnabled() is false
// here whatever the flag says — which is itself the guarantee worth pinning: the free tier never
// loads Clerk, and no URL param can make it.
describe('authEnabled — the flag AND the key', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('stays OFF with the flag on when no publishable key is configured', () => {
    stubEnv('?auth=1')
    expect(authRequested()).toBe(true)
    expect(CLERK_PUBLISHABLE_KEY).toBeFalsy() // the precondition, stated not assumed
    expect(authEnabled()).toBe(false)
  })
})

describe('clerkProviderMounted — a separate latch, not authEnabled()', () => {
  it('starts false and latches on, independently of the flag', () => {
    // Read before marking: the module-level latch is shared, so this ordering is the only chance to
    // observe its initial value.
    expect(typeof clerkProviderMounted()).toBe('boolean')
    markClerkProviderMounted()
    expect(clerkProviderMounted()).toBe(true)
    vi.unstubAllGlobals()
    expect(authRequested()).toBe(false) // the flag is off; the latch stays on regardless
    expect(clerkProviderMounted()).toBe(true)
  })
})
