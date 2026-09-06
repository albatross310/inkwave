// FRESH WINDOWS WALK CURRENT DOCS NEWEST-FIRST, SKIPPING LIVE HOLDERS.
// HARD REFRESH → THE SAME DOCUMENT. N WINDOWS → NEVER THE SAME ONE.
// Peter, 2026-09-06: first window resumes the most recent current doc; each additional window gets
// the next unheld one; only an exhausted workflow creates blank.
// ONE BrowserContext = one browser profile: shared localStorage, shared OPFS, per-tab sessionStorage.
import { chromium } from '@playwright/test'
import { startProbeServer } from '../textrender-probe/serve.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext()
let fail = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`); if (!ok) fail++ }

/** Drive the real loading gate, then wait until the editor is actually uncovered. */
async function waitEditor(p, what) {
  const first = await Promise.race([
    p.waitForFunction(() => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'), null, { timeout: 60000 })
      .then(() => 'editor').catch(() => 'timeout'),
    p.waitForFunction(() => /open in another window/i.test(document.body.innerText), null, { timeout: 60000 })
      .then(() => 'blocked').catch(() => 'timeout'),
  ])
  if (first === 'blocked') throw new Error(`${what}: expected an editor, got THE BLOCKED SCREEN (another tab holds this document)`)
  if (first !== 'editor') throw new Error(`${what}: expected an editor, got nothing (timeout)`)
}

const open = async () => {
  const p = await ctx.newPage()
  await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await waitEditor(p, 'new window')
  await p.waitForTimeout(500)
  return p
}
const docOf = (p) => p.evaluate(() => new URL(location.href).searchParams.get('doc'))
const textOf = (p) => p.evaluate((s) => document.querySelector(s)?.innerText.trim() ?? '', EDITOR)
const type = async (p, t) => { await p.click(EDITOR); await p.keyboard.type(t); await p.waitForTimeout(1400) }

try {
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

  const A = await open()
  await type(A, 'ALPHA-DOCUMENT')
  const idA = await docOf(A)
  check(!!idA, 'window A has a document', idA ?? '')

  const guarded = await ctx.newPage()
  await guarded.goto(`${base}/?doc=${idA}`, { waitUntil: 'domcontentloaded' })
  const guardedResult = await Promise.race([
    guarded.waitForFunction(() => /open in another window/i.test(document.body.innerText), null, { timeout: 60000 })
      .then(() => 'blocked').catch(() => 'timeout'),
    guarded.waitForFunction(() => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'), null, { timeout: 60000 })
      .then(() => 'editor').catch(() => 'timeout'),
  ])
  check(guardedResult === 'blocked', 'written-but-Untitled still gets the collision warning', guardedResult)
  await guarded.close()

  // A remains live. B therefore skips ALPHA and takes the next current document.
  const B = await open()
  const idB = await docOf(B)
  check(idB !== idA, 'window B skips ALPHA because window A holds it', `B=${idB}`)
  check(!(await textOf(B)).includes('ALPHA'), 'window B never overlaps ALPHA')
  await type(B, 'BRAVO-DOCUMENT')

  // With both released, recency selects BRAVO first and ALPHA second.
  await A.close(); await B.close()
  await new Promise((r) => setTimeout(r, 800))
  const C = await open()
  const D = await open()
  check((await docOf(C)) === idB, 'first fresh window resumes the most recent current doc (BRAVO)')
  check((await docOf(D)) === idA, 'second fresh window skips BRAVO and resumes ALPHA')

  await C.reload({ waitUntil: 'domcontentloaded' }); await waitEditor(C, 'BRAVO after refresh')
  await D.reload({ waitUntil: 'domcontentloaded' }); await waitEditor(D, 'ALPHA after refresh')
  const tC = await textOf(C), tD = await textOf(D)
  check(tC.includes('BRAVO') && !tC.includes('ALPHA'), 'after refresh window C still shows BRAVO', JSON.stringify(tC.slice(0, 30)))
  check(tD.includes('ALPHA') && !tD.includes('BRAVO'), 'after refresh window D still shows ALPHA', JSON.stringify(tD.slice(0, 30)))
  check((await docOf(C)) === idB && (await docOf(D)) === idA, 'neither window changed document across refresh')

  const E = await open()
  check(![idA, idB].includes(await docOf(E)), 'a third window skips every document already held')
  const onDisk = await E.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('documents', { create: false })
    let n = 0
    // @ts-ignore
    for await (const _ of dir.keys()) n++
    return n
  })
  check(onDisk >= 3, 'window assignment selects documents without deleting storage', `${onDisk} on disk`)
} catch (e) {
  console.log(`  ✗ ${e.message}`)
  fail++
} finally { await b.close(); await stop() }
console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
