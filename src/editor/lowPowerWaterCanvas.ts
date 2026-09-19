// Low-power water: two pre-rendered transparent wave layers, moved without repainting.
//
// The current DOM water fields are 2,800×1,680 CSS px. On a Retina display, promoting both can
// reserve roughly 150 MB of RGBA backing before the viewport wave layer is counted. This renderer
// deliberately ignores devicePixelRatio: visible water is capped at a DPR1-equivalent 1,280×720,
// while the extra four tiles of transparent horizontal slack preserve the existing phase/overdraw
// contract. Scrolling changes only the two canvas transforms; pixels are redrawn on resize/theme.

export const LOW_POWER_WAVE_TILE_PX = 140
export const LOW_POWER_WAVE_SLACK_PX = LOW_POWER_WAVE_TILE_PX * 4
export const LOW_POWER_WAVE_LEFT_PX = -LOW_POWER_WAVE_SLACK_PX / 2
export const LOW_POWER_MAX_VISIBLE_WIDTH_PX = 1280
export const LOW_POWER_MAX_VISIBLE_HEIGHT_PX = 720

export type LowPowerWaterTheme = 'day' | 'night'

export type LowPowerWaterViewport = {
  width: number
  height: number
}

export type LowPowerWaterUpdate = Partial<LowPowerWaterViewport> & {
  theme?: LowPowerWaterTheme
}

export type LowPowerWaterBackingPlan = {
  viewportWidth: number
  viewportHeight: number
  logicalWidth: number
  logicalHeight: number
  backingWidth: number
  backingHeight: number
  resolutionScale: number
}

export type LowPowerWavePose = { a: number; b: number }

type WavePalette = {
  stroke: string
  thickOpacity: number
  thinOpacity: number
  thickWidth: number
  thinWidth: number
}

const PALETTES: Record<LowPowerWaterTheme, WavePalette> = {
  day: {
    stroke: '#f3edcf',
    thickOpacity: 0.48,
    thinOpacity: 0.28,
    thickWidth: 2.95,
    thinWidth: 1.4,
  },
  night: {
    stroke: '#9aa3af',
    thickOpacity: 0.42,
    thinOpacity: 0.30,
    thickWidth: 3.1,
    thinWidth: 1.4,
  },
}

function positiveDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1
}

/** DPR1-equivalent backing plan. Horizontal slack is additional to the capped visible area. */
export function lowPowerWaterBackingPlan(
  width: number,
  height: number,
): LowPowerWaterBackingPlan {
  const viewportWidth = positiveDimension(width)
  const viewportHeight = positiveDimension(height)
  const resolutionScale = Math.min(
    1,
    LOW_POWER_MAX_VISIBLE_WIDTH_PX / viewportWidth,
    LOW_POWER_MAX_VISIBLE_HEIGHT_PX / viewportHeight,
  )
  const logicalWidth = viewportWidth + LOW_POWER_WAVE_SLACK_PX
  const logicalHeight = viewportHeight
  return {
    viewportWidth,
    viewportHeight,
    logicalWidth,
    logicalHeight,
    backingWidth: Math.max(1, Math.ceil(logicalWidth * resolutionScale)),
    backingHeight: Math.max(1, Math.ceil(logicalHeight * resolutionScale)),
    resolutionScale,
  }
}

/** Equivalent tile pose, bounded to half a tile so finite canvases never expose an edge. */
export function lowPowerWavePose(waveX: number): LowPowerWavePose {
  const bounded = (value: number): number => {
    if (!Number.isFinite(value)) return 0
    const phase = ((value % LOW_POWER_WAVE_TILE_PX) + LOW_POWER_WAVE_TILE_PX)
      % LOW_POWER_WAVE_TILE_PX
    return phase > LOW_POWER_WAVE_TILE_PX / 2 ? phase - LOW_POWER_WAVE_TILE_PX : phase
  }
  return { a: bounded(waveX), b: bounded(-waveX) }
}

type WaveContext = {
  beginPath: () => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  lineCap: CanvasLineCap
  lineWidth: number
  moveTo: (x: number, y: number) => void
  quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => void
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  stroke: () => void
  strokeStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
}

function appendWavePath(ctx: WaveContext, logicalWidth: number, y: number): void {
  ctx.moveTo(0, y)
  for (let x = 0; x < logicalWidth; x += LOW_POWER_WAVE_TILE_PX) {
    // SVG source: M0 y Q35 y-18 70 y T140 y. The reflected T control is (105,y+18).
    ctx.quadraticCurveTo(x + 35, y - 18, x + 70, y)
    ctx.quadraticCurveTo(x + 105, y + 18, x + 140, y)
  }
}

