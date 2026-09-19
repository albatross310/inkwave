// WHY DOES `readBands()` COST ~70ms DURING A ZOOM GESTURE AND ~0.2ms AT REST?
//
// A hand-run diagnostic, not a gate — but it is the instrument that killed two plausible wrong
// theories about the editor zoom, and it is kept because both would otherwise be re-derived:
//   (1) "the band rect un-skips a content-visibility subtree, so read the gap instead"
//   (2) "…so exempt the gap widgets from the live window"
// Neither is right. Run this and read the `bands-again` column: the IDENTICAL loop repeated
// immediately after itself costs 0.2ms. So the ~70ms is ONE forced layout that the commit's anchor
// read did not cover — not 55 per-element unlocks — and no cheaper read exists. The only lever is
// WHEN the measure happens, which is what `zoomWarm.ts` / the between-notch warm does.
//
// ⚠ ORDER MATTERS INSIDE EACH ROW and the row is designed around it: whichever loop runs FIRST after
// a style change pays the forced layout, so the `gaps` column reading ~0.1ms is not evidence that
// gaps are cheaper than bands — it is evidence that `bands` already paid.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
try {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'bandcost', headings: true, lists: true, refList: false })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => document.querySelectorAll('.inkwave-page-gap').length > 5, null, { timeout: 90000 })
  await page.waitForTimeout(8000)

  const out = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror[contenteditable="true"]')
    const surf = pm.closest('.inkwave-editor-surface')
    const bands = Array.from(document.querySelectorAll('.inkwave-page-gap-band'))
    const gaps = Array.from(document.querySelectorAll('.inkwave-page-gap'))
    const timeLoop = (els) => {
      const t = performance.now()
      let acc = 0
      for (const e of els) acc += e.getBoundingClientRect().top
      return +(performance.now() - t).toFixed(2) + (acc && 0)
    }
    const rows = []
    const run = (label) => {
      document.body.getBoundingClientRect()
      rows.push({ label, bands: timeLoop(bands), gaps: timeLoop(gaps), again: timeLoop(bands), n: bands.length })
    }
    run('at rest (no live window)')
    pm.classList.add('iw-zoom-live')
    surf.style.setProperty('--iw-cis', '300px')
    run('.iw-zoom-live just applied (layout dirty)')
    run('.iw-zoom-live, nothing changed since')
    pm.classList.remove('iw-zoom-live')
    surf.style.removeProperty('--iw-cis')
    run('at rest (repeat)')
    return rows
  })
  console.log('\n55-gap document — ms for one pass of getBoundingClientRect over every element\n')
  for (const r of out) console.log(`  ${r.label.padEnd(44)} bands ${String(r.bands).padStart(7)}  gaps ${String(r.gaps).padStart(7)}  bands-again ${String(r.again).padStart(7)}   (n=${r.n})`)
  console.log('\nREAD: a large `bands` beside a ~0 `bands-again` means one FORCED LAYOUT, not per-element cost.')
} finally { await b.close(); await stop() }
