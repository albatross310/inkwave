// Build script: produces two extension zips from the same source.
// Usage:  node extension/build.mjs
// Output: dist/inkwave-citation-chrome-<version>.zip
//         dist/inkwave-citation-firefox-<version>.zip

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dir, '..')
const dist = path.join(root, 'dist', 'extensions')

const manifest = JSON.parse(fs.readFileSync(path.join(__dir, 'manifest.json'), 'utf8'))
const VERSION = manifest.version

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

// ── helpers ──────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f)
    const d = path.join(dest, f)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function writeJson(dest, obj) {
  fs.writeFileSync(dest, JSON.stringify(obj, null, 2) + '\n')
}

function zip(srcDir, outFile) {
  const rel = path.relative(path.dirname(srcDir), srcDir)
  execSync(`cd "${path.dirname(srcDir)}" && zip -r "${outFile}" "${rel}"`, { stdio: 'inherit' })
  console.log(`  → ${outFile}`)
}

// ── Chrome build ─────────────────────────────────────────────────────────────

const chromeSrc = ['manifest.json', 'background.js', 'lib.js', 'content-inkwave.js',
                   'popup.html', 'popup.js', 'icon-128.png']

const chromeDir = path.join(dist, `chrome-${VERSION}`)
fs.mkdirSync(chromeDir, { recursive: true })
for (const f of chromeSrc) {
  fs.copyFileSync(path.join(__dir, f), path.join(chromeDir, f))
}

const chromeZip = path.join(dist, `inkwave-citation-chrome-${VERSION}.zip`)
if (fs.existsSync(chromeZip)) fs.unlinkSync(chromeZip)
zip(chromeDir, chromeZip)

// ── Firefox build ─────────────────────────────────────────────────────────────
// Firefox MV3 (128+) supports "scripts" with "type": "module" for event pages,
// so background.js + lib.js can be used as-is (no bundling needed).

const ffDir = path.join(dist, `firefox-${VERSION}`)
fs.mkdirSync(ffDir, { recursive: true })

// Use the Firefox manifest (renamed to manifest.json in the package)
const ffManifest = JSON.parse(fs.readFileSync(path.join(__dir, 'manifest-firefox.json'), 'utf8'))
writeJson(path.join(ffDir, 'manifest.json'), ffManifest)

for (const f of ['background.js', 'lib.js', 'content-inkwave.js', 'popup.html', 'popup.js', 'icon-128.png']) {
  fs.copyFileSync(path.join(__dir, f), path.join(ffDir, f))
}

const ffZip = path.join(dist, `inkwave-citation-firefox-${VERSION}.zip`)
if (fs.existsSync(ffZip)) fs.unlinkSync(ffZip)
zip(ffDir, ffZip)

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\nBuilt:')
console.log(`  Chrome: ${path.relative(root, chromeZip)}`)
console.log(`  Firefox: ${path.relative(root, ffZip)}`)
