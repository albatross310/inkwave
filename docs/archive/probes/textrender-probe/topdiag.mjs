// DIAGNOSTIC: the model's LINE TOPS vs the DOM's own, gap-free, over the whole document.
// paginate() breaks on top-to-top deltas, so a break can only move if a line top moved. This finds
// the FIRST line whose top diverges and names the block it is in — a query from outside the model.
import { chromium } from '@playwright/test'
import { buildTypeDoc } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const KIND = process.env.KIND || 'bulletList'
const WORDS = Number(process.env.WORDS || 6000)

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = buildTypeDoc({ types: KIND === 'none' ? [] : [KIND], words: WORDS, id: KIND })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction((w) => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, Math.min(2000, WORDS * 0.4), { timeout: 60000 })
  await page.waitForTimeout(5000)

  const r = await page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    const { model } = p.build()

    const killer = document.createElement('style')
    killer.textContent = '.inkwave-page-gap{display:none !important}'
    document.head.appendChild(killer)
    const pm = document.querySelector('.ProseMirror')
    void pm.getBoundingClientRect().height

    // Every text-rect top in document order — the same signal collectLines reads.
    const domTops = []
    const rng = document.createRange()
    const walk = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walk.nextNode())) {
      if (n.parentElement.closest('.inkwave-page-gap')) continue
      rng.selectNodeContents(n)
      for (const rect of rng.getClientRects()) {
        if (rect.width === 0 && rect.height === 0) continue
        if (!domTops.some((t) => Math.abs(t - rect.top) <= 3)) domTops.push(rect.top)
      }
    }
    domTops.sort((a, c) => a - c)
    killer.remove()

    const mineTops = model.lines.map((l) => l.top)
    const rows = []
    let firstBad = -1
    const N = Math.min(domTops.length, mineTops.length)
    for (let i = 0; i < N; i++) {
      const d = +((mineTops[i] - mineTops[0]) - (domTops[i] - domTops[0])).toFixed(3)
      if (firstBad < 0 && Math.abs(d) > 0.5) firstBad = i
      if (firstBad >= 0 && i >= firstBad - 3 && i <= firstBad + 3) {
        const blk = model.blocks[model.lines[i].blockIdx]
        rows.push({ i, mineRel: +(mineTops[i] - mineTops[0]).toFixed(3), domRel: +(domTops[i] - domTops[0]).toFixed(3), d, block: `${blk.type}@${blk.start}` })
      }
    }
    return { domLines: domTops.length, mineLines: mineTops.length, firstBad, rows, totalDrift: N ? +((mineTops[N - 1] - mineTops[0]) - (domTops[N - 1] - domTops[0])).toFixed(3) : null }
  })
  console.log(`KIND=${KIND}  dom ${r.domLines} lines / model ${r.mineLines} lines · first top divergence at line ${r.firstBad} · total drift ${r.totalDrift}px`)
  console.table(r.rows)
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
