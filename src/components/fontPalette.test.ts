import { describe, expect, it } from 'vitest'
import { FONTS } from './StyleBar'
import { CERTIFIED_FAMILIES, primaryFamily } from '../editor/arithmeticLayout'

describe('writing font palette', () => {
  it('keeps the requested familiar starting set under Recommended', () => {
    expect(FONTS.filter((font) => font.group === 'Recommended').map((font) => font.label)).toEqual([
      'Inter', 'Open', 'Noto', 'Romans', 'Garamond',
    ])
  })

  it('moves Fell to Display and retires Zilla from new selection', () => {
    expect(FONTS.find((font) => font.label === 'Fell')?.group).toBe('Display')
    expect(FONTS.some((font) => font.label === 'Zilla')).toBe(false)
  })

  it('offers only cross-engine arithmetic-certified primary families', () => {
    const missing = FONTS.map((font) => primaryFamily(font.css))
      .filter((family) => !CERTIFIED_FAMILIES.has(family))
    expect(missing).toEqual([])
    expect(new Set(FONTS.map((font) => font.css)).size).toBe(FONTS.length)
  })
})

