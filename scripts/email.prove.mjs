// EMAIL LAYER LIVE PROBE (2026-07-17) — drives the REAL app in a REAL browser.
//
// The module tests (src/email/roundtrip.test.ts) prove the hashing/anchor/verify path with the real
// production functions. They cannot prove the WIRING: that the flag gates the panel, that the panel
// renders, that “Snapshot this draft” reaches the spine, that a header edit actually PERSISTS. Those
// are exactly the joints where this codebase has historically shipped a feature that was silently
// off. So: real build, real browser, real OPFS, real click.
//
// The OTS relay is intercepted (the prod static server has no /api) — which is also how we assert
// WHICH digest the browser submits. Everything up to that boundary is production code.
//
// Run: node scripts/email.prove.mjs [port]   (headless; nothing appears on Peter's screen)
import { chromium } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CLIENT = join(ROOT, 'build/client')
const port = Number(process.argv[2] || 7931)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' }

// Fallback-faithful static server: unknown paths → the SPA fallback, exactly like the deployed
// rewrite. Serving the prerendered index for a route would hydrate the wrong page.
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = join(CLIENT, url)
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) file = join(CLIENT, 'index.html')
  const body = readFileSync(file)
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(body)
})
await new Promise((r) => server.listen(port, r))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const submitted = []
const results = []
const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); }

// Intercept the OTS relay — captures the digest the REAL client submits.
await page.route('**/api/ots', async (route) => {
  try { submitted.push(JSON.parse(route.request().postData() || '{}')) } catch { /* noop */ }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', proofBase64: 'AA==' }) })
})

page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

// ── 1. The flag is OFF by default ───────────────────────────────────────────
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
const offPanel = await page.locator('input[aria-label="To"]').count()
ok('flag OFF by default → no compose panel', offPanel === 0, `panel count ${offPanel}`)

// ── 2. Turn it on; create an email through the real menu ─────────────────────
await page.goto(`http://localhost:${port}/?email=1`, { waitUntil: 'load' })
await page.waitForTimeout(2500)

const flagOn = await page.evaluate(() => localStorage.getItem('inkwave:email'))
ok('?email=1 sets the sticky flag', flagOn === '1', `stored ${flagOn}`)

// Drive the real OptionsMenu → "+ New email".
const menu = page.locator('button[aria-label="Options"]').first()
ok('the Options menu trigger exists', (await menu.count()) > 0)
if (await menu.count()) { await menu.click(); await page.waitForTimeout(600) }
const newEmail = page.getByText('New email', { exact: true })
const foundNewEmail = await newEmail.count()
ok('"New email" appears in the Options menu when the flag is on', foundNewEmail > 0)
if (foundNewEmail) { await newEmail.click() }

// ── 3. The panel renders, with the honesty copy ──────────────────────────────
// WAIT FOR THE CONDITION, never a fixed duration: a waitForTimeout(3500) raced React's render here
// and made the copy checks flake between runs (the panel's input existed a beat before its copy
// paragraphs). A probe that intermittently reads an unrendered page is an instrument that cannot be
// trusted when it matters — the same class as reading an overlay mid-burst.
const toField = page.locator('input[aria-label="To"]')
await toField.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
await page.getByText(/existed by this date and time/i).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
// (the explainer's wording is asserted below; this only waits for the panel's copy to exist)
const hasPanel = await toField.count()
ok('the compose panel renders for a docType:email document', hasPanel > 0)

// The copy assertions are only READABLE if the panel actually rendered. "No forbidden claim" on a
// page with no copy is a pass that means nothing — the same vacuity as auditing a gapped DOM for
// mid-line breaks (CLAUDE.md). A metric that collects nothing must VOID, never read as zero.
// The long explanation intentionally lives in a collapsed <details> after W1. `innerText` excludes
// closed details in Chromium, so it would accuse present copy of being absent. This check asks
// whether the disclosure is in the product; a separate assertion keeps its visible summary.
const bodyText = hasPanel ? await page.locator('body').textContent() : ''
if (!hasPanel) {
  results.push(['VOID', 'copy checks — no panel rendered, nothing to read', ''])
} else {
  ok('the detailed honesty boundary has a visible disclosure control',
    (await page.getByText('How recording and sending work', { exact: true }).count()) === 1)
  ok('copy states the real claim ("existed by")', /existed by/i.test(bodyText))
  ok('copy states the limit ("does not prove")', /does not prove/i.test(bodyText))
  ok('copy denies E2E ("not end-to-end encrypted")', /not end-to-end encrypted/i.test(bodyText))
  ok('copy makes NO proof-of-sending claim', !/proof that you sent|proves you sent/i.test(bodyText))
}

