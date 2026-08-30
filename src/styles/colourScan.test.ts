// THE PALETTE GATE — a ratchet on colour literals in production TS/TSX.
//
// ─── WHY A RATCHET AND NOT A BAN ─────────────────────────────────────────────────────────────────
// A gate that fails on all 892 of master's existing literals is a gate somebody deletes on Tuesday.
// So this one fails on GROWTH only: every file carries the count it had when the gate landed, and a
// file the baseline has never heard of is capped at ZERO. Deleting literals never fails. That makes
// it conflict-tolerant with the colour lanes in flight — a lane replacing `#5c2d8a` with
// `var(--iw-ink, #5c2d8a)` moves a literal from `bare` to `fallback` and the gate gets greener.
//
// ─── WHAT WOULD HAVE TO BE TRUE FOR THIS TO FAIL? ────────────────────────────────────────────────
// CLAUDE.md ROUND 12's rule: "any cell whose PASS condition is satisfiable by the mechanism that
// disables the feature is not a control." So this suite pins its own instrument first — a sweep over
// zero files, or a scanner whose regex has rotted, would report a serene zero violations and read
// exactly like a clean repo. The VOID conditions below fail in that case rather than passing, and
// the KNOWN-NEGATIVE runs a planted literal through the same `scanSource` the real files go through.
//
// NOT PROVEN HERE, and stated rather than implied: that the palettes are LEGIBLE. This counts
// literals; it cannot see contrast. That still needs eyes on a browser, which is how every night-mode
// bug in CLAUDE.md was actually found.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EXEMPT, isScannable, isTestFile, scanSource, SKIP_DIR, stripComments } from './colourScan'
import baseline from './colourBaseline.json'

const REPO = resolve(__dirname, '../..')
const ROOTS = ['src', 'extension-src']

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(join(REPO, dir)) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIR.has(e)) continue
    const rel = `${dir}/${e}`
    if (statSync(join(REPO, rel)).isDirectory()) walk(rel, out)
    else if (isScannable(rel)) out.push(rel)
  }
  return out
}

const FILES = ROOTS.flatMap((r) => walk(r))
const CENSUS = new Map(FILES.map((f) => [f, scanSource(readFileSync(join(REPO, f), 'utf8'))]))
const bareOf = (f: string) => CENSUS.get(f)!.bare.length

// Opt-in regeneration: UPDATE_COLOUR_BASELINE=1 pnpm vitest run src/styles/colourScan.test.ts
// It refuses to RAISE a cap. Raising one records the exact defect the gate exists to prevent, so
// making the gate green must never be as easy as re-running it.
if (process.env.UPDATE_COLOUR_BASELINE) {
  const files: Record<string, number> = {}
  for (const f of FILES) if (bareOf(f) > 0) files[f] = bareOf(f)
  const raised = Object.entries(files).filter(([f, n]) => n > ((baseline.files as Record<string, number>)[f] ?? 0))
  if (raised.length && !process.env.ALLOW_RAISE) {
    throw new Error(`refusing to raise caps: ${raised.map(([f, n]) => `${f} -> ${n}`).join(', ')}`)
  }
  const total = Object.values(files).reduce((a, b) => a + b, 0)
  writeFileSync(resolve(__dirname, 'colourBaseline.json'), JSON.stringify({ total, files }, null, 2) + '\n')
}

const CAPS = baseline.files as Record<string, number>

describe('palette gate — the instrument (void conditions)', () => {
  // A sweep that sees nothing reports no violations. These fail instead.
  it('sweeps a meaningful number of production files', () => {
    expect(FILES.length).toBeGreaterThan(200)
  })

  it('the scanner actually finds colours in this repo', () => {
    const total = FILES.reduce((n, f) => n + bareOf(f), 0)
    expect(total).toBeGreaterThan(100)
  })

  it('KNOWN-NEGATIVE: a planted bare literal is caught, in every shape it is written here', () => {
    // Through the same function every real file goes through — a negative proved on another path
    // proves nothing. Each shape below is one this repo actually writes.
    expect(scanSource(`const a = { color: '#5c2d8a' }`).bare).toHaveLength(1)
    expect(scanSource(`const a = { color: '#fff' }`).bare).toHaveLength(1)
    expect(scanSource(`<div style={{ background: 'rgba(0,0,0,0.18)' }} />`).bare).toHaveLength(1)
    expect(scanSource(`const s = \`0 0 0 1px #d6cfe0\``).bare).toHaveLength(1)
    expect(scanSource(`ctx.fillStyle = "#7f1d1d55"`).bare).toHaveLength(1)
  })

  it('KNOWN-POSITIVE control: the sanctioned token form is NOT counted as bare', () => {
    // Without this the gate would fail every lane that fixes a night bug the way CLAUDE.md rule 2
    // says to. It must discriminate, not merely fire.
    const tokenised = scanSource(`const a = { color: 'var(--iw-ink, #5c2d8a)' }`)
    expect(tokenised.bare).toHaveLength(0)
    expect(tokenised.fallback).toHaveLength(1)
    // ...including a function-valued fallback, which the naive regex reads as a bare literal.
    expect(scanSource(`border: 'var(--iw-edge, rgba(0,0,0,0.12))'`).bare).toHaveLength(0)
    // ...and a bare literal sitting BESIDE a var() is still caught.
    expect(scanSource(`box-shadow: 'var(--iw-x, #fff) 0 0 0 1px #000000'`).bare).toHaveLength(1)
  })

  it('comments are STRIPPED — the guard survives its own documentation', () => {
    // Not a nicety. This file, colourScan.ts and index.css all NAME colours in order to reason about
    // them; a raw-text guard fires on its own explanation and the tempting fix is to delete the
    // sentence. CLAUDE.md records three lanes hitting exactly that in one round.
    expect(scanSource(`// the ink is #5c2d8a\nconst a = 1`).bare).toHaveLength(0)
    expect(scanSource(`/* white was #fff here */\nconst a = 1`).bare).toHaveLength(0)
    // ...and stripping must not eat a string that merely LOOKS like a comment.
    expect(stripComments(`const u = 'https://x.test/a'`)).toContain('https://x.test/a')
    expect(scanSource(`const u = 'https://x.test/#ffffff'`).bare).toHaveLength(1)
  })
})

