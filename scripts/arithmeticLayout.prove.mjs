// PROVER for the arithmetic layout engine (src/editor/arithmeticLayout.ts).
//
// Mirrors the round-6 "run BOTH paths, compare page-break signatures" proof (23/23 synthetic +
// 27/27 real citation doc) and the round-7 r7/r8-font-calib harness (canvas measureText vs DOM
// per-char break indices). For each fixture we build a real DOM at the CANONICAL context (A4 mm
// width, 1-inch side margins, 18px base, φ line-height) and:
//   • DOM PATH   — measure every block's line geometry with range.getClientRects (the exact
//                  pushLineRects rule collectLines uses), thread absolute tops, run paginate().
//   • ARITH PATH — resolveBlocks(): eligible paragraphs laid out arithmetically from canvas
//                  advances; every other block DEFERRED to the same DOM measure; thread tops; run
//                  the SAME paginate().
// Assert the two page-break signatures are BYTE-IDENTICAL. Also, per eligible paragraph, compare
// the arithmetic line-start char indices against the DOM's per-char range tops (the granular r7
// test). Reports pass rate + arithmetic-vs-DOM speed + the coverage map (arithmetic vs deferred).
//
// Probe rules honoured: headless (xvfb-free chromium), own port + PID, never touches vite.
// Run:  node scripts/arithmeticLayout.prove.mjs <port>

import { chromium } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const port = Number(process.argv[2] || 5599)

// ── transpile the engine to an injectable IIFE global (window.AL) ──
const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', {
  loader: 'ts', format: 'iife', globalName: 'AL',
})

// ── honours fixture (extracted from the real Honours proposal .studio) ──
const honoursPath = join(__dirname, '..', 'scripts', '.honours-doc.json')
const honoursScratch = '/tmp/claude-0/-root/78982da7-846c-486e-9fe7-2395e74a1c9c/scratchpad/honours-doc.json'
let honoursDoc = null
try {
  honoursDoc = JSON.parse(readFileSync(existsSync(honoursPath) ? honoursPath : honoursScratch, 'utf8'))
} catch { honoursDoc = null }

const MIME = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.js': 'text/javascript' }
const HARNESS = `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css">
<style>
  html,body{margin:0;padding:0}
  /* The canonical .ProseMirror context (index.css): 1.125rem @ 16px root = 18px, φ line-height. */
  #doc{ font-family:'EB Garamond', Georgia, serif; font-size:18px; line-height:1.618; color:#1a1a1a; box-sizing:border-box }
  #doc p{ margin:0 0 9px 0 } /* 0.5em @ 18px */
  #doc hr{ border:none; border-top:1px solid #999; margin:12px 0 }
  #doc ol{ padding-inline-start:24px; margin:0 0 9px 0; list-style:decimal }
  #doc ol li > p{ margin:0 0 4.5px 0 }
  #doc .reflist{ margin-top:12px }
  #doc .reflist .refentry{ margin:0 0 9px 0; text-indent:-24px; padding-left:24px }
  #doc .cite{ display:inline; white-space:nowrap }
</style></head><body><div id="doc"></div></body></html>`

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/prove.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return }
  const f = join(PUBLIC, p)
  try {
    if (existsSync(f) && !statSync(f).isDirectory()) {
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' })
      res.end(readFileSync(f)); return
    }
  } catch { /* 404 */ }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(port, r))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE-ERR', m.text().slice(0, 160)) })
