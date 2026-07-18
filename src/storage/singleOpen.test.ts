// THE TAKE-OVER HANDSHAKE — proven at the unit level, no browser, no real Web Locks. The one
// invariant: on a take-over the LOSING tab stops writing BEFORE the WINNING tab proceeds. Everything
// here drives the real installHolder / takeOverHere / requestSwitch with an in-memory message bus and
// injected side effects, so the ORDERING is observed, not asserted in a comment.
//
// MUTATION-PROVED (each named mutation kills the listed test):
//   · delete `w.freeze(id)` from surrender()
//        ⇒ "the loser freezes before the taker proceeds" fails (no freeze recorded).
//   · reorder to freeze BEFORE flush in the graceful path
//        ⇒ "the graceful surrender flushes, then freezes, then acks" fails.
//   · delete the `w.onLockLost(...)` registration in installHolder
//        ⇒ "a stolen lock freezes the holder with no take-over message" fails.
//   · make the lock-lost path flush (surrender(true) instead of surrender(false))
//        ⇒ "a forced surrender does NOT flush" fails.
//   · make takeOverHere skip the steal
//        ⇒ "a degraded take-over (no bus) still steals" and "a dead holder is taken over after the
//           ack timeout + grace expiry" fail.
//   · delete the phase-2 post-steal GRACE wait in takeOverHere (the auditor's race, back)
//        ⇒ "a LIVE slow-flusher past the ack timeout: the taker reads AFTER the holder freezes" fails.

import { describe, it, expect } from 'vitest'
import { installHolder, takeOverHere, requestSwitch, type Wiring, type Channel, type SingleOpenMessage } from './singleOpen'

/** An in-process stand-in for BroadcastChannel: a post reaches every OTHER channel on the bus,
 *  asynchronously (a microtask), exactly like the real thing — never the poster itself. */
function makeBus() {
  const chans: { id: number; deliver: (m: SingleOpenMessage) => void }[] = []
  let nextId = 0
  return {
    makeChannel(): Channel {
      const id = nextId++
      let cb: ((m: SingleOpenMessage) => void) | null = null
      const rec = { id, deliver: (m: SingleOpenMessage) => cb?.(m) }
      chans.push(rec)
      return {
        post: (msg) => { for (const c of chans) if (c.id !== id) queueMicrotask(() => c.deliver(msg)) },
        onMessage: (fn) => { cb = fn },
        close: () => { const i = chans.indexOf(rec); if (i >= 0) chans.splice(i, 1) },
      }
    },
  }
}

/** A wiring whose every effect appends to a shared ordered log, so happened-before is observable. */
function makeWiring(log: string[], over: Partial<Wiring> = {}): Wiring {
  return {
    flush: async () => { log.push('flush'); return true },
    freeze: (id) => { log.push('freeze:' + id) },
    steal: async (id) => { log.push('steal:' + id); return true },
    makeChannel: () => null,
    onLockLost: () => {},
    focusSelf: () => { log.push('focus') },
    emitSurrendered: (id) => { log.push('surrendered:' + id) },
    ackTimeoutMs: 1000,
    graceMs: 50, // short so the dead-holder rescue tests don't crawl; the race test overrides it
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
    ...over,
  }
}

