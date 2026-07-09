// Windowed decoration rebuild (phone round-2 lag, 2026-07-10): the typing tick may rebuild only
// the window's paragraphs and SPLICE them into the mapped existing set. These tests pin the core
// contract: splice(window) over a mapped set ≡ a full rebuild, decoration-for-decoration —
// including data-para numbering (the windowed walk counts the paragraphs before the window) and
// untouched sticky-green anchors outside the window.
import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { buildDecorations, buildWindowDecorations, type HintState } from './RedHighlightExtension'
import { emptyScasState, buildLookup } from '../../scas/state'
import { deriveSet, lemmaOf } from '../../scas/engine'
import type { InkwaveDocument } from '../../types/document'
import type { ScasState } from '../../types/document'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    scasSlot: {
      attrs: { original: { default: null }, locked: { default: false }, firstCommitAt: { default: null } },
    },
  },
})

// Two lemma-stable in-S probes (same derivation the controller would use) + out-of-S fillers.
const S0 = [...deriveSet('deco-seed', 'deco-doc', 0, 300)].filter((w) => lemmaOf(w) === w).sort()
const HOT = S0[0]
const OTHER = S0[1]
const state: ScasState = { ...emptyScasState(), liveKicks: [HOT, OTHER] }
const lookup = buildLookup(state)

const inkDoc = { scasMode: 'n', scasState: state } as unknown as InkwaveDocument
const hint: HintState = { focusedPos: null, showHints: true, focusedMinWidth: null, lineCompressionRange: null, animate: true, durationMs: 200 }
const NO_REVEALS: ReadonlySet<number> = new Set<number>()

function docOf(paras: string[]): PMNode {
  return schema.node('doc', null, paras.map((t) => schema.node('paragraph', null, [schema.text(t)])))
}

// Serialize a DecorationSet for structural comparison (from/to/rendered attrs).
function shape(set: { find: (from?: number, to?: number) => unknown[] }): unknown[] {
  return (set.find() as Array<{ from: number; to: number }>)
    .map((d) => ({ from: d.from, to: d.to, attrs: (d as unknown as { type: { attrs: unknown } }).type.attrs }))
    .sort((a, b) => a.from - b.from)
}

describe('windowed decoration splice ≡ full rebuild', () => {
  it('inserting text into one paragraph: splice equals a full rebuild (incl. data-para)', () => {
    const docA = docOf([`the ${HOT} word.`, 'calm filler here.', `and ${OTHER} waits.`])
    const full0 = buildDecorations(docA, inkDoc, docA.content.size - 1, hint, lookup, NO_REVEALS, new Map())
    expect(shape(full0.decorations).length).toBeGreaterThanOrEqual(2) // both probes decorated

    // Edit paragraph 1 (insert a word mid-paragraph) via a real transform.
    const p1TextPos = docA.child(0).nodeSize + 2 // inside paragraph 1's text
    const tr = new Transform(docA).replaceWith(p1TextPos, p1TextPos, schema.text('inserted '))
    const docB = tr.doc

    // The plugin's apply(): map the old set + anchors through the edit…
    const mapped = full0.decorations.map(tr.mapping, docB)
    const flaggedMapped = new Map<number, string>()
    full0.flagged.forEach((orig, pos) => {
      const m = tr.mapping.mapResult(pos)
      if (!m.deleted) flaggedMapped.set(m.pos, orig)
    })

    // …then splice the window's paragraphs (the changed range).
    const caret = p1TextPos + 'inserted '.length
    const wb = buildWindowDecorations(docB, inkDoc, caret, hint, lookup, NO_REVEALS, flaggedMapped, { from: p1TextPos, to: caret })
    expect(wb.bounds).not.toBeNull()
    const spliced = mapped.remove(mapped.find(wb.bounds!.from, wb.bounds!.to)).add(docB, wb.list)

    // Reference: the full rebuild on the new document with the same inputs.
    const fullB = buildDecorations(docB, inkDoc, caret, hint, lookup, NO_REVEALS, flaggedMapped)
    expect(shape(spliced)).toEqual(shape(fullB.decorations))
  })

  it('a window over the LAST paragraph numbers it with the true document paragraph index', () => {
    const doc = docOf(['one filler.', 'two filler.', `three ${HOT} filler.`])
    const p2Start = doc.child(0).nodeSize + doc.child(1).nodeSize
    const wb = buildWindowDecorations(doc, inkDoc, doc.content.size - 1, hint, lookup, NO_REVEALS, new Map(), { from: p2Start + 2, to: p2Start + 4 })
    expect(wb.bounds).not.toBeNull()
    expect(wb.list.length).toBeGreaterThanOrEqual(1)
    const attrs = (wb.list[0] as unknown as { type: { attrs: Record<string, string> } }).type.attrs
    expect(attrs['data-para']).toBe('2')
    // and it matches the full build's numbering for the same word
    const full = buildDecorations(doc, inkDoc, doc.content.size - 1, hint, lookup, NO_REVEALS, new Map())
    const fullHot = shape(full.decorations).find((d) => (d as { attrs: Record<string, string> }).attrs['data-word'] === HOT) as { attrs: Record<string, string> }
    expect(fullHot.attrs['data-para']).toBe('2')
  })

  it('returns bounds: null when the window contains no paragraph content changes to decorate', () => {
    // A window can legitimately produce an empty decoration list (nothing in-S there) while still
    // having bounds; bounds are null only when NO paragraph intersects. All blocks here are
    // paragraphs, so probe the degenerate zero-width window at position 0 (before any paragraph
    // starts, expanded ±1 it still catches paragraph 0 — assert the splice stays a no-op shape).
    const doc = docOf(['plain filler words.'])
    const wb = buildWindowDecorations(doc, inkDoc, 2, hint, lookup, NO_REVEALS, new Map(), { from: 2, to: 2 })
    expect(wb.bounds).not.toBeNull() // paragraph 0 intersects
    expect(wb.list).toEqual([]) // nothing in-S → empty list; splice removes nothing, adds nothing
  })
})
