// Strip the ligature GSUB features out of self-hosted faces — shared by the font pipeline
// (scripts/fetch-fonts.mjs) and the A/B prover (scripts/fontStrip.mjs).
//
// WHY (2026-07-16, measured). The arithmetic layout engine needs canvas measureText to shape text
// the way the editor RENDERS it. The editor renders with ligatures OFF — prosemirror-view's injected
// sheet sets `font-variant-ligatures: none; font-feature-settings: "liga" 0` on .ProseMirror — while
// canvas applies them by DEFAULT. The only lever, ctx.textRendering, is Chromium/Firefox-only:
// **Safari has never shipped it on any version, desktop or iOS**. So on every iPhone canvas measured
// "office"/"affluent" 2-5px narrower than the editor draws them (controls up to Δ27.5px) and the
// engine could not run — which is exactly where its win lives (the 400-1100ms forced canonical
// reflow; canonicalIsLive already skips that on desktop).
//
// Since CSS already disables these features, their tables are DEAD WEIGHT for document text.
// Removing them from the file changes nothing visually and leaves canvas nothing to apply, so canvas
// matches the editor on EVERY engine with no API. Measured on the real build, all 18 families:
// production measure == DOM 18/18 on both engines (WebKit Δ ≤ 0.0001); DOM rendering unchanged 18/18
// at GLYPH level (per-character x positions, not just equal totals); cross-engine DOM↔DOM parity
// intact; cost +0.7 KB (+0.01%). The ZWNJ alternative was measured and FAILS (WebKit's canvas
// ignores U+200C) — stripping the font is the only lever that works there.
//
// DROPPED: liga, clig, dlig, hlig, calt — exactly what `font-variant-ligatures: none` disables (note
// `none` includes no-contextual, so calt is dead too, and canvas applies calt by default).
// KEPT: rlig (REQUIRED ligatures). CSS never disables it, canvas and the DOM both apply it so they
// already agree, and dropping it would break scripts that need it — Gentium Plus carries heavy
// linguistic coverage and is exactly the family a careless `--layout-features-=…rlig` would damage.
// kern is untouched.
//
// HOW: feature indices are removed from every LangSys; the FeatureList entries stay in place so all
// other indices remain stable, and the glyphs stay in the font (unreachable) so nothing can go
// missing. Idempotent — stripping an already-stripped face is a no-op, which is what lets the
// pipeline run this unconditionally over its whole output.

import { writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

export const DROPPED_FEATURES = ['liga', 'clig', 'dlig', 'hlig', 'calt']
export const KEPT_FEATURE = 'rlig'

const PY_STRIP = `
import sys, os
from fontTools.ttLib import TTFont
DROP = set(${JSON.stringify(DROPPED_FEATURES)})
for path in sys.argv[1:]:
    try:
        f = TTFont(path)
    except Exception as e:
        print(f"SKIP\\t{os.path.basename(path)}\\t{e}"); continue
    dropped = []
    if 'GSUB' in f and f['GSUB'].table.FeatureList:
        gsub = f['GSUB'].table
        feats = gsub.FeatureList.FeatureRecord
        drop_idx = {i for i, fr in enumerate(feats) if fr.FeatureTag in DROP}
        if drop_idx and gsub.ScriptList:
            for sr in gsub.ScriptList.ScriptRecord:
                langsyses = []
                if sr.Script.DefaultLangSys: langsyses.append(sr.Script.DefaultLangSys)
                for lr in (sr.Script.LangSysRecord or []): langsyses.append(lr.LangSys)
                for ls in langsyses:
                    keep = [i for i in ls.FeatureIndex if i not in drop_idx]
                    if len(keep) != len(ls.FeatureIndex): dropped.append(1)
                    ls.FeatureIndex = keep
                    ls.FeatureCount = len(keep)
    # Only REWRITE a face we actually changed. Re-saving an untouched font would re-compress it and
    # churn every byte of public/fonts for no reason — 225 of 322 faces carry no ligature feature at
    # all, and a diff that big hides the 97 that matter.
    if not dropped:
        print(f"OK\\t{os.path.basename(path)}\\tclean"); continue
    if path.endswith('.woff2'): f.flavor = 'woff2'
    try:
        f.save(path)
        print(f"OK\\t{os.path.basename(path)}\\tstripped")
    except Exception as e:
        print(f"FAIL\\t{os.path.basename(path)}\\t{e}")
`

// Verify: no DROPPED feature may remain REACHABLE (referenced by a LangSys), and report whether
// rlig survives. This is the guard against a silent un-strip — if someone adds a font later and the
// pass regresses, the pipeline fails loudly instead of shipping a face the engine will mis-measure.
const PY_VERIFY = `
import sys, os
from fontTools.ttLib import TTFont
DROP = set(${JSON.stringify(DROPPED_FEATURES)})
for path in sys.argv[1:]:
    try: f = TTFont(path)
    except Exception as e:
        print(f"UNREADABLE\\t{os.path.basename(path)}\\t{e}"); continue
    live, rlig = set(), False
    if 'GSUB' in f and f['GSUB'].table.FeatureList:
        gsub = f['GSUB'].table
        feats = gsub.FeatureList.FeatureRecord
        idx = set()
        if gsub.ScriptList:
            for sr in gsub.ScriptList.ScriptRecord:
                lss = ([sr.Script.DefaultLangSys] if sr.Script.DefaultLangSys else []) + [l.LangSys for l in (sr.Script.LangSysRecord or [])]
                for ls in lss: idx.update(ls.FeatureIndex)
        for i in idx:
            if i < len(feats):
                tag = feats[i].FeatureTag
                if tag in DROP: live.add(tag)
                if tag == 'rlig': rlig = True
    print(f"{'BAD' if live else 'GOOD'}\\t{os.path.basename(path)}\\t{','.join(sorted(live)) or '-'}\\t{'rlig' if rlig else '-'}")
`

/** Throws with a clear message if the toolchain isn't available — never silently skip the strip. */
export function requireFontTools() {
  try {
    execFileSync('python3', ['-c', 'import fontTools'], { stdio: 'pipe' })
  } catch {
    throw new Error(
      'fonttools is REQUIRED to strip ligature features from the served faces, and the build must\n' +
      'never ship un-stripped faces silently (canvas would then mis-measure them on Safari/iOS and\n' +
      'the arithmetic engine would wrap text wrongly). Install it:  pip install fonttools\n' +
      'See scripts/lib/stripLigatures.mjs for why.',
    )
  }
}

const fontsIn = (dir) => readdirSync(dir)
  .filter((f) => f.endsWith('.woff2') || f.endsWith('.otf') || f.endsWith('.ttf'))
  .map((f) => join(dir, f))

/**
 * Strip every face in `dir` IN PLACE. Runs over the directory's contents rather than a list of
 * downloads, so it covers the Google woff2, the DIRECT CTAN OTFs, AND any DIRECT copy carried
 * across regeneration by directKeep (which is written to the dir before this runs) — and any family
 * a future edit adds. Returns { files, stripped, bytesBefore, bytesAfter }.
 */
export function stripLigaturesInDir(dir) {
  requireFontTools()
  const files = fontsIn(dir)
  const bytesBefore = files.reduce((a, f) => a + statSync(f).size, 0)
  const tmp = '/tmp/_iw_strip_ligatures.py'
  writeFileSync(tmp, PY_STRIP)
  let stripped = 0, failed = []
  for (let i = 0; i < files.length; i += 60) {
    const out = execFileSync('python3', [tmp, ...files.slice(i, i + 60)], { encoding: 'utf8', maxBuffer: 1 << 26 })
    for (const line of out.trim().split('\n')) {
      if (!line) continue
      const [st, name, info] = line.split('\t')
      if (st === 'OK') { if (info === 'stripped') stripped++ } else failed.push(`${name}: ${info}`)
    }
  }
  if (failed.length) throw new Error(`ligature strip FAILED for ${failed.length} face(s):\n  ${failed.slice(0, 5).join('\n  ')}`)
  const bytesAfter = fontsIn(dir).reduce((a, f) => a + statSync(f).size, 0)
  return { files: files.length, stripped, bytesBefore, bytesAfter }
}

/**
 * Assert no dropped feature is still reachable in `dir`. Throws if any face would still ligate.
 * Returns { checked, withRlig } — rlig is REPORTED, never removed.
 */
export function verifyStripped(dir) {
  requireFontTools()
  const files = fontsIn(dir)
  const tmp = '/tmp/_iw_verify_ligatures.py'
  writeFileSync(tmp, PY_VERIFY)
  const bad = []
  let withRlig = 0
  for (let i = 0; i < files.length; i += 60) {
    const out = execFileSync('python3', [tmp, ...files.slice(i, i + 60)], { encoding: 'utf8', maxBuffer: 1 << 26 })
    for (const line of out.trim().split('\n')) {
      if (!line) continue
      const [st, name, live, rl] = line.split('\t')
      if (st === 'BAD') bad.push(`${name} still ligates: ${live}`)
      if (rl === 'rlig') withRlig++
    }
  }
  if (bad.length) throw new Error(`VERIFY FAILED — ${bad.length} face(s) still carry live ligature features:\n  ${bad.slice(0, 5).join('\n  ')}`)
  return { checked: files.length, withRlig }
}
