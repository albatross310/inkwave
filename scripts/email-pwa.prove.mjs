// FRESH WEBKIT/PWA EMAIL AVAILABILITY PROOF (2026-09-07).
//
// Safari installed web apps may start with a storage partition that has never seen `?email=1`.
// This probe deliberately supplies NO flag and NO seeded localStorage, then drives the production
// build in WebKit through Options → New email and a reload. It is the regression for "emails do not
// work at all in the PWA", not a generic Chromium compose test.
//
// Run: node scripts/email-pwa.prove.mjs [port]

import { webkit } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { installOpfsBrowserShim } from './lib/opfsBrowserShim.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'build/client')
const port = Number(process.argv[2] || 7932)
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
}

if (!existsSync(join(CLIENT, 'index.html'))) {
  console.log('\nINCONCLUSIVE — production build is absent; run `npm run build` first.\n')
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
    server.listen(port, resolve)
  })
} catch (error) {
  console.log(`\nINCONCLUSIVE — proof server could not listen on ${port}: ${error.message}\n`)
  process.exit(2)
}

let browser
try {
  browser = await webkit.launch({ headless: true })
} catch (error) {
  server.close()
  console.log(`\nINCONCLUSIVE — Playwright WebKit could not launch: ${error.message}\n`)
  process.exit(2)
}
const context = await browser.newContext()
await installOpfsBrowserShim(context)
const page = await context.newPage()
const failures = []
const check = (name, condition, detail = '') => {
  console.log(` ${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(name)
}
page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))

console.log('\n─── WEBKIT FRESH-PWA EMAIL PROBE ───')
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__iwEditorLoadReady === true, null, { timeout: 20000 }).catch(() => {})
await page.evaluate(() => window.dispatchEvent(new Event('inkwave:continue-load')))
check('fresh storage contains no legacy email opt-in', await page.evaluate(() => localStorage.getItem('inkwave:email')) === null)
// A document-reading preference must not silently enlarge a newly created email.
await page.evaluate(() => localStorage.setItem('inkwave:editorZoom', '1.5'))

const options = page.locator('button[aria-label="Options"]').first()
await options.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
check('Options is available', await options.count() === 1)
if (await options.count()) await options.click()

const create = page.getByText('New email', { exact: true })
check('New email is present without ?email=1', await create.count() === 1)
if (await create.count()) await create.click()

const placement = page.getByRole('dialog', { name: 'Choose documents for new email' })
await placement.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
check('new email asks for explicit document memberships', await placement.count() === 1)
check('the Email manifest is visibly always included', await placement.getByText(/Always included/).count() === 1)
const startEmail = placement.getByRole('button', { name: 'Start email' })
if (await startEmail.count()) await startEmail.click()

const to = page.locator('input[aria-label="To"]')
await to.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
check('the WebKit compose surface opens', await to.count() === 1)
check('the ordinary StyleBar is visible inside the email', await page.getByLabel('Email text formatting').count() === 1)
const emailStyleBar = page.getByLabel('Email text formatting')
const emailStyleControlCount = await emailStyleBar.locator('button').count()
check('the email StyleBar carries every ordinary control group', emailStyleControlCount >= 8, String(emailStyleControlCount))
check('the email StyleBar reports the 12pt default', await emailStyleBar.locator('[title^="Font size"]').textContent() === '12')
check('the attachment picker is visible inside the email', await page.locator('[data-iw-email-attach]').count() === 1)
check('the email exposes both display scales', await page.getByRole('button', { name: 'Reset email text zoom to 100%' }).textContent() === 'Text 100% · Fit 100%')
const emailPresentation = await page.evaluate(() => {
  const body = document.querySelector('.iw-email-message-body .ProseMirror')
  const surface = document.querySelector('.iw-application-surface')
  if (!body || !surface) return null
  return {
    fontSize: getComputedStyle(body).fontSize,
    transform: getComputedStyle(surface).transform,
    nativeFit: surface.classList.contains('iw-application-surface--native-fit'),
  }
})
check('email starts at native 16px / 100% rather than inheriting document zoom', emailPresentation?.fontSize === '16px', emailPresentation?.fontSize ?? 'missing')
check('email window fit reflows without a raster-scale transform', emailPresentation?.nativeFit === true && emailPresentation?.transform === 'none')
const writingAssistance = await page.evaluate(() => {
  const body = document.querySelector('.iw-email-message-body .ProseMirror')
  return body ? {
    spellcheck: body.getAttribute('spellcheck'),
    autocomplete: body.getAttribute('autocomplete'),
    autocorrect: body.getAttribute('autocorrect'),
    writingSuggestions: body.getAttribute('writingsuggestions'),
  } : null
})
check('WebKit native prediction cannot paint a ghost suffix beyond the real caret',
  !!writingAssistance
    && writingAssistance.spellcheck === 'false'
    && writingAssistance.autocomplete === 'off'
    && writingAssistance.autocorrect === 'off'
    && writingAssistance.writingSuggestions === 'false',
  JSON.stringify(writingAssistance))

await page.evaluate(() => {
  const surface = document.querySelector('.inkwave-editor-surface')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }))
  surface?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
  surface?.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, metaKey: true, bubbles: true, cancelable: true }))
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', bubbles: true }))
})
const zoomStatus = page.getByRole('button', { name: 'Reset email text zoom to 100%' })
await page.waitForFunction(() => document.querySelector('[aria-label="Reset email text zoom to 100%"]')?.textContent !== 'Text 100% · Fit 100%', null, { timeout: 3000 }).catch(() => {})
check('email text zoom is visible rather than confused with font size', await zoomStatus.textContent() !== 'Text 100% · Fit 100%', await zoomStatus.textContent() ?? '')
await zoomStatus.click()
await page.waitForFunction(() => document.querySelector('[aria-label="Reset email text zoom to 100%"]')?.textContent === 'Text 100% · Fit 100%', null, { timeout: 4000 }).catch(() => {})
check('the percentage control resets email text zoom to 100%', await zoomStatus.textContent() === 'Text 100% · Fit 100%')

await page.locator('.iw-email-attachments input[type="file"]').setInputFiles({
  name: 'proof-note.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('attached from the WebKit proof'),
})
await page.getByText('proof-note.txt', { exact: true }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
check('a real attachment is stored and listed', await page.getByText('proof-note.txt', { exact: true }).count() === 1)
await page.waitForTimeout(500)

await page.reload({ waitUntil: 'load' })
await to.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
check('the email document remains an email after PWA-style reload', await to.count() === 1)
check('the attachment reference survives reload', await page.getByText('proof-note.txt', { exact: true }).count() === 1)

// WebKit resolves caret paint at the text's inline containing element. Exercise the two transparent
// paint shapes the real editor can create at a word boundary; a root-only caret declaration passes
// ordinary tests while these descendants quietly fall back to transparent/auto in Safari PWA.
const caretPaint = await page.evaluate(() => {
  const editor = document.querySelector('.iw-email-message-body .ProseMirror')
  const paragraph = editor?.querySelector('p')
  if (!editor || !paragraph) return null
  const focused = document.createElement('span')
  focused.className = 'scas-red scas-focused'
  focused.setAttribute('style', 'display:inline-block;color:transparent')
  focused.textContent = 'word'
  const insertion = document.createElement('ins')
  insertion.className = 'iw-ins'
  insertion.setAttribute('style', '-webkit-text-fill-color:transparent;color:#e03a26')
  insertion.textContent = 'change'
  paragraph.replaceChildren(focused, document.createTextNode(' '), insertion)
  const range = document.createRange()
  range.setStart(focused.firstChild, 0)
  range.collapse(true)
  const selection = getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return {
    root: getComputedStyle(editor).caretColor,
    focused: getComputedStyle(focused).caretColor,
    focusedPosition: getComputedStyle(focused).position,
    insertion: getComputedStyle(insertion).caretColor,
    selectionCollapsed: selection?.isCollapsed ?? false,
  }
})
check('WebKit email caret keeps explicit ink on ordinary and transparent inline hosts',
  !!caretPaint && caretPaint.selectionCollapsed
    && caretPaint.root !== 'auto' && caretPaint.root !== 'transparent'
    && caretPaint.focused === caretPaint.root && caretPaint.insertion === caretPaint.root,
  JSON.stringify(caretPaint))
check('the focused SCAS insertion host avoids WebKit position-relative caret paint',
  caretPaint?.focusedPosition === 'static', caretPaint?.focusedPosition ?? 'missing')

await browser.close()
server.close()
console.log(`\n${failures.length ? `FAIL — ${failures.join('; ')}` : 'PASS'}\n`)
process.exit(failures.length ? 1 : 0)
