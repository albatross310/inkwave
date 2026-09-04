// THE SCHEMA, OUTSIDE THE EDITOR. /edit has `editor.state.doc`; /snapshot has no editor, so a
// version's `contentJson` needs something to be parsed against.
//
// ⚠ DERIVE IT FROM `buildEditorExtensions` — the SAME list the editor is built from — so "the model
// matches what the editor paginates" holds by construction, not by vigilance (R2). Proved from
// OUTSIDE by `schemaIdentity.prove.mjs`, against the live editor, on a NodeView-bearing document.
// → docs/archive/pagination-rounds.md#schema-outside-editor

import { getSchema } from '@tiptap/core'
import { Node as PMNode, type Schema } from '@tiptap/pm/model'
import { buildEditorExtensions } from './extensions/editorExtensions'

let _schema: Schema | null = null

/**
 * The app's schema. Memoised — resolving ~27 extensions is pure and its result is immutable, and
 * /snapshot asks once per version (116 of them).
 *
 * NOT part of a persisted signature: this is a program constant, not document state.
 */
export function getEditorSchema(): Schema {
  if (!_schema) _schema = getSchema(buildEditorExtensions())
  return _schema
}

/**
 * Parse a snapshot version's `contentJson` into a real PM Node.
 *
 * ⚠ Return null on malformed content rather than throwing, and the caller must COUNT it: an
 * unparseable version must MISS, never take down the route nor read as "no pages" (R1).
 * → docs/archive/pagination-rounds.md#schema-outside-editor
 */
export function nodeFromContentJson(json: unknown): PMNode | null {
  if (!json || typeof json !== 'object') return null
  try {
    return PMNode.fromJSON(getEditorSchema(), json as Parameters<typeof PMNode.fromJSON>[1])
  } catch {
    return null
  }
}

// ─── BLOCK-LEVEL PARSE CACHE ──────────────────────────────────────────────────────────────────
// ⚠ KEY IT ON CONTENT, NEVER ON A DIFF. A wrong diff silently reuses the wrong node — right words,
// wrong page, reports success; a content hash cannot. Two 32-bit FNV-1a streams ⇒ a 64-bit key,
// because a collision is the only way this can UNDER-invalidate, the direction that paints wrong
// words (R8).
// ⚠ IT LIVES HERE, BESIDE `nodeFromContentJson` — one parse seam, never a second one in another
// module (R2). Pass no cache and this file behaves byte-identically to before.
// → docs/archive/pagination-rounds.md#parse-cache
export interface ParseCacheStats { hits: number; misses: number; entries: number; evicted: number }
export interface ParseCache { map: Map<string, PMNode>; stats: ParseCacheStats; max: number }

/** A block-level parse cache. Bounded FIFO — evictions are counted, never silent. */
export function makeParseCache(max = 4000): ParseCache {
  return { map: new Map(), stats: { hits: 0, misses: 0, entries: 0, evicted: 0 }, max }
}

/** FNV-1a x2 over the block's serialized JSON. Native stringify is far cheaper than fromJSON's
 *  Node/Fragment/Mark allocation, which is the whole point of the trade. */
function blockJsonKey(b: unknown): string {
  const str = JSON.stringify(b)
  let h1 = 0x811c9dc5 >>> 0
  let h2 = 0xcbf29ce4 >>> 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ (c & 255), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c >>> 8), 0x85ebca6b) >>> 0
  }
  return `${h1.toString(36)}:${h2.toString(36)}:${str.length}`
}

/**
 * `nodeFromContentJson`, but reusing the parsed Node of any top-level block whose JSON is
 * byte-identical to one already seen. Omit `cache` ⇒ the untouched full parse.
 *
 * Returns null on malformed content rather than throwing — same contract as nodeFromContentJson: an
 * unparseable version must MISS and be counted, never take down the route.
 */
export function nodeFromContentJsonCached(json: unknown, cache?: ParseCache): PMNode | null {
  if (!cache) return nodeFromContentJson(json)
  const d = json as { type?: string; content?: unknown[]; attrs?: Record<string, unknown> } | null
  // Anything not a plain top-level doc falls back to the ONE full-parse path rather than growing a
  // second set of structural rules here.
  if (!d || typeof d !== 'object' || d.type !== 'doc' || !Array.isArray(d.content)) return nodeFromContentJson(json)
  try {
    const schema = getEditorSchema()
    const kids: PMNode[] = []
    for (const b of d.content) {
      const k = blockJsonKey(b)
      const hit = cache.map.get(k)
      if (hit) { cache.stats.hits++; kids.push(hit); continue }
      cache.stats.misses++
      const n = PMNode.fromJSON(schema, b as Parameters<typeof PMNode.fromJSON>[1])
      if (cache.map.size >= cache.max) {
        const oldest = cache.map.keys().next().value
        if (oldest !== undefined) { cache.map.delete(oldest); cache.stats.evicted++ }
      }
      cache.map.set(k, n)
      cache.stats.entries = cache.map.size
      kids.push(n)
    }
    return schema.node('doc', (d.attrs ?? null) as never, kids)
  } catch {
    return null
  }
}

/** Tests only — drop the memo so a fresh schema is resolved. */
export function _resetEditorSchema(): void { _schema = null }

/**
 * A Schema reduced to a comparable, schema-INSTANCE-INDEPENDENT description.
 *
 * ⚠ COMPARE STRUCTURALLY — never `Node.eq`. PM's `hasMarkup` compares NodeType by REFERENCE, so two
 * Schema instances compare unequal whatever their content: a check incapable of passing (R6).
 * ⚠ Carry everything PM uses to define a type, plus the atom/inline flags pagination depends on — a
 * hand-picked subset certifies its own blind spot. ONE description; both callers use it (R2).
 * → docs/archive/pagination-rounds.md#schema-outside-editor
 */
export function schemaSpec(s: Schema): string {
  const nodes: Record<string, unknown> = {}
  for (const name of Object.keys(s.nodes)) {
    const t = s.nodes[name]
    nodes[name] = {
      attrs: Object.keys(t.spec.attrs ?? {}).sort().map(a => `${a}=${JSON.stringify(t.spec.attrs?.[a]?.default ?? null)}`),
      content: t.spec.content ?? null,
      marks: t.spec.marks ?? null,
      group: t.spec.group ?? null,
      atom: t.isAtom,
      inline: t.isInline,
    }
  }
  const marks: Record<string, unknown> = {}
  for (const name of Object.keys(s.marks)) {
    const m = s.marks[name]
    marks[name] = {
      attrs: Object.keys(m.spec.attrs ?? {}).sort().map(a => `${a}=${JSON.stringify(m.spec.attrs?.[a]?.default ?? null)}`),
      excludes: m.spec.excludes ?? null,
      group: m.spec.group ?? null,
      inclusive: m.spec.inclusive ?? null,
    }
  }
  return JSON.stringify({ topNode: s.topNodeType.name, nodes, marks })
}
