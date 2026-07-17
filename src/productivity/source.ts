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

// ─── The snapshot seam (the ledger+doc combo) ───────────────────────────────────────────────
// Session→prose pairing reads the provenance spine's snapshots. It is a SEAM rather than a
// direct `listSnapshots` import for the same reason the aggregate is: the demo must be able to
// stand in, and nothing here should reach into the archive on its own. Same gate as the text —
// the caller passes ticked ids only.

import type { DocGoals, Snapshot } from '../types/document'

export type SnapshotSource = (docId: string) => Promise<Snapshot[]>

let snapshots: SnapshotSource | null = null

export function setSnapshotSource(fn: SnapshotSource | null): void { snapshots = fn }

/**
 * Snapshots for the ticked docs only. A doc that errors or has no source yields `[]`, which
 * `excerptForSession` reports as `no-snapshots` — an honest gap, never another doc's text.
 */
export async function loadSnapshots(docIds: string[]): Promise<Record<string, Snapshot[]>> {
  const out: Record<string, Snapshot[]> = {}
  if (!snapshots) return out
  for (const id of docIds) {
    try { out[id] = await snapshots(id) } catch { out[id] = [] }
  }
  return out
}

// ─── The goals seam (§A5b) ──────────────────────────────────────────────────────────────────
// Goals are a DOCUMENT property (types/document.ts DocGoals) and are read here rather than
// owned. Same gate discipline as the text: the caller passes ticked ids only.
//
// ⚠ NOTHING AUTHORS GOALS YET — no editor UI exists (Peter owns that design question). So this
// source returns null for every document today, and the report takes §A5b's honest branch:
// no goal ⇒ describe, don't push. That is a correct end state, not a broken one.

export type GoalsSource = (docId: string) => Promise<DocGoals | null>

let goals: GoalsSource | null = null

export function setGoalsSource(fn: GoalsSource | null): void { goals = fn }

/**
 * Goals for the ticked docs only. A doc with no goal is ABSENT from the result — not present
 * with an empty goal. The two are different states and only the first is honest about itself:
 * an empty goal would let the payload claim the writer set one and left it blank.
 */
export async function loadGoals(docIds: string[]): Promise<Record<string, DocGoals>> {
  const out: Record<string, DocGoals> = {}
  if (!goals) return out
  for (const id of docIds) {
    try {
      const g = await goals(id)
      if (g && ((g.goal ?? '').trim() || (g.plan ?? '').trim())) out[id] = g
    } catch { /* a doc whose goal can't be read contributes nothing — never a guess */ }
  }
  return out
}
