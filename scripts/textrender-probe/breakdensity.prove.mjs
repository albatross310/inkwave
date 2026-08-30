// IS "THE MODEL'S BREAKS ARE BYTE-IDENTICAL TO THE LIVE EDITOR" TRUE, OR TRUE ON ONE FIXTURE?
//
// `breaks.prove.mjs` is the load-bearing proof of this branch and the sentence everyone quotes. Read
// its fixture:
//     contentJson: { type:'doc', content: paras.map(t => ({ type:'paragraph', content:[{type:'text',text:t}] })) }
// **4,000 words of plain paragraphs. Not one citation, heading, list, blockquote or refList.** The
// claim has never been tested against a single citation — and `halvesbisect.prove.mjs` measured the
// model reading 57 pages against the editor's 56 at 174 citations / 13k words. So the claim is not
// wrong so much as BOUNDED, and nobody knew where the boundary was. This probe finds it.
//
// SWEEP, don't sample: one mixed document cannot say which ingredient or what density breaks the
// claim (the isolate/linecount lesson — math showed 0 mid-line breaks unfixed because no break
// happened to land on one). So hold words fixed and vary citation density, with the legacy
// prose-only fixture carried along as the CONTROL that must stay IDENTICAL.
//
// THE DIAGNOSTIC THAT SEPARATES THE TWO CAUSES, and the reason this probe is worth more than a
// yes/no: `coverage()` reports the citeBox hit/miss counters and the model's estimatedBlocks.
//   • misses > 0  ⇒ citations DEFERRED to placeholders — the self-healing gate firing. The model is
//     then wrong for a KNOWN, declared reason and `reliablePages` should already say so.
//   • misses == 0 AND breaks diverge ⇒ every citation resolved and the cached ADVANCE is simply
//     wrong. That is a silent error: the model believes it measured, and reports full reliability.
// Those are opposite problems and a page count cannot tell them apart.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'

const BASE = await autoBase()
// The legacy control — byte-for-byte the fixture breaks.prove.mjs builds, so a disagreement here
// would mean the harness moved, not the claim.
function legacyProseDoc() {
  let s = 1337
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds difficult waffles first fifth flourish effigy scaffold').split(/\s+/)
  const paras = []; let w = 0
  while (w < 4000) {
    const n = Math.min(30 + Math.floor(rnd() * 40), 4000 - w)
    const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)])
    const t = o.join(' '); paras.push(t[0].toUpperCase() + t.slice(1) + '.'); w += n
  }
  return { id: 'brk', title: 'brk', contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fid' }
}

