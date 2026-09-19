// Low-power rest-water integration probe. It proves that genuine scroll moves the retained wave
// scene, the two raster backings stay within their 1280×720 visible budget, the old giant DOM fields
// stay unpainted, and zoom-anchor corrections neither re-phase nor promote the water.
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
// Reproduce the isolated installed-PWA failure: an old benchmark flag may remain in that storage
// jar, but production pagination must still mount unless the benchmark marker accompanies it.
await context.addInitScript(() => {
  localStorage.setItem('inkwave:pagOff', '1')
  sessionStorage.removeItem('inkwave:benchmark')
})
const page = await context.newPage()
// The Linux Playwright WebKit port does not expose OPFS. Use the app's explicit blank-document
// intent so this compositor proof cannot mistake that harness gap for a missing water scene.
await page.goto(BASE + '/?blank=1', { waitUntil: 'domcontentloaded' })

try {
  await page.waitForFunction(() => {
    const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
      .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
    return surface && !surface.classList.contains('iw-wave-anim')
      && !surface.classList.contains('iw-wave-coast')
      && window.__iwPaginationReady === true
      && surface.hasAttribute('data-iw-low-power-water')
      && surface.querySelectorAll('.iw-low-power-water-canvas').length === 2
  }, null, { timeout: 25_000 })
} catch (error) {
  console.error('INCONCLUSIVE: the route never produced the resting low-power water scene.', error)
  await browser.close()
  process.exit(2)
}

// Give the otherwise short new document ample scroll range without changing app state.
await page.evaluate(() => {
  const style = document.createElement('style')
  style.dataset.iwProbeScrollRange = ''
  style.textContent = '.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .ProseMirror { min-height: 5200px !important; }'
  document.head.appendChild(style)
})
const range = await page.evaluate(() => {
  const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
    .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
  return surface instanceof HTMLElement
    ? {
        scrollHeight: surface.scrollHeight,
        clientHeight: surface.clientHeight,
      }
    : null
})
if (!range || range.scrollHeight - range.clientHeight < 3000) {
  console.error(`INCONCLUSIVE: the probe could not create enough scroll range to compare a full period (${JSON.stringify(range)}).`)
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
    zoomWaterHold: surface.hasAttribute('data-iw-zoom-water-hold'),
    waveX: Number.parseFloat(surface.style.getPropertyValue('--wave-x')) || 0,
    canvasX: [...surface.querySelectorAll('.iw-low-power-water-canvas')]
      .map((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),
    opacity: [...surface.querySelectorAll('.iw-scene-scroll')]
      .map((el) => Number((el).style.opacity || 0)),
  }
})

const layerState = async () => page.evaluate(() => {
  const surface = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')]
    .find((el) => el.querySelector('.ProseMirror') && !el.classList.contains('iw-wave-covered'))
  if (!(surface instanceof HTMLElement)) throw new Error('no resting live editor surface')
  const wave = getComputedStyle(surface, '::before')
  const fields = [...surface.querySelectorAll('.iw-twk-field')]
  const canvases = [...surface.querySelectorAll('.iw-low-power-water-canvas')]
  const paper = surface.querySelector('.iw-magnify-box > div')
  const paperStyle = paper ? getComputedStyle(paper) : null
  const paperRect = paper?.getBoundingClientRect()
  return {
    top: surface.scrollTop,
    active: surface.hasAttribute('data-iw-scroll-active'),
    threaded: surface.hasAttribute('data-iw-threaded-scroll-water'),
    waveWillChange: wave.willChange,
    waveTransform: wave.transform,
    magnify: getComputedStyle(surface).getPropertyValue('--iw-magnify').trim() || '1',
    shiftFrozen: surface.hasAttribute('data-iw-shift-scroll-frozen'),
    overflowY: getComputedStyle(surface).overflowY,
    paper: paper && paperStyle && paperRect ? {
      transform: paperStyle.transform,
      zoom: paperStyle.zoom,
      clientWidth: paper.clientWidth,
      rectWidth: paperRect.width,
      rectLeft: paperRect.left,
      rectTop: paperRect.top,
    } : null,
    fieldWillChange: fields.map((field) => getComputedStyle(field).willChange),
    fieldInlineTransform: fields.map((field) => field.style.transform),
    fieldSetDisplay: getComputedStyle(surface.querySelector('.iw-twk-set')).display,
    canvasWillChange: canvases.map((canvas) => getComputedStyle(canvas).willChange),
    canvasTransforms: canvases.map((canvas) => canvas.style.transform),
    canvasAnimations: canvases.map((canvas) => {
      const style = getComputedStyle(canvas)
      return {
        name: style.animationName,
        duration: style.animationDuration,
        iterations: style.animationIterationCount,
        timeline: style.animationTimeline,
        currentTime: canvas.getAnimations()[0]?.currentTime?.toString() ?? null,
      }
    }),
    canvasBacking: canvases.map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      cssWidth: Number.parseFloat(canvas.style.width),
      cssHeight: Number.parseFloat(canvas.style.height),
    })),
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
const activeLayers = await layerState()
const repeated = await scrollTo(360 + 140 / 0.06)
const changed = first.canvasX.some((value, index) => Math.abs(value - zero.canvasX[index]) > 0.1)
const periodicMaxDelta = first.canvasX.reduce((max, value, index) => Math.max(max, Math.abs(value - repeated.canvasX[index])), 0)
const periodic = periodicMaxDelta < 0.2
const scrollMotionPolicy = ENGINE === 'webkit'
  ? (activeLayers.threaded ? changed && periodic : !changed)
  : changed && periodic
