// @vitest-environment jsdom
//
// THE HARVEST SELECTORS SELECT THE ELEMENT THAT CARRIES THE BOX. ~80ms, jsdom.
//
// `blockStyles.ts` harvests the bibliography's geometry from the REAL rendered node
// (`refList:wrap`, `refList:headerRow`, `refList:body`, `refList:entry`, …) and `refChrome.ts` the
// back-ref chrome (`group`, `arrow`, `link`, `quote`, `note`, `esp`). Each is a CSS selector against
// markup `ReferenceListNodeView` emits, and a renamed class makes it read ZEROS silently — which is
// exactly how `refList:wrap` came to be harvested from `.node-referenceList` (the React-renderer DIV:
// margin/padding/border 0/0/0, while the real 2.5em/1em/1px live on the `<section>` INSIDE it) and
// `refList:headerRow` from the h2 (margin 0; the row's own 0.6em belongs to its flex parent).
// → docs/archive/snapshot-scrub-rounds.md#tr-refchrome
//
// So: render the REAL component, read the selector tables OUT OF THE SOURCE (comments stripped —
// they are not exported, and a hand-copied list is the drift this test exists to stop), and assert
// each selector resolves to an element that carries the box it is harvested for. The OLD selectors
// are kept as the known-negatives that must resolve to a box-less element (R3). jsdom lays nothing
// out, so `harvestBlockStyles` itself (which skips elements with no client rects) is not driven
// here — the CONTRACT it depends on is: `reflharvest.prove.mjs` measured the px in a browser
// (45/18/1 and 10.8) and is retired to docs/archive/probes/.
//
// Everything the component reaches for beyond its own markup is mocked to a plain value — the
// library, the CSL formatter, the citation walks — because none of it is what is under test.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { NodeViewProps } from '@tiptap/react'

vi.mock('../citations/bibProvider', () => ({
  bibProvider: {
    get: (k: string) => (k === 'k1' ? { id: 'k1', type: 'book', title: 'A Source', _iw: { note: '' } } : undefined),
    getVersion: () => 1,
    subscribe: () => () => {},
  },
}))
vi.mock('../citations/library', () => ({ addToLibrary: async () => {} }))
vi.mock('../citations/resolve', () => ({ referenceListKeysFromDoc: () => ['k1'] }))
vi.mock('../citations/format', () => ({ simpleRefList: () => 'A Source' }))
vi.mock('../citations/bibFormat', () => ({
  ensureBibEntries: async (items: Array<{ id: string }>) =>
    items.map((it) => [it.id, `<div class="csl-entry">Author, A. (2020). <i>A Source</i>. Press.</div>`]),
}))
vi.mock('../citations/pdfHighlights', () => ({ highlightPages: () => [] }))
vi.mock('../citations/pdfSource', () => ({ hasPdf: () => false }))
vi.mock('../citations/pdfViewer', () => ({ openPdf: () => {}, getLastPdfPage: () => 1 }))
vi.mock('../citations/pageOffset', () => ({ pageOffsetOf: () => 0 }))
vi.mock('../citations/citationsBus', () => ({ getCitationStyle: () => 'apa', subscribeCitationStyle: () => () => {} }))
vi.mock('../citations/citationNav', () => ({
  bibAnchorId: (k: string) => `iwbib-${k}`,
  citeAnchorId: (k: string, o: number) => `iwcite-${k}-${o}`,
  navigateToAnchor: () => {},
  ensureNavStyles: () => {},
  occurrenceCounts: () => new Map([['k1', 2]]),
  citedPages: () => [3, 7],
  formatPages: (n: number[]) => n.join(', '),
  occurrencePages: () => [{ occ: 1, page: 2 }, { occ: 2, page: null }],
  occurrenceQuotes: () => ['the first words of a quote', ''],
}))

import { ReferenceListNodeView } from './extensions/ReferenceListNodeView'

afterEach(cleanup)

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
// Under the jsdom environment `import.meta.url` is an http: URL, so resolve from the project root.
const blockStylesSrc = strip(readFileSync(join(process.cwd(), 'src/editor/blockStyles.ts'), 'utf8'))
const refChromeSrc = strip(readFileSync(join(process.cwd(), 'src/citations/refChrome.ts'), 'utf8'))