// ── 4. Fill headers + body, and prove the headers PERSIST across a reload ────
if (hasPanel) {
  await toField.fill('ada@example.com')
  await page.locator('input[aria-label="Subject"]').fill('Re: the proposal')
  await page.waitForTimeout(300)
  await page.locator('.ProseMirror').first().click()
  await page.keyboard.type('Dear Ada, the draft is ready.')
  await page.waitForTimeout(1500)

  const saveStatus = await page.locator('.iw-email-draft-save-status').textContent().catch(() => '')
  ok('automatic draft save reports its local acknowledgement', /Saved locally just now/i.test(saveStatus || ''), saveStatus || '')
  ok('local autosave is not mislabeled as Gmail sync', !/synced/i.test(saveStatus || ''), saveStatus || '')

  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(3000)
  const toAfter = await page.locator('input[aria-label="To"]').inputValue().catch(() => '')
  const subAfter = await page.locator('input[aria-label="Subject"]').inputValue().catch(() => '')
  ok('headers PERSIST across a reload', toAfter === 'ada@example.com' && subAfter === 'Re: the proposal', `to="${toAfter}" subject="${subAfter}"`)
}

// ── 5. Finalise → the spine. Assert the SUBMITTED digest is the v:3 bundleHash ─
submitted.length = 0
const recordBtn = page.getByRole('button', { name: /Snapshot this draft/i })
if (await recordBtn.count()) {
  await recordBtn.click()
  await page.waitForTimeout(3000)
}

const snap = await page.evaluate(async () => {
  const id = localStorage.getItem('inkwave:activeDocumentId')
  const root = await navigator.storage.getDirectory()
  const docs = await root.getDirectoryHandle('documents')
  const dir = await docs.getDirectoryHandle(id)
  const f = await (await dir.getFileHandle('snapshots.json')).getFile()
  const buf = await f.arrayBuffer()
  const gz = new Uint8Array(buf)[0] === 0x1f
  let text
  if (gz) {
    const ds = new DecompressionStream('gzip'); const w = ds.writable.getWriter()
    w.write(new Uint8Array(buf)); w.close()
    text = await new Response(ds.readable).text()
  } else text = new TextDecoder().decode(buf)
  const arr = JSON.parse(text)
  const s = arr[arr.length - 1]
  return s && { email: s.email, emailHash: s.emailHash, bundleHash: s.bundleHash, contentHash: s.contentHash, ots: s.ots }
}).catch((e) => ({ error: String(e) }))

ok('finalise created a snapshot', !!snap && !snap.error, snap?.error || '')
if (snap && !snap.error) {
  ok('the snapshot FROZE the canonicalised headers', snap.email?.to?.[0] === 'ada@example.com' && snap.email?.subject === 'Re: the proposal', JSON.stringify(snap.email))
  ok('the snapshot carries an emailHash', /^[0-9a-f]{64}$/.test(snap.emailHash || ''), snap.emailHash)
  ok('OTS submitted the v:3 bundleHash (NOT the contentHash)',
    submitted.some((s) => s.action === 'stamp' && s.bundleHash === snap.bundleHash) &&
    !submitted.some((s) => s.bundleHash === snap.contentHash),
    `submitted=${JSON.stringify(submitted.map((s) => s.bundleHash?.slice(0, 12)))} bundle=${snap.bundleHash?.slice(0, 12)} content=${snap.contentHash?.slice(0, 12)}`)
  ok('the snapshot reached OTS pending', snap.ots?.status === 'pending', JSON.stringify(snap.ots))
}

