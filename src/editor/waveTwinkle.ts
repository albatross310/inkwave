// ─── Wave twinkles — discrete sparkles + accent dashes that track the water's motion ─────────
// v2 (Peter, 2026-07-09/10). v1 tiled 140px background layers, so every dash/sparkle repeated at
// every tile position with identical art and identical blink phase — the field visibly repeated,
// and the dashes flickered forever, even on still water. Now:
//
// PER-INSTANCE UNIQUENESS. Twinkles are DISCRETE ELEMENTS: small absolutely-positioned divs, a
// few per 140px wave row, each with its own PRNG position, art and blink schedule — no two
// visible instances share either. Structure per surface (host = the empty .iw-wave-twinkles div
// Scroll.tsx renders — present in the prerender, populated post-hydration):
//
//   .iw-twk-set.iw-twk-sparks      (sub-container: the coast S-fade opacity lives here so it
//     .iw-twk-field ×2              MULTIPLIES with the instances' own blink; clips its fields)
//   .iw-twk-set.iw-twk-dashes
//     .iw-twk-field ×2
//
// The FIELDS are the only transform-composited layers (one per drift direction per set): group-a
// instances sit on the a-rows (thick line at 140r+22 — drift LEFT, +--wave-x sway); group-b on
// the b-rows (140r+92 — drift RIGHT, −--wave-x). Field motion mirrors the wave layers exactly:
//   • anim  — one long linear WAAPI translate at the drift speed, startTime = the SHARED EPOCH
//     ANIMATION's literal startTime (__iwWaveEpochAnim — see Scroll.tsx), so it is phase-exact
//     with the tiles from whatever moment it mounts. No looping keyframes: the field is not
//     140-periodic, a loop restart would teleport it — instead instances RECYCLE by the strip
//     width, a multiple of 140, which preserves each instance's wave-space phase (and therefore
//     its band-y validity) while it's offscreen.
//   • coast — a WAAPI ease-out with the wave coast's exact cubic + distance, from the analytic
//     drift offset at coast start (exact: same clock as the tiles' freeze).
//   • off   — inline translate3d(calc(±var(--wave-x) + rebase)): the rebase constant makes the
//     handoff pixel-identical, and the sway then moves the instances with the water.
//
// BLINK = MOTION (Peter's contract: "the rate they flicker should slow as the water slows"):
//   • DRIFT: full rate — plain WAAPI opacity animations, startTime epoch-aligned (compositor
//     driven, so the busy booting main thread can't stall them; also cross-surface identical).
//   • COAST: dash playbackRate follows the wave's own velocity profile v(t)=v0·(1−t/T)² over
//     --wave-coast-T, driven per rAF — the flicker decelerates exactly in step with the water.
//     Sparkles keep full rate (they die with the coast fade regardless).
//   • REST: NO flicker. As the rate reaches ~0, each dash EASES (0.35s CSS transition on the
//     base opacity) from its mid-blink value to its STATIC state — never frozen mid-blink: a
//     ~50% stochastic per-instance subset renders fully-on (like the original baked art), the
//     rest off. The subset reassigns on every zoom reseed.
//   • SCROLL: the sway handler reports genuine scrollTop velocity (zoom-hold-compensated deltas
//     are EXCLUDED upstream — Scroll.tsx); it smooths into the same rate pathway
//     (rate = max(coastRate, scrollRate), capped ~1.2): slow scroll = occasional lazy twinkles,
//     brisk = lively, decaying back to static as the velocity dies.
//
// GEOMETRY. Every thick wave line is Q(0,c)(35,c−18)(70,c) then the T-mirrored trough. x(t)=70t
// is LINEAR, so the crest arc is y(t) = c − 36·t(1−t) (peak c−9 at t=½; inflections y=c at
// t=0,1). Sparkles sit in the lens between the arc and its chord y=c (past-peak biased, like the
// original art); dashes ride the thick/thin PAIR MIDLINE — the same shape +14px — on either half
// of the swell, ±jitter. Regeneration: whole field on resize; dashes on 'inkwave:zoom-settled'.
// Every data-URI is decode()d before its element mounts. All animation is opacity/transform.
//
// NON-REPEATING STRIKES (Peter, 2026-07-10: "the glitters must never strike the same place
// twice"). Two mechanisms, one sampler:
//   • Every position draw (spark gen/respawn, dash gen/reseed/respawn) goes through memPick():
//     candidates come from the EXISTING distributions (density + banding maths untouched), but
//     are rejection-sampled against a per-band memory of past strikes — min wave-space distance
//     MEM_EPS. 'Same place' = wave-space x (strip x mod stripW — recycling shifts by ±stripW so
//     the identity is stable) within the band (kind+group+row). The memory is a per-band ring
//     buffer persisted to localStorage, so strikes don't repeat within a load, across dash
//     reseeds, OR across page loads (same viewport; a resize regenerates the whole field and
//     resets the memory — different strip, different geography). The ring is a sliding window
//     sized just under the band's ε-capacity (a finite crest can't hold unboundedly many
//     ε-separated strikes — see memRing): ≈ one full load of glints, carried over the reload
//     boundary. After MEM_TRIES failed draws the farthest candidate wins, so a position is
//     ALWAYS placed — density is unchanged by construction.
//   • Sparks AND dashes additionally RESPAWN after every glint/blink envelope: the driver
//     watches each instance's blink clock (epoch clock while playing, the vt clock while
//     driven) and, in the dark window right after an envelope ends (opacity 0 — the move is
//     invisible), redraws its position AND art through the sampler. The running opacity
//     animation is never touched (period/delay/onS keep their phase); only left/top and the
//     art vars change, on every host's copy. Latched / static dashes have no live animation —
//     no more envelopes — so the resting texture never shuffles.

// ─── Colour knobs (one const each, per Peter's spec) ─────────────────────────────────────────
export const SPARK_COLOR = '#ffe14d' // sparkle strokes/satellites (day)
export const SPARK_CORE = '#fffbe0' // sparkle centre dot (day)
export const SPARK_COLOR_NIGHT = '#ffe14d' // night sparkles stay yellow (no objection recorded)
export const SPARK_CORE_NIGHT = '#fffbe0'
export const DASH_COLOR = '#FFF5EE' // seashell — matches the day wave strokes
export const DASH_COLOR_NIGHT = '#9aa3af' // grey family — matches the night wave art

// ─── Field tuning ─────────────────────────────────────────────────────────────────────────────
const PAD = 420 // offscreen coverage either side of the viewport (recycle headroom ≈ 5.8s of drift)
const DASH_ROW_PX = 160 // one dash per this many px of strip width, per row, per field (denser again — Peter, 2026-07-10)
const SPARK_ROW_PX = 800 // denser field — they were barely visible (Peter, 2026-07-10)
// Dash lit ENVELOPE (Peter, 2026-07-10): 0.3s ease-in-out S rise + 0.4s fully lit + 0.3s
// mirrored S fall = a fixed 1.0s envelope (see blinkKeyframes). DASH_ON is that envelope length.
const DASH_ON: [number, number] = [1.0, 1.0]
const DASH_S = 0.3 // each S-curve flank (s)
const DASH_REPEAT_CHANCE = 0.25 // subset with back-to-back blinks (high duty)
// Lit fraction while blinking at rate 1. The S envelope's PERCEIVED lit time ≈ 0.4s flat +
// 2·(0.3/2) flank ≈ 0.7 of the 1.0s envelope, so duty is retuned ÷0.7-ish from the old hard
// window's [0.42,0.58] — the same proportion of dashes reads as visible at once.
const DASH_DUTY: [number, number] = [0.60, 0.78]
const SPARK_ON_S = 0.2 // a glint (0.1 read as barely visible)
const SPARK_PERIOD: [number, number] = [0.9, 2.2]
const SPARK_REPEAT_CHANCE = 0.3 // subset with quick re-glints
const SPARK_REPEAT_PERIOD: [number, number] = [0.45, 0.8]
const STATIC_ON_CHANCE = 0.65 // the resting fully-on subset (reseed-at-rest path)
const DRIFT_PX_S = 140 / 1.944 // must match the wave drift EXACTLY (72 flat drifted the analytic
// coast from-value ~0.0165px/s off the WAAPI ramp — and off the tiles' modular freeze maths)
const V_REF = 1200 // scrollTop px/s that maps to blink rate 1
const RATE_CAP = 1.2 // a brisk scroll maxes out slightly livelier than the drift
const RATE_EPS = 0.02 // below this the water reads as still
const STATIC_DWELL_MS = 250 // stillness dwell before the dashes settle static
const SCROLL_STALE_MS = 160 // a velocity report older than this reads as "stopped"
const COAST_EASE = 'cubic-bezier(0.33333, 1, 0.66667, 1)' // the wave coast's exact cubic
const CREST = { a: 22, b: 92 } // thick-line inflection y within a 140px row

