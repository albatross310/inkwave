// THE PARSE INCREMENT — the cost /snapshot's sweep adds that no existing number covers (2026-07-17).
//
// ROUND 13 measured a version's break-table build at ~62-82ms settled. That number was
// `buildRenderModel(editor.state.doc, …)` — fed a node the EDITOR had already parsed. /snapshot has
// no editor: every version must first become a PM Node from its contentJson. That parse is this
// seam's OWN increment, and quoting 62-82ms for the wired sweep without it would be inheriting a
// constant measured under different conditions — exactly what ROUND 13 refused to do when the repo's
// own numbers didn't reconcile.
//
// JIT: warmed in-page (12 calls) before timing. 12 identical in-page calls go 291.7 → 81.8ms settled;
// a probe timing a few calls over CDP round-trips reports the tier-up, not the work.
// CONTENTION: this box runs other agents' probes; per-version cost moved 103 → 177ms between runs on
// nothing but load. Read the ratio to the known build cost, not the absolute.
//
// Usage: pnpm build && node scripts/textrender-probe/parsecost.prove.mjs

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const { base: BASE, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })

await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
// Wait for the PROBE, not for `.tiptap-editor` — a load carries an aria-hidden anti-flash SHELL that
// also has that class (mountcount.prove.mjs's trap 3), so `state:'attached'` resolves BEFORE the real
// editor exists. Waiting on the shell made this probe's own staleness guard fire on a FRESH bundle:
// the surface genuinely wasn't installed yet. Wait for the thing you are about to call.
await page.waitForFunction(() => !!window.__iwTextRenderProbe, null, { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)

// The served bundle must carry the thing under test — an agent tonight read a probe surface that
// existed in a STALE bundle and believed its numbers. (Now that the wait is correct, this can only
// mean a genuinely stale bundle.)
const has = await page.evaluate(() => !!(window.__iwTextRenderProbe && typeof window.__iwTextRenderProbe.parseCost === 'function'))
if (!has) { console.log('VOID: served bundle has no parseCost() — rebuild.'); await b.close(); await stop(); process.exit(2) }

// Thesis-scale, citation-heavy — the shape Peter's 116 versions actually are.
let s = 1337; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
const content = []
for (let i = 0; i < 170; i++) {
  if (i % 14 === 0) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section ' + i }] })
  const para = [{ type: 'text', text: words(60) + ' ' }]
  para.push({ type: 'citation', attrs: { citekeys: [`src${i % 40}`], locator: String(i), prefix: null, suffix: null, suppressAuthor: false, quote: null, instanceId: `i${i}` } })
  para.push({ type: 'text', text: ' ' + words(14) + '.' })
  content.push({ type: 'paragraph', content: para })
}
const doc = {
  id: 'parsecost', title: 'parsecost', contentJson: { type: 'doc', content },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'pc',
}
await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 10000, null, { timeout: 60000 })
await page.waitForTimeout(3000)

const r = await page.evaluate(() => window.__iwTextRenderProbe.parseCost(40))
if (r.void) { console.log('VOID:', r.reason); await b.close(); await stop(); process.exit(2) }

console.log('── contentJson → PM Node, per version ──')
console.log(`words ${r.words} · iters ${r.iters}`)
console.log(`p50 ${r.p50.toFixed(2)}ms · min ${r.min.toFixed(2)} · max ${r.max.toFixed(2)}`)
console.log('')
console.log(`Peter's 116 versions: parse alone ≈ ${(r.p50 * 116 / 1000).toFixed(2)}s`)
console.log('(ADD to ROUND 13\'s ~62-82ms/version build ⇒ ~9.1s; the parse is the sweep\'s own increment.)')
await b.close()
await stop()
