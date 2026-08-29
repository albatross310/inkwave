// NIGHT-MODE CONTRAST — THE CHEAP GUARD BEHIND scripts/textrender-probe/nightaudit.prove.mjs.
//
// WHY THIS FILE EXISTS. The browser probe is the truth: it drives the real reader, the real PDF
// viewer and the real references panel in both themes and reads COMPUTED colours. But CLAUDE.md's
// headline finding applies to it exactly — "a proof that ran once and convinced everyone is
// indistinguishable, six weeks later, from a proof that never ran, and the gate says green either
// way". So the PURE half of what that probe established lives here: which token sits on which
// surface, and whether that pairing clears WCAG in BOTH themes. ~10ms, no browser.
//
// ✗ WHAT THIS CANNOT DO, and the reason it reads CSS text rather than the DOM: jsdom does not
//   resolve custom properties declared in a stylesheet, so `getComputedStyle(el).getPropertyValue`
//   returns '' whatever index.css says — a test built on it reports the DAY value in both themes
//   and passes while proving nothing (music/theme.test.ts records the same trap). So the values are
//   read from index.css itself, the actual source of truth.
//
// ✗ IT ALSO CANNOT SEE A SURFACE NOBODY DECLARED. If a component paints a literal hex inline, this
//   file knows nothing about it — that is what the browser probe is for. This pins the PAIRINGS the
//   probe measured, so that changing a token's night value re-fires here instead of six weeks later
//   on Peter's screen.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, './index.css'), 'utf8')

// ── WCAG 2.1 relative luminance + contrast ratio ────────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── Token values, read out of index.css ─────────────────────────────────────────────────────────
/** Every `:root{…}` block with NO attribute selector — the DAY declarations. */
const dayBlocks = (css.match(/:root\s*\{[^}]*\}/g) ?? []).join('\n')
/** Every night block, scoped or unscoped — `:root[data-theme="night"] …{…}`. */
const nightBlocks = (css.match(/:root\[data-theme="night"\][^{]*\{[^}]*\}/g) ?? []).join('\n')

function valueIn(block: string, token: string): string | null {
  // LAST declaration wins, as the cascade does — a token redeclared later in the file is the live one.
  const all = [...block.matchAll(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, 'g'))]
  return all.length ? all[all.length - 1][1] : null
}
function token(name: string, theme: 'day' | 'night'): string {
  const block = theme === 'day' ? dayBlocks : nightBlocks
  const v = valueIn(block, name)
  // A night token that falls back to its day value is the commonest form of this bug, so an absent
  // night declaration must FAIL rather than quietly resolve to day.
  expect(v, `${name} is declared in the ${theme} palette of index.css`).toBeTruthy()
  return v as string
}

