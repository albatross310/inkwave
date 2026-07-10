// Snapshot-scrub render cache + read-ahead. The expensive per-scrub-step work in the snapshot
// view is NOT loading the snapshot (the raw list is eager, write-through `_snapCache`) — it's
// computing the word-level diff: two pmToText extractions + an LCS over the whole document, per
// step. This module caches that (LRU) and precomputes a ±PRELOAD_RADIUS window around the
// current position in IDLE time, so a fast hard scrub hits only cache and every frame paints a
// fully-formed snapshot instantly.
//
// Memory: ops arrays hold roughly both documents' text → the LRU caps keep this to a few MB even
// for thesis-sized documents. All pure/framework-free.

import type { Snapshot } from '../types/document'
import { pmToText } from './bundle'
import { diffWords, splitChangesAtReturns, type DiffOp } from './diff'

const TEXT_CACHE_MAX = 90 // per-snapshot pmToText (resolveCitations:true — the display form)
const OPS_CACHE_MAX = 60  // per adjacent-pair diff ops (LRU beyond ~50, per the memory budget)

const textCache = new Map<string, string>()
const opsCache = new Map<string, DiffOp[]>()

function lruGet<V>(m: Map<string, V>, k: string): V | undefined {
  const v = m.get(k)
  if (v !== undefined) { m.delete(k); m.set(k, v) }
  return v
}
function lruSet<V>(m: Map<string, V>, k: string, v: V, max: number): void {
  m.set(k, v)
  while (m.size > max) m.delete(m.keys().next().value as string)
}

/** Display text of a snapshot (citations resolved), cached per snapshot id. */
export function displayTextOf(s: Snapshot): string {
  const hit = lruGet(textCache, s.id)
  if (hit !== undefined) return hit
  const t = pmToText(s.contentJson, true)
  lruSet(textCache, s.id, t, TEXT_CACHE_MAX)
  return t
}

const pairKey = (prev: Snapshot, cur: Snapshot) => `${prev.id}→${cur.id}`

/** The split word-diff between two snapshots — cache-through. null when there is no previous. */
export function opsBetween(prev: Snapshot | null, cur: Snapshot): DiffOp[] | null {
  if (!prev) return null
  const key = pairKey(prev, cur)
  const hit = lruGet(opsCache, key)
  if (hit) return hit
  const ops = splitChangesAtReturns(diffWords(displayTextOf(prev), displayTextOf(cur)))
  lruSet(opsCache, key, ops, OPS_CACHE_MAX)
  return ops
}

// ── Read-ahead ─────────────────────────────────────────────────────────────────────────────────
export const PRELOAD_RADIUS = 20 // precompute at least ±20 snapshots around the position
export const PRELOAD_REFILL = 5  // top the window back up every ~5 steps consumed

type IdleDeadline = { timeRemaining(): number }
const ric: (cb: (d: IdleDeadline) => void) => number =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => (window as Window & { requestIdleCallback(cb: (d: IdleDeadline) => void): number }).requestIdleCallback(cb)
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 40)
const cancelRic: (h: number) => void =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? (h) => (window as Window & { cancelIdleCallback(h: number): void }).cancelIdleCallback(h)
    : (h) => window.clearTimeout(h)

let idleHandle = 0
let lastList: Snapshot[] | null = null
let lastCenter = -Infinity

/**
 * Ensure the diffs for snapshots idx±PRELOAD_RADIUS are cached, filling nearest-first in idle
 * callbacks — at most ONE uncached diff per idle slot, so the pump can never block scrub input
 * (a single LCS on a long doc is tens of ms; chunking finer than one diff isn't possible).
 * Re-invoking within PRELOAD_REFILL steps of the last fill centre is a no-op.
 */
export function preloadDiffWindow(all: Snapshot[], idx: number): void {
  if (idx < 0 || all.length < 2) return
  if (all === lastList && Math.abs(idx - lastCenter) < PRELOAD_REFILL) return
  lastList = all
  lastCenter = idx
  // Nearest-first pair list: entry j = the diff between snapshots j-1 and j.
  const targets: number[] = []
  for (let d = 0; d <= PRELOAD_RADIUS; d++) {
    for (const j of d === 0 ? [idx] : [idx + d, idx - d]) {
      if (j >= 1 && j < all.length) targets.push(j)
    }
  }
  if (idleHandle) cancelRic(idleHandle)
  let ti = 0
  const pump = () => {
    idleHandle = 0
    // Skip cached pairs instantly; compute at most one new diff, then yield.
    while (ti < targets.length) {
      const j = targets[ti++]
      if (!opsCache.has(pairKey(all[j - 1], all[j]))) { opsBetween(all[j - 1], all[j]); break }
    }
    if (ti < targets.length) idleHandle = ric(pump)
  }
  idleHandle = ric(pump)
}

/** Stop any in-flight read-ahead (route unmount). */
export function cancelDiffPreload(): void {
  if (idleHandle) { cancelRic(idleHandle); idleHandle = 0 }
  lastList = null
  lastCenter = -Infinity
}
