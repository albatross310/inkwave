import { describe, it, expect } from 'vitest'
import { handleMathKey, applyShorthands, applyShorthandsLive, GREEK_LOWER, GREEK_UPPER } from './mathUtils'

type KBEvent = { code: string; key: string; shiftKey: boolean }
const key = (code: string, shiftKey = false): KBEvent => ({ code, key: '', shiftKey })

describe('handleMathKey', () => {
  it('returns null when greekMode is off', () => {
    expect(handleMathKey(key('KeyA'), false)).toBeNull()
  })

  it('returns null for non-letter keys in greek mode', () => {
    expect(handleMathKey(key('Digit1'), true)).toBeNull()
    expect(handleMathKey(key('Enter'), true)).toBeNull()
  })

  it('returns the lower-case greek letter for an unshifted key', () => {
    expect(handleMathKey(key('KeyP'), true)).toBe('π')
    expect(handleMathKey(key('KeyA'), true)).toBe('α')
    expect(handleMathKey(key('KeyO'), true)).toBe('ο')
  })

  it('returns the upper-case greek letter for a shifted key', () => {
    expect(handleMathKey(key('KeyP', true), true)).toBe('Π')
    expect(handleMathKey(key('KeyG', true), true)).toBe('Γ')
  })

  it('returns null for shifted keys with no upper-case greek mapping', () => {
    // 'a' has a lowercase (α) but no uppercase greek in GREEK_UPPER
    expect(handleMathKey(key('KeyA', true), true)).toBeNull()
  })

  it('covers every lower-case letter in GREEK_LOWER', () => {
    for (const [letter, expected] of Object.entries(GREEK_LOWER)) {
      const code = `Key${letter.toUpperCase()}`
      expect(handleMathKey(key(code), true)).toBe(expected)
    }
  })

  it('covers every upper-case letter in GREEK_UPPER', () => {
    for (const [letter, expected] of Object.entries(GREEK_UPPER)) {
      const code = `Key${letter.toUpperCase()}`
      expect(handleMathKey(key(code, true), true)).toBe(expected)
    }
  })
})

describe('applyShorthands', () => {
  it('converts a // fraction shorthand to \\frac', () => {
    expect(applyShorthands('a // b')).toBe('\\frac{a}{b}')
  })

  it('strips outer parentheses from numerator and denominator', () => {
    expect(applyShorthands('(x+1) // (y-2)')).toBe('\\frac{x+1}{y-2}')
  })

  it('leaves double-parens intact (regex only strips the outermost pair)', () => {
    // applyShorthands strips exactly one paren layer: ((x+1)) → (x+1), not x+1
    expect(applyShorthands('((x+1)) // ((y-2))')).toBe('\\frac{(x+1)}{(y-2)}')
  })

  it('converts multiple fractions in one string', () => {
    const result = applyShorthands('a//b + c//d')
    expect(result).toBe('\\frac{a}{b} + \\frac{c}{d}')
  })

  it('leaves strings without // unchanged', () => {
    expect(applyShorthands('x + y')).toBe('x + y')
  })
})

describe('applyShorthandsLive', () => {
  it('converts a complete // fraction', () => {
    expect(applyShorthandsLive('a // b')).toBe('\\frac{a}{b}')
  })

  it('uses \\, as placeholder denominator for an incomplete fraction (typing in progress)', () => {
    expect(applyShorthandsLive('a //')).toBe('\\frac{a}{\\,}')
  })

  it('strips outer parentheses in live mode', () => {
    expect(applyShorthandsLive('(x) // (y)')).toBe('\\frac{x}{y}')
  })
})
