// CHARACTERIZATION — written against the SHIPPED xmlFlag.ts, before any refactor touched it, and
// run green there. `?musicXml` gates ONE PATH inside the music module (the MusicXML entry) and is
// DEFAULT OFF, unlike `?music` next door which graduated to default ON. The two sit in one
// directory, so the cases that matter most here are the ones that would silently converge if a
// shared core defaulted them the same way.
//
// The differences this file pins, each measured, each easy to flatten by accident:
//   1. OFF is an ABSENCE (removeItem), not a sticky '0'. Under a present-means-on reader that is
//      correct and a '0' would ALSO read as off — so the two are indistinguishable from the flag's
//      own answer and only storage inspection separates them.
//   2. A BARE `?musicXml` does NOT enable it. This module tests `p === '1'`; the email/lesson/auth
//      flags test `params.has(...)`, where a bare param DOES enable. Same-looking URL, opposite
//      answers, and nothing in either module says so.
//   3. `demo` implies on, and turning it off clears BOTH keys.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { musicXmlEnabled, musicXmlDemo, __resetMusicXmlFlagForTest } from './xmlFlag'

const KEY = 'inkwave:musicXml'
const DEMO_KEY = 'inkwave:musicXmlDemo'

function stubWindow(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    },
  })
  return store
}

describe('musicXmlEnabled — DEFAULT OFF', () => {
  beforeEach(() => { vi.unstubAllGlobals(); __resetMusicXmlFlagForTest() })
  afterEach(() => { vi.unstubAllGlobals(); __resetMusicXmlFlagForTest() })

  it('is OFF with no param and nothing stored', () => {
    stubWindow('')
    expect(musicXmlEnabled()).toBe(false)
    expect(musicXmlDemo()).toBe(false)
  })

  it('is OFF for an unrelated param', () => {
    stubWindow('?music=1&auth=1')
    expect(musicXmlEnabled()).toBe(false)
  })

  it('?musicXml=1 turns it on and persists "1"', () => {
    const store = stubWindow('?musicXml=1')
    expect(musicXmlEnabled()).toBe(true)
    expect(store[KEY]).toBe('1')
    expect(musicXmlDemo()).toBe(false)
  })

  // (2) above — the axis that differs from email/lesson/auth.
  it('a BARE ?musicXml does NOT turn it on (exact "1", not mere presence)', () => {
    const store = stubWindow('?musicXml')
    expect(musicXmlEnabled()).toBe(false)
    expect(KEY in store).toBe(false)
  })

  it('the stored "1" survives the URL being rewritten (the round-8 lesson)', () => {
    const store = stubWindow('?musicXml=1')
    expect(musicXmlEnabled()).toBe(true)
    __resetMusicXmlFlagForTest() // a fresh load
    stubWindow('', store)        // with the param gone
    expect(musicXmlEnabled()).toBe(true)
  })

  // (1) above.
  it('?musicXml=off clears BOTH keys — an absence, not a sticky "0"', () => {
    const store = stubWindow('?musicXml=off', { [KEY]: '1', [DEMO_KEY]: '1' })
    expect(musicXmlEnabled()).toBe(false)
    expect(musicXmlDemo()).toBe(false)
    expect(KEY in store).toBe(false)
    expect(DEMO_KEY in store).toBe(false)
  })

  // (3) above.
  it('?musicXml=demo is on PLUS demo, and ?musicXml=1 clears demo without turning it off', () => {
    const store = stubWindow('?musicXml=demo')
    expect(musicXmlEnabled()).toBe(true)
    expect(musicXmlDemo()).toBe(true)
    expect(store[DEMO_KEY]).toBe('1')

    __resetMusicXmlFlagForTest()
    stubWindow('?musicXml=1', store)
    expect(musicXmlEnabled()).toBe(true)
    expect(musicXmlDemo()).toBe(false)
    expect(DEMO_KEY in store).toBe(false)
  })

  it('resolves ONCE per load: a mid-session storage change is NOT seen until the reset', () => {
    const store = stubWindow('')
    expect(musicXmlEnabled()).toBe(false)
    store[KEY] = '1'
    expect(musicXmlEnabled()).toBe(false) // cached
    __resetMusicXmlFlagForTest()
    expect(musicXmlEnabled()).toBe(true)  // re-resolved
  })

  it('window.__iwMusicXml / __iwMusicXmlDemo override storage, both directions', () => {
    const store = stubWindow('?musicXml=demo')
    expect(musicXmlEnabled()).toBe(true)
    ;(window as unknown as { __iwMusicXml?: boolean }).__iwMusicXml = false
    ;(window as unknown as { __iwMusicXmlDemo?: boolean }).__iwMusicXmlDemo = false
    expect(musicXmlEnabled()).toBe(false)
    expect(musicXmlDemo()).toBe(false)

    __resetMusicXmlFlagForTest()
    stubWindow('', store)
    ;(window as unknown as { __iwMusicXml?: boolean }).__iwMusicXml = true
    expect(musicXmlEnabled()).toBe(true)
  })

  it('is OFF (never throws) when storage is denied — private mode / SSR', () => {
    vi.stubGlobal('window', {
      location: { search: '?musicXml=1' },
      localStorage: {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
        removeItem: () => { throw new Error('denied') },
      },
    })
    expect(musicXmlEnabled()).toBe(false)
  })

  it('is OFF with no window at all (node/prerender)', () => {
    vi.unstubAllGlobals()
    expect(musicXmlEnabled()).toBe(false)
  })
})
