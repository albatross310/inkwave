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
import {
  declaredTokens, EXEMPT, isColourValue, isScannable, isTestFile, sameColour, scanSource, SKIP_DIR,
  runtimeWritten, stripComments,
  UNDECLARED_BY_DESIGN, varUses,
} from './colourScan'
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
  // driftingTokens is carried over, never recomputed here: it caps a DIFFERENT defect (a fallback
  // disagreeing with the palette) and silently re-recording it would let the drift ratchet upward
  // every time someone regenerated the literal counts.
  const { driftingTokens } = baseline
  writeFileSync(resolve(__dirname, 'colourBaseline.json'),
    JSON.stringify({ total, driftingTokens, files }, null, 2) + '\n')
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

describe('the token contract — no dangling reads, no drifted fallbacks', () => {
  const CSS = readFileSync(join(REPO, 'src/styles/index.css'), 'utf8')
  const { day, night } = declaredTokens(CSS)
  const USES = FILES.flatMap((f) => varUses(readFileSync(join(REPO, f), 'utf8')).map((u) => ({ ...u, f })))

  it('VOID GUARD: the sweep sees real tokens on both sides', () => {
    // "No dangling tokens" is true by construction if either side came back empty — the empty-list
    // trap. Both halves must be populated before any verdict below is worth reading.
    expect(USES.length, 'no var(--iw-…) reads found in src/ — the scan is blind').toBeGreaterThan(200)
    expect(day.size + night.size, 'no tokens parsed out of index.css').toBeGreaterThan(50)
  })

  it('KNOWN-NEGATIVE: the scan sees a dangling read and a drifted fallback', () => {
    // Proves both verdicts discriminate, through the same functions the real files go through.
    expect(varUses(`color: 'var(--iw-nope, #123456)'`)[0]).toEqual({ token: '--iw-nope', fallback: '#123456' })
    expect(declaredTokens(`:root { --iw-x: #abc; }`).day.get('--iw-x')).toBe('#abc')
    // Both halves matter. These four pass ONLY because both normaliser bugs are fixed: the first
    // cut called 0.10-vs-0.1 drift, the second called #000000 drift from itself.
    expect(sameColour('#fff', '#ffffff')).toBe(true)          // must NOT be called drift
    expect(sameColour('rgba(0,0,0,.1)', 'rgba(0, 0, 0, 0.10)')).toBe(true)
    expect(sameColour('#000', '#000000')).toBe(true)
    expect(sameColour('#5c2d8a55', '#5c2d8a')).toBe(false)    // alpha is part of the colour
    expect(sameColour('#5c2d8a', '#9b5ccc')).toBe(false)      // must be called drift
    expect(sameColour('rgba(0,0,0,0.1)', 'rgba(0,0,0,0.2)')).toBe(false)
  })

  it('every token a component READS is DECLARED in index.css', () => {
    // The `--iw-panel-bg` class of bug: a var() on a token nobody declared renders its fallback in
    // every theme, forever, with no error — and looks exactly like theming that worked.
    // Scoped to COLOUR tokens, derived from the fallbacks the call sites pass — the layout tokens
    // (--iw-toolbar-h, --iw-kb-offset, --iw-align…) are set imperatively from JS and are correctly
    // absent from the stylesheet.
    const colourTokens = new Set(USES.filter((u) => u.fallback && isColourValue(u.fallback)).map((u) => u.token))
    const dangling = [...new Set(
      USES.filter((u) => colourTokens.has(u.token))
        .filter((u) => !day.has(u.token) && !night.has(u.token) && !UNDECLARED_BY_DESIGN.has(u.token))
        .map((u) => `${u.token} (read in ${u.f})`),
    )]
    expect(dangling, 'declare these in src/styles/index.css, or the theme can never reach them').toEqual([])
  })

  it('every fallback AGREES with the declared day value — so declaring one repaints nothing', () => {
    // This is what makes moving a day value into the palette a provable no-op rather than a hope,
    // and it is the check that FOUND --iw-paper's three-roles-one-token collision: a token read with
    // #f7f2e8 here, #fff there and #fcfaf6 somewhere else cannot be given one day value quietly.
    const drift = new Map<string, Set<string>>()
    for (const u of USES) {
      const declared = day.get(u.token)
      if (!declared || !u.fallback) continue
      // A fallback built from a template expression (`${INK}55`) is not a literal this can compare,
      // and neither is a token aliasing another token. Comparing either reports drift that is not
      // there — an instrument manufacturing its own findings.
      if (!isColourValue(u.fallback) || !isColourValue(declared)) continue
      if (sameColour(declared, u.fallback)) continue
      if (!drift.has(u.token)) drift.set(u.token, new Set())
      drift.get(u.token)!.add(`${u.fallback} in ${u.f}`)
    }
    const lines = [...drift.entries()].map(([t, s]) => `${t} declared ${day.get(t)} but read as ${[...s].join(', ')}`)
    expect(lines.length, `fallbacks disagreeing with the palette:\n${lines.join('\n')}`)
      .toBeLessThanOrEqual(baseline.driftingTokens)
  })

  it('every token the colour scope EXCLUDES is accounted for — the exclusion is not a hole', () => {
    // NON-CIRCULAR CORROBORATION. The dangling check above scopes itself to tokens read with a
    // COLOUR fallback, so "the rest are layout channels" is its assumption, not its finding. This
    // asks a genuinely independent question of the same source: a token that nothing declares AND
    // nothing writes at runtime is unaccounted for — nobody sets it, so its fallback is all there
    // has ever been, and that is the shape of the --iw-panel-bg bug wearing a non-colour fallback.
    const written = new Set<string>()
    for (const f of FILES) for (const t of runtimeWritten(readFileSync(join(REPO, f), 'utf8'))) written.add(t)
    expect(written.size, 'no runtime-written properties found — the corroborating scan is blind')
      .toBeGreaterThan(5)

    const colourTokens = new Set(USES.filter((u) => u.fallback && isColourValue(u.fallback)).map((u) => u.token))
    const orphan = [...new Set(USES.map((u) => u.token))]
      .filter((t) => !colourTokens.has(t) && !day.has(t) && !night.has(t) && !written.has(t))
    expect(orphan, 'read, but nothing declares or writes them — are these colours?').toEqual([])
  })

  it('--iw-ink-rgb is the SAME COLOUR as --iw-ink, in both themes', () => {
    // Two declarations of one colour is exactly the drift this whole lane exists to remove, and a
    // components token cannot be an alias (`rgb(var(--x) / .1)` needs the numbers, not a colour).
    // So the duplication is unavoidable and this is what stops it rotting: lift --iw-ink for
    // legibility and forget the tints, and every purple wash in the app quietly points at the OLD
    // ink. Exactly the shape of the bug the tints already had.
    const hexToRgb = (h: string) => {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim())
      return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)).join(' ') : null
    }
    for (const [theme, map] of [['day', day], ['night', night]] as const) {
      const ink = map.get('--iw-ink')
      const rgb = map.get('--iw-ink-rgb')
      expect(ink, `--iw-ink missing in ${theme}`).toBeTruthy()
      expect(rgb, `--iw-ink-rgb missing in ${theme}`).toBeTruthy()
      expect(rgb!.trim().replace(/\s+/g, ' '), `--iw-ink-rgb disagrees with --iw-ink in ${theme}`)
        .toBe(hexToRgb(ink!))
    }
    // The converter must discriminate, or the loop above passes on nonsense.
    expect(hexToRgb('#5c2d8a')).toBe('92 45 138')
    expect(hexToRgb('#d7c8f8')).toBe('215 200 248')
    expect(hexToRgb('not a colour')).toBeNull()
  })

  it('the deliberately-undeclared list stays small and every entry is genuinely undeclared', () => {
    // An exemption nobody re-proves is how a real hole opens. If a token here HAS gained a day
    // value, it must leave this list — otherwise the list becomes a place to park drift.
    for (const t of UNDECLARED_BY_DESIGN) {
      expect(day.has(t), `${t} now has a day value — remove it from UNDECLARED_BY_DESIGN`).toBe(false)
    }
    expect(UNDECLARED_BY_DESIGN.size, 'each entry needs an argument in index.css').toBeLessThanOrEqual(2)
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
