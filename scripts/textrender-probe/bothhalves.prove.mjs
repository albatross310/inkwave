// DO THE TWO HALVES AGREE? — the canvas model vs the DOM landing, on the same version.
//
// THE CLAIM UNDER TEST (the load-bearing one): a scrub frame painted from `buildRenderModel` and the
// live pane it settles onto must produce IDENTICAL page offsets. Round 11 inverted — two rules on
// one pane is what produced the 186px drift, and if the canvas paints one thing while the landing
// paints another, the page changes shape every time Peter stops scrubbing.
//
// WHY THIS PROBE IS SHAPED AS A CONTROL + A TEST, rather than a single comparison: a bare
// "model.pages vs pane.pages" number is unreadable on its own. The two are computed by different
// code, in different routes, from different inputs — so a disagreement could mean the geometry
// doesn't line up, the fixture didn't load, the flag didn't engage, or something real. So:
//
//   CONTROL — snap-00 (`ops === null` → DocView → NO diff marks). The pane renders exactly the
//     document the model models. If the two halves are comparable AT ALL, they agree here. If this
//     control does NOT agree, the harness is broken and NO verdict may be read from the test.
//
//   TEST — snap-01 (`ops !== null` + flag → RichDiffView → the shipped pane, WITH diff marks).
//     Same geometry, same fixture family, same measurement. The only thing added is the diff.
//
// STATED FROM SOURCE, and the reason to expect trouble: `buildRenderModel(doc, geom, measure,
// fontLoaded, opts)` takes ONLY the document. textRender.ts contains no `DiffOp`, no `opsBetween`,
// no `anchorOps` — grep is empty (use `grep -a`; the file has a NUL byte at ~620 and plain grep
// treats it as binary and reports NOTHING, which reads as "symbol not found"). RichDiffView, by
// contrast, renders cur's document PLUS every deleted run spliced in as strikethrough. If that is
// what it looks like, the two halves are modelling different documents and "identical offsets" is
// not a bug to fix but a claim that cannot currently be made.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const DOC_ID = 'probe-doc-scrub'

// THE CONTROL BISECT. The control failed on the FULL thesis shape (canvas 58 vs DOM 61 pages with
// NO diff). Rather than guess which content kind the two halves disagree about, vary ONE at a time:
// prose is the floor both sides must agree on; each addition is a suspect. This is the same move as
// isolate.prove.mjs — a rate over a mixed document cannot tell you WHICH ingredient diverged.
const SHAPES = [
  ['prose only',              { words: 6000, cites: 0,  marked: 0, lists: false, refList: false, headings: false }],
  ['+ headings',              { words: 6000, cites: 0,  marked: 0, lists: false, refList: false, headings: true }],
  ['+ lists',                 { words: 6000, cites: 0,  marked: 0, lists: true,  refList: false, headings: true }],
  ['+ citations',             { words: 6000, cites: 80, marked: 1, lists: true,  refList: false, headings: true }],
  ['+ refList (thesis shape)',{ words: 6000, cites: 80, marked: 1, lists: true,  refList: true,  headings: true }],
]
const FIX = buildCitationDoc({ words: 13000, cites: 174, marked: 1, lists: true, refList: true, id: 'halves' })

// snap-00 and snap-01 differ by a realistic revision — ~2% of paragraphs reworded — so the diff is
// REAL. Byte-identical versions would collapse diffWords to one `same` op and the deleted text this
// probe exists to see would not exist.
function mutate(json, v) {
  const d = JSON.parse(JSON.stringify(json))
  if (v === 0) return d
  let seed = v * 7919
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (const node of d.content || []) {
    if (node.type !== 'paragraph' || !node.content) continue
    if (rnd() > 0.02) continue
    for (const c of node.content) {
      if (c.type === 'text' && c.text && c.text.length > 40) {
        const w = c.text.split(' ')
        if (w.length > 6) { w.splice(3, 2, 'revised', 'wording'); c.text = w.join(' ') }
        break
      }
    }
  }
  return d
}

