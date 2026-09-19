// TRACKPAD ZOOM MODE LIVE PROOF — real production build, real browser wiring.
// Proves cursor position no longer selects the mode:
//   natural pinch anywhere          → text reflow
//   Command-wheel anywhere         → text reflow
//   Shift+any two-finger direction → whole-page magnify
// while ordinary unmodified wheel input is still left to native document scrolling.

import { chromium, webkit } from '@playwright/test'
import { startProbeServer } from './textrender-probe/serve.mjs'

const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const browserType = ({ chromium, webkit })[ENGINE]
if (!browserType) throw new Error(`unknown PROBE_ENGINE=${ENGINE}; expected chromium or webkit`)
const { base, stop } = await startProbeServer()
const browser = await browserType.launch({ headless: true })
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
  const paper = surface?.querySelector('.iw-magnify-box > div')
  const style = surface ? getComputedStyle(surface) : null
  const paperStyle = paper ? getComputedStyle(paper) : null
  const transform = paperStyle?.transform ?? 'none'
  return {
    editorZoom: Number(style?.getPropertyValue('--iw-editor-zoom')) || 1,
    // The surface token is the canonical scale through WebKit's rest-zoom ↔ moving-transform handoff;
    // WebKit serialises computed CSS zoom with a small engine rounding error.
    magnify: Number(style?.getPropertyValue('--iw-magnify')) || (transform === 'none' ? Number(paperStyle?.zoom) || 1 : new DOMMatrixReadOnly(transform).a),
    scrollTop: surface?.scrollTop || 0,
    bottomGap: surface ? Math.max(0, surface.scrollHeight - surface.clientHeight - surface.scrollTop) : 0,
    textCursor: surface?.getAttribute('data-iw-zoom-mode') === 'text',
    waterCursor: surface?.getAttribute('data-iw-zoom-mode') === 'water',
  }
})

const wheel = (init) => page.evaluate((eventInit) => {
  const surface = document.querySelector('.inkwave-editor-surface')
  if (!surface) return null
  const { momentum, ...wheelInit } = eventInit
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...wheelInit })
  // Chromium's native field exists on trusted macOS events before every build exposes it through
  // WheelEventInit, so the proof defines the same instance property explicitly.
  if (typeof momentum === 'boolean') Object.defineProperty(event, 'momentum', { value: momentum })
  surface.dispatchEvent(event)
  return event.defaultPrevented
}, init)

const magnifyGeometry = (point) => page.evaluate((anchor) => {
  const surface = document.querySelector('.inkwave-editor-surface')
  const box = surface?.querySelector('.iw-magnify-box')
  if (!surface || !box) return null
  const rect = box.getBoundingClientRect()
  const surfaceRect = surface.getBoundingClientRect()
  const paper = box.querySelector(':scope > div')
  const paperStyle = paper ? getComputedStyle(paper) : null
  const transform = paperStyle?.transform ?? 'none'
  const surfaceStyle = getComputedStyle(surface)
  return {
    top: rect.top,
    magnify: Number(surfaceStyle.getPropertyValue('--iw-magnify')) || (transform === 'none' ? Number(paperStyle?.zoom) || 1 : new DOMMatrixReadOnly(transform).a),
    anchorY: anchor.clientY,
    centerError: (rect.left + rect.right - surfaceRect.left - surfaceRect.right) / 2,
    boxLeft: rect.left,
    boxRight: rect.right,
    boxWidth: rect.width,
    surfaceLeft: surfaceRect.left,
    surfaceRight: surfaceRect.right,
    clientWidth: surface.clientWidth,
    offsetWidth: surface.offsetWidth,
    scrollLeft: surface.scrollLeft,
  }
}, point)

