// TAB DOCUMENT IDENTITY — the data-loss reproduction, and the proof of its fix.
//
// Peter, 2026-07-17: "1 separate tabs don't appear to remember that they are supposed to be working
// on different documents and 2 as a result, if you create a new document but forget to sync it up,
// refreshing the page can bring up the opfs from the synced document on another tab and overwrite
// your progress." ... "parallelised OPFS so this can't happen: a different opfs never saves over
// the current tab, even if you leave to go to microsofts page or whatever to log in"
//
// TWO MECHANISMS, both reproduced here as REAL LOSS before they were fixed:
//   1. `inkwave:activeDocumentId` was ONE localStorage slot for the whole ORIGIN. Every tab wrote
//      it; every tab read it on boot. Tab B's document switch silently re-pointed tab A, and tab A
//      adopted B's document on its next reload — stranding A's own work on disk, intact but
//      unreachable by any tab. (Fix: per-tab sessionStorage identity — src/storage/tabDoc.ts.)
//   2. `saveDocument` writes the WHOLE document file with no union, no generation check and no
//      lock. Two tabs on one document autosave over each other and one tab's words are destroyed.
//      A new tab reached that state by doing nothing — it inherited the shared pointer.
//      (Fix: one live tab per document, via Web Locks — same module.)
//
// TWO REAL TABS IN ONE BrowserContext — a context shares localStorage AND OPFS, exactly like two
// tabs of one browser profile. No shims: the real build, the real UI, the real storage. A unit test
// cannot see any of this; it is a cross-context race.
//
// THE CONTROL IS THE POINT. Every cell runs TWICE in ONE BUILD:
//   CONTROL (`window.__iwTabDocRule = 'shared'`) restores the pre-fix rule and MUST LOSE DATA.
//   FIXED   (the flag absent) MUST NOT.
// A cell that passes under FIXED proves nothing unless the same cell FAILED under CONTROL — that is
// what tells "the fix works" apart from "the probe cannot see the bug". The script exits nonzero if
// the control fails to reproduce the loss, so this negative cannot quietly stop firing.
//
// Usage: node scripts/tabdoc-probe/repro.mjs --engine=chromium|firefox [--port=5219]

import { chromium, firefox } from '@playwright/test'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]
const ENGINE = arg('engine', 'chromium')
const PORT = Number(arg('port', '5219'))
const BASE = `http://localhost:${PORT}`
// ⚠ `.ProseMirror` ALONE MATCHES THE ANTI-FLASH SHELL (CLAUDE.md, round 14): a load transiently
// carries TWO — the real editor (contenteditable=true) and an aria-hidden facsimile removed by ~3s.
// waitForSelector resolves the FIRST match and defaults to state:'visible', so it waited forever on
// the hidden shell while the real editor was up. 2026-08-28: this probe timed out for exactly that
// reason and read as a regression in the tab-identity fix.
const EDITOR = '.ProseMirror[contenteditable="true"]'

async function waitEditor(page) {
  await page.waitForSelector(EDITOR, { timeout: 120000 }) // generous: several agents share this box and CPU starvation must not masquerade as a failed mount
  await page.waitForTimeout(1200) // the editor reveals behind a wave choreography
}

async function typeInto(page, text) {
  await page.click(EDITOR)
  await page.keyboard.type(text, { delay: 12 })
  await page.waitForTimeout(1500) // autosave is a trailing 200ms debounce + the write
}

const bodyText = (page) => page.$eval(EDITOR, (el) => el.textContent.replace(/\s+/g, ' ').trim())
const tabPointer = (page) => page.evaluate(() =>
  sessionStorage.getItem('inkwave:tabDocumentId') || localStorage.getItem('inkwave:activeDocumentId'))

// Every word this device holds, across EVERY document in OPFS. The invariant "no tab's work is
// destroyed" must be asked of STORAGE — not of a tab's UI, and not of one file we guessed at. This
// deliberately does not care HOW the words were kept (same file, a separate document, a fork): a
// probe that assumes the fix's mechanism only proves the mechanism ran, not that the work lived.
async function allOpfsText(page) {
  return page.evaluate(async () => {
    const out = []
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents')
      for await (const id of docs.keys()) {
        try {
          const dir = await docs.getDirectoryHandle(id)
          const fh = await dir.getFileHandle('current.json')
          const doc = JSON.parse(await (await fh.getFile()).text())
          const walk = (n) => (n.text || '') + (n.content || []).map(walk).join(' ')
          out.push({ id, text: walk(doc.contentJson).replace(/\s+/g, ' ').trim() })
        } catch { /* not a document dir */ }
      }
    } catch { /* no OPFS */ }
    return out
  })
}

