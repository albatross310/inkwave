// DIAGNOSTIC: WHERE does the first divergent break fall, and in what?
// Dumps the model's breaks against the live editor's, with the doc node each position lands in and
// the model's own line at that point — so a divergence can be attributed to a block, not guessed at.
import { chromium } from '@playwright/test'
import { buildTypeDoc } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const KIND = process.env.KIND || 'bulletList'
const WORDS = Number(process.env.WORDS || 13000)

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = buildTypeDoc({ types: [KIND], words: WORDS, id: KIND })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction((w) => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, Math.min(3000, WORDS * 0.4), { timeout: 60000 })
  await page.waitForTimeout(5000)

  const r = await page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    for (let i = 0; i < 3; i++) p.build()
    const { model } = p.build()
    const live = p.liveBreaks()
    const mine = model.breaks.map((x) => x.at)
    let div = -1
    for (let i = 0; i < Math.max(mine.length, live.length); i++) if (mine[i] !== live[i]) { div = i; break }
    // Which top-level block holds a doc position, per the MODEL's own block list.
    const blockAt = (pos) => {
      const b = model.blocks.find((x) => pos >= x.start && pos < x.end)
      return b ? `${b.type}@${b.start}(h${b.height.toFixed(1)})` : '(none)'
    }
    const rows = []
    for (let i = Math.max(0, div - 2); i < Math.min(Math.max(mine.length, live.length), div + 4); i++) {
      rows.push({ i, mine: mine[i] ?? null, live: live[i] ?? null, d: (mine[i] ?? 0) - (live[i] ?? 0), mineIn: mine[i] != null ? blockAt(mine[i]) : '', liveIn: live[i] != null ? blockAt(live[i]) : '' })
    }
    // The model's per-page botMargin at the divergence — how much slack it thought was left.
    const bm = model.breaks.slice(Math.max(0, div - 2), div + 3).map((x) => +x.botMargin.toFixed(2))
    // Which MODEL LINE does each side's break position name? If both name the same line top, the
    // geometry agreed and the POSITION is wrong; if they name different tops, the break DECISION is.
    const lineOf = (pos) => { const k = model.lines.findIndex((l) => l.pos === pos); return k < 0 ? null : { k, top: +model.lines[k].top.toFixed(3), pos: model.lines[k].pos, startChar: model.lines[k].startChar, blockIdx: model.lines[k].blockIdx, text: model.lines[k].segs.map((s) => s.text).join('').slice(0, 30) } }
    const mineLine = lineOf(mine[div]); const liveLine = lineOf(live[div])
    // The lines the model has inside the divergent block, so the pos ladder is visible.
    const blk = model.blocks.find((x) => (live[div] ?? 0) >= x.start && (live[div] ?? 0) < x.end)
    const bi = model.blocks.indexOf(blk)
    const inBlock = model.lines.map((l, k) => ({ k, l })).filter((x) => x.l.blockIdx === bi).map((x) => ({ k: x.k, top: +x.l.top.toFixed(2), pos: x.l.pos, sc: x.l.startChar, ec: x.l.endChar, text: x.l.segs.map((s) => s.text).join('').slice(0, 26) }))
    return { div, mineLen: mine.length, liveLen: live.length, rows, botMargins: bm, mineLine, liveLine, blockStart: blk && blk.start, inBlock,
      blocksBefore: model.blocks.filter((b) => b.start < (live[div] ?? 0)).reduce((a, b) => { a[b.type] = (a[b.type] || 0) + 1; return a }, {}) }
  })
  console.log(`KIND=${KIND} first divergence at break ${r.div} (mine ${r.mineLen} breaks / live ${r.liveLen})`)
  console.table(r.rows)
  console.log('model botMargins around it:', r.botMargins)
  console.log('block census before the divergent break:', JSON.stringify(r.blocksBefore))
  console.log('\nMODEL line named by MY break :', JSON.stringify(r.mineLine))
  console.log('MODEL line named by LIVE break:', JSON.stringify(r.liveLine))
  console.log(`\nthe model's lines inside block@${r.blockStart}:`)
  console.table(r.inBlock)
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
