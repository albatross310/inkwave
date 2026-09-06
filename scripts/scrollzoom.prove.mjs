// TRACKPAD ZOOM MODE LIVE PROOF — real production build, real browser wiring.
// Proves cursor position no longer selects the mode:
//   natural pinch anywhere          → text reflow
//   Shift+any two-finger direction  → text reflow
//   Command-wheel anywhere         → whole-page magnify
// while ordinary unmodified wheel input is still left to native document scrolling.

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

const textGapCrossings = () => page.evaluate(() => {
  const editor = document.querySelector('.ProseMirror')
  const gaps = [...document.querySelectorAll('.inkwave-page-gap-band')]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.height > 2 && rect.width > 2)
  if (!editor || !gaps.length) return { measurable: false, crossings: 0, gaps: gaps.length }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let crossings = 0
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim() || node.parentElement?.closest('.inkwave-page-gap')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (gaps.some((gap) => rect.bottom > gap.top + 2 && rect.top < gap.bottom - 2)) crossings++
    }
  }
  return { measurable: true, crossings, gaps: gaps.length }
})

try {
  await page.goto(`${base}/?new-window=1&blank=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'), null, { timeout: 60_000 })
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await editor.click()
  await page.evaluate(() => {
    const prose = Array.from({ length: 75 }, (_, index) =>
      `Pagination proof paragraph ${index + 1}. The words should remain entirely on their parchment page while text reflows around every canonical break.`,
    ).join('\n\n')
    const transfer = new DataTransfer()
    transfer.setData('text/plain', prose)
    document.querySelector('.ProseMirror[contenteditable="true"]')?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
    )
  })
  await page.waitForFunction(() => document.querySelectorAll('.inkwave-page-gap-band').length > 0, null, { timeout: 15_000 }).catch(() => {})
  const premise = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    const text = document.querySelector('.ProseMirror')
    return typeof WheelEvent === 'function' && !!surface && !!text &&
      surface.getBoundingClientRect().width > 0 && text.getBoundingClientRect().width > 0
  })
  if (!premise) throw new VoidRun('wheel events or measurable editor geometry are unavailable')
  const baselineGaps = await textGapCrossings()
  if (!baselineGaps.measurable) throw new VoidRun('a multipage document did not produce measurable page gaps')
  check(baselineGaps.crossings === 0, 'the multipage control begins with no text crossing a water gap', JSON.stringify(baselineGaps))
  const points = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface').getBoundingClientRect()
    const text = document.querySelector('.ProseMirror').getBoundingClientRect()
    return {
      outside: { clientX: surface.left + 4, clientY: surface.top + 220 },
      inside: { clientX: text.left + text.width / 2, clientY: text.top + 40 },
    }
  })
  // Force a real enter/move edge. The editor click above may already have parked Playwright at the
  // target point; moving to the same coordinates emits nothing and leaves the lazy wheel listener
  // correctly unarmed, which would make the harness—not the feature—declare every mode dead.
  await page.mouse.move(1, 1)
  await page.mouse.move(points.inside.clientX, points.inside.clientY)
  await page.evaluate(() => document.querySelector('.inkwave-editor-surface')?.dispatchEvent(
    new PointerEvent('pointerenter'),
  ))
  const initial = await state()

  const plainPinchPrevented = await wheel({ ...points.outside, ctrlKey: true, deltaY: -120 })
  await page.waitForTimeout(80)
  const plainPinch = await state()
  check(plainPinchPrevented === true, 'plain pinch is owned by Inkwave rather than browser zoom')
  check(plainPinch.editorZoom > initial.editorZoom && plainPinch.magnify === initial.magnify,
    'natural pinch still reflows text', JSON.stringify(plainPinch))

  await page.waitForTimeout(400)
  const beforeShiftPinch = await state()
  const shiftPrevented = await wheel({ ...points.inside, shiftKey: true, deltaX: -120, deltaY: 0 })
  // A multipage cache miss can make the first exact reflow take longer than one nominal frame.
  // Wait for the observable state, not an arbitrary 80ms machine-speed claim.
  await page.waitForFunction((before) => {
    const surface = document.querySelector('.inkwave-editor-surface')
    return Number(surface ? getComputedStyle(surface).getPropertyValue('--iw-editor-zoom') : 1) > before
  }, beforeShiftPinch.editorZoom, { timeout: 3_000 }).catch(() => {})
  const shiftPinch = await state()
  check(shiftPrevented === true && shiftPinch.editorZoom > beforeShiftPinch.editorZoom && shiftPinch.magnify === beforeShiftPinch.magnify,
    'Shift+horizontal two-finger movement reflows text', JSON.stringify({ before: beforeShiftPinch, after: shiftPinch, prevented: shiftPrevented }))
  check(shiftPinch.textCursor && !shiftPinch.waterCursor, 'Shift+movement selects the text-zoom cursor')
  const liveGaps = await textGapCrossings()
  check(liveGaps.crossings === 0, 'text never paints through a water gap during live reflow', JSON.stringify(liveGaps))

  await page.waitForTimeout(400)
  const beforeCommand = await state()
  const commandPrevented = await wheel({ ...points.inside, metaKey: true, deltaY: -120 })
  await page.waitForTimeout(80)
  const command = await state()
  check(commandPrevented === true, 'Command-scroll is owned by Inkwave')
  check(command.magnify < beforeCommand.magnify && command.editorZoom === beforeCommand.editorZoom,
    'whole-page direction is reversed: the negative test delta now magnifies outward', JSON.stringify({ before: beforeCommand, after: command }))
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
  await wheel({ ...points.inside, shiftKey: true, deltaX: -60, deltaY: 4 })
  await page.waitForTimeout(80)
  const diagonal = await state()
  check(diagonal.editorZoom > beforeDiagonal.editorZoom, 'Shift+diagonal movement follows its dominant axis with no dead zone')

  await page.waitForTimeout(400)
  const beforeHorizontalPinch = await state()
  await wheel({ ...points.inside, ctrlKey: true, deltaX: -120, deltaY: 0 })
  await page.waitForTimeout(80)
  const horizontalPinch = await state()
  check(horizontalPinch.editorZoom > beforeHorizontalPinch.editorZoom,
    'a browser-classified natural pinch remains responsive even when only a horizontal delta survives')

  await page.waitForTimeout(1_200)
  const settledGaps = await textGapCrossings()
  check(settledGaps.crossings === 0, 'text remains inside page surfaces after zoom pagination settles', JSON.stringify(settledGaps))
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
