// @vitest-environment jsdom
//
// The /snapshot debug overlay (`?snapThumbs=debug`) is SESSION-scoped, never persistent (2026-07-19).
// Peter hit a sticky `?snapThumbs=debug` that then showed the overlay on EVERY later /snapshot visit
// forever. It now lives in sessionStorage — it survives /snapshot's in-session URL rewrites (the
// round-8 reason it can't be read fresh from the URL) but is gone on a new browser session and never
// haunts. Any stale PERSISTENT flag is purged on load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let originalLocation: PropertyDescriptor | undefined
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { search }, writable: true, configurable: true,
  })
}

describe('snapThumbs debug flag is session-scoped, never persistent', () => {
  beforeEach(() => {
    originalLocation = Object.getOwnPropertyDescriptor(window, 'location')
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    // Restore window.location exactly as found — a leaked location mock poisons other files (the
    // private-window/openDocArchiveFail lesson).
    if (originalLocation) Object.defineProperty(window, 'location', originalLocation)
    else delete (window as unknown as Record<string, unknown>).location
    vi.resetModules()
  })

  it('?snapThumbs=debug turns the overlay on for THIS session (sessionStorage), not persistently', async () => {
    setSearch('?snapThumbs=debug')
    vi.resetModules()
    const m = await import('./snapThumbs')
    expect(m.snapThumbsDebug()).toBe(true)
    expect(sessionStorage.getItem('inkwave:snapThumbsDebug')).toBe('1')
    expect(localStorage.getItem('inkwave:snapThumbsDebug')).toBeNull() // never written persistently
  })

  it('a STALE persistent debug flag (the old bug) is IGNORED and PURGED — no haunting', async () => {
    localStorage.setItem('inkwave:snapThumbsDebug', '1') // exactly the stuck flag Peter had
    setSearch('') // a normal /snapshot visit, no param
    vi.resetModules()
    const m = await import('./snapThumbs')
    expect(m.snapThumbsDebug()).toBe(false)                            // overlay gone
    expect(localStorage.getItem('inkwave:snapThumbsDebug')).toBeNull() // and purged
  })

  it('?snapThumbs=1 enables the thumbnails feature WITHOUT the debug overlay', async () => {
    setSearch('?snapThumbs=1')
    vi.resetModules()
    const m = await import('./snapThumbs')
    expect(m.snapThumbsEnabled()).toBe(true)
    expect(m.snapThumbsDebug()).toBe(false)
  })
})
