// THE TWO HALVES OF THE SOURCE READER, JOINED — the REAL server extractor (api/_reader-core.mjs, a
// Node ESM module outside the TS project) feeding the REAL client rules (reader/types.ts).
//
// Why this test and not a browser probe: the contract that can silently rot is the SHAPE — the
// server emits blocks, the client renders and reads them, and a hand-kept mirror of a wire format is
// exactly how two implementations drift (pmToText/textMap is this repo's worked example). A browser
// probe proves the pixels once; this proves the contract every run, in milliseconds, offline.
//
// The fixture is HAND-WRITTEN and shaped like the pages this feature exists for — numbered section
// headings, prose with links, and the nav/footer/script chrome that must NOT survive. No third
// party's page is committed here, and none of Peter's writing goes anywhere near a fixture.

import { describe, it, expect } from 'vitest'
// Untyped Node-only ESM module (lives in api/, outside the src TS project) — imported for real, so
// this test exercises the SHIPPED extractor rather than a copy of it.
import * as core from '../../api/_reader-core.mjs'
const { extractBlocks, decodeEntities } = core as unknown as {
  extractBlocks: (html: string, base: string) => { title: string; blocks: ReaderBlock[] }
  decodeEntities: (s: string) => string
}
import { locatorForHeading, type ReaderBlock } from './types'

const PAGE = `<!doctype html>
<html><head><title>Identity (Stanford Encyclopedia of Philosophy)</title>
<script>window.tracker = 1; document.write('<p>injected</p>')</script>
<style>.x{color:red}</style></head>
<body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/search/">Search</a></li></ul></nav>
<main>
  <h1>Identity</h1>
  <!-- Inside the article body ON PURPOSE. The first cut of this fixture put the script in <head>,
       which contentSlice never even looks at — so the "scripts are dropped" assertion could not
       fail, and deleting 'script' from DROP_SUBTREE left the whole suite green. A guard that cannot
       be killed is not a guard. -->
  <script type="application/ld+json">{"@type":"Article","name":"injected-inline"}</script>
  <p>Much of the debate about <em>identity</em> has been about
     personal identity, as discussed in <a href="/entries/personal-identity/">a related entry</a>.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>Identity is a relation &mdash; the relation each thing bears to <strong>itself</strong>.</p>
  <h2 id="RelaIden">2.1 Relative Identity</h2>
  <blockquote>Whatever is, is what it is &amp; not another thing.</blockquote>
  <ul><li>First point</li><li>Second point</li></ul>
  <h2>Bibliography</h2>
  <p>Geach, P., 1967, &lsquo;Identity&rsquo;.</p>
</main>
<footer><p>Copyright &copy; 2024</p></footer>
</body></html>`

const out = extractBlocks(PAGE, 'https://plato.stanford.edu/entries/identity/')
const texts = out.blocks.map((b) => ('text' in b ? b.text : b.items.map((i) => i.map((r) => r.text).join('')).join(' | ')))
const all = texts.join('\n')

describe('the extractor emits exactly the shape the client renders', () => {
  it('finds the title and the prose', () => {
    expect(out.title).toBe('Identity (Stanford Encyclopedia of Philosophy)')
    expect(all).toContain('Much of the debate about identity')
    expect(all).toContain('the relation each thing bears to itself')
  })

  it('DROPS the chrome — nav, footer, script and style never reach the client', () => {
    // The script tag is the important one: it is the whole reason blocks travel instead of HTML.
    expect(all).not.toContain('injected')
    expect(all).not.toContain('injected-inline')   // a script INSIDE the article body
    expect(all).not.toContain('application/ld+json')
    expect(all).not.toContain('window.tracker')
    expect(all).not.toContain('color:red')
    expect(all).not.toContain('Copyright')
    expect(all).not.toContain('Search')
  })

  it('every block is one of the kinds the renderer knows — an unknown kind renders as nothing', () => {
    const known = new Set(['heading', 'para', 'quote', 'code', 'list'])
    for (const b of out.blocks) expect(known.has(b.kind)).toBe(true)
    expect(out.blocks.some((b) => b.kind === 'list')).toBe(true)
    expect(out.blocks.some((b) => b.kind === 'quote')).toBe(true)
  })

  it('resolves links to absolute http(s) and carries emphasis as flags, not markup', () => {
    const p = out.blocks.find((b) => b.kind === 'para' && b.text.includes('personal identity'))!
    const link = (p as Extract<ReaderBlock, { kind: 'para' }>).runs.find((r) => r.href)
    expect(link?.href).toBe('https://plato.stanford.edu/entries/personal-identity/')
    const em = out.blocks.flatMap((b) => ('runs' in b ? b.runs : [])).find((r) => r.em)
    expect(em?.text).toBe('identity')
    // No angle brackets anywhere: the client never receives markup to interpret.
    expect(all).not.toMatch(/<[a-z/]/i)
  })

  it('decodes entities so the reader shows characters, not source', () => {
    expect(all).toContain('—')
    expect(all).toContain('is what it is & not another thing') // from &amp;
    expect(all).not.toContain('&mdash;')
    expect(decodeEntities('&#8212;&hellip;')).toBe('—…')
  })
})

describe('headings → locators, across the real extractor', () => {
  const headings = out.blocks.filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading')

  it('every heading survives with an id the renderer can anchor to', () => {
    expect(headings.map((h) => h.text)).toEqual(['Identity', '1. Introduction', '2.1 Relative Identity', 'Bibliography'])
    for (const h of headings) expect(h.id).toBeTruthy()
  })

  it('a numbered heading cites as its own section number', () => {
    expect(locatorForHeading(headings[1].text)).toEqual({ kind: 'section', value: '1' })
    expect(locatorForHeading(headings[2].text)).toEqual({ kind: 'section', value: '2.1' })
  })

  it('an unnumbered heading is never given an invented number', () => {
    expect(locatorForHeading(headings[3].text)).toEqual({ kind: 'verbatim', value: 'Bibliography' })
  })
})
