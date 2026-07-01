import { describe, it, expect } from 'vitest'
import { applyCustomSymbols, parseDefinition, PRESETS } from './mathSymbols'

describe('applyCustomSymbols', () => {
  const syms = [{ key: 'inf', latex: '\\infty' }, { key: 'pi', latex: '\\pi' }]

  it('replaces a standalone symbol key', () => {
    expect(applyCustomSymbols('inf + pi', syms)).toBe('\\infty + \\pi')
  })

  it('does not replace a key that is part of a word', () => {
    // 'infinite' contains 'inf' but should not be replaced
    expect(applyCustomSymbols('infinite', syms)).toBe('infinite')
  })

  it('does not replace a key immediately after a backslash (inside a LaTeX command)', () => {
    expect(applyCustomSymbols('\\infcommand', syms)).toBe('\\infcommand')
  })

  it('replaces the key when preceded by a space', () => {
    expect(applyCustomSymbols('x + inf', syms)).toBe('x + \\infty')
  })

  it('replaces the key at the start of the string', () => {
    expect(applyCustomSymbols('inf x', syms)).toBe('\\infty x')
  })

  it('replaces the key at the end of the string', () => {
    expect(applyCustomSymbols('x inf', syms)).toBe('x \\infty')
  })

  it('applies multiple symbols in one string', () => {
    expect(applyCustomSymbols('inf + pi', syms)).toBe('\\infty + \\pi')
  })

  it('leaves strings with no matching keys unchanged', () => {
    expect(applyCustomSymbols('x^2 + y', syms)).toBe('x^2 + y')
  })

  it('returns the input unchanged when symbol list is empty', () => {
    expect(applyCustomSymbols('inf', [])).toBe('inf')
  })

  it('does not replace a key followed immediately by a letter', () => {
    // 'pita' should not match symbol 'pi'
    expect(applyCustomSymbols('pita', syms)).toBe('pita')
  })
})

describe('parseDefinition', () => {
  it('parses a valid definition line', () => {
    expect(parseDefinition('"mypi = \\pi')).toEqual({ key: 'mypi', latex: '\\pi' })
  })

  it('trims whitespace from the latex value', () => {
    expect(parseDefinition('"key =   \\frac{1}{2}  ')).toMatchObject({ latex: '\\frac{1}{2}' })
  })

  it('returns null for a line not starting with a quote', () => {
    expect(parseDefinition('key = \\pi')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseDefinition('')).toBeNull()
  })

  it('returns null when there is no = separator', () => {
    expect(parseDefinition('"noequals')).toBeNull()
  })
})

describe('PRESETS', () => {
  it('contains at least one entry', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
  })

  it('every preset has a non-empty key and latex', () => {
    for (const { key, latex } of PRESETS) {
      expect(key.length).toBeGreaterThan(0)
      expect(latex.length).toBeGreaterThan(0)
    }
  })
})
