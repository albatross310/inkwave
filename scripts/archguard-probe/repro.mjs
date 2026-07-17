// THE SNAPSHOTS — a failed read of the archive must never truncate it. Real OPFS, real Chromium.
//
// THE FEATURE, IN PETER'S WORDS: "the snapshots" — the authorship trace, the Bitcoin-anchored proof
// he wrote his thesis himself. BLAST RADIUS: LIVE on master, no flag, on his real thesis.
//
// ─── WHAT THIS PROBE IS FOR ───────────────────────────────────────────────────────────────────────
// `readSnapshotsFromDisk` used to end `catch { return [] }` — so a transient OPFS fault, a corrupt
// gzip or a worker failure answered "this document has no history", and every consumer below
// read-then-writes the WHOLE array:
//
//     const snaps = await readSnapshotsFile(doc.id)          // ← [] on ANY failure
//     await writeSnapshotsFile(doc.id, [...snaps, snapshot]) // ← ONE snapshot over the archive
//
// Every OTS proof and signed receipt — gone. No race: one failed read did it.
//
// The fix (`isNotFound ⇒ []`, everything else throws; the write paths refuse) is pinned by unit
// tests on a shim OPFS (`archiveReadFail.test.ts`). THIS probe exists because a shim is not the
// thing: it drives the REAL archive through the REAL store, in REAL OPFS, in a REAL browser — the
// gzip, the off-thread gunzip worker, the write-through cache, the per-doc write chain, the React
// call sites — and destroys the archive in the SAME BUILD it then proves fixed.
//
// ─── THE DISCIPLINE: ARM THE INSTRUMENT BEFORE YOU TRUST IT ───────────────────────────────────────
// Every cell runs TWICE against one build: CONTROL (`window.__iwArchiveGuard='off'`, the pre-fix
// collapse restored) MUST destroy the archive, then FIXED must save it. If the control fails to
// reproduce, this exits 2 and REFUSES to read the fixed verdict — a probe that has only ever seen a
// fixed build proves nothing, and a green cell whose negative never fired is the house disease.
//
// THE FAULT IS INJECTED, NOT SIMULATED AT A DISTANCE: `getFileHandle` is patched to throw a
// non-NotFound DOMException for `snapshots.json` — the exact shape of a transient fault, which is
// precisely the case the old code could not tell from absence. The seam then decides what the read
// path MAKES of that fault. Fault and seam are different things and this probe needs both.
//
// ─── THE CELLS ────────────────────────────────────────────────────────────────────────────────────
//   1. THE APPEND     — "save version" on an unreadable archive. The primary vector.
//   2. THE SUMMARIES  — /snapshot's "↺ summaries" → clearAllSnapshotSummaries ([] → writes []).
//   3. THE OUTAGE     — a NEW document (no snapshots.json) must still get a BLANK archive and a
//                       working first save. An established emptiness is not a failed read, and a
//                       guard clamped shut is the same bug wearing the other hat.
//
// Cells 1 and 2 watch the LOSS direction; cell 3 watches the OUTAGE direction. Both are failures.
//
// Usage: node scripts/archguard-probe/repro.mjs [port]   (headless; needs `pnpm build` first)
//   Serves build/client on its OWN port and kills only its own PID (the shared-box rule).

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] ?? 4931)
const BASE = `http://127.0.0.1:${PORT}`
const EDITOR = '.ProseMirror'
const SNAP_PILL = '[title="Provenance record (held by you)"]'
const SAVE_BTN = '[title="Save a named version of this document now"]'

const server = spawn('npx', ['vite', 'preview', '--outDir', 'build/client', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore', detached: false,
})
const stopServer = () => { try { server.kill('SIGTERM') } catch { /* already gone */ } }
process.on('exit', stopServer)

