// CROSS-ENGINE IN-PLACE WORKSPACE NAVIGATION PROOF (2026-09-08).
//
// Reproduces the PWA failure shape: create an email beside a blank page, send one horizontal wheel
// detent plus momentum into the remount, and require exactly one switch with a visible editor at
// both ends. A local click-only proof cannot catch the remounting-latch loop.
//
// Run: IW_ENGINE=webkit|chromium node scripts/workspace-navigation.prove.mjs [port]
// Set IW_TEST_URL to an already-running dev origin to bypass the production proof server.

import { chromium, webkit } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { installOpfsBrowserShim } from './lib/opfsBrowserShim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'build/client')
const port = Number(process.argv[2] || 7933)
const externalUrl = process.env.IW_TEST_URL
const engineName = process.env.IW_ENGINE || 'webkit'
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
}

if (!externalUrl && !existsSync(join(CLIENT, 'index.html'))) {
  console.log('\nINCONCLUSIVE — production build is absent; run `pnpm build` first.\n')
  process.exit(2)
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = join(CLIENT, url)
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) file = join(CLIENT, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    if (externalUrl) resolve()
    else server.listen(port, resolve)
  })
} catch (error) {
  console.log(`\nINCONCLUSIVE — proof server could not listen on ${port}: ${error.message}\n`)
  process.exit(2)
}

let browser
try {
  browser = await (engineName === 'chromium' ? chromium : webkit).launch({ headless: true })
} catch (error) {
  server.close()
  console.log(`\nINCONCLUSIVE — Playwright ${engineName} could not launch: ${error.message}\n`)
  process.exit(2)
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await installOpfsBrowserShim(context)
await context.addInitScript(() => {
  localStorage.setItem('inkwave:magnify', '1.27')
  localStorage.setItem('inkwave:editorZoom', '1.22')
})
const page = await context.newPage()
const failures = []
const check = (name, condition, detail = '') => {
  console.log(` ${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(name)
}
page.on('pageerror', (error) => {
  console.log(` ! page error: ${error.message}`)
  failures.push(`page error: ${error.message}`)
})

console.log(`\n─── ${engineName.toUpperCase()} WORKSPACE NAVIGATION PROBE ───`)
await page.goto(externalUrl || `http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__iwEditorLoadReady === true, null, { timeout: 20000 }).catch(() => {})
const boot = await page.evaluate(() => ({
  ready: window.__iwEditorLoadReady ?? null,
  title: document.title,
  text: (document.body?.textContent || '').trim().slice(0, 400),
  storage: typeof navigator.storage?.getDirectory,
}))
console.log(` boot: ${JSON.stringify(boot)}`)
await page.evaluate(() => window.dispatchEvent(new Event('inkwave:continue-load')))
await page.locator('button[aria-label="Options"]').waitFor({ state: 'visible', timeout: 20000 })
const blankId = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'))
await page.locator('.ProseMirror[contenteditable="true"]').fill(Array.from({ length: 40 }, (_, index) =>
  `Remembered panel paragraph ${index + 1}. The returning swipe must keep this exact vertical reading position and paper scale.`,
).join('\n\n'))
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  if (surface) surface.scrollTop = Math.min(1820, surface.scrollHeight - surface.clientHeight)
})
await page.waitForTimeout(80)
const sourcePose = await page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  const box = surface?.querySelector(':scope > .iw-magnify-box')
  const rect = box?.getBoundingClientRect()
  const paragraph = [...surface.querySelectorAll('.ProseMirror p')].find((element) => {
    const rect = element.getBoundingClientRect()
    return element.textContent && rect.top >= 80 && rect.bottom < innerHeight - 80
  })
  const p = paragraph?.getBoundingClientRect()
  const style = paragraph && getComputedStyle(paragraph)
  return {
    scrollTop: surface?.scrollTop ?? 0, left: rect?.left ?? null, width: rect?.width ?? null,
    magnify: getComputedStyle(surface).getPropertyValue('--iw-magnify'),
    textZoom: getComputedStyle(surface).getPropertyValue('--iw-editor-zoom'),
    paragraph: {
      text: paragraph?.textContent, left: p?.left, top: p?.top, width: p?.width, height: p?.height,
      font: style?.fontFamily, size: style?.fontSize, lineHeight: style?.lineHeight, color: style?.color,
    },
  }
})
check('fixture exercises magnified reflowed text at a substantial reading position',
  sourcePose.scrollTop > 1000 && Number(sourcePose.magnify) > 1.1 && Number(sourcePose.textZoom) > 1.1,
  JSON.stringify(sourcePose))
