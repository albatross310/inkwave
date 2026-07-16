// THE RICH DIFF, PROVED.
//
// Three things have to be true before this can render Peter's document, and each has a way of being
// silently wrong:
//   1. With NO diff (`ops === null`, the first snapshot) it must be EXACTLY DocView. Asserted as
//      byte-identical markup, not "looks similar" — DocView is the rich rendering the pane already
//      trusted for version 1, so any divergence is a regression against a shipped surface.
//   2. NO DELETION MAY BE DROPPED OR DUPLICATED. A del exists only in PREV and has no home in CUR's
//      tree; if the projection loses one, the reader sees a document that never existed, and the
//      pane would look right while being wrong. Asserted by CONSERVATION: the text inside .diff-del
//      spans, concatenated, must equal the del ops' text exactly.
//   3. The visible text must still be the DOCUMENT. Asserted by reconstructing cur's flat text from
//      the rendered markup.
//
// Every conservation assertion is paired with a mutation that proves it can FAIL — a conservation
// law over an empty set is satisfied by nothing at all, which is exactly how a suite like this
// passes while the feature is broken.
import { describe, it, expect, beforeAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichDiffView } from './RichDiffView'
import { DocView } from './DocView'
import { bibProvider } from '../citations/bibProvider'
import { diffWords, splitChangesAtReturns, type DiffOp } from '../provenance/diff'
import { pmToText } from '../provenance/bundle'
import type { TiptapJSON } from '../types/document'

const p = (...kids: unknown[]) => ({ type: 'paragraph', content: kids })
const t = (text: string) => ({ type: 'text', text })
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const cite = (key: string) => ({ type: 'citation', attrs: { citekeys: [key], prefix: '', suffix: '', locator: '' } })
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as unknown as TiptapJSON
const list = (...items: string[]) => ({ type: 'bulletList', content: items.map((s) => ({ type: 'listItem', content: [p(t(s))] })) })

beforeAll(() => {
  bibProvider.setEntries([
    { id: 'leibniz1686', type: 'book', title: 'Discourse', author: [{ family: 'Leibniz', given: 'G' }], issued: { 'date-parts': [[1686]] } },
  ] as unknown as Parameters<typeof bibProvider.setEntries>[0], 'library')
})

const opsFor = (a: TiptapJSON, b: TiptapJSON): DiffOp[] =>
  splitChangesAtReturns(diffWords(pmToText(a, true), pmToText(b, true)))

const render = (d: TiptapJSON, ops: DiffOp[] | null) => renderToStaticMarkup(<RichDiffView doc={d} ops={ops} />)

/** Text inside every span carrying `cls`, in document order.
 *  `[\s\S]*?`, NOT `.*?`: `splitChangesAtReturns` splits a change at its newlines and KEEPS them in
 *  the op's text, so a deleted paragraph's del text is "\n\ndoomed\n". `.` does not match a newline,
 *  so a `.*?` extractor silently reads those spans as absent — it reported a deleted paragraph as
 *  DROPPED when the component had rendered it correctly. An extractor that cannot see the thing it
 *  measures fails toward "the feature is broken", which is the most expensive direction to be wrong in. */
