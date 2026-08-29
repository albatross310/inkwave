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
//
// ── 2026-08-30: it is now an A/B, because the finding was inside `zoom-stepEvent`. ───────────────
// Attribution (`zoom-rbFirstRect` 0.0ms vs `zoom-rbBandLoop` ~78ms) put 98% of the step event in
// `readBands()` — i.e. the step cache's MISS path, on 11 of 12 notches. So the arms are the
// BETWEEN-NOTCH WARM of `liveCache` (PaginationExtension `scheduleLiveWarm`):
//   control  window.__iwLiveWarm = false  — every notch measures the bands on the input path
//   fixed    (default: the next step is measured in the idle gap between notches)
// A ratio is only readable if the control reproduces the cost, so the control is not decoration: if
// it does not come out dearer, or if the fixed arm does not actually convert misses into hits, the
// run VOIDS rather than reporting an improvement. Each arm gets its OWN page — `liveCache` survives
// a settled gesture, so a second gesture in one page would be scored against a warm cache.
//
// THE ARMS RUN ABBA, AND THAT IS NOT FUSS. Two earlier hypotheses were tested here in plain
// A-then-B order and BOTH reported the second arm 1.07-1.08x slower — the same ratio for two
// unrelated changes, which is the signature of arm ORDER (this box is shared and drifts across a
// run), not of either change. Running off/on/on/off and pooling each arm's two runs cancels a
// monotonic drift; without it this probe would happily have certified a fiction, twice.
//
// GEOMETRY IS CHECKED BEFORE ANY TIMING IS READ, and MID-GESTURE (the settle re-measures, so a
// post-settle sample agrees however wrong the mid-gesture panels were). Cheaper panel geometry that
// is DIFFERENT panel geometry is not an optimisation, it is a rendering bug that happens to be fast.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const WORDS = Number(process.env.WORDS || 13000)
const NOTCHES = Number(process.env.NOTCHES || 12)

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })

const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(1), max: +s[s.length - 1].toFixed(1) } }

/** One arm: a fresh page, the thesis-shaped document, NOTCHES of ctrl+wheel, the phase timings. */
async function runArm(rule) {
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

    // Arm the perflog and a long-task observer BEFORE any notch, and select the arm.
    await page.evaluate((r) => {
      if (r === 'off') window.__iwLiveWarm = false
      window.__iwPerf = []
      window.__zoomLong = []
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__zoomLong.push(Math.round(e.duration)) })
          .observe({ type: 'longtask', buffered: false })
      } catch { /* not supported */ }
    }, rule)

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
    // ⚠ THE PANEL SAMPLE IS TAKEN IN THE SAME TASK AS THE COMMIT IT IS ABOUT, and both halves of
    // that matter. Sample after the SETTLE and both arms are in the identical non-gesture regime,
    // so they agree however wrong the mid-gesture panels were. Sample merely "soon after" the last
    // notch and you are reading a moment that includes the between-notch warm and whatever the
    // browser did in between — the first cut did that, reported 55/56 panels differing by up to
    // 55,662px, and was flatly contradicted by an in-app audit showing every warmed entry equal to
    // a live measure to 0.0px. Reading the panels synchronously with the commit removes the window
    // in which anything else can happen.
    await page.mouse.move(box.x, box.y)
    let panelsLive = null
    for (let i = 0; i < NOTCHES; i++) {
      panelsLive = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)?.closest('.inkwave-editor-surface')
          ?? document.querySelector('.inkwave-editor-surface')
        el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX: x, clientY: y }))
        const layer = document.querySelector('.inkwave-sheet')?.parentElement
        if (!layer) return null
        return Array.from(layer.children).map((d) => [Math.round(parseFloat(d.style.top) || 0), Math.round(parseFloat(d.style.height) || 0)])
      }, box)
      await page.waitForTimeout(260)
    }
    await page.waitForTimeout(3000)

    // HITS vs MISSES decides what the step event actually IS. A miss measures the bands live and
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
    return { shape, panels: panelsLive, cache, by, long, zoomNow }
  } finally { await ctx.close() }
}

const mergeArm = (a, c) => {
  const by = {}
  for (const k of new Set([...Object.keys(a.by), ...Object.keys(c.by)])) by[k] = [...(a.by[k] ?? []), ...(c.by[k] ?? [])]
  return { ...a, by, runs: [a, c] }
}

