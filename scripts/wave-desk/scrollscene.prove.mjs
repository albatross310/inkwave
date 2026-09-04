// Deterministic rest-scene integration probe. It proves three browser-facing claims:
//   1. genuine vertical scroll updates mark opacity;
//   2. scrollTop + the fixed 2240px period reproduces exactly the same scene; and
//   3. an editor-zoom gesture (including its anchor scroll correction) does not re-phase marks.
// Numbers only; no screenshots. Uses the production build through the faithful local wave server.
import { chromium, webkit } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const browserType = ({ chromium, webkit })[ENGINE]
if (!browserType) throw new Error(`unknown PROBE_ENGINE=${ENGINE}; expected chromium or webkit`)

const BASE = await autoWaveBase(null)
let browser
try {
  browser = await browserType.launch({ headless: true })
} catch (error) {
  console.error(`INCONCLUSIVE: ${ENGINE} could not launch; no scroll or zoom behavior was observed.`, error)
  process.exit(2)
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })

try {
  await page.waitForFunction(() => {
    const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
      .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
    return surface && !surface.classList.contains('iw-wave-anim')
      && !surface.classList.contains('iw-wave-coast')
      && surface.querySelectorAll('.iw-scene-scroll').length === 72
  }, null, { timeout: 25_000 })
} catch (error) {
  console.error('INCONCLUSIVE: the route never produced a resting editor with the fixed 72-mark scroll scene.', error)
  await browser.close()
  process.exit(2)
}

// Give the otherwise short new document ample scroll range without changing app state.
await page.evaluate(() => {
  const prose = document.querySelector('.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .ProseMirror')
  if (prose instanceof HTMLElement) prose.style.minHeight = '5200px'
})
const enoughRange = await page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill:not(.iw-wave-covered)')
  return surface instanceof HTMLElement && surface.scrollHeight - surface.clientHeight >= 3000
})
if (!enoughRange) {
  console.error('INCONCLUSIVE: the probe could not create enough scroll range to compare a full period.')
  await browser.close()
  process.exit(2)
}

const scene = async () => page.evaluate(() => {
  const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
    .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
  if (!(surface instanceof HTMLElement)) throw new Error('no resting live editor surface')
  return {
    top: surface.scrollTop,
    zoom: getComputedStyle(surface).getPropertyValue('--iw-editor-zoom').trim(),
    opacity: [...surface.querySelectorAll('.iw-scene-scroll')]
      .map((el) => Number((el).style.opacity || 0)),
  }
})

const scrollTo = async (top) => {
  await page.evaluate((value) => {
    const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
      .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
    if (surface instanceof HTMLElement) surface.scrollTop = value
  }, top)
  await page.waitForTimeout(80)
  return scene()
}

const zero = await scrollTo(0)
const first = await scrollTo(360)
const repeated = await scrollTo(360 + 2240)
const changed = first.opacity.some((value, index) => Math.abs(value - zero.opacity[index]) > 1e-8)
const periodic = first.opacity.every((value, index) => Math.abs(value - repeated.opacity[index]) < 1e-8)

// Put the pointer inside the text column so Ctrl-wheel resolves to editor-font zoom, not water zoom.
await scrollTo(1200)
const point = await page.evaluate(() => {
  const prose = document.querySelector('.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .ProseMirror')
  const surface = prose?.closest('.inkwave-editor-surface')
  const rect = prose?.getBoundingClientRect()
  const surfaceRect = surface?.getBoundingClientRect()
  return rect && surfaceRect
    ? { x: rect.left + rect.width / 2, y: Math.max(surfaceRect.top + 40, Math.min(surfaceRect.bottom - 40, 300)) }
    : null
})
if (!point) {
  console.error('INCONCLUSIVE: no visible editor point was available for the zoom gesture.')
  await browser.close()
  process.exit(2)
}
await page.mouse.move(point.x, point.y)
const beforeZoom = await scene()
await page.keyboard.down('Control')
await page.mouse.wheel(0, -120)
await page.keyboard.up('Control')
await page.waitForTimeout(120)
const afterZoom = await scene()
const zoomed = afterZoom.zoom !== beforeZoom.zoom
const zoomStable = beforeZoom.opacity.every((value, index) => Math.abs(value - afterZoom.opacity[index]) < 1e-8)

console.log(`── ${ENGINE} deterministic scroll scene ──`)
console.log(`genuine scroll changed marks : ${changed ? '✓' : '✗'}`)
console.log(`+2240px repeated scene       : ${periodic ? '✓' : '✗'}`)
console.log(`editor zoom committed        : ${zoomed ? '✓' : '✗'} (${beforeZoom.zoom || '1'} → ${afterZoom.zoom || '1'})`)
console.log(`zoom left marks unchanged    : ${zoomStable ? '✓' : '✗'} (scrollTop ${beforeZoom.top} → ${afterZoom.top})`)

await browser.close()
process.exit(changed && periodic && zoomed && zoomStable ? 0 : 1)
