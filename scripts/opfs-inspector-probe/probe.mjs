// OPFS INSPECTOR PROBE — does the recovery surface actually recover an ORPHANED document?
//
// THE CASE THAT MATTERS (Peter lost real work to it, 2026-07-17): a document whose file is intact
// in OPFS but which NO tab will ever show again, because the IndexedDB meta index doesn't list it.
// The inspector's whole claim is that it can see and recover exactly that document. So this probe
// seeds one — `documents/<uuid>/current.json` written directly, with NO meta entry — and drives
// the real built app to prove:
//   1. the inspector LISTS it and badges it "not in the index"
//   2. "Open" RECOVERS it — the editor comes back showing its text
//   3. both themes render the panel distinctly (a night panel that stays white is the bug the
//      iw-nightable rule exists to prevent)
//
// SYNTHETIC CONTENT ONLY. The seeded text is "ALPHA BRAVO CHARLIE …" — Peter's real writing never
// enters a fixture, a log, or a screenshot (thesis-integrity rule).
//
// Run: node scripts/opfs-inspector-probe/probe.mjs   (headless; own port; exits non-zero on failure)

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PORT = 5231 // NOT 5219 — another agent owns that one
const BASE = `http://127.0.0.1:${PORT}`

const SEED_TEXT = 'ALPHA BRAVO CHARLIE the orphaned reading list survived in storage DELTA ECHO'
const ORPHAN_ID = '11111111-2222-4333-8444-555555555555'

const fails = []
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(name)
}

// ─── static server (the scrub-probe one: SPA fallback + production-like CSP) ───
const server = spawn('node', [join(ROOT, 'scripts', 'scrub-probe', 'server.mjs'), join(ROOT, 'build', 'client'), String(PORT)], { stdio: 'inherit' })
const bound = await (async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return true } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  return false
})()
// ASSERT THE PORT IS OURS: a probe that silently drives someone else's server (or nothing at all)
// measures a fiction. Bail loudly instead.
if (!bound) { console.error(`FATAL: nothing bound on ${PORT} — build/client missing, or the port is taken`); server.kill(); process.exit(1) }
console.log(`server bound on ${PORT}`)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', e.message))

try {
  // ── 1. boot the editor once, so the origin + OPFS exist ──────────────────────
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })

  // ── 2. seed an ORPHANED document straight into OPFS, with NO meta index entry ─
  const seeded = await page.evaluate(async ({ id, text }) => {
    const root = await navigator.storage.getDirectory()
    const docs = await root.getDirectoryHandle('documents', { create: true })
    const dir = await docs.getDirectoryHandle(id, { create: true })
    const fh = await dir.getFileHandle('current.json', { create: true })
    const now = new Date().toISOString()
    const doc = {
      id, title: 'Orphaned reading list',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      createdAt: now, updatedAt: now, schemaVersion: '0.1.0',
      scasLimitN: 'infinite', scasSessionSeed: 'probe-seed',
    }
    const w = await fh.createWritable()
    await w.write(JSON.stringify(doc))
    await w.close()
    // Deliberately NO upsertMeta — that absence IS the orphan condition.
    return (await (await fh.getFile()).text()).length
  }, { id: ORPHAN_ID, text: SEED_TEXT })
  check(seeded > 0, 'seeded an orphaned document into OPFS', `${seeded} bytes, no meta entry`)

  // Prove the orphan really is invisible to the index — the premise of the whole panel.
  const inIndex = await page.evaluate(async (id) => {
    const req = indexedDB.open('inkwave', 1)
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    if (!db.objectStoreNames.contains('documents')) return false
    const all = await new Promise((res) => { const r = db.transaction('documents').objectStore('documents').getAll(); r.onsuccess = () => res(r.result) })
    return all.some(m => m.id === id)
  }, ORPHAN_ID).catch(() => false)
  check(inIndex === false, 'the seeded document is NOT in the IndexedDB index (it is a true orphan)')

  // ── 3. open the hamburger (⋮) → Storage ──────────────────────────────────────
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.click('button[aria-label="Options"]')
  const storageItem = page.locator('[role="menuitem"]', { hasText: 'Storage' })
  check(await storageItem.count() > 0, 'the hamburger menu has a "Storage" item')
  await storageItem.first().click()

  const panel = page.locator('[role="dialog"][aria-label="Documents on this device"]')
  await panel.waitFor({ timeout: 10000 })
  check(await panel.count() > 0, 'the inspector panel opens')

  // ── 4. THE TEST THAT MATTERS: is the orphan listed, and badged? ───────────────
  const row = page.locator(`[data-testid="opfs-row"][data-doc-id="${ORPHAN_ID}"]`)
  await row.waitFor({ timeout: 10000 }).catch(() => {})
  check(await row.count() === 1, 'the inspector LISTS the orphaned document')
  const rowText = (await row.count()) ? await row.innerText() : ''
  check(/not in the index/i.test(rowText), 'the orphan row is badged "not in the index"')
  check(rowText.includes('ALPHA BRAVO CHARLIE'), 'the row previews the document text, so a writer can recognise it')
  check(/Orphaned reading list/.test(rowText), 'the row shows the title')
  check(/\bwords\b/.test(rowText) && /\bB\b|KB|MB/.test(rowText), 'the row shows a word count and a size on disk')
  check(!/delete/i.test(rowText), 'the row offers NO delete action')

  // ── 5. theming: both themes must render the panel distinctly ──────────────────
  const bgOf = () => panel.evaluate(el => getComputedStyle(el).backgroundColor)
  const dayBg = await bgOf()
  await page.screenshot({ path: '/tmp/opfsinsp-day-a1.png' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'))
  await page.waitForTimeout(120)
  const nightBg = await bgOf()
  await page.screenshot({ path: '/tmp/opfsinsp-night-a1.png' })
  check(dayBg !== nightBg, 'the panel themes: day bg differs from night bg', `${dayBg} → ${nightBg}`)
  // A night panel that stays white is precisely the iw-nightable failure — assert it went DARK,
  // not merely that it changed.
  const lum = (c) => { const m = c.match(/\d+/g); return m ? (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) : 255 }
  check(lum(nightBg) < 140, 'the night panel is actually dark (not white-on-white)', `luminance ${lum(nightBg).toFixed(0)}`)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))

  // ── 6. RECOVERY: does "Open" actually bring the words back? ───────────────────
  await row.locator('[data-testid="opfs-open"]').click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Documents on this device"]'), { timeout: 15000 }).catch(() => {})
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForFunction(
    (t) => document.querySelector('.ProseMirror')?.innerText.includes(t),
    'ALPHA BRAVO CHARLIE',
    { timeout: 15000 },
  ).catch(() => {})
  const editorText = await page.locator('.ProseMirror').first().innerText()
  check(editorText.includes('ALPHA BRAVO CHARLIE'), 'OPEN RECOVERS THE DOCUMENT — the editor shows the orphan\'s text')
  const tabId = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'))
  check(tabId === ORPHAN_ID, 'the tab claimed the recovered document as its own identity', String(tabId))
  const urlDoc = await page.evaluate(() => new URL(location.href).searchParams.get('doc'))
  check(urlDoc === ORPHAN_ID, 'the URL reflects the recovered document')
} finally {
  await browser.close()
  server.kill()
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed')
process.exit(fails.length ? 1 : 0)