// ── 6. The handoff URL is built from the live draft ──────────────────────────
const openBtn = page.getByRole('button', { name: /Open in provider/i })
let handoffUrl = null
if (await openBtn.count()) {
  await openBtn.click(); await page.waitForTimeout(300)
  const gmail = page.getByRole('button', { name: 'Gmail', exact: true })
  if (await gmail.count()) {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 4000 }).catch(() => null),
      gmail.click(),
    ])
    if (popup) { handoffUrl = popup.url(); await popup.close().catch(() => {}) }
  }
}
// Gmail bounces an unauthenticated compose link through accounts.google.com with the real URL in
// `continue=`, and the encoding depth varies — so decode until stable, then assert the payload.
let decoded = String(handoffUrl || '')
for (let i = 0; i < 4; i++) { const d = decodeURIComponent(decoded); if (d === decoded) break; decoded = d }
// Query-encoding renders spaces as '+', so normalise before matching human text.
const flat = decoded.replace(/\+/g, ' ')
ok('"Open in provider" → a pre-filled Gmail compose URL',
  !!handoffUrl && flat.includes('mail.google.com/mail/') && flat.includes('view=cm') && flat.includes('ada@example.com') && flat.includes('Re: the proposal') && flat.includes('Dear Ada'),
  flat.slice(0, 150))

// ── 7. Duplicate as new → preserve the message, replace the identity ─────────
const originalId = await page.evaluate(() => localStorage.getItem('inkwave:activeDocumentId'))
const duplicateBtn = page.getByRole('button', { name: 'Duplicate as new email' })
ok('the duplicate-as-new action is available', (await duplicateBtn.count()) === 1)
if (await duplicateBtn.count()) {
  await duplicateBtn.click()
  await page.waitForFunction(
    (id) => localStorage.getItem('inkwave:activeDocumentId') !== id,
    originalId,
    { timeout: 20000 },
  ).catch(() => {})
  await page.locator('input[aria-label="To"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
}

const duplicated = await page.evaluate(async (sourceId) => {
  const copyId = localStorage.getItem('inkwave:activeDocumentId')
  const root = await navigator.storage.getDirectory()
  const docs = await root.getDirectoryHandle('documents')
  const read = async (id) => {
    const dir = await docs.getDirectoryHandle(id)
    return JSON.parse(await (await dir.getFileHandle('current.json')).getFile().then((f) => f.text()))
  }
  return { sourceId, copyId, source: await read(sourceId), copy: await read(copyId) }
}, originalId).catch((e) => ({ error: String(e) }))

ok('duplicate-as-new mints a different document identity',
  duplicated && !duplicated.error && duplicated.copyId && duplicated.copyId !== duplicated.sourceId,
  duplicated?.error || `${duplicated?.sourceId} → ${duplicated?.copyId}`)
if (duplicated && !duplicated.error) {
  ok('duplicate-as-new preserves headers and body',
    JSON.stringify(duplicated.copy.email) === JSON.stringify(duplicated.source.email) &&
    JSON.stringify(duplicated.copy.contentJson) === JSON.stringify(duplicated.source.contentJson))
  ok('duplicate-as-new starts a fresh provenance identity',
    !duplicated.copy.scasReceipts &&
    duplicated.copy.scasSeedRef === duplicated.copy.scasSessionSeed &&
    duplicated.copy.scasSeedRef !== duplicated.source.scasSeedRef)
}

// ── report ──────────────────────────────────────────────────────────────────
console.log('\n─── EMAIL LAYER LIVE PROBE ───')
for (const [st, name, detail] of results) console.log(` ${st === 'PASS' ? '✓' : st === 'VOID' ? '∅' : '✗'} ${st}  ${name}${detail ? `  — ${detail}` : ''}`)
const failed = results.filter((r) => r[0] === 'FAIL').length
const voided = results.filter((r) => r[0] === 'VOID').length
if (voided) console.log(`   check(s) VOIDED — unreadable, not passed`)
console.log(`\n${results.length - failed}/${results.length} passed\n`)

await browser.close()
server.close()
process.exit(failed ? 1 : 0)