await page.locator('button[aria-label="Options"]').click()
await page.getByText('New email', { exact: true }).click()
await page.getByRole('dialog', { name: 'Choose documents for new email' }).getByRole('button', { name: 'Start email' }).click()
await page.locator('input[aria-label="To"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
const emailId = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'))
await page.waitForFunction(() => !document.documentElement.hasAttribute('data-iw-workspace-slide'), null, { timeout: 8000 })
check('new email reveals without a loading-screen Continue event', await page.locator('input[aria-label="To"]').count() === 1)
check('new email has a distinct identity', !!blankId && !!emailId && blankId !== emailId, `${blankId} → ${emailId}`)
check('the source blank page remains on the right', await page.locator('[aria-label^="Open right panel:"]').count() === 1)
const primed = await page.evaluate((targetId) => {
  const strip = document.querySelector('.iw-workspace-swipe-strip')
  const right = document.querySelector('.iw-workspace-swipe-slot--right')
  const rect = right?.getBoundingClientRect()
  return {
    strip: !!strip,
    target: right?.getAttribute('data-iw-swipe-document') || null,
    left: rect?.left ?? null,
    width: rect?.width ?? null,
    viewport: innerWidth,
    opacity: right ? getComputedStyle(right).opacity : null,
    text: (right?.textContent || '').trim(),
  }
}, blankId)
check('the known neighbour is prepainted off screen before any gesture',
  primed.strip && primed.target === blankId
    && (primed.text.length > 0 || await page.locator('.iw-workspace-swipe-slot--right [data-iw-exact-preview]').count() === 1),
  JSON.stringify(primed))
check('the neighbour begins exactly one viewport away and fully opaque',
  Math.abs((primed.left ?? 0) - primed.viewport) < 1 && primed.width === primed.viewport && primed.opacity === '1',
  JSON.stringify(primed))
const previewParagraph = await page.evaluate((text) => {
  const slot = document.querySelector('.iw-workspace-swipe-slot--right')
  const paragraph = [...slot.querySelectorAll('.ProseMirror p')].find((element) => element.textContent === text)
  const rect = paragraph?.getBoundingClientRect()
  const style = paragraph && getComputedStyle(paragraph)
  return rect ? {
    left: rect.left - innerWidth, top: rect.top, width: rect.width, height: rect.height,
    font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color,
  } : null
}, sourcePose.paragraph.text)
check('prepainted text has the same size and exact saved viewport coordinates as the live source',
  !!previewParagraph && ['left', 'top', 'width', 'height'].every((key) => Math.abs(previewParagraph[key] - sourcePose.paragraph[key]) < 1),
  JSON.stringify({ source: sourcePose.paragraph, previewParagraph }))
check('the preview retains the real font, font size, line height and text ink',
  !!previewParagraph && ['font', 'size', 'lineHeight', 'color'].every((key) => previewParagraph[key] === sourcePose.paragraph[key]))

const earlyClaim = await page.evaluate(() => {
  const event = new WheelEvent('wheel', { deltaX: -8, deltaY: 1, bubbles: true, cancelable: true })
  document.querySelector('.inkwave-editor-surface.iw-fill')?.dispatchEvent(event)
  return event.defaultPrevented
})
check('clear horizontal intent is reserved before Safari can start native history swipe', earlyClaim)
check('the early reservation does not move a panel',
  await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId')) === emailId)
await page.waitForFunction(() =>
  !document.querySelector('.iw-workspace-navigation[data-iw-swipe-active]')
    && !document.querySelector('[data-iw-workspace-swipe-card]'),
null, { timeout: 1500 }).catch(() => {})

await page.evaluate(() => {
  window.__iwWorkspaceTransitionProof = []
  window.__iwWorkspaceWaveProof = []
  const record = (phase) => (event) => {
    const animations = phase === 'ready'
      ? document.getAnimations().map((animation) => ({
          name: animation.animationName || '',
          frames: animation.effect?.getKeyframes?.().map((frame) => ({
            opacity: frame.opacity == null ? null : String(frame.opacity),
            transform: frame.transform == null ? null : String(frame.transform),
          })) || [],
        }))
      : []
    window.__iwWorkspaceTransitionProof.push({
      phase,
      at: performance.now(),
      direction: event.detail?.direction || null,
      animations,
    })
  }
  window.addEventListener('inkwave:workspace-transition-start', record('start'))
  window.addEventListener('inkwave:workspace-transition-ready', record('ready'))
  window.addEventListener('inkwave:workspace-transition-end', record('end'))
  window.addEventListener('inkwave:workspace-wave-motion', (event) => {
    window.__iwWorkspaceWaveProof.push({
      at: performance.now(),
      pose: event.detail?.pose ?? null,
      active: !!event.detail?.active,
    })
  })
})

// One physical fingers-left gesture. The card follows each sample; the decreasing tail is the
// browser's post-lift trackpad momentum and therefore supplies the wave's exponential decay.
const dragVisual = await page.evaluate(async () => {
  const fire = (dx) => document.querySelector('.inkwave-editor-surface.iw-fill')
    ?.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: 1, bubbles: true, cancelable: true }))
  fire(-40)
  // Direct manipulation writes both transforms synchronously in the wheel task. Sampling there
  // avoids turning a slow headless-WebKit rAF into a false 90ms finger-release boundary.
  const box = document.querySelector('.inkwave-editor-surface.iw-fill .iw-magnify-box')
  const strip = document.querySelector('.iw-workspace-swipe-strip')
  const right = document.querySelector('.iw-workspace-swipe-slot--right')
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  const sample = {
    cardTransform: box?.style.transform || '',
    stripTransform: strip?.style.transform || '',
    surfaceTransform: surface ? getComputedStyle(surface).transform : '',
    slotLeft: right?.getBoundingClientRect().left ?? null,
    slotWidth: right?.getBoundingClientRect().width ?? null,
    slotOpacity: right ? getComputedStyle(right).opacity : '',
    slotTarget: right?.getAttribute('data-iw-swipe-document') || null,
    waveActive: surface?.hasAttribute('data-iw-workspace-wave') || false,
    waveX: surface?.style.getPropertyValue('--wave-x') || '',
    activeId: sessionStorage.getItem('inkwave:tabDocumentId'),
  }
  fire(-28)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  fire(-16)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  fire(-8)
  return sample
})
check('the live paper and prepainted strip follow the fingers with one flat GPU transform',
  dragVisual.cardTransform.replaceAll(' ', '') === 'translate3d(-40px,0px,0px)'
    && dragVisual.stripTransform === dragVisual.cardTransform
    && !dragVisual.cardTransform.includes('rotate'),
  JSON.stringify({ card: dragVisual.cardTransform, strip: dragVisual.stripTransform }))
