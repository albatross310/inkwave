// DOES STRIPPING LIGATURES FROM THE SERVED FACES RESCUE THE ENGINE ON iOS? (2026-07-16)
//
// THE DECISIVE TEST is deliberately RAW: measure with a canvas at its DEFAULTS — no
// ctx.textRendering, no ctx.fontKerning (Safari has NEITHER, on any version) — against the DOM
// inside a real .ProseMirror. If a face with its ligature features stripped makes
//     raw canvas == DOM
// on WEBKIT, then the engine needs no API and runs on every iPhone. That is the whole question.
//
// The other four things the rescue must not break, all measured here:
//  (2) VISUAL IDENTITY — the DOM must render the stripped face EXACTLY as the original. Checked at
//      GLYPH level (per-character x positions across a ligature-heavy string), not just total width.
//  (3) WRAP — DOM line starts, original vs stripped, per engine.
//  (4) CROSS-ENGINE — stripped DOM wrap, Chromium vs WebKit (the invariant proven for all 18).
//  (5) control — raw canvas vs DOM on the ORIGINAL face, to show the failure it is fixing.
//
// Run: node scripts/fontStrip.mjs && node scripts/fontStrip.prove.mjs <port>

import { chromium, webkit } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const CALIB = '/tmp/iw-calib-fonts'
const STRIP = '/tmp/iw-strip-fonts'
const port = Number(process.argv[2] || 5603)

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
const CALIB_CSS = existsSync(join(CALIB, 'calib-fonts.css')) ? readFileSync(join(CALIB, 'calib-fonts.css'), 'utf8') : ''
const STRIP_CSS = existsSync(join(STRIP, 'strip-fonts.css')) ? readFileSync(join(STRIP, 'strip-fonts.css'), 'utf8') : ''
if (!STRIP_CSS) { console.error('FATAL: run `node scripts/fontStrip.mjs` first'); process.exit(2) }

const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' }
const HARNESS = `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css">
<style>${CALIB_CSS}</style>
<style>${STRIP_CSS}</style>
<style>${PM_CSS}</style>
<style>:root{font-optical-sizing:none} body{margin:0} #pm{font-size:18px;line-height:1.618}</style>
</head><body><div id="pm" class="ProseMirror" contenteditable="true"></div></body></html>`

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/c.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return }
  const f = p.startsWith('/strip/') ? join(STRIP, p.slice(7))
    : p.startsWith('/calib/') ? join(CALIB, p.slice(7))
    : join(PUBLIC, p)
  try { if (existsSync(f) && !statSync(f).isDirectory()) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); return } } catch { /* 404 */ }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(port, r))

const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })

const FAMILIES = ['IM Fell DW Pica', 'EB Garamond', 'TeX Gyre Termes', 'TeX Gyre Heros', 'Crimson Pro',
  'Spectral', 'Gentium Plus', 'Libre Baskerville', 'Caladea', 'Cormorant Garamond', 'Fraunces', 'Bitter',
  'Zilla Slab', 'Carlito', 'Atkinson Hyperlegible', 'JetBrains Mono', 'Courier Prime', 'Inter']

async function runEngine(engine, args) {
  const browser = await engine.launch(args ? { args } : {})
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } })
  const out = await page.evaluate.bind(page)
  await page.goto(`http://localhost:${port}/c.html`, { waitUntil: 'load' })
  await page.addScriptTag({ content: AL_JS })
  const r = await out(async (families) => {
    const pm = document.getElementById('pm')
    // RAW canvas — Safari's reality: no textRendering, no fontKerning. Defaults ⇒ ligatures ON.
    const raw = document.createElement('canvas').getContext('2d')
    const rawMeasure = (text, font) => { raw.font = font; return raw.measureText(text).width }
    // THE PRODUCTION MEASURE: makeCanvasMeasure() uses ctx.textRendering where it exists (Chromium)
    // and silently falls back to raw defaults where it doesn't (WebKit/Safari — every iPhone).
    const engMeasure = AL.makeCanvasMeasure()
    const apiAvailable = AL.canvasCanMatchEditorShaping()
    const LIG = 'The affluent office finds a fine flag; difficult fjord waffles — fi fl ffi ffl.'
    const WRAP = ('the long argument continues through this extended passage of sustained prose that '
      + 'must eventually straddle a boundary somewhere in its many wrapped lines and every break must land identically ').repeat(3)
    const CONTENT_W = Math.floor((793.7007874015748 - 192) * 64) / 64

    const domWidth = (fam, text, size = 18, weight = 400) => {
      const sp = document.createElement('span')
      sp.style.cssText = `font-family:'${fam}';font-size:${size}px;font-weight:${weight};white-space:pre`
      sp.textContent = text
      pm.appendChild(sp)
      const w = sp.getBoundingClientRect().width
      sp.remove()
      return w
    }
    // GLYPH-LEVEL: the x of every character, so a ligature substitution (which merges two glyphs
    // into one and shifts everything after it) cannot hide inside an equal total width.
    const charXs = (fam, text) => {
      const sp = document.createElement('span')
      sp.style.cssText = `font-family:'${fam}';font-size:18px;font-weight:400;white-space:pre`
      sp.textContent = text
      pm.appendChild(sp)
      const t = sp.firstChild
      const rg = document.createRange()
      const xs = []
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
      const t = p.firstChild
      const rg = document.createRange(); rg.selectNodeContents(p)
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
      const S = `${fam} STRIP`
      for (const f of [fam, S]) {
        for (const v of [[400, 'normal'], [700, 'normal']]) {
          try { await document.fonts.load(`${v[1] === 'italic' ? 'italic ' : ''}${v[0]} 18px '${f}'`, LIG) } catch { /* */ }
        }
      }
      await document.fonts.ready
      // did the stripped alias actually load? (vs silently falling back — the trap from earlier)
      raw.font = `400 40px monospace`; const mono = raw.measureText(LIG).width
      raw.font = `400 40px '${S}', monospace`; const loaded = Math.abs(raw.measureText(LIG).width - mono) > 0.01
      if (!loaded) { res.push({ fam, verdict: 'STRIP-NOT-LOADED' }); continue }

      const rawOrig = rawMeasure(LIG, `400 18px '${fam}'`)
      const rawStrip = rawMeasure(LIG, `400 18px '${S}'`)
      const domOrig = domWidth(fam, LIG)
      const domStrip = domWidth(S, LIG)
      const xsOrig = charXs(fam, LIG)
      const xsStrip = charXs(S, LIG)
      const glyphSame = xsOrig.length === xsStrip.length && xsOrig.every((x, i) => Math.abs(x - xsStrip[i]) < 0.01)
      const lsOrig = lineStarts(fam)
      const lsStrip = lineStarts(S)
      const wrapSame = lsOrig.length === lsStrip.length && lsOrig.every((x, i) => x === lsStrip[i])
      const engStrip = engMeasure(LIG, `400 18px '${S}'`)
      res.push({
        fam, apiAvailable,
        engDelta: +Math.abs(engStrip - domStrip).toFixed(4),   // PRODUCTION measure vs DOM, stripped
        ctrlDelta: +Math.abs(rawOrig - domOrig).toFixed(4),   // raw canvas vs DOM, ORIGINAL face (the bug)
        stripDelta: +Math.abs(rawStrip - domStrip).toFixed(4), // raw canvas vs DOM, STRIPPED face (the rescue)
        domShift: +Math.abs(domOrig - domStrip).toFixed(4),    // did the DOM's own rendering move?
        glyphSame, wrapSame, wrapStrip: lsStrip,
        verdict: null,
      })
    }
    return res
  }, FAMILIES)
  await browser.close()
  return r
}

