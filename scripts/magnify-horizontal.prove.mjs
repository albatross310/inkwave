// Focused horizontal whole-page zoom proof. It records every animation frame so an exact endpoint
// cannot hide a delayed mid-gesture correction.

import { chromium, webkit } from '@playwright/test'
import { startProbeServer } from './textrender-probe/serve.mjs'

const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const browserType = ({ chromium, webkit })[ENGINE]
if (!browserType) throw new Error(`unknown PROBE_ENGINE=${ENGINE}; expected chromium or webkit`)

const { base, stop } = await startProbeServer()
let browser
try {
  browser = await browserType.launch({ headless: true })
} catch (error) {
  console.error(`INCONCLUSIVE: ${ENGINE} could not launch; horizontal motion was not observed.`, error)
  await stop()
  process.exit(2)
}
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
let failed = 0
let inconclusive = false
class Inconclusive extends Error {}
const check = (condition, label, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failed++
}

const read = () => page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface')
  const box = surface?.querySelector('.iw-magnify-box')
  if (!surface || !box) return null
  const rect = box.getBoundingClientRect()
  return {
    scale: Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) || 1,
    left: rect.left,
    width: rect.width,
    scrollLeft: surface.scrollLeft,
    clientWidth: surface.clientWidth, clientLeft: surface.clientLeft, scrollWidth: surface.scrollWidth,
    translate: box.style.translate,
  }
})

