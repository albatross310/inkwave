// ─── Wave twinkles — a PRECOMPUTED, compositor-only loading pool + the scroll-time system ─────
// v3 (Peter, 2026-07-11 — the strip-down): "it's just sine waves, some stochastic glitters and
// wave marks from a precalculated data pool, and an S-curve slow down — all of which on a
// different workflow to whatever has to load so it doesn't get interrupted."
//
// THE LOAD UNIT. Everything the loading animation will ever do is computed BEFORE playback:
//   • A pool of instances — sparks (glitters) and dashes (wave marks) — with ONE permanent
//     wave-relative position drawn through the never-strike-twice sampler (memPick),
//     canvas-rastered art (never SVG URIs — Chromium's per-URI IsolatedSVGDocumentHost cost is
//     measured ~4.3s at ~600 URIs), and a cycle of opacity envelopes (dash: 0.3s S rise / 0.4s
//     hold / 0.3s S fall).
//   • Playback = one WAAPI opacity track per instance + one shared transform track per populated
//     wave field, looping over the ~23.3s cycle, plus the tiles' CSS drift. NOTHING runs per
//     frame on the main thread during the load — no rAF driver, no respawns, no style writes —
//     so main-thread starvation is PHYSICALLY INCAPABLE of touching the animation (that's the
//     "different workflow": the compositor thread).
//
// HOW AN INSTANCE RIDES ITS WAVE WITH ZERO MAINTENANCE. The tile pattern drifts at exactly
// 72 px/s (140px per 1.944s loop). A blink instance's transform track bakes that motion in:
// The field's single transform runs continuously across the WHOLE cycle at the drift velocity,
// holding every instance at a CONSTANT wave-space position (its art phase, wrap140 — so the mark
// always lies on its crest/midline).
// Reappearance changes opacity only: no per-envelope relocation, y-jitter or hidden glide. The
// cycle is a whole number of 140px tile loops and every opacity track is dark at its seam, so the
// transform's periodic reset is invisible.
//
// ONE CLOCK, SET ONCE. Wave-space validity needs the tracks' startTime ≡ the tile drift's
// startTime (mod 1944ms). alignTracks() reads the tile animation's literal startTime (at the
// atomic-water gate on boot; at anim re-entry on later loads — waiting on its `ready` promise
// when pending, which resolves before the first visible frame) and batch-sets every track, once
// per load, with a random whole-loop cycle offset so each load plays a different window of the
// pool. No epoch globals, no per-frame re-anchoring, no resync.
//
// THE S-CURVE SLOW DOWN (SETTLE → rest). The tiles' coast is an additive brake (see Scroll.tsx);
// the twinkle FIELDS get the SAME injected brake keyframes via CSS the moment .iw-wave-coast
// lands — zero value + zero velocity at start, so every layer decelerates in lockstep with the
// water, continuous by construction. Over the coast the blinking layer FADES OUT and the static
// rest layer FADES IN (both pure CSS, the coast's S-curve): the twinkling calms exactly as the
// water slows, ending on the resting texture. Statics ride a WAAPI drift clocked to the tiles
// (created once, at coast start — they are invisible before it) so they decelerate on their
// crests too. At rest everything is handed to the scroll-time system in one commit.
//
// THE SCROLL-TIME SYSTEM (post-reveal, unchanged in spirit): static texture between scrolls;
// scroll velocity drives dash blink playbackRate (driven WAAPI), but a dash keeps the same
// wave-relative position when it reappears; sway = literal field transforms via swayFields()
// (the --wave-x inheritance firebreak — see index.css).

// ─── Colour knobs (one const each, per Peter's spec) ─────────────────────────────────────────
export const SPARK_COLOR = '#f7f2e8' // parchment-white sparkle strokes/satellites (day)
export const SPARK_CORE = '#fffdf8' // bright paper-white sparkle centre dot (day)
export const SPARK_COLOR_NIGHT = '#ffe14d' // night sparkles stay yellow (no objection recorded)
export const SPARK_CORE_NIGHT = '#fffbe0'
export const DASH_COLOR = '#b7c9c8' // muted blue-grey — matches the day wave strokes
export const DASH_COLOR_NIGHT = '#9aa3af' // grey family — matches the night wave art

// ─── Tuning ───────────────────────────────────────────────────────────────────────────────────
const PAD = 420 // offscreen strip coverage either side of the viewport (rest-sway recycle headroom)
const DASH_ROW_PX = 160 // one blinking dash per this many px of VIEWPORT width, per row, per group
const SPARK_ROW_PX = 800 // one spark per this many px of viewport width, per row, per group
const STATIC_ROW_PX = 246 // resting texture: one lit dash per this many px of STRIP width (≈ the old 0.65 subset)
const DASH_ON_S = 1.0 // dash envelope: 0.3s S rise + 0.4s hold + 0.3s S fall (Peter, 2026-07-10)
const DASH_S = 0.3 // each S-curve flank (s)
const DASH_REPEAT_CHANCE = 0.25 // subset with back-to-back blinks (high duty)
const DASH_DUTY: [number, number] = [0.60, 0.78]
const SPARK_ON_S = 0.2 // a glint (0.1 read as barely visible)
const SPARK_PERIOD: [number, number] = [0.9, 2.2]
const SPARK_REPEAT_CHANCE = 0.3 // subset with quick re-glints
const SPARK_REPEAT_PERIOD: [number, number] = [0.6, 0.9]
const LOOP_MS = 1944 // the tile loop — one 140px tile per loop = 72 px/s exactly
const CYCLE_LOOPS = 12 // pool cycle = 12 tile loops ≈ 23.3s — positions repeat only after this (≫ a load; ~half the track keyframes of 24)
const CYCLE_S = (LOOP_MS * CYCLE_LOOPS) / 1000
const DRIFT_PX_S = 140 / 1.944 // must match the wave drift EXACTLY
const V_REF = 1200 // scrollTop px/s that maps to blink rate 1
const RATE_CAP = 1.2 // a brisk scroll maxes out slightly livelier than the drift
const RATE_EPS = 0.02 // below this the water reads as still
const STATIC_DWELL_MS = 250 // stillness dwell before the dashes settle static
const SCROLL_STALE_MS = 160 // a velocity report older than this reads as "stopped"
const CREST = { a: 22, b: 92 } // thick-line inflection y within a 140px row

import { notePerf } from './perflog'

type Group = 'a' | 'b'
type Mode = 'anim' | 'coast' | 'off'

interface Inst {
  kind: 'spark' | 'dash'
  role: 'blink' | 'rest' // blink: precomputed envelope track during load; rest: the static texture
  group: Group
  row: number // 140px wave row — the strike-memory band, and the base for band-y maths
  hw: number // dash only: half the arc window (the length type)
  x: number // field-local box left (px); field space ≡ wave space at rest
  y: number
  w: number
  h: number
  day: string
  night: string
  period: number // blink period (s) — quantized so the cycle holds a whole number of envelopes
  delay: number // blink phase (s) within the period
  onS: number
  staticOn: boolean // lit at rest? (rest role: always true; blink role: scroll-time state)
  envelopes?: number // blink role: whole envelopes in the shared cycle; position never changes
}

// ─── PRNG — mulberry32 (tiny, seedable; seeded from Date.now — app code, that's fine) ─────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wrap140 = (x: number) => ((x % 140) + 140) % 140

// ─── Art rasteriser — canvas PNG data-URIs, NOT SVG data-URIs (2026-07-11) ───────────────────
// Chromium builds an ISOLATED SVG DOCUMENT (inner frame + style engine + resource fetch) for
// every unique SVG-image URI — traced at ~4.3s of boot at ~600 URIs (Firefox's SVG image path is
// cheap, hence the engine asymmetry). A 2D-canvas raster of the same strokes encodes to a tiny
// PNG whose decode is a threaded, document-less image decode. One shared canvas, reused. Art is
// rastered ONLY at pool build time (boot / resize / zoom reseed) — never during playback.
let _rasterCv: HTMLCanvasElement | null = null
function rasterURI(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  const cv = (_rasterCv ??= document.createElement('canvas'))
  cv.width = Math.ceil(w * dpr) // resize clears
  cv.height = Math.ceil(h * dpr)
  const g = cv.getContext('2d')
  if (!g) return ''
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw(g)
  return cv.toDataURL('image/png')
}

