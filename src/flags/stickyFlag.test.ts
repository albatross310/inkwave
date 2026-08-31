// @vitest-environment jsdom
//
// THE SHARED FLAG CORE'S OWN GUARD, against the two OPPOSITE hazards of this pattern — both of
// which this repo has shipped, and both of which nine hand-written copies had to get right alone:
//
//   HAZARD A — NOT PERSISTING WHEN YOU MUST. /snapshot's local-first nav rewrites the URL on every
//   scrub step, so a flag read fresh from the URL died on the first scrub, silently disabling the
//   snapshot thumbnails exactly when someone started using them.
//
//   HAZARD B — PERSISTING WHEN YOU MUST NOT. `?snapThumbs=debug` was written to localStorage, so a
//   diagnostic overlay switched on once appeared on every later visit forever.
//
// Both are asserted below as a MATCHED PAIR differing only in `companionStorage`, so neither can
// pass by construction: the session case must be ON within its session (or "does not survive" is
// vacuous), and the local case must survive the identical treatment (or the difference is the
// harness rather than the axis). Both directions are mutation-proved — see the block above each.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stickyFlag } from './stickyFlag'

const KEY = 'inkwave:testFlag'
const COMPANION = 'inkwave:testFlagDemo'

function url(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  url('')
})
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// ─── HAZARD A: the answer must outlive the URL ───────────────────────────────────────────────
// MUTATION-PROVED: delete the `s.setItem(spec.key, '1')` from resolve()'s on-param branch — i.e.
// read the URL without persisting, the round-8 bug exactly — and both cases in this block fail
// while every other test in this file still passes. That is what makes it a guard for THIS bug
// and not a restatement of the code.
describe('HAZARD A — a resolved flag survives the URL being rewritten', () => {
  it('an on-by-param flag is still ON after the param is gone and the page reloads', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: false })
    url('?testFlag=1')
    expect(flag.enabled()).toBe(true)

    // /snapshot rewrites the URL on the next scrub step, then the writer reloads.
    url('')
    flag.reset()
    expect(flag.enabled()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('an off-by-param DEFAULT-ON flag stays off across the same reload — a sticky "0", never an absence', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: true })
    url('?testFlag=off')
    expect(flag.enabled()).toBe(false)
    // An absence would read as ON under this reader, so the opt-out has to be written down.
    expect(localStorage.getItem(KEY)).toBe('0')

    url('')
    flag.reset()
    expect(flag.enabled()).toBe(false)
  })
})