async function opfsDoc(page, id) {
  const all = await allOpfsText(page)
  return all.find((d) => d.id === id) ?? null
}

async function newDocument(page) {
  await page.keyboard.press('Control+n') // the real OptionsMenu path: create → claim → reload
  await page.waitForTimeout(2500)
  await waitEditor(page)
}

// ── one full scenario, under one rule ────────────────────────────────────────
async function runScenario(browser, legacy) {
  const ctx = await browser.newContext()
  if (legacy) {
    // Restore the pre-fix rule BEFORE any app script runs. This is the known-negative.
    await ctx.addInitScript(() => { window.__iwTabDocRule = 'shared' })
  }
  const cells = []
  const add = (cell, name, pass, detail) => cells.push({ cell, name, pass, detail })

  // setup: tab A on its own document, with real words in it
  const A = await ctx.newPage()
  await A.goto(BASE, { waitUntil: 'domcontentloaded' })
  await waitEditor(A)
  await typeInto(A, 'ALPHA')
  const docA = await tabPointer(A)

  // TRACE THE SETUP — a scenario whose setup silently no-opped proves nothing either way.
  const aBody = await bodyText(A)
  if (!aBody.includes('ALPHA')) throw new Error(`SETUP BROKEN: tab A's editor lacks its own text ("${aBody}")`)
  const aDisk = await opfsDoc(A, docA)
  if (!aDisk?.text.includes('ALPHA')) throw new Error(`SETUP BROKEN: tab A's words never reached OPFS (${docA})`)

  // tab B: a second tab, then a NEW document in it (Peter's exact story)
  const B = await ctx.newPage()
  await B.goto(BASE, { waitUntil: 'domcontentloaded' })
  await waitEditor(B)
  const bInherited = await tabPointer(B)
  await newDocument(B)
  await typeInto(B, 'BRAVO')
  const docB = await tabPointer(B)
  if (docB === docA) throw new Error('SETUP BROKEN: "New" did not create a distinct document')

  // ── CELL A — IDENTITY. Tab A did nothing wrong; it just reloads. ────────────
  await A.reload({ waitUntil: 'domcontentloaded' })
  await waitEditor(A)
  const aAfter = await bodyText(A)
  add('A', 'tab A still shows ITS OWN document after a reload',
    aAfter.includes('ALPHA') && !aAfter.includes('BRAVO'),
    `tab A was on ${docA} ("ALPHA"); after reload it shows "${aAfter.slice(0, 40)}" (pointer ${await tabPointer(A)})`)

  // ── CELL B — CLOBBER. Two tabs wanting ONE document. ───────────────────────
  // The premise is forced explicitly, never inherited from cell A: once per-tab identity works the
  // two tabs are on DIFFERENT files, so "docA lacks tab B's words" becomes trivially true and the
  // cell would score a pass while testing nothing. (It did exactly that on the first fixed run.)
  // The contested file is whatever tab A is ACTUALLY editing right now — which is not docA under
  // the control, because cell A has already re-pointed tab A to B's document. Reading it live keeps
  // this cell meaningful under BOTH rules instead of asserting a premise only the fix can satisfy.
  const contested = await tabPointer(A)
  const B2 = await ctx.newPage()
  await B2.goto(`${BASE}/?doc=${contested}`, { waitUntil: 'domcontentloaded' }) // explicitly ask for it
  await waitEditor(B2)
  // Tab A must still be editing the contested document, or nothing is contested. Tab B2 is
  // deliberately NOT required to land on it: refusing to put a second tab on a live document is a
  // legitimate way to keep both writers' words, and demanding "both tabs on one file" would forbid
  // the fix while pretending to test it.
  const aStill = await tabPointer(A)
  if (aStill !== contested) throw new Error(`CELL B VOID: tab A stopped holding the contested document (${aStill} != ${contested})`)
  const b2Doc = await tabPointer(B2)
  await typeInto(A, ' FROM-TAB-A')
  await typeInto(B2, ' FROM-TAB-B')
  await A.waitForTimeout(1500)
  const all = await allOpfsText(A)
  const joined = all.map((d) => d.text).join(' | ')
  const aLived = joined.includes('FROM-TAB-A')
  const bLived = joined.includes('FROM-TAB-B')
  add('B', "two tabs wanting one document never destroy each other's words",
    aLived && bLived,
    `tab B2 asked for ${contested} and landed on ${b2Doc === contested ? "THE SAME FILE" : "a document of its own"}; ` +
    `across ${all.length} documents in OPFS: ` +
    (aLived && bLived ? 'both survived'
      : !aLived && !bLived ? "BOTH tabs' words were DESTROYED"
      : !aLived ? "tab A's words were DESTROYED" : "tab B's words were DESTROYED"))

  // ── CELL C — THE OAUTH ROUND-TRIP. ─────────────────────────────────────────
  // OneDrive sign-in is msal.loginRedirect with redirectUri = window.location.origin: a FULL-PAGE
  // navigation off-origin that returns to a BARE `/`, so any doc id in the query string is GONE on
  // return. Simulated exactly — leave the origin, come back to `/`. (No real Microsoft round-trip:
  // the identity question is about our own tab, and Peter's thesis must never touch a test.)
  const C = await ctx.newPage()
  await C.goto(BASE, { waitUntil: 'domcontentloaded' })
  await waitEditor(C)
  await newDocument(C)
  await typeInto(C, 'CHARLIE-UNSYNCED')
  const docC = await tabPointer(C)
  await B.bringToFront() // meanwhile another tab moves the shared pointer away
  await newDocument(B)
  await typeInto(B, 'DELTA')
  await C.goto('about:blank', { waitUntil: 'domcontentloaded' })
  await C.waitForTimeout(300)
  await C.goto(BASE, { waitUntil: 'domcontentloaded' }) // MSAL returns to origin — no query string
  await waitEditor(C)
  const cAfter = await bodyText(C)
  add('C', 'a tab returning from an OAuth redirect is still on ITS OWN document',
    cAfter.includes('CHARLIE-UNSYNCED'),
    `tab C was on ${docC} ("CHARLIE-UNSYNCED"); after away-and-back it shows "${cAfter.slice(0, 40)}"`)

  const orphan = await opfsDoc(C, docC)
  const note = `a fresh tab B booted onto ${bInherited === docA ? "TAB A's OWN DOCUMENT" : 'a document of its own'}; ` +
    `tab C's document ${orphan ? 'still exists on disk' : 'IS GONE'}`

  await ctx.close()
  return { cells, note }
}

