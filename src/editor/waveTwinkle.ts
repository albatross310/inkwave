// Deterministic water marks.
//
// The complete scene is generated OFFLINE by scripts/generate-wave-scene.mjs and committed in
// waveSceneData.ts. The browser receives every coordinate and time window in its bundle, mounts
// the whole field synchronously, and never asks a server—or a runtime RNG—what should happen next.
//
// Spatial ownership is deliberately tiny: one field for each wave direction. Those fields use the
// exact same CSS drift/coast animations as the two wave tiles, so a speck cannot acquire a separate
// clock. Individual objects animate OPACITY ONLY. Intro objects have one finite appearance window
// and finish forever. Scroll objects are a separate overlapping population whose opacity is a pure
// function of absolute scrollTop modulo one deliberately simple fixed distance.

import {
  WAVE_INTRO_MS,
  WAVE_SCENE,
  WAVE_SCENE_HEIGHT,
  WAVE_SCENE_WIDTH,
  WAVE_SCROLL_PERIOD_PX,
  WAVE_TILE_PX,
  type WaveIntroMark,
  type WaveScrollMark,
} from './waveSceneData'

export const SPARK_COLOR = '#f3edcf'
export const SPARK_CORE = '#f3edcf'
export const SPARK_COLOR_NIGHT = '#9aa3af'
export const SPARK_CORE_NIGHT = '#9aa3af'
export const DASH_COLOR = '#f3edcf'
export const DASH_COLOR_NIGHT = '#9aa3af'
// One tuning knob for the independent intro flashes. It scales opacity choreography only; the
// spatial field clocks must continue to match the 1.944s wave drift exactly.
export const WAVE_MARK_PLAYBACK_RATE = 2
export const WAVE_MARK_TIMELINE_MS = WAVE_INTRO_MS / WAVE_MARK_PLAYBACK_RATE
// Exactly two whole tiles left of the viewport origin. A centred field changes its tile phase with
// viewport width, so a mathematically correct stored tangent visibly misses the painted curve.
export const WAVE_SCENE_LEFT_PX = -2 * WAVE_TILE_PX

type Group = 'a' | 'b'
type Mode = 'anim' | 'coast' | 'off'

type IntroNode = { mark: WaveIntroMark; el: HTMLElement; animation?: Animation }
type ScrollNode = { mark: WaveScrollMark; el: HTMLElement; animation?: Animation }
type OpacityTarget = { style: { opacity: string } }
type Cancellable = { cancel: () => void }
type HostState = {
  host: HTMLElement
  set: HTMLElement
  fields: Record<Group, HTMLElement>
  intro: IntroNode[]
  scroll: ScrollNode[]
  mode: Mode
  phone: boolean
  epoch: number | null
  scrollTop: number
}
const hosts = new Map<HTMLElement, HostState>()
let listenersInstalled = false
let sceneEpoch: number | null = null
let announced = false

const timelineNow = (): number =>
  (document.timeline?.currentTime as number | null) ?? performance.now()

function pruneHosts(): void {
  for (const [host, state] of hosts) {
    if (host.isConnected) continue
    cancelIntro(state)
    hosts.delete(host)
  }
}

