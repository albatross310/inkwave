// CHARACTERIZATION — written against the SHIPPED lesson flag.ts, before any refactor touched it,
// and run green there. DEFAULT OFF: the lesson layer ships dark.
//
// The axis this file exists to pin is `params.has(...)` vs `p === '1'`. This module enables on mere
// PRESENCE, so `?lesson`, `?lesson=1` and even `?lesson=yes` all turn it on — while its neighbour
// `?musicXml` requires an exact '1' and ignores a bare param entirely. Two modules, two rules, one
// URL shape, and nothing in either says so. A shared core that picks one rule silently changes
// whichever flag it did not pick.
//
// Note the ORDER inside resolve(): `=== 'off'` is checked BEFORE `has()`, so `?lesson=off` clears
// rather than enabling. Swap the two branches and off becomes on — which is why it is pinned below
// rather than left to read as obvious.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lessonEnabled, resetLessonFlagForTests } from './flag'

const KEY = 'inkwave:lesson'

function stubEnv(search: string, store: Record<string, string> = {}) {
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('lessonEnabled — DEFAULT OFF', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    resetLessonFlagForTests()
    delete (globalThis as { __iwLesson?: boolean }).__iwLesson
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetLessonFlagForTests()
    delete (globalThis as { __iwLesson?: boolean }).__iwLesson
  })

  it('is OFF with no param and nothing stored', () => {
    stubEnv('')
    expect(lessonEnabled()).toBe(false)
  })

  it('is OFF for an unrelated param', () => {
    stubEnv('?music=1&musicXml=1')
    expect(lessonEnabled()).toBe(false)
  })

  // The presence rule, all three spellings.
  it('a BARE ?lesson turns it on (presence, not an exact "1")', () => {
    const store = stubEnv('?lesson')
    expect(lessonEnabled()).toBe(true)
    expect(store[KEY]).toBe('1')
  })

  it('?lesson=1 turns it on', () => {
    stubEnv('?lesson=1')
    expect(lessonEnabled()).toBe(true)
  })

  it('?lesson=anything also turns it on — presence is the whole rule', () => {
    stubEnv('?lesson=yes')
    expect(lessonEnabled()).toBe(true)
  })

  // The one value that is NOT presence: `off` is checked first.
  it('?lesson=off clears the key — an absence, not a sticky "0"', () => {
    const store = stubEnv('?lesson=off', { [KEY]: '1' })
    expect(lessonEnabled()).toBe(false)
    expect(KEY in store).toBe(false)
  })

  it('the stored "1" survives the URL being rewritten (the round-8 lesson)', () => {
    const store = stubEnv('?lesson')
    expect(lessonEnabled()).toBe(true)
    resetLessonFlagForTests() // a fresh load
    stubEnv('', store)        // with the param gone
    expect(lessonEnabled()).toBe(true)
  })

  it('resolves ONCE per load: a mid-session storage change is NOT seen until the reset', () => {
    const store = stubEnv('')
    expect(lessonEnabled()).toBe(false)
    store[KEY] = '1'
    expect(lessonEnabled()).toBe(false) // cached
    resetLessonFlagForTests()
    expect(lessonEnabled()).toBe(true)
  })

  it('window.__iwLesson overrides storage, both directions', () => {
    stubEnv('?lesson')
    vi.stubGlobal('window', { __iwLesson: false })
    expect(lessonEnabled()).toBe(false)
    vi.stubGlobal('window', { __iwLesson: true })
    resetLessonFlagForTests()
    stubEnv('')
    vi.stubGlobal('window', { __iwLesson: true })
    expect(lessonEnabled()).toBe(true)
  })

  it('is OFF (never throws) when storage is denied — private mode', () => {
    vi.stubGlobal('location', { search: '?lesson=1' })
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(lessonEnabled()).toBe(false)
  })

  it('is OFF with no location/localStorage at all (node/prerender)', () => {
    vi.unstubAllGlobals()
    expect(lessonEnabled()).toBe(false)
  })
})