describe('the single-open take-over handshake', () => {
  it('the loser freezes before the taker proceeds (the whole invariant)', async () => {
    const bus = makeBus()
    const log: string[] = []
    installHolder('X', makeWiring(log, { makeChannel: bus.makeChannel }))
    await takeOverHere('X', makeWiring(log, { makeChannel: bus.makeChannel }))
    // By the time the taker's promise resolves, the holder MUST already be frozen, and the freeze
    // MUST precede the taker's steal (the taker's "start").
    expect(log).toContain('freeze:X')
    expect(log.indexOf('freeze:X')).toBeLessThan(log.indexOf('steal:X'))
  })

  it('the graceful surrender flushes, then freezes, then acks — in that order', async () => {
    const bus = makeBus()
    const log: string[] = []
    installHolder('X', makeWiring(log, { makeChannel: bus.makeChannel }))
    await takeOverHere('X', makeWiring(log, { makeChannel: bus.makeChannel }))
    // flush (last body persisted while still allowed) → freeze (hard stop) → surrendered (the ack).
    expect(log.indexOf('flush')).toBeLessThan(log.indexOf('freeze:X'))
    expect(log.indexOf('freeze:X')).toBeLessThan(log.indexOf('surrendered:X'))
    // The ack precedes the taker's steal, so the loser is frozen before the winner owns the lock.
    expect(log.indexOf('surrendered:X')).toBeLessThan(log.indexOf('steal:X'))
  })

  it('a holder ignores a take-over aimed at a DIFFERENT document', async () => {
    const bus = makeBus()
    const log: string[] = []
    installHolder('A', makeWiring(log, { makeChannel: bus.makeChannel }))
    // No holder for 'B', so no ack ever comes — keep the timeout short so the test isn't slow.
    await takeOverHere('B', makeWiring(log, { makeChannel: bus.makeChannel, ackTimeoutMs: 20 }))
    expect(log).not.toContain('freeze:A')
    expect(log).not.toContain('surrendered:A')
  })

  it('a stolen lock freezes the holder with no take-over message (belt-and-braces)', async () => {
    const log: string[] = []
    const lost: { cb: ((id: string) => void) | null } = { cb: null }
    installHolder('Y', makeWiring(log, { onLockLost: (cb) => { lost.cb = cb } }))
    lost.cb?.('Y')
    await Promise.resolve(); await Promise.resolve()
    expect(log).toContain('freeze:Y')
  })

  it('a forced surrender (stolen lock) does NOT flush — a late write would be the overwrite we forbid', async () => {
    const log: string[] = []
    const lost: { cb: ((id: string) => void) | null } = { cb: null }
    installHolder('Y', makeWiring(log, { onLockLost: (cb) => { lost.cb = cb } }))
    lost.cb?.('Y')
    await Promise.resolve(); await Promise.resolve()
    expect(log).not.toContain('flush')
  })

  it('"Switch to it" asks the holder to bring its window forward', async () => {
    const bus = makeBus()
    const log: string[] = []
    installHolder('Z', makeWiring(log, { makeChannel: bus.makeChannel }))
    requestSwitch('Z', makeWiring(log, { makeChannel: bus.makeChannel }))
    await Promise.resolve(); await Promise.resolve()
    expect(log).toContain('focus')
    // A focus request must never freeze or steal — nothing changes in the holder.
    expect(log).not.toContain('freeze:Z')
  })

  it('a degraded take-over (no bus) still steals the lock — never a dead end', async () => {
    const log: string[] = []
    await takeOverHere('W', makeWiring(log, { makeChannel: () => null }))
    expect(log).toContain('steal:W')
  })

  it('a dead holder is taken over after the ack timeout + grace expiry (rescue path)', async () => {
    const bus = makeBus()
    const log: string[] = []
    // A bus exists but NOBODY is holding 'D', so no ack ever comes — the taker times out, steals, and
    // the post-steal grace EXPIRES (no late surrendered), then the rescue proceeds. Without this the
    // writer could never reopen a document a crashed tab left locked.
    await takeOverHere('D', makeWiring(log, { makeChannel: bus.makeChannel, ackTimeoutMs: 20, graceMs: 20 }))
    expect(log).toContain('steal:D')
  })

  // THE AUDITOR'S RACE (reproduced, then closed). The ack timer fires while a LIVE holder is still
  // inside an in-flight flush — before it freezes. Without the post-steal grace the taker resolves at
  // the timeout and the caller READS the body while the holder's write is still in flight; the
  // holder's write then lands after the read and the caller's later save overwrites it. The
  // singleOpen mutant that reintroduces the bug (delete the phase-2 grace wait) kills THIS test.
  it('a LIVE slow-flusher past the ack timeout: the taker reads AFTER the holder freezes', async () => {
    const bus = makeBus()
    const log: string[] = []
    let releaseFlush = () => {}
    const flushGate = new Promise<void>((r) => { releaseFlush = r })
    // The holder's flush is still IN FLIGHT when the ack timer fires — the contended-disk case.
    installHolder('X', makeWiring(log, {
      makeChannel: bus.makeChannel,
      flush: async () => { log.push('flush-start'); await flushGate; log.push('flush-end'); return true },
    }))
    // ackTimeout (20ms) is shorter than the gated flush; grace (500ms) outlasts the released flush.
    // The caller "reads" the body the instant takeOverHere resolves — modelled as the 'read:X' mark.
    const taker = takeOverHere('X', makeWiring(log, { makeChannel: bus.makeChannel, ackTimeoutMs: 20, graceMs: 500 }))
      .then(() => log.push('read:X'))
    // Let the ack timer fire while the flush is still gated (holder unfrozen, write in flight).
    await new Promise((r) => setTimeout(r, 60))
    // Mid-flight: the taker must be parked in the grace, not resolved — and nothing frozen yet.
    expect(log).not.toContain('read:X')
    expect(log).not.toContain('freeze:X')
    // The slow write lands: flush completes, the holder freezes and posts the late surrendered.
    releaseFlush()
    await taker
    // THE INVARIANT: the caller reads only AFTER the holder froze — no in-flight write can overwrite.
    expect(log).toContain('freeze:X')
    expect(log.indexOf('freeze:X')).toBeLessThan(log.indexOf('read:X'))
  })
})
