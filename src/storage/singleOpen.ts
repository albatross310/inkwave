// SINGLE-OPEN COORDINATION — the same-device handshake behind "This document is open in another
// window" and its three actions (Switch to it / Open a copy / Take over here). The layer ABOVE
// tabDoc.ts's Web Lock: a second tab is offered a choice rather than silently opened elsewhere.
//
// ⚠ THE ONE INVARIANT: on a take-over the LOSING tab stops writing BEFORE the WINNING tab starts,
// enforced by an ACK rather than asserted:
//   holder receives take-over → flush pending body → FREEZE writes → post 'surrendered'
//   taker posts take-over → AWAIT 'surrendered' → steal the lock → only now open + write
// (storage/opfs.ts `freezeDocWrites` is the byte-level stop.)
//
// ⚠ DEGRADE, NEVER DEAD-END. With no BroadcastChannel the take-over still STEALS the lock and the
// loser freezes on the rejection — best-effort, a rescue of a possibly-dead holder. An engine with
// neither primitive falls back to tabDoc's behaviour; never a hard block.
//
// Every side effect is injected (`Wiring`), so the ordering is provable at the unit level with an
// in-memory bus — no browser, no real Web Locks.
// → docs/archive/storage-and-sync.md#so-ack-ordering

import { flushPendingSave, freezeDocWrites } from './opfs'
import { stealDocLock, onDocLockLost } from './tabDoc'

export type SingleOpenMessage =
  | { type: 'focus'; id: string }        // taker → holder: come forward (window.focus)
  | { type: 'take-over'; id: string }    // taker → holder: surrender, I'm taking this
  | { type: 'surrendered'; id: string }  // holder → taker: I have frozen + flushed; safe to proceed

/** The minimal message bus this module needs — a thin seam over BroadcastChannel so tests can supply
 *  a deterministic in-memory bus instead. `null` from `makeChannel` means "no bus available". */
export interface Channel {
  post(msg: SingleOpenMessage): void
  onMessage(cb: (msg: SingleOpenMessage) => void): void
  close(): void
}

export interface Wiring {
  /** Persist any debounced body NOW (opfs.flushPendingSave). May throw; the holder logs and proceeds. */
  flush: () => Promise<boolean>
  /** Make this tab read-only for `id` at the write funnel (opfs.freezeDocWrites). */
  freeze: (id: string) => void
  /** Physically take `id`'s Web Lock for this tab (tabDoc.stealDocLock). */
  steal: (id: string) => Promise<boolean>
  /** A fresh message channel, or null when none is available. */
  makeChannel: () => Channel | null
  /** Register the "our lock was stolen" notification (tabDoc.onDocLockLost). */
  onLockLost: (cb: (id: string) => void) => void
  /** Bring this window forward (window.focus). Best-effort; browsers may refuse cross-tab focus. */
  focusSelf: () => void
  /** Tell the rest of THIS tab it just went read-only (a window CustomEvent). */
  emitSurrendered: (id: string) => void
  /** How long the taker waits for the surrender ack before falling back to a rescue steal. */
  ackTimeoutMs: number
  /**
   * After an ack TIMEOUT, how long the taker keeps listening (post-steal, before it reads the body)
   * for a LATE `surrendered`. ⚠ It closes the race where a LIVE holder is still inside its flush when
   * the timer fires — waiting means the caller reads AFTER that holder's freeze. A dead holder never
   * posts and the grace expires. → docs/archive/storage-and-sync.md#so-ack-timeout-grace
   */
  graceMs: number
  /** setTimeout seam; returns a cancel fn. */
  setTimer: (fn: () => void, ms: number) => () => void
}

const CHANNEL_NAME = 'inkwave:single-open'

/** Whether the coordinated (choice-offering) path is available at all. Without a bus a take-over can
 *  still steal, but Switch-to-it (focus) and the ordered handshake cannot run. */
export function singleOpenSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

function realChannel(): Channel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const bc = new BroadcastChannel(CHANNEL_NAME)
  return {
    post: (msg) => bc.postMessage(msg),
    onMessage: (cb) => { bc.onmessage = (e) => cb(e.data as SingleOpenMessage) },
    close: () => bc.close(),
  }
}

export function defaultWiring(): Wiring {
  return {
    flush: flushPendingSave,
    freeze: freezeDocWrites,
    steal: stealDocLock,
    makeChannel: realChannel,
    onLockLost: onDocLockLost,
    focusSelf: () => { try { window.focus() } catch { /* focus may be refused */ } },
    emitSurrendered: (id) => {
      try { window.dispatchEvent(new CustomEvent('inkwave:doc-surrendered', { detail: { id } })) } catch { /* no window */ }
    },
    ackTimeoutMs: 2500,
    graceMs: 1500,
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
  }
}

// ─── Holder side ───────────────────────────────────────────────────────────────