try {
  // ABBA — see the header. Each arm's two runs are pooled, so a drift across the run averages out
  // instead of landing entirely on whichever arm went second.
  const seq = []
  for (const rule of ['off', 'on', 'on', 'off']) seq.push(await runArm(rule))
  const arms = { off: mergeArm(seq[0], seq[3]), on: mergeArm(seq[1], seq[2]) }

  const ref = arms.on
  console.log(`document: ${ref.shape.blocks} top-level blocks, ${ref.shape.gaps} page gaps`)
  const samePanels = JSON.stringify(arms.off.panels) === JSON.stringify(arms.on.panels)
  console.log(`panel geometry MID-GESTURE after ${NOTCHES} notches: ${arms.off.panels?.length} vs ${arms.on.panels?.length} panels, identical: ${samePanels}`)
  if (!samePanels && arms.off.panels && arms.on.panels) {
    // HOW WRONG, and WHERE — "different" is not a diagnosis. A pixel of rounding and a collapsed
    // gap are the same boolean and utterly different news.
    let worstTop = 0, worstH = 0, differing = 0, firstAt = -1
    const n = Math.min(arms.off.panels.length, arms.on.panels.length)
    for (let i = 0; i < n; i++) {
      const dT = Math.abs(arms.off.panels[i][0] - arms.on.panels[i][0])
      const dH = Math.abs(arms.off.panels[i][1] - arms.on.panels[i][1])
      if (dT || dH) { differing++; if (firstAt < 0) firstAt = i }
      worstTop = Math.max(worstTop, dT); worstH = Math.max(worstH, dH)
    }
    console.log(`  → ${differing}/${n} panels differ, worst Δtop ${worstTop}px, worst Δheight ${worstH}px, first at panel ${firstAt}`)
    console.log(`     control[${firstAt}] ${JSON.stringify(arms.off.panels[firstAt])}  warmed[${firstAt}] ${JSON.stringify(arms.on.panels[firstAt])}`)
    // Both runs of the SAME arm, to separate "the warm changed it" from "the gesture is not
    // deterministic on this box at all".
    console.log(`     control run-to-run identical: ${JSON.stringify(arms.off.runs[0].panels) === JSON.stringify(arms.off.runs[1].panels)}` +
      `  ·  warmed run-to-run identical: ${JSON.stringify(arms.on.runs[0].panels) === JSON.stringify(arms.on.runs[1].panels)}`)
  }

  for (const [rule, a] of Object.entries(arms)) {
    console.log(`\n── ${rule === 'off' ? 'CONTROL  __iwLiveWarm=false (every notch measures on the input path)' : 'FIXED    the next step is warmed between notches'} ── (2 runs pooled)`)
    console.log(`  zoom now = ${a.zoomNow} after ${NOTCHES} notches`)
    for (const r of a.runs) console.log(`  step cache: ${r.cache ? `${r.cache.hits} hits, ${r.cache.misses} misses, ${r.cache.warmed} warmed between notches, ${r.cache.precomputed} idle-precomputed` : 'not exposed'}`)
    for (const [label, arr] of Object.entries(a.by).sort()) {
      if (!/zoom|page-measure|pag/i.test(label)) continue
      const s = stat(arr)
      console.log(`  ${label.padEnd(24)} n=${String(s.n).padStart(3)}  p50 ${String(s.p50).padStart(7)}ms  max ${String(s.max).padStart(7)}ms`)
    }
    if (a.long.length) { const s = stat(a.long); console.log(`  ${'longtasks (>50ms)'.padEnd(24)} n=${String(s.n).padStart(3)}  p50 ${String(s.p50).padStart(7)}ms  max ${String(s.max).padStart(7)}ms`) }
    else console.log('  longtasks (>50ms)        none observed')
  }

  // ── VERDICT ───────────────────────────────────────────────────────────────────────────────────
  const p50 = (a, l) => (a.by[l] ? stat(a.by[l]).p50 : null)
  const rows = ['zoom-commit', 'zoom-stepEvent', 'zoom-readBands', 'zoom-rbBandLoop', 'zoom-reflow', 'zoom-liveWarm']
  console.log('\n── RATIO (measured WITHIN this run; this box is CPU-contended, so absolutes do not travel) ──')
  for (const l of rows) {
    const c = p50(arms.off, l), f = p50(arms.on, l)
    if (c == null || f == null) continue
    console.log(`  ${l.padEnd(20)} control ${String(c).padStart(7)}ms → fixed ${String(f).padStart(7)}ms   ${(f / c).toFixed(2)}×`)
  }

  let bad = false
  const fail = (m) => { console.log(`\n✗ ${m}`); bad = true }
  if (Math.abs(ref.zoomNow - 1) < 0.001) fail('VOID — the zoom never changed; no notch was applied.')
  if (!ref.by['zoom-commit']) fail('VOID — no zoom-commit timings were recorded.')
  if (!ref.panels || ref.panels.length < 5) fail('VOID — no sheet panels were read; the two arms were never compared.')
  else if (!samePanels) fail('the warmed arm paints DIFFERENT panel geometry — not an optimisation, a rendering change.')
  // THE MECHANISM, not just the clock: the warm has to turn misses into hits. A commit that got
  // faster while the miss count held would be measuring something else (this box, most likely).
  const sum = (a, k) => a.runs.reduce((n, r) => n + (r.cache?.[k] ?? 0), 0)
  console.log(`\n  misses ${sum(arms.off, 'misses')} → ${sum(arms.on, 'misses')}   hits ${sum(arms.off, 'hits')} → ${sum(arms.on, 'hits')}   warmed between notches ${sum(arms.off, 'warmed')} → ${sum(arms.on, 'warmed')}`)
  if (sum(arms.off, 'warmed') !== 0) fail(`the CONTROL warmed ${sum(arms.off, 'warmed')} steps — __iwLiveWarm=false did not disable the feature, so the arms are not different.`)
  if (sum(arms.off, 'misses') < NOTCHES) fail(`VOID — the control missed only ${sum(arms.off, 'misses')} notches over 2 runs of ${NOTCHES}, so it did not reproduce the cost this change removes.`)
  if (sum(arms.on, 'misses') >= sum(arms.off, 'misses')) fail(`the warm converted no miss into a hit (${sum(arms.off, 'misses')} → ${sum(arms.on, 'misses')}); the clock is measuring something else.`)
  const cC = p50(arms.off, 'zoom-commit'), fC = p50(arms.on, 'zoom-commit')
  if (cC == null || fC == null) fail('VOID — no commit timings in one of the arms.')
  else if (fC >= cC * 0.85) fail(`the warm does not make a notch materially cheaper (${cC} → ${fC}ms).`)
  if (!bad) console.log('\n✓ the panels are identical, the control reproduces the misses, and the warm converts them into hits at a cheaper commit.')
  process.exitCode = bad ? 1 : 0
} finally { await b.close(); await stop() }
