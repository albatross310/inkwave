#!/usr/bin/env node
// PROVE A CHANGE IS COMMENTS-ONLY.
//
// The narrative→archive migration moves explanation out of source and leaves the rule behind. That
// is only safe if the CODE is untouched, and "the tests still pass" does not show it — a test suite
// can be green across a real behaviour change it does not cover.
//
// ⚠ COMPARING BUILD OUTPUT DOES NOT WORK, measured: two builds of an UNCHANGED tree differ in 14
// chunks (rollup chunk naming is not deterministic here). An instrument that reports a difference
// between two identical inputs cannot report anything about two different ones.
//
// So: strip comments and blank lines from both revisions and compare. The regex is naive about a
// string literal containing `//` — which is fine, because it is only ever used to compare two
// versions of the SAME file, where such a literal appears identically on both sides.
//
//   node scripts/prose-only.mjs <base-rev> [path…]     (paths default to the changed files)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(?<!:)\/\/.*$/, '').trimEnd())
  .filter((l) => l.trim())
  .join('\n')

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 })

const base = process.argv[2]
if (!base) { console.error('usage: prose-only.mjs <base-rev> [path…]'); process.exit(2) }
const paths = process.argv.slice(3).length
  ? process.argv.slice(3)
  : git('diff', '--name-only', base, '--').split('\n').filter((p) => /\.(ts|tsx|mjs)$/.test(p))

let changed = 0, checked = 0
for (const p of paths) {
  let before
  try { before = git('show', `${base}:${p}`) } catch { console.log(`  + ${p} (new file — not comparable)`); continue }
  let after
  try { after = readFileSync(p, 'utf8') } catch { console.log(`  − ${p} (deleted)`); changed++; continue }
  checked++
  if (strip(before) === strip(after)) {
    const b = before.split('\n').length, a = after.split('\n').length
    console.log(`  ✓ ${p}  ${b} → ${a} lines, code identical (${b - a > 0 ? '−' : '+'}${Math.abs(b - a)} prose)`)
  } else {
    console.log(`  ✗ ${p}  CODE CHANGED`)
    changed++
  }
}
console.log(changed
  ? `\nNOT prose-only: ${changed} of ${checked} file(s) changed code.`
  : `\nPROSE-ONLY: ${checked} file(s), every one code-identical.`)
process.exit(changed ? 1 : 0)
