// Collect citekeys used in a document and embed the CSLItems into document.bibliography.
// Called on: insert citation, document save, pre-export.
// Only used keys are embedded — never the whole library.

import type { InkwaveDocument, TiptapJSON, Bibliography, CSLItem } from '../types/document'
import { bibProvider } from './bibProvider'

function walkNode(node: unknown, keys: Set<string>): void {
  if (!node || typeof node !== 'object') return
  const n = node as { type?: string; attrs?: { citekeys?: string[] }; content?: unknown[] }
  if (n.type === 'citation' && Array.isArray(n.attrs?.citekeys)) {
    for (const k of n.attrs.citekeys) keys.add(k)
  }
  if (Array.isArray(n.content)) for (const child of n.content) walkNode(child, keys)
}

export function usedCitekeys(contentJson: TiptapJSON): string[] {
  const keys = new Set<string>()
  walkNode(contentJson, keys)
  return [...keys]
}

export interface EmbedResult {
  doc: InkwaveDocument
  missing: string[]
}

export function embedBibliography(doc: InkwaveDocument): EmbedResult {
  const keys = usedCitekeys(doc.contentJson)
  const entries: CSLItem[] = []
  const missing: string[] = []

  for (const key of keys) {
    const item = bibProvider.get(key)
    if (item) {
      entries.push(item)
    } else {
      // Fall back to already-embedded entry if the provider is offline
      const existing = doc.bibliography?.entries.find(e => e.id === key)
      if (existing) entries.push(existing)
      else missing.push(key)
    }
  }

  // Sort for deterministic hash
  entries.sort((a, b) => a.id.localeCompare(b.id))

  const bibliography: Bibliography = {
    source: 'zotero-bbt',
    entries,
    generatedAt: new Date().toISOString(),
  }

  return { doc: { ...doc, bibliography }, missing }
}
