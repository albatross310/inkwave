// THE SIDEWAYS SWIPE ON /snapshot — the browser must not take it, and the view must still have it.
//
// Peter, 2026-08-30, on a Mac trackpad: a two-finger horizontal swipe fires the browser's own
// history navigation and throws him out of the snapshot review mid-read. That is a COLLISION with a
// shipped feature, not a cosmetic annoyance — /snapshot binds a `wheel` listener that reads `deltaX`
// and drives the position scrubber (the version fly-through).
//
// ⚠⚠ READ THIS BEFORE READING ANY VERDICT BELOW — THE SCOPE, AND WHY IT IS THIS AND NOT MORE.
// A headless Chromium CANNOT perform macOS swipe-navigation. That gesture is produced by the
// platform's own trackpad recogniser, not by the wheel events CDP synthesises, so a check phrased as
// "history did not navigate" would be TRUE ON EVERY BUILD, fixed or broken — the exact shape
// CLAUDE.md names as decoration: "any cell whose PASS condition is satisfiable by the mechanism that
// disables the feature is not a control". So this probe does NOT claim to have watched a swipe-back
// be prevented. It measures the two things that ARE decidable here, and the report says plainly that
// the third needs Peter's hands:
//   1. THE MECHANISM IS PRESENT AND CORRECTLY PLACED. `overscroll-behavior-x` computes to `contain`
//      on the ROOT (where it propagates to the viewport — it does not propagate from `body`) and on
//      every pane scroller, while /snapshot is mounted. This is falsifiable, and its control is a
//      REAL PAGE rather than a seam: the editor route must read `auto`, and so must /snapshot after
//      you navigate away, or the rule has leaked out of its lane.
//   2. THE VIEW'S OWN GESTURE STILL WORKS. A synthetic horizontal wheel over the panes must still
//      step the version, and must still be cancelled (`defaultPrevented`). If suppressing the
//      browser's swipe had cost the scrub, that is a worse bug than the one being fixed.
// The armed known-negative for (1) is the same class REMOVED at runtime: the check must go red.
//
// Usage: pnpm build && pnpm prove:snapswipe

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const DOC = 'snapswipe-probe'
const VERSIONS = 12

const seed = ({ docId, versions }) => {
  let s = 424242
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = 'identity persistence change over time argument thesis evidence claims analysis method critique framework'.split(' ')
  const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
  const bodyFor = (v) => {
    const c = []
    for (let i = 0; i < 30; i++) {
      c.push({ type: 'paragraph', content: [{ type: 'text', text: `v${v} p${i} ` + words(40) + '.' }] })
    }
    return c
  }
  const t0 = Date.now() - versions * 3600 * 1000
  const snaps = []
  for (let v = 0; v < versions; v++) {
    snaps.push({
      id: `snap-${String(v).padStart(3, '0')}`, documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 1200 + v, contentHash: 'h' + v, bundleHash: 'b' + v,
      ots: { status: 'pending' }, contentJson: { type: 'doc', content: bodyFor(v) },
    })
  }
  const doc = {
    id: docId, title: 'Swipe probe', createdAt: new Date(t0).toISOString(),
    updatedAt: new Date().toISOString(), schemaVersion: '1', contentJson: bodyFor(versions - 1),
  }
  const files = new Map()
  files.set(`documents/${docId}/snapshots.json`, new TextEncoder().encode(JSON.stringify(snaps)))
  files.set(`documents/${docId}/current.json`, new TextEncoder().encode(JSON.stringify(doc)))
  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => {
      const chunks = []
      return {
        write: async (d) => { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d instanceof Blob ? await d.arrayBuffer() : d)) },
        truncate: async () => {}, seek: async () => {},
        close: async () => {
          let n = 0; for (const c of chunks) n += c.length
          const out = new Uint8Array(n); let o = 0
          for (const c of chunks) { out.set(c, o); o += c.length }
          files.set(path, out)
        },
      }
    },
  })
  const dirHandle = (prefix) => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => {
      const path = prefix + name
      if (!files.has(path)) {
        if (opts && opts.create) files.set(path, new Uint8Array())
        else throw new DOMException('missing', 'NotFoundError')
      }
      return fileHandle(path)
    },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = {
    getDirectory: async () => dirHandle(''), persist: async () => true,
    persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }),
  }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
  try { localStorage.setItem('inkwave:activeDocumentId', docId) } catch { /* private */ }
}

const { base: BASE, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true })

let fail = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}
const voids = []
const voidIt = (msg) => { console.log(`  ∅ VOID — ${msg}`); voids.push(msg) }

