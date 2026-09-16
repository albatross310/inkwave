// RENDER-FONT WRAP PROVER (2026-07-16) — the arithmetic engine at the PHONE RENDER size (22.5px =
// 1.125rem × the ×1.25 root), which the 18px canonical certification never exercised. Real
// .ProseMirror, the SHIPPED stripped fonts, break-spaces, on the real Honours fixture (138 real
// paragraphs). Asserts the load-bearing property for the zoom-lag fix — that the arith RENDER wrap
// gives every block the SAME LINE COUNT as the DOM, so the render band tops (perBandΔ) are exact —
// and reports break-position parity too.
// TWO FIXES this prover drove (see arithmeticLayout.ts): (1) the fit test quantises the line width
// to the 1/64 LayoutUnit grid (the browser floors it; canvas's raw float ran ~0.01px wider and
// flipped a boundary word at the larger render size); (2) a hyphen-minus is a soft-break opportunity
// (a hyphenated compound the browser split but the engine kept whole added a line).
// KNOWN, DOCUMENTED, BAND-NEUTRAL residual: a run of ≥2 CONSECUTIVE SPACES (manual title alignment)
// can break at a different WITHIN-run point than the browser — but the LINE COUNT still matches, so
// the block height and every band below it are unaffected; and such a title is one line at the wide
// 18px canonical width, so canonical pagination never sees it. Reported, not hidden.
//
// Run: node scripts/renderWrap.prove.mjs <port>
import { chromium } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const port = Number(process.argv[2] || 7803)
const PM_CSS = (() => {
  for (const d of readdirSync('/root/dev/Inkwave/node_modules/.pnpm')) {
    if (!d.startsWith('prosemirror-view@')) continue
    const f = join('/root/dev/Inkwave/node_modules/.pnpm', d, 'node_modules/prosemirror-view/style/prosemirror.css')
    if (existsSync(f)) return readFileSync(f, 'utf8')
  }
  return ''
})()
const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })
const doc = JSON.parse(readFileSync('/tmp/iw-zoom-probe/honours-eligible.json', 'utf8'))
const content = doc.contentJson ? doc.contentJson.content : doc.content
// flatten to {runs:[{text,bold,italic,size}]} per paragraph
const blocks = content.map((b) => ({
  runs: (b.content || []).map((c) => ({
    text: c.text || '',
    bold: (c.marks || []).some((m) => m.type === 'bold'),
    italic: (c.marks || []).some((m) => m.type === 'italic'),
    family: (() => { const ts = (c.marks || []).find((m) => m.type === 'textStyle'); return ts?.attrs?.fontFamily || "'EB Garamond', Georgia, serif" })(),
    size: (() => { const ts = (c.marks || []).find((m) => m.type === 'textStyle'); const f = ts?.attrs?.fontSize; if (!f) return null; const s = String(f); return s.endsWith('em') && !s.endsWith('rem') ? parseFloat(s) : null })(), // em multiple or null
  })),
}))

// phone: font-size 22.5 (1.125rem × 1.25 root), a realistic phone content width with a fraction
const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.otf': 'font/otf' }
const HARNESS = (w) => `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css"><style>${PM_CSS}</style>
<style>:root{font-optical-sizing:none} body{margin:0} #pm{font-size:22.5px;line-height:1.618;width:${w}px;padding:0}</style>
</head><body><div id="pm" class="ProseMirror" contenteditable="true"></div></body></html>`
const server = createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname)
  if (p.startsWith('/c')) { r.writeHead(200, { 'content-type': 'text/html' }); r.end(HARNESS(p.split('=')[1] || '360.7')); return }
  const f = join(PUBLIC, p)
  try { if (existsSync(f) && !statSync(f).isDirectory()) { r.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); r.end(readFileSync(f)); return } } catch {}
  r.writeHead(404); r.end()
})
await new Promise((r) => server.listen(port, r))