check('the incoming viewport stays exactly adjacent and never fades',
  Math.abs((dragVisual.slotLeft ?? 0) - 1400) < 1
    && dragVisual.slotWidth === 1440
    && dragVisual.slotOpacity === '1'
    && dragVisual.slotTarget === blankId,
  JSON.stringify(dragVisual))
check('the water surface stays fixed while its waves follow the same input speed',
  dragVisual.surfaceTransform === 'none' && dragVisual.waveActive && dragVisual.waveX !== '',
  JSON.stringify({ surfaceTransform: dragVisual.surfaceTransform, waveActive: dragVisual.waveActive, waveX: dragVisual.waveX }))
check('dragging alone does not switch the live document', dragVisual.activeId === emailId)

await page.waitForFunction((id) => sessionStorage.getItem('inkwave:tabDocumentId') === id, blankId, { timeout: 8000 }).catch(() => {})
await page.waitForFunction(() => !document.querySelector('.iw-workspace-navigation[data-iw-swipe-active]'), null, { timeout: 5000 }).catch(() => {})
await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
await page.waitForFunction((top) => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  return !!surface && Math.abs(surface.scrollTop - top) < 3
}, sourcePose.scrollTop, { timeout: 5000 }).catch(() => {})
await page.waitForFunction(() => window.__iwWorkspaceWaveProof?.some((entry) => !entry.active), null, { timeout: 2500 }).catch(() => {})
await page.waitForTimeout(260) // include the old delayed pagination/zoom correction window
const afterTail = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'))
check('one released swipe and its momentum tail move exactly one panel', afterTail === blankId, `landed ${afterTail}`)
check('the email is now the left neighbour', await page.locator('[aria-label^="Open left panel:"]').count() === 1)
const transitionProof = await page.evaluate(() => window.__iwWorkspaceTransitionProof || [])
const waveProof = await page.evaluate(() => window.__iwWorkspaceWaveProof || [])
const activeWavePoses = waveProof.filter((entry) => entry.active).map((entry) => entry.pose)
check('interactive swipe uses the primed neighbour instead of starting a second snapshot transition',
  transitionProof.length === 0, JSON.stringify(transitionProof))