// ─── Banding maths ────────────────────────────────────────────────────────────────────────────
const arcY = (c: number, t: number) => c - 36 * t * (1 - t) // crest arc of a thick line
function midY(c: number, wx: number): number { // thick/thin pair midline at any wave coordinate
  const x = wrap140(wx)
  const t = (x % 70) / 70
  const bump = 36 * t * (1 - t)
  return x < 70 ? c + 14 - bump : c + 14 + bump
}
function midYd(wx: number): number { // midline slope dy/dx — ≡ the thick line's slope at the same x
  const x = wrap140(wx)
  const t = (x % 70) / 70
  const s = (36 * (1 - 2 * t)) / 70
  return x < 70 ? -s : s
}

// ─── Non-repeating strike sampler ─────────────────────────────────────────────────────────────
// Every permanent pool position goes through memPick(): candidates come from the caller's distribution, but are
// rejection-sampled against a per-band ring of past strikes (min wave-space edge distance
// MEM_EPS). The ring is a sliding window sized under the band's ε-capacity; it persists to
// localStorage so strikes don't repeat across page loads either. After MEM_TRIES failed draws
// the farthest candidate wins — a position is ALWAYS placed, so density is unchanged.
const MEM_EPS = 12 // min wave-space x distance (px) from any remembered strike in the band
const MEM_TRIES = 24 // rejection draws before settling for the farthest candidate
function memRing(kind: 'spark' | 'dash'): number {
  if (kind === 'dash') return Math.max(16, Math.round((stripW / DASH_ROW_PX) * 3))
  const cells = Math.max(1, Math.floor(stripW / 140))
  return Math.min(24, Math.max(8, Math.round(cells * 1.5)))
}
const MEM_LS_KEY = 'inkwave:twkMem:v2' // entries are [x, halfWidth] — dashes have real extent
let mem: Map<string, [number, number][]> | null = null // band key → ring of [x, hw] strikes
let memW = 0 // the stripW the memory was built against
let memSaveT: ReturnType<typeof setTimeout> | undefined

function memLoad(): void {
  if (mem && memW === stripW) return
  mem = new Map()
  memW = stripW
  try {
    localStorage.removeItem('inkwave:twkMem:v1') // retired schema
    const j = JSON.parse(localStorage.getItem(MEM_LS_KEY) ?? 'null') as
      { w: number; bands: Record<string, [number, number][]> } | null
    // Positions are only comparable against the same strip width — a resize reshuffles the
    // whole geography, so a mismatched blob just starts fresh (and is overwritten on next save).
    if (j && j.w === stripW && j.bands)
      for (const k of Object.keys(j.bands))
        mem.set(k, j.bands[k].filter((e) => Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1])))
  } catch { /* private mode / corrupt — in-session memory still applies */ }
}

function memSave(): void {
  if (memSaveT) return // throttle — pool builds record hundreds of strikes in one pass
  memSaveT = setTimeout(() => {
    memSaveT = undefined
    try {
      const bands: Record<string, [number, number][]> = {}
      for (const [k, v] of mem!) bands[k] = v
      localStorage.setItem(MEM_LS_KEY, JSON.stringify({ w: memW, bands }))
    } catch { /* best effort */ }
  }, 800)
}

const wrapW = (x: number) => ((x % stripW) + stripW) % stripW
const ringDist = (a: number, b: number) => { // wave-space is circular mod stripW
  const d = Math.abs(a - b)
  return Math.min(d, stripW - d)
}

function memPick<T>(kind: 'spark' | 'dash', group: Group, row: number, hw: number, draw: () => T, xOf: (c: T) => number): T {
  memLoad()
  const key = `${kind}:${group}:${row}`
  const seen = mem!.get(key) ?? []
  let best: T | null = null
  let bestD = -Infinity // NOT −1: edge-to-edge gaps go far below −1 on a saturated band ring, and
  // a threshold that no candidate beats left best === null → null strikes (a real build-time bug)
  for (let i = 0; i < MEM_TRIES; i++) {
    const c = draw()
    const nx = wrapW(xOf(c))
    let dMin = Infinity
    for (const p of seen) dMin = Math.min(dMin, ringDist(nx, p[0]) - hw - p[1])
    if (dMin >= MEM_EPS) { best = c; break }
    if (dMin > bestD) { bestD = dMin; best = c }
  }
  const picked = best!
  seen.push([Math.round(wrapW(xOf(picked))), hw])
  const cap = memRing(kind)
  if (seen.length > cap) seen.splice(0, seen.length - cap)
  mem!.set(key, seen)
  memSave()
  return picked
}

// ─── Instance generation ──────────────────────────────────────────────────────────────────────
// A dash strike: position via the never-twice memory + the exact-midline art at that position.
function dashArt(rnd: () => number, group: Group, row: number, hw: number, w: number, h: number, strip: number):
  { x: number; y: number; day: string; night: string } {
  const cx = memPick('dash', group, row, hw, () => -PAD + rnd() * strip, (c) => c)
  const wx = wrap140(cx)
  const c = CREST[group]
  const y0 = midY(c, wx)
  // The dash IS the exact midline arc over [wx−hw, wx+hw] ("always parallel with the thick line
  // above"). The midline is piecewise-parabolic with curvature flipping at every swell joint
  // (x ≡ 0 mod 70) — split the window at the joints and emit one quadratic Bézier per piece (a
  // quadratic reproduces a parabola EXACTLY; control point = intersection of the end tangents).
  const yAt = (X: number) => midY(c, X) - y0 + h / 2 // local-space midline (box centre = h/2)
  const xa = wx - hw, xb = wx + hw
  const cuts: number[] = [xa]
  for (let k = Math.ceil(xa / 70) * 70; k < xb; k += 70) if (k > xa) cuts.push(k)
  cuts.push(xb)
  const op = 0.32 + 0.12 * rnd()
  const paint = (col: string, o: number) => rasterURI(w, h, (g) => {
    g.strokeStyle = col
    g.globalAlpha = o
    g.lineWidth = 2.3
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(w / 2 + (xa - wx), yAt(xa))
    for (let s = 0; s < cuts.length - 1; s++) {
      const A = cuts[s], B = cuts[s + 1]
      g.quadraticCurveTo(
        w / 2 + ((A + B) / 2 - wx), yAt(A) + (midYd(A) * (B - A)) / 2,
        w / 2 + (B - wx), yAt(B),
      )
    }
    g.stroke()
  })
  return {
    x: cx - w / 2,
    y: 140 * row + y0 + (rnd() - 0.5) * 5 - h / 2,
    day: paint(DASH_COLOR, op),
    night: paint(DASH_COLOR_NIGHT, op * 0.92),
  }
}

function genDash(rnd: () => number, group: Group, row: number, strip: number, role: 'blink' | 'rest'): Inst {
  // THREE LENGTH TYPES: very short / medium / slightly longer accents, ~35/40/25.
  const tr = rnd()
  const [hw, w, h] = tr < 0.35 ? [4, 14, 12] : tr < 0.75 ? [8.5, 24, 16] : [13, 32, 20]
  const art = dashArt(rnd, group, row, hw, w, h, strip)
  // A repeat subset blinks nearly back-to-back (high duty = short dark gaps between flashes).
  const duty = rnd() < DASH_REPEAT_CHANCE ? 0.86 + 0.06 * rnd() : DASH_DUTY[0] + (DASH_DUTY[1] - DASH_DUTY[0]) * rnd()
  const period = DASH_ON_S / duty
  return {
    kind: 'dash', role, group, row, hw,
    x: art.x, y: art.y, w, h,
    day: art.day, night: art.night,
    period, delay: 0, onS: DASH_ON_S, // delay is drawn at schedule time (must fit inside the period)
    staticOn: role === 'rest',
  }
}

