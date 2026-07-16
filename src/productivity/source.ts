// The ledger/aggregate seam — spec §A3.3.
//
// The report path READS aggregates; it does not compute them. `feat/prod-ledger` owns the ledger
// and `feat/prod-graphs` owns the client-side aggregation, so this module is the single function
// they fill in. Until one of them calls `setAggregateSource`, `loadWindow` honestly returns null
// and the panel says the ledger isn't wired up yet — it does not invent numbers to fill a screen.

import type { ReportWindow, WindowAggregate } from './types'

export type AggregateSource = (window: ReportWindow) => Promise<WindowAggregate | null>

let source: AggregateSource | null = null

/** Install the real aggregate source (prod-ledger / prod-graphs), or a labelled demo one. */
export function setAggregateSource(fn: AggregateSource | null): void { source = fn }

export function hasAggregateSource(): boolean { return source !== null }

export async function loadWindow(window: ReportWindow): Promise<WindowAggregate | null> {
  return source ? source(window) : null
}

// ─── The content seam (§A7.3) ───────────────────────────────────────────────────────────────
// Document TEXT is fetched only for docs the writer has explicitly ticked, and only at compile
// time. Nothing here caches it: text that was never fetched cannot leak into a payload.

export type ContentSource = (docId: string) => Promise<string>

let content: ContentSource | null = null

export function setContentSource(fn: ContentSource | null): void { content = fn }

/** Text for the ticked docs only. A doc with no source resolves to '' — never to other text. */
export async function loadContent(docIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!content) return out
  for (const id of docIds) {
    try { out[id] = await content(id) } catch { out[id] = '' }
  }
  return out
}