const marksStayedStatic = first.opacity.every((value, index) => Math.abs(value - zero.opacity[index]) < 1e-8)
await page.waitForTimeout(1550)
const finalRestLayers = await layerState()
const idleLayersReleased = !finalRestLayers.active
  && finalRestLayers.waveWillChange === 'auto'
  && finalRestLayers.waveTransform === 'none'
  && finalRestLayers.fieldWillChange.every((value) => value === 'auto')
  && finalRestLayers.fieldSetDisplay === 'none'
  && finalRestLayers.canvasWillChange.every((value) => value === 'auto')
const activeLayersPromoted = activeLayers.active
  && activeLayers.waveWillChange === 'auto'
  && activeLayers.fieldWillChange.every((value) => value === 'auto')
  && activeLayers.canvasWillChange.every((value) => value === (ENGINE === 'webkit' && !activeLayers.threaded ? 'auto' : 'transform'))
const lowResolution = finalRestLayers.canvasBacking.length === 2
  && finalRestLayers.canvasBacking.every((canvas) => {
    const visibleBackingWidth = canvas.width * 1280 / canvas.cssWidth
    return visibleBackingWidth <= 1280.5 && canvas.height <= 720 && canvas.cssHeight === 800
  })

// Geometry behind the visible "dash not parallel" regression: x/y is the dash centre and the
// field origin must be congruent with the viewport-anchored 140px SVG tile.
const geometry = await page.evaluate(() => {
  const mod = (n, m) => ((n % m) + m) % m
  const curve = (phase) => {
    const second = phase >= 70
    const t = (second ? phase - 70 : phase) / 70
    const y = second ? 22 + 36 * t - 36 * t * t : 22 - 36 * t + 36 * t * t
    const slope = second ? (36 - 72 * t) / 70 : (-36 + 72 * t) / 70
    return { y, angle: Math.atan(slope) * 180 / Math.PI }
  }
  let maxAngleError = 0, maxYError = 0, count = 0
  let phaseAligned = true, centreAnchored = true
  const offsets = new Set()
  let below = true
  for (const field of document.querySelectorAll('.iw-twk-field')) {
    const fieldLeft = parseFloat(field.style.left)
    phaseAligned &&= Math.abs(mod(fieldLeft, 140)) < 1e-8
    const yOffset = field.classList.contains('iw-twk-fb') ? 70 : 0
    for (const dash of field.querySelectorAll('.iw-scene-dash')) {
      const x = parseFloat(dash.style.left), y = parseFloat(dash.style.top)
      const match = /rotate\(([-.\d]+)deg\)/.exec(dash.style.transform)
      const actualAngle = match ? Number(match[1]) : NaN
      const offsetY = Number(dash.dataset.waveOffset)
      centreAnchored &&= dash.style.transform.startsWith('translate(-50%, -50%)')
      below &&= offsetY >= 10 && offsetY <= 20
      offsets.add(offsetY)
      const expected = curve(mod(fieldLeft + x, 140))
      maxAngleError = Math.max(maxAngleError, Math.abs(actualAngle - expected.angle))
      maxYError = Math.max(maxYError, Math.abs(mod(y, 140) - (expected.y + yOffset + offsetY)))
      count++
    }
  }
  return { count, phaseAligned, centreAnchored, below, offsetCount: offsets.size, maxAngleError, maxYError }
})
const parallel = geometry.count > 0 && geometry.phaseAligned && geometry.centreAnchored && geometry.below
  && geometry.offsetCount > 20
  && geometry.maxAngleError <= 0.011 && geometry.maxYError <= 0.011

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
const zoomStable = beforeZoom.canvasX.every((value, index) => Math.abs(value - afterZoom.canvasX[index]) < 0.2)