check('wave displacement follows every trackpad sample and lands with an inactive final pose',
  activeWavePoses.length >= 4
    && activeWavePoses.every((pose, index) => index === 0 || pose <= activeWavePoses[index - 1])
    && waveProof.some((entry) => !entry.active),
  JSON.stringify(waveProof))
check('the destination is visible when the landed neighbour releases it',
  await page.locator('.ProseMirror').first().isVisible().catch(() => false))
const landedPose = await page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  const box = surface?.querySelector(':scope > .iw-magnify-box')
  const rect = box?.getBoundingClientRect()
  const canvas = surface?.querySelector('.iw-low-power-water-canvas-a')
  const canvasTransform = canvas ? getComputedStyle(canvas).transform : null
  return {
    scrollTop: surface?.scrollTop ?? null,
    left: rect?.left ?? null,
    width: rect?.width ?? null,
    wave: Number.parseFloat(surface?.style.getPropertyValue('--wave-x') || ''),
    carriedWave: window.__iwWorkspaceWavePose ?? null,
    scrollHeight: surface?.scrollHeight ?? null,
    memory: JSON.parse(localStorage.getItem(`inkwave:scrollPos:${sessionStorage.getItem('inkwave:tabDocumentId')}`) || 'null'),
    canvasX: canvasTransform ? new DOMMatrixReadOnly(canvasTransform).m41 : null,
    threaded: surface?.hasAttribute('data-iw-threaded-scroll-water') || false,
  }
})
const landedParagraph = await page.evaluate((text) => {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
  const paragraph = [...surface.querySelectorAll('.ProseMirror p')].find((element) => element.textContent === text)
  const rect = paragraph?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
}, sourcePose.paragraph.text)
check('landing exposes the same paragraph at the same size and vertical position as the preview',
  !!previewParagraph && !!landedParagraph && ['left', 'top', 'width', 'height'].every((key) => Math.abs(landedParagraph[key] - previewParagraph[key]) < 2),
  JSON.stringify({ previewParagraph, landedParagraph }))
check('the live destination keeps the prepainted paper size and remembered vertical position',
  Math.abs((landedPose.scrollTop ?? 0) - sourcePose.scrollTop) < 3
    && Math.abs((landedPose.left ?? 0) - (sourcePose.left ?? 0)) < 2
    && Math.abs((landedPose.width ?? 0) - (sourcePose.width ?? 0)) < 2,
  JSON.stringify({ sourcePose, landedPose }))