// A spark strike position: crest half of a random swell, past-peak biased (the distribution the
// original art baked in).
function drawSparkPos(rnd: () => number, strip: number): { cx: number; t: number } {
  const t = Math.min(0.92, Math.max(0.12, 0.58 + (rnd() + rnd() - 1) * 0.35)) // past-peak bias
  const cells = Math.max(1, Math.floor(strip / 140))
  return { cx: -PAD + Math.floor(rnd() * cells) * 140 + 70 * t, t }
}

// The spark's lens-y + art for a given crest position.
function sparkBody(rnd: () => number, group: Group, t: number): { cy: number; day: string; night: string } {
  const w = 30, h = 30
  const c = CREST[group]
  const arc = arcY(c, t)
  const cy = arc + (0.12 + 0.73 * rnd()) * (c - arc) // inside the arc↔chord lens
  const s = 0.75 + 0.4 * rnd()
  const sats: { offX: number; ys: number; r: number; o: number }[] = []
  const nSats = rnd() < 0.35 ? 2 : 1
  for (let k = 0; k < nSats; k++) {
    const offX = (rnd() < 0.5 ? -1 : 1) * (3 + 5 * rnd())
    const ts = Math.min(0.98, Math.max(0.02, t + offX / 70))
    const ys = arcY(c, ts) + (0.2 + 0.7 * rnd()) * (c - arcY(c, ts))
    sats.push({ offX, ys, r: 0.9 + 0.4 * rnd(), o: 0.55 + 0.35 * rnd() })
  }
  const paint = (col: string, core: string) => rasterURI(w, h, (g) => {
    g.strokeStyle = col
    g.lineWidth = 1.6 * s
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(15, 15 - 4.2 * s); g.lineTo(15, 15 + 4.2 * s)
    g.moveTo(15 - 4.2 * s, 15); g.lineTo(15 + 4.2 * s, 15)
    g.stroke()
    g.fillStyle = core
    g.beginPath(); g.arc(15, 15, 1.4 * s, 0, 2 * Math.PI); g.fill()
    g.fillStyle = col
    for (const sat of sats) {
      g.globalAlpha = sat.o
      g.beginPath(); g.arc(15 + sat.offX, 15 + sat.ys - cy, sat.r, 0, 2 * Math.PI); g.fill()
    }
    g.globalAlpha = 1
  })
  return { cy, day: paint(SPARK_COLOR, SPARK_CORE), night: paint(SPARK_COLOR_NIGHT, SPARK_CORE_NIGHT) }
}

function genSpark(rnd: () => number, group: Group, row: number, strip: number): Inst {
  const w = 30, h = 30
  const { cx, t } = memPick('spark', group, row, 0, () => drawSparkPos(rnd, strip), (c) => c.cx)
  const { cy, day, night } = sparkBody(rnd, group, t)
  const rapid = rnd() < SPARK_REPEAT_CHANCE // some glints repeat in quick succession
  const [p0, p1] = rapid ? SPARK_REPEAT_PERIOD : SPARK_PERIOD
  const period = p0 + (p1 - p0) * rnd()
  return {
    kind: 'spark', role: 'blink', group, row, hw: 0,
    x: cx - w / 2, y: 140 * row + cy - h / 2, w, h,
    day, night,
    period, delay: 0, onS: SPARK_ON_S,
    staticOn: false,
  }
}

// ─── The precomputed schedule — opacity only, at one permanent position ───────────────────────
// Quantize the instance's period so the shared cycle holds a WHOLE number of envelopes and keep
// enough dark time on both sides of the seam for the long drift transform's periodic reset. The
// instance never changes x/y when it disappears and comes back.
function buildSchedule(rnd: () => number, d: Inst): void {
  const E = Math.max(1, Math.round(CYCLE_S / d.period))
  const P = CYCLE_S / E // quantized period (±1% of the drawn one)
  d.period = P
  d.delay = 0.02 + rnd() * Math.max(0.02, P - d.onS - 0.06) // the whole envelope fits inside one period
  d.envelopes = E
}

// ─── Track keyframes — the whole load playback, precomputed ──────────────────────────────────
// Opacity track: E envelopes (dash: S rise / hold / S fall; spark: snap glint), dark elsewhere.
// Transform track: one straight drift for the whole cycle — no hidden relocations. Both loop over
// the same cycle; startTime ≡ the tile clock (alignTracks).
function opacityTrack(d: Inst): Keyframe[] {
  const kf: Keyframe[] = [{ offset: 0, opacity: 0 }]
  const E = d.envelopes!
  const ramp = d.kind === 'dash' ? DASH_S : 0.03
  const ease = d.kind === 'dash' ? 'cubic-bezier(0.4, 0, 0.2, 1)' : undefined
  for (let k = 0; k < E; k++) {
    const t0 = d.delay + k * d.period
    const o = (s: number) => Math.min(0.9999, Math.max(0.0001, s / CYCLE_S))
    kf.push({ offset: o(t0), opacity: 0, easing: ease })
    kf.push({ offset: o(t0 + ramp), opacity: 1 })
    kf.push({ offset: o(t0 + d.onS - ramp), opacity: 1, easing: ease })
    kf.push({ offset: o(t0 + d.onS), opacity: 0 })
  }
  kf.push({ offset: 1, opacity: 0 })
  return kf
}
export function monisticTransformTrack(group: Group): Keyframe[] {
  const dir = group === 'a' ? -1 : 1
  const x = dir * DRIFT_PX_S * CYCLE_S
  return [
    { offset: 0, transform: 'translate3d(0px, 0px, 0)' },
    { offset: 1, transform: `translate3d(${x.toFixed(2)}px, 0px, 0)` },
  ]
}

// ─── Module state — ONE shared pool per page: every surface mounts the SAME instances, so the
// overlapping loading shell + editor paint pixel-identically, like the wave pseudos do ─────────
interface SetNodes {
  set: HTMLElement
  fields: Record<Group, HTMLElement> // sway layer (literal ±wave-x at rest; CSS brake in coast)
  blink: Record<Group, HTMLElement> // precomputed-track instances (fades out over the coast)
  rest: Record<Group, HTMLElement> // static texture (fades in over the coast; WAAPI drift-clocked)
  els: HTMLElement[]
}
interface HostState {
  sparks?: SetNodes
  dashes?: SetNodes
  tok: { sparks: number; dashes: number }
  want: { sparks: boolean; dashes: boolean }
  phone: boolean
}

export function pendingTwinkleMountDecision(state: {
  requested: boolean
  tokenMatches: boolean
  alreadyMounted: boolean
  connected: boolean
  sameDefinitions: boolean
  mode: Mode
}): 'discard' | 'attach-static' | 'attach-animated' {
  if (!state.requested || !state.tokenMatches || state.alreadyMounted || !state.connected || !state.sameDefinitions)
    return 'discard'
  return state.mode === 'off' ? 'attach-static' : 'attach-animated'
}

let defs: { sparks: Inst[]; dashes: Inst[] } | null = null
let stripW = 0
const hosts = new Map<HTMLElement, HostState>()
const trackAnims = new Map<HTMLElement, Animation[]>() // blink els → opacity-only track
const blinkDrift = new Map<HTMLElement, Animation>() // blink wrapper → one shared drift transform
const restDrift = new Map<HTMLElement, Animation>() // rest wrappers → tile-clocked WAAPI drift
let waterMode: Mode = 'anim'
let lastWaveX = 0 // the sway value at/after the rest handoff (mirrors the surface's --wave-x)

