// CHARACTERIZATION — written against the SHIPPED liveFrameFlag.ts, before any refactor touched it.
//
// The point of writing it first: a test authored after a move encodes what the author BELIEVES the
// code did, and a refactor is exactly when that belief is least reliable. Every case below was run
// green against the unmoved module. Three of them pin behaviour that a "tidy" shared flag core
// would flatten by accident, so they are the ones to read before changing anything here:
//
//   1. NO WINDOW ⇒ false, but DENIED STORAGE ⇒ true. The two failure modes give OPPOSITE answers
//      and that is deliberate: prerender must not bake live framing into static HTML, while a
//      writer in a private window must get the feature rather than a silent downgrade they cannot
//      see. A core that collapses "no window" and "storage threw" into one fallback breaks one of
//      the two, and which one it breaks is invisible until it ships.
//   2. `?liveFrame=1` CLEARS the key; it does not write '1'. Under an absent-means-on reader both
//      read as ON, so only storage inspection can tell them apart.
//   3. IT IS NOT CACHED. SourceBrowser re-reads it per effect precisely because it "can be flipped"
//      mid-session; a resolve-once cache would freeze it at whatever the first read saw.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { liveFrameEnabled } from './liveFrameFlag'

const KEY = 'inkwave:liveFrame'

function stubEnv(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('window', { location: { search } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('liveFrameEnabled — DEFAULT ON', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('is ON with no param and nothing stored', () => {
    stubEnv('')
    expect(liveFrameEnabled()).toBe(true)
  })

  it('is ON for an unrelated param', () => {
    stubEnv('?auth=1&music=demo')
    expect(liveFrameEnabled()).toBe(true)
  })

  // Both spellings of off, and both write the same sticky '0'.
  it('?liveFrame=off turns it OFF and writes a sticky "0"', () => {
    const store = stubEnv('?liveFrame=off')
    expect(liveFrameEnabled()).toBe(false)
    expect(store[KEY]).toBe('0')
  })

  it('?liveFrame=0 is the same off', () => {
    const store = stubEnv('?liveFrame=0')
    expect(liveFrameEnabled()).toBe(false)
    expect(store[KEY]).toBe('0')
  })

  it('the sticky "0" survives the URL being rewritten (the round-8 lesson)', () => {
    const store = stubEnv('?liveFrame=off')
    expect(liveFrameEnabled()).toBe(false)
    stubEnv('', store) // later navigation drops the param
    expect(liveFrameEnabled()).toBe(false)
  })

  // (2) above: the on-path CLEARS rather than writing '1'.
  it('?liveFrame=1 re-arms by REMOVING the key, not by writing "1"', () => {
    const store = stubEnv('?liveFrame=1', { [KEY]: '0' })
    expect(liveFrameEnabled()).toBe(true)
    expect(KEY in store).toBe(false)
  })

  // (1) above, half one.
  it('is OFF with no window at all — SSR/prerender must not bake framing into static HTML', () => {
    vi.unstubAllGlobals() // node: no window
    expect(liveFrameEnabled()).toBe(false)
  })

  // (1) above, half two — the OPPOSITE answer from the case above it.
  it('is ON when storage is denied — private mode gets the feature, not a silent downgrade', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(liveFrameEnabled()).toBe(true)
  })

  // (3) above. SourceBrowser: "the extension can be granted mid-session, and liveFrameEnabled() can
  // be flipped" — so the answer must track storage on every call, not a resolve-once cache.
  it('is NOT cached: a mid-session storage change is seen on the next call', () => {
    const store = stubEnv('')
    expect(liveFrameEnabled()).toBe(true)
    store[KEY] = '0'
    expect(liveFrameEnabled()).toBe(false)
    delete store[KEY]
    expect(liveFrameEnabled()).toBe(true)
  })
})
