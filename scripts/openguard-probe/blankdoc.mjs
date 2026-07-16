// THE SWALLOWED READ — 2026-07-15 11:19:40, reproduced, and its guard proved.
//
// WHAT HAPPENED (forensics, on Peter's real machine): `storage/opfs.ts`'s `readJson` ended
// `catch { return null }`, so a TRANSIENT READ FAILURE was indistinguishable from "no such
// document". Edit.tsx answers null by falling through — loadDocument → listMeta → **newDocument()**
// — and repoints the active-doc pointer at the blank. It produced doc `978e0772`: createdAt ==
// updatedAt, 0 chars, created and never typed into. Peter reloaded and his honours proposal was
// simply gone.
//
// WHY THIS CELL MATTERS MORE THAN IT LOOKS: the blank page is not a cosmetic failure. Eleven
// minutes later he opened a `.studio` backup to recover FROM the blank, got the stale twin, and
// that blind-overwrote Wednesday's annotations. **The read bug caused the open that triggered the
// write bug.** Fix only the write and a user who hits this still lands on a blank page and still
// reaches for a backup.
//
// THE FAILURE IS INJECTED, not simulated at a distance: `getFileHandle` is patched to throw a
// non-NotFound DOMException for `current.json` — the exact shape of a transient failure, which is
// precisely the case the old code could not tell from absence.
//
// CONTROL (`window.__iwReadGuard='off'`, the pre-fix swallow) MUST produce the blank document and
// move the pointer. FIXED must not. Exits nonzero if the control fails to reproduce it.
//
// Usage: node scripts/openguard-probe/blankdoc.mjs [--port=5219] [--engine=chromium|firefox]

import { chromium, firefox } from '@playwright/test'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]
const PORT = Number(arg('port', '5219'))
const ENGINE = arg('engine', 'chromium')
const BASE = `http://localhost:${PORT}`
const EDITOR = '.ProseMirror'

const pointer = (page) => page.evaluate(() =>
  sessionStorage.getItem('inkwave:tabDocumentId') || localStorage.getItem('inkwave:activeDocumentId'))

async function opfsIds(page) {
  return page.evaluate(async () => {
    const out = []
    try {
      const docs = await (await navigator.storage.getDirectory()).getDirectoryHandle('documents')
      for await (const id of docs.keys()) out.push(id)
    } catch { /* none */ }
    return out
  })
}

// Fail EVERY read of current.json with a transient error — the shape the old code mistook for
// absence. Installed before any app script runs, so the boot read is the one that hits it.
const FAIL_READS = () => {
  const proto = FileSystemDirectoryHandle.prototype
  const real = proto.getFileHandle
  proto.getFileHandle = function (name, opts) {
    if (name === 'current.json' && !(opts && opts.create)) {
      return Promise.reject(new DOMException('simulated transient read failure', 'InvalidStateError'))
    }
    return real.call(this, name, opts)
  }
}

async function runScenario(browser, legacyRead) {
  const ctx = await browser.newContext()
  if (legacyRead) await ctx.addInitScript(() => { window.__iwReadGuard = 'off' })
  const page = await ctx.newPage()

  // ── 1. a real document, with real words, saved to OPFS ────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 120000 })
  await page.waitForTimeout(1200)
  await page.click(EDITOR)
  await page.keyboard.type('THE THESIS', { delay: 15 })
  await page.waitForTimeout(2000)
  const realId = await pointer(page)
  const idsBefore = await opfsIds(page)
  if (!idsBefore.includes(realId)) throw new Error(`SETUP BROKEN: the document never reached OPFS (${realId})`)

  // ── 2. reload into a transient read failure ───────────────────────────────
  await ctx.addInitScript(FAIL_READS)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000) // let init() run to whatever conclusion it reaches

  const pointerAfter = await pointer(page)
  const idsAfter = await opfsIds(page)
  const movedPointer = pointerAfter !== realId
  const minted = idsAfter.length > idsBefore.length
  // Did the writer get an editable BLANK page — the thing that tells them their thesis is gone?
  const hasEditor = (await page.$(EDITOR)) !== null
  const shown = hasEditor ? (await page.$eval(EDITOR, (el) => el.textContent.trim())) : '(no editor)'
  const blankPage = hasEditor && shown.length === 0
  const bodyText = (await page.$eval('body', (el) => el.innerText)).replace(/\s+/g, ' ').trim()

  await ctx.close()
  return {
    movedPointer, minted, blankPage, shown, pointerAfter, realId,
    docs: idsAfter.length, before: idsBefore.length,
    saidSomething: /still here|couldn|Storage/i.test(bodyText),
    detail: `pointer ${movedPointer ? `MOVED ${realId} → ${pointerAfter}` : 'unchanged'}; ` +
      `documents ${idsBefore.length} → ${idsAfter.length}${minted ? ' (A BLANK ONE WAS MINTED)' : ''}; ` +
      `the writer sees ${blankPage ? 'AN EMPTY EDITOR' : hasEditor ? `"${shown.slice(0, 30)}"` : 'no editor'}`,
  }
}

async function main() {
  const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch()
  console.log(`\n=== SWALLOWED READ → BLANK DOCUMENT — ${ENGINE} ===`)
  console.log(`    a transient read failure must never look like "you have no documents"\n`)

  console.log(`--- CONTROL (window.__iwReadGuard='off' — the pre-fix swallow; MUST blank the page) ---`)
  const control = await runScenario(browser, true)
  console.log(`  ${control.blankPage || control.minted ? 'REPRODUCED' : 'did not reproduce'}\n        ${control.detail}`)

  console.log(`\n--- FIXED (a read failure is not an absence; MUST NOT blank or mint) ---`)
  const fixed = await runScenario(browser, false)
  console.log(`  ${!fixed.blankPage && !fixed.minted && !fixed.movedPointer ? 'HELD' : 'FAILED'}\n        ${fixed.detail}`)
  console.log(`        recovery surface shown to the writer: ${fixed.saidSomething ? 'yes' : 'NO'}`)

  await browser.close()

  console.log('\n=== VERDICT ===')
  // THE NEGATIVE MUST FIRE.
  if (!control.blankPage && !control.minted) {
    console.error(`\n✗ THE PROBE IS BLIND: the CONTROL was supposed to produce a blank document and did not.\n` +
      `  Either the injected failure never reached the read path, or the seam is not restoring the\n` +
      `  old behaviour. A negative that cannot fail is not a negative — do not read the cell below.`)
    process.exit(2)
  }
  console.log(`  control: a transient read failure produced ${control.minted ? 'a freshly minted blank document' : 'a blank page'}` +
    `${control.movedPointer ? ' and moved the active-doc pointer to it' : ''} — the 11:19:40 failure, reproduced`)

  const held = !fixed.blankPage && !fixed.minted && !fixed.movedPointer
  if (!held) {
    console.error(`\n✗ NOT FIXED on ${ENGINE}: ${fixed.detail}`)
    process.exit(1)
  }
  if (!fixed.saidSomething) {
    console.error(`\n✗ NOT FIXED on ${ENGINE}: nothing was minted, but the writer was told nothing either —\n` +
      `  a silent dead end is still "your thesis is gone" as far as they can tell.`)
    process.exit(1)
  }
  console.log(`  fixed:   no blank document, no new document, pointer untouched, and the writer is told\n` +
    `           what happened with Storage one click away`)
  console.log(`\n✓ ${ENGINE}: a failed read no longer masquerades as an empty device.`)
  process.exit(0)
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(3) })
