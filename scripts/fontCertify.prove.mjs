// ROUND-9 FONT CERTIFICATION — the r7/r8 grid RE-RUN IN THE EDITOR'S REAL CONTEXT (2026-07-16).
//
// WHY THIS EXISTS. r7/r8 certified canvas measureText against a DOM span in a PLAIN harness:
// ligatures ON on BOTH sides, white-space `normal`, no prosemirror.css. Production is a
// `.ProseMirror`, whose injected stylesheet sets:
//     white-space: pre-wrap; white-space: break-spaces;   → a trailing space NEVER hangs
//     font-variant-ligatures: none; font-feature-settings: "liga" 0;  → f+i render SEPARATELY
// Canvas applies ligatures by DEFAULT, so r7's Δ≤0.05px parity was measured on a shaping production
// never uses — and its verdicts (which fonts shipped, and that the whole Baskerville genre was
// abandoned) were decided on that data. This re-run fixes the context:
//   • DOM reference rendered INSIDE a real .ProseMirror with the ACTUAL prosemirror.css;
//   • canvas via the SHIPPED engine's makeCanvasMeasure() (textRendering 'optimizeSpeed' +
//     fontKerning 'normal' — the measured 0.000 config), so this certifies the REAL engine;
//   • breaks via the SHIPPED engine's layoutParagraph() at break-spaces (no hang), compared against
//     the line starts the LIVE path resolves (line rects + posAtCoords), not a per-char walk;
//   • a CONTEXT ASSERTION that fails loudly if the harness isn't in the editor's real mode.
//
// GRID (as r7/r8): family × {400,700} × {normal,italic} × 7 sizes (8pt..72pt + canonical 18px).
//   (a) advance parity  — canvas vs DOM span, 3 corpus strings (incl. ligature + kerning stress)
//   (b) wrap parity     — engine line starts vs DOM posAtCoords line starts @ 500px, 18 & 32px
//   (c) mixed-run line box — ratio × max(size) (the tallest-line-box rule)
// A family is CERTIFIED only if the whole grid passes. Faces the family lacks are REPORTED and
// skipped (a missing face is synthesised by the browser — never silently certified).
//
// Run:  node scripts/fontCertify.prove.mjs <port>      (fetch non-shipped families first:
//       node scripts/fontCertify.fetch.mjs → /tmp/iw-calib-fonts)

import { chromium } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const CALIB = '/tmp/iw-calib-fonts'
const port = Number(process.argv[2] || 5601)

const PM_CSS = (() => {
  for (const base of ['/root/dev/Inkwave/node_modules/.pnpm', join(ROOT, 'node_modules/.pnpm')]) {
    try {
      for (const d of readdirSync(base)) {
        if (!d.startsWith('prosemirror-view@')) continue
        const f = join(base, d, 'node_modules/prosemirror-view/style/prosemirror.css')
        if (existsSync(f)) return readFileSync(f, 'utf8')
      }
    } catch { /* next */ }
  }
  return ''
})()
if (!PM_CSS.includes('break-spaces') || !PM_CSS.includes('liga')) {
  console.error('FATAL: could not load the real prosemirror.css — refusing to certify in a fake context')
  process.exit(2)
}
const CALIB_CSS = existsSync(join(CALIB, 'calib-fonts.css')) ? readFileSync(join(CALIB, 'calib-fonts.css'), 'utf8') : ''

const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })

const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' }
const HARNESS = `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css">
<style>${CALIB_CSS}</style>
<style>${PM_CSS}</style>
<style>body{margin:0} #pm{font-size:18px;line-height:1.618}</style>
</head><body><div id="pm" class="ProseMirror" contenteditable="true"></div></body></html>`

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/c.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return }
  if (p.startsWith('/calib/')) {
    const f = join(CALIB, p.slice('/calib/'.length))
    try { if (existsSync(f) && !statSync(f).isDirectory()) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); return } } catch { /* 404 */ }
  }
  const f = join(PUBLIC, p)
  try { if (existsSync(f) && !statSync(f).isDirectory()) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); return } } catch { /* 404 */ }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(port, r))

