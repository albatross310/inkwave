import { describe, it, expect } from 'vitest'
import { parseCapsMapping } from './capsLayer'

describe('parseCapsMapping', () => {
  it('parses a simple command to a lowercase key', () => {
    expect(parseCapsMapping('\\logm2d')).toEqual({ latex: '\\log', key: 'd', shift: false })
  })

  it('parses a command to an uppercase (shifted) key', () => {
    expect(parseCapsMapping('\\logm2D')).toEqual({ latex: '\\log', key: 'd', shift: true })
  })

  it('handles multi-char commands', () => {
    expect(parseCapsMapping('\\fracm2f')).toEqual({ latex: '\\frac', key: 'f', shift: false })
  })

  it('non-greedy match stops at the first m2 separator found', () => {
    // regex: (\\[a-zA-Z]+?)m2([a-zA-Z]). For \\limmm2d the shortest cmd+m2 split is
    // \\limm + m2 + d  (\\lim + mm2d fails because mm2d doesn't start with literal "m2")
    expect(parseCapsMapping('\\limmm2d')).toEqual({ latex: '\\limm', key: 'd', shift: false })
  })

  it('returns null for input without a backslash command', () => {
    expect(parseCapsMapping('logm2d')).toBeNull()
  })

  it('returns null for input missing the m2 separator', () => {
    expect(parseCapsMapping('\\logd')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseCapsMapping('')).toBeNull()
  })

  it('returns null when the key slot is a non-letter', () => {
    expect(parseCapsMapping('\\logm21')).toBeNull()
    expect(parseCapsMapping('\\logm2 ')).toBeNull()
  })

  it('trims leading/trailing whitespace before parsing', () => {
    expect(parseCapsMapping('  \\logm2d  ')).toEqual({ latex: '\\log', key: 'd', shift: false })
  })
})
