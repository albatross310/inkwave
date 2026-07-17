// THE SCHEMA, OUTSIDE THE EDITOR (2026-07-17 — the /snapshot blocker).
//
// `buildBreakTable`/`buildRenderModel` take a real ProseMirror `Node`. On /edit that Node is
// `editor.state.doc` and its schema came from the editor's constructor. On /snapshot there IS no
// editor (`useEditor` is absent from SnapshotView), so a version's `contentJson` — plain JSON in the
// .studio file — had nothing to be parsed against. That, and only that, is why the plaintext page
// renderer could not go live: every one of its numbers was measured against the live editor's doc.
//
// The schema is derived from THE SAME list the editor is built from (`buildEditorExtensions`), so
// "the model matches what the editor paginates" holds by construction rather than by vigilance.
// It is still PROVED from outside — `schemaIdentity.prove.mjs` compares this schema's spec against
// the LIVE editor's `editor.schema` in a real page, on a document carrying citations, math and a
// reference list (the NodeView-bearing nodes are exactly the ones that could differ; a document of
// bare paragraphs would prove nothing — CLAUDE.md's "trace PASSING results").

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
 * Parse a snapshot version's `contentJson` into a real PM Node — the seam `TextRenderStore.get`'s
 * `docOf: () => PMNode | null` has always been shaped for ("supplies the version's PM doc (parsed
 * from its contentJson)") and that nothing could satisfy until now.
 *
 * Returns null on malformed content rather than throwing: a version that cannot be parsed must MISS
 * (the caller rebuilds/skips), never take down the snapshot route. The null is COUNTED by the
 * caller, never swallowed — an unparseable version that silently reads as "no pages" is precisely
 * the house disease.
 */
export function nodeFromContentJson(json: unknown): PMNode | null {
  if (!json || typeof json !== 'object') return null
  try {
    return PMNode.fromJSON(getEditorSchema(), json as Parameters<typeof PMNode.fromJSON>[1])
  } catch {
    return null
  }
}

// ─── BLOCK-LEVEL PARSE CACHE (2026-07-17) ─────────────────────────────────────────────────────
// PARSE IS THE FLOOR. With the block LAYOUT cache landed (3.5-4x, byte-identical), /snapshot's
// wired cost for Peter's 116 versions is ~3.6s: ~2.6s of build and ~1.06s of PARSE. A build cache
// cannot touch parse, and parse ALONE already exceeds Peter's "<1s and we can just load it when the
// snapshots screen loads up". So the same lever has to reach one level down.
//
// THE SAME THEOREM, ONE LEVEL DOWN. 98.7% of top-level blocks are byte-identical between adjacent
// versions (measured, not assumed — that is the layout cache's reuse rate on the same corpus). A PM
// Node is IMMUTABLE and PERSISTENT: structure sharing across documents is what ProseMirror does
// natively on every transaction, and a node's doc position comes from the WALK (`doc.forEach((node,
// offset))`), never from the node. So an unchanged block's parsed Node can be reused verbatim in the
// next version's doc, and then its layout hits the block cache too — skipping BOTH costs.
//
// KEYED ON CONTENT, NEVER ON A DIFF — the same reasoning as the layout cache: a wrong diff silently
// reuses the wrong node (right words, wrong page, reports success); a content hash cannot. Two
// independent 32-bit FNV-1a streams ⇒ an effective 64-bit key, because a collision is the only way
// this can under-invalidate and under-invalidation is the direction that paints wrong words.
//
// IT LIVES HERE, BESIDE `nodeFromContentJson`, DELIBERATELY. A second parse path in another module
// is precisely the wound found THREE times today — staticPagination's stale orphan rule,
// textRender's duplicate `runOf`, and textRender's paragraph branch carrying its own copy of the
// layout+emit loop (which made a block cache reuse 99% of the 40% that didn't matter). One rule,
// one seam. Pass no cache and this file behaves byte-identically to before.
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
 * WHY THIS IS HERE AND NOT COPIED INTO EACH CHECK. Two callers compare schemas — the in-browser
 * `schemaIdentity.prove.mjs` (against the live editor) and the gate-kept `editorSchema.test.ts`
 * (against a real Editor in jsdom). Two copies of "what makes two schemas the same" is precisely how
 * one of them quietly starts certifying a fiction, which is the same argument that keeps ONE
 * extension list. So there is one description, used by both.
 *
 * ⚠ AND WHY IT EXISTS AT ALL: `Node.eq` CANNOT be used across schemas. PM's `hasMarkup` compares
 * `this.type == type` — REFERENCE equality on NodeType — so two Schema instances always compare
 * unequal whatever their content. An eq-based check reported `false` for an UNTOUCHED document: a
 * check structurally incapable of passing, which would have condemned a correct schema. Comparison
 * across schemas must be STRUCTURAL (type names, attr names + defaults, content/marks expressions).
 *
 * Not a hand-picked subset of "fields we think matter" — that is how a check certifies its own blind
 * spot. It carries everything PM uses to define a type, plus the atom/inline flags the paginator's
 * correctness depends on.
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