// The two chrome surfaces the .iw-nightable block paints, read from the CSS rather than retyped:
// the panel itself, and a nested fill (what `.bg-white` becomes inside one).
const NIGHT_PANEL = /\.iw-nightable\s*\{[^}]*background-color:\s*(#[0-9a-f]{6})/i.exec(nightBlocks)?.[1] ?? ''
const NIGHT_NESTED = /\.bg-white[^{]*\{\s*background-color:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] ?? ''
const NIGHT_TEXT = /\.iw-nightable\s*\{[^}]*[^-]color:\s*(#[0-9a-f]{6})/i.exec(nightBlocks)?.[1] ?? ''
const WHITE = '#ffffff'

const BODY = 4.5   // WCAG 1.4.3 AA, normal text
const UI = 3       // WCAG 1.4.11, a control / glyph / large text

describe('the contrast maths can fail', () => {
  // A ratio function that cannot report a failure would make every assertion below vacuous — the
  // exact shape of the defensive clamp CLAUDE.md records under the pearson() finding.
  it('sees the real night bug: #5c2d8a ink on the #454e59 chrome panel', () => {
    expect(contrastRatio('#5c2d8a', '#454e59')).toBeLessThan(1.2)
  })
  it('and passes a known-good pairing', () => {
    expect(contrastRatio('#dfe3e9', '#454e59')).toBeGreaterThan(6)
  })
  it('is symmetric and reaches its bounds', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})

describe('index.css declares the surfaces this suite reasons about', () => {
  it('found the night chrome panel, its nested fill, and its text colour', () => {
    // VOID rather than pass: if the regexes stop matching, every pairing below would silently be
    // scored against an empty string.
    expect(NIGHT_PANEL, 'the .iw-nightable night background').toMatch(/^#[0-9a-f]{6}$/i)
    expect(NIGHT_NESTED, 'the night fill that replaces .bg-white').toMatch(/^#[0-9a-f]{6}$/i)
    expect(NIGHT_TEXT, 'the .iw-nightable night text colour').toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('CHROME tokens read on the chrome surfaces they are used on', () => {
  // These are the pairings the source reader's header, section list and selection popover use.
  // `--iw-ink` at 1.13:1 on #454e59 was the measured bug: the panel title and all four icon
  // buttons were invisible at night.
  it('--iw-ink is legible on the night panel AND on the day panel', () => {
    expect(contrastRatio(token('--iw-ink', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(UI)
    expect(contrastRatio(token('--iw-ink', 'day'), WHITE)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-ink is legible on a NESTED night fill (the selection popover is a .bg-white bubble)', () => {
    expect(contrastRatio(token('--iw-ink', 'night'), NIGHT_NESTED)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-pill-fg (the section list, muted chrome labels) is legible in both themes', () => {
    expect(contrastRatio(token('--iw-pill-fg', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-verified (the references panel’s "used" marker) is legible in both themes', () => {
    // ⚠ ASYMMETRIC BY THE APP'S OWN CONVENTION: the older chrome tokens (--iw-verified, --iw-pill-fg)
    // are declared ONLY in the night block; their day value is the inline `var(…, #fallback)` at each
    // use site. So the day arm names that fallback rather than demanding a :root declaration that
    // index.css deliberately does not carry — asking for one would fail on a correct stylesheet.
    expect(contrastRatio(token('--iw-verified', 'night'), NIGHT_PANEL)).toBeGreaterThanOrEqual(BODY)
    expect(contrastRatio('#15803d', WHITE)).toBeGreaterThanOrEqual(BODY)
  })
  it('--iw-subtle-bg / --iw-chip-bg carry the chrome text at night and stone-500 by day', () => {
    // The extension strip and the <kbd> chip. Tailwind's bg-stone-50/100 are deliberately NOT
    // remapped by the night block (bg-stone-100 is also a 1px divider — a blanket remap paints
    // those out), so these two surfaces are tokens instead.
    for (const t of ['--iw-subtle-bg', '--iw-chip-bg']) {
      expect(contrastRatio(NIGHT_TEXT, token(t, 'night')), `${t} at night`).toBeGreaterThanOrEqual(BODY)
      expect(contrastRatio('#78716c', token(t, 'day')), `${t} by day`).toBeGreaterThanOrEqual(UI)
    }
  })
})

describe('PAPER tokens — the reading surfaces, which DIM at night and never invert', () => {
  // The article, the PDF reader view, and the markup bar under them. A mark's colour is stored in
  // the mark and shared between both readers, so these surfaces stay light in both themes; night
  // only takes the glare off. That is a DECISION, so it is asserted rather than assumed.
  it('the paper stays light in both themes', () => {
    for (const theme of ['day', 'night'] as const) {
      expect(luminance(token('--iw-reader-paper', theme)), `paper is light in ${theme}`).toBeGreaterThan(0.5)
      expect(luminance(token('--iw-reader-bar', theme)), `the markup bar is light in ${theme}`).toBeGreaterThan(0.5)
      expect(luminance(token('--iw-reader-ctl', theme)), `a control face is light in ${theme}`).toBeGreaterThan(0.5)
    }
  })
  it('the night paper is DIMMER than the day paper (it takes the glare off, it does not invert)', () => {
    expect(luminance(token('--iw-reader-paper', 'night')))
      .toBeLessThan(luminance(token('--iw-reader-paper', 'day')))
    expect(luminance(token('--iw-reader-bar', 'night')))
      .toBeLessThan(luminance(token('--iw-reader-bar', 'day')))
  })
  it('--iw-reader-ink reads on --iw-reader-paper in both themes', () => {
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio(token('--iw-reader-ink', theme), token('--iw-reader-paper', theme)), theme)
        .toBeGreaterThanOrEqual(BODY)
    }
  })
  it('--iw-reader-muted reads on the bar and on a control face in both themes', () => {
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio(token('--iw-reader-muted', theme), token('--iw-reader-bar', theme)), `bar/${theme}`)
        .toBeGreaterThanOrEqual(BODY)
      expect(contrastRatio(token('--iw-reader-muted', theme), token('--iw-reader-ctl', theme)), `ctl/${theme}`)
        .toBeGreaterThanOrEqual(BODY)
    }
  })
  it('THE LITERAL INK still reads on the bar — the coupling that makes the light bar legal', () => {
    // SourceBrowser keeps the LITERAL #5c2d8a on its markup bar precisely because the bar does not
    // invert. If someone later darkens --iw-reader-bar/-ctl toward the chrome grey, that literal
    // becomes the 1.13:1 bug again — in a file whose comments say it is safe. This is the assertion
    // that fires first.
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio('#5c2d8a', token('--iw-reader-bar', theme)), `bar/${theme}`).toBeGreaterThanOrEqual(BODY)
      expect(contrastRatio('#5c2d8a', token('--iw-reader-ctl', theme)), `ctl/${theme}`).toBeGreaterThanOrEqual(BODY)
    }
  })
  it('the reader’s highlight-tool glyph reads on its own control face in both themes', () => {
    // #8a6a04 replaced #c99a06, which measured 2.59:1 on white against the 3:1 a control needs.
    for (const theme of ['day', 'night'] as const) {
      expect(contrastRatio('#8a6a04', token('--iw-reader-ctl', theme)), theme).toBeGreaterThanOrEqual(UI)
    }
  })
})
