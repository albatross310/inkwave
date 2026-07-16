// The refList's real DOM TREE + where its box actually comes from.
// Asked because the census reported `.node-referenceList` with marginTop/paddingTop/borderTop ALL 0,
// while ReferenceListNodeView plainly sets marginTop:2.5em, paddingTop:1em, borderTop:1px — i.e. the
// selector blockStyles harvests `refList:wrap` from may not be the element that carries the box.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4247}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-tree' })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2000)

const out = await page.evaluate(() => {
  const node = document.querySelector('.node-referenceList')
  const desc = el => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      rect: { top: +r.top.toFixed(2), h: +r.height.toFixed(2), w: +r.width.toFixed(2) },
      mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, bt: cs.borderTopWidth,
      fs: cs.fontSize, display: cs.display,
    }
  }
  // Walk from the PM top-level block DOWN to the entries, naming every box on the way.
  const chainUp = []
  let e = node
  for (let i = 0; i < 4 && e; i++) { chainUp.push(desc(e)); e = e.parentElement }
  const kids = []
  const walk = (el, d) => {
    if (d > 3) return
    for (const c of el.children) { kids.push({ depth: d, ...desc(c) }); walk(c, d + 1) }
  }
  walk(node, 0)

  // Is .node-referenceList the SAME element as the styled <section>?
  const section = node.querySelector('section') || (node.tagName === 'SECTION' ? node : null)
  // The PM top-level child that IS this block (what the renderer's block box must equal).
  const pmChild = [...document.querySelector('.ProseMirror').children].find(c => c.contains(node) || c === node)

  return {
    nodeIsSection: node.tagName.toLowerCase() === 'section',
    chainUp,
    kids: kids.slice(0, 14),
    sectionDesc: section ? desc(section) : null,
    pmChild: pmChild ? desc(pmChild) : null,
    // The number that matters: the block's TOTAL advance in the editor's flow.
    pmChildOuter: pmChild ? (() => { const cs = getComputedStyle(pmChild); const r = pmChild.getBoundingClientRect(); return { h: +r.height.toFixed(2), mt: cs.marginTop, mb: cs.marginBottom } })() : null,
  }
})
console.log(JSON.stringify(out, null, 2))
await b.close()