const SNAP_JSON = () => JSON.stringify([0, 1].map((v) => ({
  id: `snap-0${v}`, documentId: DOC_ID,
  createdAt: new Date(Date.now() - (2 - v) * 3600 * 1000).toISOString(), trigger: 'word-nudge',
  wordCount: 13000, contentHash: 'p' + v, bundleHash: 'p' + v, ots: { status: 'unstamped' },
  contentJson: mutate(FIX.contentJson, v),
})))

const seed = ({ json, lib, rich }) => {
  const files = new Map()
  const enc = new TextEncoder()
  files.set('documents/probe-doc-scrub/snapshots.json', enc.encode(json))
  files.set('library/citations.json', enc.encode(lib))
  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => ({ write: async () => {}, truncate: async () => {}, seek: async () => {}, close: async () => {} }),
  })
  const dirHandle = (prefix) => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => {
      const path = prefix + name
      if (!files.has(path)) { if (opts && opts.create) files.set(path, new Uint8Array()); else throw new DOMException('missing', 'NotFoundError') }
      return fileHandle(path)
    },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = { getDirectory: async () => dirHandle(''), persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }) }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
  try { if (rich) localStorage.setItem('inkwave:textRender', '1'); else localStorage.removeItem('inkwave:textRender') } catch { /* private */ }
}

