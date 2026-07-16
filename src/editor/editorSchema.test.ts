// @vitest-environment jsdom
// THE SCHEMA OUTSIDE THE EDITOR — /snapshot's missing half.
//
// These pin the LOGIC; `schemaIdentity.prove.mjs` proves the identity against the LIVE editor in a
// real page. Both exist because the claim under test ("the schema matches the editor's") is exactly
// the kind that passes vacuously: a fixture of bare paragraphs would round-trip through ANY schema
// that has paragraphs and text, and would prove nothing about the nodes that actually carry risk.
//
// THE FIXTURE IS THE POINT. Citations, inline math, block math, the reference list and task items
// are the NodeView-bearing / attribute-carrying nodes — the ones whose absence from a schema is
// silent (PM's `fromJSON` throws on an unknown node type, so a MISSING node type is loud; a missing
// ATTRIBUTE is not — it parses fine and drops the value). So the round-trip asserts ATTRIBUTES
// survive, not merely that parsing succeeds.
//
// Each assertion carries a known-negative: a check that cannot fail is decoration (CLAUDE.md).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { Editor, getSchema } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'

// The NodeView React components are stubbed — NOT to dodge a failure, but because the reactRouter()
// vite plugin is active under vitest and throws its Fast-Refresh preamble error on any .tsx import
// (no existing test imports one). This is SOUND for what is under test and MUST be understood
// narrowly: a NodeView is a rendering strategy (`addNodeView`), it is not part of the schema — the
// schema is nodes/marks/attributes, and `getSchema` never calls addNodeView at all. So stubbing them
// cannot make a wrong schema look right. The claim that they are irrelevant is nevertheless not left
// to this file: `schemaIdentity.prove.mjs` compares against the LIVE editor's schema in a real
// browser with the REAL views mounted.
vi.mock('./extensions/CitationNodeView', () => ({ CitationNodeView: () => null }))
vi.mock('./extensions/MathInlineView', () => ({ MathInlineView: () => null }))
vi.mock('./extensions/MathBlockView', () => ({ MathBlockView: () => null }))
vi.mock('./extensions/ReferenceListNodeView', () => ({ ReferenceListNodeView: () => null }))

import { getEditorSchema, nodeFromContentJson, schemaSpec, _resetEditorSchema } from './editorSchema'
import { buildEditorExtensions } from './extensions/editorExtensions'

// A document shaped like the real thing: every risky node type, each with attributes set.
//
// THE ATTRIBUTE NAMES ARE THE REAL ONES, and that is not a detail. The first cut of this fixture
// INVENTED them (`citekey`/`id` instead of `citekeys: string[]`) — and PM's `fromJSON` does not
// complain about an unknown attribute, it silently DROPS it and substitutes the default. Asserting
// "the citation node parsed" would have passed on a citation carrying none of its data. The
// `unknownAttrsAreDropped` test below pins that trap open so the next fixture cannot repeat it.
const RICH = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chapter' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Leibniz argued ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'strongly' },
        { type: 'text', text: ' that ' },
        {
          type: 'citation',
          attrs: {
            citekeys: ['leibniz1666', 'couturat1901'],
            locator: '12', prefix: 'see', suffix: 'ff',
            suppressAuthor: false, quote: null, instanceId: 'inst-1',
          },
        },
        { type: 'text', text: ' and ' },
        { type: 'mathInline', attrs: { latex: 'x^2 + y^2' } },
        { type: 'text', text: ' follow.' },
      ],
    },
    { type: 'mathBlock', attrs: { latex: '\\int_0^1 f(x)\\,dx', align: 'aligned' } },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }],
    },
    {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }],
    },
    { type: 'referenceList', attrs: { mode: 'cited', manualKeys: ['manual1'] } },
  ],
}