async function main() {
  const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch()
  console.log(`\n=== TAB DOCUMENT IDENTITY — ${ENGINE} ===`)

  console.log(`\n--- CONTROL (window.__iwTabDocRule='shared' — the pre-fix rule; MUST lose data) ---`)
  const control = await runScenario(browser, true)
  for (const c of control.cells) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.cell}  ${c.name}\n        ${c.detail}`)
  console.log(`  note: ${control.note}`)

  console.log(`\n--- FIXED (per-tab identity + one live tab per document; MUST NOT lose data) ---`)
  const fixed = await runScenario(browser, false)
  for (const c of fixed.cells) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.cell}  ${c.name}\n        ${c.detail}`)
  console.log(`  note: ${fixed.note}`)

  await browser.close()

  // ── verdict ────────────────────────────────────────────────────────────────
  const controlLost = control.cells.filter((c) => !c.pass).map((c) => c.cell)
  const fixedLost = fixed.cells.filter((c) => !c.pass).map((c) => c.cell)

  console.log('\n=== VERDICT ===')
  console.log(`  control reproduced loss in: ${controlLost.join(', ') || 'NOTHING'}`)
  console.log(`  fixed still loses data in:  ${fixedLost.join(', ') || 'nothing'}`)

  // THE NEGATIVE MUST FIRE. If the pre-fix rule kept every writer's words, this probe is not
  // watching the bug and its green cells below mean nothing.
  if (controlLost.length !== control.cells.length) {
    const missed = control.cells.filter((c) => c.pass).map((c) => c.cell)
    console.error(`\n✗ THE PROBE IS BLIND: the CONTROL was supposed to lose data in every cell but ` +
      `${missed.join(', ')} passed under the pre-fix rule.\n  A negative that cannot fail is not a ` +
      `negative — fix the probe before trusting any verdict here.`)
    process.exit(2)
  }
  if (fixedLost.length) {
    console.error(`\n✗ NOT FIXED on ${ENGINE}: ${fixedLost.join(', ')} still destroy a writer's words.`)
    process.exit(1)
  }
  console.log(`\n✓ ${ENGINE}: the control reproduces the loss in all ${control.cells.length} cells; ` +
    `the fix holds in all ${fixed.cells.length}.`)
  process.exit(0)
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(3) })