// ─── The load clock — set once per load ──────────────────────────────────────────────────────
// trackT0 ≡ the tile drift animation's startTime (mod 1944ms) — that congruence is ALL the
// wave-space maths needs. A random whole-loop offset (< one cycle) makes each load play a
// different window of the pool. alignTracks is idempotent per load (alignedForLoad).
let trackT0: number | null = null
let alignedForLoad = false
function pinToTrackClock(a: Animation): void {
  const t0 = trackT0
  if (t0 == null) return
  const apply = () => {
    if (trackT0 !== t0 || waterMode === 'off' || a.playState === 'idle') return
    try { if (a.startTime !== t0) a.startTime = t0 } catch { /* detached or cancelled */ }
  }
  apply()
  // WebKit may replace a startTime written while the animation is play-pending. Re-assert after
  // ready, exactly as Scroll's sibling-wave adoption does; otherwise a warm refresh can begin a
  // shared mark field a fraction of a frame away from its wave.
  void a.ready.then(apply).catch(() => { /* cancelled — a newer mode owns it */ })
}
function findDrift(): Animation | undefined {
  for (const host of hosts.keys()) {
    const surface = host.parentElement
    if (!surface || !surface.classList.contains('iw-wave-anim')) continue
    try {
      const a = surface.getAnimations({ subtree: true })
        .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
      if (a) return a
    } catch { /* getAnimations unavailable */ }
  }
  return undefined
}
function alignTracks(): void {
  if (alignedForLoad || waterMode !== 'anim') return
  const drift = findDrift()
  if (!drift) return
  const apply = () => {
    if (alignedForLoad || waterMode !== 'anim') return
    const st = drift.startTime
    if (typeof st !== 'number') return
    alignedForLoad = true
    trackT0 = st - LOOP_MS * Math.floor(Math.random() * CYCLE_LOOPS)
    // Batch re-clock of anims created BEFORE the clock resolved. Only the pre-gate boot mounts
    // ever get here with existing tracks (they are display-hidden until the same recalc that
    // starts the drift, so the batch is invisible); on VISIBLE water, track creation is gated on
    // clockReady() below — a late batch re-clock of live marks was a MASS TELEPORT of the whole
    // field (Peter's live "backward tick just before the slowdown", 2026-07-12: +24-62px phase
    // steps on the screencast, ~40ms before reveal-imminent — the batch landed as the editor
    // mount drained, right before the settle gate fired).
    for (const anims of trackAnims.values()) for (const a of anims) pinToTrackClock(a)
    for (const a of blinkDrift.values()) pinToTrackClock(a)
    for (const r of clockWaiters.splice(0)) r()
  }
  if (typeof drift.startTime === 'number') apply()
  // Pending (the atomic gate just opened): ready resolves inside the frame that first renders
  // the drift, BEFORE it paints — the batch lands in the same paint. One await, once per load.
  else void drift.ready.then(apply).catch(() => { /* cancelled — a newer load owns the clock */ })
}
// Resolves once THIS load's clock is stamped (alignTracks' apply). Callers that would otherwise
// create mark tracks on visible water wait here — marks stay dark (var(--twk-static)) for the
// frame or two until the clock exists, then start already-aligned: no teleport, ever.
const clockWaiters: (() => void)[] = []
// Entry fade for mark tracks created on VISIBLE water: hold the layer at 0, create, then fade
// in over the CSS transition — deferred creation must never pop the whole layer in one frame.
// ON THE FIELD, not the blink wrapper: the coast's paused fade ANIMATION overrides any wrapper
// inline opacity the moment the coast class lands (first keyframe = 1 — measured re-pop); the
// field only ever animates TRANSFORM, so its inline opacity survives every phase.
function fadeWrapsOut(nodes: SetNodes): void {
  for (const g of ['a', 'b'] as Group[]) nodes.fields[g].style.opacity = '0'
}
function fadeWrapsIn(nodes: SetNodes): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const g of ['a', 'b'] as Group[]) nodes.fields[g].style.opacity = ''
  }))
}
function clockReady(): Promise<void> {
  if (alignedForLoad) return Promise.resolve()
  alignTracks()
  if (alignedForLoad) return Promise.resolve()
  return new Promise((res) => {
    clockWaiters.push(res)
    // The drift animation may not exist yet (surface still mounting) — retry until it does.
    let tries = 0
    const kick = () => {
      if (alignedForLoad || waterMode !== 'anim' || tries++ > 240) return
      alignTracks()
      if (!alignedForLoad) requestAnimationFrame(kick)
    }
    requestAnimationFrame(kick)
  })
}

// ─── Blink machinery (scroll-time) ────────────────────────────────────────────────────────────
// 'load' = the precomputed tracks own opacity (compositor; no JS). 'driven' = scroll-velocity
// playbackRate blinks. 'static' = no animations, opacity is each dash's var(--twk-static).
let blinkMode: 'load' | 'driven' | 'static' = 'load'
const dashAnims = new Map<HTMLElement, Animation>()
let vt = 0 // virtual blink clock (ms) — integrates the effective scroll rate
let lastEff = 1
let driver = 0
let lastStep = 0
let rate = 0 // smoothed scroll rate
let scrollTargetV = 0
let scrollTs = -1e9
let stillSince = 0
let lastRecycle = 0
let lastRateWrite = -1e9
let lastWrittenEff = -1
let listening = false

function blinkKeyframes(d: Inst): Keyframe[] {
  const o = (s: number) => Math.min(0.99, s / d.period)
  if (d.kind === 'spark') {
    const ramp = 0.03 // glints snap
    return [
      { offset: 0, opacity: 0 },
      { offset: o(ramp), opacity: 1 },
      { offset: o(d.onS - ramp), opacity: 1 },
      { offset: o(d.onS), opacity: 0 },
      { offset: 1, opacity: 0 },
    ]
  }
  // Dash S-curve envelope: 0.3s ease-in-out rise, 0.4s fully lit, 0.3s mirrored fall.
  return [
    { offset: 0, opacity: 0, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: o(DASH_S), opacity: 1 },
    { offset: o(d.onS - DASH_S), opacity: 1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: o(d.onS), opacity: 0 },
    { offset: 1, opacity: 0 },
  ]
}

function startDrivenBlink(el: HTMLElement, d: Inst): Animation {
  const a = el.animate(blinkKeyframes(d), { duration: d.period * 1000, iterations: Infinity })
  a.currentTime = Math.max(0, (vt + d.delay * 1000) % (d.period * 1000))
  a.playbackRate = lastEff
  return a
}

// Smooth blink→static handoff (never freeze mid-blink): cancel each dash's animation and let the
// 0.35s CSS opacity transition ease from its current value to var(--twk-static).
function goStatic(): void {
  blinkMode = 'static'
  const eased: HTMLElement[] = []
  for (const [el, a] of dashAnims) {
    if (el.isConnected) {
      const cur = parseFloat(getComputedStyle(el).opacity) || 0
      el.style.opacity = String(cur)
      // The resting texture = whichever dashes were ON as the water stopped: lit past half →
      // stays on; else fades out.
      el.style.setProperty('--twk-static', cur > 0.5 ? '1' : '0')
      eased.push(el)
    }
    a.cancel()
  }
  dashAnims.clear()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const el of eased) el.style.opacity = '' // → var(--twk-static), eased by the transition
  }))
}

function wakeFromStatic(): void {
  if (blinkMode !== 'static') return
  blinkMode = 'driven'
  syncDashLiveliness() // arm only what the viewport can see
}

// ─── The scroll-time driver — REST ONLY (during the load nothing runs on the main thread) ────
// Maps scroll velocity → dash playbackRate, owns rest-time recycling/relocation, and parks
// completely once the water is still and the dashes are static.
function ensureDriver(): void {
  if (!driver) {
    lastStep = performance.now()
    driver = requestAnimationFrame(step)
  }
}