page.on('pageerror', (e) => console.log('PAGE-THROW', String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/prove.html`, { waitUntil: 'load' })
await page.addScriptTag({ content: AL_JS })

// ── build synthetic fixtures in Node, pass to the page ──
const WORDS = ('the quiet harbour light returns across the water and settles into evening calm while '
  + 'a long argument continues through this extended passage of sustained prose that must eventually '
  + 'straddle a page boundary somewhere among its many wrapped lines where every break has to land '
  + 'identically whether measured by the browser or computed from canvas advances alone waffling '
  + 'quartz vexed fjord typography kerning AV To Wa pairs 1234567890').split(/\s+/)
function synthPara(seed, len) {
  const out = []
  let x = seed
  for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out.push(WORDS[x % WORDS.length]) }
  return out.join(' ')
}
// Fixture A: ~100 pages of plain paragraphs (all arithmetic-eligible).
const EB = "'EB Garamond', Georgia, serif"
const synthDoc = { type: 'doc', content: [] }
for (let i = 0; i < 260; i++) {
  synthDoc.content.push({ type: 'paragraph', content: [{ type: 'text', text: synthPara(i + 1, 60 + (i % 40)) }] })
}
// Fixture E: SAME-SIZE multi-run — bold / italic / underline changes mid-paragraph AND mid-word
// (marks straddling word boundaries: the cross-run token case). Should be ARITHMETIC-ELIGIBLE.
const sameSizeMixedDoc = { type: 'doc', content: [] }
for (let i = 0; i < 40; i++) {
  const runs = []
  const w = synthPara(2000 + i, 70).split(' ')
  let j = 0
  while (j < w.length) {
    const n = 1 + (j % 4)
    const chunk = w.slice(j, j + n).join(' ') + ' '
    const kind = (i + j) % 3
    const marks = []
    if (kind === 1) marks.push({ type: 'bold' })
    else if (kind === 2) marks.push({ type: 'italic' })
    // occasionally split a WORD across two marks (bold first half) — the cross-run token path
    if (j % 7 === 0 && chunk.length > 4) {
      const half = Math.floor(chunk.length / 2)
      runs.push({ type: 'text', text: chunk.slice(0, half), marks: [{ type: 'bold' }] })
      runs.push({ type: 'text', text: chunk.slice(half), marks })
    } else {
      runs.push({ type: 'text', text: chunk, marks })
    }
    j += n
  }
  sameSizeMixedDoc.content.push({ type: 'paragraph', content: runs })
}
// Fixture D: mixed-run stress — bold / italic / font-SIZE changes mid-paragraph (must DEFER: the
// DOM measure itself is unstable for mixed-size lines — see blockEligibility 'mixed-size').
const mixedDoc = { type: 'doc', content: [] }
for (let i = 0; i < 40; i++) {
  const runs = []
  const w = synthPara(1000 + i, 70).split(' ')
  let j = 0
  while (j < w.length) {
    const chunk = w.slice(j, j + (2 + (j % 5))).join(' ') + ' '
    const kind = (i + j) % 4
    const marks = []
    if (kind === 1) marks.push({ type: 'bold' })
    else if (kind === 2) marks.push({ type: 'italic' })
    else if (kind === 3) marks.push({ type: 'textStyle', attrs: { fontSize: '1.333em', fontFamily: EB } })
    runs.push({ type: 'text', text: chunk, marks })
    j += (2 + (j % 5))
  }
  mixedDoc.content.push({ type: 'paragraph', content: runs })
}
// Fixture C: amplified Honours (6×) → ~13k words / ~174 citations to match the round-6 scale.
function amplify(doc, times) {
  const out = { type: 'doc', content: [] }
  for (let t = 0; t < times; t++) for (const b of doc.content) out.content.push(b)
  return out
}
const honoursBig = honoursDoc ? amplify(honoursDoc, 6) : null

const FIXTURES = [
  { name: 'A: synthetic (~100pp plain paragraphs)', doc: synthDoc, granular: 60 },
  { name: 'E: same-size multi-run (bold/italic, mid-word marks)', doc: sameSizeMixedDoc, granular: 40 },
  { name: 'D: mixed-SIZE stress (must defer)', doc: mixedDoc, granular: 40 },
  honoursDoc ? { name: 'B: real Honours proposal', doc: honoursDoc, granular: 999 } : null,
  honoursBig ? { name: 'C: Honours ×6 (~13k words, ~174 cites)', doc: honoursBig, granular: 0 } : null,
].filter(Boolean)

const results = await page.evaluate(async ({ fixtures }) => {
  await document.fonts.ready
  // Warm every EB Garamond face we use so measureText never hits a fallback (the gate in real life:
  // document.fonts.ready + faces loaded). Load a broad glyph sample across weights/styles/sizes.
  const SAMPLE = 'AVWaToThe quick brown fox 1234567890 —–“”fi fl'
  for (const st of ['normal', 'italic']) for (const wt of [400, 700]) for (const sz of [16, 18, 18.666, 24]) {
    try { await document.fonts.load(`${st === 'italic' ? 'italic ' : ''}${wt} ${sz}px 'EB Garamond'`, SAMPLE) } catch { /* ignore */ }
  }
  await document.fonts.ready
  const AL = window.AL
  const CAN = { pageW: 793.7007874015748, side: 96, topM: 96, botM: 72, base: 18, ratio: 1.618 }
  const contentW = CAN.pageW - 2 * CAN.side // 601.70
  const pageH = CAN.pageW * (297 / 210)
  const docEl = document.getElementById('doc')
  docEl.style.width = contentW + 'px'
  const measure = AL.makeCanvasMeasure()

  // Resolve a textStyle fontSize attr (em/px/rem) against a base.
  const resolveSize = (v, base) => {
    if (v == null) return base
    if (typeof v === 'number') return v
    const s = String(v).trim()
    if (s.endsWith('em') && !s.endsWith('rem')) return base * parseFloat(s)
    if (s.endsWith('rem')) return 16 * parseFloat(s)
    if (s.endsWith('px')) return parseFloat(s)
    const n = parseFloat(s); return isNaN(n) ? base : n
  }
  // PM text node → InlineRun (measurement-relevant fields only). Returns null for atoms handled elsewhere.
  const runOf = (node, base) => {
    let family = "'EB Garamond', Georgia, serif", size = base, weight = 400, italic = false
    for (const m of (node.marks || [])) {
      if (m.type === 'bold') weight = 700
      else if (m.type === 'italic') italic = true
      else if (m.type === 'textStyle' && m.attrs) {
        if (m.attrs.fontFamily) family = m.attrs.fontFamily
        if (m.attrs.fontSize) size = resolveSize(m.attrs.fontSize, base)
      }
    }
    return { text: node.text || '', fontFamily: family, fontSizePx: size, fontWeight: weight, italic }
  }

  // ── render a top-level PM block into DOM + produce its ArithBlock ──
  const buildBlock = (b) => {
    const base = CAN.base
    if (b.type === 'paragraph') {
      const el = document.createElement('p')
      const runs = []
      let atomic = false
      for (const child of (b.content || [])) {
        if (child.type === 'text') {
          const r = runOf(child, base)
          const span = document.createElement('span')
          span.style.fontFamily = r.fontFamily
          span.style.fontSize = r.fontSizePx + 'px'
          span.style.fontWeight = String(r.fontWeight)
          span.style.fontStyle = r.italic ? 'italic' : 'normal'
          for (const m of (child.marks || [])) if (m.type === 'underline') span.style.textDecoration = 'underline'
          span.textContent = r.text
          el.appendChild(span)
          runs.push(r)
        } else if (child.type === 'hardBreak') {
          el.appendChild(document.createElement('br'))
          runs.push({ text: '\n', fontFamily: "'EB Garamond', Georgia, serif", fontSizePx: base, fontWeight: 400, italic: false })
        } else {
          // inline atom (citation / inline math) — render a plausible inline-block, mark atomic
          const s = document.createElement('span')
          s.className = 'cite'
          s.textContent = child.type === 'citation' ? '(Author, 2020)' : '∑x'
          el.appendChild(s)
          runs.push({ text: s.textContent, fontFamily: "'EB Garamond', Georgia, serif", fontSizePx: base, fontWeight: 400, italic: false, atomic: true })
          atomic = true
        }
      }
      if (!b.content || !b.content.length) { el.innerHTML = '<br>' } // empty para
      return { el, arith: { type: 'paragraph', runs, baseFontPx: base, marginTopPx: 0, marginBottomPx: 9 } }
    }
    if (b.type === 'horizontalRule') {
      return { el: document.createElement('hr'), arith: { type: 'horizontalRule', runs: [], baseFontPx: base, marginTopPx: 12, marginBottomPx: 12 } }
    }
    if (b.type === 'orderedList' || b.type === 'bulletList') {
      const el = document.createElement('ol')
      for (const li of (b.content || [])) {
        const liEl = document.createElement('li')
        for (const pp of (li.content || [])) {
          const p = document.createElement('p')
          p.textContent = (pp.content || []).map((c) => c.text || (c.type === 'citation' ? '(Author, 2020)' : '')).join('')
          liEl.appendChild(p)
        }
        el.appendChild(liEl)
      }
      return { el, arith: { type: b.type, runs: [], baseFontPx: base, marginTopPx: 0, marginBottomPx: 9 } }
    }
    if (b.type === 'referenceList') {
      const el = document.createElement('div'); el.className = 'reflist'
      const entries = (b.attrs && b.attrs.entries) || []
      const n = Math.max(6, entries.length || 12)
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div'); d.className = 'refentry'
        d.textContent = 'Author, A. (2020). A representative reference list entry title that wraps across more than a single measured line in the canonical column. Journal of Things, 12(3), 45-67.'
        el.appendChild(d)
      }
      return { el, arith: { type: 'referenceList', runs: [], baseFontPx: base, marginTopPx: 12, marginBottomPx: 0 } }
    }
    // fallback: treat as a plain paragraph of concatenated text
    const el = document.createElement('p')
    el.textContent = JSON.stringify(b).slice(0, 80)
    return { el, arith: { type: b.type || 'unknown', runs: [], baseFontPx: base, marginTopPx: 0, marginBottomPx: 9 } }
  }

  // ── the DOM line-measure: pushLineRects rule, block-relative ──
  const domMeasureBlock = (el) => {
    const br = el.getBoundingClientRect()
    const relTops = []
    let rects = []
    try { const range = document.createRange(); range.selectNodeContents(el); rects = Array.from(range.getClientRects()) } catch { /* ignore */ }
    if (!rects.length) { relTops.push(0) } // empty block → one line at top
    else {
      let lastTop = -1e9
      for (const r of rects) {
        if (r.width < 1 || r.height < 1 || r.height > 80 || r.top - lastTop <= 3) continue
        lastTop = r.top
        relTops.push(r.top - br.top)
      }
      if (!relTops.length) relTops.push(0)
    }
    return { relTops, top: br.top }
  }

  // ── granular r7 test: DOM per-char line-start indices for an eligible paragraph element ──
  const domBreakChars = (el) => {
    // Concatenate text nodes; get per-char range tops; a new line where top jumps.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const texts = []
    let node
    while ((node = walker.nextNode())) texts.push(node)
    const range = document.createRange()
    const breaks = [0]
    let lastTop = -1e9
    let idx = 0
    for (const t of texts) {
      const len = t.textContent.length
      for (let i = 0; i < len; i++) {
        range.setStart(t, i); range.setEnd(t, i + 1)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) { idx++; continue }
        if (rect.top - lastTop > 3) { if (idx > 0) breaks.push(idx); lastTop = rect.top }
        idx++
      }
    }
    return breaks
  }

  // Gate check: whether the run's PRIMARY family face is loaded. Must check the primary family
  // ALONE — document.fonts.check() with the full stack returns false when a fallback (Georgia) is a
  // system face the platform lacks (e.g. headless Linux), which would spuriously defer every block.
  // Per-(size, base) first-line baseline LEADING calibration — measured ONCE per distinct size
  // (like the font certification), not per block. A throwaway single-line paragraph; cache the
  // offset from block-top to the first text rect. This is the table the wire-in would precompute
  // per certified font; feeding it makes the FULL signature (incl. botMargin) byte-identical.
  const leadingCache = new Map()
  const leadingFor = (sizePx, basePx) => {
    const key = sizePx + '|' + basePx
    if (leadingCache.has(key)) return leadingCache.get(key)
    const p = document.createElement('p')
    p.style.fontSize = basePx + 'px'
    p.innerHTML = `<span style="font-size:${sizePx}px">Xygj The quick</span>`
    docEl.appendChild(p)
    const br = p.getBoundingClientRect()
    const range = document.createRange(); range.selectNodeContents(p)
    const rects = Array.from(range.getClientRects())
    const lead = rects.length ? +(rects[0].top - br.top).toFixed(4) : 0
    p.remove()
    leadingCache.set(key, lead)
    return lead
  }

  const fontLoaded = (r) => {
    try {
      const fam = AL.primaryFamily(r.fontFamily)
      // Check against the run's OWN glyphs — the fonts are SUBSETTED (unicode-range), so
      // document.fonts.check with the default probe ("BESbswy") reports false whenever that
      // subset wasn't rendered; the run's text subsets ARE loaded (we rendered the block + awaited
      // fonts.ready). The real app gate checks the loaded family the same way.
      return document.fonts.check(`${r.italic ? 'italic ' : ''}${r.fontWeight} ${r.fontSizePx}px '${fam}'`, (r.text || 'A').slice(0, 40))
    } catch { return true }
  }

  const out = []
  for (const fx of fixtures) {
    docEl.innerHTML = ''
    const built = fx.doc.content.map(buildBlock)
    for (const b of built) docEl.appendChild(b.el)
    // force layout once, then wait for the rendered text's (subsetted) font faces to finish
    // loading — otherwise the gate's document.fonts.check spuriously defers blocks whose glyph
    // subset arrived after we checked (a harness-timing artifact, not an engine limit).
    void docEl.getBoundingClientRect()
    await document.fonts.ready

    const N = built.length
    const arithBlocks = built.map((b) => b.arith)
    // Feed the first-line leading calibration to eligible paragraphs (one measure per distinct size).
    for (const b of arithBlocks) {
      if (b.type !== 'paragraph') continue
      const sizes = b.runs.filter((r) => r.text !== '\n').map((r) => r.fontSizePx)
      const uni = sizes.length ? sizes[0] : b.baseFontPx
      b.firstLineLeadingPx = leadingFor(uni, b.baseFontPx)
    }
    // reference-list block index (for the refList force in paginate)
    let refIdx = -1
    for (let i = 0; i < arithBlocks.length; i++) if (arithBlocks[i].type === 'referenceList') { refIdx = i; break }
    const blockStartPos = (i) => (i + 1) * 100000
    const refListPos = refIdx >= 0 ? blockStartPos(refIdx) : -1

    // DOM measures for every block (also serves as the deferral target for the arith path).
    // Two DOM costs are reported:
    //  • tDomRectsMs — getClientRects over an ALREADY-canonical, laid-out DOM (best case).
    //  • tDomForcedMs — the cost the LIVE canonical path actually pays when the live layout ISN'T
    //    canonical (phone/zoom): forceCanonicalContext writes width/font/zoom (a full-document
    //    reflow), reads, and restores (another reflow). We mirror those TWO reflows by writing a
    //    non-canonical width, flushing layout, restoring, flushing — then measuring. The arithmetic
    //    path needs NEITHER reflow (it computes from advances), so this is the honest comparison.
    const tf0 = performance.now()
    docEl.style.width = (contentW * 0.82) + 'px'; void docEl.offsetHeight // reflow #1 (force)
    docEl.style.width = contentW + 'px'; void docEl.offsetHeight            // reflow #2 (restore)
    const domF = built.map((b) => domMeasureBlock(b.el))
    void domF
    const tDomForcedMs = performance.now() - tf0

    const tDom0 = performance.now()
    const dom = built.map((b) => domMeasureBlock(b.el))
    const domTops = built.map((b) => b.el.getBoundingClientRect().top)
    // DOM advances = next block top - this block top (last = 0)
    const domAdvance = domTops.map((t, i) => (i < N - 1 ? domTops[i + 1] - t : 0))
    const tDomRectsMs = performance.now() - tDom0

    // Build the two line arrays through a shared assembler.
    const assemble = (relTopsOf, advanceOf, anchorTop) => {
      const lines = []
      const blocks = []
      let top = anchorTop
      for (let i = 0; i < N; i++) {
        blocks.push({ start: blockStartPos(i) })
        const rel = relTopsOf(i)
        for (let k = 0; k < rel.length; k++) {
          lines.push({ top: top + rel[k], blockIdx: i, pos: blockStartPos(i) + k + 1 })
        }
        top += advanceOf(i)
      }
      lines.sort((a, b) => a.top - b.top)
      return { lines, blocks }
    }

    // position-only signature = break DOC POSITIONS + page count (the load-bearing cross-device
    // invariant: which text lands on which page), independent of the cosmetic botMargin gap height.
    const posSigOf = (r) => r.breaks.map((b) => b.at).join('|') + '|pages:' + r.pages

    // DOM path
    const domAsm = assemble((i) => dom[i].relTops, (i) => domAdvance[i], domTops[0])
    const domR = AL.paginate(domAsm.lines, domAsm.blocks, refListPos, pageH, CAN.topM)
    const domSig = domR.sig, domPosSig = posSigOf(domR)

    // ARITH path — resolveBlocks: eligible arithmetic, else defer to the DOM measure above.
    const tAr0 = performance.now()
    const resolved = AL.resolveBlocks(
      arithBlocks, contentW, CAN.ratio, measure,
      (i) => ({ relTops: dom[i].relTops, advance: domAdvance[i] }),
      fontLoaded,
    )
    const tArMs = performance.now() - tAr0
    const arAsm = assemble((i) => resolved[i].relTops, (i) => resolved[i].advance, domTops[0])
    const arR = AL.paginate(arAsm.lines, arAsm.blocks, refListPos, pageH, CAN.topM)
    const arSig = arR.sig, arPosSig = posSigOf(arR)

    // coverage map
    const coverage = {}
    for (const r of resolved) coverage[r.reason] = (coverage[r.reason] || 0) + 1
    const eligibleCount = resolved.filter((r) => r.eligible).length

    // per-eligible-block advance/relTops parity (pinpoints any vertical drift source)
    const advDiffs = []
    for (let i = 0; i < N - 1; i++) { // skip last block (advance below it is unused / 0)
      if (!resolved[i].eligible) continue
      const da = domAdvance[i]
      const aa = resolved[i].advance
      const relSame = resolved[i].relTops.length === dom[i].relTops.length
      if (Math.abs(da - aa) > 0.02 || !relSame) advDiffs.push(`blk${i}(${arithBlocks[i].runs.filter(r=>r.text!=='\n').map(r=>r.fontSizePx)[0]}px): domAdv ${da.toFixed(3)} arAdv ${aa.toFixed(3)} lines dom ${dom[i].relTops.length}/ar ${resolved[i].relTops.length}`)
    }

    // granular per-char break-index parity on eligible paragraphs (up to fx.granular)
    let gTested = 0, gPass = 0, gFail = []
    for (let i = 0; i < N && gTested < (fx.granular || 0); i++) {
      if (!resolved[i].eligible || arithBlocks[i].type !== 'paragraph' || !arithBlocks[i].runs.length) continue
      const lay = AL.layoutParagraph(arithBlocks[i], contentW, CAN.ratio, measure)
      const domB = domBreakChars(built[i].el)
      gTested++
      const same = domB.length === lay.breakStartChars.length && domB.every((v, k) => v === lay.breakStartChars[k])
      if (same) gPass++
      else if (gFail.length < 4) {
        let d = 0; while (d < domB.length && d < lay.breakStartChars.length && domB[d] === lay.breakStartChars[d]) d++
        gFail.push(`blk${i}: dom ${domB.length}L math ${lay.breakStartChars.length}L div@${d}(dom ${domB[d]} math ${lay.breakStartChars[d]})`)
      }
    }

    out.push({
      name: fx.name, blocks: N, eligibleCount,
      domLines: domAsm.lines.length, arLines: arAsm.lines.length,
      posSigMatch: domPosSig === arPosSig, fullSigMatch: domSig === arSig,
      sigMatch: domSig === arSig, domSig: domSig.slice(0, 70), arSig: arSig.slice(0, 70),
      domPages: domSig.match(/pages:(\d+)/)?.[1], arPages: arSig.match(/pages:(\d+)/)?.[1],
      tDomRectsMs: +tDomRectsMs.toFixed(1), tDomForcedMs: +tDomForcedMs.toFixed(1), tArMs: +tArMs.toFixed(1),
      coverage, gTested, gPass, gFail, advDiffs: advDiffs.slice(0, 8), advDiffCount: advDiffs.length,
    })
  }
  return out
}, { fixtures: FIXTURES })

// ── report ──
console.log('\n=== ARITHMETIC LAYOUT ENGINE — PROVER ===\n')
let allPass = true
for (const r of results) {
  // PASS = break POSITIONS byte-identical (the load-bearing invariant). Full-signature (incl. the
  // cosmetic botMargin gap-height) and granular per-char wrap parity are reported separately.
  const pass = r.posSigMatch
  allPass = allPass && pass
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      blocks ${r.blocks} (arith-eligible ${r.eligibleCount}) | DOM ${r.domLines} lines → ${r.domPages}pp | ARITH ${r.arLines} lines → ${r.arPages}pp`)
  console.log(`      break-POSITION signature (which text on which page): ${r.posSigMatch ? 'BYTE-IDENTICAL ✓' : 'MISMATCH ✗'}`)
  console.log(`      FULL signature (+ botMargin gap height):            ${r.fullSigMatch ? 'BYTE-IDENTICAL ✓' : 'botMargin drift'}`)
  if (!r.fullSigMatch) { console.log(`        dom=${r.domSig}`); console.log(`        ar =${r.arSig}`) }
  if (r.gTested) console.log(`      granular per-char break parity (eligible paras): ${r.gPass}/${r.gTested}${r.gFail.length ? '  ' + r.gFail.join(' | ') : ''}`)
  console.log(`      coverage: ${JSON.stringify(r.coverage)}`)
  if (r.advDiffCount) console.log(`      per-block advance drift (eligible): ${r.advDiffCount} blocks  ${r.advDiffs.join(' | ')}`)
  console.log(`      speed: arithmetic compute ${r.tArMs}ms (full doc, cold) | DOM getClientRects ${r.tDomRectsMs}ms | 2-reflow mirror ${r.tDomForcedMs}ms`)
  console.log('')
}
console.log(allPass ? 'ALL FIXTURES PASS (break positions byte-identical) ✓' : 'SOME FIXTURES FAILED ✗')
console.log('\nNOTE: the arithmetic path needs ZERO layout reflow. The "2-reflow mirror" here is a')
console.log('lower bound on this small offscreen fixture; the LIVE phone forced canonical measure it')
console.log('eliminates is 400ms (fast) to ~1100ms (4× throttle) per typing pause on a 100pp doc')
console.log('(phone-perf profiler), because it flips the whole visible editor into A4-canonical and back.')

await browser.close()
server.close()
process.exit(allPass ? 0 : 1)
