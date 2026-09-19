// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOW_POWER_MAX_VISIBLE_HEIGHT_PX,
  LOW_POWER_MAX_VISIBLE_WIDTH_PX,
  LOW_POWER_WAVE_LEFT_PX,
  LOW_POWER_WAVE_SLACK_PX,
  LOW_POWER_WAVE_TILE_PX,
  createLowPowerWaterCanvas,
  drawLowPowerWaveLayer,
  lowPowerWaterBackingPlan,
  lowPowerWavePose,
} from './lowPowerWaterCanvas'

function contextRecorder() {
  const calls: Array<[string, ...number[]]> = []
  const ctx = {
    beginPath: vi.fn(() => calls.push(['beginPath'])),
    clearRect: vi.fn((...args: number[]) => calls.push(['clearRect', ...args])),
    lineCap: 'butt' as CanvasLineCap,
    lineWidth: 1,
    moveTo: vi.fn((...args: number[]) => calls.push(['moveTo', ...args])),
    quadraticCurveTo: vi.fn((...args: number[]) => calls.push(['quadraticCurveTo', ...args])),
    setTransform: vi.fn((...args: number[]) => calls.push(['setTransform', ...args])),
    stroke: vi.fn(() => calls.push(['stroke'])),
    strokeStyle: '',
    globalAlpha: 1,
  }
  return { ctx, calls }
}

describe('low-power water backing plan', () => {
  it('keeps DPR1 visible resolution and adds four exact tiles of horizontal slack', () => {
    const plan = lowPowerWaterBackingPlan(1280, 720)
    expect(plan).toEqual({
      viewportWidth: 1280,
      viewportHeight: 720,
      logicalWidth: 1280 + LOW_POWER_WAVE_SLACK_PX,
      logicalHeight: 720,
      backingWidth: 1280 + LOW_POWER_WAVE_SLACK_PX,
      backingHeight: 720,
      resolutionScale: 1,
    })
    expect(LOW_POWER_WAVE_SLACK_PX).toBe(4 * LOW_POWER_WAVE_TILE_PX)
    expect(Math.abs(LOW_POWER_WAVE_LEFT_PX % LOW_POWER_WAVE_TILE_PX)).toBe(0)
  })

  it('caps the visible backing resolution independently of devicePixelRatio', () => {
    const plan = lowPowerWaterBackingPlan(2560, 1440)
    expect(plan.resolutionScale).toBe(0.5)
    expect(plan.viewportWidth * plan.resolutionScale).toBe(LOW_POWER_MAX_VISIBLE_WIDTH_PX)
    expect(plan.viewportHeight * plan.resolutionScale).toBe(LOW_POWER_MAX_VISIBLE_HEIGHT_PX)
    expect(plan.backingWidth).toBe((2560 + LOW_POWER_WAVE_SLACK_PX) / 2)
    expect(plan.backingHeight).toBe(720)
  })
})

describe('low-power wave geometry', () => {
  it('normalises opposite poses to the identical 140px tile phase', () => {
    for (const x of [-987.25, -140, -70, 0, 70, 140, 987.25]) {
      const pose = lowPowerWavePose(x)
      expect((pose.a - x) / LOW_POWER_WAVE_TILE_PX).toBeCloseTo(
        Math.round((pose.a - x) / LOW_POWER_WAVE_TILE_PX),
        8,
      )
      expect((pose.b + x) / LOW_POWER_WAVE_TILE_PX).toBeCloseTo(
        Math.round((pose.b + x) / LOW_POWER_WAVE_TILE_PX),
        8,
      )
      expect(Math.abs(pose.a)).toBeLessThanOrEqual(LOW_POWER_WAVE_TILE_PX / 2)
      expect(Math.abs(pose.b)).toBeLessThanOrEqual(LOW_POWER_WAVE_TILE_PX / 2)
    }
  })

  it('draws the exact SVG quadratic controls for both wave groups', () => {
    const plan = lowPowerWaterBackingPlan(140, 140)
    const a = contextRecorder()
    drawLowPowerWaveLayer(a.ctx as unknown as Parameters<typeof drawLowPowerWaveLayer>[0], 'a', plan, 'day')
    expect(a.ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 22)
    expect(a.ctx.quadraticCurveTo).toHaveBeenNthCalledWith(1, 35, 4, 70, 22)
    expect(a.ctx.quadraticCurveTo).toHaveBeenNthCalledWith(2, 105, 40, 140, 22)
    expect(a.ctx.moveTo).toHaveBeenNthCalledWith(2, 0, 50)
    expect(a.ctx.quadraticCurveTo.mock.calls).toContainEqual([35, 32, 70, 50])
    expect(a.ctx.quadraticCurveTo.mock.calls).toContainEqual([105, 68, 140, 50])

    const b = contextRecorder()
    drawLowPowerWaveLayer(b.ctx as unknown as Parameters<typeof drawLowPowerWaveLayer>[0], 'b', plan, 'night')
    expect(b.ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 92)
    expect(b.ctx.moveTo).toHaveBeenNthCalledWith(2, 0, 120)
    expect(b.ctx.strokeStyle).toBe('#9aa3af')
    expect(b.ctx.stroke).toHaveBeenCalledTimes(2)
    expect(b.ctx.globalAlpha).toBe(1)
  })
})

describe('low-power canvas lifecycle', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const contexts: ReturnType<typeof contextRecorder>[] = []

  beforeEach(() => {
    contexts.length = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const record = contextRecorder()
      contexts.push(record)
      return record.ctx as unknown as CanvasRenderingContext2D
    })
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
    vi.restoreAllMocks()
  })

  it('redraws only for a real resize/theme change; pose updates are transform-only', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const water = createLowPowerWaterCanvas(host, { width: 1280, height: 720, theme: 'day' })
    expect(water.canvases.a.width).toBe(1280 + LOW_POWER_WAVE_SLACK_PX)
    expect(water.canvases.a.style.left).toBe(`${LOW_POWER_WAVE_LEFT_PX}px`)
    expect(contexts).toHaveLength(2)

    const strokes = () => contexts.reduce((sum, record) => sum + record.ctx.stroke.mock.calls.length, 0)
    expect(strokes()).toBe(4)
    expect(water.update({ width: 1280, height: 720, theme: 'day' })).toBe(false)
    expect(water.setPose(23.5)).toBe(true)
    expect(water.canvases.a.style.transform).toBe('translateX(23.500px)')
    expect(water.canvases.b.style.transform).toBe('translateX(-23.500px)')
    expect(water.setPose(23.5 + LOW_POWER_WAVE_TILE_PX)).toBe(false)
    expect(strokes()).toBe(4)

    expect(water.update({ width: 1440, height: 900, theme: 'day' })).toBe(true)
    expect(contexts).toHaveLength(4)
    expect(water.update({ width: 1440, height: 900, theme: 'night' })).toBe(true)
    expect(contexts).toHaveLength(6)
  })

  it('removes its observers and DOM on destroy', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const water = createLowPowerWaterCanvas(host, { width: 800, height: 600 })
    expect(host.contains(water.element)).toBe(true)
    water.destroy()
    expect(host.contains(water.element)).toBe(false)
    expect(water.update({ width: 900 })).toBe(false)
    expect(water.setPose(10)).toBe(false)
  })
})
