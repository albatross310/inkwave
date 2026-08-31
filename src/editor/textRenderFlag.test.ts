// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { textRenderEnabled, _resetTextRenderFlag } from './textRenderFlag'

// THE RICH /snapshot SCRUB PANE graduated to DEFAULT ON (2026-07-18). "On" must be REAL: absent and
// stored-'1' are on; only a sticky '0' turns it off; and a denied/SSR storage must not silently
// disable it. Mutation-proof BOTH ways — reverting the reader to the old `=== '1'` (default OFF) must
// break the ABSENT and DENIED cases, which is exactly what makes this a graduation guard and not a
// restatement of the code.
//
// Unlike the prod flags this reader does NOT parse the URL — entry.client.tsx syncs ?textRender →
// localStorage before the app reads anything — so these drive localStorage directly. The
// window.__iwTextRender override wins over storage (the A/B seam) and is cleared before each case.

function stubStore(store: Record<string, string>): Record<string, string> {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
  return store
}

describe('textRenderEnabled — DEFAULT ON', () => {
  beforeEach(() => { _resetTextRenderFlag(); delete (window as unknown as { __iwTextRender?: boolean }).__iwTextRender })
  afterEach(() => { vi.unstubAllGlobals(); _resetTextRenderFlag(); delete (window as unknown as { __iwTextRender?: boolean }).__iwTextRender })

  // THE MUTATION-KILLER: absent ⇒ ON. The old `=== '1'` reader answers false here.
  it('is ON with nothing stored (the new default)', () => {
    stubStore({})
    expect(textRenderEnabled()).toBe(true)
  })

  it('stays ON for an unrelated stored key', () => {
    stubStore({ 'inkwave:snapBreaks': '1' })
    expect(textRenderEnabled()).toBe(true)
  })

  it('a sticky "0" turns it OFF (the ?textRender=off opt-out)', () => {
    stubStore({ 'inkwave:textRender': '0' })
    expect(textRenderEnabled()).toBe(false)
  })

  it('an explicit "1" is ON', () => {
    stubStore({ 'inkwave:textRender': '1' })
    expect(textRenderEnabled()).toBe(true)
  })

  it('window.__iwTextRender overrides storage (the A/B seam), both directions', () => {
    // Override TRUE beats a stored '0' (which would otherwise be OFF).
    stubStore({ 'inkwave:textRender': '0' })
    ;(window as unknown as { __iwTextRender?: boolean }).__iwTextRender = true
    expect(textRenderEnabled()).toBe(true)
    // Override FALSE beats the default-ON absent state (which would otherwise be ON).
    _resetTextRenderFlag()
    stubStore({})
    ;(window as unknown as { __iwTextRender?: boolean }).__iwTextRender = false
    expect(textRenderEnabled()).toBe(false)
  })

  // THE SECOND MUTATION-KILLER: denied/SSR ⇒ ON. The old `catch { false }` answers false here.
  it('is ON (never throws) when storage is denied — private mode', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => {},
    })
    expect(textRenderEnabled()).toBe(true)
  })

  // ── CHARACTERIZATION (added before the shared-flag-core refactor, run green against the unmoved
  // module). This flag READS NO URL AT ALL — entry.client.tsx syncs `?textRender` into localStorage
  // for it, along with the other boot-synced flags. That makes it the odd one out among nine
  // otherwise-identical modules, and it is the one difference a shared core is most likely to
  // "helpfully" close by giving it a param it never had. Pinned by observation, not by comment.
  it('reads NO URL param: ?textRender=off in the URL does not turn it off by itself', () => {
    vi.stubGlobal('location', { search: '?textRender=off' })
    stubStore({})
    expect(textRenderEnabled()).toBe(true)   // storage is what decides, and storage is empty
  })

  it('and writes nothing to storage when it reads', () => {
    const store = stubStore({})
    expect(textRenderEnabled()).toBe(true)
    expect(Object.keys(store)).toHaveLength(0)
  })

  it('caches the read: a later storage change is not seen until the reset', () => {
    const store = stubStore({})
    expect(textRenderEnabled()).toBe(true)
    store['inkwave:textRender'] = '0'
    expect(textRenderEnabled()).toBe(true)   // cached
    _resetTextRenderFlag()
    expect(textRenderEnabled()).toBe(false)  // re-read
  })
})
