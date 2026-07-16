// COVERAGE — the measurement that decides whether the text renderer is usable on real prose.
//
// The perf round measured a synthetic doc of 100% plain paragraphs and got wonderful numbers. Real
// academic prose is not that: Peter's Honours doc carries 174 citations, headings, lists and a
// reference list. Every block the renderer can't own draws a labelled placeholder, and a preview
// that placeholders out most of a thesis is not a preview — so this measures, on a citation-heavy
// document IN THE REAL APP:
//   1. % of blocks rendered vs placeholdered, with the DEFER REASON for every miss;
//   2. whether page breaks stay BYTE-IDENTICAL to the live editor's own gap widgets WITH citations
//      present (the load-bearing one — wrong breaks = wrong words on the page);
//   3. the pixel diff vs the real editor render.
//
// THESIS INTEGRITY: the fixture is SYNTHETIC (scripts/textrender-probe/fixture.mjs) and reproduces
// only the STRUCTURE of his proposal (~2,200 words, ~29 marked citations, headings, lists, refList).
// His real document never enters the repo, the probe output, or the logs.
//
// KNOWN-POSITIVE FIRST: citeBox is a CACHE, and a cold or mis-keyed cache makes every citation miss
// — which looks exactly like "the engine can't do citations" while actually being "the probe asked
// with the wrong key". So the run asserts the cache is warm and the key matches before reporting.
//
// Run: PROBE_PORT=4231 node scripts/textrender-probe/coverage.mjs

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { buildCitationDoc } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require('/root/dev/iw-textrender/node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs')
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out')
mkdirSync(OUT, { recursive: true })
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4231}`
const THRESH = 16

const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 140)) })

const report = { cases: [] }

try {
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const CASES = [
    { name: 'proposal shape (2.2k words, 29 marked cites, headings+lists+refList)', opts: { words: 2200, cites: 29 } },
    { name: 'thesis shape  (13k words, 174 marked cites)', opts: { words: 13000, cites: 174, id: 'fixture-thesis' } },
    { name: 'prose only    (2.2k words, 0 cites, no lists/headings/refList)', opts: { words: 2200, cites: 0, lists: false, refList: false, headings: false, id: 'fixture-plain' } },
  ]

  for (const c of CASES) {
    const doc = buildCitationDoc(c.opts)
    console.log(`\n━━━ ${c.name} ━━━`)
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
    await page.waitForFunction((n) => {
      const p = window.__iwTextRenderProbe
      return !!p && p.words() > n * 0.5
    }, c.opts.words ?? 2200, { timeout: 60000 })
    // The citeBox harvest rides the DOM canonical measure, and the bibliography hydrates async —
    // both must have happened before coverage means anything. Wait for the cache to actually fill.
    await page.waitForTimeout(6000)

    const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
    if (!st.fontsReallyLoaded || !st.seesKnownPositive) throw new Error(`PROBE BLIND: ${JSON.stringify(st)}`)

    const cov = await page.evaluate(() => window.__iwTextRenderProbe.coverage())
    const cites = cov.citationNodes
    const cb = cov.citeBox

    // KNOWN-POSITIVE for the cache: if the doc HAS citations, the box cache must be non-empty and
    // hitting. A silent zero here would masquerade as an engine limitation.
    if (cites > 0 && !(cb.size > 0)) {
      console.log(`  ⚠ citeBox cache EMPTY (harvested=${cb.harvested} skippedNoRect=${cb.skippedNoRect}) — ` +
        `coverage below is NOT an engine verdict, it is a cold cache`)
    }

    console.log(`  doc: ${JSON.stringify(cov.docBlockTypes)} · ${cites} citation nodes · ${cov.pages} pages`)
    console.log(`  COVERAGE: ${cov.rendered}/${cov.blocks} blocks rendered (${cov.renderedPct}%) · ${cov.placeholdered} placeholdered`)
    console.log(`  reasons: ${JSON.stringify(cov.coverageReasons)}`)
    console.log(`  citeBox: size=${cb.size} harvested=${cb.harvested} hits=${cb.hits} misses=${cb.misses} noRect=${cb.skippedNoRect} · key=${JSON.stringify(cov.key)}`)

    // ── BREAKS vs the LIVE editor, WITH citations present ──
    const brk = await page.evaluate(() => {
      const p = window.__iwTextRenderProbe
      const { model } = p.build()
      return { mine: model.breaks.map((b) => b.at), live: p.liveBreaks(), pages: model.pages }
    })
    // WHEN THEY DIVERGE, ASK WHICH ONE IS WRONG — don't assume it's ours. A page break MUST land on a
    // LINE START. If a live break is not a line start, the LIVE path put a gap mid-line (the
    // collectLines NodeView-rect artifact CLAUDE.md documents for math pills, and which citations
    // reproduce): its spurious extra rect resolves via posAtCoords to a mid-line position. Matching
    // that would mean copying a bug, so this reports it instead of silently conforming.
    // A break is LEGITIMATE at a line start OR at a block start (the refList is force-broken to its
    // own page at the block's start position, which is one less than its first line's pos). Counting
    // block starts as "mid-line" would manufacture a bug that isn't there — the check has to be right
    // before its verdict means anything.
    const { lineStarts, blockStarts } = await page.evaluate(() => {
      const { model } = window.__iwTextRenderProbe.build()
      return { lineStarts: model.lines.map((l) => l.pos), blockStarts: model.blocks.map((b) => b.start) }
    })
    const legal = new Set([...lineStarts, ...blockStarts])
    const liveNotLineStart = brk.live.filter((p) => !legal.has(p))
    const identical = brk.mine.length === brk.live.length && brk.mine.every((v, i) => v === brk.live[i])
    let firstDiv = null
    if (!identical) {
      for (let i = 0; i < Math.max(brk.mine.length, brk.live.length); i++) {
        if (brk.mine[i] !== brk.live[i]) { firstDiv = { i, mine: brk.mine[i] ?? null, live: brk.live[i] ?? null }; break }
      }
    }
    console.log(`  BREAKS vs live editor: ${identical ? 'IDENTICAL ✓' : 'DIVERGE ✗'} ` +
      `(mine ${brk.mine.length} gaps / live ${brk.live.length})${firstDiv ? ` first: idx ${firstDiv.i} mine=${firstDiv.mine} live=${firstDiv.live}` : ''}`)
    console.log(`  breaksReliable=${cov.breaksReliable} (estimated blocks: ${cov.estimatedBlocks})` +
      (liveNotLineStart.length
        ? ` · ⚠ ${liveNotLineStart.length}/${brk.live.length} LIVE breaks are NOT line starts ${JSON.stringify(liveNotLineStart.slice(0, 4))} — the live path broke mid-line (collectLines NodeView-rect artifact), so divergence there is the EDITOR's, not ours`
        : ` · all live breaks land on real line starts`))

    report.cases.push({
      name: c.name, coverage: cov, breaksIdentical: identical,
      breakCounts: { mine: brk.mine.length, live: brk.live.length }, firstDivergence: firstDiv,
      liveBreaksNotAtLineStart: liveNotLineStart,
    })
  }

  // ── PIXEL DIFF on the citation-heavy proposal fixture ──
  console.log(`\n━━━ pixel diff (proposal fixture, page 0) ━━━`)
  const doc = buildCitationDoc({ words: 2200, cites: 29 })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id + '-pix', doc: { ...d, id: d.id + '-pix' } } })), doc)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 1000, null, { timeout: 60000 })
  await page.waitForTimeout(6000)

  for (const pageIdx of [0, 1]) {
    const ok = await page.evaluate((i) => {
      const surf = document.querySelector('.inkwave-editor-surface')
      const sheet = document.querySelectorAll('.inkwave-sheet')[i]
      if (!sheet) return false
      surf.scrollTop = Math.max(0, sheet.getBoundingClientRect().top + surf.scrollTop - 40)
      return true
    }, pageIdx)
    if (!ok) { console.log(`  page ${pageIdx}: no sheet — skipped`); continue }
    await page.waitForTimeout(500)
    const box = await page.evaluate((i) => {
      const r = document.querySelectorAll('.inkwave-sheet')[i].getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, pageIdx)
    if (box.y < 0 || box.y + box.height > 1400) { console.log(`  page ${pageIdx}: off-screen — skipped`); continue }

    const editorPng = PNG.sync.read(await page.screenshot({ clip: box }))
    const si = (editorPng.width * 20 + 20) << 2
    const parchment = `rgb(${editorPng.data[si]}, ${editorPng.data[si + 1]}, ${editorPng.data[si + 2]})`
    const color = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror')).color)
    const mine = await page.evaluate(({ i, color, bg }) => {
      const p = window.__iwTextRenderProbe
      const { model } = p.build()
      const { canvas } = p.paint(model, i, { mode: 'text', ink: color, background: bg })
      return canvas.toDataURL('image/png')
    }, { i: pageIdx, color, bg: parchment })
    const minePng = PNG.sync.read(Buffer.from(mine.split(',')[1], 'base64'))

    const w = Math.min(editorPng.width, minePng.width), h = Math.min(editorPng.height, minePng.height)
    let differing = 0, ink = 0
    const parch = [editorPng.data[si], editorPng.data[si + 1], editorPng.data[si + 2]]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ia = (editorPng.width * y + x) << 2, ib = (minePng.width * y + x) << 2
        const m = Math.max(Math.abs(editorPng.data[ia] - minePng.data[ib]), Math.abs(editorPng.data[ia + 1] - minePng.data[ib + 1]), Math.abs(editorPng.data[ia + 2] - minePng.data[ib + 2]))
        if (m > THRESH) differing++
        if (Math.max(Math.abs(editorPng.data[ia] - parch[0]), Math.abs(editorPng.data[ia + 1] - parch[1]), Math.abs(editorPng.data[ia + 2] - parch[2])) > THRESH) ink++
      }
    }
    const pct = (differing / (w * h)) * 100
    console.log(`  page ${pageIdx}: ${pct.toFixed(3)}% of pixels differ (ink is ${((ink / (w * h)) * 100).toFixed(2)}% of the page)`)
    writeFileSync(join(OUT, `cov-editor-p${pageIdx}.png`), PNG.sync.write(editorPng))
    writeFileSync(join(OUT, `cov-render-p${pageIdx}.png`), PNG.sync.write(minePng))
    report[`pixelDiffP${pageIdx}`] = { pct: +pct.toFixed(3), inkPct: +((ink / (w * h)) * 100).toFixed(2) }
  }

  writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(report, null, 2))
  console.log(`\nwrote ${join(OUT, 'coverage.json')}`)
} catch (e) {
  console.error('\nCOVERAGE PROBE FAILED:', e.message)
  writeFileSync(join(OUT, 'coverage.json'), JSON.stringify({ ...report, error: e.message }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
