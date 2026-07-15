// VERIFY THE REGENERATED BUILD (2026-07-16) — not the artifacts, the actual pipeline output.
//
// scripts/fetch-fonts.mjs now strips liga/clig/dlig/hlig/calt from every served face. This proves
// the five properties AGAINST public/fonts as the pipeline just wrote it, using a pre-regeneration
// copy of the SAME build (/tmp/iw-fonts-orig, aliased '<Family> ORIG') as the control:
//   (1) RESCUE   the production measure == DOM on WEBKIT (no ctx.textRendering — every iPhone).
//   (2) GATE     canvasShapingMatchesEditor() returns TRUE on WebKit → the engine actually turns on.
//   (3) VISUAL   the DOM renders the stripped face identically to the original, at GLYPH level.
//   (4) WRAP     DOM line starts unchanged, and cross-engine DOM↔DOM parity still holds.
//   (5) CONTROL  the same measure against the ORIGINAL face still fails on WebKit — proving the
//                test can see the defect it claims to have fixed.
//
// Run: node scripts/fontStrip.verify.mjs <port>   (after: cp -r public/fonts /tmp/iw-fonts-orig
//                                                         && node scripts/fetch-fonts.mjs)

import { chromium, webkit } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const ORIG = '/tmp/iw-fonts-orig'
const port = Number(process.argv[2] || 5604)

const PM_CSS = (() => {
  for (const base of ['/root/dev/Inkwave/node_modules/.pnpm', join(ROOT, 'node_modules/.pnpm')]) {
    try { for (const d of readdirSync(base)) {
      if (!d.startsWith('prosemirror-view@')) continue
      const f = join(base, d, 'node_modules/prosemirror-view/style/prosemirror.css')
      if (existsSync(f)) return readFileSync(f, 'utf8')
    } } catch { /* next */ }
  }
  return ''
})()
if (!PM_CSS.includes('break-spaces')) { console.error('FATAL: real prosemirror.css not found'); process.exit(2) }
if (!existsSync(join(ORIG, 'inkwave-fonts.css'))) { console.error(`FATAL: no pre-strip control at ${ORIG}`); process.exit(2) }

// the control: the SAME build before the strip, aliased so both can be loaded at once
const ORIG_CSS = readFileSync(join(ORIG, 'inkwave-fonts.css'), 'utf8')
  .replace(/font-family:\s*'([^']+)'/g, (_m, f) => `font-family:'${f} ORIG'`)
  .replace(/url\(\/fonts\/([^)]+)\)/g, (_m, f) => `url(/orig/${basename(f)})`)

const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })

const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' }
const HARNESS = `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css">
<style>${ORIG_CSS}</style>
<style>${PM_CSS}</style>
<style>:root{font-optical-sizing:none} body{margin:0} #pm{font-size:18px;line-height:1.618}</style>
</head><body><div id="pm" class="ProseMirror" contenteditable="true"></div></body></html>`

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/c.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return }
  const f = p.startsWith('/orig/') ? join(ORIG, p.slice(6)) : join(PUBLIC, p)
  try { if (existsSync(f) && !statSync(f).isDirectory()) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); return } } catch { /* 404 */ }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(port, r))

// The 18 in the shipped picker (Lora/Gelasio are still hosted but retired — not engine-eligible).
const FAMILIES = ['IM Fell DW Pica', 'EB Garamond', 'TeX Gyre Termes', 'TeX Gyre Heros', 'Crimson Pro',
  'Spectral', 'Gentium Plus', 'Libre Baskerville', 'Caladea', 'Cormorant Garamond', 'Fraunces', 'Bitter',
  'Zilla Slab', 'Carlito', 'Atkinson Hyperlegible', 'JetBrains Mono', 'Courier Prime', 'Inter']

