// readerInk — the DISPLAY cast for a stored text ink. ~5ms, no browser.
//
// The properties that matter are the ones that keep it from becoming a remap of mark colours: it
// must never touch a FILL, it must never lose an unknown colour, and its output must always carry
// the stored value as the fallback so an engine that cannot resolve the token still paints today's
// colour rather than nothing.
import { describe, expect, it } from 'vitest'
import { readerInk, CASTABLE_INKS } from './markInk'

// The mark FILL palette — MARK_COLORS / NOTE_COLORS / BOX_COLORS in SourceBrowser, and the same
// four the PDF viewer writes. Kept here as literals deliberately: importing them would let a change
// to that palette silently change what this file asserts.
const MARK_FILLS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']

describe('readerInk casts a stroke and never a fill', () => {
  it('leaves EVERY mark fill exactly as stored — this is the shared-palette invariant', () => {
    // "One highlight is one colour on every device" is a claim about these four. If this ever fails,
    // a theme has started reinterpreting a stored mark colour, which is the thing the reading
    // surface was allowed to invert precisely because it does not happen.
    for (const hex of MARK_FILLS) expect(readerInk(hex), hex).toBe(hex)
  })

  it('casts each stored TEXT ink to a token, keeping the stored value as the fallback', () => {
    expect(readerInk('#991b1b')).toBe('var(--iw-reader-ink-red, #991b1b)')
    expect(readerInk('#1e3a8a')).toBe('var(--iw-reader-ink-blue, #1e3a8a)')
    expect(readerInk('#166534')).toBe('var(--iw-reader-ink-green, #166534)')
    expect(readerInk('#302438')).toBe('var(--iw-reader-accent, #302438)')
  })

  it('passes an unknown colour through untouched', () => {
    // A colour from a future palette must render at its stored value rather than be silently
    // re-cast by a rule that never heard of it.
    for (const odd of ['#123456', 'rebeccapurple', 'rgb(1,2,3)', '']) {
      expect(readerInk(odd), odd).toBe(odd)
    }
  })

  it('is case- and whitespace-insensitive on the way in, because stored data is not tidy', () => {
    expect(readerInk('#991B1B')).toBe('var(--iw-reader-ink-red, #991B1B)')
    expect(readerInk('  #991b1b ')).toBe('var(--iw-reader-ink-red,   #991b1b )')
  })

  it('is IDEMPOTENT-SAFE: a cast value is not itself castable', () => {
    // Guards the shape of a real bug — a render path that cast twice would emit
    // `var(--token, var(--token, #hex))`. It does not, because the output is not a key.
    const once = readerInk('#991b1b')
    expect(readerInk(once)).toBe(once)
  })

  it('every castable ink is a colour a component can actually produce', () => {
    // A table entry for a colour nothing stores is dead weight that reads like coverage. Three are
    // SourceBrowser's TEXT_COLORS, one is the app ink they include, one is the highlighter glyph.
    expect(new Set(CASTABLE_INKS)).toEqual(
      new Set(['#991b1b', '#1e3a8a', '#166534', '#302438', '#8a6a04']))
  })
})
