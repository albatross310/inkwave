// THE BLIND-OVERWRITE INCIDENT — 2026-07-15 11:30:18, reproduced, and its guard proved.
//
// WHAT HAPPENED (forensics, on Peter's real machine): he opened a STALE `.studio` export and it
// replaced his current honours-proposal content in OPFS. The stale export (saved 07-10, carrying
// 07-08 content) and the `current.json` written at that instant hash byte-identically. A day of
// annotations to his reading list — Wednesday 15 July — are in no surviving copy.
//
// PETER'S OWN STATEMENT OF THE SEQUENCE, which is the script below verbatim:
//   "one can open a document, edit it, close it, open it in the opfs, make more changes, then open
//    the old one they still haven't synced, overwriting their changes in the opfs"
//
// THE MECHANISM: `openDoc.ts` takes the `id` FROM THE FILE, stamps `createdAt/updatedAt: now`, and
// calls `saveDocument(doc)` — an unconditional whole-file replace. Its SNAPSHOTS were already
// protected by the grow-only union (`restoreSnapshotsFromBundle`); the document BODY was not. That
// asymmetry is the bug.
//
// THE CONTROL IS THE POINT. Both cells run in ONE BUILD:
//   CONTROL (`window.__iwOpenGuard = 'off'`) restores the pre-fix behaviour and MUST DESTROY the
//           newer work. If it does not, this probe is not watching the bug.
//   FIXED   (the flag absent) MUST keep it.
// Exits nonzero if the control fails to reproduce the destruction.
//
// THESIS INTEGRITY: all content here is synthetic. Peter's writing never enters a fixture, and the
// work this bug destroyed is exactly the reason that rule exists.
//
// Usage: node scripts/openguard-probe/repro.mjs [--port=5219] [--engine=chromium|firefox]

import { chromium, firefox } from '@playwright/test'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]
const PORT = Number(arg('port', '5219'))
const ENGINE = arg('engine', 'chromium')
const BASE = `http://localhost:${PORT}`
const EDITOR = '.ProseMirror'

// Unique per run — an agent tonight read "1136 tests" off a log another agent had clobbered.
const WORK = join(tmpdir(), `iw-openguard-${process.pid}-${Date.now()}`)

async function waitEditor(page) {
  await page.waitForSelector(EDITOR, { timeout: 120000 })
  await page.waitForTimeout(1200)
}

async function typeInto(page, text) {
  await page.click(EDITOR)
  await page.keyboard.press('End')
  await page.keyboard.type(text, { delay: 12 })
  await page.waitForTimeout(2200) // autosave (200ms trailing) + the deferred snapshot chain
}

const docText = (page) => page.$eval(EDITOR, (el) => el.textContent.replace(/\s+/g, ' ').trim())
const tabDoc = (page) => page.evaluate(() =>
  sessionStorage.getItem('inkwave:tabDocumentId') || localStorage.getItem('inkwave:activeDocumentId'))

// Read straight out of OPFS — the storage of record. The UI cannot vouch for itself.
async function opfsAll(page) {
  return page.evaluate(async () => {
    const out = []
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents')
      for await (const id of docs.keys()) {
        try {
          const dir = await docs.getDirectoryHandle(id)
          const doc = JSON.parse(await (await (await dir.getFileHandle('current.json')).getFile()).text())
          const walk = (n) => (n.text || '') + (n.content || []).map(walk).join(' ')
          out.push({ id, text: walk(doc.contentJson).replace(/\s+/g, ' ').trim() })
        } catch { /* not a document dir */ }
      }
    } catch { /* no OPFS */ }
    return out
  })
}

/** Build a real .studio bundle from what OPFS holds RIGHT NOW — this is the "old export". */
async function exportBundle(page, id) {
  return page.evaluate(async (docId) => {
    const root = await navigator.storage.getDirectory()
    const dir = await (await root.getDirectoryHandle('documents')).getDirectoryHandle(docId)
    const doc = JSON.parse(await (await (await dir.getFileHandle('current.json')).getFile()).text())
    // snapshots.json is GZIPPED (snapshots.ts writes it through CompressionStream; legacy files are
    // plain). Reading it as text and letting JSON.parse throw into a catch reported "0 snapshots"
    // while the archive was full — an instrument measuring a fiction and reading it as zero. Sniff
    // the magic bytes and gunzip, exactly as readSnapshotsFromDisk does.
    let snapshots = []
    let snapErr = null
    try {
      const buf = await (await (await dir.getFileHandle('snapshots.json')).getFile()).arrayBuffer()
      const gz = buf.byteLength > 1 && new Uint8Array(buf, 0, 2)[0] === 0x1f && new Uint8Array(buf, 0, 2)[1] === 0x8b
      const text = gz
        ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : new TextDecoder().decode(buf)
      const parsed = JSON.parse(text)
      snapshots = Array.isArray(parsed) ? parsed : (parsed.snapshots ?? [])
    } catch (e) { snapErr = String(e) } // reported, never silently zero
    // The shape openDoc.ts accepts: content under .document, plus the snapshot archive.
    return { document: doc, snapshots, receipts: doc.scasReceipts ?? [] }
  }, id)
}

async function openFile(page, path) {
  // Drive the REAL open path: the hidden file input the ⋮ menu's "Open…" clicks.
  await page.setInputFiles('input[type=file]', path)
  await page.waitForTimeout(4000)
}