const C = await runEngine(chromium, ['--font-render-hinting=none'])
const W = await runEngine(webkit)
const byFam = (a) => Object.fromEntries(a.map((r) => [r.fam, r]))
const cc = byFam(C), ww = byFam(W)

const pad = (s, n) => String(s).padEnd(n)
console.log('\n=== LIGATURE-STRIP RESCUE — can the engine run on Safari/iOS without ctx.textRendering? ===')
console.log('    RAW canvas (defaults: ligatures ON, no API) vs DOM inside a real .ProseMirror.\n')
console.log(pad('FAMILY', 22) + pad('WK ctrlΔ', 10) + pad('WK engΔ', 11) + pad('WK rescue', 11) + pad('CH engΔ', 11) + pad('DOM moved?', 12) + pad('glyphs', 9) + 'wrap')
console.log(pad('', 22) + pad('(orig,raw)', 10) + pad('(strip,prod)', 11) + pad('', 11) + pad('(strip,prod)', 11))
console.log('-'.repeat(108))
let rescued = 0, broke = 0, tested = 0
for (const f of FAMILIES) {
  const c = cc[f], w = ww[f]
  if (!c || !w || w.verdict === 'STRIP-NOT-LOADED' || c.verdict === 'STRIP-NOT-LOADED') { console.log(pad(f, 22) + 'STRIP FACE DID NOT LOAD — not tested'); continue }
  tested++
  const wkOk = w.engDelta <= 0.05
  const chOk = c.engDelta <= 0.05
  const visualOk = w.glyphSame && c.glyphSame && w.domShift <= 0.01 && c.domShift <= 0.01
  const wrapOk = w.wrapSame && c.wrapSame
  if (wkOk && chOk) rescued++
  if (!visualOk || !wrapOk) broke++
  console.log(pad(f, 22) + pad(w.ctrlDelta, 10) + pad(w.engDelta, 11) + pad(wkOk ? '✓ MATCH' : '✗ still off', 11) + pad(c.engDelta, 11)
    + pad(w.domShift <= 0.01 && c.domShift <= 0.01 ? 'no' : `⚠ ${Math.max(w.domShift, c.domShift)}`, 12)
    + pad(w.glyphSame && c.glyphSame ? 'same' : '⚠ MOVED', 9) + (wrapOk ? 'same' : '⚠ CHANGED'))
}
// cross-engine parity on the STRIPPED faces
const crossFails = FAMILIES.filter((f) => {
  const a = cc[f]?.wrapStrip, b = ww[f]?.wrapStrip
  return a && b && !(a.length === b.length && a.every((x, i) => x === b[i]))
})
console.log('\n── VERDICT ──')
console.log(`  API available? Chromium=${cc[FAMILIES[0]]?.apiAvailable}  WebKit=${ww[FAMILIES[0]]?.apiAvailable}  (WebKit has NO ctx.textRendering — Safari never shipped it)`)
console.log(`  (1) RESCUE — PRODUCTION measure == DOM with stripped faces, on BOTH engines: ${rescued}/${tested}`)
console.log(`  (2) VISUAL/WRAP unchanged by the strip (glyph-level x positions + line starts): ${tested - broke}/${tested}`)
console.log(`  (3) CROSS-ENGINE DOM↔DOM on stripped faces: ${crossFails.length === 0 ? `all ${tested} IDENTICAL ✓` : `✗ ${crossFails.join(', ')}`}`)
console.log(rescued === tested && broke === 0 && crossFails.length === 0
  ? '\n  ⇒ THE STRIP WORKS. The engine needs no ctx.textRendering — it can run on Safari/iOS.'
  : '\n  ⇒ NOT a clean rescue — see the rows above.')
server.close()
