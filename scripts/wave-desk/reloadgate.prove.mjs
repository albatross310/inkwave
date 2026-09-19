// Same-tab reload audit for the atomic CSS-water gate. Numbers only: no screenshots/screencast.
// A fresh context per load cannot see cache, storage, or play-pending state retained by the tab,
// so this deliberately navigates once and then reloads that exact page repeatedly.
import { chromium, webkit } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const LOADS = Number(process.env.LOADS || 5)
const WAIT_REVEAL = process.env.WAIT_REVEAL === '1'
const BLANK = process.env.PROBE_BLANK === '1'
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
  w.__iwReloadGateAudit = { events: [], samples: [], preGate: [] }
  // Wave animations exist pre-gate but stay paint-hidden and paused. They may become visible only
  // after the chosen tip + complete twinkle scene are ready. Sample clocks directly; no screenshot.
  const samplePreGate = () => {
    const surface = document.querySelector('.inkwave-editor-surface.iw-wave-anim')
    const drifts = surface ? surface.getAnimations({ subtree: true }).filter((animation) => {
      const name = animation.animationName || ''
      const target = animation.effect?.target
      return (name === 'iw-wave-drift-l' || name === 'iw-wave-drift-r')
        && !(target instanceof Element && target.matches('.iw-twk-field'))
    }) : []
    if (surface) {
      const before = getComputedStyle(surface, '::before')
      const after = getComputedStyle(surface, '::after')
      w.__iwReloadGateAudit.preGate.push({
        t: performance.now() - t0,
        ready: Boolean(w.__iwWaterReady),
        current: drifts.map((animation) => Number(animation.currentTime) || 0),
        running: drifts.length > 0 && drifts.every((animation) => animation.playState === 'running'),
        hidden: before.visibility === 'hidden' && after.visibility === 'hidden',
        paused: before.animationPlayState === 'paused' && after.animationPlayState === 'paused',
        white: getComputedStyle(surface).backgroundColor === 'rgb(255, 255, 255)'
          && getComputedStyle(surface).backgroundImage === 'none',
      })
    }
    if (!w.__iwWaterReady) requestAnimationFrame(samplePreGate)
  }
  requestAnimationFrame(samplePreGate)
  for (const name of [
    'loading-tip-ready', 'twinkles-ready', 'water-ready', 'reveal-imminent', 'editor-load-ready',
    'load-awaiting-continue', 'continue-load', 'wave-rest', 'editor-revealed',
  ]) {
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
        const allAnimations = surface.getAnimations({ subtree: true })
        const tileDrifts = Object.fromEntries(['l', 'r'].map((direction) => {
          const name = `iw-wave-drift-${direction}`
          const animation = allAnimations.find((a) => {
            const target = a.effect?.target
            return a.animationName === name
              && !(target instanceof Element && target.matches('.iw-twk-field'))
          })
          return [direction, animation]
        }))
        const fields = [...surface.querySelectorAll('.iw-twk-field')].flatMap((el) => {
          const direction = el.classList.contains('iw-twk-fa') ? 'l' : 'r'
          const animation = el.getAnimations().find((a) => a.animationName === `iw-wave-drift-${direction}`)
          return animation ? [{ direction, animation }] : []
        })
        const marks = [...surface.querySelectorAll('.iw-scene-mark')]
        const phase = (a, b) => {
          const d = ((a - b) % 1944 + 1944) % 1944
          return Math.min(d, 1944 - d)
        }
        const skew = fields.flatMap(({ direction, animation }) => {
          const wave = tileDrifts[direction]
          return typeof animation.startTime === 'number' && typeof wave?.startTime === 'number'
            ? [phase(animation.startTime, wave.startTime)]
            : []
        })
        records.push({
          covered: surface.classList.contains('iw-wave-covered'),
          mode: surface.classList.contains('iw-wave-coast') ? 'coast' : 'anim',
          gradient: getComputedStyle(surface).backgroundImage !== 'none',
          waves: allAnimations.filter((a) => {
            const target = a.effect?.target
            return /^iw-wave-drift-[lr]$/.test(a.animationName || '')
              && !(target instanceof Element && target.matches('.iw-twk-field'))
          }).length,
          fields: fields.length,
          marks: marks.length,
          maxSkewMs: skew.length ? Math.max(...skew) : null,
          clocks: {
            waves: Object.fromEntries(Object.entries(tileDrifts).map(([k, a]) => [k, a?.startTime ?? null])),
            fields: Object.fromEntries(fields.map(({ direction, animation }) => [direction, animation.startTime ?? null])),
          },
          twinklesVisible: marks.some((el) => {
            const cs = getComputedStyle(el)
            return cs.display !== 'none' && cs.visibility === 'visible' && Number(cs.opacity) > 0
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
  if (load === 1) await page.goto(BASE + (BLANK ? '/?blank=1' : '/'), { waitUntil: 'domcontentloaded' })
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
  if (WAIT_REVEAL) {
    await page.waitForFunction(() => window.__iwReloadGateAudit?.events
      ?.some((event) => event.name === 'editor-revealed'), null, { timeout: 20_000 })
  }
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => ({ gate: window.__iwWaterGate, audit: window.__iwReloadGateAudit }))
  const event = Object.fromEntries(result.audit.events.map((e) => [e.name, e.t]))
  const first = result.audit.samples.find((s) => s.records.some((r) => !r.covered && r.waves >= 2 && r.fields === 2 && r.marks === 192))
  const records = (first?.records ?? []).filter((r) => !r.covered)
  const worstMs = Math.max(0, ...result.audit.samples.flatMap((s) => s.records)
    .filter((r) => !r.covered)
    .map((r) => r.maxSkewMs ?? 0))
  const atomic = result.gate.reason === 'complete'
    && event['loading-tip-ready'] <= event['water-ready']
    && event['twinkles-ready'] <= event['water-ready']
    && records.length > 0
    && records.every((r) => r.gradient && r.twinklesVisible && r.waves >= 2 && r.fields === 2 && r.marks === 192)
  const aligned = worstMs <= 1
  const beforeGate = result.audit.preGate.filter((sample) => !sample.ready)
  const heldBeforeGate = beforeGate.length >= 1
    && beforeGate.every((sample) => sample.hidden && sample.paused
      && sample.white && !sample.running && sample.current.every((time) => time === 0))
  console.log(`load ${load} ${load === 1 ? 'navigate' : 'reload'}: gate=${result.gate.reason}`
    + ` tip=${Math.round(event['loading-tip-ready'] ?? -1)}ms twinkles=${Math.round(event['twinkles-ready'] ?? -1)}ms`
    + ` water=${Math.round(event['water-ready'] ?? -1)}ms`
    + (WAIT_REVEAL
      ? ` ready=${Math.round(event['editor-load-ready'] ?? -1)}ms continue=${Math.round(event['continue-load'] ?? -1)}ms`
        + ` rest=${Math.round(event['wave-rest'] ?? -1)}ms revealed=${Math.round(event['editor-revealed'] ?? -1)}ms`
      : '')
    + ` firstCompleteFrame=${first?.frame ?? 'none'} fields=${records.reduce((n, r) => n + r.fields, 0)}`
    + ` preGateWhiteHiddenPause=${heldBeforeGate ? 'yes' : 'NO'}`
    + ` worstSkew=${(worstMs * 140 / 1944).toFixed(2)}px`
    + ` ${atomic && aligned && heldBeforeGate ? '✓' : '✗'}`)
  if (!aligned) {
    const worst = result.audit.samples.flatMap((sample) => sample.records
      .filter((record) => !record.covered)
      .map((record) => ({ frame: sample.frame, record })))
      .sort((a, b) => (b.record.maxSkewMs ?? 0) - (a.record.maxSkewMs ?? 0))[0]
    console.log('  worst clocks:', worst)
  }
  if (!heldBeforeGate) console.log('  pre-gate samples:', {
    first: beforeGate.slice(0, 2),
    last: beforeGate.slice(-2),
  })
  if (!atomic || !aligned || !heldBeforeGate) failed = true
}

await browser.close()
process.exit(failed ? 1 : 0)