// ─── HAZARD B: a session-scoped companion must NOT outlive its session ───────────────────────
// MUTATION-PROVED: make resolve()'s `cs` ignore the axis (`const cs = s`, routing the companion to
// localStorage — the pre-2026-07-19 behaviour) and the two session cases below fail while the
// local case in the same block still passes. The pair is what discriminates: same shape, same
// treatment, one field different.
describe('HAZARD B — a session-scoped companion does not haunt later sessions', () => {
  const sessionSpec = {
    key: KEY, param: 'testFlag', defaultOn: false,
    companionKey: COMPANION, companionValue: 'debug', companionStorage: 'session' as const,
  }

  it('is ON within its own session — the known-positive, without which "gone" proves nothing', () => {
    const flag = stickyFlag(sessionSpec)
    url('?testFlag=debug')
    expect(flag.enabled()).toBe(true)
    expect(flag.demo()).toBe(true)
    expect(sessionStorage.getItem(COMPANION)).toBe('1')
    expect(localStorage.getItem(COMPANION)).toBeNull() // never written persistently

    // Still on across a RELOAD inside the session: it must survive the URL rewrite (hazard A) even
    // while not surviving the session (hazard B). The two requirements are not in tension.
    url('')
    flag.reset()
    expect(flag.demo()).toBe(true)
  })

  // ⚠ THIS CASE CANNOT CARRY THE HAZARD ON ITS OWN, and that is worth knowing before trusting it.
  // Run mutant B (`const cs = s`) and the "is gone" assertion below still PASSES — because the
  // purge then removes the wrongly-persisted companion on the very next resolve, so the overlay
  // reads false either way. The mechanism that would cause the bug also hides it. The `localStorage
  // is null WHILE IT IS ON` assertion is what actually discriminates, which is why it is repeated
  // here rather than left to the known-positive above.
  it('is GONE in a new browser session, while the feature it implies stays on', () => {
    const flag = stickyFlag(sessionSpec)
    url('?testFlag=debug')
    expect(flag.demo()).toBe(true)
    expect(localStorage.getItem(COMPANION)).toBeNull() // the discriminating assertion

    sessionStorage.clear() // a new browser session; localStorage is untouched
    url('')
    flag.reset()
    expect(flag.demo()).toBe(false)  // the overlay does not come back
    expect(flag.enabled()).toBe(true) // but the feature it turned on is still on
  })

  it('PURGES a stale persistent copy — the flag that was already haunting when the rule landed', () => {
    localStorage.setItem(COMPANION, '1') // written by the old, buggy build
    const flag = stickyFlag(sessionSpec)
    url('')
    expect(flag.demo()).toBe(false)
    expect(localStorage.getItem(COMPANION)).toBeNull()
  })

  it('THE MATCHED CONTROL: the identical flag with a LOCAL companion DOES survive the new session', () => {
    const flag = stickyFlag({ ...sessionSpec, companionStorage: 'local' })
    url('?testFlag=debug')
    expect(flag.demo()).toBe(true)
    expect(localStorage.getItem(COMPANION)).toBe('1')

    sessionStorage.clear()
    url('')
    flag.reset()
    expect(flag.demo()).toBe(true) // persists, because that is what 'local' means
  })
})

// ─── SSR / prerender ─────────────────────────────────────────────────────────────────────────
// `typeof window === 'undefined'` returning the wrong default bakes a flag state into prerendered
// HTML. The environment test is the STORE, not the window — three shipped flags read the bare
// globals and never mention window at all.
describe('no store — SSR, prerender, node', () => {
  function withNoStore(run: () => void): void {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined })
      run()
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  }

  it('takes the flag default when there is no store at all', () => {
    withNoStore(() => {
      expect(stickyFlag({ key: KEY, defaultOn: true }).enabled()).toBe(true)
      expect(stickyFlag({ key: KEY, defaultOn: false }).enabled()).toBe(false)
    })
  })

  it('takes onNoWindow over the default where a flag asks for it, and it is INDEPENDENT of onFault', () => {
    withNoStore(() => {
      // The live-framing flag's shape: prerender must not bake framing in, but a private window
      // must still get the feature. The two environment failures answer opposite ways.
      const flag = stickyFlag({ key: KEY, defaultOn: true, onFault: true, onNoWindow: false })
      expect(flag.enabled()).toBe(false)
    })
  })

  it('writes nothing when there is no store — a prerender must not try to persist', () => {
    url('?testFlag=1')
    withNoStore(() => {
      stickyFlag({ key: KEY, param: 'testFlag', defaultOn: false }).enabled()
    })
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

// ─── denied storage ──────────────────────────────────────────────────────────────────────────
describe('a store that throws — private mode, blocked site data', () => {
  function withDeniedStore(run: () => void): void {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => { throw new Error('denied') },
          setItem: () => { throw new Error('denied') },
          removeItem: () => { throw new Error('denied') },
        },
      })
      run()
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  }

  it('never throws, and takes onFault — which is the default but need not be', () => {
    withDeniedStore(() => {
      expect(stickyFlag({ key: KEY, defaultOn: true }).enabled()).toBe(true)
      // The ledger flag's shape: default ON, but OFF where it cannot read the writer's choice,
      // because it gates work on the keystroke path.
      expect(stickyFlag({ key: KEY, defaultOn: true, onFault: false }).enabled()).toBe(false)
    })
  })

  it('a denied store is a FAULT, not the no-store case — they can answer differently', () => {
    withDeniedStore(() => {
      const flag = stickyFlag({ key: KEY, defaultOn: true, onFault: true, onNoWindow: false })
      expect(flag.enabled()).toBe(true) // onFault, not onNoWindow
    })
  })
})

