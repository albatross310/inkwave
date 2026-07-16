// SHARED CSL-FORMAT CACHE (2026-07-17 — the blocker a synchronous renderer could not get past).
//
// WHY THIS EXISTS. `formatReferenceEntries` is ASYNC (it lazy-imports citation-js and awaits the
// style) and it was called from inside ReferenceListNodeView's own effect, with its result held in
// NodeView-LOCAL REACT STATE. So the formatted bibliography existed in exactly one place: a
// component's closure. The text renderer's build is SYNCHRONOUS and runs for OTHER VERSIONS whose
// NodeView has never mounted — it could not read that state, could not await it on the paint path,
// and therefore had no honest way to know what the bibliography SAYS. That is the whole reason the
// reference list was a 120px guess while the editor drew 880px of real entries.
//
// THE DISCIPLINE (identical to citeBox / blockStyles): format ONCE per immutable key, cache it, and
// let a synchronous caller READ it. A key that isn't cached returns null ⇒ the caller DEFERS (a
// labelled placeholder + breaks marked unreliable) and asks for the format out-of-band; when it
// lands, subscribers re-render and the next build hits. MISS ⇒ DEFER, never a synchronous format on
// the paint path and never a guessed height.
//
// NOT A SECOND FORMATTER. The NodeView now reads THIS cache too, so there is exactly one
// `formatReferenceEntries` call per (entries, style, epoch) serving both the editor and the
// renderer. Two independent format paths would be two chances to disagree about what the
// bibliography says — and the renderer's whole claim is that it draws what the editor draws.

import type { CSLItem } from '../types/document'
import { formatReferenceEntries } from './format'

/** One formatted entry: the citekey and the `.csl-entry` html citeproc produced for it. */
export type BibEntry = readonly [id: string, html: string]

// The key must change whenever the ENTRY TEXT would change: which sources, in what style, at what
// bibliography revision. Same contract as citeBox's key — the epoch is bibProvider.getVersion(), so
// an edit to a source's title invalidates by construction rather than by hope.
function keyOf(citekeys: readonly string[], style: string, epoch: number): string {
  return `${citekeys.join(';')}|${style}|${epoch}`
}

const cache = new Map<string, readonly BibEntry[]>()
// The in-flight PROMISE, not just a "busy" flag: a second asker for the same key must be able to
// AWAIT the first one's run. Returning null-because-busy instead would make the NodeView drop the
// rebuild it was in the middle of and wait for a notification it might already have missed.
const inflight = new Map<string, Promise<readonly BibEntry[] | null>>()
const subs = new Set<() => void>()

// debug counters (window.__iwBibFormat) — read by probes, zero cost.
const dbg = { hits: 0, misses: 0, formats: 0, failures: 0, size: 0, inflight: 0 }
if (typeof window !== 'undefined') (window as unknown as { __iwBibFormat?: unknown }).__iwBibFormat = dbg

/** Drop everything — used by tests and by a full citation-context reset. */
export function _clearBibFormat(): void {
  cache.clear(); inflight.clear()
  dbg.size = 0; dbg.inflight = 0
}

/** Subscribe to "a format landed". Returns an unsubscribe. */
export function subscribeBibFormat(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

function notify(): void { for (const cb of [...subs]) cb() }

/**
 * The SYNCHRONOUS read the renderer needs. Returns the formatted entries for this exact key, or
 * null ⇒ the caller MUST defer. Never formats, never blocks, never guesses.
 */
export function bibEntries(citekeys: readonly string[], style: string, epoch: number): readonly BibEntry[] | null {
  const r = cache.get(keyOf(citekeys, style, epoch)) ?? null
  if (r) dbg.hits++; else dbg.misses++
  return r
}

/**
 * Format these items and cache them under the key, de-duplicated: concurrent askers for the same key
 * share ONE citation-js run. Resolves to the entries (so the NodeView can await it) and notifies
 * subscribers (so a deferred renderer can rebuild).
 *
 * `items` must be the CSLItems for `citekeys`, in the caller's order — the key is built from the
 * keys, and citeproc applies the style's OWN sort to produce the returned order.
 */
export async function ensureBibEntries(
  items: readonly CSLItem[],
  style: string,
  epoch: number,
): Promise<readonly BibEntry[] | null> {
  const citekeys = items.map(i => i.id)
  const key = keyOf(citekeys, style, epoch)
  const hit = cache.get(key)
  if (hit) return hit
  if (items.length === 0) {
    const empty: readonly BibEntry[] = []
    cache.set(key, empty); dbg.size = cache.size
    return empty
  }
  const pending = inflight.get(key)
  if (pending) return pending // share the one run — never format the same key twice concurrently

  const run = (async (): Promise<readonly BibEntry[] | null> => {
    try {
      const formatted = await formatReferenceEntries(items as CSLItem[], style)
      const entries: readonly BibEntry[] = formatted.map(([id, html]) => [id, html] as const)
      cache.set(key, entries)
      dbg.formats++; dbg.size = cache.size
      return entries
    } catch {
      // The CSL engine failed (offline style fetch, bad item). Cache NOTHING: a miss defers honestly
      // and the caller falls back to its plain-text path. Caching a failure as an empty bibliography
      // would render a document that HAS references as one that has none.
      dbg.failures++
      return null
    } finally {
      inflight.delete(key); dbg.inflight = inflight.size
      notify()
    }
  })()
  inflight.set(key, run); dbg.inflight = inflight.size
  return run
}

/** Fire-and-forget request used by a synchronous caller that just missed. Never throws. */
export function requestBibEntries(items: readonly CSLItem[], style: string, epoch: number): void {
  void ensureBibEntries(items, style, epoch).catch(() => { /* ensureBibEntries already swallowed it */ })
}
