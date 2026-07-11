// Collect the DISPLAYED citations and embed them into document.bibliography. The displayed set is
// the union of (a) every in-text citation's key — those always render in the prose — and (b) the
// reference-list section's mode-resolved keys:
//   • 'cited'  (default): the used keys (reference list = what's cited)
//   • 'all'            : the whole library
//   • 'manual'         : an explicit ticked set (manualKeys on the ReferenceListNode)
// This union is exactly "everything that displays anywhere", which is what gets hashed (spec §3/§12).
// doc.bibliography ALSO serves as the offline-resolution source for in-text CitationNodeView.

import type { InkwaveDocument, TiptapJSON, Bibliography, CSLItem } from '../types/document'
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
  return resolveRefKeys(used, cfg)
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
