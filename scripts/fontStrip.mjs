// STRIP LIGATURE FEATURES FROM THE SELF-HOSTED FACES (2026-07-16 — the iOS rescue attempt).
//
// WHY. The arithmetic engine needs canvas measureText to shape text the way the editor renders it.
// The editor renders with ligatures OFF — prosemirror-view's injected sheet puts
// `font-variant-ligatures: none; font-feature-settings: "liga" 0` on .ProseMirror. Canvas applies
// ligatures by DEFAULT and the only lever is ctx.textRendering, which **Safari has never shipped on
// any version, desktop or iOS** — so on every iPhone that exists the engine cannot match the editor.
//
// THE IDEA. The ligature tables in the faces we serve are NEVER USED for document text (CSS already
// disables them). So strip those GSUB features out of the woff2 we self-host: nothing changes
// visually, but canvas has no ligatures left to apply and matches the editor on EVERY engine — no
// API required. We self-host all 18 families and own the pipeline, so this is entirely in our hands.
//
// WHAT IS DROPPED, and why exactly these: `font-variant-ligatures: none` disables common (liga,
// clig), discretionary (dlig), historical (hlig) AND contextual (calt). Those five are therefore
// dead weight for document text and are dropped. `rlig` (REQUIRED ligatures) is NOT dropped — CSS
// never disables it, canvas and the DOM both apply it, so they already agree, and removing it would
// break scripts that need it (Gentium Plus carries heavy linguistic coverage). `kern` is untouched.
//
// HOW. The feature indices are removed from every LangSys, leaving FeatureList entries in place so
// all other indices stay stable. The glyphs remain in the font (harmless, unreachable) — so the
// byte cost is ~nil and no glyph can go missing.
//
// Usage: node scripts/fontStrip.mjs   → /tmp/iw-strip-fonts/{files, strip-fonts.css}
//        (declares each family under a ' STRIP' alias so a harness can A/B it against the original)

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_DIRS = [join(ROOT, 'public/fonts'), '/tmp/iw-calib-fonts']
const OUT = '/tmp/iw-strip-fonts'
mkdirSync(OUT, { recursive: true })

const PY = `
import sys, glob, os
from fontTools.ttLib import TTFont
DROP = {'liga','clig','dlig','hlig','calt'}
out_dir = sys.argv[1]
report = []
for path in sys.argv[2:]:
    name = os.path.basename(path)
    try:
        f = TTFont(path)
    except Exception as e:
        report.append(f"SKIP\\t{name}\\t{e}"); continue
    dropped = []
    if 'GSUB' in f and f['GSUB'].table.FeatureList:
        gsub = f['GSUB'].table
        feats = gsub.FeatureList.FeatureRecord
        drop_idx = {i for i, fr in enumerate(feats) if fr.FeatureTag in DROP}
        dropped = sorted({feats[i].FeatureTag for i in drop_idx})
        if drop_idx and gsub.ScriptList:
            for sr in gsub.ScriptList.ScriptRecord:
                langsyses = []
                if sr.Script.DefaultLangSys: langsyses.append(sr.Script.DefaultLangSys)
                for lr in (sr.Script.LangSysRecord or []): langsyses.append(lr.LangSys)
                for ls in langsyses:
                    keep = [i for i in ls.FeatureIndex if i not in drop_idx]
                    ls.FeatureIndex = keep
                    ls.FeatureCount = len(keep)
    f.flavor = 'woff2'
    outp = os.path.join(out_dir, name)
    try:
        f.save(outp)
        report.append(f"OK\\t{name}\\t{','.join(dropped) if dropped else '-'}")
    except Exception as e:
        report.append(f"FAIL\\t{name}\\t{e}")
print("\\n".join(report))
`
writeFileSync('/tmp/_strip.py', PY)

const files = []
for (const d of SRC_DIRS) {
  if (!existsSync(d)) continue
  for (const f of readdirSync(d)) if (f.endsWith('.woff2') || f.endsWith('.otf')) files.push(join(d, f))
}
console.log(`stripping ${files.length} faces …`)
const BATCH = 60
let ok = 0, skip = 0, withFeat = 0
for (let i = 0; i < files.length; i += BATCH) {
  const out = execFileSync('python3', ['/tmp/_strip.py', OUT, ...files.slice(i, i + BATCH)], { encoding: 'utf8', maxBuffer: 1 << 26 })
  for (const line of out.trim().split('\n')) {
    if (!line) continue
    const [st, , feats] = line.split('\t')
    if (st === 'OK') { ok++; if (feats && feats !== '-') withFeat++ } else skip++
  }
}
console.log(`  ok ${ok}  (had ligature features: ${withFeat})   skipped/failed ${skip}`)

// Build a CSS that declares every family under a ' STRIP' alias, pointing at the stripped files.
const cssParts = []
for (const [dir, cssFile, urlPrefix] of [
  [join(ROOT, 'public/fonts'), join(ROOT, 'public/fonts/inkwave-fonts.css'), '/fonts/'],
  ['/tmp/iw-calib-fonts', '/tmp/iw-calib-fonts/calib-fonts.css', '/calib/'],
]) {
  if (!existsSync(cssFile)) continue
  let css = readFileSync(cssFile, 'utf8')
  // alias the family and repoint the url at the stripped copy
  css = css.replace(/font-family:\s*'([^']+)'/g, (_m, fam) => `font-family:'${fam} STRIP'`)
  css = css.replace(new RegExp(`url\\(${urlPrefix.replace('/', '\\/')}([^)]+)\\)`, 'g'), (_m, f) => `url(/strip/${basename(f)})`)
  cssParts.push(css)
}
writeFileSync(join(OUT, 'strip-fonts.css'), cssParts.join('\n'))
console.log(`  → ${OUT}/strip-fonts.css  (families aliased '<Family> STRIP')`)