check('the new surface adopts the same water pose instead of restarting it',
  Number.isFinite(landedPose.wave) && Math.abs(landedPose.wave - landedPose.carriedWave) < 0.2,
  JSON.stringify({ wave: landedPose.wave, carried: landedPose.carriedWave }))
const phaseDistance = (a, b) => Math.abs(((a - b + 210) % 140 + 140) % 140 - 70)
check('the painted water canvas retains that phase after threaded scroll is restored',
  Number.isFinite(landedPose.canvasX) && phaseDistance(landedPose.canvasX, landedPose.carriedWave) < 0.5,
  JSON.stringify({ canvas: landedPose.canvasX, carried: landedPose.carriedWave, threaded: landedPose.threaded }))

await page.waitForTimeout(220) // a genuinely new physical gesture
await page.evaluate(() => document.querySelector('.inkwave-editor-surface.iw-fill')
  ?.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true })))
await page.waitForFunction((id) => sessionStorage.getItem('inkwave:tabDocumentId') === id, emailId, { timeout: 5000 }).catch(() => {})
await page.locator('input[aria-label="To"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
check('the next physical swipe returns to the email', await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId')) === emailId)
check('the returned email is visible', await page.locator('input[aria-label="To"]').isVisible().catch(() => false))

const endsBeforeBack = await page.evaluate(() => window.__iwWorkspaceTransitionProof?.filter((entry) => entry.phase === 'end').length || 0)
await page.evaluate(() => history.back())
await page.waitForFunction((id) => sessionStorage.getItem('inkwave:tabDocumentId') === id, blankId, { timeout: 5000 }).catch(() => {})
await page.waitForFunction((count) => (window.__iwWorkspaceTransitionProof?.filter((entry) => entry.phase === 'end').length || 0) > count, endsBeforeBack, { timeout: 5000 }).catch(() => {})
await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
check('browser Back traverses to the previous Inkwave panel without leaving the workspace',
  await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId')) === blankId)
check('browser Back destination is visible', await page.locator('.ProseMirror').first().isVisible().catch(() => false))

await page.evaluate(() => history.forward())
await page.waitForFunction((id) => sessionStorage.getItem('inkwave:tabDocumentId') === id, emailId, { timeout: 5000 }).catch(() => {})
await page.locator('input[aria-label="To"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
check('browser Forward returns to the next Inkwave panel',
  await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId')) === emailId)
check('browser Forward destination is visible', await page.locator('input[aria-label="To"]').isVisible().catch(() => false))
await page.waitForFunction(() => !document.documentElement.hasAttribute('data-iw-workspace-slide'), null, { timeout: 8000 })
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.__iwEditorLoadReady === true, null, { timeout: 20000 })
await page.evaluate(() => window.dispatchEvent(new Event('inkwave:continue-load')))
await page.locator('input[aria-label="To"]').waitFor({ state: 'visible', timeout: 10000 })
const reloadPreview = await page.evaluate((text) => {
  const host = document.querySelector('.iw-workspace-swipe-slot--right [data-iw-exact-preview]')
  const paragraph = host && [...host.querySelectorAll('.ProseMirror p')].find((element) => element.textContent === text)
  const rect = paragraph?.getBoundingClientRect()
  return rect ? { left: rect.left - innerWidth, top: rect.top, width: rect.width, height: rect.height } : null
}, sourcePose.paragraph.text)
check('reload retains the exact visited neighbour and its remembered viewport',
  !!reloadPreview && ['left', 'top', 'width', 'height'].every((key) => Math.abs(reloadPreview[key] - sourcePose.paragraph[key]) < 2),
  JSON.stringify({ reloadPreview, expected: sourcePose.paragraph }))

await browser.close()
server.close()
console.log(`\n${failures.length ? `FAIL — ${failures.join('; ')}` : 'PASS'}\n`)
process.exit(failures.length ? 1 : 0)
