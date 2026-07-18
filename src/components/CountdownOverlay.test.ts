// THE CORNER COUNTDOWN'S NIGHT COLOUR — as a guard (2026-07-17).
//
// The overlay is PORTALLED to <body>, outside any `.iw-nightable` surface. A prior lane measured that
// its text token (`--iw-pill-fg`) is defined ONLY inside `:root[data-theme="night"] .iw-nightable`, so
// on the night page the portalled element found no such ancestor and fell back to the DAY grey — legible,
// wrong, and left in place. The fix is a dedicated CHROME token defined at `:root` in BOTH themes,
// UNSCOPED, so the portal resolves it: day `--iw-countdown-fg` and a night `:root[data-theme="night"]`
// override that is NOT under `.iw-nightable`.
//
// This test READS THE REAL index.css (jsdom does not resolve custom properties from a stylesheet, so a
// mounted `getComputedStyle` test would report the day value in both themes and pass while proving
// nothing — the same reason music/theme.test.ts reads the file). It pins three things the fix needs and
// proves each matcher can fail on the pre-fix shape.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')
const overlay = readFileSync(resolve(__dirname, 'CountdownOverlay.tsx'), 'utf8')

/** The day value: a bare `:root { --iw-countdown-fg: … }`, NOT under any class. */
const dayDef = (): string | null => {
  const m = /:root\s*\{\s*--iw-countdown-fg:\s*([^;]+);/.exec(css)
  return m ? m[1].trim() : null
}

/** The night value: `:root[data-theme="night"] { --iw-countdown-fg: … }` — the `{` right after the
 *  attribute selector is what proves it is UNSCOPED (a `.iw-nightable` between them would not match),
 *  which is the entire point: the portalled overlay has no nightable ancestor to inherit from. */
const nightDef = (): string | null => {
  const m = /:root\[data-theme="night"\]\s*\{\s*--iw-countdown-fg:\s*([^;]+);/.exec(css)
  return m ? m[1].trim() : null
}

describe('the corner countdown resolves a faint grey in BOTH themes', () => {
  it('defines --iw-countdown-fg at :root for day', () => {
    expect(dayDef(), 'no day :root definition of --iw-countdown-fg in index.css').toBeTruthy()
  })

  it('overrides it UNSCOPED under [data-theme="night"] — reachable from a body portal', () => {
    expect(nightDef(), 'no unscoped night override of --iw-countdown-fg').toBeTruthy()
  })

  it('gives night a DIFFERENT value from day (or the override is a no-op)', () => {
    expect(dayDef()).not.toBe(nightDef())
  })

  it('the overlay uses the chrome token for its text, not the nightable-scoped --iw-pill-fg', () => {
    // The bug, exactly: `color: 'var(--iw-pill-fg, …)'` on an element portalled outside .iw-nightable.
    expect(overlay).toContain("var(--iw-countdown-fg")
    expect(overlay, 'CountdownOverlay still colours its text with the nightable-scoped --iw-pill-fg')
      .not.toMatch(/color:\s*['"]var\(--iw-pill-fg/)
  })

  it('PROVES the matchers can fail (the pre-fix shape would not pass)', () => {
    // The regressed forms this guard exists to catch.
    const scopedOnly = ':root[data-theme="night"] .iw-nightable { --iw-countdown-fg: #dfe3e9; }'
    expect(/:root\[data-theme="night"\]\s*\{\s*--iw-countdown-fg:/.test(scopedOnly)).toBe(false)
    const buggyColor = "color: 'var(--iw-pill-fg, #a8a29e)',"
    expect(/color:\s*['"]var\(--iw-pill-fg/.test(buggyColor)).toBe(true)
  })
})
