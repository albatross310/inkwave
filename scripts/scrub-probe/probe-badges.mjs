// HEADER BADGES (+N/-N) — do they track the PRESENTED version, or the frozen heavy pair?
// They were pinned to the HEAVY (possibly frozen) pair on the reasoning that "nobody reads it
// mid-fling". Peter reads it mid-fling. Cell A (__iwBadgeLive=false) restores that behaviour and
// MUST show stale numbers, or cell B proves nothing.
//
// GROUND TRUTH is the app's OWN at-rest value: isolated (non-rapid) notches take the legacy live
// path, so React's headerDiff renders the authoritative delta for each version — literally what
// Peter sees when he stops. Independent of the driver/paint path under test.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const START = 30, N = 14
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
// Injected as a real function — the probe server serves the PROD CSP, which forbids eval.
const READER = () => {
  window.__iwBadgeTrace = [] // arm the paint trace (zero cost unless defined)
  window.__readBadge = () => {
    const wrap = document.querySelector('span[title="words added / removed vs the previous snapshot"]')
    if (!wrap) return { state: 'missing' }
    const cs = getComputedStyle(wrap)
    if (cs.display === 'none') return { state: 'nochange' }
    if (cs.visibility === 'hidden') return { state: 'blank' }
    const a = wrap.children[0], r = wrap.children[1]
    return { state: 'shown', added: +(a.textContent || '').replace('+', ''), removed: +(r.textContent || '').replace('\u2212', '') }
  }
}
const open = async (extra) => {
  const page = await ctx.newPage()
  await page.addInitScript(READER)
  if (extra) await page.addInitScript(extra)
  await page.addInitScript(realOpfsShim, buildSnapshots())
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-${START}&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(3500)
  return page
}
// ── TRUTH: isolated notches (>=700ms apart) => legacy live path => React's own headerDiff ──────
const tp = await open(null)
const truth = await tp.evaluate(async (n) => {
  const out = []
  for (let i = 0; i < n; i++) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 750)) // NOT rapid -> legacy goTo -> full React render
    out.push(window.__readBadge())
  }
  return out
}, N)
await tp.close()
// index by construction: an isolated notch moves exactly one version (probed: versionsPerEvent 1.00)
const truthByIdx = new Map(truth.map((t, k) => [START - 1 - k, t]))
console.log('TRUTH (at-rest, React path):', JSON.stringify(truth.slice(0, 4)))

const cell = async (label, live) => {
  const page = await open(live ? null : () => { window.__iwBadgeLive = false })
  // Read the PAINT TRACE, not the DOM: a DOM read races the driver's rAF (it caught the mount
  // value at step 1 and looked like a one-step lag). Every paint is recorded in order, so the
  // trace pairs 1:1 with the presented sequence with no timing assumption at all.
  const rows = await page.evaluate(async (n) => {
    window.__iwScrub.resetRecord()
    window.__iwBadgeTrace.length = 0
    for (let i = 0; i < n; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 16))
    }
    await new Promise((r) => setTimeout(r, 120)) // drain the driver, but land() is 260ms away
    const presented = window.__iwScrub.record().filter((x) => x.pane === 'doc').map((x) => x.want).filter((v) => v >= 0)
    const painted = window.__iwBadgeTrace.filter((p) => p.idx >= 0) // driver paints carry their index
    // No ordering assumption: each paint says which version it was FOR.
    const out = painted.map((p) => ({ presented: p.idx, badge: p }))
    return { out, nPresented: presented.length, nPainted: painted.length }
  }, N)
  await page.close()
  const { out: pairs, nPresented, nPainted } = rows
  let match = 0, stale = 0, blank = 0, notruth = 0
  for (const r of pairs) {
    const t = truthByIdx.get(r.presented)
    if (!t || t.state === 'missing') { notruth++; continue }
    if (r.badge.state === 'blank') { blank++; continue }
    const ok = t.state === 'nochange' ? r.badge.state === 'nochange'
      : (r.badge.state === 'shown' && r.badge.added === t.added && r.badge.removed === t.removed)
    if (ok) match++; else stale++
  }
  const n = pairs.length
  return { label, steps: n, presented: nPresented, painted: nPainted, matchesPresented: match, stale, blank, noTruth: notruth,
    rate: n ? +(match / n).toFixed(2) : -1,
    sample: pairs.slice(0, 3).map((r) => ({ v: r.presented, badge: r.badge, truth: truthByIdx.get(r.presented) })) }
}
const A = await cell('A OLD — badge pinned to the heavy pair', false)
const B = await cell('B NEW — badge per presented version', true)
console.log(JSON.stringify(A)); console.log(JSON.stringify(B))
// The OLD badge never repaints during a burst at all — that IS the bug, and it is the cleanest
// statement of it: N versions presented, ZERO badge paints. So score the negative on paint count.
console.log('\nKNOWN-NEGATIVE:', A.painted === 0 && A.presented > 0 ? `✅ reproduces: ${A.presented} versions presented, ${A.painted} badge paints — it sits frozen on the heavy pair` : `❌ old behaviour painted ${A.painted}x — B proves nothing`)
console.log('FIXED        :', B.rate >= 0.9 && B.stale === 0 ? `✅ badges track the PRESENTED version (${B.matchesPresented}/${B.steps}, ${B.stale} stale, ${B.blank} blank)` : `⚠️  ${B.matchesPresented}/${B.steps} matched, ${B.stale} stale, ${B.blank} blank`)
await browser.close()