function makeMark(kind: 'dash' | 'spark', x: number, y: number, angle: number, size: number): HTMLElement {
  const el = document.createElement('i')
  el.className = `iw-scene-mark ${kind === 'dash' ? 'iw-scene-dash' : 'iw-scene-spark'}`
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.style.opacity = '0'
  if (kind === 'dash') {
    el.style.width = `${size}px`
    // Generated x/y/angle describe the dash CENTRE on the curve. Centre the element on that point;
    // treating x as its left edge samples the tangent half a dash-width away and visibly floats it.
    el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`
  } else {
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    el.style.transform = 'translate(-50%, -50%)'
  }
  return el
}

function prepareHost(host: HTMLElement): HostState {
  const old = hosts.get(host)
  if (old) return old

  const set = document.createElement('div')
  set.className = 'iw-twk-set iw-scene-set'
  const fields = { a: document.createElement('div'), b: document.createElement('div') }
  for (const group of ['a', 'b'] as const) {
    const field = fields[group]
    field.className = `iw-twk-field iw-scene-field ${group === 'a' ? 'iw-twk-fa' : 'iw-twk-fb'}`
    field.style.width = `${WAVE_SCENE_WIDTH}px`
    field.style.height = `${WAVE_SCENE_HEIGHT}px`
    field.style.left = `${WAVE_SCENE_LEFT_PX}px`
    field.style.right = 'auto'
    field.style.marginLeft = '0'
    set.appendChild(field)
  }

  const intro = WAVE_SCENE.intro.map((mark) => {
    const el = makeMark(mark.kind, mark.x, mark.y, mark.angle, mark.size)
    el.dataset.sceneId = mark.id
    el.dataset.waveOffset = String(mark.offsetY)
    fields[mark.group].appendChild(el)
    return { mark, el }
  })
  const scroll = WAVE_SCENE.scroll.map((mark) => {
    const el = makeMark('dash', mark.x, mark.y, mark.angle, mark.size)
    el.classList.add('iw-scene-scroll')
    el.dataset.sceneId = mark.id
    el.dataset.waveOffset = String(mark.offsetY)
    fields[mark.group].appendChild(el)
    return { mark, el }
  })

  host.replaceChildren(set)
  // Materialise both CSS field animations while the atomic gate still holds every spatial clock
  // paused at currentTime 0. WebKit otherwise defers child animation creation until after the gate
  // opens and starts the fields a frame (or more) behind the already-existing wave pseudos.
  void fields.a.offsetWidth
  const state: HostState = {
    host, set, fields, intro, scroll, mode: 'anim', phone: false,
    epoch: null, scrollTop: host.parentElement?.scrollTop ?? 0,
  }
  hosts.set(host, state)

  if (!announced) {
    announced = true
    ;(window as unknown as { __iwTwinklesReady?: boolean }).__iwTwinklesReady = true
    window.dispatchEvent(new Event('inkwave:twinkles-ready'))
  }
  return state
}

function introFrames(mark: WaveIntroMark): Keyframe[] {
  const ramp = Math.min(mark.kind === 'spark' ? 45 : 150, (mark.endMs - mark.startMs) / 3)
  const start = mark.startMs / WAVE_INTRO_MS
  const lit = (mark.startMs + ramp) / WAVE_INTRO_MS
  const fall = (mark.endMs - ramp) / WAVE_INTRO_MS
  const end = mark.endMs / WAVE_INTRO_MS
  const frames: Keyframe[] = [{ offset: 0, opacity: mark.startMs === 0 ? mark.opacity : 0 }]
  if (mark.startMs > 0) frames.push({ offset: start, opacity: 0 })
  frames.push(
    { offset: lit, opacity: mark.opacity, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: fall, opacity: mark.opacity, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: end, opacity: 0 },
    { offset: 1, opacity: 0 },
  )
  return frames
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % WAVE_SCROLL_PERIOD_PX
  return Math.min(d, WAVE_SCROLL_PERIOD_PX - d)
}

/** Pure, zoom-independent scroll-loop opacity. */
export function scrollMarkOpacity(mark: WaveScrollMark, absoluteScrollTop: number): number {
  const phase = ((absoluteScrollTop % WAVE_SCROLL_PERIOD_PX) + WAVE_SCROLL_PERIOD_PX) % WAVE_SCROLL_PERIOD_PX
  const d = circularDistance(phase, mark.phasePx)
  const inner = mark.spanPx * 0.32
  const outer = mark.spanPx * 0.5
  if (d <= inner) return mark.opacity
  if (d >= outer) return 0
  const t = (d - inner) / (outer - inner)
  const smooth = t * t * (3 - 2 * t)
  return mark.opacity * (1 - smooth)
}

function overlapFrames(mark: WaveScrollMark, scrollTop: number): Keyframe[] {
  const target = scrollMarkOpacity(mark, scrollTop)
  const start = mark.overlapMs / WAVE_INTRO_MS
  const end = Math.min(0.98, (mark.overlapMs + 240) / WAVE_INTRO_MS)
  return [
    { offset: 0, opacity: 0 },
    { offset: start, opacity: 0 },
    { offset: end, opacity: target },
    { offset: 1, opacity: target },
  ]
}

function stamp(animation: Animation, epoch: number): void {
  const apply = () => {
    try { if (animation.startTime !== epoch) animation.startTime = epoch } catch { /* detached */ }
  }
  apply()
  void animation.ready.then(apply).catch(() => { /* cancelled */ })
}

function alignFieldClocks(state: HostState): void {
  const surface = state.host.parentElement
  if (!surface) return
  // The gate's pre-ready CSS created every spatial animation paused at currentTime 0. Bind each
  // field to its matching pseudo clock now, then repeat once both pending CSS animations resolve:
  // WebKit can otherwise replace the provisional field startTime after the first correct frame.
  void surface.offsetWidth
  let animations: Animation[] = []
  try { animations = surface.getAnimations({ subtree: true }) } catch { return }
  for (const group of ['a', 'b'] as const) {
    const name = group === 'a' ? 'iw-wave-drift-l' : 'iw-wave-drift-r'
    const wave = animations.find((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target
      return (animation as CSSAnimation).animationName === name
        && !(target instanceof Element && target.matches('.iw-twk-field'))
    })
    const field = state.fields[group].getAnimations()
      .find((animation) => (animation as CSSAnimation).animationName === name)
    if (!wave || !field) continue
    const apply = () => {
      if (typeof wave.startTime !== 'number') return
      try { if (field.startTime !== wave.startTime) field.startTime = wave.startTime } catch { /* detached */ }
    }
    apply()
    void Promise.all([wave.ready, field.ready]).then(apply).catch(() => { /* replaced */ })
  }
}

function startIntro(state: HostState, epoch: number): void {
  if (state.epoch === epoch) return
  cancelIntro(state)
  state.epoch = epoch
  for (const item of state.intro) {
    const animation = item.el.animate(introFrames(item.mark), { duration: WAVE_MARK_TIMELINE_MS, fill: 'both' })
    item.animation = animation
    stamp(animation, epoch)
  }
  for (const item of state.scroll) {
    const animation = item.el.animate(overlapFrames(item.mark, state.scrollTop), { duration: WAVE_MARK_TIMELINE_MS, fill: 'both' })
    item.animation = animation
    stamp(animation, epoch)
  }
}

function cancelIntro(state: HostState): void {
  for (const item of [...state.intro, ...state.scroll]) {
    item.animation?.cancel()
    item.animation = undefined
  }
  state.epoch = null
}

/** Install an animation's resting value before removing the compositor track. Chrome and WebKit
 * may present cancellation separately from a later inline write, so cancel-first creates one
 * all-zero frame even when both operations occur in the same main-thread task. */
export function handoffOpacity(
  target: OpacityTarget,
  animation: Cancellable | undefined,
  opacity: number,
): void {
  target.style.opacity = String(opacity)
  animation?.cancel()
}

function settleIntroAtRest(state: HostState, scrollTop: number, showScroll: boolean): void {
  for (const item of state.intro) {
    handoffOpacity(item.el, item.animation, 0)
    item.animation = undefined
  }
  for (const item of state.scroll) {
    handoffOpacity(item.el, item.animation, showScroll ? scrollMarkOpacity(item.mark, scrollTop) : 0)
    item.animation = undefined
  }
  state.epoch = null
}

function setFieldRest(field: HTMLElement, group: Group, waveX: number): void {
  field.style.transform = group === 'a'
    ? `translate3d(${waveX.toFixed(2)}px, 0, 0)`
    : `translate3d(${(-waveX).toFixed(2)}px, 0, 0)`
}

function installListeners(): void {
  if (listenersInstalled) return
  listenersInstalled = true
  window.addEventListener('inkwave:water-ready', () => {
    sceneEpoch = (window as unknown as { __iwWaterGate?: { at?: number } }).__iwWaterGate?.at ?? timelineNow()
    pruneHosts()
    for (const state of hosts.values()) if (state.mode === 'anim') {
      alignFieldClocks(state)
      startIntro(state, sceneEpoch)
    }
  })
  window.addEventListener('inkwave:open-begin', () => {
    sceneEpoch = null
    pruneHosts()
    for (const state of hosts.values()) cancelIntro(state)
  })
}

export function syncTwinkles(
  host: HTMLElement,
  want: { sparks: boolean; dashes: boolean; mode: Mode; phone: boolean },
): void {
  installListeners()
  pruneHosts()
  const state = prepareHost(host)
  const previous = state.mode
  state.mode = want.mode
  state.phone = want.phone
  state.set.style.display = want.sparks || want.dashes ? '' : 'none'

  if (want.mode === 'anim') {
    for (const field of Object.values(state.fields)) field.style.transform = ''
    if (sceneEpoch == null && document.documentElement.classList.contains('iw-water-ready'))
      sceneEpoch = timelineNow()
    if (sceneEpoch != null) {
      alignFieldClocks(state)
      startIntro(state, sceneEpoch)
    }
    return
  }
  if (want.mode === 'coast') return

  const surface = host.parentElement as HTMLElement
  const restTop = surface?.scrollTop ?? state.scrollTop
  state.scrollTop = restTop
  // The resting inline opacity must exist BEFORE the fill-mode WAAPI tracks are cancelled. A
  // cancel-first handoff briefly reveals makeMark's original `opacity: 0` on both browser engines,
  // making the whole field disappear and then return at the very end of the slowdown.
  if (previous !== 'off') settleIntroAtRest(state, restTop, !want.phone && want.dashes)
  else for (const item of state.intro) item.el.style.opacity = '0'
  const waveX = parseFloat(surface?.style.getPropertyValue('--wave-x') || '') || 0
  for (const group of ['a', 'b'] as const) setFieldRest(state.fields[group], group, waveX)
  if (want.phone || !want.dashes) {
    for (const item of state.scroll) item.el.style.opacity = '0'
  } else {
    setScrollScene(surface, surface?.scrollTop ?? state.scrollTop)
  }
}

/** Apply the same literal rest transform that Scroll writes to the wave tiles. */
export function swayFields(surface: HTMLElement, waveX: number): void {
  const host = surface.querySelector('.iw-wave-twinkles') as HTMLElement | null
  const state = host ? hosts.get(host) : undefined
  if (!state || state.mode !== 'off') return
  for (const group of ['a', 'b'] as const) setFieldRest(state.fields[group], group, waveX)
}

/** Scroll animation = a pure spatial loop; the caller invokes this only for genuine scroll. */
export function setScrollScene(surface: HTMLElement, absoluteScrollTop: number): void {
  const host = surface.querySelector('.iw-wave-twinkles') as HTMLElement | null
  const state = host ? hosts.get(host) : undefined
  if (!state) return
  state.scrollTop = absoluteScrollTop
  if (state.mode !== 'off' || state.phone) return
  for (const item of state.scroll)
    item.el.style.opacity = String(scrollMarkOpacity(item.mark, absoluteScrollTop))
}