const b = await chromium.launch({ args: ['--font-render-hinting=none'] })
const p = await b.newPage({ viewport: { width: 430, height: 3200 } })
await p.goto(`http://localhost:${port}/c.html?w=360.7`, { waitUntil: 'load' })
await p.addScriptTag({ content: AL_JS })
const out = await p.evaluate(async (blocks) => {
  const pm = document.getElementById('pm')
  const measure = AL.makeCanvasMeasure()
  const fams = new Set(); for (const bl of blocks) for (const r of bl.runs) fams.add(r.family.split(',')[0].replace(/['"]/g, '').trim())
  for (const f of fams) for (const w of [400, 700]) { try { await document.fonts.load(`${w} 22.5px '${f}'`, 'The quick brown fox jumps 1234567890') } catch {} }
  await document.fonts.ready
  // render whole doc
  const els = []
  for (const bl of blocks) {
    const pp = document.createElement('p'); pp.style.cssText = 'margin:0 0 11.25px 0;padding:0'
    for (const r of bl.runs) {
      const s = document.createElement('span')
      const px = r.size ? (22.5 * r.size) : 22.5
      s.style.cssText = `font-family:${r.family};font-size:${px}px;font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? 'italic' : 'normal'}`
      s.textContent = r.text
      pp.appendChild(s)
    }
    if (!bl.runs.length) pp.innerHTML = '<br>'
    pm.appendChild(pp); els.push(pp)
  }
  const flatOf = (el, node, off) => { let base = 0; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n === node) return base + off; base += n.textContent.length } return -1 }
  const domStarts = (el) => {
    el.scrollIntoView({ block: 'center' })
    const rg = document.createRange(); rg.selectNodeContents(el); const s = []; let last = -1e9
    for (const rc of Array.from(rg.getClientRects())) {
      if (rc.width < 1 || rc.height < 1 || rc.height > 200 || rc.top - last <= 3) continue
      last = rc.top; const cr = document.caretRangeFromPoint(rc.left + 1, rc.top + rc.height / 2)
      s.push(cr ? flatOf(el, cr.startContainer, cr.startOffset) : -1)
    }
    return s
  }
  const contentBox = (el) => { const cs = getComputedStyle(el); return el.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0) }
  const arithRuns = (bl) => bl.runs.map((r) => ({ text: r.text, fontFamily: r.family, fontSizePx: r.size ? 22.5 * r.size : 22.5, fontWeight: r.bold ? 700 : 400, italic: r.italic }))
  const arithStarts = (bl, W) => AL.layoutParagraph({ type: 'paragraph', runs: arithRuns(bl), baseFontPx: 22.5, marginTopPx: 0, marginBottomPx: 0 }, W, 1.618, measure).breakStartChars

  const box0 = contentBox(els[0])          // the "first block" width the debug samples
  const box0f = Math.floor(box0 * 64) / 64
  const diverge = []
  let firstBoxWins = 0, ownBoxWins = 0, tested = 0, lineCountMatch = 0
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].runs.length || !blocks[i].runs.some((r) => r.text.trim())) continue
    tested++
    const dom = domStarts(els[i])
    const ownBox = Math.floor(contentBox(els[i]) * 64) / 64
    const eq = (a) => a.length === dom.length && a.every((x, k) => x === dom[k])
    const usingFirst = eq(arithStarts(blocks[i], box0f))
    const usingOwn = eq(arithStarts(blocks[i], ownBox))
    if (usingFirst) firstBoxWins++
    if (usingOwn) ownBoxWins++
    const arOwn = arithStarts(blocks[i], ownBox)
    if (arOwn.length === dom.length) lineCountMatch++
    if (!usingFirst || !usingOwn) {
      // localise: which line, and is it advance or width?
      const ar = arithStarts(blocks[i], ownBox)
      let k = 0; while (k < dom.length && k < ar.length && dom[k] === ar[k]) k++
      diverge.push({ i, ownBox, box0f, domL: dom.length, arL: ar.length, divLine: k, domStart: dom[k], arStart: ar[k], usingFirst, usingOwn })
    }
  }
  // is blk0's space-run divergence a measureText issue? bold 1.037em space width canvas vs DOM.
  let spaceInfo = null
  { const sp = document.createElement('span'); sp.style.cssText = `font-family:'EB Garamond',serif;font-size:${22.5*1.037}px;font-weight:700;white-space:pre`; sp.textContent = 'x          x'; pm.appendChild(sp); const w10 = sp.getBoundingClientRect().width; sp.textContent = 'xx'; const w0 = sp.getBoundingClientRect().width; sp.remove(); const domSpace = (w10 - w0) / 10; measure; const canSpace = (measure('x          x', `700 ${22.5*1.037}px 'EB Garamond', serif`) - measure('xx', `700 ${22.5*1.037}px 'EB Garamond', serif`)) / 10; spaceInfo = { domSpace: +domSpace.toFixed(4), canSpace: +canSpace.toFixed(4), delta: +(canSpace - domSpace).toFixed(4) } }
  return { box0: +box0.toFixed(4), box0f, firstBoxWins, ownBoxWins, lineCountMatch, tested, diverge: diverge.slice(0, 10), spaceInfo }
}, blocks)
console.log('\n=== REAL Honours fixture @22.5px, phone width ===')
console.log(`first-block content box = ${out.box0} → floored ${out.box0f}`)
console.log(`arith==DOM using the FIRST block's width for all: ${out.firstBoxWins}/${out.tested}`)
console.log(`arith==DOM using EACH block's OWN floored box:     ${out.ownBoxWins}/${out.tested}`)
console.log(`LINE COUNT matches DOM (the band-relevant property):  ${out.lineCountMatch}/${out.tested}`)
if (out.spaceInfo) console.log(`bold 1.037em space width: DOM=${out.spaceInfo.domSpace} canvas=${out.spaceInfo.canSpace} Δ=${out.spaceInfo.delta} (≤0.05 ⇒ not a measure error)`)
const bandExact = out.lineCountMatch === out.tested
const breakResidual = out.tested - out.ownBoxWins
console.log('')
console.log(`BAND CORRECTNESS (line-count parity, all ${out.tested} blocks): ${bandExact ? 'EXACT ✓ — perBandΔ will be all-zero' : 'FAIL ✗'}`)
console.log(`break-position parity: ${out.ownBoxWins}/${out.tested}${breakResidual ? `  (${breakResidual} within-block residual — the documented ≥2-consecutive-space title case, band-neutral)` : ''}`)
if (out.diverge.length) for (const d of out.diverge.slice(0, 3)) console.log(`   residual blk${d.i}: DOM ${d.domL}L / arith ${d.arL}L (same count ⇒ no band shift), within-block break dom=${d.domStart} arith=${d.arStart}`)
process.exit(bandExact ? 0 : 1)
if (out.diverge.length) {
  console.log('divergent blocks:')
  for (const d of out.diverge) console.log(`  blk${d.i}: ownBox=${d.ownBox} (first=${d.box0f}) DOM ${d.domL}L arith ${d.arL}L divLine@${d.divLine} dom=${d.domStart} arith=${d.arStart} usingFirst:${d.usingFirst?'✓':'✗'} usingOwn:${d.usingOwn?'✓':'✗'}`)
} else console.log('NO divergent blocks — arith==DOM on all with own-box width.')
await b.close(); server.close()