function step(ts: number): void {
  driver = 0
  if (waterMode !== 'off') return // the load unit is compositor-only — no driver until rest
  const raw = ts - lastStep
  const stepT0 = performance.now()
  // Storm breaker: with no vsync (headless/occluded) rAF can fire back-to-back at CPU speed —
  // bow out to a timer and let the task queue breathe.
  if (raw >= 0 && raw < 3) {
    setTimeout(ensureDriver, 8)
    return
  }
  const dt = Math.min(64, Math.max(0, raw))
  lastStep = ts
  if (ts - lastRecycle > 500) { lastRecycle = ts; recycle() }
  if (!hosts.size) return // every host gone — park; ensureDriver re-arms
  const target = ts - scrollTs < SCROLL_STALE_MS ? scrollTargetV : 0
  rate += (target - rate) * Math.min(1, dt / 140) // short smoothing — the rate never steps
  const eff = rate
  vt += eff * dt
  lastEff = eff
  // Throttled rate flush: per-frame playbackRate writes on ~145 dashes were the scroll lag —
  // a ~120ms cadence (or a material change) is visually identical; vt integrates per-frame.
  if (blinkMode === 'driven' && (ts - lastRateWrite > 120 || Math.abs(eff - lastWrittenEff) > 0.08)) {
    lastRateWrite = ts
    lastWrittenEff = eff
    for (const a of dashAnims.values()) a.playbackRate = eff
  }
  if (eff > RATE_EPS) stillSince = 0
  else if (!stillSince) stillSince = ts
  if (eff <= RATE_EPS && stillSince && ts - stillSince > STATIC_DWELL_MS) {
    if (blinkMode === 'driven') goStatic()
    notePerf('twinkle-step', performance.now() - stepT0)
    return // park — reportSway wakes the loop
  }
  notePerf('twinkle-step', performance.now() - stepT0)
  driver = requestAnimationFrame(step)
}

// ─── Field transforms ─────────────────────────────────────────────────────────────────────────
// During the LOAD the fields carry no inline transform at all: the coast brake is a pure CSS
// animation (.iw-wave-coast .iw-twk-field — the same injected keyframes the tiles composite), so
// every twinkle layer decelerates in exact lockstep with the water, main-thread-free. At REST
// the fields take literal sway transforms (swayFields — never var(--wave-x): a var-consuming
// field put the whole instance subtree inside the sway's invalidation set; see the firebreak).
function setFieldRest(field: HTMLElement, group: Group, waveX: number): void {
  field.style.transform = group === 'a'
    ? `translate3d(${waveX.toFixed(2)}px, 0, 0)`
    : `translate3d(${(-waveX).toFixed(2)}px, 0, 0)`
}

// Per-sway-frame field transforms — called by Scroll's writeWave with the value it just wrote to
// the surface's --wave-x, so tiles (var) and fields (literal) carry the SAME number each frame.
export function swayFields(surface: HTMLElement, waveX: number): void {
  if (waterMode !== 'off') return // drift/coast own the wave position
  lastWaveX = waveX
  for (const [hostEl, hs] of hosts) {
    if (hostEl.parentElement !== surface) continue
    for (const nodes of [hs.sparks, hs.dashes]) {
      if (!nodes) continue
      for (const g of ['a', 'b'] as Group[]) setFieldRest(nodes.fields[g], g, waveX)
    }
  }
}

// Current field offset at rest — analytic (no forced style reads).
function currentFieldX(group: Group): number {
  return group === 'a' ? lastWaveX : -lastWaveX
}

// ─── Recycle (REST only) — keep the strip covering the viewport as the sway translates ───────
// stripW is a MULTIPLE OF 140, so shifting an instance by ±stripW preserves its wave-space phase
// (x mod 140) — its band-y, art and schedule stay valid. Defs are SHARED across hosts, so the
// shift applies to every host's copy in the same pass.
let lastRecycleFx: Partial<Record<Group, number>> = {}
function recycle(): void {
  if (!defs || !hosts.size || waterMode !== 'off') return
  pruneHosts()
  const vw = window.innerWidth
  const hs = Array.from(hosts.values())
  // Travel gate: the sweep only matters once the fields have moved far enough that offscreen
  // headroom could be consumed (PAD 420; 40px is conservative).
  const gateFx: Partial<Record<Group, number>> = { a: currentFieldX('a'), b: currentFieldX('b') }
  let moved = false
  for (const g of ['a', 'b'] as Group[]) {
    if (lastRecycleFx[g] === undefined || Math.abs((gateFx[g] as number) - (lastRecycleFx[g] as number)) > 40) moved = true
  }
  if (!moved) return
  lastRecycleFx = gateFx
  for (const kind of ['sparks', 'dashes'] as const) {
    const list = defs[kind]
    list.forEach((d, i) => {
      const x0 = currentFieldX(d.group)
      const sx = d.x + x0
      let shifted = false
      if (sx < -PAD - d.w) { d.x += stripW * Math.ceil((-PAD - d.w - sx) / stripW); shifted = true }
      else if (sx > vw + PAD) { d.x -= stripW * Math.ceil((sx - vw - PAD) / stripW); shifted = true }
      if (shifted) for (const h of hs) { const el = h[kind]?.els[i]; if (el) el.style.left = `${d.x}px` }
    })
  }
  syncDashLiveliness() // arm/idle blink animations as dashes cross the viewport
}

// ─── Viewport liveliness cap (REST) ───────────────────────────────────────────────────────────
// Only dashes whose screen position is inside the viewport (+100px margin) carry a live driven
// blink; offscreen ones idle with no animation. Phase never suffers: startDrivenBlink re-derives
// the exact phase from the vt clock.
function syncDashLiveliness(): void {
  if (!defs || !hosts.size || blinkMode !== 'driven') return
  const vw = window.innerWidth
  const hs = Array.from(hosts.values())
  defs.dashes.forEach((d, i) => {
    if (d.role !== 'rest') return // load-only blink objects stay hidden once rest begins
    const sx = d.x + currentFieldX(d.group)
    const visible = sx > -100 - d.w && sx < vw + 100
    for (const h of hs) {
      const el = h.dashes?.els[i]
      if (!el || !el.isConnected) continue
      const has = dashAnims.has(el)
      if (visible && !has) {
        dashAnims.set(el, startDrivenBlink(el, d))
      } else if (!visible && has) {
        dashAnims.get(el)!.cancel()
        dashAnims.delete(el)
      }
    }
  })
}

function pruneHosts(): void {
  for (const [host, h] of hosts) {
    if (host.isConnected) continue
    for (const nodes of [h.sparks, h.dashes]) {
      if (!nodes) continue
      for (const el of nodes.els) {
        dashAnims.get(el)?.cancel()
        dashAnims.delete(el)
      }
      stopLoadPlayback(nodes)
      for (const g of ['a', 'b'] as Group[]) {
        const w = nodes.rest[g]
        restDrift.get(w)?.cancel()
        restDrift.delete(w)
      }
    }
    hosts.delete(host)
  }
}

// ─── DOM plumbing ─────────────────────────────────────────────────────────────────────────────
function instEl(d: Inst): HTMLElement {
  const el = document.createElement('div')
  el.className = d.kind === 'dash' ? 'iw-twk-i iw-twk-dash-i' : 'iw-twk-i' // literal names — Tailwind scans source tokens
  el.style.left = `${d.x}px`
  el.style.top = `${d.y}px`
  el.style.width = `${d.w}px`
  el.style.height = `${d.h}px`
  el.style.setProperty('--twk-day', `url("${d.day}")`)
  el.style.setProperty('--twk-night', `url("${d.night}")`)
  if (d.kind === 'dash') el.style.setProperty('--twk-static', d.staticOn ? '1' : '0')
  return el
}

// Mount one object's precomputed opacity playback. Position is never animated on the object.
function startTracks(el: HTMLElement, d: Inst): void {
  if (!d.envelopes) return
  const dur = CYCLE_S * 1000
  const ao = el.animate(opacityTrack(d), { duration: dur, iterations: Infinity })
  trackAnims.set(el, [ao])
  if (alignedForLoad) pinToTrackClock(ao)
}