/**
 * THE SHARED-BOX TRAP (ledger-wiring.prove.mjs's lesson, and six lanes share this box): if our port
 * is already held, `--strictPort` kills OUR server and every request silently lands on SOMEONE
 * ELSE'S Inkwave build — which types fine and has no seam, so the CONTROL would fail to reproduce
 * and this probe would confidently report "the probe is blind" about a working guard.
 *
 * So assert the port serves THIS worktree's build before reading anything. We look for the seam
 * string itself: it is the one token that is in this build and in no other agent's, which makes one
 * check answer both "is this our build?" and "did the seam survive the bundler?".
 */
async function assertServerIsOurs() {
  const dir = 'build/client/assets'
  const mine = readdirSync(dir).filter(
    (f) => f.endsWith('.js') && readFileSync(`${dir}/${f}`, 'utf8').includes('__iwArchiveGuard'),
  )
  if (mine.length !== 1) {
    throw new Error(`expected exactly ONE built chunk containing '__iwArchiveGuard', found ${mine.length} — run \`pnpm build\``)
  }
  let res = null
  for (let i = 0; i < 60; i++) {
    res = await fetch(`${BASE}/assets/${mine[0]}`).catch(() => null)
    if (res && res.ok) break
    await sleep(1000)
  }
  if (!res || !res.ok) {
    throw new Error(
      `port ${PORT} is NOT serving this worktree's build (${mine[0]} → ${res ? res.status : 'no response'}).\n` +
      `Another agent almost certainly holds the port. Re-run with a free one: node scripts/archguard-probe/repro.mjs <port>`,
    )
  }
  if (!(await res.text()).includes('__iwArchiveGuard')) throw new Error('served chunk lacks the seam — stale build?')
  console.log(`✓ server on ${PORT} is serving THIS worktree's build, seam present (${mine[0]})`)
}

// ── Reading the archive the way a forensic auditor would: OFF the app's code path ────────────────
// Deliberately NOT via the app's own reader. The app's reader is the thing under test, and asking a
// suspect to certify itself is how a probe ends up structurally incapable of seeing its own bug.
// This opens the real OPFS file and gunzips it with DecompressionStream, independently.
const diskArchive = (page, docId) => page.evaluate(async (id) => {
  try {
    const root = await navigator.storage.getDirectory()
    const docs = await root.getDirectoryHandle('documents')
    const dir = await docs.getDirectoryHandle(id)
    const file = await (await dir.getFileHandle('snapshots.json')).getFile()
    const buf = await file.arrayBuffer()
    const head = new Uint8Array(buf, 0, 2)
    const text = (head[0] === 0x1f && head[1] === 0x8b)
      ? await new Response(new Response(buf).body.pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(buf)
    const arr = JSON.parse(text)
    return { ok: true, n: arr.length, ids: arr.map((s) => s.id) }
  } catch (e) {
    return { ok: false, n: -1, ids: [], err: `${e.name}: ${e.message}` }
  }
}, docId)

const pointer = (page) => page.evaluate(() =>
  sessionStorage.getItem('inkwave:tabDocumentId') || localStorage.getItem('inkwave:activeDocumentId'))

// Fail EVERY read of snapshots.json with a transient (non-NotFound) error — the shape the old code
// mistook for absence. `create` opens are untouched: this is a READ fault, and letting the write
// path through is what makes the truncation observable rather than merely prevented by accident.
//
// THE FAULT IS TRANSIENT, AND `__iwProbeFault` IS WHY THIS PROBE CAN SEE ANYTHING AT ALL. The first
// cut patched `getFileHandle` unconditionally — which also blinded the probe's OWN forensic read,
// so every cell reported "could not read the archive off disk" and the FIXED cells printed a
// cheerful HELD while observing nothing whatsoever. (The blindness guard caught it; that is the
// whole reason it is there.) A real transient fault passes, so the probe lifts it before auditing:
// the fault's job is to make the app misread, not to stop the auditor reading what the app did.
//
// ─── TWO FAULT MODES, AND THE SECOND ONE IS NOT OPTIONAL ──────────────────────────────────────────
// `readSnapshotsFromDisk` has TWO catch arms and they answer different questions: the OPEN can fail
// (transient I/O), or the open can succeed and the PAYLOAD be unreadable (a corrupt gzip, a
// non-array parse, a worker fault). MUTATION-PROVED, the honest way: with only the 'reject' mode,
// collapsing the parse arm to `return []` left this probe FULLY GREEN (exit 0) — a cell certifying
// a line it could not reach. 'corrupt' is what kills that mutant. Same family as the mime assertion
// that passed because Chromium re-derived the type: refixture until the mutant dies.
//
//   'reject'  — the handle open rejects with a non-NotFound DOMException (transient I/O).
//   'corrupt' — the open SUCCEEDS and hands back gzip magic bytes followed by garbage, so the
//               off-thread gunzip rejects. The bytes are still on disk and may be recoverable,
//               which is exactly why `[]` is the wrong answer here.
const INSTALL_FAULT = (mode) => {
  window.__iwProbeFault = mode
  const proto = FileSystemDirectoryHandle.prototype
  const real = proto.getFileHandle
  proto.getFileHandle = function (name, opts) {
    const m = window.__iwProbeFault
    if (m && name === 'snapshots.json' && !(opts && opts.create)) {
      if (m === 'reject') {
        return Promise.reject(new DOMException('simulated transient read failure', 'InvalidStateError'))
      }
      if (m === 'corrupt') {
        // Valid gzip header, then rubbish — inflate must fail, not merely yield odd JSON.
        const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3, 0x63, 0x1d, 0x77, 0x42, 0x99, 0x0a])
        return Promise.resolve({ getFile: async () => new Blob([bytes]) })
      }
    }
    return real.call(this, name, opts)
  }
}

