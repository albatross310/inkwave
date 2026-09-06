// PASTED-IMAGE LIVE PROBE — real production build, real Chromium, real OPFS.
// Proves the wiring unit tests cannot: a ClipboardEvent reaches the editor prop, inserts an image
// atom at the caret, stores its bytes, binds their SHA-256 into content, creates + timestamps a
// global snapshot, renders its controls, and survives reload.

import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { startProbeServer } from './textrender-probe/serve.mjs'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X5WvWQAAAABJRU5ErkJggg==',
  'base64',
)
const EXPECTED = createHash('sha256').update(PNG).digest('hex')
const { base, stop } = await startProbeServer()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()
const submitted = []
let failed = 0
let voided = 0
class VoidRun extends Error {}
const check = (condition, label, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failed++
}

async function waitForEditor() {
  await page.waitForFunction(
    () => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'),
    null,
    { timeout: 60_000 },
  )
}

try {
  await page.route('**/api/ots', async (route) => {
    try { submitted.push(JSON.parse(route.request().postData() || '{}')) } catch { /* noop */ }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', proofBase64: 'AA==' }) })
  })
  await page.goto(`${base}/?new-window=1&blank=1`, { waitUntil: 'domcontentloaded' })
  await waitForEditor()
  const documentId = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'))
  const premise = await page.evaluate(async () => {
    const apis = typeof ClipboardEvent === 'function' && typeof DataTransfer === 'function' &&
      typeof File === 'function' && !!navigator.storage?.getDirectory
    if (!apis) return { ok: false, reason: 'clipboard/file/OPFS browser APIs unavailable' }
    try {
      const root = await navigator.storage.getDirectory()
      const probe = await root.getFileHandle('imagepaste-probe.tmp', { create: true })
      const writable = await probe.createWritable()
      await writable.write(new Uint8Array([1]))
      await writable.close()
      await root.removeEntry('imagepaste-probe.tmp')
      return { ok: true, reason: '' }
    } catch (error) {
      return { ok: false, reason: `OPFS write control failed: ${String(error)}` }
    }
  })
  // VOID rather than blame the product when the browser cannot perform the operation being tested.
  if (!premise.ok) throw new VoidRun(premise.reason)
  const globalSnapPill = page.locator('button[title="Provenance record (held by you)"]')
  const snapshotCount = async () => Number((await globalSnapPill.textContent().catch(() => '') || '').match(/\d+/)?.[0] ?? 0)
  const snapsBefore = await snapshotCount()
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await editor.click()
  await page.evaluate((bytes) => {
    const file = new File([Uint8Array.from(bytes)], 'evidence.png', { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
    document.querySelector('.ProseMirror[contenteditable="true"]')?.dispatchEvent(event)
  }, [...PNG])

  const image = page.locator('.iw-media-image img')
  await image.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  const figure = page.locator('.iw-media-image').first()
  await page.waitForFunction(
    ({ expected, before }) => {
      const figure = document.querySelector('.iw-media-image')
      const pill = document.querySelector('button[title="Provenance record (held by you)"]')
      const count = Number((pill?.textContent || '').match(/\d+/)?.[0] ?? 0)
      return figure?.getAttribute('data-sha256') === expected && count > before
    },
    { expected: EXPECTED, before: snapsBefore },
    { timeout: 15_000 },
  ).catch(() => {})
  const hash = await figure.getAttribute('data-sha256')
  check((await image.count()) === 1, 'clipboard image renders inside the document')
  check(hash === EXPECTED, 'image node binds the exact byte SHA-256', `${hash?.slice(0, 12) ?? 'none'}…`)
  check((await figure.getAttribute('data-x-pct')) === '0', 'new images are left-aligned by default')
  check((await figure.getAttribute('data-caption-position')) === 'bottom', 'the title starts underneath the image')
  check(/^\d{4}-\d{2}-\d{2}T/.test(await figure.getAttribute('data-added-at') || ''), 'the pasted image carries an automatic timestamp')
  const titleStyle = await figure.locator('.iw-media-image__title').evaluate((element) => {
    const style = getComputedStyle(element)
    return { family: style.fontFamily, italic: style.fontStyle }
  })
  const bodyFamily = await editor.evaluate((element) => getComputedStyle(element).fontFamily)
  check(titleStyle.family === bodyFamily && titleStyle.italic === 'italic', 'the title inherits the writing font and defaults to italics')
  check(/^Added: \d{1,2}:\d{2}/.test((await figure.locator('.iw-media-image__meta').textContent() || '').trim()), 'the caption shows only the 12-hour time added')
  const captionSizes = await figure.evaluate((element) => ({
    title: getComputedStyle(element.querySelector('.iw-media-image__title')).fontSize,
    meta: getComputedStyle(element.querySelector('.iw-media-image__meta')).fontSize,
    body: getComputedStyle(element.closest('.ProseMirror')).fontSize,
  }))
  check(captionSizes.title === captionSizes.meta, 'title, date and source icon share one caption size', JSON.stringify(captionSizes))
  check(Math.abs((parseFloat(captionSizes.body) - parseFloat(captionSizes.title)) - (2 * 96 / 72)) < 0.35,
    'the caption is exactly 2pt smaller than the surrounding body', JSON.stringify(captionSizes))
  check((await figure.locator('.iw-media-image__source').getAttribute('title')) === 'Add image source', 'an empty source icon has a hoverable prompt')
  check((await figure.locator('.iw-media-image__source-icon').count()) === 1, 'source is a compact link icon rather than a text label')
  const captionPositions = await figure.evaluate((element) => {
    const caption = element.querySelector('.iw-media-image__caption').getBoundingClientRect()
    const title = element.querySelector('.iw-media-image__title').getBoundingClientRect()
    const tail = element.querySelector('.iw-media-image__caption-tail').getBoundingClientRect()
    const source = element.querySelector('.iw-media-image__source').getBoundingClientRect()
    return {
      sourceRightGap: Math.abs(caption.right - source.right),
      titleLeftGap: Math.abs(caption.left - title.left),
      tailRightGap: Math.abs(caption.right - tail.right),
      twoRows: tail.top >= title.bottom - 1,
    }
  })
  check(captionPositions.sourceRightGap < 3 && captionPositions.tailRightGap < 3,
    'Added, time and source icon are bound to the caption’s lower-right corner')
  check(captionPositions.titleLeftGap < 3 && captionPositions.twoRows,
    'the title is bound to the caption’s upper-left corner')
  check((await snapshotCount()) === snapsBefore + 1, 'one paste creates one ordinary global snapshot', `${snapsBefore} → ${await snapshotCount()}`)

  const readLatestSnapshot = async (targetPage) => {
    const bytes = await targetPage.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory()
    const docs = await root.getDirectoryHandle('documents')
    const dir = await docs.getDirectoryHandle(id)
    const file = await (await dir.getFileHandle('snapshots.json')).getFile()
    return [...new Uint8Array(await file.arrayBuffer())]
  }, documentId)
    const archive = Buffer.from(bytes)
    const text = archive[0] === 0x1f ? gunzipSync(archive).toString('utf8') : archive.toString('utf8')
    const snapshots = JSON.parse(text)
    const latest = snapshots[snapshots.length - 1]
    let media = null
    const visit = (node) => {
      if (node?.type === 'mediaImage') media = node.attrs
      for (const child of node?.content || []) visit(child)
    }
    visit(latest?.contentJson)
    return latest && { media, bundleHash: latest.bundleHash, ots: latest.ots }
  }
  await figure.locator('.iw-media-image__source').click()
  const panel = page.getByRole('dialog', { name: 'Image details' })
  await panel.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  check((await panel.count()) === 1, 'clicking the source icon opens its editing panel')
  check((await panel.getByRole('combobox', { name: 'Reference in this document' }).count()) === 1, 'the source panel offers this document’s references')
  check((await panel.getByRole('button', { name: 'Add new reference' }).count()) === 1, 'the source panel can add a new reference')
  check(!/Date added/i.test(await panel.textContent().catch(() => '') || ''), 'date added stays automatic and out of the popup')
  await panel.getByRole('button', { name: 'Add new reference' }).click()
  const newReference = page.getByRole('dialog', { name: 'Edit citation' })
  await newReference.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {})
  check((await newReference.count()) === 1, 'Add new reference opens the document citation editor directly')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await figure.locator('.iw-media-image__source').click()
  await panel.waitFor({ state: 'visible', timeout: 3_000 })
  await panel.getByRole('textbox', { name: 'Web address or description' }).fill('https://example.com/evidence')
  await panel.getByRole('button', { name: 'Move title to top' }).click()
  check((await figure.getAttribute('data-caption-position')) === 'top', 'the panel moves the title above the image')
  check((await panel.locator('a.iw-media-image__open-source').getAttribute('href')) === 'https://example.com/evidence', 'a webpage source remains navigable from the popup')
  await page.keyboard.press('Escape')

  await figure.locator('.iw-media-image__title').click()
  const inlineTitle = figure.getByRole('textbox', { name: 'Image title' })
  await inlineTitle.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {})
  check((await inlineTitle.count()) === 1, 'one click edits the title inline with a text cursor')
  await inlineTitle.fill('Evidence image')
  await page.keyboard.press('Enter')

  await figure.click({ button: 'right' })
  const rightClickOutline = await figure.locator('.iw-media-image__picture').evaluate((element) => getComputedStyle(element).outlineStyle)
  check(rightClickOutline === 'none', 'right-click opens image details without outlining the picture')
  await page.keyboard.press('Escape')

  const widthHandle = figure.locator('.iw-media-image__resize--width')
  const widthBox = await widthHandle.boundingBox()
  const fullPictureBox = await figure.locator('.iw-media-image__picture').boundingBox()
  const widthCursor = await widthHandle.evaluate((element) => getComputedStyle(element).cursor)
  const pictureCursor = await figure.locator('.iw-media-image__picture').evaluate((element) => getComputedStyle(element).cursor)
  const outline = await figure.locator('.iw-media-image__picture').evaluate((element) => {
    const figure = element.closest('.iw-media-image')
    figure?.classList.add('ProseMirror-selectednode')
    const value = getComputedStyle(element).outlineColor
    figure?.classList.remove('ProseMirror-selectednode')
    return value
  })
  check(pictureCursor === 'default', 'the picture has no hand cursor until it is being dragged')
  check(outline !== 'rgb(0, 0, 0)', 'the selected picture outline is themed indigo rather than black', outline)
  check(!!widthBox && !!fullPictureBox &&
    Math.abs((widthBox.x + widthBox.width / 2) - (fullPictureBox.x + fullPictureBox.width)) < 1 &&
    widthBox.x < fullPictureBox.x + fullPictureBox.width && widthBox.x + widthBox.width > fullPictureBox.x + fullPictureBox.width &&
    widthCursor === 'ew-resize',
  'the right-edge cursor target spans equally inside and outside a flush-right picture')
  if (widthBox) {
    await widthHandle.dispatchEvent('pointerdown', { pointerId: 1, clientX: widthBox.x, clientY: widthBox.y, button: 0 })
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x - 120, clientY: y }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x - 120, clientY: y }))
    }, { x: widthBox.x, y: widthBox.y })
  }
  await page.waitForFunction(() => Number(document.querySelector('.iw-media-image')?.getAttribute('data-width-pct')) < 100, null, { timeout: 2_000 }).catch(() => {})
  const shrunkWidth = Number(await figure.getAttribute('data-width-pct'))
  check(shrunkWidth < 100, 'the right edge resizes image width', String(shrunkWidth))

  const picture = figure.locator('.iw-media-image__picture')
  const moveBox = await picture.boundingBox()
  if (moveBox) {
    await picture.dispatchEvent('pointerdown', { pointerId: 2, clientX: moveBox.x + moveBox.width / 2, clientY: moveBox.y + moveBox.height / 2, button: 0 })
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: x + 60, clientY: y }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: x + 60, clientY: y }))
    }, { x: moveBox.x + moveBox.width / 2, y: moveBox.y + moveBox.height / 2 })
  }
  const movedX = Number(await figure.getAttribute('data-x-pct'))
  check(movedX > 0, 'dragging anywhere on the picture changes horizontal position only', String(movedX))

  const heightHandle = figure.locator('.iw-media-image__resize--height')
  const heightBox = await heightHandle.boundingBox()
  if (heightBox) {
    await heightHandle.dispatchEvent('pointerdown', { pointerId: 3, clientX: heightBox.x, clientY: heightBox.y, button: 0 })
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: x, clientY: y + 50 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientX: x, clientY: y + 50 }))
    }, { x: heightBox.x, y: heightBox.y })
  }
  const resizedHeight = Number(await figure.getAttribute('data-height-px'))
  check(resizedHeight > 0, 'the bottom edge resizes image height', String(resizedHeight))

  const corner = figure.locator('.iw-media-image__resize--both')
  const pictureBeforeCorner = await picture.boundingBox()
  const cornerBox = await corner.boundingBox()
  if (cornerBox && pictureBeforeCorner) {
    check(Math.abs((cornerBox.x + cornerBox.width / 2) - (pictureBeforeCorner.x + pictureBeforeCorner.width)) < 1 &&
      Math.abs((cornerBox.y + cornerBox.height / 2) - (pictureBeforeCorner.y + pictureBeforeCorner.height)) < 1,
    'the corner hit-zone is anchored to the picture, not the caption')
    await corner.dispatchEvent('pointerdown', { pointerId: 4, clientX: cornerBox.x, clientY: cornerBox.y, button: 0 })
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, clientX: x + 40, clientY: y + 3 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientX: x + 40, clientY: y + 3 }))
    }, { x: cornerBox.x, y: cornerBox.y })
  }
  const pictureAfterCorner = await picture.boundingBox()
  const ratioBefore = pictureBeforeCorner ? pictureBeforeCorner.width / pictureBeforeCorner.height : 0
  const ratioAfter = pictureAfterCorner ? pictureAfterCorner.width / pictureAfterCorner.height : 0
  check(ratioBefore > 0 && Math.abs(ratioBefore - ratioAfter) < 0.03, 'corner resizing preserves image proportions', `${ratioBefore.toFixed(3)} → ${ratioAfter.toFixed(3)}`)

  const leftCorner = figure.locator('.iw-media-image__resize--both-left')
  const leftCornerBox = await leftCorner.boundingBox()
  const pictureBeforeLeft = await picture.boundingBox()
  if (leftCornerBox && pictureBeforeLeft) {
    await leftCorner.dispatchEvent('pointerdown', { pointerId: 5, clientX: leftCornerBox.x, clientY: leftCornerBox.y, button: 0 })
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: x + 20, clientY: y }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, clientX: x + 20, clientY: y }))
    }, { x: leftCornerBox.x, y: leftCornerBox.y })
  }
  const pictureAfterLeft = await picture.boundingBox()
  check(!!pictureBeforeLeft && !!pictureAfterLeft &&
    Math.abs((pictureBeforeLeft.x + pictureBeforeLeft.width) - (pictureAfterLeft.x + pictureAfterLeft.width)) < 1 &&
    Math.abs(pictureBeforeLeft.width / pictureBeforeLeft.height - pictureAfterLeft.width / pictureAfterLeft.height) < 0.03,
  'bottom-left proportional resize keeps the right edge anchored')
  const finalWidth = Number(await figure.getAttribute('data-width-pct'))
  const finalHeight = Number(await figure.getAttribute('data-height-px'))
  const finalX = Number(await figure.getAttribute('data-x-pct'))
  check((await snapshotCount()) === snapsBefore + 1, 'moving and resizing do not create snapshots')

  await page.waitForTimeout(1_500) // autosave beat
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditor()
  const restored = page.locator('.iw-media-image img')
  await restored.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  check((await restored.count()) === 1, 'pasted image survives a hard reload')
  check((await page.locator('.iw-media-image').first().getAttribute('data-sha256')) === EXPECTED,
    'the byte binding survives reload')
  const restoredFigure = page.locator('.iw-media-image').first()
  check(Number(await restoredFigure.getAttribute('data-width-pct')) === finalWidth && Number(await restoredFigure.getAttribute('data-x-pct')) === finalX,
    'horizontal size and position survive reload')
  check(Number(await restoredFigure.getAttribute('data-height-px')) === finalHeight, 'explicit image height survives reload')
  check((await restoredFigure.getAttribute('data-caption-position')) === 'top', 'caption placement survives reload')

  // Inspect OPFS from a same-origin inert HTML response. React deliberately normalises editor/page
  // URLs and can replace their browsing realms; this page has no app runtime, giving the archive
  // read a stable realm without changing the storage origin or acquiring a second document lease.
  const archivePage = await context.newPage()
  await archivePage.route('**/__imagepaste-opfs.html', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>OPFS probe</title>',
  }))
  await archivePage.goto(`${base}/__imagepaste-opfs.html`, { waitUntil: 'load' })
  const snap = await readLatestSnapshot(archivePage).catch((error) => ({ error: String(error) }))
  await archivePage.close()
  check(!!snap && !snap.error && snap.media?.sha256 === EXPECTED, 'the snapshot freezes the image hash and metadata', snap?.error || '')
  check(snap?.ots?.status === 'pending', 'the image snapshot reaches timestamp-pending state', JSON.stringify(snap?.ots))
  check(submitted.some((item) => item.action === 'stamp' && item.bundleHash === snap?.bundleHash), 'the snapshot bundle hash reaches the timestamp relay')
} catch (error) {
  if (error instanceof VoidRun) {
    console.log(`  ∅ VOID — ${error.message}; this run proves nothing about image paste`)
    voided++
  } else {
  const state = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    loading: document.querySelector('.iw-loading-tip')?.textContent ?? null,
    editor: !!document.querySelector('.ProseMirror[contenteditable="true"]'),
    waterReady: document.documentElement.classList.contains('iw-water-ready'),
    body: document.body.innerText.slice(0, 300),
  })).catch(() => null)
  console.log(`  ✗ probe crashed — ${error instanceof Error ? error.message : String(error)}`)
  if (state) console.log(`    state ${JSON.stringify(state)}`)
  failed++
  }
} finally {
  await browser.close()
  await stop()
}

console.log(voided ? `\nVOID (${voided})` : failed ? `\nFAIL (${failed})` : '\nPASS')
process.exitCode = failed ? 1 : voided ? 2 : 0