describe('palette gate — the ratchet', () => {
  it('no file exceeds its baseline cap, and an unlisted file is capped at zero', () => {
    const over = FILES
      .map((f) => ({ f, n: bareOf(f), cap: CAPS[f] ?? 0 }))
      .filter(({ n, cap }) => n > cap)
    expect(
      over.map(({ f, n, cap }) => `${f}: ${n} colour literals (cap ${cap})`).join('\n'),
      'Give these colours a token in src/styles/index.css and use it. If a literal is genuinely ' +
        'not a theme colour (a mark ink stored in a document, a brand mark), say so where it lives ' +
        'and record the cap with UPDATE_COLOUR_BASELINE=1 ALLOW_RAISE=1.',
    ).toBe('')
  })

  it('the total only ever ratchets DOWN', () => {
    const total = FILES.reduce((n, f) => n + bareOf(f), 0)
    expect(total).toBeLessThanOrEqual(baseline.total)
  })

  it('the baseline does not rot: every capped path still exists', () => {
    // A cap on a path that is GONE is dead weight that silently re-opens room for literals the day
    // someone reuses the name. Deleting or renaming a capped file means updating the baseline.
    //
    // Deliberately NOT failing on a file merely cleaned to zero: that is the migration working, and
    // a gate that goes red on a REDUCTION would fight the three colour lanes this was written
    // alongside. `the total only ever ratchets DOWN` already sees those.
    const gone = Object.keys(CAPS).filter((f) => !CENSUS.has(f))
    expect(gone, `capped paths that no longer exist — rerun with UPDATE_COLOUR_BASELINE=1: ${gone.join(', ')}`)
      .toHaveLength(0)
  })
})

describe('palette gate — the exemptions are not holes', () => {
  it('every exempt path exists and is exempt for the stated reason', () => {
    for (const p of EXEMPT) expect(() => statSync(join(REPO, p)), `${p} is gone`).not.toThrow()
    // index.css is the palette; colourScan.ts is the pattern carrier. Neither may be a component.
    expect(EXEMPT).toContain('src/styles/index.css')
    expect(EXEMPT).toContain('src/styles/colourScan.ts')
    expect(EXEMPT.length, 'a growing exemption list is the hole').toBeLessThanOrEqual(2)
  })

  it('the pattern carrier is scanned by nothing and imported only by this gate', () => {
    // colourScan.ts is exempt because it holds hex-shaped regexes as data. That is only legitimate
    // while it is not a place a real component colour could be parked. Proven, not assumed: the same
    // check claims.test.ts puts on claimMatchers.ts, and for the same reason.
    const importers = FILES.filter((f) => /from\s+'[^']*colourScan'/.test(stripComments(readFileSync(join(REPO, f), 'utf8'))))
    expect(importers, `colourScan is imported by production code: ${importers.join(', ')}`).toHaveLength(0)
    // Its exemption must cost nothing: once comments are stripped it holds no colour at all, so
    // there is no value the exemption could be hiding.
    const self = scanSource(readFileSync(join(REPO, 'src/styles/colourScan.ts'), 'utf8'))
    expect(self.bare, `colourScan.ts now hides real colours: ${self.bare.join(' ')}`).toHaveLength(0)
  })

  it('test files are excluded — and the exclusion is what makes the negatives above possible', () => {
    expect(isTestFile('src/styles/colourScan.test.ts')).toBe(true)
    expect(isTestFile('scripts/x.prove.mjs')).toBe(true)
    expect(isScannable('src/components/StyleBar.tsx')).toBe(true)
    expect(isScannable('src/styles/index.css')).toBe(false)
  })
})