async function runEngine(engine, args) {
  const browser = await engine.launch(args ? { args } : {})
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } })
  await page.goto(`http://localhost:${port}/c.html`, { waitUntil: 'load' })
  await page.addScriptTag({ content: AL_JS })
  const r = await page.evaluate(async (families) => {
    const pm = document.getElementById('pm')
    const engMeasure = AL.makeCanvasMeasure()
    const apiAvailable = AL.canvasCanMatchEditorShaping()
    const LIG = 'The affluent office finds a fine flag; difficult fjord waffles — fi fl ffi ffl.'
    const WRAP = ('the long argument continues through this extended passage of sustained prose that '
      + 'must eventually straddle a boundary somewhere in its many wrapped lines and every break must land identically ').repeat(3)
    const CONTENT_W = Math.floor((793.7007874015748 - 192) * 64) / 64

    const domWidth = (fam, text) => {
      const sp = document.createElement('span')
      sp.style.cssText = `font-family:'${fam}';font-size:18px;font-weight:400;white-space:pre`
      sp.textContent = text
      pm.appendChild(sp)
      const w = sp.getBoundingClientRect().width
      sp.remove()
      return w
    }
    const charXs = (fam, text) => {
      const sp = document.createElement('span')
      sp.style.cssText = `font-family:'${fam}';font-size:18px;font-weight:400;white-space:pre`
      sp.textContent = text
      pm.appendChild(sp)
      const t = sp.firstChild, rg = document.createRange(), xs = []
      const base = sp.getBoundingClientRect().left
      for (let i = 0; i < text.length; i++) { rg.setStart(t, i); rg.setEnd(t, i + 1); xs.push(+(rg.getBoundingClientRect().left - base).toFixed(3)) }
      sp.remove()
      return xs
    }
    const lineStarts = (fam) => {
      const p = document.createElement('p')
      p.style.cssText = `width:${CONTENT_W}px;margin:0;font-family:'${fam}';font-size:18px;font-weight:400`
      p.textContent = WRAP
      pm.appendChild(p)
      p.scrollIntoView({ block: 'center' })
      const t = p.firstChild, rg = document.createRange()
      rg.selectNodeContents(p)
      const starts = []; let last = -1e9
      for (const rc of Array.from(rg.getClientRects())) {
        if (rc.width < 1 || rc.height < 1 || rc.height > 200 || rc.top - last <= 3) continue
        last = rc.top
        const cr = document.caretRangeFromPoint(rc.left + 1, rc.top + rc.height / 2)
        starts.push(cr && cr.startContainer === t ? cr.startOffset : -1)
      }
      p.remove()
      return starts
    }

    const res = []
    for (const fam of families) {
      const O = `${fam} ORIG`
      for (const f of [fam, O]) for (const w of [400, 700]) { try { await document.fonts.load(`${w} 18px '${f}'`, LIG) } catch { /* */ } }
      await document.fonts.ready
      // both must genuinely load (a fallback would agree with itself and fake a pass)
      const probe = document.createElement('canvas').getContext('2d')
      probe.font = '400 40px monospace'; const mono = probe.measureText(LIG).width
      probe.font = `400 40px '${fam}', monospace`; const l1 = Math.abs(probe.measureText(LIG).width - mono) > 0.01
      probe.font = `400 40px '${O}', monospace`; const l2 = Math.abs(probe.measureText(LIG).width - mono) > 0.01
      if (!l1 || !l2) { res.push({ fam, verdict: !l1 ? 'BUILD-NOT-LOADED' : 'CONTROL-NOT-LOADED' }); continue }

      const font = `400 18px '${fam}'`
      const fontO = `400 18px '${O}'`
      const domStrip = domWidth(fam, LIG)
      const domOrig = domWidth(O, LIG)
      const xs1 = charXs(fam, LIG), xs2 = charXs(O, LIG)
      const ls1 = lineStarts(fam), ls2 = lineStarts(O)
      res.push({
        fam, apiAvailable,
        engDelta: +Math.abs(engMeasure(LIG, font) - domStrip).toFixed(4),      // (1) rescue
        ctrlDelta: +Math.abs(engMeasure(LIG, fontO) - domOrig).toFixed(4),     // (5) control
        gateOk: AL.canvasShapingMatchesEditor(font, (t) => domWidth(fam, t), engMeasure), // (2)
        gateOrig: AL.canvasShapingMatchesEditor(fontO, (t) => domWidth(O, t), engMeasure),
        domShift: +Math.abs(domStrip - domOrig).toFixed(4),                   // (3)
        glyphSame: xs1.length === xs2.length && xs1.every((x, i) => Math.abs(x - xs2[i]) < 0.01),
        wrapSame: ls1.length === ls2.length && ls1.every((x, i) => x === ls2[i]), // (4)
        wrap: ls1,
      })
    }
    return res
  }, FAMILIES)
  await browser.close()
  return r
}