try {
  console.log(`── ${ENGINE} horizontal magnify dynamics ──`)
  await page.addInitScript(() => {
    localStorage.removeItem('inkwave:magnify-track-v2')
    localStorage.removeItem('inkwave:magnify')
  })
  await page.goto(`${base}/?new-window=1&blank=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() =>
    !!document.querySelector('.ProseMirror[contenteditable="true"]')
      && !document.querySelector('.iw-loading-tip'), null, { timeout: 60_000 })
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await editor.fill(Array.from({ length: 35 }, (_, index) =>
    `Horizontal zoom dynamics paragraph ${index + 1}. This creates enough paper to exercise the compositor while the page crosses both magnetic wells.`,
  ).join('\n\n'))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    return window.__iwPaginationReady && surface
      && !surface.classList.contains('iw-wave-anim') && !surface.classList.contains('iw-wave-coast')
  }, null, { timeout: 15000 })
  await page.waitForTimeout(500)

  const point = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface').getBoundingClientRect()
    const text = document.querySelector('.ProseMirror').getBoundingClientRect()
    return { x: text.left + text.width * 0.22, y: Math.max(surface.top + 120, text.top + 40) }
  })
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => document.querySelector('.inkwave-editor-surface')?.dispatchEvent(
    new PointerEvent('pointerenter'),
  ))
  const start = await read()
  if (!start) {
    throw new Inconclusive('the editor rendered no measurable magnify geometry')
  }
  const textClip = await page.evaluate(() => {
    for (const paragraph of document.querySelectorAll('.ProseMirror p')) {
      const rect = paragraph.getBoundingClientRect()
      if (rect.top < 30 || rect.bottom > innerHeight - 140 || rect.width < 100) continue
      return { x: Math.ceil(rect.left + 8), y: Math.ceil(rect.top),
        width: Math.floor(Math.min(400, rect.width - 16)), height: Math.floor(Math.min(80, rect.height)) }
    }
    return null
  })
  if (!textClip) throw new Inconclusive('no fully visible text crop was available for the Shift paint comparison')
  // Kept only in memory. No writer document or visual capture is written to the repo or chat.
  const restTextRaster = await page.screenshot({ clip: textClip, caret: 'hide' })
  const restTextControl = await page.screenshot({ clip: textClip, caret: 'hide' })
  if (!restTextRaster.equals(restTextControl)) throw new Inconclusive('the resting text crop changed without any key input')

  await page.evaluate(() => {
    const samples = []
    window.__iwHorizontalTrace = { active: true, samples, inputs: [] }
    const tick = () => {
      const trace = window.__iwHorizontalTrace
      if (!trace?.active) return
      const surface = document.querySelector('.inkwave-editor-surface')
      const box = surface?.querySelector('.iw-magnify-box')
      if (surface && box) {
        const rect = box.getBoundingClientRect()
        samples.push({
          t: performance.now(),
          scale: Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) || 1,
          left: rect.left,
          width: rect.width,
          scrollLeft: surface.scrollLeft,
        })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.keyboard.down('Shift')
  const armed = await read()
  check(!!armed && Math.abs(armed.left - start.left) < 1 && Math.abs(armed.width - start.width) < 0.1,
    'Shift-down preserves the exact resting page width and horizontal position',
    JSON.stringify({ before: start, armed }))
  const armedTextRaster = await page.screenshot({ clip: textClip, caret: 'hide' })
  check(restTextRaster.equals(armedTextRaster), 'Shift-down leaves the rendered text crop byte-identical')
  if (!restTextRaster.equals(armedTextRaster)) {
    await page.evaluate(() => { document.querySelector('.iw-magnify-box > div').style.willChange = 'auto' })
    const withoutPromotion = await page.screenshot({ clip: textClip, caret: 'hide' })
    console.log(`  diagnostic: removing the pre-arm layer hint restores the original pixels: ${restTextRaster.equals(withoutPromotion)}`)
    await page.evaluate(() => { document.querySelector('.iw-magnify-box > div').style.removeProperty('will-change') })
  }
  // Drive the physical stream inside the browser. Three host/protocol round-trips per sample
  // produced 80–580ms gaps on WebKit and legitimately triggered release snaps between "continuous"
  // inputs. Geometry is still sampled independently on every display frame above.
  const { owned, returnedBeforeRelease } = await page.evaluate((point) => new Promise((resolve) => {
    const surface = document.querySelector('.inkwave-editor-surface')
    let count = 0
    let owned = true
    const forwardCount = 28
    const timer = setInterval(() => {
      const deltaY = count < forwardCount ? 24 : -24
      window.__iwHorizontalTrace.inputs.push({ t: performance.now(), deltaY })
      const event = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, shiftKey: true,
        clientX: point.x, clientY: point.y, deltaY,
      })
      surface.dispatchEvent(event)
      owned &&= event.defaultPrevented
      count++
      if (count < forwardCount * 2) return
      clearInterval(timer)
      requestAnimationFrame(() => {
        const box = surface.querySelector('.iw-magnify-box')
        const rect = box.getBoundingClientRect()
        resolve({ owned, returnedBeforeRelease: {
          scale: Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) || 1,
          left: rect.left, width: rect.width, scrollLeft: surface.scrollLeft,
          clientWidth: surface.clientWidth, clientLeft: surface.clientLeft, scrollWidth: surface.scrollWidth,
          translate: box.style.translate,
        } })
      })
    }, 16)
  }), point)
  await page.keyboard.up('Shift')
  // The release can include the bounded trackpad coast plus the critically damped well. Wait past
  // both before comparing the final at-rest endpoint; the per-frame trace below still checks that
  // neither phase hides a horizontal correction.
  await page.waitForTimeout(340)
  const trace = await page.evaluate(() => {
    window.__iwHorizontalTrace.active = false
    return window.__iwHorizontalTrace.samples
  })
  const maximumInputGap = await page.evaluate(() => Math.max(...window.__iwHorizontalTrace.inputs.map((sample, index, all) =>
    index ? sample.t - all[index - 1].t : 0)))
  if (maximumInputGap >= 82) throw new Inconclusive(`the input stream stalled ${maximumInputGap.toFixed(1)}ms and crossed the release boundary`)

  const moving = trace.filter((sample, index) => index === 0
    || sample.scale !== trace[index - 1].scale
    || sample.left !== trace[index - 1].left
    || sample.scrollLeft !== trace[index - 1].scrollLeft)
  let sameScaleKick = 0
  for (let index = 1; index < moving.length; index++) {
    const previous = moving[index - 1]
    const current = moving[index]
    if (Math.abs(current.scale - previous.scale) < 1e-8)
      sameScaleKick = Math.max(sameScaleKick, Math.abs(current.left - previous.left))
  }
  const peakIndex = moving.reduce((best, sample, index) => sample.scale > moving[best].scale ? index : best, 0)
  const peak = moving[peakIndex]
  const forward = moving.slice(0, peakIndex + 1)
  const reverse = moving.slice(peakIndex + 1)
  let matchedRoundTripError = 0
  let matchedFrames = 0
  for (const sample of reverse) {
    const match = forward.reduce((best, candidate) =>
      Math.abs(candidate.scale - sample.scale) < Math.abs(best.scale - sample.scale) ? candidate : best,
    forward[0])
    if (Math.abs(match.scale - sample.scale) > 0.001) continue
    matchedFrames++
    matchedRoundTripError = Math.max(matchedRoundTripError, Math.abs(match.left - sample.left))
  }
  // Once the page crosses the inner/text detent it must preserve a page-local point under the
  // off-centre cursor, not merely happen to return to a correct endpoint. The viewport used by
  // this proof puts that detent above ~2.3×; take the first 2.4× frame as a conservative sample.
  const cursorFrames = forward.filter((sample) => sample.scale >= 2.4)
  let cursorAnchorError = Number.POSITIVE_INFINITY
  if (cursorFrames.length >= 2) {
    const acquired = cursorFrames[0]
    const localX = (point.x - acquired.left) / acquired.scale
    cursorAnchorError = Math.max(...cursorFrames.map((sample) =>
      Math.abs(sample.left + localX * sample.scale - point.x)))
  }
  const end = await read()
  check(owned, 'every Shift wheel sample is owned')
  check(!!peak && peak.scale > start.scale * 2.2,
    'the gesture crosses the inner/text well', `start ${start.scale.toFixed(3)}, peak ${peak?.scale.toFixed(3)}`)
  check(sameScaleKick < 1,
    'no delayed horizontal correction moves the page at a fixed scale', `${sameScaleKick.toFixed(2)}px maximum`)
  check(matchedFrames >= 5 && matchedRoundTripError < 2,
    'forward and reverse frames retrace at matched scales',
    `${matchedRoundTripError.toFixed(2)}px maximum across ${matchedFrames} matched frames`)
  check(cursorFrames.length >= 2 && cursorAnchorError < 2,
    'past the inner well the acquired page point stays under the cursor',
    `${cursorAnchorError.toFixed(2)}px maximum across ${cursorFrames.length} frames ${JSON.stringify(cursorFrames.map((sample) => ({ scale: sample.scale, left: sample.left, scrollLeft: sample.scrollLeft })))}`)
  check(!!returnedBeforeRelease && Math.abs(returnedBeforeRelease.left - start.left) < 2
      && Math.abs(returnedBeforeRelease.scale - start.scale) < 0.002,
    'equal forward/reverse input retraces the horizontal position before release coast',
    `${Math.abs((returnedBeforeRelease?.left ?? 0) - start.left).toFixed(2)}px error ${JSON.stringify({ start, returnedBeforeRelease })}`)
  check(!!end && Number.isFinite(end.scale) && Number.isFinite(end.left),
    'the bounded release coast settles to finite geometry', `scale ${end?.scale.toFixed(3)}`)
  check(moving.length >= 12, 'the trace contains a continuous multi-frame path', `${moving.length} changed frames`)
} catch (error) {
  if (error instanceof Inconclusive) {
    console.log(`INCONCLUSIVE: ${error.message}.`)
    inconclusive = true
  } else {
    console.log(`  ✗ probe crashed — ${error instanceof Error ? error.message : String(error)}`)
    failed++
  }
} finally {
  await browser.close()
  await stop()
}

console.log(inconclusive ? '\nINCONCLUSIVE' : failed ? '\nFAIL' : '\nPASS')
process.exitCode = inconclusive ? 2 : failed ? 1 : 0