// Every object in one group keeps its own x/y forever; this wrapper supplies their one shared
// wave-locked translation. The long cycle covers exactly 12 tiles and resets only while every
// child opacity track is dark at its cycle seam.
function startBlinkDrifts(nodes: SetNodes): void {
  const dur = CYCLE_S * 1000
  for (const g of ['a', 'b'] as Group[]) {
    const wrap = nodes.blink[g]
    if (!wrap.childElementCount || blinkDrift.has(wrap)) continue
    const a = wrap.animate(monisticTransformTrack(g), { duration: dur, iterations: Infinity })
    blinkDrift.set(wrap, a)
    if (alignedForLoad) pinToTrackClock(a)
  }
}

function stopLoadPlayback(nodes: SetNodes): void {
  for (const el of nodes.els) {
    for (const a of trackAnims.get(el) ?? []) a.cancel()
    trackAnims.delete(el)
  }
  for (const g of ['a', 'b'] as Group[]) {
    blinkDrift.get(nodes.blink[g])?.cancel()
    blinkDrift.delete(nodes.blink[g])
  }
}

function showBlinkLayer(nodes: SetNodes, show: boolean): void {
  for (const g of ['a', 'b'] as Group[]) nodes.blink[g].style.display = show ? '' : 'none'
}

const decoded = new WeakSet<Inst[]>()
async function decodeAll(list: Inst[]): Promise<void> {
  if (decoded.has(list)) return
  await Promise.all(
    list.flatMap((d) => [d.day, d.night]).map((u) => {
      const img = new Image()
      img.src = u
      return img.decode().catch(() => {}) // a hint — never block mounting on it
    }),
  )
  decoded.add(list)
}

// ─── Pool generation — ONE synchronous pass, ahead of playback ───────────────────────────────
function genList(rnd: () => number, kind: 'sparks' | 'dashes'): Inst[] {
  const vh = Math.max(window.innerHeight, window.screen?.height ?? 0) // lvh-stable row coverage
  const vw = window.innerWidth
  const rows = Math.ceil(vh / 140) + 1
  const out: Inst[] = []
  for (let r = 0; r < rows; r++) {
    if (kind === 'sparks') {
      for (const g of ['a', 'b'] as Group[]) {
        const n = Math.floor(vw / SPARK_ROW_PX + rnd())
        for (let i = 0; i < n; i++) out.push(genSpark(rnd, g, r, stripW))
      }
    } else {
      // SINGLE BAND (2026-07-15 — Peter's short-line spec: wave marks parallel to the thick line,
      // on ONE band between the thick and thin line). Generating BOTH crest groups painted marks
      // in TWO stacked y-bands per 140px row (group 'a' ≈ the thick line, group 'b' ≈ the thin
      // line — the "two or more layers of short lines built up" Peter reported, root cause B).
      // Dashes now use group 'a' ONLY — one band, thick-line-parallel. Sparks (glitters) keep both
      // crests; only the wave-MARK field collapses to one band.
      const g: Group = 'a'
      const nB = Math.floor(vw / DASH_ROW_PX + rnd()) // viewport-budgeted: keep load track count bounded
      for (let i = 0; i < nB; i++) out.push(genDash(rnd, g, r, stripW, 'blink'))
      const nR = Math.floor(stripW / STATIC_ROW_PX + rnd()) // the resting texture, strip-wide
      for (let i = 0; i < nR; i++) out.push(genDash(rnd, g, r, stripW, 'rest'))
    }
  }
  return out
}

// POOL SEED. Normally Date.now() — every load gets a fresh geography. The wave-video GENERATOR
// (scripts/wave-video/generate.mjs) overrides it via `window.__iwTwkSeed` so the LOOP clip and the
// BRAKE clip — captured in separate browser sessions — bake the IDENTICAL pool; otherwise the
// phase-0 loop→brake swap teleports every mark/glitter (measured 5.8% of pixels). Test seam only:
// unset in the app, so production behaviour is byte-identical to Date.now() seeding.
const poolSeed = (salt: number): number => {
  const s = (window as unknown as { __iwTwkSeed?: number }).__iwTwkSeed
  return ((s ?? Date.now()) ^ salt) >>> 0
}

function ensureSchedules(): void {
  if (!defs) return
  const rnd = mulberry32(poolSeed(0x51ed270b))
  for (const list of [defs.sparks, defs.dashes])
    for (const d of list) if (d.role === 'blink' && !d.envelopes) buildSchedule(rnd, d)
}

function generate(): void {
  stripW = Math.ceil((window.innerWidth + 2 * PAD) / 140) * 140 // ≡ 0 (mod 140) — the recycle invariant
  const rnd = mulberry32(poolSeed(0))
  defs = { sparks: genList(rnd, 'sparks'), dashes: genList(rnd, 'dashes') }
  ensureSchedules()
  ;(window as unknown as { __iwTwkPool?: unknown }).__iwTwkPool = defs // read-only debug/probe hook
}

function buildSet(setCls: string, list: Inst[]): SetNodes {
  const set = document.createElement('div')
  set.className = `iw-twk-set ${setCls}`
  const fields = { a: document.createElement('div'), b: document.createElement('div') }
  const blink = { a: document.createElement('div'), b: document.createElement('div') }
  const rest = { a: document.createElement('div'), b: document.createElement('div') }
  for (const g of ['a', 'b'] as Group[]) {
    fields[g].className = g === 'a' ? 'iw-twk-field iw-twk-fa' : 'iw-twk-field iw-twk-fb' // group class → the CSS brake picks its direction
    blink[g].className = 'iw-twk-blink' // fades out over the coast (CSS)
    rest[g].className = 'iw-twk-rest' // hidden during drift; fades in over the coast (CSS)
    fields[g].appendChild(blink[g])
    fields[g].appendChild(rest[g])
    set.appendChild(fields[g])
  }
  const els = list.map((d) => {
    const el = instEl(d)
    ;(d.role === 'rest' ? rest : blink)[d.group].appendChild(el)
    return el
  })
  return { set, fields, blink, rest, els }
}