const C = await runEngine(chromium, ['--font-render-hinting=none'])
const W = await runEngine(webkit)
const cc = Object.fromEntries(C.map((r) => [r.fam, r])), ww = Object.fromEntries(W.map((r) => [r.fam, r]))
const pad = (s, n) => String(s).padEnd(n)

console.log('\n=== VERIFY THE REGENERATED BUILD — public/fonts as the pipeline just wrote it ===')
console.log(`    control = the SAME build pre-strip (/tmp/iw-fonts-orig), aliased '<Family> ORIG'\n`)
console.log(pad('FAMILY', 22) + pad('WK ctrlΔ', 10) + pad('WK engΔ', 10) + pad('WK GATE', 9) + pad('CH engΔ', 10) + pad('DOM moved', 11) + pad('glyphs', 9) + 'wrap')
console.log('-'.repeat(100))
let rescue = 0, gate = 0, visual = 0, n = 0
for (const f of FAMILIES) {
  const c = cc[f], w = ww[f]
  if (!c || !w || c.verdict || w.verdict) { console.log(pad(f, 22) + (c?.verdict || w?.verdict)); continue }
  n++
  const rOk = w.engDelta <= 0.05 && c.engDelta <= 0.05
  const gOk = w.gateOk === true
  const vOk = w.glyphSame && c.glyphSame && w.domShift <= 0.01 && c.domShift <= 0.01 && w.wrapSame && c.wrapSame
  if (rOk) rescue++
  if (gOk) gate++
  if (vOk) visual++
  console.log(pad(f, 22) + pad(w.ctrlDelta, 10) + pad(w.engDelta, 10) + pad(gOk ? '✓ TRUE' : '✗ false', 9) + pad(c.engDelta, 10)
    + pad(w.domShift <= 0.01 && c.domShift <= 0.01 ? 'no' : `⚠ ${Math.max(w.domShift, c.domShift)}`, 11)
    + pad(w.glyphSame && c.glyphSame ? 'same' : '⚠ MOVED', 9) + (w.wrapSame && c.wrapSame ? 'same' : '⚠ CHANGED'))
}
const cross = FAMILIES.filter((f) => { const a = cc[f]?.wrap, b = ww[f]?.wrap; return a && b && !(a.length === b.length && a.every((x, i) => x === b[i])) })
const ctrlFails = FAMILIES.filter((f) => ww[f] && !ww[f].verdict && ww[f].gateOrig === false).length
console.log('\n── VERDICT (against the regenerated build) ──')
console.log(`  API available?  Chromium=${C[0]?.apiAvailable}  WebKit=${W[0]?.apiAvailable}   ← Safari has no ctx.textRendering, ever`)
console.log(`  (1) RESCUE  production measure == DOM, both engines: ${rescue}/${n}`)
console.log(`  (2) GATE    canvasShapingMatchesEditor() TRUE on WEBKIT: ${gate}/${n}   ← the engine turns ON for iOS`)
console.log(`      control: the gate correctly says FALSE for the pre-strip faces on WebKit: ${ctrlFails}/${n}`)
console.log(`  (3) VISUAL  DOM unchanged (glyph x positions + width + wrap): ${visual}/${n}`)
console.log(`  (4) CROSS-ENGINE DOM↔DOM: ${cross.length === 0 ? `all ${n} IDENTICAL ✓` : `✗ ${cross.join(', ')}`}`)
const pass = rescue === n && gate === n && visual === n && cross.length === 0 && n === FAMILIES.length
console.log(pass ? '\n  ⇒ THE SHIPPED BUILD IS STRIPPED AND THE ENGINE RUNS ON iOS.' : '\n  ⇒ NOT CLEAN — see above.')
server.close()
process.exit(pass ? 0 : 1)
