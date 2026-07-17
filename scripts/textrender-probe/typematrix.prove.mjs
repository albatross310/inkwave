// PETER'S BAR: "perfectly accurate across all text types we currently support — and if not possible
// then give the reason".
//
// This is the answer, per type. For each type it compares the model's break DOC POSITIONS against
// the LIVE EDITOR's own gap widgets — the same comparison breaks.prove.mjs makes, but for every type
// in the schema instead of only plain paragraphs.
//
// WHAT IT REPLACES. `breaks.prove.mjs` — the whole evidence base for "byte-identical to the live
// editor" — runs on 4,000 words of PLAIN PARAGRAPHS: no citation, heading, list, blockquote,
// codeBlock, taskList, rule, math or refList. It is carried below as the CONTROL (it must stay
// identical, or the harness moved), but it is not the claim.
//
// OFFSETS, NOT COUNTS. My own halvesbisect compared page COUNTS and reported Δ0 for lists — while
// the break POSITIONS diverged (model 55p / live 55p, first divergence at break 23, Δ −14). A page
// count agreeing while positions differ is exactly how wrong words sit on a right-numbered page.
// Everything here compares `model.breaks[].at` to `liveBreaks()` elementwise.
//
// THE DISCRIMINATION GATE, per row. A fixture that does not actually CONTAIN its type, or produces
// no breaks, certifies nothing — and would print a comfortable ✓. Each row therefore asserts the
// node/mark count from the doc itself and a minimum break count BEFORE its verdict is read. A row
// that cannot fail is reported as VOID, never as a pass.
//
// THE MATRIX, not the list. lists+headings diverged at break 2 by −80 while headings ALONE were
// byte-identical. Types interact, so singles cannot certify the set: pairs and the full set run too.
import { chromium } from '@playwright/test'
import { buildTypeDoc, countTypes } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const WORDS = Number(process.env.WORDS || 13000)
const MIN_BREAKS = 8

// The legacy control — breaks.prove.mjs's own document, rebuilt here so a harness drift is visible.
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
  return { id: 'legacy', title: 'legacy', contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fid' }
}

// EVERY renderable type in the schema (17 nodes / 11 marks, read from typeCensus()). `doc` and
// `text` are structural; `listItem`/`taskItem` are covered by their lists.
const SINGLES = [
  ['paragraph (baseline)', []],
  ['heading', ['heading']],
  ['bulletList', ['bulletList']],
  ['orderedList', ['orderedList']],
  ['taskList', ['taskList']],
  ['blockquote', ['blockquote']],
  ['codeBlock', ['codeBlock']],
  ['horizontalRule', ['horizontalRule']],
  ['hardBreak', ['hardBreak']],
  ['citation', ['citation']],
  ['mathInline', ['mathInline']],
  ['mathBlock', ['mathBlock']],
  ['referenceList', ['referenceList']],
]
const MARKS = [
  ['mark bold', ['bold']],
  ['mark italic', ['italic']],
  ['mark underline', ['underline']],
  ['mark strike', ['strike']],
  ['mark code', ['code']],
  ['mark highlight', ['highlight']],
  ['mark textStyle:fontFamily', ['textStyle:fontFamily']],
  ['mark textStyle:fontSize', ['textStyle:fontSize']],
  ['mark scasSlot', ['scasSlot']],
  ['mark comment', ['comment']],
  ['mark insertion', ['insertion']],
  ['mark deletion', ['deletion']],
]
// Pairs with heading — because lists+headings was worse than either alone. If an interaction exists
// anywhere it most likely rides block spacing, and heading is the block whose spacing differs most.
const PAIRS = [
  ['heading + bulletList', ['heading', 'bulletList']],
  ['heading + orderedList', ['heading', 'orderedList']],
  ['heading + taskList', ['heading', 'taskList']],
  ['heading + blockquote', ['heading', 'blockquote']],
  ['heading + codeBlock', ['heading', 'codeBlock']],
  ['heading + citation', ['heading', 'citation']],
]
const FULL = [
  ['EVERYTHING (thesis shape)', ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'citation', 'referenceList', 'bold', 'italic', 'textStyle:fontFamily']],
  ['EVERYTHING + math', ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'citation', 'referenceList', 'mathInline', 'mathBlock', 'bold', 'italic', 'textStyle:fontFamily']],
]

