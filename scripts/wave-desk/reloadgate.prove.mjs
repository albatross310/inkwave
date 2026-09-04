// Same-tab reload audit for the atomic CSS-water gate. Numbers only: no screenshots/screencast.
// A fresh context per load cannot see cache, storage, or play-pending state retained by the tab,
// so this deliberately navigates once and then reloads that exact page repeatedly.
import { chromium, webkit } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const LOADS = Number(process.env.LOADS || 5)
const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const browserType = ({ chromium, webkit })[ENGINE]
if (!browserType) throw new Error(`unknown PROBE_ENGINE=${ENGINE}; expected chromium or webkit`)
const BASE = await autoWaveBase(null)
let browser
try {
  browser = await browserType.launch({ headless: true })
} catch (error) {
  console.error(`INCONCLUSIVE: ${ENGINE} could not launch, so reload atomicity was not observed.`, error)
  process.exit(2)
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

await context.addInitScript(() => {
  const w = window
  const t0 = performance.now()
  w.__iwReloadGateAudit = { events: [], samples: [] }
  for (const name of ['twinkles-ready', 'water-ready', 'reveal-imminent', 'wave-rest']) {
    window.addEventListener(`inkwave:${name}`, () => {
      w.__iwReloadGateAudit.events.push({ name, t: performance.now() - t0 })
    })
  }
  window.addEventListener('inkwave:water-ready', () => {
    let frames = 0
    const sample = () => {
      const surfaces = [...document.querySelectorAll('.inkwave-editor-surface.iw-wave-anim')]
      const records = []
      for (const surface of surfaces) {
        const drift = surface.getAnimations({ subtree: true })
          .find((a) => a.animationName === 'iw-wave-drift-l' && !(a.effect?.target instanceof Element
            && a.effect.target.closest?.('.iw-wave-twinkles')))
        const wrappers = [...surface.querySelectorAll('.iw-twk-blink')]
        const fields = wrappers.flatMap((el) => el.getAnimations()
          .filter((a) => !a.animationName && (a.effect?.getKeyframes?.() || [])
            .some((f) => typeof f.transform === 'string')))
        const phase = (a, b) => {
          const d = ((a - b) % 1944 + 1944) % 1944
          return Math.min(d, 1944 - d)
        }
        const skew = typeof drift?.startTime === 'number'
          ? fields.filter((a) => typeof a.startTime === 'number').map((a) => phase(a.startTime, drift.startTime))
          : []
        records.push({
          covered: surface.classList.contains('iw-wave-covered'),
          gradient: getComputedStyle(surface).backgroundImage !== 'none',
          waves: surface.getAnimations({ subtree: true }).filter((a) => /^iw-wave-drift-[lr]$/.test(a.animationName || '')).length,
          fields: fields.length,
          maxSkewMs: skew.length ? Math.max(...skew) : null,
          twinklesVisible: wrappers.some((el) => {
            const cs = getComputedStyle(el)
            return cs.display !== 'none' && cs.visibility === 'visible'
          }),
        })
      }
      w.__iwReloadGateAudit.samples.push({ frame: frames, records })
      if (++frames < 12 && surfaces.length) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { once: true })
})

const page = await context.newPage()
let failed = false
for (let load = 1; load <= LOADS; load++) {
  if (load === 1) await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  else await page.reload({ waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction(() => window.__iwWaterGate && window.__iwReloadGateAudit?.samples?.length,
      null, { timeout: 35_000 })
  } catch (error) {
    // The verdict only means anything when the route rendered the editor surface the probe targets.
    // A moved route, dead dev server, or unsupported engine is INCONCLUSIVE, not a product failure.
    const premise = await page.evaluate(() => ({
      surface: Boolean(document.querySelector('.inkwave-editor-surface')),
      audit: Boolean(window.__iwReloadGateAudit),
    })).catch(() => ({ surface: false, audit: false }))
    if (!premise.surface || !premise.audit) {
      console.error(`INCONCLUSIVE: load ${load} did not render the instrumented editor surface.`, error)
      await browser.close()
      process.exit(2)
    }
    throw error
  }
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => ({ gate: window.__iwWaterGate, audit: window.__iwReloadGateAudit }))
  const event = Object.fromEntries(result.audit.events.map((e) => [e.name, e.t]))
  const first = result.audit.samples.find((s) => s.records.some((r) => !r.covered && r.waves >= 2 && r.fields > 0))
  const records = (first?.records ?? []).filter((r) => !r.covered)
  const worstMs = Math.max(0, ...result.audit.samples.flatMap((s) => s.records)
    .map((r) => r.maxSkewMs ?? 0))
  const atomic = result.gate.reason === 'complete'
    && event['twinkles-ready'] <= event['water-ready']
    && records.length > 0
    && records.every((r) => r.gradient && r.twinklesVisible && r.waves >= 2 && r.fields > 0)
  const aligned = worstMs <= 1
  console.log(`load ${load} ${load === 1 ? 'navigate' : 'reload'}: gate=${result.gate.reason}`
    + ` twinkles=${Math.round(event['twinkles-ready'] ?? -1)}ms water=${Math.round(event['water-ready'] ?? -1)}ms`
    + ` firstCompleteFrame=${first?.frame ?? 'none'} fields=${records.reduce((n, r) => n + r.fields, 0)}`
    + ` worstSkew=${(worstMs * 140 / 1944).toFixed(2)}px`
    + ` ${atomic && aligned ? '✓' : '✗'}`)
  if (!atomic || !aligned) failed = true
}

await browser.close()
process.exit(failed ? 1 : 0)
