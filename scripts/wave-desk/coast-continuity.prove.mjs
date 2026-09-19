// Loading-wave coast boundary proof. Samples the rendered transform every frame; a left-moving
// wave may slow toward zero but must never present a positive (backwards) step when coast begins.
// Numbers only—no screenshots.
import { chromium, webkit } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const browserType = ({ chromium, webkit })[ENGINE]
if (!browserType) throw new Error(`unknown PROBE_ENGINE=${ENGINE}; expected chromium or webkit`)

let browser = null
const inconclusive = async (reason) => {
  console.log(`INCONCLUSIVE: ${reason}`)
  await browser?.close().catch(() => {})
  process.exit(2)
}

let BASE
try {
  BASE = await autoWaveBase(null)
  browser = await browserType.launch({ headless: true })
} catch (error) {
  await inconclusive(`could not start the ${ENGINE} production-browser premise: ${error.message}`)
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(() => {
  const started = performance.now()
  const trace = window.__iwCoastTrace = { imminent: null, revealed: null, rest: null, samples: [] }
  const ids = new WeakMap()
  let nextId = 1
  const xOf = (surface) => {
    const value = getComputedStyle(surface, '::before').transform
    if (!value || value === 'none') return null
    try { return new DOMMatrixReadOnly(value).m41 } catch { return null }
  }
  window.addEventListener('inkwave:reveal-imminent', () => { trace.imminent = performance.now() - started })
  window.addEventListener('inkwave:editor-revealed', () => { trace.revealed = performance.now() - started })
  window.addEventListener('inkwave:wave-rest', () => { trace.rest = performance.now() - started })
  const sample = () => {
    const t = performance.now() - started
    for (const surface of document.querySelectorAll('.inkwave-editor-surface.iw-fill')) {
      const x = xOf(surface)
      if (x == null) continue
      if (!ids.has(surface)) ids.set(surface, nextId++)
      trace.samples.push({
        id: ids.get(surface),
        t,
        x,
        coast: surface.classList.contains('iw-wave-coast'),
        covered: surface.classList.contains('iw-wave-covered'),
      })
    }
    if (trace.rest == null || t < trace.rest + 100) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
})

const page = await context.newPage()
try {
  const response = await page.goto(`${BASE}/?blank=1`, { waitUntil: 'domcontentloaded' })
  if (!response?.ok()) await inconclusive(`the production route returned ${response?.status() ?? 'no response'}`)
  await page.waitForFunction(() => window.__iwCoastTrace?.rest != null, null, { timeout: 15_000 })
} catch (error) {
  await inconclusive(`the loading-wave coast did not become observable: ${error.message}`)
}
await page.waitForTimeout(120)
const trace = await page.evaluate(() => window.__iwCoastTrace)
if (trace.imminent == null || trace.revealed == null || trace.rest == null || trace.samples.length === 0) {
  await inconclusive('the loading-wave timing events or rendered transform samples were absent')
}

const wrapDelta = (next, previous) => {
  const raw = next - previous
  return ((raw + 70) % 140 + 140) % 140 - 70
}
const byId = new Map()
for (const sample of trace.samples) {
  const list = byId.get(sample.id) || []
  list.push(sample)
  byId.set(sample.id, list)
}
let worstBackwards = 0
let boundarySamples = 0
for (const samples of byId.values()) {
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]
    const after = samples[index]
    if (!after.coast || after.t < trace.imminent - 40 || after.t > trace.imminent + 450) continue
    const delta = wrapDelta(after.x, before.x)
    worstBackwards = Math.max(worstBackwards, delta)
    boundarySamples++
  }
}

if (boundarySamples < 5) {
  await inconclusive(`only ${boundarySamples} coast-boundary samples were observable; need at least 5`)
}
const passed = worstBackwards <= 0.25
const revealBeat = trace.revealed - trace.imminent
const revealWaitedForCoast = revealBeat >= 400
console.log(`── ${ENGINE} loading-wave coast continuity ──`)
console.log(`reveal-imminent             : ${Math.round(trace.imminent)}ms`)
console.log(`editor-revealed             : ${Math.round(trace.revealed)}ms (${Math.round(revealBeat)}ms into coast) ${revealWaitedForCoast ? '✓' : '✗'}`)
console.log(`wave-rest                   : ${Math.round(trace.rest)}ms`)
console.log(`boundary samples            : ${boundarySamples}`)
console.log(`largest backwards step      : ${worstBackwards.toFixed(3)}px ${passed ? '✓' : '✗'}`)

await browser.close()
process.exit(passed && revealWaitedForCoast ? 0 : 1)
