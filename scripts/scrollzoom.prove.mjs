// TRACKPAD ZOOM MODE LIVE PROOF — real production build, real browser wiring.
// Proves cursor position no longer selects the mode:
//   plain pinch/ctrl-wheel anywhere → text reflow
//   Command-wheel anywhere         → whole-page magnify
// and an ordinary unmodified wheel is still left to native document scrolling.

import { chromium } from '@playwright/test'
import { startProbeServer } from './textrender-probe/serve.mjs'

const { base, stop } = await startProbeServer()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
let failed = 0
let voided = 0
class VoidRun extends Error {}
const check = (condition, label, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failed++
}

const state = () => page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface')
  const style = surface ? getComputedStyle(surface) : null
  return {
    editorZoom: Number(style?.getPropertyValue('--iw-editor-zoom')) || 1,
    magnify: Number(style?.getPropertyValue('--iw-magnify')) || 1,
    textCursor: surface?.classList.contains('iw-zooming-text') || false,
    waterCursor: surface?.classList.contains('iw-zooming-water') || false,
  }
})

const wheel = (init) => page.evaluate((eventInit) => {
  const surface = document.querySelector('.inkwave-editor-surface')
  if (!surface) return null
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...eventInit })
  surface.dispatchEvent(event)
  return event.defaultPrevented
}, init)

try {
  await page.goto(`${base}/?new-window=1&blank=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'), null, { timeout: 60_000 })
  const premise = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    const text = document.querySelector('.ProseMirror')
    return typeof WheelEvent === 'function' && !!surface && !!text &&
      surface.getBoundingClientRect().width > 0 && text.getBoundingClientRect().width > 0
  })
  if (!premise) throw new VoidRun('wheel events or measurable editor geometry are unavailable')
  const points = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface').getBoundingClientRect()
    const text = document.querySelector('.ProseMirror').getBoundingClientRect()
    return {
      outside: { clientX: surface.left + 4, clientY: surface.top + 220 },
      inside: { clientX: text.left + text.width / 2, clientY: text.top + 40 },
    }
  })
  await page.mouse.move(points.inside.clientX, points.inside.clientY) // arm before the first pinch
  const initial = await state()

  const ctrlOutsidePrevented = await wheel({ ...points.outside, ctrlKey: true, deltaY: -120 })
  await page.waitForTimeout(80)
  const ctrlOutside = await state()
  check(ctrlOutsidePrevented === true, 'plain pinch is owned by Inkwave rather than browser zoom')
  check(ctrlOutside.editorZoom > initial.editorZoom && ctrlOutside.magnify === initial.magnify,
    'plain pinch over the former “water” zone now reflows text', JSON.stringify(ctrlOutside))
  check(ctrlOutside.textCursor && !ctrlOutside.waterCursor, 'plain pinch selects the text-zoom cursor')

  await page.waitForTimeout(400)
  const beforeCtrlInside = await state()
  await wheel({ ...points.inside, ctrlKey: true, deltaY: -120 })
  await page.waitForTimeout(80)
  const ctrlInside = await state()
  check(ctrlInside.editorZoom > beforeCtrlInside.editorZoom && ctrlInside.magnify === beforeCtrlInside.magnify,
    'plain pinch uses the same mode inside the text column')

  await page.waitForTimeout(400)
  const beforeCommand = await state()
  const commandPrevented = await wheel({ ...points.inside, metaKey: true, deltaY: -120 })
  await page.waitForTimeout(80)
  const command = await state()
  check(commandPrevented === true, 'Command-scroll is owned by Inkwave')
  check(command.magnify > beforeCommand.magnify && command.editorZoom === beforeCommand.editorZoom,
    'Command-scroll magnifies the whole page regardless of cursor position', JSON.stringify(command))
  check(command.waterCursor && !command.textCursor, 'Command-scroll selects the whole-page zoom cursor')

  await page.waitForTimeout(400)
  const beforePlain = await state()
  const plainPrevented = await wheel({ ...points.inside, deltaY: 80 })
  await page.waitForTimeout(30)
  const afterPlain = await state()
  check(plainPrevented === false && afterPlain.editorZoom === beforePlain.editorZoom && afterPlain.magnify === beforePlain.magnify,
    'unmodified two-finger scroll remains native document scrolling')

  await page.waitForTimeout(400)
  const beforeDiagonal = await state()
  await wheel({ ...points.inside, ctrlKey: true, deltaX: 60, deltaY: -4 })
  await page.waitForTimeout(80)
  const diagonal = await state()
  check(diagonal.editorZoom > beforeDiagonal.editorZoom, 'an angled pinch with a small vertical component still responds')
} catch (error) {
  if (error instanceof VoidRun) {
    console.log(`  ∅ VOID — ${error.message}; this run proves nothing about trackpad zoom`)
    voided++
  } else {
    console.log(`  ✗ probe crashed — ${error instanceof Error ? error.message : String(error)}`)
    failed++
  }
} finally {
  await browser.close()
  await stop()
}

console.log(voided ? `\nVOID (${voided})` : failed ? `\nFAIL (${failed})` : '\nPASS')
process.exitCode = failed ? 1 : voided ? 2 : 0