// Every scroller the route owns, plus the root, read as the ENGINE resolves them.
const READ_OSB = `
(() => {
  const of = (el) => (el ? getComputedStyle(el).overscrollBehaviorX : null)
  const panes = [...document.querySelectorAll('.iw-snap-scroll')]
  return {
    root: of(document.documentElement),
    body: of(document.body),
    rootHasClass: document.documentElement.classList.contains('iw-no-swipe-nav'),
    paneCount: panes.length,
    panes: panes.map(of),
  }
})()
`

try {
  // ── INSTRUMENT CHECK, and it is why the scope below is what it is ─────────────────────────────
  // The claim "this harness cannot see swipe-navigation" is load-bearing: it is the whole reason
  // this probe measures the mechanism rather than the outcome. So it is MEASURED here rather than
  // asserted. Two history entries, suppression explicitly OFF (`overscroll-behavior-x: auto`), a
  // sustained rightward wheel stream — if the harness could ever navigate, this is where it would.
  //
  // It is reported, NEVER SCORED. Forcing it to a pass or a fail would prove exactly as little as
  // an assertion that holds by construction (btrace.prove.mjs's `ok:null` race line, same rule).
  // If a future engine DOES navigate here, that is the day an outcome-level cell becomes writable —
  // and this line is what will tell you.
  {
    const c = await b.newContext({ viewport: { width: 900, height: 700 } })
    const p = await c.newPage()
    await p.goto('data:text/html,<title>A</title><body style="height:200vh">A</body>')
    await p.goto('data:text/html,<title>B</title><body style="height:200vh;overscroll-behavior-x:auto">B</body>')
    await p.mouse.move(450, 350)
    for (let i = 0; i < 40; i++) await p.mouse.wheel(-160, 0)
    await p.waitForTimeout(2000)
    const navigated = (await p.title()) !== 'B'
    console.log(`  · INSTRUMENT: with suppression OFF, 40 rightward wheel events navigated history: ${navigated}`)
    console.log(navigated
      ? '    → this harness CAN see swipe-nav; an outcome-level cell is now writable and should be.'
      : '    → this harness CANNOT see swipe-nav (platform recogniser, not wheel events), so a\n'
        + '      "history did not navigate" cell would pass on a broken build. Not scored.')
    await c.close()
  }

  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('    PAGEERROR:', e.message.slice(0, 140)))
  await page.addInitScript(seed, { docId: DOC, versions: VERSIONS })

  // ── 0. THE CONTROL IS A REAL PAGE, and it runs FIRST ──────────────────────────────────────────
  // The editor route must NOT carry the rule. Establishing that before /snapshot is what makes the
  // /snapshot reading mean "this route turned it on" rather than "this browser defaults to it" —
  // without it, an engine that shipped `contain` as its own default would read as a working fix.
  console.log('\n──────── CONTROL: the editor route (/) ────────')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 60000 })
  await page.waitForTimeout(1500)
  const editorOsb = await page.evaluate(READ_OSB)
  check(editorOsb.root === 'auto', 'the editor route leaves the root at the browser default', `root=${editorOsb.root}`)
  check(!editorOsb.rootHasClass, 'the editor route does not carry .iw-no-swipe-nav')

  // ── 1. /snapshot: the mechanism is present and correctly placed ───────────────────────────────
  console.log('\n──────── /snapshot ────────')
  await page.goto(`${BASE}/snapshot?doc=${DOC}&snap=snap-006`, { waitUntil: 'domcontentloaded' })
  const ready = await page.waitForFunction(
    () => document.querySelectorAll('.iw-snap-scroll').length >= 2,
    null, { timeout: 45000 },
  ).then(() => true).catch(() => false)
  if (!ready) { voidIt('/snapshot never rendered its panes — nothing to measure'); throw new Error('route did not render') }
  await page.waitForTimeout(1500)

  const snapOsb = await page.evaluate(READ_OSB)
  console.log(`  · panes found: ${snapOsb.paneCount} (${snapOsb.panes.join(', ')})`)
  check(snapOsb.rootHasClass, '/snapshot adds .iw-no-swipe-nav to <html>')
  check(snapOsb.root === 'contain', 'the ROOT contains horizontal overscroll (this is what reaches the viewport)', `root=${snapOsb.root}`)
  // VOID rather than pass if there are no panes: "all 0 panes are contained" is a vacuous truth,
  // and it is exactly how a probe certifies a surface it never read.
  if (snapOsb.paneCount < 2) voidIt(`only ${snapOsb.paneCount} pane scroller(s) found — the pane check is vacuous`)
  else check(snapOsb.panes.every((v) => v === 'contain'), 'every pane scroller contains horizontal overscroll', snapOsb.panes.join(', '))

  // ── 2. ARMED KNOWN-NEGATIVE ───────────────────────────────────────────────────────────────────
  // Strip the class at runtime and the root reading MUST go back to the default. Without this, a
  // browser that resolved `contain` for its own reasons would read identically to a working fix and
  // the check above would be measuring the engine rather than the code.
  console.log('\n──────── known-negative: the class removed ────────')
  const off = await page.evaluate(() => {
    document.documentElement.classList.remove('iw-no-swipe-nav')
    const v = getComputedStyle(document.documentElement).overscrollBehaviorX
    document.documentElement.classList.add('iw-no-swipe-nav')
    return v
  })
  check(off === 'auto', 'removing .iw-no-swipe-nav restores the browser default (so the rule IS the cause)', `root=${off}`)
  const back = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorX)
  check(back === 'contain', '…and restoring it re-contains — the negative discriminates, it does not merely break', `root=${back}`)

  // ── 3. THE VIEW'S OWN GESTURE STILL WORKS ─────────────────────────────────────────────────────
  // The whole point of suppressing the browser's swipe is that this view already owns it. If the
  // fix had cost the scrub, that is a worse bug than the one being fixed.
  console.log('\n──────── the view still owns the gesture ────────')
  const before = await page.evaluate(() => new URL(location.href).searchParams.get('snap'))
  // Dispatch on the DIFF PANE's scroller, which is where the scrub handler is bound. A wheel
  // dispatched at the document would not reach it.
  const cancelled = await page.evaluate(() => {
    const el = document.querySelectorAll('.iw-snap-scroll')[0]
    if (!el) return null
    let seen = 0
    // A real trackpad swipe is a STREAM: the detent arms on the first events and steps after. One
    // event would land inside the arming distance and step nothing — reading as "the scrub is
    // broken" about a scrub that is working exactly as designed (scrubDetent.ts's FIRST/REST rule).
    for (let i = 0; i < 24; i++) {
      const e = new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      if (e.defaultPrevented) seen++
    }
    return seen
  })
  if (cancelled === null) voidIt('no pane scroller to dispatch on')
  else check(cancelled > 0, 'a horizontal wheel over a pane is CANCELLED by the scrub handler', `${cancelled}/24 events`)
  await page.waitForTimeout(1400) // the scrub lands its React commit + syncs the URL after quiet
  const after = await page.evaluate(() => new URL(location.href).searchParams.get('snap'))
  check(before !== after, 'the horizontal swipe still scrubs the version', `${before} → ${after}`)

  // ── 4. THE RULE DOES NOT LEAK ─────────────────────────────────────────────────────────────────
  // A class written onto <html> by a route is a global, and a global that outlives its route is the
  // `iw-wave-video-on` latch this codebase has already been bitten by: a promise about the page that
  // stayed true after the thing making it true was gone.
  console.log('\n──────── it does not outlive the route ────────')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 60000 })
  await page.waitForTimeout(1200)
  const backOnEditor = await page.evaluate(READ_OSB)
  check(!backOnEditor.rootHasClass && backOnEditor.root === 'auto',
    'leaving /snapshot drops the rule — the editor keeps its own gestures',
    `class=${backOnEditor.rootHasClass} root=${backOnEditor.root}`)

  await ctx.close()

  console.log('\n──────── SCOPE — read this with the verdict ────────')
  console.log('  PROVED HERE: the suppression mechanism is present, is on the element that reaches')
  console.log('    the viewport, is caused by our rule (armed negative), does not leak past the')
  console.log('    route, and has not cost the view its own horizontal scrub.')
  console.log('  NOT PROVED HERE, and the INSTRUMENT line above is the measurement that says so:')
  console.log('    that macOS Safari/Chrome actually stop navigating. Swipe-nav comes from the')
  console.log('    platform trackpad recogniser, which headless Chromium does not run, so a')
  console.log('    "history did not navigate" cell would pass on a broken build too. That')
  console.log('    confirmation needs Peter\'s trackpad.')
  console.log('  ALSO NOT COVERED: iOS/iPadOS EDGE-swipe back is a system gesture, not scroll')
  console.log('    overflow. No web page can suppress it, and this does not claim to.')

  console.log('\n──────── VERDICT ────────')
  check(voids.length === 0, 'every check was actually measured (no voids)', voids.slice(0, 4).join(' | '))
} catch (e) {
  console.log(`  ✗ ${e.message}\n${e.stack}`)
  fail++
} finally {
  await b.close()
  await stop()
}

console.log(fail ? `\nFAIL (${fail})` : '\nPASS')
process.exitCode = fail ? 1 : 0