// A type's presence is asserted from the DOC, so a fixture that silently failed to build its type
// cannot print a pass. Maps a row's label to the node/mark keys that must appear.
const REQUIRE = {
  heading: ['heading'], bulletList: ['bulletList', 'listItem'], orderedList: ['orderedList', 'listItem'],
  taskList: ['taskList', 'taskItem'], blockquote: ['blockquote'], codeBlock: ['codeBlock'],
  horizontalRule: ['horizontalRule'], hardBreak: ['hardBreak'], citation: ['citation'],
  mathInline: ['mathInline'], mathBlock: ['mathBlock'], referenceList: ['referenceList'],
  bold: ['mark:bold'], italic: ['mark:italic'], underline: ['mark:underline'], strike: ['mark:strike'],
  code: ['mark:code'], highlight: ['mark:highlight'], 'textStyle:fontFamily': ['mark:textStyle'],
  'textStyle:fontSize': ['mark:textStyle'], scasSlot: ['mark:scasSlot'], comment: ['mark:comment'],
  insertion: ['mark:insertion'], deletion: ['mark:deletion'],
}

async function measure(page, doc, minWords) {
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  try {
    await page.waitForFunction((w) => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, minWords, { timeout: 60000 })
  } catch { return { err: 'doc never loaded (schema rejected it?)' } }
  await page.waitForTimeout(4500)
  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) return { err: `probe blind (fonts=${st.fontsReallyLoaded} pos=${st.seesKnownPositive})` }
  return page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    for (let i = 0; i < 3; i++) p.build() // warm: 12 identical calls go 291.7 → 81.8ms settled
    const { model } = p.build()
    const live = p.liveBreaks()
    const mine = model.breaks.map((x) => x.at)
    let firstDiv = -1
    for (let i = 0; i < Math.max(mine.length, live.length); i++) if (mine[i] !== live[i]) { firstDiv = i; break }
    let matched = 0
    for (let i = 0; i < Math.min(mine.length, live.length); i++) if (mine[i] === live[i]) matched++
    const kinds = {}
    for (const b of model.blocks) { const k = `${b.kind}:${b.type}`; kinds[k] = (kinds[k] || 0) + 1 }
    return {
      mineLen: mine.length, liveLen: live.length, firstDiv, matched,
      mineAt: firstDiv >= 0 ? (mine[firstDiv] ?? null) : null,
      liveAt: firstDiv >= 0 ? (live[firstDiv] ?? null) : null,
      pages: model.pages, est: model.estimatedBlocks, reliablePages: model.reliablePages,
      breaksReliable: model.breaksReliable, kinds,
    }
  })
}

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const ok = await page.evaluate(() => typeof window.__iwTextRenderProbe?.liveBreaks === 'function' && typeof window.__iwTextRenderProbe?.typeCensus === 'function')
  if (!ok) { console.log('VOID — served bundle lacks liveBreaks/typeCensus: NOT our build.'); await b.close(); process.exit(1) }

  const census = await page.evaluate(() => window.__iwTextRenderProbe.typeCensus())
  console.log(`\n╔══ PER-TYPE ACCURACY — the model's break positions vs the LIVE EDITOR's own gap widgets`)
  console.log(`║  Schema (read live, not from a list): ${census.nodeCount} nodes · ${census.markCount} marks`)
  console.log(`╚══ OFFSETS, not page counts. ~${WORDS} words/fixture. A row that cannot fail prints VOID.\n`)

  const rows = []
  const runRow = async (label, types, docOverride) => {
    const doc = docOverride ?? buildTypeDoc({ types, words: WORDS, id: label.replace(/\W+/g, '') })
    const counts = countTypes(doc.contentJson)
    // DISCRIMINATION GATE — the fixture must contain what it claims to test.
    const missing = []
    for (const t of types) for (const need of (REQUIRE[t] ?? [])) if (!counts[need]) missing.push(need)
    const r = await measure(page, doc, Math.min(3000, WORDS * 0.4))
    if (r.err) { console.log(`  ${label.padEnd(28)} VOID — ${r.err}`); rows.push([label, null, 'VOID']); return }
    if (missing.length) { console.log(`  ${label.padEnd(28)} VOID — fixture lacks ${missing.join(',')} (cannot test what isn't there)`); rows.push([label, r, 'VOID']); return }
    if (r.liveLen < MIN_BREAKS) { console.log(`  ${label.padEnd(28)} VOID — only ${r.liveLen} live breaks (<${MIN_BREAKS}); too few to land on the type`); rows.push([label, r, 'VOID']); return }
    const same = r.mineLen === r.liveLen && r.firstDiv === -1
    const present = types.map((t) => (REQUIRE[t] ?? []).map((k) => `${k.replace('mark:', '')}×${counts[k] ?? 0}`).join('/')).filter(Boolean).join(' ')
    const verdict = same
      ? `✓ IDENTICAL (${r.liveLen} breaks)`
      : `✗ div@${r.firstDiv}/${r.liveLen} mine ${r.mineAt} live ${r.liveAt} Δ${(r.mineAt ?? 0) - (r.liveAt ?? 0)} · matched ${r.matched}/${r.liveLen}`
    const honesty = r.est > 0 || r.reliablePages < r.pages ? ` · DECLARED est${r.est} reliable ${r.reliablePages}/${r.pages}` : ` · claims FULL reliability (${r.pages}p)`
    console.log(`  ${label.padEnd(28)} ${verdict}${same ? '' : honesty}`)
    if (!same) console.log(`  ${''.padEnd(28)}   ${present}`)
    rows.push([label, r, same ? 'PASS' : 'FAIL'])
  }

  console.log('── CONTROL ──')
  await runRow('LEGACY prose 4k (breaks.prove)', [], legacyProseDoc())
  const control = rows[0]
  if (control[2] !== 'PASS') {
    console.log('\nVOID — the legacy prose control is not identical. The harness (or the model) moved for an')
    console.log('       unrelated reason; no row below can be attributed to its type. Fix this first.')
    await b.close(); process.exit(1)
  }

  console.log('\n── SINGLE TYPES ──')
  for (const [l, t] of SINGLES) await runRow(l, t)
  console.log('\n── MARKS ──')
  for (const [l, t] of MARKS) await runRow(l, t)
  console.log('\n── PAIRS (interactions — lists+headings was worse than either alone) ──')
  for (const [l, t] of PAIRS) await runRow(l, t)
  console.log('\n── FULL SET ──')
  for (const [l, t] of FULL) await runRow(l, t)
  await b.close()

  const pass = rows.filter(([, , v]) => v === 'PASS')
  const fail = rows.filter(([, , v]) => v === 'FAIL')
  const vd = rows.filter(([, , v]) => v === 'VOID')
  console.log(`\n══ SUMMARY ══  ${pass.length} identical · ${fail.length} divergent · ${vd.length} void of ${rows.length}`)
  if (fail.length) {
    console.log('\n  DIVERGENT — each needs a stated reason, per Peter\'s bar:')
    for (const [l, r] of fail) {
      const silent = r.est === 0 && r.reliablePages >= r.pages
      console.log(`    • ${l.padEnd(26)} Δ${(r.mineAt ?? 0) - (r.liveAt ?? 0)} at break ${r.firstDiv} — ${silent ? 'SILENT: claims full reliability while wrong' : `DECLARED (est ${r.est}, reliable ${r.reliablePages}/${r.pages})`}`)
    }
    console.log('\n  A DECLARED miss is shippable (the model knows it is guessing and reliablePages says so).')
    console.log('  A SILENT one is not: wrong words on a page, reported trustworthy.')
  }
  if (vd.length) { console.log('\n  VOID (no verdict — the row could not fail):'); for (const [l] of vd) console.log(`    • ${l}`) }
}
run().catch((e) => { console.error(e); process.exit(1) })
