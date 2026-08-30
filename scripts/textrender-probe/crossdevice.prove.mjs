// CANONICAL PAGINATION IS CROSS-DEVICE — the load-bearing invariant this fix must not break.
//
// Page breaks are measured in a FORCED canonical context (A4 box, desktop side margins, zoom 1,
// magnify 1, font 18px), so the same words must land on the same page on every device. The fix
// reads each inline atom's own bounding box inside that forced context; if it somehow read a
// RENDERED (phone-reflowed, ×1.25 font) box instead, phone breaks would drift from desktop breaks
// and Peter's pages would differ per device. On phone `canonicalIsLive()` is FALSE, so the measure
// really does force+restore — the exact path at risk. Desktop at defaults skips the force.
//
// The comparison is only meaningful if the two contexts are genuinely different, so the probe
// ASSERTS the phone context first (coarse pointer ⇒ phoneLike() true, DPR 3, narrow viewport).
// Fixtures are synthetic — Peter's thesis never enters the repo.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'

const BASE = await autoBase()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })

async function breaksOn(ctxOpts, label) {
  const ctx = await b.newContext(ctxOpts)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const env = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse) and (hover: none)').matches,
    dpr: window.devicePixelRatio,
    vw: window.innerWidth,
  }))
  const doc = buildCitationDoc({ words: 2200, id: 'xd-cites', cites: 29, headings: true, lists: true, refList: false })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 800, null, { timeout: 60000 })
  await page.waitForTimeout(7000)
  const a = await page.evaluate(() => window.__iwTextRenderProbe.midlineAudit())
  const r = { breaks: await page.evaluate(() => window.__iwTextRenderProbe.liveBreaks()), midline: a.midline, canonical: a.renderingIsCanonical, baseFont: a.baseFont }
  console.log(`  ${label.padEnd(28)} coarse=${env.coarse} dpr=${env.dpr} vw=${env.vw} breaks=${r.breaks.length} base=${r.baseFont}px canonicalRendering=${r.canonical}`)
  await ctx.close()
  return { ...r, env }
}

const desktop = await breaksOn({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 2 }, 'desktop 1600w dpr2')
const phone = await breaksOn(
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  'phone 390w dpr3 touch',
)

let fail = 0
// The contexts must actually DIFFER, or "identical breaks" is a tautology.
if (!phone.env.coarse) { console.log('\nINCONCLUSIVE ⚠ — phone context did not register as coarse-pointer; phoneLike() never engaged.'); fail++ }
if (desktop.env.coarse) { console.log('\nINCONCLUSIVE ⚠ — desktop context registered as coarse-pointer.'); fail++ }
if (!desktop.breaks.length) { console.log('\nINCONCLUSIVE ⚠ — no breaks measured.'); fail++ }

const same = desktop.breaks.length === phone.breaks.length && desktop.breaks.every((v, i) => v === phone.breaks[i])
console.log(`\ndesktop: ${desktop.breaks.join(', ')}`)
console.log(`phone  : ${phone.breaks.join(', ')}`)
if (!same) { console.log('\nCROSS-DEVICE DRIFT ✗ — canonical pagination is BROKEN: pages differ per device.'); fail++ }
else console.log('\nCROSS-DEVICE IDENTICAL ✓ — same words on the same page on both.')
// The mid-line verdict counts ONLY where the RENDERING is canonical. The phone renders at 22.5px in
// a ~350px column — a different reflow — so canonical break positions are not expected to coincide
// with the phone's own line starts. That is canonical pagination working (identical breaks above),
// not a defect, and counting it would be measuring the question rather than the code.
if (!desktop.canonical) { console.log('\nINCONCLUSIVE ⚠ — desktop rendering was not canonical; the mid-line verdict cannot be read.'); fail++ }
else if (desktop.midline) { console.log(`\nMID-LINE ✗ on the canonical rendering: ${desktop.midline}`); fail++ }
else console.log('\nMID-LINE CLEAN ✓ on the canonical rendering (desktop).')
console.log(`  phone: midline=${phone.midline} NOT APPLICABLE — rendering is non-canonical (base ${phone.baseFont}px vs 18px), so`)
console.log('         canonical breaks land wherever the phone\'s own ×1.25 reflow puts them, BY DESIGN.')

await b.close()
process.exit(fail ? 1 : 0)