// family → its verdict in the round-7/8 grid (CLAUDE.md), for the old-vs-new table.
// GENRE CANDIDATE RUN (2026-07-16): one more quality face for SANS / SLAB / MONO / DISPLAY.
// fam → [genre, prior verdict, role]. Incumbents are included so distinctness is MEASURED, not asserted.
const FAM = {
  'Inter':                 ['SANS',    'r9 CERTIFIED (r7 said FAILED-700)', 'candidate'],
  'TeX Gyre Heros':        ['SANS',    'shipped',   'incumbent'],
  'Carlito':               ['SANS',    'shipped',   'incumbent'],
  'Atkinson Hyperlegible': ['SANS',    'shipped',   'incumbent'],
  'Zilla Slab':            ['SLAB',    'untested',  'candidate'],
  'Roboto Slab':           ['SLAB',    'untested',  'candidate'],
  'Arvo':                  ['SLAB',    'untested',  'candidate'],
  'Aleo':                  ['SLAB',    'untested',  'candidate'],
  'Bitter':                ['SLAB',    'shipped',   'incumbent'],
  'Courier Prime':         ['MONO',    'untested',  'candidate'],
  'TeX Gyre Cursor':       ['MONO',    'untested',  'candidate'],
  'Fira Code':             ['MONO',    'r7 CERTIFIED-cut', 'candidate'],
  'JetBrains Mono':        ['MONO',    'shipped',   'incumbent'],
}
// DISPLAY was dropped from this run (2026-07-16): Peter was asking what "display font" MEANS, not
// asking for another one. Cormorant + Fraunces stay as-is. (Playfair Display / Bodoni Moda / Prata /
// Alegreya were measured in an earlier pass and all certified except for Prata's synthesised
// bold+italics — recorded here only so nobody re-runs them by accident.)
const OLD = Object.fromEntries(Object.entries(FAM).map(([k, v]) => [k, v[1]]))
const FAMILIES = Object.keys(FAM)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } })
page.on('pageerror', (e) => console.log('PAGE-THROW', String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/c.html`, { waitUntil: 'load' })
await page.addScriptTag({ content: AL_JS })

const results = await page.evaluate(async (families) => {
  const AL = window.AL
  const pm = document.getElementById('pm')
  // ── CONTEXT ASSERTION: certify only in the editor's real shaping context ──
  const cs = getComputedStyle(pm)
  if (cs.whiteSpace !== AL.EDITOR_WHITE_SPACE) throw new Error(`CONTEXT: white-space=${cs.whiteSpace}, expected ${AL.EDITOR_WHITE_SPACE}`)
  if (!/none/.test(cs.fontVariantLigatures) && !/liga.*0/.test(cs.fontFeatureSettings)) {
    throw new Error(`CONTEXT: ligatures not disabled (font-variant-ligatures=${cs.fontVariantLigatures}, font-feature-settings=${cs.fontFeatureSettings}) — r7's exact mistake`)
  }
  const measure = AL.makeCanvasMeasure() // the SHIPPED config: optimizeSpeed + kerning normal
  // LEGACY canvas = r7/r8's: raw defaults (ligatures ON).
  const legacyCtx = document.createElement('canvas').getContext('2d')
  const legacyMeasure = (text, font) => { legacyCtx.font = font; return legacyCtx.measureText(text).width }
  // LEGACY host = r7/r8's: a plain absolutely-positioned probe OUTSIDE .ProseMirror → white-space
  // normal, ligatures ON. Reproducing r7's context is what proves WHICH AXIS moved.
  const legacyHost = document.createElement('div')
  legacyHost.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden'
  document.body.appendChild(legacyHost)

  // REAL font-loaded detection. document.fonts.check() returns TRUE even for a family with no
  // @font-face (the system fallback counts as "available"), which silently certifies the FALLBACK:
  // canvas and DOM then both use the same fallback and agree at 0.000. Detect properly — render in
  // "'Family', monospace" and compare with plain monospace; equal ⇒ the family never loaded.
  const reallyLoaded = async (fam) => {
    const S = 'Handgloves AVWa fi fl 12345 quartz'
    // MUST load the faces FIRST — an unloaded family measures as the fallback and would read
    // "not loaded" even when it is perfectly available.
    for (const v of [{ w: 400, st: 'normal' }, { w: 700, st: 'normal' }, { w: 400, st: 'italic' }, { w: 700, st: 'italic' }]) {
      try { await document.fonts.load(`${v.st === 'italic' ? 'italic ' : ''}${v.w} 40px '${fam}'`, S) } catch { /* face may not exist */ }
    }
    legacyCtx.font = `400 40px monospace`
    const mono = legacyCtx.measureText(S).width
    legacyCtx.font = `400 40px '${fam}', monospace`
    return Math.abs(legacyCtx.measureText(S).width - mono) > 0.01
  }

  const CORPUS = [
    'The quiet harbour light returns across the water and settles into evening calm.',
    'Waffling requires overtly fjord-like typography; quartz vexes 1234567890 (all of it).',
    '“Quoted — dashed” text, with fi fl ffi ligatures and AV To Wa kerning pairs.',
  ]
  const WRAP = ('the long argument continues through this extended passage of sustained prose that '
    + 'must eventually straddle a boundary somewhere in its many wrapped lines and every break must land identically ').repeat(3)
  const SIZES = [10.6667, 14.6667, 18, 24, 32, 48, 96]
  const VARIANTS = [{ w: 400, st: 'normal' }, { w: 700, st: 'normal' }, { w: 400, st: 'italic' }, { w: 700, st: 'italic' }]
  // DECLARED faces: enumerate the real @font-face rules. document.fonts.check() is useless here
  // (true for absent families AND for missing weights the browser will SYNTHESISE). A variable font
  // declares a weight RANGE ("100 900"), so cover-test against the range.
  const declaredFor = (fam) => {
    const list = []
    document.fonts.forEach((f) => { if (f.family.replace(/['"]/g, '') === fam) list.push({ w: String(f.weight), st: f.style }) })
    return list
  }
  const covers = (faces, w, st) => faces.some((f) => {
    if (f.st !== st) return false
    const m = f.w.match(/(\d+)(?:\s+(\d+))?/)
    if (!m) return false
    const lo = +m[1], hi = m[2] ? +m[2] : lo
    return w >= lo && w <= hi
  })
  // Typographic character, measured (for the distinctness/quality call, not just parity).
  const metrics = (fam) => {
    const c = document.createElement('canvas').getContext('2d')
    c.font = `400 100px '${fam}', serif`
    const setW = c.measureText('Handgloves quartz jumps').width
    const x = c.measureText('x'), H = c.measureText('H'), p = c.measureText('p')
    const xh = x.actualBoundingBoxAscent, cap = H.actualBoundingBoxAscent, desc = p.actualBoundingBoxDescent
    return { setW: +setW.toFixed(1), xh: +xh.toFixed(1), cap: +cap.toFixed(1), xcap: +(xh / cap).toFixed(3), desc: +desc.toFixed(1) }
  }
  const out = []

  for (const fam of families) {
    const res = { fam, cells: 0, maxAdv: 0, maxAdvLegacy: 0, advFails: [], legacyAdvFails: [], wrapFails: [], missing: [], boxFail: null, notes: [] }
    if (!(await reallyLoaded(fam))) { res.verdict = 'NOT-LOADED'; out.push(res); continue } // never certify a fallback
    const faces = declaredFor(fam)
    res.declared = faces.map((f) => `${f.w}/${f.st}`).join(' ')
    res.synth = [] // variants with NO upstream face → the browser SYNTHESISES (fake bold / oblique)
    for (const v of [{ w: 400, st: 'normal' }, { w: 700, st: 'normal' }, { w: 400, st: 'italic' }, { w: 700, st: 'italic' }]) {
      if (!covers(faces, v.w, v.st)) res.synth.push(`${v.w}${v.st[0]}`)
    }
    res.metrics = metrics(fam)
    for (const v of VARIANTS) {
      const spec = `${v.st === 'italic' ? 'italic ' : ''}${v.w} 18px '${fam}'`
      let loaded = false
      try { await document.fonts.load(spec, 'AVWaTo fi fl ffi test 123'); loaded = document.fonts.check(spec, 'AVWaTo fi fl ffi test 123') } catch { loaded = false }
      if (!loaded) { res.missing.push(`${v.w}${v.st[0]}`); continue } // synthesised — never certify it
      for (const size of SIZES) {
        res.cells++
        const run = { text: '', fontFamily: `'${fam}', serif`, fontSizePx: size, fontWeight: v.w, italic: v.st === 'italic' }
        const font = AL.cssFontOf(run)
        // (a) ADVANCE PARITY — DOM span INSIDE the .ProseMirror (inherits liga-off)
        for (const str of CORPUS) {
          const sp = document.createElement('span')
          sp.style.cssText = `font-family:'${fam}', serif;font-size:${size}px;font-weight:${v.w};font-style:${v.st};white-space:pre`
          sp.textContent = str
          pm.appendChild(sp)
          const dom = sp.getBoundingClientRect().width
          pm.remove
          sp.remove()
          const math = measure(str, font)
          const d = Math.abs(dom - math)
          if (d > res.maxAdv) res.maxAdv = d
          if (d > 0.05 && res.advFails.length < 3) res.advFails.push(`${v.w}${v.st[0]}@${size.toFixed(0)} Δ${d.toFixed(3)}`)
          // ── LEGACY A/B: r7's context — plain host (liga ON) vs canvas defaults (liga ON) ──
          const lsp = document.createElement('span')
          lsp.style.cssText = `font-family:'${fam}', serif;font-size:${size}px;font-weight:${v.w};font-style:${v.st};white-space:pre`
          lsp.textContent = str
          legacyHost.appendChild(lsp)
          const ldom = lsp.getBoundingClientRect().width
          lsp.remove()
          const ld = Math.abs(ldom - legacyMeasure(str, font))
          if (ld > res.maxAdvLegacy) res.maxAdvLegacy = ld
          if (ld > 0.05 && res.legacyAdvFails.length < 3) res.legacyAdvFails.push(`${v.w}${v.st[0]}@${size.toFixed(0)} Δ${ld.toFixed(3)}`)
        }
        // (b) WRAP PARITY — the SHIPPED engine vs the LIVE line-start convention @ 500px
        if (size === 18 || size === 32) {
          const W = 500 // on the 1/64 LayoutUnit grid
          const p = document.createElement('p')
          p.style.cssText = `width:${W}px;margin:0;font-family:'${fam}', serif;font-size:${size}px;font-weight:${v.w};font-style:${v.st}`
          p.textContent = WRAP
          pm.appendChild(p)
          p.scrollIntoView({ block: 'center' }) // caretRangeFromPoint is viewport-based
          const t = p.firstChild
          const rg = document.createRange(); rg.selectNodeContents(p)
          const domStarts = []
          let last = -1e9
          for (const rc of Array.from(rg.getClientRects())) {
            if (rc.width < 1 || rc.height < 1 || rc.height > 200 || rc.top - last <= 3) continue
            last = rc.top
            const cr = document.caretRangeFromPoint(rc.left + 1, rc.top + rc.height / 2)
            domStarts.push(cr && cr.startContainer === t ? cr.startOffset : -1)
          }
          p.remove()
          if (domStarts.some((x) => x < 0)) { res.wrapSkipped = (res.wrapSkipped || 0) + 1; continue }
          res.wrapRun = (res.wrapRun || 0) + 1
          const block = { type: 'paragraph', runs: [{ ...run, text: WRAP }], baseFontPx: size, marginTopPx: 0, marginBottomPx: 0 }
          const eng = AL.layoutParagraph(block, W, 1.618, measure, AL.EDITOR_WHITE_SPACE).breakStartChars
          const same = eng.length === domStarts.length && domStarts.every((x, k) => x === eng[k])
          if (!same && res.wrapFails.length < 3) {
            let k = 0; while (k < domStarts.length && k < eng.length && domStarts[k] === eng[k]) k++
            res.wrapFails.push(`${v.w}${v.st[0]}@${size}px lines ${domStarts.length}vs${eng.length} div@${k}(dom ${domStarts[k]} eng ${eng[k]})`)
          }
        }
      }
    }
    // (c) mixed-run tallest-line-box
    {
      const d = document.createElement('div')
      d.style.cssText = `line-height:1.618;font-family:'${fam}', serif;white-space:pre`
      d.innerHTML = `<span style="font-size:18px">small run </span><span style="font-size:32px">big run</span>`
      pm.appendChild(d)
      const h = d.getBoundingClientRect().height
      d.remove()
      const expect = AL.snappedLineHeight(32, 1.618)
      if (Math.abs(h - expect) > 0.05) res.boxFail = `line box ${h.toFixed(2)} vs ${expect.toFixed(2)}`
    }
    res.verdict = (res.cells > 0 && res.advFails.length === 0 && res.wrapFails.length === 0 && !res.boxFail) ? 'CERTIFIED' : (res.cells === 0 ? 'NO-FACES' : 'FAIL')
    res.legacyVerdict = res.cells === 0 ? 'NO-FACES' : (res.legacyAdvFails.length === 0 ? 'pass' : 'FAIL')
    out.push(res)
  }
  return out
}, FAMILIES)

// ── report ──
const pad = (s, n) => String(s).padEnd(n)
console.log('\n=== GENRE CANDIDATE CERTIFICATION — editor\'s real context ===')
console.log('    (.ProseMirror + real prosemirror.css: break-spaces + font-variant-ligatures:none;')
console.log('     canvas = shipped makeCanvasMeasure(); breaks = shipped layoutParagraph(); Δ in px)\n')
const byGenre = {}
for (const r of results) { const g = FAM[r.fam][0]; (byGenre[g] ||= []).push(r) }
for (const [genre, rows] of Object.entries(byGenre)) {
  console.log(`── ${genre} ──`)
  console.log('  ' + pad('FAMILY', 22) + pad('ROLE', 11) + pad('VERDICT', 12) + pad('maxΔ', 9) + pad('wrap', 7) + pad('x/cap', 7) + pad('setW', 7) + 'UPSTREAM FACES / NOTE')
  for (const r of rows) {
    const [, , role] = FAM[r.fam]
    const wrap = r.wrapSkipped ? `${r.wrapRun || 0}/${(r.wrapRun || 0) + r.wrapSkipped}` : `${r.wrapRun || 0}/${r.wrapRun || 0}`
    let note = r.verdict === 'NOT-LOADED' ? 'font never loaded — NOT tested'
      : r.advFails.length ? 'adv: ' + r.advFails[0]
      : r.wrapFails.length ? 'wrap: ' + r.wrapFails[0]
      : r.boxFail ? 'line-box: ' + r.boxFail : 'all cells pass'
    if (r.synth && r.synth.length) note += `  ⚠ SYNTHESISED: ${r.synth.join(',')} (no upstream face)`
    const m = r.metrics || {}
    console.log('  ' + pad(r.fam, 22) + pad(role, 11) + pad(r.verdict, 12) + pad((r.maxAdv ?? 0).toFixed(4), 9) + pad(wrap, 7) + pad(m.xcap ?? '-', 7) + pad(m.setW ?? '-', 7) + note.slice(0, 52))
  }
  console.log('')
}
const cands = results.filter((r) => FAM[r.fam][2] === 'candidate')
const pass = cands.filter((r) => r.verdict === 'CERTIFIED')
console.log('── SUMMARY ──')
console.log(`candidates CERTIFIED: ${pass.map((r) => r.fam).join(', ') || 'none'}`)
const fail = cands.filter((r) => r.verdict !== 'CERTIFIED')
console.log(`candidates NOT certified: ${fail.map((r) => `${r.fam}(${r.verdict})`).join(', ') || 'none'}`)
const synth = results.filter((r) => r.synth && r.synth.length)
console.log(`⚠ synthesised variants (no upstream face): ${synth.map((r) => `${r.fam}[${r.synth.join(',')}]`).join(', ') || 'none'}`)
console.log('\nx/cap = x-height ÷ cap-height (higher = larger on the body / more contemporary).')
console.log('setW  = width of "Handgloves quartz jumps" @100px (lower = more economical).')
await browser.close()
server.close()
