// Self-host the app's web fonts. Run when the font set changes:
//
//   node scripts/fetch-fonts.mjs
//
// It downloads every face/subset of the families below from Google Fonts into public/fonts/, writes
// public/fonts/inkwave-fonts.css (same @font-face, but pointing at the local woff2), and regenerates
// app/fontPreload.ts — the list of faces root.tsx preloads. Same-origin fonts make the editor's serif
// identity deterministic everywhere, including the server-side PDF/print render (no external fetch
// race). To add a font: add it to FAMILIES, re-run — its latin faces are picked up + preloaded
// automatically, no hand-edited <link> tags.

import fs from 'node:fs'
import { stripLigaturesInDir, verifyStripped, requireFontTools, DROPPED_FEATURES } from './lib/stripLigatures.mjs'

// Google Fonts css2 `family=` specifiers. Add new families here.
const FAMILIES = [
  'EB+Garamond:ital,wght@0,400;0,500;0,700;1,400;1,500;1,700',
  'IM+Fell+DW+Pica:ital@0;1',
  // MATH-CERTIFIED StyleBar families (2026-07-12 waves 1-4; r7's FAILED list RETRACTED 2026-07-16
  // — see CLAUDE.md). r7 measured canvas vs a plain span with ligatures ON on BOTH sides, but the
  // editor renders liga OFF (prosemirror-view's injected sheet), and canvas applies ligatures by
  // default — so 13 faces were rejected for a divergence that cannot occur in production. Re-run in
  // the real context they ALL certify at Δ0.0000. Libre Baskerville + Caladea are shipped from that
  // list (Peter, 2026-07-16). Still available if ever wanted: Tinos, Arimo, Vollkorn, Baskervville,
  // Libre Caslon Text, Quattrocento, PT Serif, Source Serif 4, Alegreya, STIX Two Text, Inter,
  // Cardo, Noto Sans, Noto Serif, Open Sans, Fira Code.
  // NB Libre Baskerville has NO 700-italic face upstream (400/700/400i only) — the browser
  // synthesises bold-italic for it; Caladea ships all four.
  'Libre+Baskerville:ital,wght@0,400;0,700;1,400',
  'Caladea:ital,wght@0,400;0,700;1,400;1,700',
  'Spectral:ital,wght@0,400;0,700;1,400;1,700',
  // Genre additions (2026-07-16, Peter: another quality sans/slab/mono). Certified in the real
  // context: Inter Δ0.0000, Zilla Slab Δ0.0000 (real italics, x/cap 0.682 = furthest from Bitter),
  // Courier Prime Δ0.0000 (x/cap 0.776 — fixes Courier's thin, small-bodied look). Rejected:
  // Arvo (genuinely FAILS, Δ12 @96px — real integer-px quantization, not a ligature artefact),
  // Roboto Slab + Fira Code (no upstream italic — synthesised obliques), Prata (ships 400 only).
  'Inter:ital,wght@0,400;0,700;1,400;1,700',
  'Zilla+Slab:ital,wght@0,400;0,700;1,400;1,700',
  'Courier+Prime:ital,wght@0,400;0,700;1,400;1,700',
  // RETIRED FROM THE PICKER, STILL HOSTED (2026-07-16). Lora + Gelasio are gone from StyleBar, but
  // their faces MUST keep shipping: an existing mark falls back down its own stack to Cambria /
  // Georgia — SYSTEM fonts, which are uncertifiable and (CLAUDE.md) "already broke cross-device
  // canonical breaks for marked runs". Deleting the woff2 would silently repaginate old documents
  // phone-vs-print. They load on demand and nobody new can select them, so hosting costs nothing.
  'Gelasio:ital,wght@0,400;0,700;1,400;1,700',
  'Lora:ital,wght@0,400;0,700;1,400;1,700',
  'Carlito:ital,wght@0,400;0,700;1,400;1,700',
  'Crimson+Pro:ital,wght@0,400;0,700;1,400;1,700',
  'Gentium+Plus:ital,wght@0,400;0,700;1,400;1,700',
  'Cormorant+Garamond:ital,wght@0,400;0,700;1,400;1,700',
  'Fraunces:ital,wght@0,400;0,700;1,400;1,700',
  'Bitter:ital,wght@0,400;0,700;1,400;1,700',
  'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700',
  'JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700',
]
// Non-Google certified clones (GUST Font Licence — freely redistributable): the 'Times' and
// 'Arial' picker slots. Downloaded as OTF from CTAN and served like every other self-hosted face.
const DIRECT = [
  ['TeX Gyre Termes', 400, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyretermes-regular.otf'],
  ['TeX Gyre Termes', 700, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyretermes-bold.otf'],
  ['TeX Gyre Termes', 400, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyretermes-italic.otf'],
  ['TeX Gyre Termes', 700, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyretermes-bolditalic.otf'],
  ['TeX Gyre Heros', 400, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-regular.otf'],
  ['TeX Gyre Heros', 700, 'normal', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-bold.otf'],
  ['TeX Gyre Heros', 400, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-italic.otf'],
  ['TeX Gyre Heros', 700, 'italic', 'https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-bolditalic.otf'],
]
// Only the IDENTITY serifs preload (boot weight — see CLAUDE.md load-performance rules); the
// StyleBar families self-host but load on demand, and the pagination re-measures on 'loadingdone'.
const PRELOAD_FAMILIES = new Set(['EB Garamond', 'IM Fell DW Pica'])
// Subsets to PRELOAD (fetched eagerly on page load). Others (greek, cyrillic, vietnamese, …) still
// self-host and load on demand — we just don't force them upfront.
const PRELOAD_SUBSETS = new Set(['latin', 'latin-ext'])

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const url = `https://fonts.googleapis.com/css2?${FAMILIES.map((f) => `family=${f}`).join('&')}&display=swap`

// PREFLIGHT — the strip pass below is NOT optional (see lib/stripLigatures.mjs). Fail before we
// download 6 MB rather than after, and never fall through to shipping un-stripped faces.
requireFontTools() // toolchain only — the real verify runs on the OUTPUT, after the strip
const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
// DIRECT assets survive regeneration (CTAN mirrors are flaky; the bytes are pinned releases) —
// carry any existing copies across the wipe and only fetch the ones we don't have.
const directKeep = new Map()
for (const [fam, weight, style] of DIRECT) {
  const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const name = `${slug}-${weight}-${style}.otf`
  try { directKeep.set(name, fs.readFileSync(`public/fonts/${name}`)) } catch { /* not present yet */ }
}
fs.rmSync('public/fonts', { recursive: true, force: true })
fs.mkdirSync('public/fonts', { recursive: true })

// Each @font-face is preceded by a `/* <subset> */` comment in the Google css2 output.
const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([\s\S]*?)\}/g
let out = '/* Inkwave self-hosted fonts — generated by scripts/fetch-fonts.mjs. Do not edit by hand.\n   Same-origin so PDF/print render is deterministic (no external fetch race). */\n\n'
const preload = []
let m
let i = 0
let bytes = 0
while ((m = re.exec(css))) {
  const [, subset, body] = m
  const fam = (body.match(/font-family:\s*'([^']+)'/) || [])[1]
  const style = (body.match(/font-style:\s*(\w+)/) || [])[1] || 'normal'
  const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400'
  const src = (body.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/) || [])[1]
  if (!fam || !src) continue
  const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const name = `${slug}-${weight}-${style}-${i}.woff2`
  const buf = Buffer.from(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer())
  fs.writeFileSync(`public/fonts/${name}`, buf)
  bytes += buf.length
  out += '@font-face {' + body.replace(src, `/fonts/${name}`) + '}\n\n'
  if (subset && PRELOAD_SUBSETS.has(subset) && PRELOAD_FAMILIES.has(fam)) preload.push(`/fonts/${name}`)
  i++
}

// Non-GF certified clones (see DIRECT above) — same self-hosted treatment, OTF format.
for (const [fam, weight, style, srcUrl] of DIRECT) {
  const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const name = `${slug}-${weight}-${style}.otf`
  const buf = directKeep.get(name) ?? Buffer.from(await (await fetch(srcUrl, { headers: { 'User-Agent': UA } })).arrayBuffer())
  fs.writeFileSync(`public/fonts/${name}`, buf)
  bytes += buf.length
  i++
  out += `@font-face {\n  font-family: '${fam}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(/fonts/${name}) format('opentype');\n}\n\n`
}

// ── STRIP LIGATURES (2026-07-16) — MUST run over the finished directory, not the download list ──
// Doing it as a final pass over public/fonts is what makes it total: it covers the Google woff2, the
// DIRECT CTAN OTFs, AND any DIRECT copy carried across the wipe by directKeep (written above, so it
// is on disk by now — a kept copy would otherwise survive UN-STRIPPED), and it will cover whatever
// family a future edit adds without anyone remembering to. Idempotent, so re-running is safe.
// The engine's correctness on Safari/iOS depends on this: see lib/stripLigatures.mjs.
const strip = stripLigaturesInDir('public/fonts')
const check = verifyStripped('public/fonts') // throws if ANY face can still ligate
const stripDelta = strip.bytesAfter - strip.bytesBefore
console.log(`stripped ${DROPPED_FEATURES.join('/')} from ${strip.stripped}/${strip.files} faces `
  + `(${(stripDelta / 1024).toFixed(1)} KB, ${(100 * stripDelta / strip.bytesBefore).toFixed(2)}%); `
  + `verified ${check.checked} faces carry no live ligature feature; ${check.withRlig} keep rlig`)

fs.writeFileSync('public/fonts/inkwave-fonts.css', out.trimEnd() + '\n')
fs.writeFileSync(
  'app/fontPreload.ts',
  '// AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit. The latin/latin-ext faces root.tsx\n' +
    '// preloads, so the serif body paints without a flash. Re-run the script to refresh.\n' +
    `export const FONT_PRELOAD: string[] = [\n${preload.map((p) => `  '${p}',`).join('\n')}\n]\n`,
)
console.log(`wrote ${i} faces (${(bytes / 1024).toFixed(0)} KB), preloading ${preload.length}`)
