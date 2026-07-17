// DIAGNOSTIC: what LINES does the editor's own collector see inside a list?
// collectLines calls `range.selectNodeContents(block).getClientRects()` then keepLineRects
// (drop w<1 / h<1 / h>80s / top within 3px of the last KEPT rect, in RECT ORDER). Replicate that
// verbatim on the real <ul> and compare against the model's lines for the same block.
import { chromium } from '@playwright/test'
import { buildTypeDoc } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const KIND = process.env.KIND || 'bulletList'

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = buildTypeDoc({ types: [KIND], words: 2000, id: KIND })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction((w) => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, 800, { timeout: 60000 })
  await page.waitForTimeout(4500)

  const r = await page.evaluate((k) => {
    const p = window.__iwTextRenderProbe
    const { model } = p.build()
    const killer = document.createElement('style')
    killer.textContent = '.inkwave-page-gap{display:none !important}'
    document.head.appendChild(killer)
    const pm = document.querySelector('.ProseMirror')
    void pm.getBoundingClientRect().height

    const sel = k === 'bulletList' ? 'ul:not([data-type="taskList"])' : 'ol'
    const ul = document.querySelector(`.ProseMirror > ${sel}`)
    const range = document.createRange()
    range.selectNodeContents(ul)
    const raw = [...range.getClientRects()].map((x) => ({ top: +x.top.toFixed(3), h: +x.height.toFixed(3), w: +x.width.toFixed(3), left: +x.left.toFixed(3) }))
    // keepLineRects, verbatim (s = 1: no magnify in the canonical window).
    const kept = []
    let lastTop = -1e9
    for (const x of raw) {
      if (x.w < 1 || x.h < 1 || x.h > 80 || x.top - lastTop <= 3) continue
      lastTop = x.top
      kept.push(x)
    }
    // A control paragraph, so the comparison is not read against a block nobody disputes.
    const p0 = document.querySelector('.ProseMirror > p')
    const r2 = document.createRange(); r2.selectNodeContents(p0)
    const praw = [...r2.getClientRects()].map((x) => ({ top: +x.top.toFixed(3), h: +x.height.toFixed(3) }))
    let plast = -1e9; const pkept = []
    for (const x of praw) { if (x.h < 1 || x.h > 80 || x.top - plast <= 3) continue; plast = x.top; pkept.push(x) }

    const ulTop = ul.getBoundingClientRect().top
    killer.remove()
    const bi = model.blocks.findIndex((x) => x.type === k)
    const mineLines = model.lines.filter((l) => l.blockIdx === bi)
    return {
      block: k,
      rawRects: raw.length, keptRects: kept.length,
      modelLinesInFirstList: mineLines.length,
      rawSample: raw.slice(0, 10),
      keptRel: kept.map((x) => ({ relTop: +(x.top - ulTop).toFixed(3), h: x.h })),
      modelRel: mineLines.map((l) => +(l.top - model.blocks[bi].top).toFixed(3)),
      controlParagraph: { raw: praw.length, kept: pkept.length },
    }
  }, KIND)
  console.log(JSON.stringify(r, null, 1))
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