describe('getEditorSchema', () => {
  beforeEach(() => { _resetEditorSchema() })

  it('is a real PM Schema carrying the editor list\'s node and mark types', () => {
    const s = getEditorSchema()
    expect(s).toBeInstanceOf(Schema)
    // The NodeView-bearing / app-specific types — the ones a schema built from a DIFFERENT list
    // would lack. (StarterKit's paragraph/text prove nothing; any schema has those.)
    for (const n of ['citation', 'mathInline', 'mathBlock', 'referenceList', 'taskList', 'taskItem']) {
      expect(Object.keys(s.nodes), `node type ${n}`).toContain(n)
    }
    for (const m of ['scasSlot', 'comment', 'insertion', 'deletion', 'highlight', 'underline', 'textStyle']) {
      expect(Object.keys(s.marks), `mark type ${m}`).toContain(m)
    }
    // KNOWN-NEGATIVE: the assertion above must be capable of failing. A type the app does not
    // define must NOT be present — otherwise `toContain` is passing on some always-true structure.
    expect(Object.keys(s.nodes)).not.toContain('notARealNodeType')
  })

  it('memoises — the same Schema instance is returned', () => {
    const a = getEditorSchema()
    expect(getEditorSchema()).toBe(a)
    // KNOWN-NEGATIVE: the memo must actually be what makes them identical, not a coincidence of
    // `toBe` on some singleton — resetting must yield a DIFFERENT instance.
    _resetEditorSchema()
    expect(getEditorSchema()).not.toBe(a)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE IDENTITY, KEPT BY THE GATE (2026-07-17 — the audit's headline finding).
//
// `schemaIdentity.prove.mjs` proves this against the LIVE editor in a real browser, and it is the
// stronger instrument. But it is not in package.json and not in CI, and an auditor put the general
// problem exactly: "a proof that ran once and convinced everyone is indistinguishable, six weeks
// later, from a proof that never ran — and the gate says green either way." This codebase is superb
// at ESTABLISHING truth and has no mechanism for KEEPING it.
//
// So the same claim runs on EVERY `pnpm test`, with no browser: build a REAL `Editor` from the real
// list (jsdom, ~20ms) and compare its schema to the standalone one. This is NOT a self-consistency
// check — it exercises the one genuine asymmetry between the two constructions: `getSchema(exts)`
// resolves extensions itself, whereas `new Editor()` resolves them through its own ExtensionManager
// WITH an editor bound (`getSchema`'s optional second argument). If those two ever disagree,
// /snapshot's break tables model a document the editor does not paginate — CLAUDE.md ROUND 11's
// "two rules, one pane" at the schema level.
const makeDeps = () => ({
  getDoc: () => ({ id: 'test-doc' }) as never,
  getHintState: () => ({ focusedPos: null }) as never,
  getScasLookup: () => ({ version: 1 }) as never,
})

const realEditorSchema = (exts: ReturnType<typeof buildEditorExtensions>) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const ed = new Editor({ element: el, extensions: exts, content: RICH })
  const spec = schemaSpec(ed.schema)
  ed.destroy()
  el.remove()
  return spec
}

describe('the standalone schema IS a real Editor\'s schema (gate-kept)', () => {
  beforeEach(() => { _resetEditorSchema() })

  it('getEditorSchema() === new Editor({ extensions: buildEditorExtensions(deps) }).schema', () => {
    expect(schemaSpec(getEditorSchema())).toBe(realEditorSchema(buildEditorExtensions(makeDeps())))
  })

  it('KNOWN-NEGATIVE: the comparison FIRES on a drifted list, and still passes on the real one', () => {
    // A comparison that cannot say NO is decoration. The drift must be VALID-BUT-DIFFERENT: the
    // first cut DELETED taskItem, which merely made the schema unconstructable ('No node type
    // taskItem found in content expression taskItem+') — an exception, not a divergence, so it
    // proved the comparison could throw, not that it could DISCRIMINATE. This drops
    // `.configure({ nested: true })` instead: a schema that builds fine and is subtly wrong, i.e.
    // the failure that actually ships.
    const drifted = buildEditorExtensions(makeDeps()).map(e => (e.name === 'taskItem' ? TaskItem : e))
    expect(schemaSpec(getEditorSchema())).not.toBe(realEditorSchema(drifted))
    // …and the correct list STILL matches — which is what proves the check discriminates rather
    // than being broken (CLAUDE.md ROUND 13: the mutated sig is refused AND the correct sig hits).
    expect(schemaSpec(getEditorSchema())).toBe(realEditorSchema(buildEditorExtensions(makeDeps())))
  })

  it('the deps do NOT change the schema — the premise the whole seam rests on', () => {
    // /snapshot builds its schema with NO closures. If deps could reach the schema, the snapshot's
    // model and the editor's would diverge silently. Asserted, not reasoned.
    //
    // NOTE both sides go through `getSchema`, and that is FORCED, not a shortcut: a real Editor
    // CANNOT be built without deps — it throws "RedHighlightExtension: getDoc option is required"
    // during plugin setup. That throw is the design (see editorExtensions.ts) and it is itself the
    // proof that the two arms are not interchangeable: deps-less is safe for a SCHEMA and fatal for
    // an EDITOR. The getSchema-vs-Editor axis is covered by the first test in this block, which
    // crosses both variables at once.
    expect(() => realEditorSchema(buildEditorExtensions())).toThrow(/getDoc option is required/)
    expect(schemaSpec(getSchema(buildEditorExtensions(makeDeps())))).toBe(schemaSpec(getSchema(buildEditorExtensions())))
  })
})

describe('nodeFromContentJson', () => {
  beforeEach(() => { _resetEditorSchema() })

  it('turns a rich contentJson into a real PM Node, attributes intact', () => {
    const doc = nodeFromContentJson(RICH)
    expect(doc).not.toBeNull()
    expect(doc!.type.name).toBe('doc')

    // Walk it the way buildRenderModel does and collect what we found.
    const found: Record<string, unknown> = {}
    doc!.descendants((n) => {
      if (n.type.name === 'citation') found.cite = n.attrs
      if (n.type.name === 'mathInline') found.mi = n.attrs.latex
      if (n.type.name === 'mathBlock') found.mb = n.attrs.latex
      if (n.type.name === 'referenceList') { found.refMode = n.attrs.mode; found.refManual = n.attrs.manualKeys }
      if (n.type.name === 'taskItem') found.task = n.attrs.checked
      return true
    })

    // ATTRIBUTES, not just node presence: a schema missing an attr parses happily and DROPS it.
    const cite = found.cite as Record<string, unknown>
    expect(cite.citekeys).toEqual(['leibniz1666', 'couturat1901'])
    expect(cite.locator).toBe('12')
    expect(cite.prefix).toBe('see')
    expect(cite.suffix).toBe('ff')
    expect(cite.instanceId).toBe('inst-1')
    expect(found.mi).toBe('x^2 + y^2')
    expect(found.mb).toBe('\\int_0^1 f(x)\\,dx')
    expect(found.refMode).toBe('cited')
    expect(found.refManual).toEqual(['manual1'])
    expect(found.task).toBe(true)
  })

  it('round-trips: toJSON of the parsed node re-parses to an identical node', () => {
    const doc = nodeFromContentJson(RICH)!
    const again = nodeFromContentJson(doc.toJSON())!
    expect(again.eq(doc)).toBe(true)
    // KNOWN-NEGATIVE: `eq` must be able to say NO — otherwise this passes on anything. It mutates a
    // REAL attribute (`citekeys`); the first cut mutated an invented one and `eq` said "identical",
    // which is precisely the silent-drop trap this suite exists to catch.
    const mutated = JSON.parse(JSON.stringify(RICH))
    mutated.content[1].content[3].attrs.citekeys = ['different2024']
    expect(nodeFromContentJson(mutated)!.eq(doc)).toBe(false)
  })

  it('unknownAttrsAreDropped: an invented attribute parses SILENTLY — the fixture trap, pinned', () => {
    // Why this test exists: this is the failure mode that made the first fixture a fiction. PM does
    // not reject an unknown attr, so any future assertion written against a MISNAMED attr would read
    // `undefined` and a lenient matcher would pass it. Anyone editing RICH must see this.
    const withJunk = JSON.parse(JSON.stringify(RICH))
    withJunk.content[1].content[3].attrs.notAnAttribute = 'ignored'
    const doc = nodeFromContentJson(withJunk)
    expect(doc).not.toBeNull() // no throw — it is accepted
    let cite: Record<string, unknown> | null = null
    doc!.descendants((n) => { if (n.type.name === 'citation') cite = n.attrs; return true })
    expect(cite).not.toBeNull()
    expect(cite!.notAnAttribute).toBeUndefined() // and silently gone
    // ...and the junk changes NOTHING: it is eq to the clean parse.
    expect(doc!.eq(nodeFromContentJson(RICH)!)).toBe(true)
  })

  it('TaskItem.configure({ nested: true }) actually reaches the schema (audit finding F8)', () => {
    // WHY THIS IS ITS OWN TEST. The RICH fixture's taskItem holds only a paragraph — which is valid
    // under BOTH `nested: true` ('paragraph block*') and plain TaskItem ('paragraph+'). So dropping
    // `.configure({ nested: true })` from the list left every assertion in this file GREEN: a real
    // drift the suite could not see, while its own header warned about exactly this. Same shape as a
    // fixture of 14 identical entries letting a constant score 14/14.
    //
    // Two independent discriminators, because the obvious one does NOT work: `Node.fromJSON` calls
    // `type.create`, which does NOT validate content — so a nested taskItem PARSES FINE under the
    // wrong schema and a round-trip assertion is blind to this. It takes `check()` (PM's explicit
    // content validation) or the content expression itself.
    const s = getEditorSchema()

    // (1) The content expression — the drift, named.
    expect(s.nodes.taskItem.spec.content).toBe('paragraph block*')

    // (2) A NESTED taskItem — a taskList inside a taskItem — must be VALID content. Under plain
    // TaskItem ('paragraph+') this is invalid and check() throws.
    const nested = {
      type: 'doc',
      content: [{
        type: 'taskList',
        content: [{
          type: 'taskItem', attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'outer' }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }] }] },
          ],
        }],
      }],
    }
    const doc = nodeFromContentJson(nested)
    expect(doc).not.toBeNull()
    expect(() => doc!.check()).not.toThrow()

    // KNOWN-NEGATIVE: check() must be capable of throwing, or "not.toThrow" is decoration. A
    // taskItem whose FIRST child is not a paragraph is invalid under both variants.
    const bad = nodeFromContentJson({
      type: 'doc',
      content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'paragraph' }] }] }] }] }],
    })
    expect(bad).not.toBeNull()          // it PARSES — proving fromJSON does not validate…
    expect(() => bad!.check()).toThrow() // …and that check() is what actually sees it.
  })

  it('the citation is an inline ATOM — one node, no children (the pagination contract)', () => {
    // buildRenderModel/collectLines treat an atom as contributing exactly ONE box. If the schema
    // resolved `citation` as a non-atom, it would break AROUND it and every downstream number
    // (CLAUDE.md "Canonical pagination"). This is a schema property, so it is assertable here.
    const s = getEditorSchema()
    expect(s.nodes.citation.isAtom).toBe(true)
    expect(s.nodes.citation.isInline).toBe(true)
    expect(s.nodes.referenceList.isAtom).toBe(true)
  })

  it('returns null — not a throw — on content it cannot parse, and the null is real', () => {
    expect(nodeFromContentJson(null)).toBeNull()
    expect(nodeFromContentJson(undefined)).toBeNull()
    expect(nodeFromContentJson('nope')).toBeNull()
    expect(nodeFromContentJson(42)).toBeNull()
    // An unknown node type: PM throws RangeError inside; we must catch and report the miss.
    expect(nodeFromContentJson({ type: 'doc', content: [{ type: 'noSuchNode' }] })).toBeNull()
    // KNOWN-NEGATIVE: null must MEAN something — a valid doc must NOT be null, or "returns null"
    // is trivially true for every input and the guard is hiding real failures.
    expect(nodeFromContentJson(RICH)).not.toBeNull()
  })
})