/** Let the transient fault pass, so the forensic read below sees the disk as it now stands. */
const liftFault = (page) => page.evaluate(() => { window.__iwProbeFault = false })

/** WAIT ON CONTENT, NEVER A SLEEP. The pill renders "◈ N snaps" straight off the archive the app
 *  actually read, so it is the app's own answer to "how many snapshots do you have?" — and under
 *  CPU contention (six lanes on this box) a fixed sleep expiring early looks exactly like "the
 *  feature is missing". That trap cost a lane a fictional bug report today. */
async function waitForSnapCount(page, n, timeout = 60000) {
  await page.waitForFunction(
    ([sel, want]) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const m = /◈\s*(\d+)\s*snap/.exec(el.textContent || '')
      return !!m && Number(m[1]) === want
    },
    [SNAP_PILL, n],
    { timeout },
  )
}

/** The open panel lays a full-viewport backdrop (`div.fixed.inset-0.z-30`) over the page — a real
 *  bit of this UI, not an artefact: it is what closes the panel on an outside mousedown. Typing
 *  into the editor with it up is impossible for a user and for Playwright alike, so close it the
 *  way a writer does. (Found the honest way: the click retried against the backdrop for 30s.) */
async function closePanel(page) {
  const BACKDROP = 'div.fixed.inset-0.z-30[aria-hidden="true"]'
  if (!(await page.$(BACKDROP))) return
  await page.click(BACKDROP)
  await page.waitForSelector(BACKDROP, { state: 'detached', timeout: 15000 })
}

async function saveVersion(page) {
  await page.waitForSelector(SNAP_PILL, { timeout: 60000 })
  if (!(await page.$(SAVE_BTN))) await page.click(SNAP_PILL) // open the panel if it isn't already
  await page.waitForSelector(SAVE_BTN, { timeout: 60000 })
  await page.click(SAVE_BTN)
}

/** Build a REAL multi-snapshot history through the REAL UI: type, save version, repeat. Each save
 *  runs the whole live path — contentHash, bundleHash, receipts, gzip, the write chain. */
