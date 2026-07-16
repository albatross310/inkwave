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

/** Tests only — drop the memo so a fresh schema is resolved. */
export function _resetEditorSchema(): void { _schema = null }