/** `['refList:wrap', '.node-referenceList > section']` tuples, read from code. */
const refListSelectors = [...blockStylesSrc.matchAll(/\[\s*'(refList:[\w]+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]] as const)
// The LITERAL after `=`, not the `Array<[string, string]>` annotation's brackets before it.
const subLiteral = refChromeSrc.match(/const SUB\b[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? ''
const chromeSelectors = [...subLiteral.matchAll(/\[\s*'(\w+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]] as const)

/** The node view inside the wrapper Tiptap's ReactNodeViewRenderer gives it (`node-<typeName>`). */
async function mountBibliography() {
  const editor = { state: { doc: {} }, on() {}, off() {} }
  const props = { node: { attrs: { mode: 'cited' } }, editor, selected: false } as unknown as NodeViewProps
  const host = document.createElement('div')
  host.className = 'node-referenceList'
  document.body.appendChild(host)
  render(<ReferenceListNodeView {...props} />, { container: host })
  await waitFor(() => { if (!host.querySelector('.iw-bib-entry')) throw new Error('entries not rendered yet') })
  return host
}

describe('the selector tables were read from source (VOID guard)', () => {
  it('blockStyles.ts declares the refList selectors and refChrome.ts the chrome SUB table', () => {
    expect(refListSelectors.map(([k]) => k)).toEqual(
      expect.arrayContaining(['refList:wrap', 'refList:headerRow', 'refList:body', 'refList:entry']))
    expect(chromeSelectors.map(([k]) => k)).toEqual(
      expect.arrayContaining(['group', 'arrow', 'link', 'quote', 'note', 'esp']))
  })
})

describe('every harvest selector resolves in the real ReferenceListNodeView markup', () => {
  it('blockStyles refList:* — each resolves, and to the element that carries the box', async () => {
    const host = await mountBibliography()
    const bySel = new Map(refListSelectors)
    for (const [kind, sel] of refListSelectors) {
      const el = document.querySelector<HTMLElement>(sel)
      expect(el, `${kind} → ${sel} resolved to nothing`).not.toBeNull()
    }
    // The box-carrying facts the browser measured (45px/18px/1px, 10.8px) live on THESE elements:
    const wrap = document.querySelector<HTMLElement>(bySel.get('refList:wrap')!)!
    expect(wrap.tagName).toBe('SECTION')
    expect(wrap.style.marginTop).toBe('2.5em')
    expect(wrap.style.paddingTop).toBe('1em')
    expect(wrap.style.borderTop).toMatch(/^1px solid/)
    const row = document.querySelector<HTMLElement>(bySel.get('refList:headerRow')!)!
    expect(row.style.marginBottom).toBe('0.6em')
    expect(row.querySelector('h2')).not.toBeNull() // the row is the h2's flex PARENT
    const body = document.querySelector<HTMLElement>(bySel.get('refList:body')!)!
    expect(body.style.fontSize).toBe('0.92em')
    expect(String(body.style.lineHeight)).toBe('1.38')
    const entry = document.querySelector<HTMLElement>(bySel.get('refList:entry')!)!
    expect(entry.style.marginBottom).toBe('0.6em')
    expect(host.contains(entry)).toBe(true)
  })

  it('KNOWN-NEGATIVE: the OLD wrap/headerRow selectors resolve to elements WITHOUT the box (the zeros that made it a guess)', async () => {
    await mountBibliography()
    const oldWrap = document.querySelector<HTMLElement>('.node-referenceList')!
    expect(oldWrap.tagName).toBe('DIV')
    expect(oldWrap.style.paddingTop).toBe('')
    expect(oldWrap.style.marginTop).toBe('')
    expect(oldWrap.style.borderTop).toBe('')
    const oldHeader = document.querySelector<HTMLElement>('.node-referenceList h2')!
    // `margin: 0` on the h2 — the CSSOM expands the shorthand, so its bottom margin reads 0px: the row's
    // 0.6em spacing is NOT on the heading, which is exactly the zero the old selector harvested.
    expect(oldHeader.style.margin).toBe('0px')
    expect(oldHeader.style.marginBottom).toBe('0px')
  })

  it('refChrome SUB — every chrome class is emitted by the real back-ref markup', async () => {
    await mountBibliography()
    for (const [kind, sel] of chromeSelectors) {
      expect(document.querySelector(sel), `${kind} → ${sel} resolved to nothing`).not.toBeNull()
    }
    // The arrow is the element whose 1.15em under a unitless 1.38 raises the entry (26.2807 > strut).
    const arrow = document.querySelector('.node-referenceList .iw-backref-arrow')!
    expect(arrow.textContent).toBe('↩')
    // The group declares nowrap in a stylesheet that prosemirror-view out-specifies — it is NOT an
    // atom, and this markup carries contenteditable=false, which is what makes that rule apply.
    expect(document.querySelector('.iw-backref-group')!.getAttribute('contenteditable')).toBe('false')
  })
})