async function buildHistory(page, want) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 120000 })
  await page.click(EDITOR)
  await page.keyboard.type('The thesis begins here. ', { delay: 8 })
  for (let i = 1; i <= want; i++) {
    await closePanel(page)
    await page.click(EDITOR)
    await page.keyboard.type(`Paragraph ${i} of the argument. `, { delay: 8 })
    await saveVersion(page)
    // The app confirms the snapshot landed — no guessing. A bare timeout here would surface as
    // "PROBE ERROR: TimeoutError", which reads as flakiness on this contended box and would send
    // the next reader hunting the probe instead of the code (MUTANT 3 did exactly that). Name it.
    try {
      await waitForSnapCount(page, i)
    } catch {
      throw new Error(
        `SETUP BROKEN: the app never reported snapshot ${i} of ${want}. The archive read is refusing ` +
        `to take a first snapshot on a document with no history — i.e. an ESTABLISHED EMPTINESS is ` +
        `being treated as a failed read. That is the OUTAGE direction (see CELL 3), not a flaky load.`,
      )
    }
  }
  await closePanel(page)
  const docId = await pointer(page)
  const disk = await diskArchive(page, docId)
  if (!disk.ok || disk.n !== want) {
    throw new Error(`SETUP BROKEN: wanted ${want} snapshots in real OPFS, found ${disk.n} (${disk.err ?? 'no error'})`)
  }
  return { docId, disk }
}

// ── CELL 1: THE APPEND ───────────────────────────────────────────────────────────────────────────
// The primary vector. A real 4-snapshot archive, a real read fault, then "save version".
async function cellAppend(browser, guardOff, mode) {
  const ctx = await browser.newContext()
  if (guardOff) await ctx.addInitScript(() => { window.__iwArchiveGuard = 'off' })
  const page = await ctx.newPage()
  const { docId } = await buildHistory(page, 4)

  // Reload INTO the fault (a reload clears the in-memory archive cache, so the next read hits disk).
  await ctx.addInitScript(INSTALL_FAULT, mode)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 120000 })
  await closePanel(page)
  await page.click(EDITOR)
  await page.keyboard.type('One more sentence after the fault. ', { delay: 8 })
  await saveVersion(page)
  await sleep(4000) // let the save run to whatever conclusion it reaches (truncate, or refuse)

  await liftFault(page)
  const after = await diskArchive(page, docId)
  await ctx.close()
  return {
    n: after.n,
    truncated: after.ok && after.n < 4,
    detail: after.ok
      ? `the archive on disk holds ${after.n} snapshot${after.n === 1 ? '' : 's'} (was 4)` +
        `${after.n < 4 ? ` — ${4 - after.n} DESTROYED` : ' — intact'}`
      : `could not read the archive off disk: ${after.err}`,
  }
}

