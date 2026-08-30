// Cutting an extension release, as far as a script honestly can.
//
// Peter, 2026-08-30: the source panel's "get the extension" card now sends writers to this repo's
// GitHub Releases page, so somebody has to put a zip there. `pnpm ext:build` already produces one;
// what was missing was knowing WHICH file and WHERE, which is exactly the kind of remembered step
// that goes wrong at 1am. This runs the build and then reports the artifact.
//
// ⚠ IT DOES NOT UPLOAD, DELIBERATELY. Publishing is the moment a decision is made — which version,
// with what notes, to whom — and a script that does it on the way past turns that decision into a
// side effect. It also cannot: uploading needs a token this repo does not hold.
//
// ⚠ AND IT REPORTS AN ABSENT ZIP AS AN ABSENCE, not as success. A "release script" that prints a
// cheerful line whether or not it built anything is the instrument this repo keeps writing up.

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'extension-src', '.output')

console.log('Building the extension…\n')
execFileSync('pnpm', ['ext:build'], { cwd: root, stdio: 'inherit' })

let zips = []
try {
  zips = readdirSync(out)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({ f, p: join(out, f), t: statSync(join(out, f)).mtimeMs, s: statSync(join(out, f)).size }))
    .sort((a, b) => b.t - a.t)
} catch {
  // The directory not existing is the same answer as it being empty HERE — the build just ran and
  // was asked to write there — so this catch is not the "failed read as absence" trap.
  zips = []
}

if (!zips.length) {
  console.error('\n✗ The build produced no zip in extension-src/.output — nothing to release.')
  process.exit(1)
}

console.log('\n✔ Built:')
for (const z of zips.slice(0, 4)) {
  console.log(`    ${z.p}  (${(z.s / 1024).toFixed(0)} KB)`)
}
console.log(`
Next, by hand — this script deliberately does not publish:
  1. https://github.com/albatross310/inkwave/releases  →  Draft a new release
  2. Tag it with the extension's version (extension-src/package.json)
  3. Attach the chrome zip above
  4. Publish

The source panel's install card links to that Releases PAGE, so it stays honest before the
release exists and starts working the moment it does — no URL to change here.
  (The link lives in src/reader/extensionDownload.ts.)
`)
