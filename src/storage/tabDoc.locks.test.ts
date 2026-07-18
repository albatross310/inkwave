// @vitest-environment jsdom
//
// THE LOCK LAYER of single-open: does a second tab actually get REFUSED a document a live tab holds
// (invariant a — "a second tab opening a locked doc is BLOCKED"), and does the outgoing holder learn
// when its lock is STOLEN (the signal that drives the take-over freeze)? Web Locks is engine code, so
// this drives claimDocLock/stealDocLock against a faithful IN-PROCESS fake LockManager that models
// the two behaviours this module depends on: `ifAvailable` returns a null lock when the name is held,
// and `steal` rejects the previous holder's request promise with an AbortError.
//
// MUTATION-PROVED:
//   · delete `if (!lock) { done(false); return }` in tryClaimOnce
//        ⇒ a null (preempted) lock is treated as granted, so "a held document is refused" fails.
//   · delete `if (granted) { held.delete(id); lostLockCb?.(id) }` in the steal catch
//        ⇒ "a steal notifies the outgoing holder" fails.

import { describe, it, expect, vi } from 'vitest'

interface FakeReq { reject: (e: unknown) => void }

/** An in-process LockManager modelling exactly what tabDoc.ts relies on. A never-resolving callback
 *  keeps a lock held, standing in for another live tab. */
function makeFakeLocks() {
  const holders = new Map<string, FakeReq>()
  return {
    holders,
    query: async () => ({ held: [...holders.keys()].map((name) => ({ name })) }),
    request(name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => unknown) {
      const isHeld = holders.has(name)
      if (opts.ifAvailable && isHeld) return Promise.resolve(cb(null)) // preempted → null lock
      if (opts.steal && isHeld) {
        const prev = holders.get(name)!
        holders.delete(name)
        prev.reject(new DOMException('lock stolen', 'AbortError'))
      }
      return new Promise((resolveOuter, rejectOuter) => {
        holders.set(name, { reject: rejectOuter })
        Promise.resolve(cb({ name })).then(
          () => { holders.delete(name); resolveOuter(undefined) },
          rejectOuter,
        )
      })
    },
  }
}

/** A fresh tabDoc module with the fake installed — module-global lock state (`held`, `lostLockCb`)
 *  must not leak between cases. */
async function freshTabDoc(fake: ReturnType<typeof makeFakeLocks>) {
  vi.resetModules()
  Object.defineProperty(navigator, 'locks', { value: fake, configurable: true })
  return await import('./tabDoc')
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

describe('single-open lock layer', () => {
  it('a second tab is REFUSED a document a live tab already holds (invariant a)', async () => {
    const fake = makeFakeLocks()
    const td = await freshTabDoc(fake)
    // Another live tab holds it (a callback that never resolves keeps the lock).
    void fake.request(td.docLockName('doc1'), {}, () => new Promise<void>(() => {})).catch(() => {})
    // waitMs 0: don't retry — the point is that a held document is refused, not the reload race.
    expect(await td.claimDocLock('doc1', 0)).toBe(false)
    expect(td.heldDocIds()).not.toContain('doc1')
  })

  it('an unheld document is granted, and this tab records the hold', async () => {
    const fake = makeFakeLocks()
    const td = await freshTabDoc(fake)
    expect(await td.claimDocLock('doc2', 0)).toBe(true)
    expect(td.heldDocIds()).toContain('doc2')
  })

  it('a steal notifies the outgoing holder (the take-over freeze signal)', async () => {
    const fake = makeFakeLocks()
    const td = await freshTabDoc(fake)
    expect(await td.claimDocLock('doc3', 0)).toBe(true)
    const lost = vi.fn()
    td.onDocLockLost(lost)
    // Another tab steals it — our request promise rejects, which tabDoc reads as "we lost it".
    void fake.request(td.docLockName('doc3'), { steal: true }, () => new Promise<void>(() => {})).catch(() => {})
    await flushMicrotasks()
    expect(lost).toHaveBeenCalledWith('doc3')
    expect(td.heldDocIds()).not.toContain('doc3')
  })

  it('stealDocLock takes a held document for this tab', async () => {
    const fake = makeFakeLocks()
    const td = await freshTabDoc(fake)
    void fake.request(td.docLockName('doc4'), {}, () => new Promise<void>(() => {})).catch(() => {})
    expect(await td.claimDocLock('doc4', 0)).toBe(false) // held by the other tab
    expect(await td.stealDocLock('doc4')).toBe(true)
    expect(td.heldDocIds()).toContain('doc4')
  })
})

describe('isExplicitDocIntent — who gets the blocked screen', () => {
  it('an explicit open (a link, or this tab’s own identity) is offered the choice', async () => {
    const td = await import('./tabDoc')
    expect(td.isExplicitDocIntent('url')).toBe(true)
    expect(td.isExplicitDocIntent('tab')).toBe(true)
  })
  it('a hint-only new tab falls through instead of being blocked on a doc it didn’t choose', async () => {
    const td = await import('./tabDoc')
    expect(td.isExplicitDocIntent('last-hint')).toBe(false)
    expect(td.isExplicitDocIntent('none')).toBe(false)
  })
})
