// FORCED MID-PARAGRAPH BREAK PROVER (2026-07-16) — the case the standalone render prover can't see.
// A page-gap widget is `display:block` INSIDE the <p>, so it ends the pre-gap line PARTIAL and text
// resumes on a fresh line after the gap. This probe inserts a real display:block gap at a char
// offset that falls MID render-line (a canonical 18px line start need not be a render line start),
// measures the DOM's resulting line structure, and checks the engine reproduces it with the forced
// break. Real .ProseMirror, shipped stripped fonts, iPhone-13 content box (390 − 2×20 = 350px).
//
// RESULT: with a real display:block gap at a MID-render-line word boundary, the engine's forced
// break reproduces the DOM's gap-forced line COUNT 18/18 (band-relevant — this is what
// __iwCmpBlockLines / perBandΔ measure) and its byte-exact line STARTS 16/18. The 2 start residuals
// are a pre-existing gap-FREE sub-pixel wrap flip at 350px (one block's line-2 boundary word lands
// at the canvas-vs-DOM precision limit) with the SAME line count — band-neutral, the same class as
// the documented multi-space title; it does not shift a band and would only matter if a real gap
// fell exactly on that flipped word. The idle DOM verifier remains the safety net there.
import { chromium } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..'); const PUBLIC = join(ROOT, 'public')
const port = Number(process.argv[2] || 7810)
const PM_CSS = (() => { for (const d of readdirSync('/root/dev/Inkwave/node_modules/.pnpm')) { if (!d.startsWith('prosemirror-view@')) continue; const f = join('/root/dev/Inkwave/node_modules/.pnpm', d, 'node_modules/prosemirror-view/style/prosemirror.css'); if (existsSync(f)) return readFileSync(f, 'utf8') } return '' })()
const { code: AL_JS } = await transformWithEsbuild(readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8'), 'a.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })
const doc = JSON.parse(readFileSync('/tmp/iw-zoom-probe/honours-eligible.json', 'utf8'))
const content = doc.contentJson ? doc.contentJson.content : doc.content
// take the blocks with the most lines (best mid-paragraph gap candidates)
const blocks = content.map((b) => ({
  runs: (b.content || []).map((c) => ({ text: c.text || '', bold: (c.marks || []).some((m) => m.type === 'bold'), italic: (c.marks || []).some((m) => m.type === 'italic'), size: (() => { const t = (c.marks || []).find((m) => m.type === 'textStyle'); const f = t?.attrs?.fontSize; return f && String(f).endsWith('em') ? parseFloat(f) : null })() })),
  len: (b.content || []).reduce((a, c) => a + (c.text || '').length, 0),
})).filter((b) => b.len > 200).slice(0, 20)

