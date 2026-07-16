import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emailEnabled } from './flag'

// The flag must DEFAULT OFF (the brief). And the OFF must be real: a flag that throws its way to
// `true`, or that a stray localStorage value flips on, is not a default-off flag.

function stubEnv(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('emailEnabled — default OFF', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('is OFF with no param and nothing stored', () => {
    stubEnv('')
    expect(emailEnabled()).toBe(false)
  })

  it('is OFF for an unrelated param', () => {
    stubEnv('?auth=1&snapThumbs=debug')
    expect(emailEnabled()).toBe(false)
  })

  it('?email=1 turns it on AND persists (sticky across a URL rewrite)', () => {
    const store = stubEnv('?email=1')
    expect(emailEnabled()).toBe(true)
    expect(store['inkwave:email']).toBe('1')
    // The URL is later rewritten by navigation — the flag must survive.
    stubEnv('', store)
    expect(emailEnabled()).toBe(true)
  })

  it('?email=off clears the sticky flag', () => {
    const store = stubEnv('?email=off', { 'inkwave:email': '1' })
    expect(emailEnabled()).toBe(false)
    expect(store['inkwave:email']).toBeUndefined()
  })

  it('is OFF (never throws) when storage is denied — private mode / SSR', () => {
    vi.stubGlobal('location', { search: '?email=1' })
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') }, removeItem: () => {} })
    expect(emailEnabled()).toBe(false)
  })
})