const magnifyDetents = () => page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface')
  const paper = surface?.querySelector('.iw-magnify-box > div')
  const sheet = paper?.querySelector('.scroll-paper')
  if (!surface || !paper || !sheet) return null
  const surfaceStyle = getComputedStyle(surface)
  const sheetStyle = getComputedStyle(sheet)
  const pageWidth = paper.clientWidth
  const textWidth = pageWidth - parseFloat(sheetStyle.paddingLeft) - parseFloat(sheetStyle.paddingRight)
  const available = surface.clientWidth
    - Math.max(0, surface.offsetWidth - surface.clientWidth)
    - Math.max(12, parseFloat(surfaceStyle.paddingLeft))
    - Math.max(12, parseFloat(surfaceStyle.paddingRight))
  return {
    page: available / pageWidth * 1.025,
    text: available / textWidth * 1.015,
  }
})

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
  console.log(`── ${ENGINE} scroll / zoom integration ──`)
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
  // The paste leaves the caret at the document end and browsers scroll it into view. Put the
  // harness at the start BEFORE recording pointer coordinates, so they describe the visible page.
  await page.evaluate(() => { const surface = document.querySelector('.inkwave-editor-surface'); if (surface) surface.scrollTop = 0 })
  await page.waitForTimeout(50)
  const points = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface').getBoundingClientRect()
    const text = document.querySelector('.ProseMirror').getBoundingClientRect()
    return {
      outside: { clientX: surface.left + 4, clientY: surface.top + 220 },
      inside: { clientX: text.left + text.width / 2, clientY: text.top + 40 },
      insideLeft: { clientX: text.left + text.width * 0.25, clientY: text.top + 40 },
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

  await page.keyboard.down('Shift')
  const shiftKeyOnly = await state()
  const coldMagnifyArmed = await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    const paper = surface?.querySelector('.iw-magnify-box > div')
    return {
      armed: surface?.hasAttribute('data-iw-magnify-armed') || false,
      willChange: paper ? getComputedStyle(paper).willChange : '',
    }
  })
  await page.keyboard.up('Shift')
  const coldMagnifyReleased = await page.evaluate(() =>
    !document.querySelector('.inkwave-editor-surface')?.hasAttribute('data-iw-magnify-armed'))
  check(coldMagnifyArmed.armed
      && coldMagnifyArmed.willChange === (ENGINE === 'webkit' ? 'transform' : 'auto') && coldMagnifyReleased,
    'Shift uses a cold-layer hint only on WebKit, where it preserves the text pixels', JSON.stringify(coldMagnifyArmed))
  check(shiftKeyOnly.editorZoom === initial.editorZoom && shiftKeyOnly.magnify === initial.magnify,
    'pressing Shift alone cannot change font size or page scale', JSON.stringify({ before: initial, held: shiftKeyOnly }))

  const plainPinchPrevented = await wheel({ ...points.outside, ctrlKey: true, deltaY: -4 })
  await page.waitForTimeout(80)
  const plainPinch = await state()
  check(plainPinchPrevented === true, 'plain pinch is owned by Inkwave rather than browser zoom')
  check(plainPinch.editorZoom > initial.editorZoom && plainPinch.magnify === initial.magnify,
    'natural pinch still reflows text', JSON.stringify(plainPinch))
  check(plainPinch.editorZoom / initial.editorZoom < 1.03,
    'a fine text gesture lands on a dense ~2% layout rather than an 8% jump')
  check(initial.scrollTop <= 1 && plainPinch.scrollTop <= 1,
    'text zoom at the document start keeps the document pinned to the top', JSON.stringify({ before: initial.scrollTop, after: plainPinch.scrollTop }))
  await page.waitForTimeout(260)
  const textWellLanded = await state()
  check(Math.abs(textWellLanded.editorZoom - 1) < 0.0001,
    'releasing text zoom beside 100% falls into the exact 100% potential well', JSON.stringify({ moving: plainPinch.editorZoom, landed: textWellLanded.editorZoom }))

  await page.waitForTimeout(700) // let the preceding text-reflow settle/re-anchor finish
  await page.evaluate(() => { const surface = document.querySelector('.inkwave-editor-surface'); if (surface) surface.scrollTop = 1000 })
  const beforeShift = await state()
  const beforeShiftGeometry = await magnifyGeometry(points.inside)
  const shiftPrevented = await wheel({ ...points.inside, shiftKey: true, deltaX: -4, deltaY: 0 })
  await page.waitForTimeout(80)
  const shift = await state()
  const afterShiftGeometry = await magnifyGeometry(points.inside)
  check(shiftPrevented === true, 'Shift-scroll is owned by Inkwave')
  check(shift.magnify > beforeShift.magnify && shift.editorZoom === beforeShift.editorZoom,
    'Shift+horizontal movement performs whole-page zoom', JSON.stringify({ before: beforeShift, after: shift }))
  check(shift.magnify / beforeShift.magnify < 1.03,
    'a fine whole-page gesture applies its fractional transform instead of waiting for a whole notch')
  const cursorAnchorError = beforeShiftGeometry && afterShiftGeometry
    ? Math.abs(
      afterShiftGeometry.top
      + (beforeShiftGeometry.anchorY - beforeShiftGeometry.top)
        * (afterShiftGeometry.magnify / beforeShiftGeometry.magnify)
      - beforeShiftGeometry.anchorY,
    )
    : Number.POSITIVE_INFINITY
  check(cursorAnchorError < 2, 'whole-page magnify holds content at the cursor’s vertical position', `${cursorAnchorError.toFixed(2)}px drift`)
  check(shift.waterCursor && !shift.textCursor, 'Shift-scroll selects the whole-page zoom cursor')

  const beforeImmediateText = await state()
  const immediateTextPrevented = await wheel({ ...points.inside, metaKey: true, deltaY: -4 })
  await page.waitForTimeout(80)
  const immediateText = await state()
  check(immediateTextPrevented === true
      && immediateText.editorZoom < beforeImmediateText.editorZoom
      && immediateText.magnify === beforeImmediateText.magnify,
    'Command switches immediately from water magnify to reversed-axis text reflow inside the cursor cooldown',
    JSON.stringify({ before: beforeImmediateText, after: immediateText }))
  check(immediateText.textCursor && !immediateText.waterCursor,
    'the cursor switches immediately from water to text mode')

  await page.waitForTimeout(400)
  const beforePlain = await state()
  const plainPrevented = await wheel({ ...points.inside, deltaY: 80 })
  await page.waitForTimeout(30)
  const afterPlain = await state()
  check(plainPrevented === false && afterPlain.editorZoom === beforePlain.editorZoom && afterPlain.magnify === beforePlain.magnify,
    'unmodified two-finger scroll remains native document scrolling')

  const beforeMomentumTail = await state()
  const momentumTailPrevented = await wheel({ ...points.inside, metaKey: true, deltaY: -4 })
  await page.waitForFunction((before) => {
    const surface = document.querySelector('.inkwave-editor-surface')
    return Number(surface ? getComputedStyle(surface).getPropertyValue('--iw-editor-zoom') : 1) < before
  }, beforeMomentumTail.editorZoom, { timeout: 3_000 }).catch(() => {})
  const afterMomentumTail = await state()
  check(momentumTailPrevented === true
      && afterMomentumTail.editorZoom < beforeMomentumTail.editorZoom
      && afterMomentumTail.magnify === beforeMomentumTail.magnify,
    'real Command input starts text zoom immediately after ordinary scrolling',
    JSON.stringify({ before: beforeMomentumTail, after: afterMomentumTail }))

  const ownedInertiaPrevented = await wheel({ ...points.inside, metaKey: true, momentum: true, deltaY: -80 })
  await page.waitForTimeout(40)
  const afterOwnedInertia = await state()
  // This input begins beside the 100% well. Its release is allowed to fall back to 100%; the native
  // tail must not push farther in its negative direction. Exact unchanged zoom would reject a
  // working release snap depending on which animation frame this read happens to observe.
  const textOnlyReleasesToward100 = (sample) => sample.editorZoom >= afterMomentumTail.editorZoom
    && sample.editorZoom <= 1
  check(ownedInertiaPrevented === true
      && textOnlyReleasesToward100(afterOwnedInertia)
      && afterOwnedInertia.magnify === afterMomentumTail.magnify,
    'native post-lift momentum cannot push text beyond its physical release pose')

  const releasedTailPrevented = await wheel({ ...points.inside, momentum: true, deltaY: -40 })
  await page.waitForTimeout(20)
  const afterReleasedTail = await state()
  check(releasedTailPrevented === true
      && textOnlyReleasesToward100(afterReleasedTail)
      && afterReleasedTail.magnify === afterMomentumTail.magnify,
    'an owned zoom tail stays discarded after the modifier is released')

  const beforeCommand = await state()
  const commandPrevented = await wheel({ ...points.inside, metaKey: true, deltaY: -4 })
  // A multipage cache miss can make the first exact reflow take longer than one nominal frame.
  await page.waitForFunction((before) => {
    const surface = document.querySelector('.inkwave-editor-surface')
    return Number(surface ? getComputedStyle(surface).getPropertyValue('--iw-editor-zoom') : 1) < before
  }, beforeCommand.editorZoom, { timeout: 3_000 }).catch(() => {})
  const command = await state()
  check(commandPrevented === true && command.editorZoom < beforeCommand.editorZoom && command.magnify === beforeCommand.magnify,
    'Command+two-finger movement reflows text on the reversed vertical axis', JSON.stringify({ before: beforeCommand, after: command, prevented: commandPrevented }))
  check(command.textCursor && !command.waterCursor, 'Command selects the text-zoom cursor')
  const liveGaps = await textGapCrossings()
  check(liveGaps.crossings === 0, 'text never paints through a water gap during live reflow', JSON.stringify(liveGaps))

  await page.waitForTimeout(700)
  const beforeDiagonal = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaX: -60, deltaY: 4 })
  await page.waitForTimeout(80)
  const diagonal = await state()
  check(diagonal.magnify > beforeDiagonal.magnify, 'Shift+diagonal water zoom follows its dominant axis with no dead zone')

  await page.waitForTimeout(400)
  const beforeShiftVertical = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaY: 60 })
  await page.waitForTimeout(80)
  const shiftVertical = await state()
  check(shiftVertical.magnify > beforeShiftVertical.magnify,
    'Shift vertical direction is reversed (positive delta now magnifies the page in)')

  await page.waitForTimeout(400)
  const beforeHorizontalPinch = await state()
  await wheel({ ...points.inside, ctrlKey: true, deltaX: -120, deltaY: 0 })
  await page.waitForTimeout(80)
  const horizontalPinch = await state()
  check(horizontalPinch.editorZoom > beforeHorizontalPinch.editorZoom,
    'a browser-classified natural pinch remains responsive even when only a horizontal delta survives')

  await page.waitForTimeout(400)
  const centerSamples = []
  for (let i = 0; i < 12; i++) {
    await wheel({ ...points.inside, shiftKey: true, deltaY: 60 })
    await page.waitForTimeout(24)
    const geometry = await magnifyGeometry(points.inside)
    if (geometry) centerSamples.push(geometry)
  }
  const maxCenterError = Math.max(...centerSamples.map((sample) => Math.abs(sample.centerError)))
  const worstCenter = centerSamples.find((sample) => Math.abs(sample.centerError) === maxCenterError)
  check(centerSamples.length === 12 && maxCenterError < 1,
    'whole-page zoom stays horizontally centred while passing the paper-edge detent',
    `${maxCenterError.toFixed(2)}px maximum centre drift ${JSON.stringify(worstCenter)}`)

  // The former page-fit cap consumed every further input. Cross BOTH magnetic points, require a
  // strictly advancing scale at every sample, then replay the same track distance backwards.
  // WebKit's 30Hz limiter can leave the final 24ms-sampled centre-check frame queued; drain it
  // before recording the reversible track start or the proof counts that forward input only once.
  await page.waitForTimeout(120)
  const detents = await magnifyDetents()
  const detentStart = await state()
  const detentSamples = []
  const detentGeometry = []
  await page.keyboard.down('Shift')
  for (let index = 0; index < 30; index++) {
    const previous = (await state()).magnify
    await wheel({ ...points.inside, shiftKey: true, deltaY: 60 })
    // WebKit intentionally caps sustained GPU updates at 30Hz. Observe the committed sample, not
    // a 40ms wall-clock guess that can land one scheduling turn before its cadence timer.
    await page.waitForFunction((before) => {
      const surface = document.querySelector('.inkwave-editor-surface')
      return !!surface && Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) > before
    }, previous, { timeout: 250 }).catch(() => {})
    const sample = await state()
    detentSamples.push(sample.magnify)
    const geometry = await magnifyGeometry(points.inside)
    if (geometry) detentGeometry.push(geometry)
    if (detents && sample.magnify > detents.text * 1.04) break
  }
  const crossed = detents && detentSamples.at(-1) > detents.text
  const strictlyForward = detentSamples.every((value, index) => index === 0 || value > detentSamples[index - 1])
  check(!!crossed && strictlyForward,
    'GPU zoom crosses the paper and text-margin detents without a stuck sample',
    JSON.stringify({ detents, samples: detentSamples }))
  const detentCentreError = Math.max(...detentGeometry.map((sample) => Math.abs(sample.centerError)))
  check(detentGeometry.length === detentSamples.length && detentCentreError < 2.5,
    'a centred cursor stays optically centred through the page→text-margin handoff',
    `${detentCentreError.toFixed(2)}px maximum centre drift`)
  const reverseSamples = []
  for (let index = 0; index < detentSamples.length; index++) {
    const previous = (await state()).magnify
    await wheel({ ...points.inside, shiftKey: true, deltaY: -60 })
    await page.waitForFunction((before) => {
      const surface = document.querySelector('.inkwave-editor-surface')
      return !!surface && Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) < before
    }, previous, { timeout: 250 }).catch(() => {})
    reverseSamples.push((await state()).magnify)
  }
  const detentEnd = await state()
  check(reverseSamples.every((value, index) => index === 0 || value <= reverseSamples[index - 1])
      && detentEnd.magnify < detentSamples.at(-1),
    'new reverse input cancels any in-flight well and moves immediately',
    JSON.stringify({ peak: detentSamples.at(-1), samples: reverseSamples }))
  await page.waitForTimeout(260)
  const detentRelease = await state()
  await page.keyboard.up('Shift')
  check(!!detents && Math.abs(detentRelease.magnify - detents.page) < 0.001,
    'finger/wheel idle falls into the exact potential well while Shift remains held',
    JSON.stringify({ moving: detentEnd.magnify, target: detents?.page, landed: detentRelease.magnify }))

  await page.keyboard.down('Shift')
  await wheel({ ...points.inside, shiftKey: true, deltaY: 2 })
  await page.waitForTimeout(60)
  const pageWellPlateau = await state()
  check(Math.abs(pageWellPlateau.magnify - detentRelease.magnify) < 0.0001,
    'the page detent has a short hidden-track plateau at its exact centre',
    JSON.stringify({ target: detentRelease.magnify, afterTinyInput: pageWellPlateau.magnify }))
  for (let index = 0; index < 3; index++)
    await wheel({ ...points.inside, shiftKey: true, deltaY: 4 })
  await page.waitForTimeout(70)
  const pageWellAbove = await state()
  await page.waitForTimeout(220)
  const pageWellReturned = await state()
  await page.keyboard.up('Shift')
  check(pageWellAbove.magnify > detentRelease.magnify
      && Math.abs(pageWellReturned.magnify - detentRelease.magnify) < 0.001,
    'the page potential well captures symmetrically from the larger-page side',
    JSON.stringify({ target: detentRelease.magnify, above: pageWellAbove.magnify, landed: pageWellReturned.magnify }))

  const shiftVisual = () => page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    const paper = surface?.querySelector('.iw-magnify-box > div')
    const text = surface?.querySelector('.ProseMirror p')
    const paperRect = paper?.getBoundingClientRect()
    const textRect = text?.getBoundingClientRect()
    return {
      editorZoom: Number(surface ? getComputedStyle(surface).getPropertyValue('--iw-editor-zoom') : 1),
      fontSize: text ? getComputedStyle(text).fontSize : '',
      paperWidth: paperRect?.width || 0,
      textHeight: textRect?.height || 0,
    }
  })
  const beforeSettledShift = await shiftVisual()
  await page.keyboard.down('Shift')
  await page.waitForTimeout(40)
  const afterSettledShift = await shiftVisual()
  await page.keyboard.up('Shift')
  check(beforeSettledShift.editorZoom === afterSettledShift.editorZoom
      && beforeSettledShift.fontSize === afterSettledShift.fontSize
      && Math.abs(beforeSettledShift.paperWidth - afterSettledShift.paperWidth) < 0.1
      && Math.abs(beforeSettledShift.textHeight - afterSettledShift.textHeight) < 0.1,
    'pressing Shift at a settled non-1 scale does not resize or reraster the text face',
    JSON.stringify({ before: beforeSettledShift, held: afterSettledShift }))

  await page.waitForTimeout(400)
  await page.evaluate(() => { const surface = document.querySelector('.inkwave-editor-surface'); if (surface) surface.scrollTop = 0 })
  await page.keyboard.down('Shift')
  const topRoundTripStart = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaY: -60 })
  await page.waitForTimeout(40) // continuous fingers: reverse before the 100ms release well
  const topRoundTripEdge = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaY: 60 })
  await page.waitForTimeout(80)
  const topRoundTripEnd = await state()
  await page.keyboard.up('Shift')
  check(topRoundTripEdge.magnify < topRoundTripStart.magnify
      && Math.abs(topRoundTripEnd.magnify - topRoundTripStart.magnify) < 0.001
      && Math.abs(topRoundTripEnd.scrollTop - topRoundTripStart.scrollTop) < 1,
    'water zoom remembers a top-edge clamp and restores the original position on same-gesture reversal',
    JSON.stringify({ start: topRoundTripStart, edge: topRoundTripEdge, end: topRoundTripEnd }))

  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    if (surface) surface.scrollTop = surface.scrollHeight
  })
  await page.keyboard.down('Shift')
  const bottomRoundTripStart = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaY: -60 })
  await page.waitForTimeout(40) // continuous fingers: reverse before the 100ms release well
  const bottomRoundTripEdge = await state()
  await wheel({ ...points.inside, shiftKey: true, deltaY: 60 })
  await page.waitForTimeout(80)
  const bottomRoundTripEnd = await state()
  await page.keyboard.up('Shift')
  check(bottomRoundTripEdge.magnify < bottomRoundTripStart.magnify
      && bottomRoundTripEdge.scrollTop < bottomRoundTripStart.scrollTop
      && Math.abs(bottomRoundTripEnd.magnify - bottomRoundTripStart.magnify) < 0.001
      && bottomRoundTripStart.bottomGap <= 2 && bottomRoundTripEnd.bottomGap <= 2,
    'water zoom remembers a bottom-edge clamp and restores the original position on same-gesture reversal',
    JSON.stringify({ start: bottomRoundTripStart, edge: bottomRoundTripEdge, end: bottomRoundTripEnd }))

  const horizontalStart = await magnifyGeometry(points.insideLeft)
  const horizontalFrames = []
  await page.keyboard.down('Shift')
  for (let index = 0; index < 16; index++) {
    await wheel({ ...points.insideLeft, shiftKey: true, deltaY: 60 })
    await page.waitForTimeout(40)
    const sample = await magnifyGeometry(points.insideLeft)
    if (sample) horizontalFrames.push(sample)
    if (sample && detents && sample.magnify > detents.text * 1.2) break
  }
  const horizontalEnd = await magnifyGeometry(points.insideLeft)
  await page.keyboard.up('Shift')
  // The local point is acquired at the INNER boundary, where the page is still centred. Acquiring
  // it at the earlier page-edge well would assert the old, explicitly superseded interaction.
  const horizontalLocal = horizontalStart && detents
    ? (points.insideLeft.clientX - ((horizontalStart.boxLeft + horizontalStart.boxRight) / 2
      - horizontalStart.boxWidth / horizontalStart.magnify * detents.text / 2)) / detents.text
    : Number.NaN
  const focusedFrames = horizontalFrames.filter((sample) => detents && sample.magnify >= detents.text)
  const centredFrames = horizontalFrames.filter((sample) => detents && sample.magnify < detents.text)
  const horizontalFocusError = Math.max(...focusedFrames.map((sample) =>
    Math.abs(sample.boxLeft + horizontalLocal * sample.magnify - points.insideLeft.clientX)))
  check(!!detents && !!horizontalEnd && horizontalEnd.magnify >= detents.text
      && focusedFrames.length >= 3 && centredFrames.length >= 1
      && centredFrames.every((sample) => Math.abs(sample.centerError) < 2)
      && horizontalFocusError < 2,
    'horizontal targeting hands from page-centred to cursor-focused at the inner/text well',
    JSON.stringify({ error: horizontalFocusError, point: points.insideLeft, local: horizontalLocal,
      start: horizontalStart, end: horizontalEnd }))

  await page.waitForTimeout(1_200)
  const settledGaps = await textGapCrossings()
  check(settledGaps.crossings === 0, 'text remains inside page surfaces after zoom pagination settles', JSON.stringify(settledGaps))

  // Real browser input, not only dispatchEvent: an unmodified wheel starts vertical scroll and
  // the immediately following Shift-wheel must claim the very first sample. Capture that sample's
  // own display frame so protocol latency cannot accidentally measure a later release snap.
  await page.mouse.move(points.inside.clientX, points.inside.clientY)
  await page.mouse.wheel(0, -160)
  await page.keyboard.down('Shift')
  const nativeShiftStart = await state()
  await page.evaluate(() => {
    const surface = document.querySelector('.inkwave-editor-surface')
    window.__iwNativeShiftFrame = null
    surface.addEventListener('wheel', (event) => requestAnimationFrame(() => {
      window.__iwNativeShiftFrame = {
        owned: event.defaultPrevented,
        magnify: Number(getComputedStyle(surface).getPropertyValue('--iw-magnify')) || 1,
        editorZoom: Number(getComputedStyle(surface).getPropertyValue('--iw-editor-zoom')) || 1,
        overflowY: getComputedStyle(surface).overflowY,
      }
    }), { once: true })
  })
  await page.mouse.wheel(0, 60)
  await page.waitForFunction(() => !!window.__iwNativeShiftFrame, null, { timeout: 2000 })
  const nativeShiftFrame = await page.evaluate(() => window.__iwNativeShiftFrame)
  await page.keyboard.up('Shift')
  check(nativeShiftFrame.owned && nativeShiftFrame.overflowY === 'hidden'
      && nativeShiftFrame.magnify > nativeShiftStart.magnify
      && nativeShiftFrame.editorZoom === nativeShiftStart.editorZoom,
    'the first real Shift-wheel after vertical scrolling freezes scrolling and immediately zooms the page',
    JSON.stringify({ before: nativeShiftStart, frame: nativeShiftFrame }))
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
