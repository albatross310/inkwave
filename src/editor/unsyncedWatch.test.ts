// Keepers for the unsynced-work notice (Peter's 5-minute warning).
//
// WHY THESE EXIST, and why they are unit tests rather than another browser probe: CLAUDE.md round
// 12 — "this codebase is excellent at ESTABLISHING truth and has no mechanism for KEEPING it. A
// browser probe needs a build, a server and a burst; it proves a thing once, is not in
// package.json, and six weeks later a proof that ran once is indistinguishable from one that never
// ran." The two properties Peter actually asked for — never fire when sync is on, never nag — are
// one-line rules, so they get assertions that run in milliseconds on every `pnpm test`.
//
// MUTATION-TESTED, following provenance/diffCache.test.ts. Each of these was injected into
// shouldWarnUnsynced/unsyncedReducer and the named tests FAIL, so these are not decoration:
//   · drop `if (o.syncActive) return false`            → "never fires while sync is active" fails
//   · drop `if (o.dismissed) return false`             → "never nags once waved away" fails
//   · `>=` → `>` with an exact-boundary now            → "fires at exactly five minutes" fails
//   · reducer 'edit' restarts the clock each edit      → "clock does not restart" fails
//   · reducer 'sync-active' keeps `dismissed: true`    → "sync lapsing re-arms" fails
//   · `firstUnsyncedEditAt === null` guard removed     → "does not warn before any edit" fails
// A keeper that has never been shown to fail is the same disease one level up.

import { describe, it, expect } from 'vitest'
import {
  shouldWarnUnsynced,
  unsyncedReducer,
  initialUnsyncedState,
  UNSYNCED_WARN_MS,
  type UnsyncedState,
} from './unsyncedWatch'

const T0 = 1_700_000_000_000
const base = { syncActive: false, firstUnsyncedEditAt: T0, dismissed: false, now: T0 }

describe('shouldWarnUnsynced', () => {
  it('never fires while sync is active — however long the writer has been at it', () => {
    // THE clause Peter named: "It must not fire when sync IS active."
    expect(shouldWarnUnsynced({ ...base, syncActive: true, now: T0 + UNSYNCED_WARN_MS * 100 })).toBe(false)
  })

  it('never nags once waved away', () => {
    expect(shouldWarnUnsynced({ ...base, dismissed: true, now: T0 + UNSYNCED_WARN_MS * 100 })).toBe(false)
  })

  it('does not warn before any edit — an untouched page is not unsynced work', () => {
    expect(shouldWarnUnsynced({ ...base, firstUnsyncedEditAt: null, now: T0 + UNSYNCED_WARN_MS * 100 })).toBe(false)
  })

  it('stays quiet for the first five minutes', () => {
    expect(shouldWarnUnsynced({ ...base, now: T0 })).toBe(false)
    expect(shouldWarnUnsynced({ ...base, now: T0 + UNSYNCED_WARN_MS - 1 })).toBe(false)
  })

  it('fires at exactly five minutes, and stays fired', () => {
    expect(shouldWarnUnsynced({ ...base, now: T0 + UNSYNCED_WARN_MS })).toBe(true)
    expect(shouldWarnUnsynced({ ...base, now: T0 + UNSYNCED_WARN_MS * 10 })).toBe(true)
  })

  it('five minutes means five minutes', () => {
    expect(UNSYNCED_WARN_MS).toBe(5 * 60 * 1000)
  })
})

describe('unsyncedReducer', () => {
  it('starts the clock at the first unsynced edit', () => {
    const s = unsyncedReducer(initialUnsyncedState, { type: 'edit', now: T0, syncActive: false })
    expect(s.firstUnsyncedEditAt).toBe(T0)
  })

  it('does not start the clock for an edit made while sync is active', () => {
    const s = unsyncedReducer(initialUnsyncedState, { type: 'edit', now: T0, syncActive: true })
    expect(s.firstUnsyncedEditAt).toBeNull()
  })

  it('clock does not restart on later edits — steady typing must still reach the warning', () => {
    // The regression this forbids is subtle and would silently disable the feature for exactly the
    // person it is for: someone typing continuously for an hour with no sync. If each keystroke
    // reset the clock, the warning could never fire.
    let s = unsyncedReducer(initialUnsyncedState, { type: 'edit', now: T0, syncActive: false })
    for (let i = 1; i <= 50; i++) {
      s = unsyncedReducer(s, { type: 'edit', now: T0 + i * 10_000, syncActive: false })
    }
    expect(s.firstUnsyncedEditAt).toBe(T0)
    expect(shouldWarnUnsynced({ ...base, ...s, syncActive: false, now: T0 + UNSYNCED_WARN_MS })).toBe(true)
  })

  it('sync going live clears the clock', () => {
    const typed = unsyncedReducer(initialUnsyncedState, { type: 'edit', now: T0, syncActive: false })
    const synced = unsyncedReducer(typed, { type: 'sync-active' })
    expect(synced).toEqual(initialUnsyncedState)
    expect(shouldWarnUnsynced({ ...base, ...synced, now: T0 + UNSYNCED_WARN_MS * 10 })).toBe(false)
  })

  it('sync lapsing re-arms the notice even after a previous dismissal', () => {
    // Waving it away is about THIS situation. If sync was set up and later broke, that is a new
    // situation and silence would be the dangerous answer.
    let s: UnsyncedState = { firstUnsyncedEditAt: T0, dismissed: true }
    s = unsyncedReducer(s, { type: 'sync-active' })
    expect(s.dismissed).toBe(false)
    s = unsyncedReducer(s, { type: 'edit', now: T0 + 1000, syncActive: false })
    expect(shouldWarnUnsynced({ ...base, ...s, now: T0 + 1000 + UNSYNCED_WARN_MS })).toBe(true)
  })

  it('switching documents is a fresh judgement', () => {
    const s: UnsyncedState = { firstUnsyncedEditAt: T0, dismissed: true }
    expect(unsyncedReducer(s, { type: 'doc-switch' })).toEqual(initialUnsyncedState)
  })

  it('dismiss silences a warning that is currently showing', () => {
    let s = unsyncedReducer(initialUnsyncedState, { type: 'edit', now: T0, syncActive: false })
    expect(shouldWarnUnsynced({ ...base, ...s, now: T0 + UNSYNCED_WARN_MS })).toBe(true)
    s = unsyncedReducer(s, { type: 'dismiss' })
    expect(shouldWarnUnsynced({ ...base, ...s, now: T0 + UNSYNCED_WARN_MS })).toBe(false)
  })
})