// ── CELL 2: THE SUMMARIES ────────────────────────────────────────────────────────────────────────
// The second vector the previous lane named but did not probe: clearAllSnapshotSummaries reads the
// archive, maps it, and writes the WHOLE thing back — so on a failed read it writes [] over history.
async function cellSummaries(browser, guardOff) {
  const ctx = await browser.newContext()
  if (guardOff) await ctx.addInitScript(() => { window.__iwArchiveGuard = 'off' })
  // The "↺ summaries" button is behind the AI opt-in (no text leaves the device without it).
  await ctx.addInitScript(() => { try { localStorage.setItem('inkwave:aiSummaries', '1') } catch { /* private */ } })
  const page = await ctx.newPage()
  const { docId } = await buildHistory(page, 4)

  await ctx.addInitScript(INSTALL_FAULT, 'reject')
  await page.goto(`${BASE}/snapshot?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  const REGEN = '[title="Clear and regenerate all AI summaries"]'
  let clicked = false
  try {
    await page.waitForSelector(REGEN, { timeout: 30000 })
    await page.click(REGEN)
    clicked = true
    await sleep(4000)
  } catch { /* button never appeared — reported below, never silently a pass */ }

  await liftFault(page)
  const after = await diskArchive(page, docId)
  await ctx.close()
  return {
    n: after.n, clicked,
    truncated: after.ok && after.n < 4,
    detail: !clicked
      ? 'the "↺ summaries" button never appeared — cell inconclusive'
      : after.ok
        ? `the archive on disk holds ${after.n} snapshot${after.n === 1 ? '' : 's'} (was 4)` +
          `${after.n < 4 ? ` — ${4 - after.n} DESTROYED` : ' — intact'}`
        : `could not read the archive off disk: ${after.err}`,
  }
}

// ── CELL 3: THE OUTAGE DIRECTION ─────────────────────────────────────────────────────────────────
// Watch this as hard as the loss direction. A brand-new document has NO snapshots.json, and that
// absence arrives as a NotFoundError — the ONE honest []. If the guard cannot tell that from a
// fault, a new writer gets an error screen instead of a blank archive and can never take a first
// snapshot: provenance silently OFF, forever, for everyone. No fault is injected here on purpose.
async function cellOutage(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 120000 })

  const bodyText = (await page.$eval('body', (el) => el.innerText)).replace(/\s+/g, ' ').trim()
  const errorScreen = /couldn't read|could not read|Storage unavailable|unreadable/i.test(bodyText)
  const editorUsable = (await page.$(EDITOR)) !== null

  // …and the first save must actually work.
  await closePanel(page)
  await page.click(EDITOR)
  await page.keyboard.type('A brand new document. ', { delay: 8 })
  await saveVersion(page)
  let firstSaveLanded = true
  try { await waitForSnapCount(page, 1, 30000) } catch { firstSaveLanded = false }
  const docId = await pointer(page)
  const disk = await diskArchive(page, docId)

  await ctx.close()
  return {
    ok: !errorScreen && editorUsable && firstSaveLanded && disk.ok && disk.n === 1,
    detail: `new document: ${errorScreen ? 'AN ERROR SCREEN' : 'a blank archive (no error screen)'}; ` +
      `editor ${editorUsable ? 'usable' : 'MISSING'}; first save ${firstSaveLanded ? 'landed' : 'NEVER LANDED'}; ` +
      `disk holds ${disk.n} snapshot${disk.n === 1 ? '' : 's'}`,
  }
}

async function main() {
  await assertServerIsOurs()
  const browser = await chromium.launch()
  console.log(`\n=== THE SNAPSHOTS: A FAILED ARCHIVE READ MUST NOT TRUNCATE HISTORY — chromium, real OPFS ===`)
  console.log(`    live on master, no flag. Every cell runs control-vs-fixed in ONE build.\n`)

  const results = {}

  // ── CELL 3 RUNS FIRST, ON PURPOSE ────────────────────────────────────────────
  // Two reasons. (1) The outage direction is a real failure in its own right and deserves a clean
  // verdict, not a casualty report. (2) Every cell below BUILDS a history, so they all depend on a
  // first save working — if the guard is clamped shut they die in setup with a bare timeout that
  // looks like flakiness. Establish that the instrument can save at all, and name it when it can't.
  console.log(`--- CELL 3: THE OUTAGE DIRECTION (no fault; a new document must still work) ---`)
  results.outage = await cellOutage(browser)
  console.log(`    ${results.outage.ok ? 'HELD' : 'FAILED'} — ${results.outage.detail}`)
  if (!results.outage.ok) {
    console.error(
      `\n✗ THE OUTAGE DIRECTION IS BROKEN: a new document cannot get a blank archive or take its\n` +
      `  first snapshot. Provenance is silently OFF for every new document. An established emptiness\n` +
      `  is not a failed read. The loss cells below all build a history, so they cannot run.`)
    await browser.close()
    process.exit(1)
  }
  console.log('')

  // ── CELL 1, once per fault mode: the read has two failure arms and they are different lines ──
  for (const mode of ['reject', 'corrupt']) {
    console.log(`--- CELL 1: THE APPEND — fault: ${mode === 'reject' ? 'the open rejects (transient I/O)' : 'the payload is a corrupt gzip'} ---`)
    console.log(`  CONTROL (__iwArchiveGuard='off' — the pre-fix collapse; MUST truncate)`)
    const c = await cellAppend(browser, true, mode)
    console.log(`    ${c.truncated ? 'REPRODUCED' : 'did not reproduce'} — ${c.detail}`)
    console.log(`  FIXED (a failed read is not an empty history; MUST NOT truncate)`)
    const f = await cellAppend(browser, false, mode)
    console.log(`    ${!f.truncated ? 'HELD' : 'FAILED'} — ${f.detail}`)
    results[`appendControl_${mode}`] = c
    results[`appendFixed_${mode}`] = f
  }

  // ── CELL 2 ──
  console.log(`\n--- CELL 2: THE SUMMARIES (clearAllSnapshotSummaries) ---`)
  console.log(`  CONTROL (MUST truncate)`)
  results.sumControl = await cellSummaries(browser, true)
  console.log(`    ${results.sumControl.truncated ? 'REPRODUCED' : 'did not reproduce'} — ${results.sumControl.detail}`)
  console.log(`  FIXED (MUST NOT truncate)`)
  results.sumFixed = await cellSummaries(browser, false)
  console.log(`    ${!results.sumFixed.truncated ? 'HELD' : 'FAILED'} — ${results.sumFixed.detail}`)

  await browser.close()

  // ─── VERDICT ───────────────────────────────────────────────────────────────
  console.log('\n=== VERDICT ===')

  // THE NEGATIVES MUST FIRE FIRST. Do not read a fixed cell whose control never reproduced.
  const blind = []
  for (const mode of ['reject', 'corrupt']) {
    if (!results[`appendControl_${mode}`].truncated) blind.push(`CELL 1 (the append, fault=${mode})`)
  }
  if (!results.sumControl.truncated) blind.push(`CELL 2 (the summaries)${results.sumControl.clicked ? '' : ' — the button never appeared'}`)
  if (blind.length) {
    console.error(
      `\n✗ THE PROBE IS BLIND: ${blind.join(', ')} — the CONTROL was supposed to destroy the archive\n` +
      `  and did not. Either the injected fault never reached the read path, or the seam is not\n` +
      `  restoring the old behaviour, or the cell cannot observe the truncation it names.\n` +
      `  A negative that cannot fail is not a negative. DO NOT read the fixed cells above.`)
    process.exit(2)
  }
  console.log(`  control: one failed read truncated a real 4-snapshot archive to ${results.appendControl_reject.n} on append`)
  console.log(`           (transient I/O) and to ${results.appendControl_corrupt.n} on a corrupt gzip,`)
  console.log(`           and to ${results.sumControl.n} via "↺ summaries" — the truncation, reproduced in real OPFS`)

  const fails = []
  for (const mode of ['reject', 'corrupt']) {
    const f = results[`appendFixed_${mode}`]
    if (f.truncated) fails.push(`CELL 1 (fault=${mode}): ${f.detail}`)
  }
  if (results.sumFixed.truncated) fails.push(`CELL 2: ${results.sumFixed.detail}`)
  if (!results.outage.ok) fails.push(`CELL 3 (OUTAGE): ${results.outage.detail}`)
  if (fails.length) {
    console.error(`\n✗ NOT FIXED:\n  ${fails.join('\n  ')}`)
    process.exit(1)
  }

  console.log(`  fixed:   both write paths REFUSED an archive derived from a failed read — 4 snapshots intact`)
  console.log(`  outage:  a new document still gets a blank archive and a working first save`)
  console.log(`\n✓ chromium: a failed read of the snapshot archive no longer destroys the record,`)
  console.log(`            and an established emptiness is still an empty archive.`)
  process.exit(0)
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(3) })
