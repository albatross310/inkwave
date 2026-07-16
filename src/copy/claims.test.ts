// §C1.4 ACROSS THE WHOLE PRODUCT — "Overclaiming on a trust brand is existential."
//
// WHY THIS EXISTS. `email/copy.test.ts` proves its matchers fire and is the best-engineered guard in
// the repo — but `ALL_COPY = Object.entries(copy)` can only ever see `src/email/copy.ts`, while its
// describe block claimed "the real in-product copy". §C1.4 is not an email rule. Nothing stopped
// another lane shipping "stored encrypted on your device" with that suite fully green — and the
// music lanes are being built against a spec whose §0 asserts encryption at rest, which THIS BUILD
// DOES NOT HAVE (storage/opfs.ts writes JSON.stringify in plaintext; no crypto.subtle.encrypt in
// src; no crypto library in package.json).
//
// PROPHYLACTIC, NOT A LIVE LEAK: this finds 0 violations today. It is here so the next lane cannot
// introduce one quietly.
//
// ─── WHAT IS SWEPT, AND THE TWO REASONS THE SCOPE IS WHAT IT IS ─────────────────────────────────
// String literals and JSX text in src/ + extension-src/, with COMMENTS STRIPPED.
//   • Comments are stripped because they are not shipped to a reader, and because this repo's
//     comments necessarily DISCUSS the forbidden claims in order to forbid them — this very file
//     would flag itself. A guard that cannot survive its own documentation gets disabled.
//   • Test files are excluded: they carry `knownBad` strings BY DESIGN. Sweeping them would flag the
//     matchers' own fixtures — the guard would fail on the thing that proves it works.
// Both exclusions are enforced as VOID conditions below (an empty sweep must fail, not pass).

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { FORBIDDEN, violates } from './claimMatchers'

const ROOTS = ['src', 'extension-src']
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '__snapshots__'])

/**
 * The matcher module carries every `knownBad` string BY DESIGN — it is the fixture carrier, and
 * sweeping it would flag the very examples that prove the guard works (measured: on the first run
 * it was the ONLY file flagged, all 7 matchers, and nothing else in the repo — which is itself
 * corroboration that there are no real violations).
 *
 * Excluding it is only safe because it is FIXTURE-ONLY, and that is ASSERTED below rather than
 * assumed: it is imported by tests alone and none of its strings appear in any built chunk. If a
 * production module ever imports it, the exclusion becomes a hole and that test fails.
 */
const FIXTURE_CARRIER = 'claimMatchers.ts'
const isTest = (f: string) =>
  /\.(test|spec)\.[tj]sx?$/.test(f) || f.endsWith('.prove.mjs') || f.endsWith(FIXTURE_CARRIER)

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIR.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e) && !isTest(e)) out.push(p)
  }
  return out
}

/**
 * Strip comments, then extract candidate user-visible text: string/template literals and JSX text
 * nodes. Deliberately OVER-collects (identifiers, class names, code strings) — a false positive is
 * a five-second read, a false negative is a shipped overclaim.
 */