function mountSet(host: HTMLElement, h: HostState, kind: 'sparks' | 'dashes'): void {
  const token = ++h.tok[kind]
  const list = kind === 'sparks' ? defs!.sparks : defs!.dashes
  // Build the DOM + playback SYNCHRONOUSLY (detached — WAAPI runs on detached elements), so the
  // ~130ms of track creation overlaps the async art-decode wait instead of serializing after it.
  const nodes = buildSet(kind === 'sparks' ? 'iw-twk-sparks' : 'iw-twk-dashes', list)
  const startAll = () => {
    showBlinkLayer(nodes, true)
    startBlinkDrifts(nodes)
    nodes.els.forEach((el, i) => {
      if (list[i].role === 'blink' && !trackAnims.has(el)) startTracks(el, list[i])
    })
  }
  const gateOpen = document.documentElement.classList.contains('iw-water-ready')
  if (waterMode === 'off') {
    for (const g of ['a', 'b'] as Group[]) setFieldRest(nodes.fields[g], g, lastWaveX)
    showBlinkLayer(nodes, false)
  } else if (!announced && !gateOpen) {
    // The GATE host (its mount is what twinkles-ready waits on): tracks must exist before the
    // first visible frame — create them now, in the one synchronous pass. Everything is hidden
    // until the gate recalc, so the water-ready clock batch re-times them invisibly.
    startAll()
  } else if (!announced) {
    // Gate already open but nothing announced (shouldn't happen in practice) — clock-gate anyway.
    fadeWrapsOut(nodes)
    void clockReady().then(() => {
      if (host.isConnected && waterMode !== 'off') { startAll(); fadeWrapsIn(nodes) }
    })
  } else {
    // A LATER host (the covered editor under the shell): its copy is invisible until the
    // reveal, so its ~330 track animations (~250ms measured) move OFF the boot's critical
    // path — created in CHUNKED idle slices (each ~35 elements ≈ 25ms), so the editor boot's
    // fonts/pagination work interleaves and the reveal never waits on a long task. Complete
    // long before the uncover on any healthy load; clock-exact either way (startTracks stamps
    // trackT0 at creation).
    let cursor = 0
    const slice = () => {
      if (!host.isConnected || h[kind] !== nodes || waterMode === 'off') return
      const end = Math.min(nodes.els.length, cursor + 35)
      for (; cursor < end; cursor++) {
        const d = list[cursor]
        if (d.role === 'blink' && !trackAnims.has(nodes.els[cursor])) startTracks(nodes.els[cursor], d)
      }
      if (cursor < nodes.els.length) scheduleSlice()
      else fadeWrapsIn(nodes) // whole layer created — ease it in
    }
    const scheduleSlice = () => {
      if ('requestIdleCallback' in window) (window as Window & typeof globalThis).requestIdleCallback(slice, { timeout: 500 })
      else setTimeout(slice, 40)
    }
    fadeWrapsOut(nodes)
    void clockReady().then(() => {
      startBlinkDrifts(nodes)
      scheduleSlice()
    }) // tracks are born aligned — never re-clocked while visible

  }
  void decodeAll(list).then(() => {
    const decision = pendingTwinkleMountDecision({
      requested: h.want[kind],
      tokenMatches: h.tok[kind] === token,
      alreadyMounted: Boolean(h[kind]),
      connected: host.isConnected,
      sameDefinitions: Boolean(defs) && (kind === 'sparks' ? defs!.sparks : defs!.dashes) === list,
      mode: waterMode,
    })
    if (decision === 'discard') {
      stopLoadPlayback(nodes)
      return
    }
    // Decode can finish AFTER coast→rest. Those load animations live on detached elements, so
    // enterRest cannot see them through h.sparks/h.dashes. Never attach a late desktop dash set
    // with its infinite load tracks still running; it must arrive as the static resting texture.
    if (decision === 'attach-static') {
      stopLoadPlayback(nodes)
      showBlinkLayer(nodes, false)
    }
    host.appendChild(nodes.set)
    h[kind] = nodes
    if (waterMode === 'anim') alignTracks() // no-op if this load is already aligned
    if (waterMode === 'coast' && kind === 'dashes') startRestDrift(host, nodes) // mid-coast mount: statics must ride
    if (waterMode === 'off') {
      lastRecycleFx = {}
      lastRecycle = performance.now()
      recycle() // late-session mounts sweep immediately — a swayed field otherwise shows empty
      if (blinkMode === 'driven') syncDashLiveliness()
    }
    maybeAnnounceReady(h)
  })
}

// ─── Atomic-water participation ("they need to start atomically") ────────────────────────────
// The .iw-water-ready gate (entry.client) waits for the twinkle pool too: once a host has BOTH
// sets generated + decoded + in the DOM (hidden — the not-ready CSS keeps .iw-wave-twinkles
// display:none), announce readiness. Colour, waves and twinkles then land in one style recalc.
let announced = false
function maybeAnnounceReady(h: HostState): void {
  if (announced || !h.sparks || !h.dashes) return
  announced = true
  ;(window as unknown as { __iwTwinklesReady?: boolean }).__iwTwinklesReady = true
  window.dispatchEvent(new Event('inkwave:twinkles-ready'))
}

function remount(host: HTMLElement, h: HostState, kind: 'sparks' | 'dashes'): void {
  const old = h[kind]
  if (old) {
    for (const el of old.els) {
      dashAnims.get(el)?.cancel()
      dashAnims.delete(el)
    }
    stopLoadPlayback(old)
    for (const g of ['a', 'b'] as Group[]) {
      restDrift.get(old.rest[g])?.cancel()
      restDrift.delete(old.rest[g])
    }
    old.set.remove()
    h[kind] = undefined
  }
  mountSet(host, h, kind)
}

// Dashes recalculate on zoom settle (positions, art, schedules AND the static subset).
function regenDashes(): void {
  if (!defs || !hosts.size) return
  pruneHosts()
  // At rest no PHONE surface mounts dashes — don't rasterise a full pool for nothing.
  let mounted = false
  for (const h of hosts.values()) if (h.dashes) { mounted = true; break }
  if (!mounted) return
  const rnd = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0)
  defs.dashes = genList(rnd, 'dashes')
  ensureSchedules()
  for (const [host, h] of hosts) if (h.dashes) remount(host, h, 'dashes')
}

function regenAll(): void {
  if (!defs || !hosts.size) return
  generate()
  pruneHosts()
  for (const [host, h] of hosts) {
    if (h.sparks) remount(host, h, 'sparks')
    if (h.dashes) remount(host, h, 'dashes')
  }
}

// ─── Mode transitions — the two control events, in twinkle terms ─────────────────────────────
// START is implicit (mode 'anim' on a fresh load: tracks play). SETTLE arrives as mode 'coast'
// (one-shot: clock the rest layer's drift to the tiles; CSS does the brake + cross-fade). The
// rest handoff arrives as mode 'off' (one-shot: literal sway transforms, tracks cancelled).
function enterCoast(): void {
  for (const [hostEl, h] of hosts) { if (h.dashes) startRestDrift(hostEl, h.dashes) }
}
// Give ONE host's rest layer its coast ramp (see enterCoast's doc below). Also called from
// mountSet for a host whose dashes finish mounting mid-coast — statics must never fade in
// standing while the water still moves.
function startRestDrift(hostEl: HTMLElement, nodes: SetNodes): void {
  // The static rest layer fades in over the coast and must decelerate ON its crests. Each rest
  // wrapper gets a NON-wrapping WAAPI drift ramp anchored to its enclosing field's CSS brake:
  // the brake's `ready` resolves at the coast's first painted frame with its literal startTime
  // t0c — the SAME clock Scroll's resolve stamps — and the ramp starts at the drift's wrapped
  // pose at t0c, exactly the tx0 the brake keyframes were snapped against. Standing pose at the
  // hold = tx0 − d = the handed-off --wave-x, so the rest commit swaps in identical pixels BY
  // CONSTRUCTION. (A looping 140px ramp would visibly teleport the lit statics at every wrap;
  // an anchor at settle-time had a wrap ambiguity against the resolve — both real.) Statics are
  // near-invisible for the ramp's ≤1-frame pending window (their fade-in starts at 0).
  const surface = hostEl.parentElement
  let driftT0: number | null = null
  try {
    const drift = surface?.getAnimations({ subtree: true })
      .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
    if (typeof drift?.startTime === 'number') driftT0 = drift.startTime as number
  } catch { /* getAnimations unavailable */ }
  if (driftT0 == null) return // no running drift (degenerate) — statics fade in standing
  for (const g of ['a', 'b'] as Group[]) {
    const wrap = nodes.rest[g]
    if (restDrift.has(wrap)) continue
    let brake: Animation | undefined
    try {
      brake = nodes.fields[g].getAnimations()
        .find((x) => ((x as CSSAnimation).animationName ?? '').startsWith('iw-wave-coast'))
    } catch { /* getAnimations unavailable */ }
    if (!brake) continue
    const dT0 = driftT0
    const start = () => {
      if (waterMode !== 'coast' || restDrift.has(wrap) || !wrap.isConnected) return
      const t0c = typeof brake!.startTime === 'number' ? brake!.startTime as number : timelineMs()
      const x0 = -140 * ((((t0c - dT0) / LOOP_MS) % 1 + 1) % 1) // wrapped drift pose at t0c
      const dir = g === 'a' ? 1 : -1
      const D = 14000 // covers T + the 8s hold + slop; fill holds after (the rest commit lands long before)
      const a = wrap.animate(
        [
          { transform: `translate3d(${(dir * x0).toFixed(3)}px,0,0)` },
          { transform: `translate3d(${(dir * (x0 - DRIFT_PX_S * (D / 1000))).toFixed(3)}px,0,0)` },
        ],
        { duration: D, fill: 'forwards' },
      )
      try { a.startTime = t0c } catch { /* pending resolves ≈ t0c — sub-frame */ }
      restDrift.set(wrap, a)
    }
    if (typeof brake.startTime === 'number') start()
    else {
      // Pending until the forward anchor plays it (~1 rAF + slack) — `ready` + a poll fallback;
      // whichever lands first wins (start() is idempotent). Statics are near-invisible that
      // early in their fade, and the anchor stays EXACT (t0c is the literal startTime,
      // however late we read it).
      void brake.ready.then(start).catch(() => { /* class dropped — a newer mode owns it */ })
      let polls = 0
      const poll = () => {
        if (waterMode !== 'coast' || restDrift.has(wrap) || !wrap.isConnected || polls++ > 12) return
        if (typeof brake!.startTime === 'number') start()
        else setTimeout(poll, 100)
      }
      setTimeout(poll, 100)
    }
  }
}
const timelineMs = (): number =>
  (document.timeline?.currentTime as number | null) ?? performance.now()

