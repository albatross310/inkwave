// @vitest-environment jsdom
//
// THEMING IS MANDATORY (CLAUDE.md), and "the rendered notation is SVG" is not an excuse — it is the
// reason to be careful. This suite attacks the claim from three INDEPENDENT directions, because the
// obvious one is a fiction:
//
//   ✗ what we cannot do: assert in jsdom that the night colour applies. jsdom does not resolve CSS
//     custom properties declared in a stylesheet, so `getComputedStyle(el).getPropertyValue('--x')`
//     returns '' no matter what index.css says. A test built on that would report the DAY value in
//     both themes and pass — while proving precisely nothing. That is this house's disease.
//
//   ✓ 1. STRUCTURE OF THE TS: no bare hex outside a `day` fallback (the charts' SERIES_STYLE guard).
//   ✓ 2. STRUCTURE OF THE CSS: read index.css from disk — the actual source of truth — and require
//        every token to be defined in BOTH themes, with DIFFERENT values. This is what catches the
//        real bug (a token resolved here but never defined in the night block), and it catches it
//        without believing anything jsdom says.
//   ✓ 3. BEHAVIOUR OF THE RESOLVER: token-present vs token-absent, using inline custom properties,
//        which jsdom DOES support. This checks the fallback logic itself.
//
// What is NOT proven here: that the two palettes are legible on a real screen. That needs eyes on a
// browser and is reported as unverified rather than implied.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveScoreColors, SCORE_STYLE, scoreTokenNames } from './theme'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

/**
 * The night palette block.
 *
 * NOTE the selector: `:root[data-theme="night"] .iw-nightable { … }` — the whole night token palette
 * is SCOPED TO `.iw-nightable`, not declared on :root. That is CLAUDE.md's rule 1 expressed in CSS,
 * and it has a hard consequence for this module: the score's container MUST carry `iw-nightable` or
 * these tokens never resolve for it and every score renders in its day colours, in both themes.
 * `ScoreView.test.tsx` asserts the container does.
 */
function nightBlock(): string {
  const blocks = css.match(/:root\[data-theme="night"\][^{]*\{[^}]*\}/g) ?? []
  return blocks.join('\n')
}

function valueOf(block: string, token: string): string | null {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block)
  return m ? m[1].trim() : null
}

/** The day `:root { … }` blocks (unscoped — no attribute selector). */
function dayBlocks(): string {
  const blocks = css.match(/(?<!\])\n:root\s*\{[^}]*\}/g) ?? []
  return blocks.join('\n')
}

describe('SCORE_STYLE — structure (the SERIES_STYLE guard, for notation)', () => {
  it('names a theme token for every colour', () => {
    for (const [name, spec] of Object.entries(SCORE_STYLE)) {
      expect(spec.token, `${name} must be owned by a token`).toMatch(/^--iw-score-[a-z-]+$/)
    }
  })

  it('carries no bare hex outside the day fallback', () => {
    // A hex anywhere else is invisible to the night block and simply never themes.
    const source = readFileSync(resolve(__dirname, 'theme.ts'), 'utf8')
    const withoutComments = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const hexes = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const dayValues = Object.values(SCORE_STYLE).map(s => s.day)
    for (const hex of hexes) {
      expect(dayValues, `bare hex ${hex} is not a declared day fallback`).toContain(hex)
    }
  })

  it('has a day fallback for every token (var(--x, fallback) semantics)', () => {
    for (const [name, spec] of Object.entries(SCORE_STYLE)) {
      expect(spec.day, `${name} needs a day fallback`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('index.css — every score token is defined in BOTH themes', () => {
  it('defines each token in the day :root', () => {
    const day = dayBlocks()
    for (const token of scoreTokenNames()) {
      expect(valueOf(day, token), `${token} must be defined for the day theme`).toBeTruthy()
    }
  })

  it('defines each token in the night block', () => {
    // THE bug this catches: a token this module resolves that the night block never overrides. The
    // score would render in its day colour in BOTH themes — black staves on a charcoal page — and
    // nothing would error. It would look exactly like "notation that didn't need theming".
    const night = nightBlock()
    for (const token of scoreTokenNames()) {
      expect(valueOf(night, token), `${token} must be overridden for night`).toBeTruthy()
    }
  })

  it('gives every token a DIFFERENT value at night (the negative fires)', () => {
    // Defined-but-identical would satisfy the test above while theming nothing.
    const day = dayBlocks()
    const night = nightBlock()
    for (const token of scoreTokenNames()) {
      expect(valueOf(night, token), `${token} must actually change at night`).not.toBe(valueOf(day, token))
    }
  })

  it('PROVES the stylesheet probe works — it finds a token that exists and misses one that does not', () => {
    // A probe that silently matched nothing would make all three tests above vacuously pass.
    expect(valueOf(dayBlocks(), '--iw-score-ink')).toBe('#1c1917')
    expect(valueOf(nightBlock(), '--iw-score-ink')).toBe('#dfe3e9')
    expect(valueOf(nightBlock(), '--iw-score-not-a-real-token')).toBeNull()
    // The two probes really are reading DIFFERENT blocks — if dayBlocks() accidentally matched the
    // night rules too (or vice versa), the "different value at night" test would compare a value
    // with itself and could never fail.
    expect(dayBlocks()).not.toMatch(/data-theme/)
    expect(nightBlock()).toMatch(/data-theme="night"/)
    expect(valueOf(dayBlocks(), '--iw-score-ink')).not.toBe(valueOf(nightBlock(), '--iw-score-ink'))
  })

  it('confirms the night palette is scoped to .iw-nightable — the constraint on the container', () => {
    // Recorded as a test because it is load-bearing and non-obvious: the tokens are NOT on :root at
    // night. If this ever changes to an unscoped :root block, the iw-nightable requirement on the
    // score container relaxes — and if it changes the other way, a container missing the class stops
    // theming with no error.
    const scoped = /:root\[data-theme="night"\]\s+\.iw-nightable\s*\{[^}]*--iw-score-ink/.test(css)
    expect(scoped).toBe(true)
  })
})

describe('resolveScoreColors — the fallback logic', () => {
  it('falls back to the day value when the token is not defined', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveScoreColors(el).music).toBe(SCORE_STYLE.music.day)
  })

  it('uses the token when one is set', () => {
    // Inline custom properties are the one form jsdom does resolve — enough to prove the resolver
    // prefers the token over the fallback, which is the logic this function owns.
    const el = document.createElement('div')
    el.style.setProperty('--iw-score-ink', '#abcdef')
    document.body.appendChild(el)
    expect(resolveScoreColors(el).music).toBe('#abcdef')
  })

  it('resolves every colour the notation needs', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const colours = resolveScoreColors(el)
    expect(Object.keys(colours).sort()).toEqual(Object.keys(SCORE_STYLE).sort())
    for (const [name, value] of Object.entries(colours)) {
      expect(value, `${name} must resolve to something`).toBeTruthy()
    }
  })
})
