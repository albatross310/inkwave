// @vitest-environment jsdom
// THE /edit HALF — the guarantee this lane actually makes (2026-07-17, audit finding F7).
//
// WHY THIS FILE EXISTS. `editorSchema.test.ts` proves the /snapshot half: a contentJson becomes a PM
// Node. But this refactor's PROMISE is about the other half — that the EDITOR's construction is
// behaviourally unchanged — and that half had no assertion at all. An auditor mutated
// `RedHighlightExtension.configure({…})` to `.configure({})`, silently stripping all three plugin
// closures from the live editor (`getDoc`'s default THROWS, so SCAS red-highlighting dies at
// runtime), and the ENTIRE gate — 79 files, 1061 tests — stayed green. The most load-bearing thing
// in the app was guarded by nothing. That is what these tests fix.
//
// THE ONE SEMANTIC CHANGE in the whole extraction is `RedHighlightExtension.configure(deps ? {…} :
// {})`. Everything else is byte-identical to the former inline literal. So that ternary is exactly
// where a regression can hide, and it is what is pinned here — on BOTH arms:
//   deps present (the editor)   ⇒ the closures must ARRIVE, by identity.
//   deps absent  (the schema)   ⇒ they must be absent, and the default must be the THROWING one
//                                 (that throw is the design: it makes a silent omission loud).
//
// The NodeView .tsx stubs are for the reactRouter() vite plugin (it throws its Fast-Refresh preamble
// error on any .tsx import under vitest); NodeViews are a rendering strategy, not part of an
// extension's options or schema, so stubbing them cannot make a wrong result look right.

import { describe, it, expect, vi } from 'vitest'

vi.mock('./CitationNodeView', () => ({ CitationNodeView: () => null }))
vi.mock('./MathInlineView', () => ({ MathInlineView: () => null }))
vi.mock('./MathBlockView', () => ({ MathBlockView: () => null }))
vi.mock('./ReferenceListNodeView', () => ({ ReferenceListNodeView: () => null }))

import { buildEditorExtensions } from './editorExtensions'

// The three closures the live editor passes, as identities we can assert ARRIVED.
const makeDeps = () => {
  const doc = { id: 'd1' } as never
  const hint = { focusedPos: null } as never
  const lookup = { version: 1 } as never
  return {
    getDoc: () => doc,
    getHintState: () => hint,
    getScasLookup: () => lookup,
    _doc: doc, _hint: hint, _lookup: lookup,
  }
}

const redHighlightOf = (exts: ReturnType<typeof buildEditorExtensions>) => {
  const e = exts.find(x => x.name === 'redHighlight')
  expect(e, 'redHighlight must be in the list at all').toBeDefined()
  return e as { name: string; options: Record<string, unknown> }
}

const paginationOf = (exts: ReturnType<typeof buildEditorExtensions>) => {
  const e = exts.find(x => x.name === 'pagination')
  expect(e, 'pagination must be in the list at all').toBeDefined()
  return e as { name: string; options: Record<string, unknown> }
}

describe('buildEditorExtensions — the editor half (F7)', () => {
  it('THE EDITOR PATH: all three closures arrive on RedHighlightExtension, by identity', () => {
    const deps = makeDeps()
    const red = redHighlightOf(buildEditorExtensions(deps))

    // Identity, not shape: `.configure({})` would leave the DEFAULTS here, which are functions too —
    // so a truthiness or typeof check would pass on the stripped list and prove nothing. This is the
    // assertion the auditor's mutation must turn red.
    expect(red.options.getDoc).toBe(deps.getDoc)
    expect(red.options.getHintState).toBe(deps.getHintState)
    expect(red.options.getScasLookup).toBe(deps.getScasLookup)

    // And they must WORK — the closure must actually reach through to the caller's state.
    expect((red.options.getDoc as () => unknown)()).toBe(deps._doc)
    expect((red.options.getHintState as () => unknown)()).toBe(deps._hint)
    expect((red.options.getScasLookup as () => unknown)()).toBe(deps._lookup)
  })

  it('KNOWN-NEGATIVE: the deps-less list does NOT carry them — so the test above can fail', () => {
    // If the assertions above passed for BOTH arms they would be measuring nothing. This is the
    // exact shape of the auditor's mutation (`configure({})`), and it must be distinguishable.
    const deps = makeDeps()
    const red = redHighlightOf(buildEditorExtensions())
    expect(red.options.getDoc).not.toBe(deps.getDoc)
    expect(red.options.getHintState).not.toBe(deps.getHintState)
    expect(red.options.getScasLookup).not.toBe(deps.getScasLookup)
  })

  it('the deps-less default for getDoc THROWS — a silent omission must be loud, not subtly wrong', () => {
    // This is WHY omitting deps is safe only for `getSchema` (which never installs plugins). If this
    // default is ever "tidied" into something forgiving, an editor built without deps would render
    // quietly wrong instead of failing — and the comment in editorExtensions.ts explaining that
    // would become false. Pin the throw.
    const red = redHighlightOf(buildEditorExtensions())
    expect(() => (red.options.getDoc as () => unknown)()).toThrow()
  })

  it('the extraction is faithful: 27 entries, RedHighlight is the only deps-dependent one', () => {
    const withDeps = buildEditorExtensions(makeDeps())
    const without = buildEditorExtensions()

    // Same shape either way — the ternary must change ONE extension's options, never the list.
    expect(withDeps.length).toBe(without.length)
    expect(withDeps.length).toBe(27)
    expect(withDeps.map(e => e.name)).toEqual(without.map(e => e.name))

    // Names are unique — a duplicate entry (e.g. a bad merge re-adding one) would make tiptap
    // resolve a different schema than the editor's and is invisible to a length check alone.
    const names = withDeps.map(e => e.name)
    expect(new Set(names).size).toBe(names.length)

    // Every OTHER extension's options must be unaffected by deps. This is the "same configure args"
    // claim, asserted rather than asserted-by-comment: if a future edit threads deps into a second
    // extension, this goes red and the author must say so out loud.
    for (const a of withDeps) {
      if (a.name === 'redHighlight') continue
      const b = without.find(x => x.name === a.name)!
      expect(JSON.stringify(a.options ?? null), `options drifted for ${a.name}`)
        .toBe(JSON.stringify(b.options ?? null))
    }
  })

  it('a fresh array per call — the editor re-creates it per render exactly as the inline literal did', () => {
    // useEditor's options object is rebuilt every render; the former inline literal produced a new
    // array each time. If this ever returned a shared/frozen singleton, extensions would be reused
    // across editor instances — a different construction than the one measured.
    const a = buildEditorExtensions(makeDeps())
    const b = buildEditorExtensions(makeDeps())
    expect(a).not.toBe(b)
    expect(a[0]).toBeDefined()
  })

  it('keeps application content continuous without forking the editor extension list', () => {
    const deps = makeDeps()
    const documentExtensions = buildEditorExtensions(deps)
    const applicationExtensions = buildEditorExtensions({ ...deps, presentation: 'application' })

    expect(applicationExtensions.map(e => e.name)).toEqual(documentExtensions.map(e => e.name))
    expect(paginationOf(applicationExtensions).options.gapped).toBe(false)
  })
})
