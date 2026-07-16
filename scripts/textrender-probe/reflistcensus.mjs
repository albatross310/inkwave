// WHAT THE RENDERED BIBLIOGRAPHY ACTUALLY IS — asked of the real DOM, before anything is designed.
//
// The spec for this round described the refList as "hanging indent + 0.6em entry spacing". That is a
// HAND-DERIVED description, and a hand-derived description of a nested-em chain is exactly how a
// height becomes a guess (blockStyles.ts's whole preamble). So: ask the real rendered bibliography
// what it is — its computed ems, its real entry heights, its markup, and what the chrome costs.
//
// This probe STATES nothing. It only reports what the DOM says.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4247}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)

const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-census' })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 1000, null, { timeout: 60000 })
// The refList NodeView formats CSL asynchronously — wait for entries to actually exist.
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)

const census = await page.evaluate(() => {
  const sec = document.querySelector('.node-referenceList')
  if (!sec) return { error: 'no .node-referenceList' }
  const cs = el => getComputedStyle(el)
  const num = v => parseFloat(v) || 0
  const rectOf = el => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) } }

  const wrap = cs(sec)
  const h2 = sec.querySelector('h2')
  const headerRow = h2 ? h2.parentElement : null
  const body = sec.querySelector('.csl-bib-body')
  const entries = [...sec.querySelectorAll('.iw-bib-entry')]

  // The nested-em chain, READ not derived.
  const chain = {
    wrapper: { fontSize: num(wrap.fontSize), marginTop: num(wrap.marginTop), paddingTop: num(wrap.paddingTop), borderTop: num(wrap.borderTopWidth) },
    headerRow: headerRow ? { fontSize: num(cs(headerRow).fontSize), marginBottom: num(cs(headerRow).marginBottom), h: rectOf(headerRow).h } : null,
    h2: h2 ? { fontSize: num(cs(h2).fontSize), fontWeight: cs(h2).fontWeight, lineHeight: cs(h2).lineHeight, margin: cs(h2).margin, h: rectOf(h2).h, family: cs(h2).fontFamily } : null,
    body: body ? { fontSize: num(cs(body).fontSize), lineHeight: cs(body).lineHeight, w: rectOf(body).w } : null,
  }

  // PER ENTRY: the real height, the real indent, and the real markup.
  const perEntry = entries.map(e => {
    const ecs = cs(e)
    const cslEntry = e.querySelector('.csl-entry')
    const ccs = cslEntry ? cs(cslEntry) : null
    const inner = e.firstElementChild // the div wrapping dangerouslySetInnerHTML
    const icss = inner ? cs(inner) : null
    return {
      id: (e.querySelector('[id^="iwbib-"]') || {}).id || null,
      rect: rectOf(e),
      fontSize: num(ecs.fontSize),
      marginBottom: num(ecs.marginBottom),
      lineHeight: ecs.lineHeight,
      // THE HANGING-INDENT QUESTION, asked of every level that could carry it.
      indent: {
        entryPadLeft: num(ecs.paddingLeft), entryTextIndent: num(ecs.textIndent),
        innerPadLeft: icss ? num(icss.paddingLeft) : null, innerTextIndent: icss ? num(icss.textIndent) : null,
        cslPadLeft: ccs ? num(ccs.paddingLeft) : null, cslTextIndent: ccs ? num(ccs.textIndent) : null,
        cslDisplay: ccs ? ccs.display : null,
      },
      // What the chrome costs, per entry — measured, not assumed away.
      chrome: {
        backref: e.querySelector('.iw-backref-group') ? rectOf(e.querySelector('.iw-backref-group')) : null,
        note: e.querySelector('.iw-note-add') ? rectOf(e.querySelector('.iw-note-add')) : null,
        esp: e.querySelector('.iw-esp') ? rectOf(e.querySelector('.iw-esp')) : null,
      },
      // The markup citeproc actually emitted (does it carry <i>?).
      html: cslEntry ? cslEntry.innerHTML.slice(0, 300) : null,
      tags: cslEntry ? [...new Set([...cslEntry.querySelectorAll('*')].map(n => n.tagName.toLowerCase()))] : null,
    }
  })

  // What does the RENDERER currently think this block is?
  const p = window.__iwTextRenderProbe
  const { model } = p.build()
  const bi = model.blocks.findIndex(b => b.type === 'referenceList')
  const blk = model.blocks[bi]

  return {
    chain,
    entryCount: entries.length,
    sectionRect: rectOf(sec),
    perEntry,
    renderer: blk ? { height: blk.height, estimated: blk.estimated, label: blk.label } : null,
    reliablePages: model.reliablePages, pages: model.pages, estimatedBlocks: model.estimatedBlocks,
    coverage: model.coverage,
    blockStyleKeys: (window.__iwBlockStyles || {}).keys,
  }
})

console.log(JSON.stringify(census, null, 2))
await b.close()
