// NEW TAB → BLANK. HARD REFRESH → THE SAME DOCUMENT. TWO TABS → NEVER THE SAME ONE.
// Peter, 2026-08-28: "when I open a new tab it always keeps reverting to this one thing Honours
// Proposal … what we need is for new tabs to open as blank and to make sure multiple tabs on
// different docs never overlap if hard refreshed."
// ONE BrowserContext = one browser profile: shared localStorage, shared OPFS, per-tab sessionStorage.
import { chromium } from '@playwright/test'
import { startProbeServer } from '../textrender-probe/serve.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext()
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

/** Wait for an editor — but report the BLOCKED screen by name. A bare timeout reads as flakiness,
 *  and on the pre-fix build this is not flakiness: the new tab had already grabbed the document, so
 *  the tab that legitimately wanted it is told "open in another window". That IS the bug. */
async function waitEditor(p, what) {
  const r = await Promise.race([
    p.waitForSelector(EDITOR, { timeout: 60000 }).then(() => 'editor').catch(() => 'timeout'),
    p.waitForFunction(() => /open in another window/i.test(document.body.innerText), null, { timeout: 60000 })
      .then(() => 'blocked').catch(() => 'timeout'),
  ])
  if (r !== 'editor') throw new Error(`${what}: expected an editor, got ${r === 'blocked' ? 'THE BLOCKED SCREEN (another tab holds this document)' : 'nothing (timeout)'}`)
}

const open = async () => {
  const p = await ctx.newPage()
  await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await waitEditor(p, 'new tab')
  await p.waitForTimeout(2500)
  return p
}
const docOf = (p) => p.evaluate(() => new URL(location.href).searchParams.get('doc'))
const textOf = (p) => p.evaluate((s) => document.querySelector(s)?.innerText.trim() ?? '', EDITOR)
const type = async (p, t) => { await p.click(EDITOR); await p.keyboard.type(t); await p.waitForTimeout(1400) }

try {
  // Duplicating an untouched default document used to show the three-way collision warning. There
  // is no writing to protect in that special case: the duplicate should silently become its own
  // blank document, while the original blank keeps its own id and lock.
  const blankA = await open()
  const blankAId = await docOf(blankA)
  const blankB = await ctx.newPage()
  await blankB.goto(`${base}/?doc=${blankAId}`, { waitUntil: 'domcontentloaded' })
  await waitEditor(blankB, 'duplicate of untouched Untitled')
  const blankBId = await docOf(blankB)
  check(blankBId !== blankAId, 'duplicating untouched Untitled opens a fresh blank without the warning', `A=${blankAId} B=${blankBId}`)
  check((await textOf(blankB)) === '', 'the replacement document is blank')
  await blankA.close(); await blankB.close()
  await new Promise((r) => setTimeout(r, 800))

  // Tab A writes something.
  const A = await open()
  await type(A, 'ALPHA-DOCUMENT')
  const idA = await docOf(A)
  check(!!idA, 'tab A has a document', idA ?? '')

  // Its title is still the default "Untitled", but it now contains writing. Title alone must
  // never bypass the lock: a second explicit open gets the safety screen as before.
  const guarded = await ctx.newPage()
  await guarded.goto(`${base}/?doc=${idA}`, { waitUntil: 'domcontentloaded' })
  const guardedResult = await Promise.race([
    guarded.waitForFunction(() => /open in another window/i.test(document.body.innerText), null, { timeout: 60000 })
      .then(() => 'blocked').catch(() => 'timeout'),
    guarded.waitForSelector(EDITOR, { timeout: 60000 }).then(() => 'editor').catch(() => 'timeout'),
  ])
  check(guardedResult === 'blocked', 'written-but-Untitled still gets the collision warning', guardedResult)
  await guarded.close()

  // ⚠ CLOSE TAB A FIRST. The first cut of this probe kept it open, and the one-live-tab LOCK then
  // prevented the collision by itself — so the pre-fix build passed every cell and the probe proved
  // nothing. Peter's actual case is a new tab with no other tab holding the document: nothing is
  // locked, and the last-document hint (and the storage walk behind it) answer freely.
  await A.close()
  await new Promise((r) => setTimeout(r, 800))   // let the lock release

  // A BRAND-NEW TAB must be blank — not the last document, not the most recent one on disk.
  const B = await open()
  const idB = await docOf(B)
  const textB = await textOf(B)
  check(idB !== idA, 'a new tab does NOT reopen the last document', `B=${idB}`)
  check(!textB.includes('ALPHA'), 'a new tab is BLANK even with ALPHA sitting unlocked on disk', JSON.stringify(textB.slice(0, 40)))

  await type(B, 'BRAVO-DOCUMENT')

  // HARD REFRESH keeps each tab on its own. (A was closed above; reopen it by its own ?doc= link,
  // which is what a bookmark or the Storage panel gives you, then refresh THAT.)
  const A2 = await ctx.newPage()
  await A2.goto(`${base}/?doc=${idA}`, { waitUntil: 'domcontentloaded' })
  await waitEditor(A2, 'reopening ALPHA by ?doc='); await A2.waitForTimeout(2500)
  await A2.reload({ waitUntil: 'domcontentloaded' }); await waitEditor(A2, 'ALPHA after refresh'); await A2.waitForTimeout(2500)
  await B.reload({ waitUntil: 'domcontentloaded' }); await waitEditor(B, 'BRAVO after refresh'); await B.waitForTimeout(2500)
  const tA = await textOf(A2), tB = await textOf(B)
  check(tA.includes('ALPHA') && !tA.includes('BRAVO'), 'after a hard refresh tab A still shows ALPHA', JSON.stringify(tA.slice(0, 30)))
  check(tB.includes('BRAVO') && !tB.includes('ALPHA'), 'after a hard refresh tab B still shows BRAVO', JSON.stringify(tB.slice(0, 30)))
  check((await docOf(A2)) === idA && (await docOf(B)) === idB, 'neither tab changed document across the refresh')

  // A third new tab is STILL blank, with two documents sitting in storage.
  const C = await open()
  const tC = await textOf(C)
  check(!tC.includes('ALPHA') && !tC.includes('BRAVO'), 'a third new tab is blank too, with 2 documents on disk', JSON.stringify(tC.slice(0, 30)))
  // The documents are still THERE — blank must mean "not chosen", never "gone".
  const onDisk = await C.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('documents', { create: false })
    let n = 0
    // @ts-ignore
    for await (const _ of dir.keys()) n++
    return n
  })
  check(onDisk >= 3, 'every document is still in storage — blank means not chosen, not deleted', `${onDisk} on disk`)
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  fail++
} finally { await b.close(); await stop() }
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
