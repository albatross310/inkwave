// @vitest-environment jsdom
// KEEPS THE RED-TEXT TRAP CLOSED (2026-08-28).
//
// Peter spent a session watching his honours proposal turn red and reaching for the text-colour
// menu, which cannot touch a suggestion mark. The cause was that live suggestion (track-changes)
// mode was PERSISTED in localStorage while its only control — the ✎ button — lives on the review
// row, so closing that row or reloading left the mode running, invisible and unreachable, rewriting
// every keystroke into a red `insertion`. MEASURED on his real file: five insertion marks (the title
// and every heading), zero text-colour marks.
//
// The fix is that suggest mode is session-only state. These tests are the cheap keeper for it — the
// browser is not needed to see a localStorage write, and a proof that ran once is not a guard.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const K = 'inkwave:reviewSuggest'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

let store: ReturnType<typeof fakeStorage>

beforeEach(() => {
  store = fakeStorage()
  vi.stubGlobal('localStorage', store)
  vi.resetModules()
})

describe('suggest mode is session-only', () => {
  it('is OFF on a fresh load even when a legacy flag says it was on', async () => {
    store.setItem(K, '1') // exactly the state Peter was stranded in
    const m = await import('./reviewState')
    expect(m.suggestOn()).toBe(false)
  })

  it('turning it on never writes to storage', async () => {
    const m = await import('./reviewState')
    m.setSuggestOn(true)
    expect(m.suggestOn()).toBe(true)
    // The whole point: nothing on disk can bring the mode back after a reload.
    expect(store.getItem(K)).toBeNull()
    expect([...store.map.keys()]).not.toContain(K)
  })

  it('does not survive a reload', async () => {
    const first = await import('./reviewState')
    first.setSuggestOn(true)
    expect(first.suggestOn()).toBe(true)
    vi.resetModules()                 // a new page load = a new module instance
    const second = await import('./reviewState')
    expect(second.suggestOn()).toBe(false)
  })

  it('clearLegacySuggestFlag drops a stored flag from an older build', async () => {
    store.setItem(K, '1')
    const m = await import('./reviewState')
    m.clearLegacySuggestFlag()
    expect(store.getItem(K)).toBeNull()
  })

  it('the OTHER review state is still persisted — this change is scoped to suggest', async () => {
    const m = await import('./reviewState')
    m.setActiveSet('Supervisor')
    m.setShowChangesGlobal(false)
    expect(store.getItem('inkwave:reviewActiveSet')).toBe('Supervisor')
    expect(store.getItem('inkwave:reviewShowChanges')).toBe('0')
    // …and a reload keeps them, unlike suggest.
    vi.resetModules()
    const again = await import('./reviewState')
    expect(again.activeSet()).toBe('Supervisor')
    expect(again.showChangesGlobal()).toBe(false)
  })
})