function enterRest(): void {
  // ONE commit, same flush as the surface's wave classes dropping: cancel the load playback
  // (blinkers fall to var(--twk-static) — invisible: their layer just faded to 0 through the
  // coast), stop the rest layer's drift (its enclosing field's brake vanishes with the class in
  // this same recalc; total pose = the tiles' handed-off --wave-x, identical by construction),
  // and put the fields on literal sway transforms at that exact value.
  for (const [hostEl, h] of hosts) {
    // Rest has no sparkles anywhere and no marks on phone. Record that before an asynchronous
    // decode can finish: a pending set is not yet in h.sparks/h.dashes, so cancellation below
    // cannot discover it. Its decode continuation reads these wishes and discards it instead.
    h.want.sparks = false
    if (h.phone) h.want.dashes = false
    const surface = hostEl.parentElement
    const waveX = surface ? parseFloat(surface.style.getPropertyValue('--wave-x')) || 0 : 0
    lastWaveX = waveX
    for (const nodes of [h.sparks, h.dashes]) {
      if (!nodes) continue
      for (const g of ['a', 'b'] as Group[]) {
        setFieldRest(nodes.fields[g], g, waveX)
        const rw = nodes.rest[g]
        restDrift.get(rw)?.cancel()
        restDrift.delete(rw)
      }
      stopLoadPlayback(nodes)
      showBlinkLayer(nodes, false)
    }
  }
  blinkMode = 'static'
}

// ─── Public API ───────────────────────────────────────────────────────────────────────────────
// Called from a LAYOUT effect on every waveMode change (pre-paint, so the coast start / rest
// handoff land in the same flush as the surface's wave class swap — no flash frame).
export function syncTwinkles(
  host: HTMLElement,
  want: { sparks: boolean; dashes: boolean; mode: Mode; phone: boolean },
): void {
  if (!defs) generate()
  if (!listening) {
    listening = true
    // Boot: the atomic gate's recalc creates the tiles' CSS drift — align the pool's clock to
    // its literal startTime in the same first-visible frame.
    window.addEventListener('inkwave:water-ready', alignTracks)
    window.addEventListener('inkwave:zoom-settled', regenDashes)
    let rt: ReturnType<typeof setTimeout> | undefined
    window.addEventListener('resize', () => {
      if (rt) clearTimeout(rt)
      rt = setTimeout(regenAll, 300) // strip/row counts change with the viewport
    })
  }
  pruneHosts()
  let h = hosts.get(host)
  if (!h) {
    h = { tok: { sparks: 0, dashes: 0 }, want: { sparks: false, dashes: false }, phone: want.phone }
    hosts.set(host, h)
  }
  h.want.sparks = want.sparks
  h.want.dashes = want.dashes
  h.phone = want.phone

  // Global mode transition (every surface flips in the same event dispatch).
  const prev = waterMode
  waterMode = want.mode
  if (want.mode === 'anim' && prev !== 'anim') {
    // A NEW load: fresh playback instance — never reused clocks or timers. The pool (art +
    // positions + schedules) is reused; the clock realigns to THIS load's tiles with a fresh
    // random cycle offset, and any scroll-time animations from the previous rest are dropped.
    alignedForLoad = false
    for (const a of dashAnims.values()) a.cancel()
    dashAnims.clear()
    blinkMode = 'load'
    for (const [, hs] of hosts) {
      for (const nodes of [hs.sparks, hs.dashes]) {
        if (!nodes) continue
        showBlinkLayer(nodes, true)
        for (const g of ['a', 'b'] as Group[]) {
          nodes.fields[g].style.transform = '' // the sway transform yields to the CSS choreography
          restDrift.get(nodes.rest[g])?.cancel()
          restDrift.delete(nodes.rest[g])
        }
      }
    }
    // Surviving rest elements (and zoom-reseeded ones) get THIS load's tracks only once the new
    // load's clock exists — creating them on a provisional clock and re-timing later teleported
    // every visible mark at once (the live backward tick). The wrappers fade out (taking the old
    // rest texture with them, gently), the tracks land aligned, then the layer eases back in.
    for (const [, hs2] of hosts) {
      for (const nodes2 of [hs2.sparks, hs2.dashes]) if (nodes2) fadeWrapsOut(nodes2)
    }
    void clockReady().then(() => {
      if (waterMode !== 'anim') return
      for (const [, hs2] of hosts) {
        for (const nodes2 of [hs2.sparks, hs2.dashes]) {
          if (!nodes2) continue
          const list2 = nodes2 === hs2.sparks ? defs!.sparks : defs!.dashes
          startBlinkDrifts(nodes2)
          nodes2.els.forEach((el, i) => {
            const d = list2[i]
            if (d?.role === 'blink' && !trackAnims.has(el)) startTracks(el, d)
          })
          fadeWrapsIn(nodes2)
        }
      }
    })
    alignTracks()
  }
  if (want.mode === 'coast' && prev === 'anim') enterCoast()
  if (want.mode === 'off' && prev !== 'off') enterRest()

  // Mount / remove the requested sets on THIS host.
  if (want.sparks && !h.sparks) mountSet(host, h, 'sparks')
  else if (!want.sparks && h.sparks) { stopLoadPlayback(h.sparks); h.sparks.set.remove(); h.sparks = undefined; h.tok.sparks++ }
  if (want.dashes && !h.dashes) mountSet(host, h, 'dashes')
  else if (!want.dashes && h.dashes) {
    for (const el of h.dashes.els) {
      dashAnims.get(el)?.cancel(); dashAnims.delete(el)
    }
    stopLoadPlayback(h.dashes)
    for (const g of ['a', 'b'] as Group[]) { restDrift.get(h.dashes.rest[g])?.cancel(); restDrift.delete(h.dashes.rest[g]) }
    h.dashes.set.remove(); h.dashes = undefined; h.tok.dashes++
  }
}

// Genuine scrollTop velocity (px/s) from the sway handler — zoom-hold-compensated deltas are
// excluded UPSTREAM (Scroll.tsx), so zoom corrections never read as water motion.
let swayPrimeTs = -1e9 // last isolated report — the sustained-scroll wake gate below
export function reportSway(pxPerSec: number): void {
  if (waterMode !== 'off' || !hosts.size) return
  const now = performance.now()
  scrollTargetV = Math.min(RATE_CAP, pxPerSec / V_REF)
  scrollTs = now
  if (scrollTargetV <= 0) return
  // SUSTAINED-SCROLL WAKE: a single caret-reveal scroll nudge (typing at the page bottom) reads
  // as a huge one-frame velocity and must never wake the parked field — waking needs TWO scroll
  // frames within 200ms (a real scroll produces dozens).
  if (blinkMode === 'static' && !driver) {
    const prev = swayPrimeTs
    swayPrimeTs = now
    if (now - prev > 200) return // isolated report — prime only, stay parked
  }
  wakeFromStatic()
  ensureDriver()
}