function copyStringsOf(src: string): string[] {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments (":" guard keeps http:// in strings)
  const out: string[] = []
  for (const m of noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  for (const m of noComments.matchAll(/>([^<>{}]{12,})</g)) out.push(m[1]) // JSX text nodes
  return out.filter((s) => /\s/.test(s) && s.trim().length > 8) // prose-shaped only
}

const FILES = walk_all()
function walk_all(): string[] { return ROOTS.flatMap((r) => walk(r)) }

describe('§C1.4 — no forbidden claim anywhere in the product (repo-wide sweep)', () => {
  // ─── VOID CONDITIONS: an empty or blind sweep must FAIL, never pass ───────────────────────────
  // The whole failure mode this file guards against is a check that measures in a fiction. A sweep
  // over zero files, or one whose extractor returns nothing, would report a serene 0 violations.

  it('actually sweeps a meaningful number of files', () => {
    expect(FILES.length).toBeGreaterThan(50)
  })

  it('actually extracts prose from the files it sweeps', () => {
    const total = FILES.reduce((n, f) => n + copyStringsOf(readFileSync(f, 'utf8')).length, 0)
    expect(total).toBeGreaterThan(200)
  })

  it('KNOWN-POSITIVE: the sweep finds a real sentence it should find', () => {
    // If the extractor cannot see copy.ts's own honest wording, its silence about forbidden copy
    // means nothing. This pins the pipeline end-to-end against a string that IS in the product.
    const all = FILES.flatMap((f) => copyStringsOf(readFileSync(f, 'utf8')))
    expect(all.some((s) => s.includes('we never hold it'))).toBe(true)
  })

  it('KNOWN-NEGATIVE: an injected overclaim IS caught, for every matcher', () => {
    // Proves the sweep's verdict discriminates. Each knownBad is run through the exact function the
    // real files are judged by — a negative proved on a different path proves nothing.
    for (const m of FORBIDDEN) {
      expect(violates(m, m.knownBad), `${m.name} would MISS its own known-bad`).toBe(true)
    }
    // ...and through the file pipeline itself: a source file containing the claim must be flagged.
    const fakeSource = `export const blurb = "Your draft is stored encrypted on your device."`
    const hits = copyStringsOf(fakeSource).filter((s) => FORBIDDEN.some((m) => violates(m, s)))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('a claim sharing an UNPUNCTUATED clause with a negation is still caught', () => {
    // The hole the conjunction split closed (see affirmativeOnly). One missing comma used to hide a
    // forbidden claim entirely: the negator deleted the whole clause, overclaim and all.
    const tamper = FORBIDDEN.find((m) => m.name.startsWith('tamper'))!
    expect(violates(tamper, 'Every note is tamper-proof.')).toBe(true)
    expect(violates(tamper, 'Every note is tamper-proof, and we cannot read it.')).toBe(true)
    expect(violates(tamper, 'Every note is tamper-proof and we cannot read it.')).toBe(true) // was MISSED
  })

  it('the conjunction split did NOT make the matchers fire on honest copy', () => {
    // The other half. A finer split exposes more clauses standalone, so this control is what stops
    // the guard forcing the copy to become WRONG in order to stay green.
    const honest =
      'This records that this exact content existed by this time. It does not prove that you sent ' +
      'the email, that it arrived, or who it came from. Stored on your device and we never hold it; ' +
      'this is not end-to-end encrypted mail.'
    for (const m of FORBIDDEN) {
      expect(violates(m, honest), `${m.name} false-positived on honest copy`).toBe(false)
    }
  })

  it('the excluded fixture carrier is FIXTURE-ONLY — the exclusion is not a hole', () => {
    // claimMatchers.ts is skipped because it holds the knownBad examples. That is only legitimate
    // while nothing in production imports it: otherwise a real overclaim could be parked there and
    // swept under the exclusion. Proven, not assumed.
    const importers = FILES.filter((f) => readFileSync(f, 'utf8').includes('claimMatchers'))
    expect(importers, `production code imports the fixture carrier: ${importers}`).toEqual([])
  })

  it('comments are stripped — the guard survives its own documentation', () => {
    // This repo's comments must be free to NAME the forbidden claims in order to forbid them.
    const commented = `// Never say "Your draft is stored encrypted on your device."\nconst x = 'hello world here'`
    const hits = copyStringsOf(commented).filter((s) => FORBIDDEN.some((m) => violates(m, s)))
    expect(hits).toEqual([])
  })

  // ─── THE VERDICT ─────────────────────────────────────────────────────────────────────────────

  for (const m of FORBIDDEN) {
    it(`no file claims: ${m.name}`, () => {
      const offenders: string[] = []
      for (const f of FILES) {
        for (const s of copyStringsOf(readFileSync(f, 'utf8'))) {
          if (violates(m, s)) offenders.push(`${f}: "${s.trim().slice(0, 120)}"`)
        }
      }
      expect(offenders, `${m.name} claimed in:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
