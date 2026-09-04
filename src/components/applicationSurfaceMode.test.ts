// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { readApplicationSurfaceMode, writeApplicationSurfaceMode } from './applicationSurfaceMode'

beforeEach(() => localStorage.clear())

describe('application surface mode', () => {
  it('defaults each document scope to the isolated application surface', () => {
    expect(readApplicationSurfaceMode('email', 'email-1')).toBe('isolated')
  })

  it('persists presentation locally per application and document', () => {
    writeApplicationSurfaceMode('email', 'email-1', 'contextual')
    expect(readApplicationSurfaceMode('email', 'email-1')).toBe('contextual')
    expect(readApplicationSurfaceMode('email', 'email-2')).toBe('isolated')
    expect(readApplicationSurfaceMode('music', 'email-1')).toBe('isolated')
  })

  it('refuses an unknown stored value instead of inventing a third presentation', () => {
    localStorage.setItem('inkwave:applicationSurface:email:mode:email-1', 'legacy')
    expect(readApplicationSurfaceMode('email', 'email-1')).toBe('isolated')
  })
})
