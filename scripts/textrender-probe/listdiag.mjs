// DIAGNOSTIC: localise the list divergence against the REAL DOM.
// Compares, per list, the model's block height AND its trailing advance against the live element's
// own rect and the real gap to its next sibling. Lists that contain a page-gap widget are marked —
// the widget injects height into the DOM rect and those rows cannot be read.
import { chromium } from '@playwright/test'
import { buildTypeDoc } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  for (const kind of ['bulletList', 'orderedList']) {
    const doc = buildTypeDoc({ types: [kind], words: 2000, id: kind })
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
    await page.waitForFunction((w) => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, 800, { timeout: 60000 })
    await page.waitForTimeout(4500)
    const r = await page.evaluate((k) => {
      const p = window.__iwTextRenderProbe
      const { model } = p.build()
      const sel = k === 'bulletList' ? 'ul:not([data-type="taskList"])' : 'ol'

      // Hide the gap widgets so the DOM rects are the NATURAL ones the model claims to reproduce.
      const killer = document.createElement('style')
      killer.textContent = '.inkwave-page-gap{display:none !important}'
      document.head.appendChild(killer)
      const pm = document.querySelector('.ProseMirror')
      void pm.getBoundingClientRect().height

      const uls = [...document.querySelectorAll(`.ProseMirror > ${sel}`)]
      const mine = model.blocks.filter((b) => b.type === k)
      const rows = []
      for (let i = 0; i < Math.min(uls.length, mine.length); i++) {
        const ul = uls[i]
        const rect = ul.getBoundingClientRect()
        const lis = [...ul.children]
        const pRects = lis.map((li) => li.querySelector('p').getBoundingClientRect())
        const sum = pRects.reduce((a, c) => a + c.height, 0)
        let next = ul.nextElementSibling
        while (next && next.classList.contains('inkwave-page-gap')) next = next.nextElementSibling
        rows.push({
          i, items: lis.length,
          domH: +rect.height.toFixed(3), mineH: +mine[i].height.toFixed(3), dH: +(mine[i].height - rect.height).toFixed(3),
          sumParas: +sum.toFixed(3),
          domHminusSum: +(rect.height - sum).toFixed(3),
          mineHminusSum: +(mine[i].height - sum).toFixed(3),
          // The REAL trailing advance: top of the next block minus the list's bottom edge.
          domNextGap: next ? +(next.getBoundingClientRect().top - rect.bottom).toFixed(3) : null,
          // The MODEL's trailing advance: the next block's top minus this block's bottom.
          mineNextGap: (() => { const j = model.blocks.indexOf(mine[i]); const n = model.blocks[j + 1]; return n ? +(n.top - (mine[i].top + mine[i].height)).toFixed(3) : null })(),
        })
      }
      const ul0 = uls[0]
      const cs = ul0 && getComputedStyle(ul0)
      const p0 = ul0 && ul0.querySelector('p')
      const css = ul0 ? { ulMT: cs.marginTop, ulMB: cs.marginBottom, pad: cs.paddingInlineStart, liPMB: getComputedStyle(p0).marginBottom, liPMT: getComputedStyle(p0).marginTop, liMB: getComputedStyle(p0.parentElement).marginBottom } : null
      killer.remove()
      return { lists: uls.length, modelLists: mine.length, css, rows: rows.slice(0, 4), distinctDH: [...new Set(rows.map((x) => x.dH))], distinctGap: [...new Set(rows.map((x) => `${x.mineNextGap} vs ${x.domNextGap}`))] }
    }, kind)
    console.log(`\n═══ ${kind} ═══`)
    console.log(JSON.stringify(r, null, 1))
  }
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