/** Draw one exact 140px wave group. Exported so geometry stays unit-provable without a browser. */
export function drawLowPowerWaveLayer(
  ctx: WaveContext,
  group: 'a' | 'b',
  plan: LowPowerWaterBackingPlan,
  theme: LowPowerWaterTheme,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, plan.backingWidth, plan.backingHeight)
  ctx.setTransform(
    plan.backingWidth / plan.logicalWidth,
    0,
    0,
    plan.backingHeight / plan.logicalHeight,
    0,
    0,
  )
  const palette = PALETTES[theme]
  const groupOffset = group === 'a' ? 0 : 70
  ctx.strokeStyle = palette.stroke
  ctx.lineCap = 'butt'

  const drawPopulation = (localY: number, width: number, opacity: number) => {
    ctx.beginPath()
    for (let rowTop = 0; rowTop < plan.logicalHeight; rowTop += LOW_POWER_WAVE_TILE_PX)
      appendWavePath(ctx, plan.logicalWidth, rowTop + localY + groupOffset)
    ctx.lineWidth = width
    ctx.globalAlpha = opacity
    ctx.stroke()
  }

  drawPopulation(22, palette.thickWidth, palette.thickOpacity)
  drawPopulation(50, palette.thinWidth, palette.thinOpacity)
  ctx.globalAlpha = 1
}

function themeOf(doc: Document): LowPowerWaterTheme {
  return doc.documentElement.dataset.theme === 'night' ? 'night' : 'day'
}

function canvasLayer(doc: Document, group: 'a' | 'b'): HTMLCanvasElement {
  const canvas = doc.createElement('canvas')
  canvas.className = `iw-low-power-water-canvas iw-low-power-water-canvas-${group}`
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute',
    top: '0px',
    left: `${LOW_POWER_WAVE_LEFT_PX}px`,
    pointerEvents: 'none',
    transformOrigin: '0 0',
    imageRendering: 'auto',
  })
  return canvas
}

export type LowPowerWaterCanvas = {
  element: HTMLDivElement
  canvases: { a: HTMLCanvasElement; b: HTMLCanvasElement }
  /** Idempotent: redraws only when viewport geometry or palette changed. */
  update: (next?: LowPowerWaterUpdate) => boolean
  /** Transform-only hot path. Returns false when the equivalent tile pose is already painted. */
  setPose: (waveX: number) => boolean
  destroy: () => void
}

/**
 * Mount a self-observing low-resolution water renderer. `update()` remains exposed for an owner
 * that already has resize/theme signals; the built-in listeners make the leaf safe standalone.
 */
export function createLowPowerWaterCanvas(
  host: HTMLElement,
  initial: LowPowerWaterUpdate = {},
): LowPowerWaterCanvas {
  const doc = host.ownerDocument
  const win = doc.defaultView
  const element = doc.createElement('div')
  element.className = 'iw-low-power-water-canvas-set'
  element.setAttribute('aria-hidden', 'true')
  Object.assign(element.style, {
    position: 'absolute',
    inset: '0px',
    overflow: 'hidden',
    pointerEvents: 'none',
  })
  const canvases = { a: canvasLayer(doc, 'a'), b: canvasLayer(doc, 'b') }
  element.append(canvases.a, canvases.b)
  host.appendChild(element)

  let viewportWidth = initial.width ?? win?.innerWidth ?? host.clientWidth
  let viewportHeight = initial.height ?? win?.innerHeight ?? host.clientHeight
  let theme = initial.theme ?? themeOf(doc)
  let signature = ''
  let poseSignature = ''
  let destroyed = false

  const update = (next: LowPowerWaterUpdate = {}): boolean => {
    if (destroyed) return false
    viewportWidth = next.width ?? win?.innerWidth ?? viewportWidth
    viewportHeight = next.height ?? win?.innerHeight ?? viewportHeight
    theme = next.theme ?? themeOf(doc)
    const plan = lowPowerWaterBackingPlan(viewportWidth, viewportHeight)
    const nextSignature = [
      plan.logicalWidth,
      plan.logicalHeight,
      plan.backingWidth,
      plan.backingHeight,
      theme,
    ].join('|')
    if (nextSignature === signature) return false
    signature = nextSignature
    for (const group of ['a', 'b'] as const) {
      const canvas = canvases[group]
      canvas.width = plan.backingWidth
      canvas.height = plan.backingHeight
      canvas.style.width = `${plan.logicalWidth}px`
      canvas.style.height = `${plan.logicalHeight}px`
      const ctx = canvas.getContext('2d')
      if (ctx) drawLowPowerWaveLayer(ctx, group, plan, theme)
    }
    return true
  }

  const setPose = (waveX: number): boolean => {
    if (destroyed) return false
    const pose = lowPowerWavePose(waveX)
    const nextSignature = `${pose.a.toFixed(3)}|${pose.b.toFixed(3)}`
    if (nextSignature === poseSignature) return false
    poseSignature = nextSignature
    canvases.a.style.transform = `translateX(${pose.a.toFixed(3)}px)`
    canvases.b.style.transform = `translateX(${pose.b.toFixed(3)}px)`
    return true
  }

  const onResize = () => { update() }
  win?.addEventListener('resize', onResize, { passive: true })
  const themeObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { update() })
    : null
  themeObserver?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  update(initial)
  setPose(0)

  return {
    element,
    canvases,
    update,
    setPose,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      win?.removeEventListener('resize', onResize)
      themeObserver?.disconnect()
      element.remove()
    },
  }
}