import { notePerf } from './perflog'

type Group = 'a' | 'b'
type Mode = 'anim' | 'coast' | 'off'

interface Inst {
  kind: 'spark' | 'dash'
  group: Group
  row: number // 140px wave row — the strike-memory band, and the base for band-y maths
  hw: number // dash only: half the arc window (the length type) — respawns keep their length
  x: number // field-local box left (px); field space ≡ wave space (recycle keeps it mod-140 true)
  y: number
  w: number
  h: number
  day: string
  night: string
  period: number // blink period (s) — unique per instance
  delay: number // blink phase (s) — unique per instance
  onS: number
  staticOn: boolean // dash only: lit at rest?
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
// every unique SVG-image URI. The field is ~300 instances × day+night ≈ 600 unique URIs at boot
// — traced at ~4.3s of IsolatedSVGDocumentHost/SVGImage::DataChanged on the warm-load main
// thread (the "Chrome takes forever" boot; Firefox's SVG image path is cheap, hence the engine
// asymmetry) — and every respawn minted MORE of them, forever. A 2D-canvas raster of the same
// strokes encodes to a tiny PNG whose decode is a threaded, document-less image decode: visually
// identical (drawn at devicePixelRatio), no SVG machinery at all. One shared canvas, reused.
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

// ─── Non-repeating strike sampler (see header) ───────────────────────────────────────────────
const MEM_EPS = 12 // min wave-space x distance (px) from any remembered strike in the band
const MEM_TRIES = 24 // rejection draws before settling for the farthest candidate
// Remembered strikes per band. A band's strike manifold is FINITE (sparks: ~cells × 70·t-range
// ≈ 50px of biased crest-half per 140px cell), so it cannot hold unboundedly many ε-separated
// strikes — "never twice" must mean a sliding window, sized just under the band's ε-capacity
// (≈ cells·56/(2·12) ≈ 2.3·cells): big enough to span ≈ a full load of glints (and carry the
// previous load's tail across a reload) without saturating every draw into the fallback.
function memRing(kind: 'spark' | 'dash'): number {
  if (kind === 'dash') {
    // Dashes RECORD on every relocation now (reseeds + the load-window lattice cycling), and a
    // band holds ~stripW/DASH_ROW_PX of them — a 16-ring was ~one envelope of shared history, so
    // a dash could return to a spot from two envelopes ago (visible "same place again"). Hold ~3
    // strikes of history per band dash, still under the band's ε-capacity (~60 for a 2240 strip)
    // so draws don't saturate into the farthest-candidate fallback.
    return Math.max(16, Math.round((stripW / DASH_ROW_PX) * 3))
  }
  const cells = Math.max(1, Math.floor(stripW / 140))
  return Math.min(24, Math.max(8, Math.round(cells * 1.5)))
}
const MEM_LS_KEY = 'inkwave:twkMem:v2' // v2: entries are [x, halfWidth] — dashes have real extent
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
  if (memSaveT) return // THROTTLE, not debounce — respawns record continuously through the whole
  memSaveT = setTimeout(() => { // load; a trailing debounce would never fire until the water rests
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

// Draw a position through the band's strike memory: candidates come from `draw` (the existing
// distribution — density and banding stay exact), the first whose EDGE-TO-EDGE gap from every
// remembered strike is ≥ MEM_EPS wins (hw = the strike's half-width along x: dashes have real
// extent — centre distance alone would let long dashes overlap tips); after MEM_TRIES the
// farthest candidate is taken (a position is ALWAYS placed). Recorded per band + persisted.
function memPick<T>(kind: 'spark' | 'dash', group: Group, row: number, hw: number, draw: () => T, xOf: (c: T) => number): T {
  memLoad()
  const key = `${kind}:${group}:${row}`
  const seen = mem!.get(key) ?? []
  let best: T | null = null
  let bestD = -1
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
// Shared by genDash and the per-envelope respawn (which keeps the instance's length/schedule).
function dashArt(rnd: () => number, group: Group, row: number, hw: number, w: number, h: number, strip: number):
  { x: number; y: number; day: string; night: string } {
  // Box centre — anywhere along the strip, either swell half; drawn through the strike memory
  // so a strike never lands where one recently sat in this band.
  const cx = memPick('dash', group, row, hw, () => -PAD + rnd() * strip, (c) => c)
  const wx = wrap140(cx)
  const c = CREST[group]
  const y0 = midY(c, wx)
  // The dash IS the exact midline arc over [wx−hw, wx+hw] (Peter, 2026-07-10: "always parallel
  // with the thick line above"). The midline is piecewise-PARABOLIC with curvature flipping at
  // every swell joint (x ≡ 0 mod 70) — the old single quadratic through 3 samples was exact
  // inside one branch but a joint-straddling dash (window/70 of them) got a near-straight
  // segment at the averaged slope where the water S-bends: visibly not parallel. So: split the
  // window at the joints and emit one quadratic Bézier per piece — a quadratic reproduces a
  // parabola EXACTLY (control point = intersection of the end tangents), so every dash carries
  // the thick line's own y(x) and tangents at its x, jitter being one whole-dash vertical offset.
  const yAt = (X: number) => midY(c, X) - y0 + h / 2 // local-space midline (box centre = h/2)
  const xa = wx - hw, xb = wx + hw
  const cuts: number[] = [xa]
  for (let k = Math.ceil(xa / 70) * 70; k < xb; k += 70) if (k > xa) cuts.push(k)
  cuts.push(xb)
  const op = 0.32 + 0.12 * rnd()
  // Same piecewise quadratics as the old SVG path, stroked straight onto the raster canvas.
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

function genDash(rnd: () => number, group: Group, row: number, strip: number): Inst {
  // THREE LENGTH TYPES (Peter, 2026-07-10): very short / medium / slightly longer accents,
  // ~35/40/25. hw = half the arc window; box w/h fit window + stroke + caps at max slope 0.514.
  const tr = rnd()
  const [hw, w, h] = tr < 0.35 ? [4, 14, 12] : tr < 0.75 ? [8.5, 24, 16] : [13, 32, 20]
  const art = dashArt(rnd, group, row, hw, w, h, strip)
  const onS = DASH_ON[0] + (DASH_ON[1] - DASH_ON[0]) * rnd()
  // A repeat subset blinks nearly back-to-back (high duty = short dark gaps between flashes).
  const duty = rnd() < DASH_REPEAT_CHANCE ? 0.86 + 0.06 * rnd() : DASH_DUTY[0] + (DASH_DUTY[1] - DASH_DUTY[0]) * rnd()
  const period = onS / duty
  return {
    kind: 'dash', group, row, hw,
    x: art.x, y: art.y, w, h,
    day: art.day, night: art.night,
    period, delay: rnd() * period, onS,
    staticOn: rnd() < STATIC_ON_CHANCE,
  }
}

// A spark strike position: crest half of a random swell, past-peak biased (the distribution the
// original art baked in). Drawn through the strike memory by callers.
function drawSparkPos(rnd: () => number, strip: number): { cx: number; t: number } {
  const t = Math.min(0.92, Math.max(0.12, 0.58 + (rnd() + rnd() - 1) * 0.35)) // past-peak bias
  const cells = Math.max(1, Math.floor(strip / 140))
  return { cx: -PAD + Math.floor(rnd() * cells) * 140 + 70 * t, t }
}

// The spark's lens-y + art for a given crest position — shared by gen and per-glint respawn.
function sparkBody(rnd: () => number, group: Group, t: number): { cy: number; day: string; night: string } {
  const w = 30, h = 30
  const c = CREST[group]
  const arc = arcY(c, t)
  const cy = arc + (0.12 + 0.73 * rnd()) * (c - arc) // inside the arc↔chord lens
  const s = 0.75 + 0.4 * rnd()
  // Satellites drawn from the SAME random stream for both variants (the old SVG built one string
  // and recoloured it) — precompute them, then rasterise each palette.
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
    kind: 'spark', group, row, hw: 0,
    x: cx - w / 2, y: 140 * row + cy - h / 2, w, h,
    day, night,
    period, delay: rnd() * period, onS: SPARK_ON_S,
    staticOn: false,
  }
}

// ─── Module state — ONE shared field per page: every surface mounts the SAME instances, so the
// overlapping loading shell + editor paint pixel-identically, like the wave pseudos do ─────────
interface SetNodes { set: HTMLElement; fields: Record<Group, HTMLElement>; els: HTMLElement[] }
interface HostState { sparks?: SetNodes; dashes?: SetNodes; tok: { sparks: number; dashes: number } }

let defs: { sparks: Inst[]; dashes: Inst[] } | null = null
let stripW = 0
let epochMs = 0 // the wave clock zero
const hosts = new Map<HTMLElement, HostState>()
const elDef = new WeakMap<HTMLElement, Inst>()
const fieldMode = new WeakMap<HTMLElement, Mode>()
const fieldAnim = new WeakMap<HTMLElement, Animation>()
const fieldRebase = new WeakMap<HTMLElement, number>()
let waterMode: Mode = 'anim'
interface CoastState { start: number; T: number; dist: number; resolved?: boolean }
let coast: CoastState | null = null
let lastCoast: CoastState | null = null
// ADDITIVE COAST (v3, 2026-07-11 — mirrors Scroll.tsx): where animation-composition exists, a
// coasting field KEEPS its drift ramp running and adds a composite:'add' deceleration on top —
// zero value + zero velocity at start, so the handoff is continuous whenever the commit lands,
// and a linear hold after T cancels the ramp exactly (total static until the rest handoff).
const ADDITIVE_TWK = typeof CSS !== 'undefined' && !!CSS.supports?.('animation-composition', 'add')
const TWK_COAST_HOLD_MS = 8000 // must cover the worst finish-timer lag (Scroll's cap is 3.3s)
const fieldAdd = new WeakMap<HTMLElement, Animation>() // the coast additive, alongside fieldAnim (the ramp)
// The rest-state transform constant per group, frozen ONCE at the coast→off handoff (where
// --wave-x ≡ the coast's end offset, so it is ≈0 mod 140). Later mounts (zoom reseed, resize)
// MUST reuse it — recomputing against the CURRENT --wave-x would fold the accumulated scroll
// sway into the rebase and shear the dashes off their wave rows (found in headless verify).
let restRebase: Record<Group, number> | null = null

// Blink machinery: 'playing' = real-time full rate (drift); 'driven' = playbackRate follows the
// water; 'static' = no animations, opacity is each dash's var(--twk-static).
// latchMap/latchGen: lit-at-stop dashes — the viewport liveliness pass must never re-arm them;
// a new load (anim re-entry) bumps the generation instead of clearing.
const latchMap = new WeakMap<HTMLElement, number>()
let latchGen = 0
let blinkMode: 'playing' | 'driven' | 'static' = 'playing'
const dashAnims = new Map<HTMLElement, Animation>()
const blinkAnim = new WeakMap<HTMLElement, Animation>() // EVERY instance's live blink (epoch re-anchor)
let vt = 0 // virtual blink clock (ms) — integrates the effective rate; phase base for new anims
let lastEff = 1
let driver = 0
let lastStep = 0
let rate = 0 // smoothed scroll rate
let scrollTargetV = 0
let scrollTs = -1e9
let stillSince = 0
let lastRecycle = 0
let lastRateWrite = -1e9 // last playbackRate flush (ts)
let lastWrittenEff = -1 // the rate the animations currently carry
let listening = false

function resolveEpoch(): number {
  const w = window as unknown as { __iwWaveEpoch?: number; __iwWaveEpochAnim?: Animation }
  const t = w.__iwWaveEpochAnim?.startTime
  if (typeof t === 'number') return t // the literal shared animation clock — exact
  return w.__iwWaveEpoch ?? performance.now()
}

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
  // Dash S-curve envelope (Peter, 2026-07-10): 0.3s ease-in-out rise, 0.4s fully lit, 0.3s
  // mirrored ease-in-out fall — they ease in AND out, never snap. Per-keyframe easing applies
  // to the segment it starts; the 1→1 hold needs none. The driver's coast/scroll playbackRate
  // stretches the whole envelope with the water, and the lit-at-stop latch reads mid-envelope
  // opacity — both semantics unchanged by the shape.
  return [
    { offset: 0, opacity: 0, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: o(DASH_S), opacity: 1 },
    { offset: o(d.onS - DASH_S), opacity: 1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { offset: o(d.onS), opacity: 0 },
    { offset: 1, opacity: 0 },
  ]
}

// Real-time blink, phase-locked to the epoch: currentTime ≡ (now − epoch) + delay — the same
// formula the virtual clock starts from, so the playing→driven switch is phase-seamless, and two
// surfaces' copies of the same instance are always identical.
function startBlink(el: HTMLElement, d: Inst): Animation {
  const a = el.animate(blinkKeyframes(d), { duration: d.period * 1000, iterations: Infinity })
  a.startTime = epochMs - d.delay * 1000
  blinkAnim.set(el, a)
  return a
}

function startDrivenBlink(el: HTMLElement, d: Inst): Animation {
  const a = el.animate(blinkKeyframes(d), { duration: d.period * 1000, iterations: Infinity })
  a.currentTime = Math.max(0, (vt + d.delay * 1000) % (d.period * 1000))
  a.playbackRate = lastEff
  blinkAnim.set(el, a)
  return a
}

// Smooth blink→static handoff (Peter: never freeze mid-blink): cancel each dash's animation and
// let the 0.35s CSS opacity transition ease from its current value to var(--twk-static).
function goStatic(): void {
  blinkMode = 'static'
  const eased: HTMLElement[] = []
  for (const [el, a] of dashAnims) {
    if (el.isConnected) {
      const cur = parseFloat(getComputedStyle(el).opacity) || 0
      el.style.opacity = String(cur)
      // The resting texture = whichever dashes were ON as the water stopped (Peter, 2026-07-10):
      // lit past half → stays on; else fades out. Overrides the prechosen random subset (which
      // still seeds reseed-at-rest, where there is no 'before' state).
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
  // Arm only what the viewport can see (and never the latched set) — re-arming the full field
  // on every scroll start was ~200 el.animate() calls of churn.
  syncDashLiveliness()
}

// ─── The driver — one rAF loop mapping water speed → dash playbackRate ───────────────────────
// eff = max(coast velocity profile, smoothed scroll rate). Runs from first mount (it also owns
// instance recycling) and parks completely once the water is still and the dashes are static.
function ensureDriver(): void {
  if (!driver) {
    lastStep = performance.now()
    driver = requestAnimationFrame(step)
  }
}

function step(ts: number): void {
  driver = 0
  const raw = ts - lastStep
  const stepT0 = performance.now() // perflog: driver frame cost while awake (desktop lag hunt)
  // STORM BREAKER (2026-07-11, Peter's Chrome "waves forever"): with no vsync (headless, some
  // GPU-less/occluded states) rAF can fire back-to-back at CPU speed; the driver's own style
  // writes then re-invalidate every "frame" and the loop eats the main thread — the boot never
  // runs, the reveal never comes, the compositor waves forever. A sub-3ms callback cadence is
  // never a real display — bow out to a timer and let the task queue breathe.
  if (raw >= 0 && raw < 3) {
    setTimeout(ensureDriver, 8)
    return
  }
  const dt = Math.min(64, Math.max(0, raw))
  lastStep = ts
  if (ts - lastRecycle > 500) { lastRecycle = ts; recycle() }
  if (!hosts.size) return // every host gone (route without water) — park; ensureDriver re-arms
  respawnSparks(ts) // per-glint relocation — before the anim early-return (sparks glint all load)
  respawnDashes(ts) // per-envelope relocation — dashes never strike the same place twice either
  if (waterMode === 'anim') { // dashes play natively at full rate; the loop only recycles
    driver = requestAnimationFrame(step)
    return
  }
  const target = ts - scrollTs < SCROLL_STALE_MS ? scrollTargetV : 0
  rate += (target - rate) * Math.min(1, dt / 140) // short smoothing — the rate never steps
  let eff = rate
  if (coast) {
    const t = (ts - coast.start) / coast.T
    if (t >= 1) coast = null
    else eff = Math.max(eff, (1 - t) * (1 - t)) // the wave's own velocity: v(t) = v0·(1−t/T)²
  }
  vt += eff * dt
  lastEff = eff
  // THROTTLED rate flush (2026-07-10, Peter's scroll-lag regression): at ~145 dashes, per-frame
  // playbackRate writes were ~145 compositor-synced Animation mutations EVERY rAF while
  // scrolling — the lag. The rate follows slow curves (coast v(t), smoothed scroll velocity),
  // so a ~120ms cadence (or a material change) is visually identical; vt still integrates
  // per-frame, so blink PHASE stays exact regardless of write cadence. The coast latch rides
  // the same cadence (a dash stays lit ~1s — a 120ms latch check cannot miss one).
  if (blinkMode === 'driven' && (ts - lastRateWrite > 120 || Math.abs(eff - lastWrittenEff) > 0.08)) {
    lastRateWrite = ts
    lastWrittenEff = eff
    for (const [el, a] of dashAnims) {
      a.playbackRate = eff
      // COAST LATCH (Peter, 2026-07-10): during the slowdown, any dash that reaches full glow is
      // LATCHED on — the lit set grows monotonically through the coast (no thinning), and the
      // final static texture is whatever accumulated. Coast-only; scroll twinkling never latches.
      if (coast && el.isConnected && parseFloat(getComputedStyle(el).opacity) > 0.7) {
        a.cancel()
        dashAnims.delete(el)
        latchMap.set(el, latchGen)
        el.style.setProperty('--twk-static', '1')
        el.style.opacity = '' // → var(--twk-static)=1, eased by the CSS transition
      }
    }
  }
  if (eff > RATE_EPS) stillSince = 0
  else if (!stillSince) stillSince = ts
  if (!coast && waterMode === 'off' && eff <= RATE_EPS && stillSince && ts - stillSince > STATIC_DWELL_MS) {
    if (blinkMode === 'driven') goStatic()
    notePerf('twinkle-step', performance.now() - stepT0)
    return // park — reportSway / the next coast wakes the loop
  }
  notePerf('twinkle-step', performance.now() - stepT0)
  driver = requestAnimationFrame(step)
}

// ─── Field transforms — mirror the wave layers exactly ───────────────────────────────────────
// The drift ramp: one long linear WAAPI translate — NOT a 140px loop (the field isn't periodic;
// a loop restart would teleport it). Backdated to the epoch → phase-exact with the tiles from
// any mount time. K is DYNAMIC (2026-07-11): the old fixed 600 gave ~19min of headroom from the
// EPOCH — a veil/shell mounted later in a long session created a ramp that had already finished
// (fill:forwards) = dashes frozen dead still against moving water (Peter's "short lines stop
// moving, lose touch with their wave" on late-session snapshot opens).
function startRamp(field: HTMLElement, dir: number): Animation {
  const K = 600 + Math.ceil(Math.max(0, performance.now() - epochMs) / 1944) // ≥ ~19min from NOW
  const a = field.animate(
    [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${dir * 140 * K}px,0,0)` }],
    { duration: 1944 * K, easing: 'linear', fill: 'forwards' },
  )
  a.startTime = epochMs
  return a
}
// The additive coast keyframes for a field (see the Scroll.tsx block): value opposes the ramp
// direction, (vT−d)·bezier(1/3,0,2/3,0.5) over T then linear +v·t − d (cancels the ramp).
function addCoastFrames(dir: number, c: CoastState): Keyframe[] {
  const s = -dir
  const D = c.T + TWK_COAST_HOLD_MS
  const mid = DRIFT_PX_S * (c.T / 1000) - c.dist
  const endV = DRIFT_PX_S * (D / 1000) - c.dist
  return [
    { transform: 'translate3d(0,0,0)', easing: 'cubic-bezier(0.33333, 0, 0.66667, 0.5)', offset: 0 },
    { transform: `translate3d(${(s * mid).toFixed(3)}px,0,0)`, easing: 'linear', offset: c.T / D },
    { transform: `translate3d(${(s * endV).toFixed(3)}px,0,0)`, offset: 1 },
  ]
}
function applyFieldMode(field: HTMLElement, group: Group, m: Mode, surface: HTMLElement | null): void {
  if (fieldMode.get(field) === m) return
  fieldMode.set(field, m)
  const dir = group === 'a' ? -1 : 1
  const prev = fieldAnim.get(field)
  const prevAdd = fieldAdd.get(field)
  if (m === 'anim') {
    fieldAnim.set(field, startRamp(field, dir))
    field.style.transform = '' // drop any stale rest transform (re-open) — the animation owns it now
    prevAdd?.cancel()
    fieldAdd.delete(field)
  } else if (m === 'coast' && coast) {
    if (ADDITIVE_TWK) {
      // Keep the ramp running (create it if this field mounted mid-coast) and ADD the coast.
      if (!prev) fieldAnim.set(field, startRamp(field, dir))
      const a = field.animate(addCoastFrames(dir, coast), {
        duration: coast.T + TWK_COAST_HOLD_MS, composite: 'add', fill: 'forwards',
      })
      // Resolved clock known (late mount) → align exactly; else natural start (first painted
      // frame — continuous by construction), retimed by retimeCoast at Scroll's clock resolve.
      if (coast.resolved) { try { a.startTime = coast.start } catch { /* pending fallback */ } }
      fieldAdd.set(field, a)
      return // the ramp stays — nothing to cancel
    }
    const x0 = dir * DRIFT_PX_S * (coast.start - epochMs) / 1000 // analytic — same clock as the tiles' freeze
    const a = field.animate(
      [
        { transform: `translate3d(${x0.toFixed(2)}px,0,0)` },
        { transform: `translate3d(${(x0 + dir * coast.dist).toFixed(2)}px,0,0)` },
      ],
      { duration: coast.T, easing: COAST_EASE, fill: 'forwards' },
    )
    a.startTime = coast.start
    fieldAnim.set(field, a)
  } else {
    prevAdd?.cancel()
    fieldAdd.delete(field)
    // REST: ride the scroll sway. rebase makes the coast→sway handoff paint identical pixels;
    // it is ≡ 0 (mod 140) by construction (both sides derive from the same animation clock), so
    // every instance's wave-space phase — and its band-y — stays valid. Frozen ONCE at the
    // handoff (see restRebase) — later mounts reuse the same constant. Inline transform FIRST,
    // cancel after, same synchronous flush (callers run in layout effects): no flash frame.
    if (!restRebase) {
      const c = lastCoast
      const waveX = surface ? parseFloat(surface.style.getPropertyValue('--wave-x')) || 0 : 0
      const xf = (g: Group) => {
        const d2 = g === 'a' ? -1 : 1
        return c ? d2 * DRIFT_PX_S * (c.start - epochMs) / 1000 + d2 * c.dist : 0
      }
      restRebase = { a: xf('a') - waveX, b: xf('b') + waveX }
    }
    const rebase = restRebase[group]
    fieldRebase.set(field, rebase)
    // LITERAL px, not calc(var(--wave-x)…) (2026-07-11 scroll-jank round): a var-consuming field
    // put the whole ~300-leaf instance subtree inside --wave-x's invalidation set on every sway
    // frame. The sway now pushes literal transforms per frame via swayFields() below (transform
    // doesn't inherit — zero child invalidation), and .iw-wave-twinkles is a --wave-x firebreak.
    const waveX = surface ? parseFloat(surface.style.getPropertyValue('--wave-x')) || 0 : 0
    field.style.transform = group === 'a'
      ? `translate3d(${(waveX + rebase).toFixed(2)}px, 0, 0)`
      : `translate3d(${(rebase - waveX).toFixed(2)}px, 0, 0)`
    fieldAnim.delete(field)
  }
  prev?.cancel()
}

// Per-sway-frame field transforms — called by Scroll's writeWave with the value it just wrote to
// the surface's --wave-x, so tiles (var) and fields (literal) carry the SAME number each frame.
export function swayFields(surface: HTMLElement, waveX: number): void {
  for (const [hostEl, hs] of hosts) {
    if (hostEl.parentElement !== surface) continue
    for (const nodes of [hs.sparks, hs.dashes]) {
      if (!nodes) continue
      for (const g of ['a', 'b'] as Group[]) {
        const f = nodes.fields[g]
        if (fieldMode.get(f) !== 'off') continue
        const rb = fieldRebase.get(f) ?? 0
        f.style.transform = g === 'a'
          ? `translate3d(${(waveX + rb).toFixed(2)}px, 0, 0)`
          : `translate3d(${(rb - waveX).toFixed(2)}px, 0, 0)`
      }
    }
  }
}

// Current field offset — analytic (no forced style reads).
function currentFieldX(field: HTMLElement, group: Group): number {
  const now = performance.now()
  const dir = group === 'a' ? -1 : 1
  const m = fieldMode.get(field) ?? waterMode
  if (m === 'anim') return dir * DRIFT_PX_S * (now - epochMs) / 1000
  if (m === 'coast') {
    const c = coast ?? lastCoast
    if (!c) return 0
    if (ADDITIVE_TWK) {
      // ramp + additive: base keeps running; add = −dir·[(vT−d)·(3τ²−τ³)/2 | v·t−d after T].
      const base = dir * DRIFT_PX_S * (now - epochMs) / 1000
      const tau = Math.max(0, (now - c.start) / c.T)
      const add = tau <= 1
        ? (DRIFT_PX_S * (c.T / 1000) - c.dist) * (3 * tau * tau - tau ** 3) / 2
        : DRIFT_PX_S * (now - c.start) / 1000 - c.dist
      return base - dir * add
    }
    const t = Math.min(1, (now - c.start) / c.T)
    return dir * DRIFT_PX_S * (c.start - epochMs) / 1000 + dir * c.dist * (1 - (1 - t) ** 3)
  }
  const surface = field.closest('.inkwave-editor-surface') as HTMLElement | null
  const waveX = surface ? parseFloat(surface.style.getPropertyValue('--wave-x')) || 0 : 0
  const rb = fieldRebase.get(field) ?? 0
  return group === 'a' ? waveX + rb : rb - waveX
}

// ─── Recycle — keep the strip covering the viewport as the fields translate ──────────────────
// stripW is a MULTIPLE OF 140, so shifting an instance by ±stripW preserves its wave-space phase
// (x mod 140) — its band-y, art and schedule stay valid; it rejoins the pattern on the other
// side, always while offscreen. Defs are SHARED across hosts, so the shift applies to every
// host's copy of the instance in the same pass.
let lastRecycleFx: Partial<Record<Group, number>> = {}
function recycle(): void {
  if (!defs || !hosts.size) return
  pruneHosts()
  const vw = window.innerWidth
  const hs = Array.from(hosts.values())
  // TRAVEL GATE (scroll-lag fix): the sweep only matters once the fields have moved far enough
  // that offscreen headroom could be consumed (PAD 420 ≈ 5.8s of drift; 40px is conservative).
  // A parked/slow-sway session skips the whole instance scan.
  const gateFx: Partial<Record<Group, number>> = {}
  let moved = false
  for (const g of ['a', 'b'] as Group[]) {
    const f = hs.find((h) => h.dashes || h.sparks)
    const fld = (f?.dashes ?? f?.sparks)?.fields[g]
    if (!fld) continue
    gateFx[g] = currentFieldX(fld, g)
    if (lastRecycleFx[g] === undefined || Math.abs((gateFx[g] as number) - (lastRecycleFx[g] as number)) > 40) moved = true
  }
  if (!moved) return
  lastRecycleFx = gateFx
  for (const kind of ['sparks', 'dashes'] as const) {
    const list = defs[kind]
    const fx: Partial<Record<Group, number>> = {}
    for (const g of ['a', 'b'] as Group[]) {
      const f = hs.find((h) => h[kind])?.[kind]?.fields[g]
      if (f) fx[g] = currentFieldX(f, g)
    }
    list.forEach((d, i) => {
      const x0 = fx[d.group]
      if (x0 === undefined) return
      const sx = d.x + x0
      let moved = false
      if (sx < -PAD - d.w) { d.x += stripW * Math.ceil((-PAD - d.w - sx) / stripW); moved = true }
      else if (sx > vw + PAD) { d.x -= stripW * Math.ceil((sx - vw - PAD) / stripW); moved = true }
      if (moved) for (const h of hs) { const el = h[kind]?.els[i]; if (el) el.style.left = `${d.x}px` }
    })
  }
  syncDashLiveliness() // same travel gate: arm/idle blink animations as dashes cross the viewport
}

// ─── Per-glint spark respawn — a glitter never strikes the same place twice ──────────────────
// Runs every driver frame (cheap: arithmetic per spark; real work only on a glint-end edge).
// The blink ANIMATION is never touched — its epoch phase, period and compositor-driven opacity
// carry on; only the instance's position and art move, inside the dark window (opacity 0).
let sparkCycle = new WeakMap<Inst, number>() // last dark-window index acted on, per instance
let dashCycle = new WeakMap<Inst, number>() // same, for the dashes' blink envelopes
let liveRnd: (() => number) | null = null // respawn PRNG — independent of the gen streams

function respawnSparks(now: number): void {
  if (!defs || !hosts.size || waterMode === 'off') return // sparks exist only during the load
  const hs = Array.from(hosts.values())
  const fx: Partial<Record<Group, number>> = {}
  const vw = window.innerWidth
  defs.sparks.forEach((d, i) => {
    // Blink clock (s): sparks always play full rate, epoch-anchored (see startBlink).
    const clock = (now - epochMs) / 1000 + d.delay
    // Dark-window id — increments just past each glint's opacity-0 edge (+60ms slack).
    const dark = Math.floor((clock - d.onS - 0.06) / d.period)
    const prev = sparkCycle.get(d)
    if (prev === undefined) { sparkCycle.set(d, dark); return } // first sighting — don't move
    if (dark <= prev) return
    // Only move while ACTUALLY dark: a janky frame can land mid-glint of a later cycle — wait
    // for that glint's own dark window rather than teleport a lit spark.
    const phase = ((clock % d.period) + d.period) % d.period
    if (phase < d.onS + 0.05) return
    sparkCycle.set(d, dark)
    if (!liveRnd) liveRnd = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0)
    const rnd = liveRnd
    const pos = memPick('spark', d.group, d.row, 0, () => drawSparkPos(rnd, stripW), (c) => c.cx)
    const body = sparkBody(rnd, d.group, pos.t)
    // Fold the fresh strip position into current viewport coverage (recycle's invariant: shifts
    // are multiples of stripW ≡ 0 mod 140 — wave-space identity and band-y stay true).
    let x0 = fx[d.group]
    if (x0 === undefined) {
      const f = hs.find((h) => h.sparks)?.sparks?.fields[d.group]
      x0 = f ? currentFieldX(f, d.group) : 0
      fx[d.group] = x0
    }
    let cx = pos.cx
    const sx = cx + x0
    if (sx < -PAD) cx += stripW * Math.ceil((-PAD - sx) / stripW)
    else if (sx > vw + PAD) cx -= stripW * Math.ceil((sx - vw - PAD) / stripW)
    d.x = cx - d.w / 2
    d.y = 140 * d.row + body.cy - d.h / 2
    d.day = body.day
    d.night = body.night
    // (No decode hints here — per-respawn Image().decode() of data-URI SVGs is main-thread work
    // that WEDGED the boot at high densities, 2026-07-11; the dark window rasters them in time.)
    for (const h of hs) {
      const el = h.sparks?.els[i]
      if (!el) continue
      el.style.left = `${d.x}px`
      el.style.top = `${d.y}px`
      el.style.setProperty('--twk-day', `url("${d.day}")`)
      el.style.setProperty('--twk-night', `url("${d.night}")`)
    }
  })
}

// Dashes get the same treatment (Peter, 2026-07-10: "the lines still appear predictably at the
// same places — never striking the same place twice"): after each blink ENVELOPE completes, the
// dash redraws its position + art through the never-twice memory, in the dark window between
// envelopes (invisible). Applies wherever dashes BLINK — drift ('playing', epoch clock), coast /
// scroll-twinkling ('driven', the vt clock the playbackRate driver integrates). LATCHED and
// static dashes have no live animation → no more envelopes → they rest where they are (the
// lit-at-stop texture must not shuffle). One respawn per envelope = constant population.
let respawnCursor = 0 // round-robin start index — the budget must not starve the tail
// RASTER-FREE dash cycling — EVERYWHERE (2026-07-11 rounds 4+5). History: per-envelope full-art
// respawns (2 canvas rasters + PNG encodes each) LIVELOCKED React's time-sliced editor mount, so
// round 3 boot-gated them entirely — but a fully static seeded field re-blinks each dash at ITS
// OWN spot every ~1.5s for the whole load = Peter's "the short lines are still repeating
// themselves". His guidance: full uniqueness isn't required — CYCLE the positions on a long
// rotation, like the scroll-time twinkles. The 140px-LATTICE relocation delivers that for free:
// a dash's art is a pure function of its wave-space phase (wrap140), so moving it by any multiple
// of 140px keeps the art EXACTLY valid — the respawn becomes two style writes (left/top), no
// raster, no encode. Position still draws through the never-twice memory (memPick), so the
// rotation never revisits a recent strike. Round 5 (the desktop scroll-jank ablation): the
// post-boot FULL-ART respawn path is deleted too — scroll-twinkling dashes were re-rastering
// toDataURL PNGs on the scroll path (~150ms/frame of the 417ms jank cell at 4× throttle). The
// respawn NEVER rasterises now; full art regenerates only at reseeds (zoom-settled / resize),
// which also made the boot gate moot — the lattice path is boot-safe by construction.
function respawnDashes(now: number): void {
  if (!defs || !hosts.size || blinkMode === 'static') return
  const hs = Array.from(hosts.values())
  const fx: Partial<Record<Group, number>> = {}
  const vw = window.innerWidth
  const clockBase = (blinkMode === 'playing' ? now - epochMs : vt) / 1000
  // BUDGET (2026-07-11): at ~250 dashes a bad frame could respawn dozens at once — bound the
  // per-frame work; demand is ~3/frame at 60Hz, so a budget of 4 keeps up while capping
  // worst-case frames. Deferred ones keep their dark window (the phase guard) or take the next
  // envelope — never a visible move.
  let budget = 4
  const list = defs.dashes
  const n = list.length
  for (let k = 0; k < n && budget > 0; k++) {
    const i = (respawnCursor + k) % n
    const d = list[i]
    void ((d, i) => {
    // Only while a live blink animation exists (latch/static cancel them per element).
    let live = false
    for (const h of hs) { const el = h.dashes?.els[i]; if (el && dashAnims.has(el)) { live = true; break } }
    if (!live) return
    const clock = clockBase + d.delay
    const dark = Math.floor((clock - d.onS - 0.06) / d.period)
    const prev = dashCycle.get(d)
    if (prev === undefined) { dashCycle.set(d, dark); return }
    if (dark <= prev) return
    // Respawn only while (near-)invisible: the inter-envelope dark window, or the first beat of
    // the next S-ramp (a janky frame can overshoot the short dark gap of the high-duty subset).
    const phase = ((clock % d.period) + d.period) % d.period
    if (phase < d.onS + 0.05 && phase > 0.1) return
    dashCycle.set(d, dark)
    if (!liveRnd) liveRnd = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0)
    const rnd = liveRnd
    // Raster-free 140-lattice cycling (see the header note): keep the art, move the dash to
    // another lattice slot with the same wave-space phase, via the strike memory.
    const wx = wrap140(d.x + d.w / 2)
    const cells = Math.max(1, Math.floor(stripW / 140))
    const k0 = Math.ceil((-PAD - wx) / 140)
    // Never redraw the CURRENT slot (a saturated band ring can fall back to it — the one
    // visible "same spot again" case): draw from the other cells−1 lattice slots.
    const curK = Math.round((d.x + d.w / 2 - wx) / 140) - k0
    const cx = memPick('dash', d.group, d.row, d.hw, () => {
      let k = Math.floor(rnd() * Math.max(1, cells - 1))
      if (cells > 1 && k >= ((curK % cells) + cells) % cells) k++
      return (k0 + k) * 140 + wx
    }, (c) => c)
    let nx = cx - d.w / 2
    const ny = 140 * d.row + midY(CREST[d.group], wx) + (rnd() - 0.5) * 5 - d.h / 2 // fresh jitter, same phase
    // Fold into current viewport coverage (multiples of stripW ≡ 0 mod 140 — see respawnSparks).
    let x0 = fx[d.group]
    if (x0 === undefined) {
      const f = hs.find((h) => h.dashes)?.dashes?.fields[d.group]
      x0 = f ? currentFieldX(f, d.group) : 0
      fx[d.group] = x0
    }
    const sx = nx + d.w / 2 + x0
    if (sx < -PAD) nx += stripW * Math.ceil((-PAD - sx) / stripW)
    else if (sx > vw + PAD) nx -= stripW * Math.ceil((sx - vw - PAD) / stripW)
    d.x = nx
    d.y = ny
    for (const h of hs) {
      const el = h.dashes?.els[i]
      if (!el) continue
      el.style.left = `${d.x}px`
      el.style.top = `${d.y}px`
    }
    budget--
    })(d, i)
  }
  respawnCursor = (respawnCursor + 1) % Math.max(1, n)
}

// ─── Viewport liveliness cap (2026-07-10, Peter's scroll-lag regression + density bump) ──────
// Only dashes whose screen position is inside the viewport (+100px margin) carry a LIVE blink
// animation; offscreen ones idle with no animation at all (fewer compositor layers, fewer rate
// writes). Phase never suffers: startBlink/startDrivenBlink re-derive the exact phase from the
// epoch/vt clocks, so a dash scrolled back in blinks as if it had never stopped. The 100px
// margin exceeds the recycle travel gate (40px), so a dash is re-armed before it can be seen.
// Latched (lit-at-stop) dashes are never re-armed within their generation.
function syncDashLiveliness(): void {
  if (!defs || !hosts.size || blinkMode === 'static') return
  const vw = window.innerWidth
  const hs = Array.from(hosts.values())
  const fx: Partial<Record<Group, number>> = {}
  for (const g of ['a', 'b'] as Group[]) {
    const f = hs.find((h) => h.dashes)?.dashes?.fields[g]
    if (f) fx[g] = currentFieldX(f, g)
  }
  defs.dashes.forEach((d, i) => {
    const x0 = fx[d.group]
    if (x0 === undefined) return
    const sx = d.x + x0
    const visible = sx > -100 - d.w && sx < vw + 100
    for (const h of hs) {
      const el = h.dashes?.els[i]
      if (!el || !el.isConnected) continue
      const has = dashAnims.has(el)
      if (visible && !has && latchMap.get(el) !== latchGen) {
        dashAnims.set(el, blinkMode === 'playing' ? startBlink(el, d) : startDrivenBlink(el, d))
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
    for (const el of h.dashes?.els ?? []) {
      dashAnims.get(el)?.cancel()
      dashAnims.delete(el)
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
  elDef.set(el, d)
  return el
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

function genList(rnd: () => number, kind: 'sparks' | 'dashes'): Inst[] {
  const vh = Math.max(window.innerHeight, window.screen?.height ?? 0) // lvh-stable row coverage
  const rows = Math.ceil(vh / 140) + 1
  const out: Inst[] = []
  const per = kind === 'dashes' ? DASH_ROW_PX : SPARK_ROW_PX
  for (let r = 0; r < rows; r++) {
    for (const g of ['a', 'b'] as Group[]) {
      const n = Math.floor(stripW / per + rnd()) // stochastic rounding — rows differ
      for (let i = 0; i < n; i++) out.push(kind === 'dashes' ? genDash(rnd, g, r, stripW) : genSpark(rnd, g, r, stripW))
    }
  }
  return out
}

function generate(): void {
  stripW = Math.ceil((window.innerWidth + 2 * PAD) / 140) * 140 // ≡ 0 (mod 140) — the recycle invariant
  const rnd = mulberry32(Date.now() >>> 0)
  defs = { sparks: genList(rnd, 'sparks'), dashes: genList(rnd, 'dashes') }
}

function buildSet(setCls: string, list: Inst[]): SetNodes {
  const set = document.createElement('div')
  set.className = `iw-twk-set ${setCls}`
  const fields: Record<Group, HTMLElement> = { a: document.createElement('div'), b: document.createElement('div') }
  for (const g of ['a', 'b'] as Group[]) {
    fields[g].className = 'iw-twk-field'
    set.appendChild(fields[g])
  }
  const els = list.map((d) => {
    const el = instEl(d)
    fields[d.group].appendChild(el)
    return el
  })
  return { set, fields, els }
}

function armBlinks(nodes: SetNodes, kind: 'sparks' | 'dashes'): void {
  for (const el of nodes.els) {
    const d = elDef.get(el)
    if (!d) continue
    if (kind === 'sparks') {
      startBlink(el, d) // sparks always play full rate — they die with the coast fade
    } else if (blinkMode === 'playing') {
      dashAnims.set(el, startBlink(el, d))
    } else if (blinkMode === 'driven') {
      dashAnims.set(el, startDrivenBlink(el, d))
    } // static: no animation — opacity is var(--twk-static)
  }
}

function disarmDashes(nodes: SetNodes): void {
  for (const el of nodes.els) {
    dashAnims.get(el)?.cancel()
    dashAnims.delete(el)
  }
}

function mountSet(host: HTMLElement, h: HostState, kind: 'sparks' | 'dashes'): void {
  const token = ++h.tok[kind]
  const list = kind === 'sparks' ? defs!.sparks : defs!.dashes
  void decodeAll(list).then(() => {
    if (h.tok[kind] !== token || h[kind] || !host.isConnected || !defs) return
    const current = kind === 'sparks' ? defs.sparks : defs.dashes
    if (current !== list) return // regenerated while decoding — the newer mount wins
    // Re-resolve the clock: the epoch ANIMATION may not have existed at generate() time (the
    // atomic-water gate keeps the wave pseudos display:none until the tiles decode, and
    // animations don't exist while un-displayed). Idempotent once it's the real startTime.
    if (waterMode === 'anim') epochMs = resolveEpoch()
    const nodes = buildSet(kind === 'sparks' ? 'iw-twk-sparks' : 'iw-twk-dashes', list)
    const surface = host.parentElement
    for (const g of ['a', 'b'] as Group[]) applyFieldMode(nodes.fields[g], g, waterMode, surface)
    armBlinks(nodes, kind)
    host.appendChild(nodes.set)
    h[kind] = nodes
    ensureDriver() // owns recycling too, so it runs from first mount
    // IMMEDIATE recycle (2026-07-11): a host mounting minutes into a session gets a field whose
    // drift ramp is already thousands of px along (startTime = the boot epoch), so every shared
    // instance sits far offscreen until the next 500ms recycle tick — a dashless open. Sweep now.
    lastRecycleFx = {}
    lastRecycle = performance.now()
    recycle()
    maybeAnnounceReady(h)
  })
}

// ─── Atomic-water participation (2026-07-10, Peter: "they need to start atomically") ─────────
// The .iw-water-ready gate (entry.client) now waits for the twinkle field too: once a host has
// BOTH sets generated + decoded + in the DOM (hidden — the not-ready CSS keeps .iw-wave-twinkles
// display:none), announce readiness. The window flag covers the race where the gate's listener
// attaches after we fired (entry.client checks it first).
let announced = false
function maybeAnnounceReady(h: HostState): void {
  if (announced || !h.sparks || !h.dashes) return
  announced = true
  ;(window as unknown as { __iwTwinklesReady?: boolean }).__iwTwinklesReady = true
  window.dispatchEvent(new Event('inkwave:twinkles-ready'))
}

// The gate just opened: THIS style recalc creates the wave pseudos' CSS drift animations (they
// cannot exist while the not-ready CSS holds the water display:none), so every clock resolved
// before now — Scroll's published __iwWaveEpoch and our provisional epochMs — is stale: the real
// drift starts NOW. Adopt the drift animation's literal startTime (its ready promise resolves
// inside the frame that first renders it, BEFORE that frame paints — so the re-anchor lands in
// the same paint as the reveal) and re-anchor every field + blink animation: tiles and twinkles
// share one clock from the first visible frame, with zero drift/blink discontinuity after it.
function onWaterReady(): void {
  if (waterMode !== 'anim') return // gate reopening never coincides with coast/rest choreography
  const surface = document.querySelector('.inkwave-editor-surface.iw-wave-anim')
  if (!surface) return
  let drift: Animation | undefined
  try {
    drift = surface.getAnimations({ subtree: true }) // forces style — the animations exist after this
      .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
  } catch { return }
  if (!drift) return
  const anchor = (start: number, anim?: Animation) => {
    if (waterMode !== 'anim') return
    // Republish the shared clock — Scroll's hydration-time publisher ran while the pseudos were
    // display-gated (no animations) and recorded a too-early performance.now(); later surfaces
    // and twinkle mounts must sync to the REAL drift.
    const w = window as unknown as { __iwWaveEpoch?: number; __iwWaveEpochAnim?: Animation }
    w.__iwWaveEpoch = start
    if (anim) w.__iwWaveEpochAnim = anim
    epochMs = start
    // Re-anchor EVERY surface's tile drift too (2026-07-10, Peter's phone "style change at the
    // slowdown"): a surface that mounted while the water was display-gated synced its drift to
    // the STALE pre-gate epoch and nothing ever corrected it — its wave copy ran ~first-paint-
    // latency (3-21px) out of phase with the shell's, and wherever both copies paint the lines
    // rendered visibly smeared/dimmer (measured: line peak 223 with both vs 242 with one). The
    // load choreography's shell↔editor seamlessness REQUIRES every copy clock-identical.
    for (const s of document.querySelectorAll('.inkwave-editor-surface')) {
      try {
        for (const a of s.getAnimations({ subtree: true })) {
          const n = (a as CSSAnimation).animationName ?? ''
          if (n === 'iw-wave-drift-l' || n === 'iw-wave-drift-r') {
            try { a.startTime = start } catch { /* pending/detached — ready-resolve re-anchors */ }
          }
        }
      } catch { /* getAnimations unavailable */ }
    }
    sparkCycle = new WeakMap() // dark-window indices were computed against the previous epoch
    dashCycle = new WeakMap()
    for (const h of hosts.values()) {
      for (const kind of ['sparks', 'dashes'] as const) {
        const nodes = h[kind]
        if (!nodes) continue
        for (const g of ['a', 'b'] as Group[]) {
          const a = fieldAnim.get(nodes.fields[g])
          if (a && fieldMode.get(nodes.fields[g]) === 'anim') a.startTime = epochMs
        }
        if (kind === 'dashes' && blinkMode !== 'playing') continue // driven/static are vt-based
        for (const el of nodes.els) {
          const d = elDef.get(el)
          const a = d && blinkAnim.get(el)
          if (a) a.startTime = epochMs - d!.delay * 1000
        }
      }
    }
  }
  if (typeof drift.startTime === 'number') anchor(drift.startTime, drift)
  else {
    // Play-pending: the drift's startTime resolves only once the compositor acks a commit (~a
    // frame in Firefox; ~100ms measured on a busy Chromium boot) and its pseudos RENDER AT 0
    // until then. So anchor to "now" — not the stale mount-time epoch (measured −12.4px) — and
    // keep the FIELDS pinned to "now" while it stays pending, adopting the literal startTime
    // the moment ready resolves. Exact after.
    //
    // The pending tick is LIGHT (2026-07-11 — Chromium's slow-boot livelock, CPU-profiled): the
    // old tick ran the FULL anchor every frame — getAnimations(subtree) forced style on every
    // surface and startTime writes hit all ~250 dash blink animations — and each mutation batch
    // re-dirtied the compositor sync that the pending start was itself waiting on: the ack could
    // starve for SECONDS ("(program)" 12.7s in the profile) while storage promises and the
    // editor mount sat behind the flood. Firefox resolves starts without the ack, hence the
    // engine asymmetry. Per pending frame we now touch ONLY the epoch vars + the four field
    // transforms (direct references — no style forcing, no blink loop); blink phase runs off the
    // provisional epoch until the one exact full anchor at ready-resolve (random phases — the
    // interim error is imperceptible, and dash/spark respawn cycles reset there as before).
    anchor(performance.now())
    const anchorLight = (start: number) => {
      const w = window as unknown as { __iwWaveEpoch?: number }
      w.__iwWaveEpoch = start
      epochMs = start
      for (const h of hosts.values()) {
        for (const kind of ['sparks', 'dashes'] as const) {
          const nodes = h[kind]
          if (!nodes) continue
          for (const g of ['a', 'b'] as Group[]) {
            const a = fieldAnim.get(nodes.fields[g])
            if (a && fieldMode.get(nodes.fields[g]) === 'anim') a.startTime = start
          }
        }
      }
    }
    const tick = () => {
      if (typeof drift!.startTime === 'number' || waterMode !== 'anim') return
      anchorLight(performance.now())
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    void drift.ready
      .then(() => { if (typeof drift!.startTime === 'number') anchor(drift!.startTime as number, drift) })
      .catch(() => { /* cancelled — a mode change owns the field now */ })
  }
}

function remount(host: HTMLElement, h: HostState, kind: 'sparks' | 'dashes'): void {
  const old = h[kind]
  if (old) {
    if (kind === 'dashes') disarmDashes(old)
    old.set.remove()
    h[kind] = undefined
  }
  mountSet(host, h, kind)
}

// Dashes recalculate on zoom settle (positions, art, schedules AND the static subset).
function regenDashes(): void {
  if (!defs || !hosts.size) return
  pruneHosts()
  // PHONE zoom-settle lag (2026-07-11): at rest no phone surface mounts dashes (waves exist only
  // during load — Scroll passes dashes: !phone || waveMode !== 'off'), yet genList rasterised a
  // full viewport of fresh dash art (2 canvas PNG encodes per dash) on EVERY pinch settle — pure
  // main-thread waste at the exact moment the fingers lift. Regenerate only when some host is
  // actually showing dashes; desktop (always-mounted water) is unchanged.
  let mounted = false
  for (const h of hosts.values()) if (h.dashes) { mounted = true; break }
  if (!mounted) return
  const rnd = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0)
  defs.dashes = genList(rnd, 'dashes')
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

// ─── Public API ───────────────────────────────────────────────────────────────────────────────
// Called from a LAYOUT effect on every waveMode change (pre-paint, so the coast start / rest
// handoff land in the same flush as the surface's wave class swap — no flash frame).
export function syncTwinkles(
  host: HTMLElement,
  want: { sparks: boolean; dashes: boolean; mode: Mode; phone: boolean; coastStart?: number; coastDist?: number },
): void {
  if (!defs) {
    epochMs = resolveEpoch()
    generate()
  }
  if (!listening) {
    listening = true
    // (The old bootDone respawn gate is GONE — round 5: dash respawns never rasterise anywhere,
    // so the lattice cycling is boot-safe by construction and needs no per-load re-arm.)
    window.addEventListener('inkwave:water-ready', onWaterReady)
    window.addEventListener('inkwave:zoom-settled', regenDashes)
    let rt: ReturnType<typeof setTimeout> | undefined
    window.addEventListener('resize', () => {
      if (rt) clearTimeout(rt)
      rt = setTimeout(regenAll, 300) // strip/row counts change with the viewport
    })
  }
  pruneHosts()
  let h = hosts.get(host)
  if (!h) { h = { tok: { sparks: 0, dashes: 0 } }; hosts.set(host, h) }

  // Global mode transition (every surface flips in the same event dispatch).
  const prev = waterMode
  waterMode = want.mode
  if (want.mode === 'anim' && prev !== 'anim') {
    // Re-open choreography: a NEW load drifts again — fresh coast/handoff state, and the dashes
    // return to full-rate compositor blinks.
    coast = null
    restRebase = null
    if (blinkMode !== 'playing') {
      blinkMode = 'playing'
      for (const a of dashAnims.values()) a.cancel()
      dashAnims.clear()
      latchGen++ // the lit-at-stop set belongs to the finished load — a fresh drift re-arms all
      syncDashLiveliness() // viewport-capped full-rate blinks
    }
  }
  if (want.mode === 'coast' && prev !== 'coast' && (!coast || performance.now() - coast.start > coast.T)) {
    // (The staleness check heals an ABANDONED coast — a veil unmounted mid-coast leaves
    // waterMode 'coast' with no finish; the next load must not adopt its dead clock.)
    // Coast clock: the caller passes the tiles' freeze/adopt moment (Scroll.tsx coastT0) so the
    // field coast and the tile coast start from one number; on the additive path Scroll's clock
    // resolve retimes both to the actual first painted frame (retimeCoast).
    const start = want.coastStart ?? performance.now()
    // T/dist must mirror the tiles' coast exactly (CSS: 2s/48px phone, 2.5s/60px desktop — the
    // old 3s/72px here left desktop fields ending 12px off their crests). want.coastDist carries
    // the tiles' device-pixel-SNAPPED travel (Scroll.tsx rounds the coast end to a device pixel
    // so the resting texture is texel-exact); the fields must travel the same snapped distance
    // or they end ≤1 device px off their crests at rest.
    coast = { start, T: want.phone ? 2000 : 2500, dist: want.coastDist ?? (want.phone ? 48 : 60) }
    lastCoast = coast
    restRebase = null // the coming handoff freezes a fresh constant
    if (blinkMode === 'playing') {
      vt = start - epochMs // seamless: the playing clock IS (now − epoch) + delay
      blinkMode = 'driven'
    }
    ensureDriver()
  }

  // Field transforms for the (possibly new) mode — every host, pre-paint.
  for (const [hostEl, hs] of hosts) {
    const surface = hostEl.parentElement
    for (const nodes of [hs.sparks, hs.dashes]) {
      if (!nodes) continue
      for (const g of ['a', 'b'] as Group[]) applyFieldMode(nodes.fields[g], g, waterMode, surface)
    }
  }

  // Mount / remove the requested sets on THIS host.
  if (want.sparks && !h.sparks) mountSet(host, h, 'sparks')
  else if (!want.sparks && h.sparks) { h.sparks.set.remove(); h.sparks = undefined; h.tok.sparks++ }
  if (want.dashes && !h.dashes) mountSet(host, h, 'dashes')
  else if (!want.dashes && h.dashes) { disarmDashes(h.dashes); h.dashes.set.remove(); h.dashes = undefined; h.tok.dashes++ }
}

// COAST CLOCK RESOLVE (2026-07-11, additive coast — see Scroll.tsx): the tiles' coast start
// resolves at their first painted frame; Scroll stamps the load's effective t0 + the device-
// pixel-snapped travel and calls this so the twinkle fields ride the SAME clock. Each coasting
// field's additive animation gets the resolved startTime (it was created pending in the same
// commit, so this is a ≤1-frame alignment, not a restart) and its keyframes are re-derived for
// the snapped distance (≤0.5 device px — invisible).
export function retimeCoast(start: number, dist: number): void {
  if (waterMode !== 'coast' || !coast) return
  coast = { start, T: coast.T, dist, resolved: true }
  lastCoast = coast
  for (const h of hosts.values()) {
    for (const kind of ['sparks', 'dashes'] as const) {
      const nodes = h[kind]
      if (!nodes) continue
      for (const g of ['a', 'b'] as Group[]) {
        const f = nodes.fields[g]
        if (fieldMode.get(f) !== 'coast') continue
        const a = fieldAdd.get(f)
        if (!a) continue
        try {
          const dir = g === 'a' ? -1 : 1
          ;(a.effect as KeyframeEffect | null)?.setKeyframes(addCoastFrames(dir, coast))
          a.startTime = start
        } catch { /* keep the natural-start animation — continuous either way */ }
      }
    }
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
  // SUSTAINED-SCROLL WAKE (desktop typing lag, 2026-07-11): a caret-reveal scroll — typing at
  // the bottom of the page nudges scrollTop once per wrapped line — is a SINGLE discrete scroll
  // event, but its one-frame delta reads as a huge velocity (20px/16ms ≈ full rate) and woke the
  // whole dash field from park: WAAPI restarts for every dash, driver frames until the rate
  // decayed, and a getComputedStyle sweep at re-park — per line wrap, while typing. Waking from
  // PARK now needs TWO scroll frames within 200ms (a real scroll produces dozens; the second
  // frame wakes ~16ms late — imperceptible). An already-running driver is untouched.
  if (blinkMode === 'static' && !driver) {
    const prev = swayPrimeTs
    swayPrimeTs = now
    if (now - prev > 200) return // isolated report — prime only, stay parked
  }
  wakeFromStatic()
  ensureDriver()
}