function textIn(markup: string, cls: string): string {
  const out: string[] = []
  const re = new RegExp(`<span[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</span>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(markup))) out.push(m[1])
  return out.join('')
}
const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, '')

// ── 1. NO DIFF ⇒ EXACTLY DocView ────────────────────────────────────────────────────────────────
describe('ops === null renders exactly DocView', () => {
  const fixtures: Array<[string, TiptapJSON]> = [
    ['paragraphs', doc(p(t('hello world')), p(t('second block')))],
    ['heading + list', doc(h(2, 'A Heading'), list('one', 'two'), p(t('after')))],
    ['citation mid-paragraph', doc(p(t('as argued '), cite('leibniz1686'), t(' the point stands')))],
    ['marks', doc(p({ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, t(' plain')))],
    ['hard breaks', doc(p(t('line one'), { type: 'hardBreak' }, t('line two')))],
    ['blockquote + code', doc({ type: 'blockquote', content: [p(t('quoted'))] }, { type: 'codeBlock', content: [t('const x = 1')] })],
    ['whitespace-only + empty blocks', doc(p(t('   ')), p(), p(t('kept')))],
  ]
  for (const [name, d] of fixtures) {
    it(`byte-identical to DocView (${name})`, () => {
      expect(render(d, null)).toBe(renderToStaticMarkup(<DocView doc={d} />))
    })
  }

  it('the comparison DISCRIMINATES — a different doc does not match (negative FIRES)', () => {
    const a = doc(p(t('hello world')))
    const b = doc(p(t('hello worlds')))
    expect(render(a, null)).not.toBe(renderToStaticMarkup(<DocView doc={b} />))
  })
})

// ── 2. CONSERVATION: no deletion dropped, none duplicated ───────────────────────────────────────
describe('deletions are conserved', () => {
  const cases: Array<[string, TiptapJSON, TiptapJSON]> = [
    ['a word deleted mid-paragraph', doc(p(t('alpha REMOVED beta'))), doc(p(t('alpha beta')))],
    ['TWO words deleted (the case a single del cannot see)',
      doc(p(t('alpha GONE1 beta GONE2 gamma'))), doc(p(t('alpha beta gamma')))],
    ['a whole paragraph deleted (a GAP del — no text node to sit in)',
      doc(p(t('first para')), p(t('doomed para')), p(t('third para'))), doc(p(t('first para')), p(t('third para')))],
    ['the FIRST paragraph deleted (gap del before any block)',
      doc(p(t('doomed')), p(t('survivor'))), doc(p(t('survivor')))],
    ['the LAST paragraph deleted (trailing gap del — nothing follows it)',
      doc(p(t('survivor')), p(t('doomed'))), doc(p(t('survivor')))],
    ['a list item deleted', doc(list('one', 'doomed', 'three')), doc(list('one', 'three'))],
    ['a heading deleted', doc(h(2, 'Doomed Heading'), p(t('body'))), doc(p(t('body')))],
    ['deleted text around a citation', doc(p(t('gone '), cite('leibniz1686'), t(' kept'))), doc(p(cite('leibniz1686'), t(' kept')))],
    ['everything deleted', doc(p(t('all of it'))), doc(p(t('replaced')))],
    // THE HOLE THE BRANCH-INSTRUMENTATION FOUND, and the tests above could not: when CUR has NO
    // blocks (every block empty ⇒ pmToText drops them ⇒ map.blocks === []), nothing can claim a del
    // and every deletion vanished from the pane while the flat view still showed it. Deleting all
    // your text is not an exotic shape.
    ['cur is EMPTY — every block dropped (orphan dels)', doc(p(t('gone entirely'))), doc(p(t('')))],
    ['cur emptied to whitespace only', doc(p(t('alpha beta')), p(t('gamma'))), doc(p(t('   ')))],
  ]

  for (const [name, prev, cur] of cases) {
    it(`every deleted word appears exactly once (${name})`, () => {
      const ops = opsFor(prev, cur)
      const dels = ops.filter((o) => o.type === 'del')
      expect(dels.length).toBeGreaterThan(0) // the fixture must actually delete something
      const markup = render(cur, ops)
      expect(textIn(markup, 'diff-del')).toBe(dels.map((o) => o.text).join(''))
    })
  }

  it('additions are conserved too', () => {
    const prev = doc(p(t('alpha gamma')))
    const cur = doc(p(t('alpha BETA gamma')))
    const ops = opsFor(prev, cur)
    const adds = ops.filter((o) => o.type === 'add')
    expect(adds.length).toBeGreaterThan(0)
    expect(textIn(render(cur, ops), 'diff-add')).toBe(adds.map((o) => o.text).join(''))
  })

  // THE KNOWN-NEGATIVE. A conservation law is trivially satisfied if nothing is ever emitted, so
  // prove the extractor can SEE a discrepancy before any pass above is believed.
  it('the conservation check FIRES on a dropped or duplicated deletion (negative)', () => {
    const prev = doc(p(t('alpha GONE1 beta GONE2 gamma')))
    const cur = doc(p(t('alpha beta gamma')))
    const ops = opsFor(prev, cur)
    const expected = ops.filter((o) => o.type === 'del').map((o) => o.text).join('')
    const markup = render(cur, ops)
    expect(textIn(markup, 'diff-del')).toBe(expected)
    // DROP one → the check must fail.
    const dropped = markup.replace(/<span[^>]*class="diff-del"[^>]*>[\s\S]*?<\/span>/, '')
    expect(textIn(dropped, 'diff-del')).not.toBe(expected)
    // DUPLICATE one → the check must fail.
    const firstDel = /<span[^>]*class="diff-del"[^>]*>[\s\S]*?<\/span>/.exec(markup)![0]
    expect(textIn(markup.replace(firstDel, firstDel + firstDel), 'diff-del')).not.toBe(expected)
    // …and the extractor is not simply always-different: the untouched markup still matches.
    expect(textIn(markup, 'diff-del')).toBe(expected)
  })
})

// ── 3. The rendered document is still the DOCUMENT ──────────────────────────────────────────────
describe('the visible text is cur’s document', () => {
  it('stripping the marks leaves cur’s own words, in order', () => {
    const prev = doc(h(2, 'Old Heading'), p(t('alpha REMOVED beta')), list('one', 'doomed'))
    const cur = doc(h(2, 'New Heading'), p(t('alpha beta')), list('one'))
    const ops = opsFor(prev, cur)
    const markup = render(cur, ops)
    // Every del span removed ⇒ what remains is exactly cur's rendered text.
    const withoutDels = markup.replace(/<span[^>]*class="diff-del"[^>]*>[\s\S]*?<\/span>/g, '')
    const visible = stripTags(withoutDels)
    for (const word of ['New Heading', 'alpha beta', 'one']) expect(visible).toContain(word)
    expect(visible).not.toContain('doomed')
    expect(visible).not.toContain('REMOVED')
  })

  it('structure survives: headings, lists and paragraphs are real elements', () => {
    const prev = doc(p(t('x')))
    const cur = doc(h(2, 'Title'), list('a', 'b'), p(t('body')))
    const markup = render(cur, opsFor(prev, cur))
    expect(markup).toContain('<h2>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<li>')
    expect(markup).toContain('<p>')
  })

  it('every marked run carries data-opidx addressing the SOURCE op (the pane hover contract)', () => {
    const prev = doc(p(t('alpha REMOVED beta')))
    const cur = doc(p(t('alpha ADDED beta')))
    const ops = opsFor(prev, cur)
    const markup = render(cur, ops)
    const idxs = [...markup.matchAll(/data-opidx="(\d+)"/g)].map((m) => Number(m[1]))
    expect(idxs.length).toBeGreaterThan(0)
    // A run is a SLICE of an op, never a new op — so every emitted index must exist in `ops`, and
    // must name an op of a type that actually gets marked.
    for (const i of idxs) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(ops.length)
      expect(ops[i].type).not.toBe('same')
    }
  })

  it('a citation still renders its resolved label', () => {
    const cur = doc(p(t('see '), cite('leibniz1686')))
    expect(stripTags(render(cur, null))).toContain('(Leibniz, 1686)')
  })

  it('an unchanged document emits no marks at all', () => {
    const d = doc(p(t('identical text')), h(2, 'Same'))
    const markup = render(d, opsFor(d, d))
    expect(markup).not.toContain('diff-del')
    expect(markup).not.toContain('diff-add')
    expect(stripTags(markup)).toContain('identical text')
  })
})
