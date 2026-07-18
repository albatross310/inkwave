// Usage: pnpm build && pnpm prove:arith   (boots its own server on an ephemeral port)
//
// THE GRADUATION GATE for the reflow-free canvas-advance pagination engine (flag
// `inkwave:arithLayout`, DEFAULT OFF). The engine was reverted to OFF on 2026-07-15 for a
// "~1 break in 20" wrap divergence from the DOM canonical measure on real eligible prose — but the
// LU-quantisation wrap fix (88ebf39) landed the DAY AFTER that revert, so the parking rationale was
// stale. This probe is the KEEPER for the claim: it drives the REAL wired whole-doc arith path and
// asserts its canonical breaks are BYTE-IDENTICAL to the DOM canonical measure on fully-eligible
// plain prose (the exact document class the revert named as at-risk).
//
// Whole-doc arith is gated to `!canonicalIsLive`, so the probe forces it by setting editor zoom != 1
// (canonicalIsLive → false). Breaks are canonical DOC POSITIONS regardless of zoom, so arith-ON vs
// arith-OFF on the SAME doc is a clean A/B. It EXITS 1 on any divergence or if arith fails to engage
// (a false green: __iwPagArith must be true, or the verdict is not about arith at all).
//
// SCOPE, STATED HONESTLY: Chromium only (--font-render-hinting=none). The canonical-break invariant
// is CROSS-DEVICE; a WebKit pass on Peter's device class is the remaining blocker before graduation
// (see the flag comment in PaginationExtension.ts). Fully-eligible prose only — a citation/list/
// heading/refList-bearing doc is INELIGIBLE (buildArithMeasure returns null ⇒ DOM path ⇒ no arith
// risk), which is why the real Honours doc never hits this path.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
const { base: BASE, stop } = await startProbeServer()

// Same eligible-prose generator as breaks.prove.mjs. Include hyphenated compounds to exercise the
// soft-break path that the render-font fix (88ebf39) touched.
const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds difficult waffles first fifth flourish effigy scaffold constructed-language well-formed self-evident').split(/\s+/)
function makeDoc(seed, words, id) {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const paras = []; let w = 0
  while (w < words) { const n = Math.min(30 + Math.floor(rnd() * 40), words - w); const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); const t = o.join(' '); paras.push(t[0].toUpperCase() + t.slice(1) + '.'); w += n }
  return { id, title: id, contentJson: { type: 'doc', content: paras.map(t => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fid' }
}
const DOCS = [
  makeDoc(1337, 4000, 'adv-a'),
  makeDoc(90210, 6000, 'adv-b'),
  makeDoc(555, 8000, 'adv-c'),
]

async function run(arithOn) {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  await page.addInitScript((on) => {
    try {
      localStorage.setItem('inkwave:editorZoom', '1.2') // != 1 → canonicalIsLive false → whole-doc arith reachable
      if (on) localStorage.setItem('inkwave:arithLayout', '1'); else localStorage.removeItem('inkwave:arithLayout')
    } catch {}
  }, arithOn)
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2000)
  const out = []
  for (const doc of DOCS) {
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
    await page.waitForFunction((min) => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > min, doc.contentJson.content.reduce((a, p) => a + p.content[0].text.split(' ').length, 0) - 200, { timeout: 60000 })
    await page.waitForTimeout(4500)
    out.push(await page.evaluate(() => {
      const p = window.__iwTextRenderProbe
      return { live: p.liveBreaks(), arith: window.__iwPagArith === true, dump: window.__iwArithDump || null }
    }))
  }
  await b.close()
  return out
}

const off = await run(false)
const on = await run(true)
await stop()

let allSame = true, allEngaged = true
for (let i = 0; i < DOCS.length; i++) {
  const A = off[i].live, B = on[i].live
  const same = A.length === B.length && A.every((v, k) => v === B[k])
  const engaged = on[i].arith
  allSame = allSame && same; allEngaged = allEngaged && engaged
  console.log(`[${DOCS[i].id}] arith engaged=${engaged} ${on[i].dump ? `(${on[i].dump.nBlocks}blk/${on[i].dump.nLines}ln)` : ''}  gaps dom=${A.length} arith=${B.length}  IDENTICAL=${same}`)
  if (!same) {
    let divs = 0, first = -1
    for (let k = 0; k < Math.max(A.length, B.length); k++) if (A[k] !== B[k]) { divs++; if (first < 0) first = k }
    console.log(`    divergences ${divs}/${Math.max(A.length, B.length)}; first idx ${first}: dom=${A[first]} arith=${B[first]} (Δ ${B[first] - A[first]})`)
    console.log(`    dom : ${JSON.stringify(A.slice(0, 10))}`)
    console.log(`    arith: ${JSON.stringify(B.slice(0, 10))}`)
  }
}
console.log('---')
console.log('WHOLE-DOC ARITH ENGAGED on all docs:', allEngaged)
console.log('ARITH == DOM on all eligible-prose docs:', allSame)
process.exit(allEngaged && allSame ? 0 : 1)
