// Collect the DISPLAYED citations and embed them into document.bibliography. The displayed set is
// the union of (a) every in-text citation's key — those always render in the prose — and (b) the
// reference-list section's mode-resolved keys:
//   • 'cited'  (default): the used keys (reference list = what's cited)
//   • 'all'            : the whole library
//   • 'manual'         : an explicit ticked set (manualKeys on the ReferenceListNode)
// This union is exactly "everything that displays anywhere", which is what gets hashed (spec §3/§12).
// doc.bibliography ALSO serves as the offline-resolution source for in-text CitationNodeView.

import type { InkwaveDocument, TiptapJSON, Bibliography, CSLItem } from '../types/document'
import type { Node as PMNode } from '@tiptap/pm/model'
import { bibProvider } from './bibProvider'

export type RefMode = 'cited' | 'all' | 'manual'

export interface RefListConfig { mode: RefMode; manualKeys: string[] }

function walkNode(node: unknown, keys: Set<string>, ref: { cfg: RefListConfig | null }): void {
  if (!node || typeof node !== 'object') return
  const n = node as {
    type?: string
    attrs?: { citekeys?: string[]; mode?: RefMode; manualKeys?: string[] }
    content?: unknown[]
  }
  if (n.type === 'citation' && Array.isArray(n.attrs?.citekeys)) {
    for (const k of n.attrs.citekeys) keys.add(k)
  }
  if (n.type === 'referenceList') {
    ref.cfg = {
      mode: n.attrs?.mode ?? 'cited',
      manualKeys: Array.isArray(n.attrs?.manualKeys) ? n.attrs.manualKeys : [],
    }
  }
  if (Array.isArray(n.content)) for (const child of n.content) walkNode(child, keys, ref)
}

/** Keys of every in-text citation node in the document. */
export function usedCitekeys(contentJson: TiptapJSON): string[] {
  const keys = new Set<string>()
  walkNode(contentJson, keys, { cfg: null })
  return [...keys]
}

/** The reference-list config (mode + manual ticks), or null if the document has no reference list. */
export function referenceListConfig(contentJson: TiptapJSON): RefListConfig | null {
  const ref = { cfg: null as RefListConfig | null }
  walkNode(contentJson, new Set<string>(), ref)
  return ref.cfg
}

/** Resolve the reference-list's displayed keys for a mode (used by the node view + resolve). */
export function referenceListKeys(contentJson: TiptapJSON): string[] {
  const used = new Set<string>()
  const ref = { cfg: null as RefListConfig | null }
  walkNode(contentJson, used, ref)
  return resolveRefKeys(used, ref.cfg)
}

/** Same as referenceListKeys but walks the live PM document — no editor.getJSON() serialization.
 *  The node view's debounced rebuild called getJSON per typing pause, which builds the ENTIRE
 *  JSON tree of a 100-page doc just to read citekeys (2026-07-11 typing-lag work). Identical
 *  semantics: pre-order document walk, first-appearance key order, last referenceList's cfg wins. */
export function referenceListKeysFromDoc(doc: import('@tiptap/pm/model').Node): string[] {
  const { used, cfg } = citeIndexFromDoc(doc)
  return resolveRefKeys(used, cfg)
}

// ── ONE MEMOISED WALK PER DOCUMENT VERSION ────────────────────────────────────────────────────
// Everything above that reads citations out of the LIVE document goes through here. PM docs are
// persistent structures — same reference ⇔ unchanged content — so one walk per version serves every
// caller, and a caller that re-reads an unchanged document pays nothing at all. This mirrors
// `citationNav.ts`'s `citationNodes` index, added in the same 2026-07-11 typing-lag work; the two
// exist separately because that one keeps POSITIONS (for navigation) and this one keeps the
// resolution inputs, and a caller wanting keys should not pay to collect positions.
//
// ⚠ THE JSON WALKERS ABOVE ARE NOT REDUNDANT. `usedCitekeys`/`referenceListConfig` take a
// `TiptapJSON` and are used where there is no live document at all — a snapshot's `contentJson`,
// an export bundle, the verifier. They must keep answering identically, which
// `citeWalk.perf.test.ts` asserts directly rather than by inspection.
let _docIndex: { doc: PMNode; index: DocCiteIndex } | null = null

export interface DocCiteIndex {
  /** Every in-text citation key, in first-appearance order. */
  used: Set<string>
  /** The LAST reference list's config (matching the JSON walker), or null if there is none. */
  cfg: RefListConfig | null
}

/** The citation resolution inputs for a live PM document. Memoised on document identity. */
export function citeIndexFromDoc(doc: PMNode): DocCiteIndex {
  if (_docIndex && _docIndex.doc === doc) return _docIndex.index
  const used = new Set<string>()
  let cfg: RefListConfig | null = null
  doc.descendants((node) => {
    if (node.type.name === 'citation' && Array.isArray(node.attrs.citekeys)) {
      for (const k of node.attrs.citekeys as string[]) used.add(k)
    }
    if (node.type.name === 'referenceList') {
      cfg = {
        mode: (node.attrs.mode as RefMode | undefined) ?? 'cited',
        manualKeys: Array.isArray(node.attrs.manualKeys) ? (node.attrs.manualKeys as string[]) : [],
      }
    }
  })
  const index = { used, cfg }
  _docIndex = { doc, index }
  return index
}

/** Test seam: drop the memo so a cold walk can be measured. Not used in production. */
export function _resetCiteIndexForTest(): void { _docIndex = null }

/** `usedCitekeys` for a live document — no `editor.getJSON()` serialisation. */
export function usedCitekeysFromDoc(doc: PMNode): string[] {
  return [...citeIndexFromDoc(doc).used]
}

/** `referenceListConfig` for a live document — no `editor.getJSON()` serialisation. */
export function referenceListConfigFromDoc(doc: PMNode): RefListConfig | null {
  return citeIndexFromDoc(doc).cfg
}

function resolveRefKeys(used: Set<string>, cfgIn: RefListConfig | null): string[] {
  const cfg = cfgIn ?? { mode: 'cited' as RefMode, manualKeys: [] }
  if (cfg.mode === 'all') return bibProvider.getAll().map(e => e.id)
  if (cfg.mode === 'manual') return cfg.manualKeys
  return [...used]
}

export interface EmbedResult {
  doc: InkwaveDocument
  missing: string[]
}

function resolveEntry(key: string, doc: InkwaveDocument): CSLItem | null {
  const item = bibProvider.get(key)
  if (item) return item
  // Offline fallback: keep the already-embedded entry so in-text cites still resolve.
  return doc.bibliography?.entries.find(e => e.id === key) ?? null
}

/**
 * Embed the displayed bibliography (union of in-text keys + reference-list keys) into the document.
 * Deterministic: entries sorted by id; generatedAt is set but is NOT part of bibHash (see hash.ts).
 */
export function embedBibliography(doc: InkwaveDocument): EmbedResult {
  const used = usedCitekeys(doc.contentJson)
  const refKeys = referenceListKeys(doc.contentJson)
  const displayKeys = new Set<string>([...used, ...refKeys])

  const entries: CSLItem[] = []
  const missing: string[] = []
  for (const key of displayKeys) {
    const item = resolveEntry(key, doc)
    if (item) entries.push(item)
    else missing.push(key)
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))

  const bibliography: Bibliography = {
    source: 'library',
    entries,
    generatedAt: new Date().toISOString(),
  }
  return { doc: { ...doc, bibliography }, missing }
}
