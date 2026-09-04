import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WAVE_INTRO_MS,
  WAVE_SCENE,
  WAVE_SCENE_WIDTH,
  WAVE_SCROLL_PERIOD_PX,
  type WaveIntroMark,
  type WaveScrollMark,
} from './waveSceneData'
import { scrollMarkOpacity } from './waveTwinkle'

const all = [...WAVE_SCENE.intro, ...WAVE_SCENE.scroll]

function ringDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, WAVE_SCENE_WIDTH - d)
}

function tangentAngle(x: number): number {
  const phase = ((x % 140) + 140) % 140
  const second = phase >= 70
  const t = (second ? phase - 70 : phase) / 70
  const slope = second ? (36 - 72 * t) / 70 : (-36 + 72 * t) / 70
  return Number((Math.atan(slope) * 180 / Math.PI).toFixed(2))
}

describe('the checked-in water scene', () => {
  it('is a complete fixed structure with no runtime random or server-fed coordinates', () => {
    expect(WAVE_SCENE.intro).toHaveLength(120)
    expect(WAVE_SCENE.scroll).toHaveLength(72)
    expect(new Set(all.map((mark) => mark.id)).size).toBe(all.length)
    const source = readFileSync(resolve(__dirname, 'waveTwinkle.ts'), 'utf8')
    expect(source).not.toContain('Math.random')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('WebSocket')
    expect(source).toContain("from './waveSceneData'")
  })

  it('keeps every generated object at least 180px from its band neighbours', () => {
    for (let row = 0; row < 12; row++) {
      for (const group of ['a', 'b'] as const) {
        const band = all.filter((mark) => mark.row === row && mark.group === group)
        for (let i = 0; i < band.length; i++) {
          for (let j = i + 1; j < band.length; j++)
            expect(ringDistance(band[i].x, band[j].x), `${group}/${row}: ${band[i].id} vs ${band[j].id}`).toBeGreaterThanOrEqual(180)
        }
      }
    }
  })

  it('stores every dash at the exact tangent angle of its wave', () => {
    const dashes: Array<WaveIntroMark | WaveScrollMark> = all
      .filter((mark) => !('kind' in mark) || mark.kind === 'dash')
    for (const mark of dashes) expect(mark.angle, mark.id).toBe(tangentAngle(mark.x))
  })

  it('gives every intro object exactly one finite appearance window', () => {
    for (const mark of WAVE_SCENE.intro) {
      expect(mark.startMs, mark.id).toBeGreaterThanOrEqual(0)
      expect(mark.endMs, mark.id).toBeGreaterThan(mark.startMs)
      expect(mark.endMs, mark.id).toBeLessThanOrEqual(WAVE_INTRO_MS)
    }
  })
})

describe('the absolute scroll loop', () => {
  const mark = WAVE_SCENE.scroll[0]

  it('repeats at one fixed 2240px period in either direction', () => {
    expect(WAVE_SCROLL_PERIOD_PX).toBe(2240)
    for (const top of [-4567, -20, 0, 137, 2240, 8912]) {
      expect(scrollMarkOpacity(mark, top + WAVE_SCROLL_PERIOD_PX)).toBeCloseTo(scrollMarkOpacity(mark, top), 10)
    }
  })

  it('depends on absolute scrollTop only—not time, velocity, viewport or zoom', () => {
    expect(scrollMarkOpacity(mark, mark.phasePx)).toBe(mark.opacity)
    expect(scrollMarkOpacity(mark, mark.phasePx + WAVE_SCROLL_PERIOD_PX / 2)).toBe(0)
    expect(scrollMarkOpacity(mark, mark.phasePx)).toBe(scrollMarkOpacity(mark, mark.phasePx))
  })
})