const H = `<!doctype html><html><head><link rel="stylesheet" href="/fonts/inkwave-fonts.css"><style>${PM_CSS}</style>
<style>:root{font-optical-sizing:none}body{margin:0}#pm{font-size:22.5px;line-height:1.618;width:350px;padding:0}</style></head>
<body><div id=pm class=ProseMirror contenteditable=true></div></body></html>`
const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.otf': 'font/otf' }
const server = createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/c.html') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(H); return } const f = join(PUBLIC, p); try { if (existsSync(f) && !statSync(f).isDirectory()) { r.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); r.end(readFileSync(f)); return } } catch {} r.writeHead(404); r.end() })
await new Promise((r) => server.listen(port, r))
const b = await chromium.launch({ args: ['--font-render-hinting=none'] })
const p = await b.newPage({ viewport: { width: 430, height: 2600 } })
await p.goto(`http://localhost:${port}/c.html`, { waitUntil: 'load' })
await p.addScriptTag({ content: AL_JS })
const out = await p.evaluate(async (blocks) => {
  const pm = document.getElementById('pm')
  const fams = new Set(); for (const bl of blocks) for (const r of bl.runs) fams.add("EB Garamond")
  for (const f of fams) for (const w of [400, 700]) { try { await document.fonts.load(`${w} 24px '${f}'`, 'x'); await document.fonts.load(`italic 400 24px '${f}'`, 'x') } catch {} }
  await document.fonts.ready
  const measure = AL.makeCanvasMeasure()

  const buildP = () => { const pp = document.createElement('p'); pp.style.cssText = 'margin:0;padding:0'; return pp }
  const fill = (pp, runs) => { for (const r of runs) { const s = document.createElement('span'); const px = r.size ? 22.5 * r.size : 22.5; s.style.cssText = `font-family:'EB Garamond',serif;font-size:${px}px;font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? 'italic' : 'normal'}`; s.textContent = r.text; pp.appendChild(s) } }
  // line starts of a paragraph element (posAtCoords convention)
  const flatOf = (el, node, off) => { let base = 0; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n === node) return base + off; base += n.textContent.length } return -1 }
  const lineStarts = (el) => {
    el.scrollIntoView({ block: 'center' })
    const rg = document.createRange(); rg.selectNodeContents(el); const s = []; let last = -1e9
    for (const rc of Array.from(rg.getClientRects())) { if (rc.width < 1 || rc.height < 1 || rc.height > 200 || rc.top - last <= 3) continue; last = rc.top; const cr = document.caretRangeFromPoint(rc.left + 1, rc.top + rc.height / 2); s.push(cr ? flatOf(el, cr.startContainer, cr.startOffset) : -1) }
    return s
  }
  const arithRuns = (runs) => runs.map((r) => ({ text: r.text, fontFamily: "'EB Garamond', serif", fontSizePx: r.size ? 22.5 * r.size : 22.5, fontWeight: r.bold ? 700 : 400, italic: r.italic }))
  const W = (() => { const pp = buildP(); pm.appendChild(pp); const cs = getComputedStyle(pp); const w = pp.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0); pp.remove(); return w })()

  // insert a display:block gap into the DOM paragraph at a given flat char offset (splits the text node)
  const withGap = (runs, gapChar) => {
    const pp = buildP()
    // build with a marker: rebuild runs splitting the run that contains gapChar
    let acc = 0
    for (const r of runs) {
      if (gapChar > acc && gapChar < acc + r.text.length) {
        const rel = gapChar - acc
        const mk = (t) => { const s = document.createElement('span'); const px = r.size ? 22.5 * r.size : 22.5; s.style.cssText = `font-family:'EB Garamond',serif;font-size:${px}px;font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? 'italic' : 'normal'}`; s.textContent = t; return s }
        if (r.text.slice(0, rel)) pp.appendChild(mk(r.text.slice(0, rel)))
        const gap = document.createElement('span'); gap.style.cssText = 'display:block;height:32px;width:100%'; gap.setAttribute('data-gap', ''); pp.appendChild(gap)
        if (r.text.slice(rel)) pp.appendChild(mk(r.text.slice(rel)))
      } else {
        const s = document.createElement('span'); const px = r.size ? 22.5 * r.size : 22.5; s.style.cssText = `font-family:'EB Garamond',serif;font-size:${px}px;font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? 'italic' : 'normal'}`; s.textContent = r.text; pp.appendChild(s)
      }
      acc += r.text.length
    }
    return pp
  }

  let tested = 0, matchNoForce = 0, matchForce = 0, matchForceCount = 0, fails = []
  for (const bl of blocks) {
    // gap-free DOM line starts to pick a MID-line gap position (a char that is NOT a render line start)
    const p0 = buildP(); fill(p0, bl.runs); pm.appendChild(p0)
    const domStarts0 = lineStarts(p0)
    const fullText = bl.runs.map(r => r.text).join('')
    p0.remove()
    if (domStarts0.length < 4) continue
    // gap = a WORD BOUNDARY (first char after a space) strictly inside render line 2 — mid-line, so
    // it forces the pre-gap line partial (the real gaps land at canonical-18px line starts = word
    // boundaries that need not be render line starts). Search between start[2] and start[3].
    let gapChar = -1
    for (let k = domStarts0[2] + 1; k < domStarts0[3]; k++) { if (/\s/.test(fullText[k - 1]) && !/\s/.test(fullText[k])) { gapChar = k; break } }
    if (gapChar < 0 || domStarts0.includes(gapChar)) continue

    // DOM with the gap widget
    const pg = withGap(bl.runs, gapChar); pm.appendChild(pg)
    const gapEl = pg.querySelector('[data-gap]')
    if (!gapEl) { pg.remove(); continue } // gap fell at a run boundary — skip (needs mid-run)
    pg.scrollIntoView({ block: 'center' })
    // PER-CHAR line starts over the TEXT NODES (excludes the gap element) — the authoritative method
    // (a per-node selectNodeContents count over-counts split spans). Flat offset into the block text.
    const gapStarts = []
    { const walker = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT); const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n)
      let base = 0, last = -1e9, rg = document.createRange()
      for (const nd of nodes) { for (let i = 0; i < nd.textContent.length; i++) { rg.setStart(nd, i); rg.setEnd(nd, i + 1); const rc = rg.getBoundingClientRect(); if (rc.width === 0 && rc.height === 0) continue; if (rc.top - last > 3) { gapStarts.push(base + i); last = rc.top } } base += nd.textContent.length } }
    pg.remove()

    // arith: forced break at gapChar (a line must start there)
    const layNo = AL.layoutParagraph({ type: 'paragraph', runs: arithRuns(bl.runs), baseFontPx: 22.5, marginTopPx: 0, marginBottomPx: 0 }, W, 1.618, measure)
    const layForce = AL.layoutParagraph({ type: 'paragraph', runs: arithRuns(bl.runs), baseFontPx: 22.5, marginTopPx: 0, marginBottomPx: 0 }, W, 1.618, measure, AL.EDITOR_WHITE_SPACE, [gapChar])
    tested++
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    if (layNo.breakStartChars.length === gapStarts.length) matchNoForce++
    if (eq(layForce.breakStartChars, gapStarts)) matchForce++
    if (layForce.breakStartChars.length === gapStarts.length) matchForceCount++
    if (!eq(layForce.breakStartChars, gapStarts) && fails.length < 5) fails.push({ len: bl.len, gapChar, sameCount: layForce.breakStartChars.length === gapStarts.length, domStarts: gapStarts.slice(0, 8), arStarts: layForce.breakStartChars.slice(0, 8) })
  }
  return { tested, matchNoForce, matchForce, matchForceCount, fails, W: +W.toFixed(4) }
}, blocks)
console.log(`\n=== FORCED MID-PARAGRAPH BREAK — real display:block gap @ render width ${out.W} (iPhone-13 box) ===\n`)
console.log(`blocks tested (with a MID-render-line gap): ${out.tested}`)
console.log(`  arith == DOM line count  WITHOUT forced break: ${out.matchNoForce}/${out.tested}  ← the drift (fills the slack)`)
console.log(`  arith line STARTS == DOM  WITH forced break: ${out.matchForce}/${out.tested}  ← byte-exact starts`)
console.log(`  arith line COUNT  == DOM  WITH forced break: ${out.matchForceCount}/${out.tested}  ← band-relevant (__iwCmpBlockLines)`)
if (out.fails.length) { console.log('  residual fails:'); for (const f of out.fails) console.log(`    len=${f.len} gap@${f.gapChar}\n      DOM  ${JSON.stringify(f.domStarts)}\n      arith${JSON.stringify(f.arStarts)}  sameLineCount=${f.sameCount}`) }
const pass = out.matchForceCount === out.tested && out.tested > 0 // band-relevant: line COUNTS exact
console.log(pass ? '\n⇒ THE FORCED BREAK REPRODUCES THE GAP-FORCED LINE COUNT EXACTLY.' : '\n⇒ NOT CLEAN — see fails.')
await b.close(); server.close()
process.exit(pass ? 0 : 1)
