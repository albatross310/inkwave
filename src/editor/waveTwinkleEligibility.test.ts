// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isRestWaterSurface } from './waveTwinkle'

describe('resting water belongs to live desktop editors', () => {
  it.each([true, false])('includes the live editor with loading coverage=%s', (covered) => {
    const surface = document.createElement('div')
    surface.className = `iw-fill${covered ? ' iw-wave-covered' : ''}`
    surface.setAttribute('data-iw-live-editor', '')
    expect(isRestWaterSurface(surface)).toBe(true)
  })

  it('excludes the temporary loading shell, phone surface and missing host', () => {
    const surface = document.createElement('div')
    surface.className = 'iw-fill iw-wave-covered'
    expect(isRestWaterSurface(surface)).toBe(false)
    surface.setAttribute('data-iw-live-editor', '')
    surface.classList.add('is-phone')
    expect(isRestWaterSurface(surface)).toBe(false)
    expect(isRestWaterSurface(null)).toBe(false)
  })
})