// Magnify's cursor-anchor correction also emits scroll. It must not wake the enormous decorative
// water layers: the sway is intentionally held for zoom, so promotion there buys no visual work.
await page.waitForTimeout(700)
await scrollTo(1200)
await page.waitForTimeout(1550)
const beforeMagnify = await layerState()
await page.keyboard.down('Shift')
const armedMagnify = await layerState()
await page.mouse.wheel(0, -120)
await page.waitForTimeout(50)
await page.mouse.wheel(0, -120)
await page.waitForTimeout(50)
const movingMagnify = await layerState()
await page.keyboard.up('Shift')
await page.waitForTimeout(320)
const afterMagnify = await layerState()
const magnified = afterMagnify.magnify !== beforeMagnify.magnify
const shiftStoppedScroll = armedMagnify.shiftFrozen && armedMagnify.overflowY === 'hidden'
const supportsCssZoom = await page.evaluate(() => CSS.supports('zoom', '1'))
const settledTextRaster = !supportsCssZoom || !!afterMagnify.paper
  && afterMagnify.paper.transform === 'none'
  && Math.abs(Number(afterMagnify.paper.zoom) - Number(afterMagnify.magnify)) < 0.001
  && Math.abs(afterMagnify.paper.rectWidth / afterMagnify.paper.clientWidth - Number(afterMagnify.magnify)) < 0.002
const settledPoseStable = !!movingMagnify.paper && !!afterMagnify.paper
  && Math.abs(movingMagnify.top - afterMagnify.top) < 0.6
  && Math.abs(movingMagnify.paper.rectLeft - afterMagnify.paper.rectLeft) < 0.2
  && Math.abs(movingMagnify.paper.rectTop - afterMagnify.paper.rectTop) < 0.6
  && Math.abs(movingMagnify.paper.rectWidth - afterMagnify.paper.rectWidth) < 0.2
const zoomKeptWaterReleased = !afterMagnify.active
  && afterMagnify.waveWillChange === 'auto'
  && afterMagnify.waveTransform === 'none'
  && afterMagnify.fieldWillChange.every((value) => value === 'auto')
  && afterMagnify.canvasWillChange.every((value) => value === 'auto')

// Start a real native scroll before the post-zoom hold would naturally expire. The input boundary
// must restore Safari's threaded timeline before native scrolling begins, rather than attaching it
// in the middle of the gesture and hitching the signature water.
const beforePostZoomScroll = await scene()
await page.mouse.wheel(0, 180)
await page.waitForTimeout(100)
const afterPostZoomScroll = await scene()
const postZoomScrollResumed = afterPostZoomScroll.top > beforePostZoomScroll.top
  && !afterPostZoomScroll.zoomWaterHold
  && afterPostZoomScroll.canvasX.some((value, index) => Math.abs(value - beforePostZoomScroll.canvasX[index]) > 0.1)

