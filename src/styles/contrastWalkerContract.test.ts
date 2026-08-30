// THE SHARED CONTRAST WALKER MUST DEFINE EVERY GLOBAL ITS PROBES USE.
//
// ⚠ WHY THIS EXISTS (2026-08-30, and it is a merge scar, not a hypothetical). Three night-mode
// lanes ran in parallel. One EXTRACTED the walker into scripts/textrender-probe/contrastWalker.mjs
// so both probes would score by one rule — the right design. The other two had each ADDED
// capabilities to their own private copy. Resolving the conflict by taking either side whole
// dropped the other's work, twice: first the backdrop fix (silent — the probe still PASSED, just
// against the wrong surface), then `window.__iwSurface` (loud — TypeError mid-run).
//
// The loud one was luck. The silent one is the shape that matters: a walker missing a capability
// scores the WRONG THING and reports 0 failures, which is indistinguishable from a healthy palette.
// CLAUDE.md's headline applies exactly — this project establishes truth well and has no mechanism
// for KEEPING it — so the browser probes stay the truth and this is the guard: ~10ms, no browser.
//
// It reads the PROBES to find what they consume, rather than holding a hand-written list that
// would drift the first time someone adds a helper. Comments are stripped before scanning: this
// file's own prose names `__iwSurface` in order to explain it, and a raw-text guard would count
// its own documentation as a usage — the corrosion CLAUDE.md records biting three lanes in one
// round.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROBE_DIR = join(process.cwd(), 'scripts', 'textrender-probe')
const WALKER = join(PROBE_DIR, 'contrastWalker.mjs')

/** Strip line and block comments so a guard cannot fire on prose that merely NAMES a symbol. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const probeFiles = () =>
  readdirSync(PROBE_DIR).filter((f) => f.endsWith('.prove.mjs'))

const globalsUsedBy = (src: string) =>
  new Set([...stripComments(src).matchAll(/window\.(__iw[A-Za-z]+)\s*\(/g)].map((m) => m[1]))

const globalsDefinedInWalker = () =>
  new Set([...stripComments(readFileSync(WALKER, 'utf8')).matchAll(/window\.(__iw[A-Za-z]+)\s*=/g)].map((m) => m[1]))

describe('the shared contrast walker satisfies its probes', () => {
  it('VOID GUARD: there are probes to check, and the walker defines something', () => {
    // An empty sweep must FAIL, never pass quietly — the empty-list trap this repo keeps hitting.
    expect(probeFiles().length).toBeGreaterThan(0)
    expect(globalsDefinedInWalker().size).toBeGreaterThan(0)
  })

  it('VOID GUARD: at least one probe actually calls a walker global', () => {
    // If the scan matched nothing, "no missing globals" below would be true by construction.
    const total = probeFiles().reduce(
      (n, f) => n + globalsUsedBy(readFileSync(join(PROBE_DIR, f), 'utf8')).size, 0)
    expect(total).toBeGreaterThan(0)
  })

  it('defines every __iw global that any probe calls', () => {
    const defined = globalsDefinedInWalker()
    const missing: string[] = []
    for (const f of probeFiles()) {
      const src = readFileSync(join(PROBE_DIR, f), 'utf8')
      // Only probes that USE the shared walker are in scope; one with its own is its own business.
      if (!/contrastWalker\.mjs/.test(src)) continue
      for (const g of globalsUsedBy(src)) if (!defined.has(g)) missing.push(`${f} calls window.${g}`)
    }
    expect(missing).toEqual([])
  })

  it('the guard can SEE a missing global (known-negative)', () => {
    // Prove the matcher discriminates, rather than trusting an empty `missing` list.
    const defined = globalsDefinedInWalker()
    expect(globalsUsedBy('x = window.__iwDefinitelyNotDefined()').has('__iwDefinitelyNotDefined')).toBe(true)
    expect(defined.has('__iwDefinitelyNotDefined')).toBe(false)
  })

  it('comments are stripped, so the guard survives its own documentation', () => {
    expect(globalsUsedBy('// window.__iwGhost() is explained here\n').size).toBe(0)
    expect(globalsUsedBy('/* window.__iwGhost() */\n').size).toBe(0)
  })
})
