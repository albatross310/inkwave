import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WAVE_INTRO_MS,
  WAVE_SCENE,
  WAVE_SCENE_WIDTH,
  WAVE_SCROLL_PERIOD_PX,
  WAVE_TILE_PX,
  type WaveIntroMark,
  type WaveScrollMark,
} from './waveSceneData'
import { handoffOpacity, scrollMarkOpacity, WAVE_MARK_PLAYBACK_RATE, WAVE_MARK_TIMELINE_MS, WAVE_SCENE_LEFT_PX } from './waveTwinkle'

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

function waveY(group: 'a' | 'b', row: number, x: number): number {
  const phase = ((x % 140) + 140) % 140
  const second = phase >= 70
  const t = (second ? phase - 70 : phase) / 70
  const local = second ? 22 + 36 * t - 36 * t * t : 22 - 36 * t + 36 * t * t
  return Number((row * 140 + local + (group === 'b' ? 70 : 0)).toFixed(2))
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
    for (const mark of dashes) {
      expect(mark.angle, mark.id).toBe(tangentAngle(mark.x))
      // The viewport wave pattern is phase-zero; a whole-tile field origin must keep the same
      // tangent at the mark's painted screen coordinate.
      expect(mark.angle, `${mark.id} screen phase`).toBe(tangentAngle(WAVE_SCENE_LEFT_PX + mark.x))
    }
    const source = readFileSync(resolve(__dirname, 'waveTwinkle.ts'), 'utf8')
    expect(source).toContain('translate(-50%, -50%) rotate')
  })

  it('anchors the scene field on a whole-tile phase at every viewport width', () => {
    expect(WAVE_TILE_PX).toBe(140)
    expect(Math.abs(WAVE_SCENE_LEFT_PX % WAVE_TILE_PX)).toBe(0)
    const source = readFileSync(resolve(__dirname, 'waveTwinkle.ts'), 'utf8')
    expect(source).not.toContain("field.style.left = '50%'")
  })

  it('places every dash a deterministic varied distance below its thick wave', () => {
    const dashes: Array<WaveIntroMark | WaveScrollMark> = all
      .filter((mark) => !('kind' in mark) || mark.kind === 'dash')
    const offsets = new Set<number>()
    for (const mark of dashes) {
      expect(mark.offsetY, mark.id).toBeGreaterThanOrEqual(10)
      expect(mark.offsetY, mark.id).toBeLessThanOrEqual(20)
      expect(mark.y, mark.id).toBeCloseTo(waveY(mark.group, mark.row, mark.x) + mark.offsetY, 2)
      offsets.add(mark.offsetY)
    }
    expect(offsets.size).toBeGreaterThan(20)
  })

  it('gives every intro object exactly one finite appearance window', () => {
    for (const mark of WAVE_SCENE.intro) {
      expect(mark.startMs, mark.id).toBeGreaterThanOrEqual(0)
      expect(mark.endMs, mark.id).toBeGreaterThan(mark.startMs)
      expect(mark.endMs, mark.id).toBeLessThanOrEqual(WAVE_INTRO_MS)
    }
  })

  it('plays the fixed intro flashes at double speed without changing the spatial wave clock', () => {
    expect(WAVE_MARK_PLAYBACK_RATE).toBe(2)
    expect(WAVE_MARK_TIMELINE_MS).toBe(WAVE_INTRO_MS / 2)
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

describe('the compositor-to-rest handoff', () => {
  it('installs the resting opacity before cancelling the animation', () => {
    const order: string[] = []
    const target = {
      style: {
        get opacity() { return '' },
        set opacity(value: string) { order.push(`opacity:${value}`) },
      },
    }
    const animation = { cancel: () => order.push('cancel') }

    handoffOpacity(target, animation, 0.47)

    expect(order).toEqual(['opacity:0.47', 'cancel'])
  })
})