// A real multi-page document must still paginate with the stale PWA-only `pagOff` key seeded at
// startup. This is not satisfied merely by the readiness event: require actual tall gap widgets.
await page.evaluate(() => {
  localStorage.setItem('inkwave:gappedPages', '1')
  const sentence = 'A measured paragraph keeps enough ordinary words to cross several canonical page boundaries. '
  const content = Array.from({ length: 120 }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `${index + 1}. ${sentence.repeat(4)}` }],
  }))
  const now = new Date().toISOString()
  const doc = {
    id: `pwa-pagination-${Date.now()}`,
    title: 'PWA pagination proof',
    contentJson: { type: 'doc', content },
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: '00000000-0000-4000-8000-000000000000',
  }
  window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: doc.id, doc } }))
})
let paginationRecovered = false
let paginationGapCount = 0
try {
  await page.waitForFunction(() => window.__iwPaginationReady === true
    && document.querySelectorAll('.inkwave-page-gap:not(.iw-break-marker)').length >= 3, null, { timeout: 25_000 })
  paginationGapCount = await page.locator('.inkwave-page-gap:not(.iw-break-marker)').count()
  paginationRecovered = paginationGapCount >= 3
} catch { /* a missing page set is a product failure reported below */ }

console.log(`── ${ENGINE} low-power scroll scene ──`)
console.log(`engine scroll-water policy   : ${scrollMotionPolicy ? '✓' : '✗'} (${activeLayers.threaded ? 'threaded timeline' : ENGINE === 'webkit' ? 'static fallback' : '30 Hz motion'})`)
if (activeLayers.threaded) console.log(`threaded state               : ${JSON.stringify({ zero: zero.canvasX, first: first.canvasX, repeated: repeated.canvasX, animations: activeLayers.canvasAnimations })}`)
console.log(`one wave period repeats      : ${!changed || periodic ? '✓' : '✗'} (${first.top} → ${repeated.top}, max Δ ${periodicMaxDelta.toFixed(3)}px)`)
console.log(`DOM marks stayed static      : ${marksStayedStatic ? '✓' : '✗'}`)
console.log(`visible backing ≤1280×720  : ${lowResolution ? '✓' : '✗'} (${JSON.stringify(finalRestLayers.canvasBacking)})`)
console.log(`idle layers released         : ${idleLayersReleased ? '✓' : '✗'}`)
console.log(`scroll layer policy correct  : ${activeLayersPromoted ? '✓' : '✗'}`)
console.log(`dashes below + parallel       : ${parallel ? '✓' : '✗'} (${geometry.count} dashes, ${geometry.offsetCount} gaps, angle error ${geometry.maxAngleError.toFixed(3)}°, y error ${geometry.maxYError.toFixed(3)}px)`)
console.log(`editor zoom committed        : ${zoomed ? '✓' : '✗'} (${beforeZoom.zoom || '1'} → ${afterZoom.zoom || '1'})`)
console.log(`zoom left water unchanged    : ${zoomStable ? '✓' : '✗'} (scrollTop ${beforeZoom.top} → ${afterZoom.top})`)
console.log(`water magnify committed       : ${magnified ? '✓' : '✗'} (${beforeMagnify.magnify} → ${afterMagnify.magnify})`)
console.log(`Shift froze native scroll     : ${shiftStoppedScroll ? '✓' : '✗'} (${armedMagnify.overflowY})`)
console.log(`settled text re-rasterised    : ${settledTextRaster ? '✓' : '✗'} (${JSON.stringify(afterMagnify.paper)})`)
console.log(`settled raster kept its pose  : ${settledPoseStable ? '✓' : '✗'}`)
console.log(`zoom kept water unpromoted   : ${zoomKeptWaterReleased ? '✓' : '✗'}`)
console.log(`post-zoom scroll starts live : ${postZoomScrollResumed ? '✓' : '✗'} (${beforePostZoomScroll.top} → ${afterPostZoomScroll.top})`)
console.log(`stale PWA flag cannot unpage : ${paginationRecovered ? '✓' : '✗'} (${paginationGapCount} real gaps)`)

await browser.close()
process.exit(scrollMotionPolicy && marksStayedStatic && lowResolution && idleLayersReleased && activeLayersPromoted && parallel
  && zoomed && zoomStable && magnified && shiftStoppedScroll && settledTextRaster && settledPoseStable
  && zoomKeptWaterReleased && postZoomScrollResumed && paginationRecovered ? 0 : 1)