/** THE DOM HALF: what the pane actually renders and paginates, via staticPagination's own widgets. */
const PANE = () => {
  const layer = document.querySelector('.iw-snap-layer-active') || document.querySelector('.iw-snap-layer')
  const root = layer && (layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor'))
  if (!root) return { err: 'no pane root' }
  return {
    gaps: root.querySelectorAll('.inkwave-page-gap').length,
    pages: root.querySelectorAll('.inkwave-page-gap').length + 1,
    chars: (root.textContent || '').length,
    blockEls: root.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,pre').length,
    delSpans: root.querySelectorAll('.diff-del').length,
    delChars: [...root.querySelectorAll('.diff-del')].reduce((a, e) => a + (e.textContent || '').length, 0),
    addSpans: root.querySelectorAll('.diff-add').length,
  }
}

async function paneOf(ctx, snapId) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/snapshot?doc=${DOC_ID}&snap=${snapId}`, { waitUntil: 'load' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor, .iw-snap-layer .tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(5000)
  const r = await page.evaluate(PANE)
  await page.close()
  return r
}

/** THE CANVAS HALF: the model the scrub frames would be painted from. */
async function modelOf(browser, contentJson) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  await ctx.addInitScript(seed, { json: SNAP_JSON(), lib: JSON.stringify(FIX.bibliography.entries), rich: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  // ASSERT THE SERVED CHUNK IS OURS — an agent got a confident "the wiring never fires" from another
  // agent's build holding the port. Check for the thing this probe needs, not merely that it booted.
  const ok = await page.evaluate(() => typeof window.__iwTextRenderProbe?.build === 'function')
  if (!ok) { await ctx.close(); return { err: 'served bundle has no __iwTextRenderProbe.build — NOT our build' } }
  const docWrap = { ...FIX, id: 'halves-model', contentJson }
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), docWrap)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 6000, null, { timeout: 90000 })
  await page.waitForTimeout(5000)
  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) { await ctx.close(); return { err: `probe blind (fonts=${st.fontsReallyLoaded} pos=${st.seesKnownPositive})` } }
  // WARM before reading: JIT tier-up takes 12 identical calls from 291.7ms to 81.8ms settled. No
  // timing is read here, but the model must be the settled one.
  const r = await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__iwTextRenderProbe.build()
    const { model } = window.__iwTextRenderProbe.build()
    let chars = 0
    for (const l of model.lines) for (const s of l.segs || []) chars += (s.text || '').length
    return { pages: model.pages, lines: model.lines.length, blocks: model.blocks.length, chars, reliablePages: model.reliablePages }
  })
  await ctx.close()
  return r
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] })

  const ctxRich = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
  await ctxRich.addInitScript(seed, { json: SNAP_JSON(), lib: JSON.stringify(FIX.bibliography.entries), rich: true })
  const pane00 = await paneOf(ctxRich, 'snap-00') // ops === null → DocView, NO marks (the CONTROL)
  const pane01 = await paneOf(ctxRich, 'snap-01') // ops !== null + flag → RichDiffView (the TEST)
  await ctxRich.close()

  const model00 = await modelOf(browser, mutate(FIX.contentJson, 0))
  const model01 = await modelOf(browser, mutate(FIX.contentJson, 1))
  await browser.close()

  for (const [n, v] of [['pane00', pane00], ['pane01', pane01], ['model00', model00], ['model01', model01]]) {
    if (v.err) { console.log(`VOID — ${n}: ${v.err}`); process.exit(1) }
  }

  console.log('\n╔══ DO THE TWO HALVES AGREE? — canvas model vs DOM landing, thesis scale (13k words / 174 cites)')
  console.log('╚══ Same fixture, same canonical geometry. The ONLY difference in the TEST row is the diff.\n')
  console.log(`  CONTROL  snap-00 (ops===null → DocView, NO marks)`)
  console.log(`     DOM pane   ${String(pane01.err ? '?' : pane00.pages).padStart(4)} pages · ${String(pane00.chars).padStart(7)} chars · ${pane00.blockEls} block els · dels ${pane00.delSpans}`)
  console.log(`     canvas     ${String(model00.pages).padStart(4)} pages · ${String(model00.chars).padStart(7)} chars · ${model00.blocks} blocks · lines ${model00.lines}`)
  const cDelta = Math.abs(model00.pages - pane00.pages)
  console.log(`     Δ pages ${cDelta}`)

  console.log(`\n  TEST     snap-01 (ops!==null + flag → RichDiffView, THE SHIPPED PANE)`)
  console.log(`     DOM pane   ${String(pane01.pages).padStart(4)} pages · ${String(pane01.chars).padStart(7)} chars · ${pane01.blockEls} block els · dels ${pane01.delSpans} spans/${pane01.delChars} chars · adds ${pane01.addSpans}`)
  console.log(`     canvas     ${String(model01.pages).padStart(4)} pages · ${String(model01.chars).padStart(7)} chars · ${model01.blocks} blocks · lines ${model01.lines}`)
  const tDelta = Math.abs(model01.pages - pane01.pages)
  console.log(`     Δ pages ${tDelta}`)

  console.log('\n══ VERDICT ══')
  // THE GATE. The control must AGREE, or the two halves are not comparable and the test row is noise.
  const controlAgrees = cDelta <= 1
  console.log(`  control agrees (Δ ≤ 1 page): ${controlAgrees}`)
  if (!controlAgrees) {
    console.log('  VOID — the canvas and the DOM do NOT agree even with NO diff marks, on the document the')
    console.log('         model models exactly. Something upstream (geometry, fixture, flag) is wrong, and')
    console.log('         nothing may be concluded from the TEST row. Fix the harness before reading it.')
    process.exit(1)
  }
  console.log('  → the two halves ARE comparable: with no diff, canvas and DOM land on the same pagination.')
  if (tDelta <= 1) {
    console.log(`\n  The halves AGREE with marks too (Δ ${tDelta}). "Identical offsets" is reachable; compare`)
    console.log('  break POSITIONS next, not just counts — equal page counts is a weaker claim than identical.')
  } else {
    console.log(`\n  ✗ THE HALVES DIVERGE: canvas ${model01.pages} pages vs pane ${pane01.pages} — Δ ${tDelta} pages (${(pane01.pages / model01.pages).toFixed(2)}×).`)
    console.log(`    The pane carries ${pane01.delChars} chars of DELETED text (${pane01.delSpans} spans) that the model has`)
    console.log('    never heard of: buildRenderModel(doc, …) takes ONLY the document — no DiffOp, no ops.')
    console.log('    So the canvas would paint cur\'s document while the pane shows cur\'s document PLUS its')
    console.log('    deletions. This is not a drift to tune: the two halves model DIFFERENT DOCUMENTS, and')
    console.log('    "identical offsets" cannot be claimed until the model is fed the diff.')
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