const CASES = [
  ['LEGACY prose 4k, 0 cites (breaks.prove.mjs\'s own fixture)', legacyProseDoc(), 3000],
  ['prose 13k, 0 cites',        buildCitationDoc({ words: 13000, cites: 0,   marked: 0, lists: false, refList: false, headings: false, id: 'd0' }), 6000],
  ['13k, 20 cites',             buildCitationDoc({ words: 13000, cites: 20,  marked: 1, lists: false, refList: false, headings: false, id: 'd20' }), 6000],
  ['13k, 80 cites',             buildCitationDoc({ words: 13000, cites: 80,  marked: 1, lists: false, refList: false, headings: false, id: 'd80' }), 6000],
  ['13k, 174 cites (thesis)',   buildCitationDoc({ words: 13000, cites: 174, marked: 1, lists: false, refList: false, headings: false, id: 'd174' }), 6000],
  ['13k, 174 cites UNMARKED',   buildCitationDoc({ words: 13000, cites: 174, marked: 0, lists: false, refList: false, headings: false, id: 'd174u' }), 6000],
  ['4k, 174 cites (dense/short)', buildCitationDoc({ words: 4000, cites: 174, marked: 1, lists: false, refList: false, headings: false, id: 'd174s' }), 2000],
  // CITATIONS ARE EXONERATED by the rows above — every density identical, 0 citeBox misses. So the
  // 57-vs-56 halvesbisect measured is STRUCTURE, not citations: that fixture also carried
  // `lists: true, headings: true`, which this sweep had switched off. My attribution was a guess and
  // the sweep refuted it. Vary the structure instead, at the SAME 13k scale.
  ['13k, 0 cites, + HEADINGS',  buildCitationDoc({ words: 13000, cites: 0, marked: 0, lists: false, refList: false, headings: true, id: 'dh' }), 6000],
  ['13k, 0 cites, + LISTS',     buildCitationDoc({ words: 13000, cites: 0, marked: 0, lists: true,  refList: false, headings: false, id: 'dl' }), 6000],
  ['13k, 0 cites, + LISTS + HEADINGS', buildCitationDoc({ words: 13000, cites: 0, marked: 0, lists: true, refList: false, headings: true, id: 'dlh' }), 6000],
  ['13k, 174 cites + LISTS + HEADINGS (the halvesbisect row)', buildCitationDoc({ words: 13000, cites: 174, marked: 1, lists: true, refList: false, headings: true, id: 'dall' }), 6000],
]

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  // ASSERT THE SERVED CHUNK IS OURS — not merely that the app booted.
  const ok = await page.evaluate(() => typeof window.__iwTextRenderProbe?.liveBreaks === 'function' && typeof window.__iwTextRenderProbe?.coverage === 'function')
  if (!ok) { console.log('VOID — served bundle lacks liveBreaks/coverage: NOT our build.'); await b.close(); process.exit(1) }

  console.log('\n╔══ WHERE DOES "byte-identical to the live editor" STOP BEING TRUE?')
  console.log('║  breaks.prove.mjs proves it on 4k words of PROSE with ZERO citations. That is the whole')
  console.log('╚══ basis of the claim. Hold words fixed, vary citation density, compare to the SAME live editor.\n')

  const rows = []
  for (const [name, doc, minWords] of CASES) {
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
    await page.waitForFunction((w) => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, minWords, { timeout: 90000 })
    await page.waitForTimeout(5000)
    const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
    if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(`  ${name.padEnd(44)} PROBE BLIND — skipped`); continue }
    const r = await page.evaluate(() => {
      const p = window.__iwTextRenderProbe
      for (let i = 0; i < 3; i++) p.build() // warm: JIT tier-up is 291.7 → 81.8ms over 12 calls
      const { model } = p.build()
      const live = p.liveBreaks()
      const cov = p.coverage()
      const mine = model.breaks.map((x) => x.at)
      let firstDiv = -1
      for (let i = 0; i < Math.max(mine.length, live.length); i++) if (mine[i] !== live[i]) { firstDiv = i; break }
      return {
        mine, live, pages: model.pages, est: model.estimatedBlocks, reliablePages: model.reliablePages,
        citeBox: cov.citeBox, firstDiv,
        mineAt: firstDiv >= 0 ? mine[firstDiv] : null, liveAt: firstDiv >= 0 ? live[firstDiv] : null,
      }
    })
    const same = r.mine.length === r.live.length && r.firstDiv === -1
    rows.push([name, r, same])
    const cb = r.citeBox || {}
    const div = same ? 'IDENTICAL' : `div@${r.firstDiv}/${r.live.length}: mine ${r.mineAt} live ${r.liveAt} (Δ ${r.mineAt - r.liveAt})`
    console.log(`  ${name.padEnd(44)} model ${String(r.pages).padStart(3)}p · live ${String(r.live.length + 1).padStart(3)}p · ${same ? '✓' : '✗'} ${div}`)
    console.log(`  ${''.padEnd(44)}   citeBox hits ${cb.hits ?? '?'} / misses ${cb.misses ?? '?'} · harvested ${cb.harvested ?? '?'} · est blocks ${r.est} · reliablePages ${r.reliablePages}/${r.pages}`)
  }
  await b.close()

  // THE GATE: the legacy control must still be IDENTICAL, or the harness moved and nothing below
  // means anything.
  const control = rows[0]
  console.log('\n══ VERDICT ══')
  if (!control) { console.log('VOID — the control did not run.'); process.exit(1) }
  if (!control[2]) {
    console.log('  VOID — the LEGACY prose fixture is no longer identical. That is breaks.prove.mjs\'s own')
    console.log('         document, so the harness (or the model) moved for an unrelated reason and the')
    console.log('         density rows cannot be attributed to citations. Fix this first.')
    process.exit(1)
  }
  console.log('  ✓ control holds: on 4k prose with ZERO citations the model IS byte-identical to the editor.')
  const broken = rows.filter(([, , same]) => !same)
  if (!broken.length) {
    console.log('  Every row identical — the claim holds across citation density AND structure at 13k.')
    console.log('  If halvesbisect still reports 57-vs-56, the difference is in ITS harness, not the model.')
  } else {
    console.log(`  ✗ ${broken.length}/${rows.length - 1} density rows DIVERGE. The claim is FIXTURE-BOUNDED:`)
    for (const [n, r] of broken) {
      const cb = r.citeBox || {}
      const cause = (cb.misses ?? 0) > 0
        ? 'citations MISSED the box cache ⇒ deferred to placeholders (the self-healing gate — declared, not silent)'
        : 'every citation HIT the cache ⇒ the cached ADVANCE is wrong (SILENT: the model reports full reliability)'
      console.log(`      • ${n}: first divergence at break ${r.firstDiv}, Δ ${r.mineAt - r.liveAt} — ${cause}`)
    }
    console.log('\n  "byte-identical to the live editor" must not be quoted without its bound until this is')
    console.log('  attributed and fixed. It is true on prose. It is not established with citations.')
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
