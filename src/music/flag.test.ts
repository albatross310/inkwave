import { describe, it, expect, beforeEach, vi } from 'vitest'
import { musicEnabled, musicDemo, __resetMusicFlagForTest, setMusicEnabledForTest } from './flag'

// The music module GRADUATED to default ON (2026-07-18): finished, so unflagged. This file pins the
// graduation from BOTH sides — a default that is not really on, or an `?music=off` that does not
// really turn off, each fails a test here. Mutation notes are on the cases that carry the guarantee.
//
// The flag reads `window.location` / `window.localStorage` and caches its resolution once per load
// (the sticky-resolve-once pattern), so each case stubs `window` and resets the cache.

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

describe('musicEnabled — default ON (graduated)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); __resetMusicFlagForTest() })

  // MUTATION: revert resolve()'s default to `on = false` (or read `=== '1'`) and this dies — the
  // graduation is exactly "on with nothing set".
  it('is ON with no param and nothing stored — the graduation', () => {
    stubWindow('')
    expect(musicEnabled()).toBe(true)
  })

  it('is ON for an unrelated param (a stray flag does not turn music off)', () => {
    stubWindow('?auth=1&snapThumbs=debug')
    expect(musicEnabled()).toBe(true)
  })

  // MUTATION: drop the `p === 'off'` branch, or read `!== '0'` as `!= null`, and this dies — the ONE
  // way to turn the module off must keep working after graduation.
  it('?music=off turns it OFF and persists as a sticky "0"', () => {
    const store = stubWindow('?music=off')
    expect(musicEnabled()).toBe(false)
    expect(store[ 'inkwave:music' ]).toBe('0')
    // The URL is later rewritten by local-first navigation — the OFF must survive on the stored '0'.
    __resetMusicFlagForTest()
    stubWindow('', store)
    expect(musicEnabled()).toBe(false)
  })

  it('?music=1 re-arms after a previous off (and clears demo)', () => {
    const store = stubWindow('?music=1', { 'inkwave:music': '0', 'inkwave:musicDemo': '1' })
    expect(musicEnabled()).toBe(true)
    expect(store['inkwave:music']).toBe('1')
    expect(musicDemo()).toBe(false)
  })

  // The demo mechanism must survive graduation untouched — never silent, never a real score.
  it('?music=demo is ON and demo', () => {
    const store = stubWindow('?music=demo')
    expect(musicEnabled()).toBe(true)
    expect(musicDemo()).toBe(true)
    expect(store['inkwave:musicDemo']).toBe('1')
  })

  // Graduation keeps the SSR/private-mode contract: storage denied must not throw — and the default
  // it falls back to is now ON.
  it('is ON (never throws) when storage is denied — private mode / SSR', () => {
    vi.stubGlobal('window', {
      location: { search: '?music=1' },
      localStorage: {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
        removeItem: () => {},
      },
    })
    __resetMusicFlagForTest()
    expect(musicEnabled()).toBe(true)
  })
})

// ── CHARACTERIZATION (added before the shared-flag-core refactor, run green against the unmoved
// module). The cases above pin the graduation itself. These pin the mechanics around it that a
// shared core would flatten, each measured rather than assumed:
//   • `?music` requires an EXACT value — a bare param is inert, unlike `?email`/`?lesson`/`?auth`,
//     which enable on mere presence;
//   • the resolution is CACHED once per load, unlike `?email`/`?auth`/`?liveFrame`;
//   • two window overrides, and `setMusicEnabledForTest` writes the cache WITHOUT touching storage.
describe('musicEnabled — characterization', () => {
  beforeEach(() => { vi.unstubAllGlobals(); __resetMusicFlagForTest() })

  it('a BARE ?music writes nothing and leaves the default alone', () => {
    const store = stubWindow('?music')
    expect(musicEnabled()).toBe(true)     // the default, not the param
    expect('inkwave:music' in store).toBe(false)
  })

  it('a bare ?music does NOT re-arm a prior off (only an exact "1" does)', () => {
    stubWindow('?music', { 'inkwave:music': '0' })
    expect(musicEnabled()).toBe(false)
  })

  it('resolves ONCE per load: a mid-session storage change is NOT seen until the reset', () => {
    const store = stubWindow('')
    expect(musicEnabled()).toBe(true)
    store['inkwave:music'] = '0'
    expect(musicEnabled()).toBe(true)     // cached
    __resetMusicFlagForTest()
    expect(musicEnabled()).toBe(false)    // re-resolved
  })

  it('window.__iwMusic / __iwMusicDemo override storage, both directions', () => {
    stubWindow('?music=off')
    expect(musicEnabled()).toBe(false)
    ;(window as unknown as { __iwMusic?: boolean }).__iwMusic = true
    expect(musicEnabled()).toBe(true)
    ;(window as unknown as { __iwMusic?: boolean }).__iwMusic = false
    expect(musicEnabled()).toBe(false)
    ;(window as unknown as { __iwMusicDemo?: boolean }).__iwMusicDemo = true
    expect(musicDemo()).toBe(true)
  })

  it('setMusicEnabledForTest writes the cache without touching storage, and keeps demo', () => {
    const store = stubWindow('?music=demo')
    expect(musicDemo()).toBe(true)
    setMusicEnabledForTest(false)
    expect(musicEnabled()).toBe(false)
    expect(musicDemo()).toBe(true)                 // demo survives the toggle
    expect(store['inkwave:music']).toBe('1')       // storage untouched by the test seam
  })

  it('is ON with no window at all — the graduated default survives prerender', () => {
    vi.unstubAllGlobals()
    __resetMusicFlagForTest()
    expect(musicEnabled()).toBe(true)
  })
})
