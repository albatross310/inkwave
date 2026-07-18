// SINGLE-OPEN COORDINATION — the same-device handshake behind "This document is open in another
// window" and its three actions (Switch to it / Open a copy / Take over here).
//
// WHAT IT IS FOR (Peter, verbatim): "make it so that a device can't open the same document anywhere
// on the same device at all if it's already opened somewhere else." Two tabs editing one document
// diverge and then one blind-overwrites the other's OPFS copy (`saveDocument` is a whole-file replace
// with no union — the 2026-07-15 loss vector). tabDoc.ts already keeps ONE live tab per document via
// a Web Lock; this module is the layer ABOVE it: when a second tab finds the lock held, it does not
// silently open something else — it offers the writer a choice, and makes the "Take over here" choice
// SAFE.
//
// THE ONE INVARIANT THIS FILE EXISTS TO UPHOLD: on a take-over, the LOSING tab stops writing BEFORE
// the WINNING tab starts. Get that wrong and the take-over reproduces the exact blind overwrite the
// whole single-open mechanism prevents. The ordering is enforced by an ACK, not asserted in prose:
//   holder receives take-over → flush pending body → FREEZE writes → post 'surrendered'
//   taker posts take-over → AWAIT 'surrendered' → steal the lock → only now open + write
// The freeze is set before the ack is sent, and the taker does not write until the ack arrives, so
// the two writers can never overlap. See storage/opfs.ts `freezeDocWrites` for the byte-level stop.
//
// DEGRADE, NEVER DEAD-END. BroadcastChannel is universal on shipping engines, but if it is absent the
// take-over still works by STEALING the Web Lock — the loser's request promise rejects (tabDoc.ts
// `onDocLockLost`) and it freezes. That path has no ack to order it, so it is best-effort: it is the
// rescue of a possibly-dead holder, not the common case. Two live tabs on an engine with neither Web
// Locks nor BroadcastChannel fall back to tabDoc's existing behaviour — never a hard block.
//
// TESTABILITY: every side effect that touches OPFS, the lock, or the DOM is injected (see `Wiring`),
// so the handshake ordering is provable at the unit level with a synchronous in-memory bus and spies
// — no browser, no real Web Locks. Production binds the real primitives in `defaultWiring()`.

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
   * for a LATE `surrendered` ack. Closes the narrow race where a LIVE holder is still inside its
   * flush when the ack timer fires: a slow-flusher posts `surrendered` once its flush completes and
   * it freezes, so waiting for it means the caller reads AFTER the holder's freeze — no late-write
   * overwrite. A genuinely dead holder never posts, the grace expires, and the rescue proceeds. Kept
   * short: it only ever delays the (rare) dead-holder-with-a-bus rescue.
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
 * THE SURRENDER SEQUENCE IS THE WHOLE CORRECTNESS STORY, and the two flavours are deliberately
 * different:
 *   · GRACEFUL (a 'take-over' message): flush the last body FIRST (while writes are still allowed),
 *     THEN freeze, THEN ack. The taker waits for the ack, so this preserves the holder's final
 *     keystrokes with zero overwrite risk.
 *   · FORCED (the lock was stolen with no handshake — a rescue of a dead/hung tab): freeze ONLY, do
 *     NOT flush. The taker already owns the document and may already be writing; a late flush from us
 *     would be the overwrite we forbid. Losing the last unsaved keystrokes is the correct trade when
 *     the alternative is corrupting the taker's copy.
 */
export function installHolder(id: string, w: Wiring = defaultWiring()): () => void {
  const ch = w.makeChannel()
  let surrendered = false

  async function surrender(flush: boolean): Promise<void> {
    if (surrendered) return
    surrendered = true
    if (flush) {
      // Flush BEFORE freezing — the flush routes through saveDocument, which the freeze refuses.
      // A failure is logged but never blocks the handoff: the taker then opens the previously saved
      // state, which is safe (no overwrite), just missing the last unsaved edit.
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

/** "Switch to it" — ask the holder to bring its window forward, then this tab backs off. Fire-and-
 *  forget; the holder may not be able to focus itself (browser policy), which is why the blocked
 *  screen keeps its other two actions available. */
export function requestSwitch(id: string, w: Wiring = defaultWiring()): void {
  const ch = w.makeChannel()
  if (!ch) return
  ch.post({ type: 'focus', id })
  // Give the message time to deliver before dropping the channel.
  w.setTimer(() => ch.close(), 1000)
}

/**
 * "Take over here" — the safe handoff. Posts a take-over and WAITS for the holder's surrender ack (so
 * the loser has frozen before we do anything), then physically steals the lock. Resolves once this
 * tab holds the lock and it is safe for the caller to read + write `id`.
 *
 * THE ACK-TIMEOUT RACE (auditor, reproduced) and why the post-steal GRACE closes it. The ack timer
 * can fire while a LIVE holder is still inside `await flush()` — before it reaches its freeze. Steal-
 * and-return-immediately then lets the caller READ the body while the holder is still UNFROZEN with an
 * in-flight `saveDocument` that can land AFTER the read; the caller's later save would overwrite the
 * holder's flushed final keystrokes — the exact overwrite this mechanism exists to prevent. The steal
 * itself cannot force an early freeze: the holder's onLockLost fires `surrender(false)`, but its
 * `if (surrendered) return` guard is already tripped by the in-progress `surrender(true)`, so the
 * freeze only happens when that in-flight flush completes. So after a timeout we STEAL, then wait a
 * brief grace for the LATE `surrendered` a live slow-flusher posts once it finishes flushing and
 * freezes — guaranteeing the caller reads AFTER the freeze. A genuinely dead holder never posts; the
 * grace expires and the rescue proceeds exactly as before. Degraded (no bus): steal only, as before.
 */
export async function takeOverHere(id: string, w: Wiring = defaultWiring()): Promise<void> {
  const ch = w.makeChannel()
  if (!ch) { await w.steal(id); return } // no bus — nothing to coordinate with; rescue steal

  // ONE persistent listener for the whole handoff: `acked` records a `surrendered` whenever it lands,
  // and `onAck` wakes whichever phase is currently waiting. Recording it even when no phase waits
  // closes the gap where the late ack arrives DURING the steal (between the two waits below).
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
