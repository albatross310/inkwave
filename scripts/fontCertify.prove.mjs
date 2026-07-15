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
const OLD = {
  'IM Fell DW Pica': 'CERTIFIED+SHIPPED', 'EB Garamond': 'CERTIFIED+SHIPPED', 'TeX Gyre Termes': 'CERTIFIED+SHIPPED',
  'TeX Gyre Heros': 'CERTIFIED+SHIPPED', 'Crimson Pro': 'CERTIFIED+SHIPPED', 'Spectral': 'CERTIFIED+SHIPPED',
  'Lora': 'CERTIFIED+SHIPPED', 'Gelasio': 'CERTIFIED+SHIPPED', 'Gentium Plus': 'CERTIFIED+SHIPPED',
  'Cormorant Garamond': 'CERTIFIED+SHIPPED', 'Fraunces': 'CERTIFIED+SHIPPED', 'Bitter': 'CERTIFIED+SHIPPED',
  'Carlito': 'CERTIFIED+SHIPPED', 'Atkinson Hyperlegible': 'CERTIFIED+SHIPPED', 'JetBrains Mono': 'CERTIFIED+SHIPPED',
  'Tinos': 'FAILED', 'Arimo': 'FAILED', 'Caladea': 'FAILED', 'Vollkorn': 'FAILED', 'Libre Baskerville': 'FAILED',
  'PT Serif': 'FAILED', 'Source Serif 4': 'FAILED', 'Alegreya': 'FAILED', 'Baskervville': 'FAILED',
  'Libre Caslon Text': 'FAILED', 'Quattrocento': 'FAILED', 'STIX Two Text': 'FAILED', 'Inter': 'FAILED(700)',
  'Cardo': 'CERTIFIED-cut', 'Noto Sans': 'CERTIFIED-cut', 'Noto Serif': 'CERTIFIED-cut', 'Open Sans': 'CERTIFIED-cut',
  'Fira Code': 'CERTIFIED-cut', 'Nimbus Roman': 'CERTIFIED-cut',
}
const BASKERVILLE = new Set(['Libre Baskerville', 'Baskervville', 'Libre Caslon Text', 'Quattrocento'])
const FAMILIES = Object.keys(OLD)

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
  const out = []

  for (const fam of families) {
    const res = { fam, cells: 0, maxAdv: 0, maxAdvLegacy: 0, advFails: [], legacyAdvFails: [], wrapFails: [], missing: [], boxFail: null, notes: [] }
    if (!(await reallyLoaded(fam))) { res.verdict = 'NOT-LOADED'; out.push(res); continue } // never certify a fallback
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
console.log('\n=== ROUND-9 FONT CERTIFICATION — re-run in the EDITOR\'S REAL CONTEXT ===')
console.log('    (.ProseMirror + real prosemirror.css: break-spaces + font-variant-ligatures:none;')
console.log('     canvas = the shipped makeCanvasMeasure(); breaks = the shipped layoutParagraph())\n')
console.log(pad('FAMILY', 22) + pad('r7/r8 SAID', 14) + pad('LEGACY-CTX A/B', 16) + pad('NEW (real ctx)', 20) + pad('maxΔ', 9) + 'NOTE')
console.log(pad('', 22) + pad('(CLAUDE.md)', 14) + pad('(liga ON, r7 ctx)', 16) + pad('(liga OFF, editor)', 20))
console.log('-'.repeat(120))
const changed = []
for (const r of results) {
  const old = OLD[r.fam]
  const oldPass = old.startsWith('CERTIFIED')
  const newPass = r.verdict === 'CERTIFIED'
  let note = ''
  if (r.verdict === 'NO-FACES') note = 'no faces loaded — NOT re-tested'
  else if (r.advFails.length) note = 'advance: ' + r.advFails.join('; ')
  else if (r.wrapFails.length) note = 'wrap: ' + r.wrapFails.join('; ')
  else if (r.boxFail) note = 'line-box: ' + r.boxFail
  else note = 'all cells pass'
  if (r.missing.length) note += `  [faces missing: ${r.missing.join(',')}]`
  if (r.wrapSkipped) note += `  [wrap cells ${r.wrapRun || 0} run / ${r.wrapSkipped} skipped]`
  else if (r.wrapRun) note += `  [wrap ${r.wrapRun}/${r.wrapRun}]`
  const flip = (r.verdict !== 'NO-FACES' && r.verdict !== 'NOT-LOADED') && oldPass !== newPass ? (newPass ? ' ⬆PASSES' : ' ⬇FAILS') : ''
  if (flip) changed.push({ fam: r.fam, old, now: r.verdict, note })
  const legacy = r.legacyVerdict ? `${r.legacyVerdict}(Δ${(r.maxAdvLegacy ?? 0).toFixed(3)})` : '-'
  console.log(pad(r.fam, 22) + pad(old.replace('CERTIFIED', 'CERT'), 14) + pad(legacy, 16) + pad(r.verdict + flip, 20) + pad(r.maxAdv.toFixed(4), 9) + note.slice(0, 44))
}
console.log('\n── HEADLINES ──')
const shipped = results.filter((r) => OLD[r.fam] === 'CERTIFIED+SHIPPED')
const shipFail = shipped.filter((r) => r.verdict !== 'CERTIFIED')
const notLoaded = results.filter((r) => r.verdict === 'NOT-LOADED')
console.log(`(a) all 15 SHIPPED fonts still pass?  ${shipFail.length === 0 ? 'YES — all 15 CERTIFIED' : 'NO ⚠️  → ' + shipFail.map((r) => r.fam + ':' + r.verdict).join(', ')}`)
const nowPass = results.filter((r) => OLD[r.fam].startsWith('FAILED') && r.verdict === 'CERTIFIED')
console.log(`(b) previously-FAILED fonts that now PASS: ${nowPass.length ? nowPass.map((r) => r.fam).join(', ') : 'none'}`)
const bask = results.filter((r) => BASKERVILLE.has(r.fam))
const baskPass = bask.filter((r) => r.verdict === 'CERTIFIED')
console.log(`(c) Baskerville genre back on the table?  ${baskPass.length ? 'YES → ' + baskPass.map((r) => r.fam).join(', ') : 'no — ' + bask.map((r) => `${r.fam}:${r.verdict}`).join(', ')}`)
const cut = results.filter((r) => OLD[r.fam] === 'CERTIFIED-cut')
console.log(`(d) certified-but-cut re-confirmed: ${cut.map((r) => `${r.fam}:${r.verdict}`).join(', ')}`)
if (notLoaded.length) console.log(`(!) NOT RE-TESTED (font never loaded — would have certified the FALLBACK): ${notLoaded.map((r) => r.fam).join(', ')}`)
console.log('\nLEGACY-CTX A/B = the same grid in r7/r8\'s context (plain host + canvas defaults, ligatures ON on both sides).')
console.log('It reproduces r7\'s verdict, so a family that is FAIL there and CERTIFIED in the real context moved on the LIGATURE axis.')
await browser.close()
server.close()
