// WHAT DOES ONE ZOOM NOTCH ACTUALLY COST?
//
// Peter asked for the editor zoom to be "even better" and it has never been touched. CLAUDE.md
// records ~80ms per notch on a thesis-scale document, but that number predates the predictive step
// cache and the content-visibility live window — so it is archaeology, and the first job is to
// replace it with a measurement.
//
// It reports the phases separately, because "zoom is slow" is not actionable and "the anchor read
// forces a full-document layout" is. `zoom-commit` is the whole synchronous commit (perflog, in
// Scroll.tsx); the rest is read off the Long Animation Frame / long-task observers, so a cost that
// lands OUTSIDE the commit — a pagination re-measure, a paint — is still visible instead of being
// silently excluded by measuring only the thing we already suspect.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const WORDS = Number(process.env.WORDS || 13000)
const NOTCHES = Number(process.env.NOTCHES || 12)

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
try {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = buildCitationDoc({ words: WORDS, cites: 174, id: 'zoomcost', headings: true, lists: true, refList: false })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => document.querySelectorAll('.inkwave-page-gap').length > 5, null, { timeout: 90000 })
  await page.waitForTimeout(8000)   // let the first measures and the step-cache precompute settle

  const shape = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.ProseMirror > *').length,
    gaps: document.querySelectorAll('.inkwave-page-gap').length,
  }))
  console.log(`document: ${shape.blocks} top-level blocks, ${shape.gaps} page gaps`)

  // Arm the perflog and a long-task observer BEFORE any notch.
  await page.evaluate(() => {
    window.__iwPerf = []
    window.__zoomLong = []
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__zoomLong.push(Math.round(e.duration)) })
        .observe({ type: 'longtask', buffered: false })
    } catch { /* not supported */ }
  })

  // Ctrl+wheel over the PAGE — the font-reflow zoom, not the water magnify. Spaced like a real
  // wheel, so each notch is measured on its own rather than coalesced into one reflow.
  const box = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror[contenteditable="true"]')
    const r = pm.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 200) }
  })
  // ⚠ DISPATCH THE WHEEL OURSELVES. `page.mouse.wheel` does not carry the Control modifier from
  // `keyboard.down('Control')`, so twelve notches produced twelve ORDINARY scrolls and the zoom
  // never moved — the probe's own VOID gate caught that, which is why it is there. The handler
  // reads `ctrlKey` and calls preventDefault; it does not consult isTrusted, so a constructed event
  // exercises exactly the same path (the same technique the pinch-arming probe uses).
  await page.mouse.move(box.x, box.y)
  for (let i = 0; i < NOTCHES; i++) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('.inkwave-editor-surface')
        ?? document.querySelector('.inkwave-editor-surface')
      el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX: x, clientY: y }))
    }, box)
    await page.waitForTimeout(260)
  }
  await page.waitForTimeout(3000)

  // HITS vs MISSES decides what the 68ms actually IS. A miss measures the bands live and
  // synchronously; a hit is style writes. Assuming which one is happening is how you optimise the
  // wrong half.
  const cache = await page.evaluate(() => window.__iwStepCache || null)
  const perf = await page.evaluate(() => (window.__iwPerf || []).filter((e) => Array.isArray(e)))
  const long = await page.evaluate(() => window.__zoomLong || [])
  // The var lives on the SURFACE, not on documentElement (Scroll.tsx writes
  // `el.style.setProperty('--iw-editor-zoom', …)`). Reading the root reports 1 forever, which is a
  // probe that cannot see its own subject — exactly what the VOID gate is for.
  const zoomNow = await page.evaluate(() => {
    const el = document.querySelector('.inkwave-editor-surface')
    return Number(el && getComputedStyle(el).getPropertyValue('--iw-editor-zoom')) || 1
  })

  const by = {}
  for (const [label, ms] of perf) { (by[label] ||= []).push(ms) }
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(1), max: +s[s.length - 1].toFixed(1) } }
  console.log(`\nzoom now = ${zoomNow} after ${NOTCHES} notches`)
  console.log(`  step cache: ${cache ? `${cache.hits} hits, ${cache.misses} misses, ${cache.precomputed} precomputed` : 'not exposed'}`)
  for (const [label, a] of Object.entries(by).sort()) {
    if (!/zoom|page-measure|pag/i.test(label)) continue
    const s = stat(a)
    console.log(`  ${label.padEnd(24)} n=${String(s.n).padStart(3)}  p50 ${String(s.p50).padStart(7)}ms  max ${String(s.max).padStart(7)}ms`)
  }
  if (long.length) {
    const s = stat(long)
    console.log(`  ${'longtasks (>50ms)'.padEnd(24)} n=${String(s.n).padStart(3)}  p50 ${String(s.p50).padStart(7)}ms  max ${String(s.max).padStart(7)}ms`)
  } else console.log('  longtasks (>50ms)        none observed')

  // VOID rather than report a fiction: if the zoom did not move, nothing was measured.
  if (Math.abs(zoomNow - 1) < 0.001) { console.log('\nVOID — the zoom never changed; no notch was applied.'); process.exitCode = 1 }
  else if (!by['zoom-commit']) { console.log('\nVOID — no zoom-commit timings were recorded.'); process.exitCode = 1 }
} finally { await b.close(); await stop() }
