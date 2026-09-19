import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emailEnabled } from './flag'

// Email is live by default. The explicit OFF must still be durable because absence now means ON;
// SSR remains off so the prerender does not claim client-only state.

function stubEnv(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('emailEnabled — default ON in browsers and installed PWAs', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('is ON with no param and nothing stored — the fresh Safari PWA case', () => {
    stubEnv('')
    expect(emailEnabled()).toBe(true)
  })

  it('stays ON for an unrelated param', () => {
    stubEnv('?auth=1&snapThumbs=debug')
    expect(emailEnabled()).toBe(true)
  })

  it('?email=1 turns it on AND persists (sticky across a URL rewrite)', () => {
    const store = stubEnv('?email=1')
    expect(emailEnabled()).toBe(true)
    expect(store['inkwave:email']).toBe('1')
    // The URL is later rewritten by navigation — the flag must survive.
    stubEnv('', store)
    expect(emailEnabled()).toBe(true)
  })

  it('?email=off stores a durable opt-out (absence would mean ON)', () => {
    const store = stubEnv('?email=off', { 'inkwave:email': '1' })
    expect(emailEnabled()).toBe(false)
    expect(store['inkwave:email']).toBe('0')
  })

  it('stays available when storage is denied in a browser/private window', () => {
    vi.stubGlobal('location', { search: '?email=1' })
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') }, removeItem: () => {} })
    expect(emailEnabled()).toBe(true)
  })
})

// ── CHARACTERIZATION (added before the shared-flag-core refactor, run green against the unmoved
// module). The cases above pin the DEFAULT and the stickiness. These pin the two things a shared
// core would flatten by accident, because neither is visible from the flag's own answer:
//   • it enables on mere PRESENCE (`params.has`), so `?email=anything` is on — where `?musicXml`
//     next door requires an exact '1' and ignores a bare param entirely;
//   • it is NOT CACHED. Every other flag in this repo resolves once per load into a module
//     variable; this one re-reads storage on every call, which is why the existing `?email=off`
//     case above can follow a `?email=1` case in the same file and still see the change.
describe('emailEnabled — characterization', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('a BARE ?email turns it on (presence, not an exact "1")', () => {
    const store = stubEnv('?email')
    expect(emailEnabled()).toBe(true)
    expect(store['inkwave:email']).toBe('1')
  })

  it('?email=anything also turns it on — presence is the whole rule', () => {
    stubEnv('?email=yes')
    expect(emailEnabled()).toBe(true)
  })

  it('is NOT cached: a mid-session storage change is seen on the next call', () => {
    const store = stubEnv('')
    expect(emailEnabled()).toBe(true)
    store['inkwave:email'] = '0'
    expect(emailEnabled()).toBe(false)
    delete store['inkwave:email']
    expect(emailEnabled()).toBe(true)
  })

  it('is OFF with no location/localStorage at all (node/prerender)', () => {
    vi.unstubAllGlobals()
    expect(emailEnabled()).toBe(false)
  })
})
