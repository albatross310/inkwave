// Fetch the NON-SHIPPED families (the r7/r8 FAILED list + the certified-but-cut list) into a temp
// dir so the corrected certification can re-test them. Shipped families come from public/fonts.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
const OUT = '/tmp/iw-calib-fonts'
mkdirSync(OUT, { recursive: true })
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// family → google css2 specifier candidates (first that returns 200 wins)
const FAMS = {
  // ── r7/r8 FAILED (never shipped) ──
  'Tinos': ['Tinos:ital,wght@0,400;0,700;1,400;1,700'],
  'Arimo': ['Arimo:ital,wght@0,400;0,700;1,400;1,700'],
  'Caladea': ['Caladea:ital,wght@0,400;0,700;1,400;1,700'],
  'Vollkorn': ['Vollkorn:ital,wght@0,400;0,700;1,400;1,700'],
  'Libre Baskerville': ['Libre+Baskerville:ital,wght@0,400;0,700;1,400', 'Libre+Baskerville:ital,wght@0,400;0,700'],
  'PT Serif': ['PT+Serif:ital,wght@0,400;0,700;1,400;1,700'],
  'Source Serif 4': ['Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,700;1,8..60,400;1,8..60,700'],
  'Alegreya': ['Alegreya:ital,wght@0,400;0,700;1,400;1,700'],
  'Baskervville': ['Baskervville:ital,wght@0,400;1,400', 'Baskervville:ital@0;1'],
  'Libre Caslon Text': ['Libre+Caslon+Text:ital,wght@0,400;0,700;1,400'],
  'Quattrocento': ['Quattrocento:wght@400;700'],
  'STIX Two Text': ['STIX+Two+Text:ital,wght@0,400;0,700;1,400;1,700'],
  'Inter': ['Inter:ital,opsz,wght@0,14..32,400;0,14..32,700;1,14..32,400;1,14..32,700'],
  // ── GENRE CANDIDATES (2026-07-16): one more quality face for SANS / SLAB / MONO ──
  'Zilla Slab': ['Zilla+Slab:ital,wght@0,400;0,700;1,400;1,700'],
  'Roboto Slab': ['Roboto+Slab:wght@400;700'],           // NB: upstream has NO italic
  'Arvo': ['Arvo:ital,wght@0,400;0,700;1,400;1,700'],
  'Aleo': ['Aleo:ital,wght@0,400;0,700;1,400;1,700'],
  'Courier Prime': ['Courier+Prime:ital,wght@0,400;0,700;1,400;1,700'],
  'TeX Gyre Cursor': [],                                  // GUST Courier clone — DIRECT from CTAN
  // DISPLAY candidates (2026-07-16)
  'Playfair Display': ['Playfair+Display:ital,wght@0,400;0,700;1,400;1,700'],
  'Bodoni Moda': ['Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,700;1,6..96,400;1,6..96,700'],
  'Prata': ['Prata:wght@400'],                            // NB: upstream is 400 ONLY
  // ── CERTIFIED but cut for palette budget ──
  'Cardo': ['Cardo:ital,wght@0,400;0,700;1,400'],
  'Noto Sans': ['Noto+Sans:ital,wght@0,400;0,700;1,400;1,700'],
  'Noto Serif': ['Noto+Serif:ital,wght@0,400;0,700;1,400;1,700'],
  'Open Sans': ['Open+Sans:ital,wght@0,400;0,700;1,400;1,700'],
  'Fira Code': ['Fira+Code:wght@400;700'],
  'Nimbus Roman': [], // URW base35 — not on Google Fonts; direct below
}
const DIRECT = {
  // TeX Gyre Cursor — GUST's Courier clone, metric-compatible with Courier New (GUST Font Licence).
  // Same CTAN path pattern that already ships Termes ('Times') and Heros ('Arial') in fetch-fonts.mjs.
  'TeX Gyre Cursor': [
    [400, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyrecursor-regular.otf'],
    [700, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyrecursor-bold.otf'],
    [400, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyrecursor-italic.otf'],
    [700, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyrecursor-bolditalic.otf'],
  ],
  // Nimbus Roman No9 L (URW, TeX Gyre Termes' ancestor). The base35 path 404s; left here documented
  // as still-unfetched rather than silently dropped.
  'Nimbus Roman': [
    [400, 'normal', 'https://mirrors.ctan.org/fonts/urw/base35/NimbusRoman-Regular.otf'],
  ],
}

const css = []
const report = []
let n = 0
for (const [fam, specs] of Object.entries(FAMS)) {
  let got = null
  for (const spec of specs) {
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`, { headers: { 'User-Agent': UA } })
    if (r.ok) { got = await r.text(); break }
  }
  if (!got) {
    if (!DIRECT[fam]) { report.push(`${fam}: NO CSS (unavailable)`); continue }
    // direct otf faces
    let ok = 0
    for (const [wt, st, url] of DIRECT[fam]) {
      try {
        // CTAN 307-redirects to a regional mirror and node's fetch fails on that hop
        // ("fetch failed") while curl -L handles it — so shell out. Same URLs fetch-fonts.mjs
        // already ships Termes/Heros from.
        const f = `calib-${fam.replace(/\W+/g, '-').toLowerCase()}-${wt}-${st}.otf`
        execFileSync('curl', ['-sL', '--max-time', '60', '-o', join(OUT, f), url])
        const buf = readFileSync(join(OUT, f))
        // sanity: a real OTF/TTF starts with OTTO / 0x00010000 / true — never an HTML error page
        const magic = buf.slice(0, 4).toString('hex')
        if (buf.length < 5000 || !['4f54544f', '00010000', '74727565'].includes(magic)) continue
        css.push(`@font-face{font-family:'${fam}';font-style:${st};font-weight:${wt};src:url(/calib/${f}) format('opentype');font-display:block}`)
        ok++; n++
      } catch { /* skip */ }
    }
    report.push(`${fam}: ${ok} direct faces`)
    continue
  }
  // parse the @font-face blocks; keep latin + latin-ext only
  const blocks = got.split('@font-face').slice(1)
  let kept = 0
  for (const b of blocks) {
    const url = /src:\s*url\((https:[^)]+\.woff2)\)/.exec(b)?.[1]
    const style = /font-style:\s*([a-z]+)/.exec(b)?.[1] ?? 'normal'
    const weight = /font-weight:\s*([0-9]+)/.exec(b)?.[1] ?? '400'
    const range = /unicode-range:\s*([^;]+);/.exec(b)?.[1] ?? ''
    if (!url) continue
    // latin block contains U+0000-00FF; latin-ext contains U+0100-02BA
    const isLatin = /U\+0000-00FF/.test(range) || /U\+0100-02BA/.test(range)
    if (!isLatin) continue
    const rr = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!rr.ok) continue
    const buf = Buffer.from(await rr.arrayBuffer())
    const f = `calib-${fam.replace(/\W+/g, '-').toLowerCase()}-${weight}-${style}-${kept}.woff2`
    writeFileSync(join(OUT, f), buf)
    css.push(`@font-face{font-family:'${fam}';font-style:${style};font-weight:${weight};src:url(/calib/${f}) format('woff2');unicode-range:${range};font-display:block}`)
    kept++; n++
  }
  report.push(`${fam}: ${kept} faces`)
}
writeFileSync(join(OUT, 'calib-fonts.css'), css.join('\n'))
console.log(report.join('\n'))
console.log(`\nTOTAL ${n} face files → ${OUT}/calib-fonts.css`)