// ─── the remaining axes ──────────────────────────────────────────────────────────────────────
describe('the param rules', () => {
  it('`exact1` ignores a bare param and any other value', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: false })
    url('?testFlag')
    expect(flag.enabled()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull() // and writes nothing
    flag.reset()
    url('?testFlag=yes')
    expect(flag.enabled()).toBe(false)
  })

  it('`present` enables on a bare param and on any value that is not an off value', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: false, onParam: 'present', cache: false })
    url('?testFlag')
    expect(flag.enabled()).toBe(true)
    localStorage.clear()
    url('?testFlag=yes')
    expect(flag.enabled()).toBe(true)
    localStorage.clear()
    // `off` is checked FIRST, or off would mean on under a presence rule.
    url('?testFlag=off')
    expect(flag.enabled()).toBe(false)
  })

  it('extra off values are honoured, and only the declared ones', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: true, offValues: ['off', '0'], cache: false })
    url('?testFlag=0')
    expect(flag.enabled()).toBe(false)
    localStorage.clear()
    url('?testFlag=no')
    expect(flag.enabled()).toBe(true) // not an off value; the default stands
  })

  it('`onWrite: clear` re-arms by removing the key rather than writing "1"', () => {
    const flag = stickyFlag({ key: KEY, param: 'testFlag', defaultOn: true, onWrite: 'clear', cache: false })
    localStorage.setItem(KEY, '0')
    url('?testFlag=1')
    expect(flag.enabled()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('a storage-only flag (no param) reads storage and writes nothing', () => {
    const flag = stickyFlag({ key: KEY, defaultOn: true })
    url('?testFlag=off') // present in the URL, and deliberately not consulted
    expect(flag.enabled()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('caching', () => {
  it('cached: a mid-session storage change is not seen until reset', () => {
    const flag = stickyFlag({ key: KEY, defaultOn: false })
    expect(flag.enabled()).toBe(false)
    localStorage.setItem(KEY, '1')
    expect(flag.enabled()).toBe(false)
    flag.reset()
    expect(flag.enabled()).toBe(true)
  })

  it('uncached: it is seen immediately — what AccountControl and SourceBrowser rely on', () => {
    const flag = stickyFlag({ key: KEY, defaultOn: false, cache: false })
    expect(flag.enabled()).toBe(false)
    localStorage.setItem(KEY, '1')
    expect(flag.enabled()).toBe(true)
  })
})

describe('set / setCachedOnly / overrides', () => {
  it('set writes an explicit "1"/"0" and clears the companion when off', () => {
    const flag = stickyFlag({ key: KEY, defaultOn: true, companionKey: COMPANION })
    localStorage.setItem(COMPANION, '1')
    flag.set(false)
    expect(flag.enabled()).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('0')
    expect(localStorage.getItem(COMPANION)).toBeNull()
    flag.set(true)
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('setCachedOnly moves the answer without touching storage', () => {
    const flag = stickyFlag({ key: KEY, defaultOn: true })
    flag.setCachedOnly(false)
    expect(flag.enabled()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('a window override beats storage in both directions; a non-boolean is ignored', () => {
    const w = window as unknown as Record<string, unknown>
    const flag = stickyFlag({ key: KEY, defaultOn: true, override: '__iwTest' })
    localStorage.setItem(KEY, '0')
    expect(flag.enabled()).toBe(false)
    w.__iwTest = true
    expect(flag.enabled()).toBe(true)
    w.__iwTest = false
    flag.reset()
    localStorage.removeItem(KEY)
    expect(flag.enabled()).toBe(false)
    w.__iwTest = 'yes' // not a boolean: the seam is not armed
    expect(flag.enabled()).toBe(true)
    delete w.__iwTest
  })
})