/**
 * Run while THIS tab holds `id`. Listens for another tab asking it to come forward or to surrender,
 * and freezes on a lock steal even when no bus delivered a take-over. Returns an uninstaller; call it
 * when the tab stops holding `id` (document switch, unmount).
 *
 * ⚠ TWO FLAVOURS OF SURRENDER, AND ONLY ONE OF THEM FLUSHES:
 *   · GRACEFUL (a 'take-over' message): flush FIRST, while writes are still allowed, THEN freeze,
 *     THEN ack — so the holder's final keystrokes survive with zero overwrite risk.
 *   · FORCED (the lock was stolen with no handshake — a dead/hung tab): freeze ONLY, NEVER flush.
 *     The taker may already be writing, so a late flush from us is the overwrite we forbid.
 * → docs/archive/storage-and-sync.md#so-two-surrenders
 */
export function installHolder(id: string, w: Wiring = defaultWiring()): () => void {
  const ch = w.makeChannel()
  let surrendered = false

  async function surrender(flush: boolean): Promise<void> {
    if (surrendered) return
    surrendered = true
    if (flush) {
      // ⚠ Flush BEFORE freezing — the flush routes through saveDocument, which the freeze refuses.
      // A failure never blocks the handoff: the taker opens the previously saved state, which is
      // safe, just missing the last unsaved edit.
      try { await w.flush() } catch (e) { console.error('[inkwave] surrender flush failed:', e) }
    }
    w.freeze(id)            // hard stop: no new body for `id` can be persisted from this tab
    w.emitSurrendered(id)   // the editor goes read-only; a banner explains why
    ch?.post({ type: 'surrendered', id }) // the ACK — the taker was waiting on exactly this
  }

  ch?.onMessage((msg) => {
    if (msg.id !== id) return
    if (msg.type === 'focus') w.focusSelf()
    else if (msg.type === 'take-over') void surrender(true)
  })

  // Belt-and-braces (and the ONLY signal on the no-bus path): a steal freezes us with no flush.
  w.onLockLost((lostId) => { if (lostId === id) void surrender(false) })

  return () => ch?.close()
}

// ─── Taker side (the blocked screen's three actions) ────────────────────────────

/** "Switch to it" — ask the holder to bring its window forward, then back off. Fire-and-forget: the
 *  holder may not be ABLE to focus itself (browser policy), which is why the blocked screen keeps
 *  its other two actions available. */
export function requestSwitch(id: string, w: Wiring = defaultWiring()): void {
  const ch = w.makeChannel()
  if (!ch) return
  ch.post({ type: 'focus', id })
  // Give the message time to deliver before dropping the channel.
  w.setTimer(() => ch.close(), 1000)
}

/**
 * "Take over here" — the safe handoff. Posts a take-over, WAITS for the holder's surrender ack, then
 * steals the lock. Resolves once it is safe for the caller to read + write `id`.
 *
 * ⚠ AFTER AN ACK TIMEOUT, STEAL AND THEN WAIT A GRACE. The timer can fire while a LIVE holder is
 * still inside its flush, and a steal cannot force an early freeze; returning immediately would let
 * the caller read a body the holder is still about to write. A slow-flusher posts the LATE
 * `surrendered` once frozen, so the grace guarantees the read happens after the freeze; a dead
 * holder never posts and it expires. → docs/archive/storage-and-sync.md#so-ack-timeout-grace
 */
export async function takeOverHere(id: string, w: Wiring = defaultWiring()): Promise<void> {
  const ch = w.makeChannel()
  if (!ch) { await w.steal(id); return } // no bus — nothing to coordinate with; rescue steal

  // ONE persistent listener for the whole handoff: `acked` records a `surrendered` whenever it lands
  // and `onAck` wakes whichever phase is waiting. ⚠ Recording it even when NO phase waits closes the
  // gap where the late ack arrives DURING the steal, between the two waits below.
  let acked = false
  let onAck: (() => void) | null = null
  ch.onMessage((msg) => {
    if (msg.id === id && msg.type === 'surrendered') { acked = true; onAck?.() }
  })

  // Phase 1 — post the take-over, await the ack or the ack timeout.
  await new Promise<void>((resolve) => {
    if (acked) { resolve(); return }
    let done = false
    const finish = () => { if (done) return; done = true; cancel(); onAck = null; resolve() }
    onAck = finish
    const cancel = w.setTimer(finish, w.ackTimeoutMs)
    ch.post({ type: 'take-over', id })
  })

  if (acked) {
    // The holder froze + flushed before acking — safe to take the lock and let the caller read.
    ch.close()
    await w.steal(id)
    return
  }

  // Phase 2 — TIMED OUT. Steal to take physical ownership, then (unless the late ack already arrived
  // during the steal) wait a brief grace for it, so a live slow-flusher's freeze precedes the caller's
  // read. A dead holder never posts; the grace expires and the rescue proceeds.
  await w.steal(id)
  if (!acked) {
    await new Promise<void>((resolve) => {
      if (acked) { resolve(); return }
      let done = false
      const finish = () => { if (done) return; done = true; cancel(); onAck = null; resolve() }
      onAck = finish
      const cancel = w.setTimer(finish, w.graceMs)
    })
  }
  ch.close()
}