async function runScenario(browser, guardOff) {
  const ctx = await browser.newContext({ acceptDownloads: true })
  if (guardOff) await ctx.addInitScript(() => { window.__iwOpenGuard = 'off' })
  const page = await ctx.newPage()

  // ── 1. open a document, edit it ───────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await waitEditor(page)
  // THREE short paragraphs, each completed with Enter. That is what the paragraph-snapshot trigger
  // actually requires: TiptapEditor buffers short paragraphs and only snapshots at >=70 words in one
  // paragraph OR 3 buffered ones. A single para + Enter merely buffers — which is why the first cut
  // of this probe accrued 0 snapshots and silently tested only the no-history path.
  await typeInto(page, 'ORIGINAL WORK alpha')
  await page.keyboard.press('Enter')
  await typeInto(page, 'ORIGINAL WORK bravo')
  await page.keyboard.press('Enter')
  await typeInto(page, 'ORIGINAL WORK charlie')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(4000) // runWhenQuiet(1500) + the snapshot chain (hash + gzip + OPFS)
  const id = await tabDoc(page)

  // ── 2. "close it" — this state is what the stale file on OneDrive holds ───
  const bundle = await exportBundle(page, id)
  await mkdir(WORK, { recursive: true })
  const stalePath = join(WORK, 'Proposal.studio')
  await writeFile(stalePath, JSON.stringify(bundle))

  // TRACE THE SETUP: the export must actually carry the OLD content, or the cell is void.
  const staleText = JSON.stringify(bundle.document.contentJson)
  if (!staleText.includes('ORIGINAL WORK')) throw new Error('SETUP BROKEN: the exported file does not contain the original text')
  if (staleText.includes('NEW ANNOTATIONS')) throw new Error('SETUP BROKEN: the export already contains the later work')

  // ── 3. "open it in the opfs, make more changes" — the work at risk ────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitEditor(page)
  await typeInto(page, 'NEW ANNOTATIONS')
  const before = await opfsAll(page)
  const liveBefore = before.find((d) => d.id === id)
  if (!liveBefore?.text.includes('NEW ANNOTATIONS')) {
    throw new Error(`SETUP BROKEN: the later work never reached OPFS — nothing to destroy (${JSON.stringify(liveBefore)})`)
  }
  if (!liveBefore.text.includes('ORIGINAL WORK')) throw new Error('SETUP BROKEN: the original text vanished before the open')

  // ── 4. "then open the old one they still haven't synced" ──────────────────
  await openFile(page, stalePath)

  // ── 5. the verdict: is the later work still on this device, anywhere? ─────
  const after = await opfsAll(page)
  const joined = after.map((d) => d.text).join(' | ')
  const survived = joined.includes('NEW ANNOTATIONS')
  const shown = await docText(page)
  const verdict = await page.evaluate(() => window.__iwLastOpenVerdict ?? '(none)')
  // THE MESSAGE THE WRITER ACTUALLY GETS. The guard's outcomes are good news ("nothing was
  // overwritten") and went out through the red ⚠ ERROR banner until this was checked — telling
  // someone their thesis is in trouble at the moment it was protected. Read the DOM, not the intent.
  const banner = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d =>
      /older copy|separate copy|SAVING IS FAILING|couldn/i.test(d.textContent || '') && d.className.includes('fixed top-0'))
    if (!el) return null
    const cs = getComputedStyle(el)
    return { text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90), bg: cs.backgroundColor, alarming: (el.textContent || '').includes('⚠') }
  })
  const snapshotCount = bundle.snapshots.length

  await ctx.close()
  return {
    survived, verdict, docs: after.length, snapshotCount, banner,
    detail: `verdict=${verdict}; the stale export carried ${snapshotCount} snapshot(s); ` +
      `OPFS holds ${after.length} document(s); "NEW ANNOTATIONS" ${survived ? 'SURVIVED' : 'WAS DESTROYED'}; ` +
      `the editor shows "${shown.slice(0, 45)}"` +
      (banner ? `\n        banner: ${banner.alarming ? '⚠ ALARMING' : 'calm ✓'} ${banner.bg} — "${banner.text}"` : '\n        banner: (none shown)'),
  }
}

async function main() {
  const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch()
  console.log(`\n=== BLIND-OVERWRITE ON OPEN — ${ENGINE} ===`)
  console.log(`    Peter's sequence: open → edit → close → reopen → edit more → open the stale file\n`)

  console.log(`--- CONTROL (window.__iwOpenGuard='off' — the pre-fix path; MUST destroy the newer work) ---`)
  const control = await runScenario(browser, true)
  console.log(`  ${control.survived ? 'PASS' : 'FAIL'}  the later work survives\n        ${control.detail}`)

  console.log(`\n--- FIXED (the ancestry guard; MUST keep it) ---`)
  const fixed = await runScenario(browser, false)
  console.log(`  ${fixed.survived ? 'PASS' : 'FAIL'}  the later work survives\n        ${fixed.detail}`)

  await browser.close()

  console.log('\n=== VERDICT ===')
  if (control.survived) {
    console.error(`\n✗ THE PROBE IS BLIND: the CONTROL was supposed to destroy the later work and it did not.\n` +
      `  Either the reproduction does not reproduce, or the seam is not disabling the guard.\n` +
      `  A negative that cannot fail is not a negative — do not read the cell below.`)
    process.exit(2)
  }
  console.log(`  control: the stale file DESTROYED the later work (the 2026-07-15 incident, reproduced)`)
  if (!fixed.survived) {
    console.error(`\n✗ NOT FIXED on ${ENGINE}: the stale file still destroys the writer's newer work.`)
    process.exit(1)
  }
  console.log(`  fixed:   the stale file did NOT destroy the later work`)
  console.log(`\n✓ ${ENGINE}: the incident reproduces on the old path and is prevented on the new one.`)
  process.exit(0)
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(3) })
