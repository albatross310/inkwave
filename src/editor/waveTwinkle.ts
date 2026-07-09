// ─── Wave twinkles — stochastic sparkles + accent dashes over the wave field ────────────────
// Owns the seeded PRNG, the per-layer SVG tile generation (day + night variants) and the injected
// per-layer keyframe stylesheet. Scroll.tsx renders a stable empty container (.iw-wave-twinkles —
// present in the prerender, so hydration always matches) and calls syncTwinkles() from a
// post-hydration effect; every layer node lives OUTSIDE React. Two layer families:
//
//   • SPARKLES — brief (~0.1s) yellow glints riding the thick-line crests. Alive only while the
//     load drift/coast runs; a few layers sit out each load entirely; the whole set S-fades over
//     --wave-coast-T via its sub-container's opacity (parent × child opacity MULTIPLIES, so the
//     blink keyframes keep glinting through the die-off).
//   • ACCENT DASHES — short strokes halfway between each thick/thin wave pair, present at ALL
//     stages (drift, coast, and the resting --wave-x scroll sway). ~50% are lit at any instant,
//     each twinkling ~0.4s on, and the set reseeds on 'inkwave:zoom-settled' (cheap: swap the
//     four nodes' background-image vars + rewrite one tiny <style> — no layout, no node churn).
//
// GEOMETRY. Every thick wave line is Q(0,c)(35,c−18)(70,c) then the T-mirrored trough. x(t)=70t
// is LINEAR in t, so the crest arc is y(t) = c − 36·t(1−t): peak c−9 at t=½, inflections y=c at
// t=0,1 (c=22 for tile a, 92 for tile b; the thin line is the same shape +28px). The sparkle
// band is the lens between the crest arc and its inflection chord y=c; dashes ride the PAIR
// MIDLINE — the shape +14px — on either the crest or trough half (±jitter).
//
// TILE-EDGE TRICK. Art is drawn near the CENTRE of its 140px tile (never clipped by the tile
// edge) and the layer's random wave-coordinate is realised as a background-position-x offset
// (--twk-dx): screen position = waveCoord because tileX + dx ≡ waveCoord (mod 140). Layers are
// 140×140 tiles (the wave loop), so each layer's art repeats with its wave row; the aperiodic
// feel comes from several overlaid layers, each with its own in-band art, offset, period, phase.
//
// PERF. Every generated data-URI is Image().decode()d BEFORE its node mounts, so a twinkle can
// never hitch on a lazy first raster (the 2026-07-09 load-jump lesson). Animations are
// opacity/transform only — all compositor. Day AND night URIs ride each node as CSS vars
// (--twk-day/--twk-night); index.css picks per theme, so a theme flip needs no regeneration.

// ─── Colour knobs (one const each, per Peter's spec) ─────────────────────────────────────────
export const SPARK_COLOR = '#ffe14d' // sparkle strokes/satellites (day)
export const SPARK_CORE = '#fffbe0' // sparkle centre dot (day)
export const SPARK_COLOR_NIGHT = '#ffe14d' // night sparkles stay yellow (no objection recorded)
export const SPARK_CORE_NIGHT = '#fffbe0'
export const DASH_COLOR = '#FFF5EE' // seashell — matches the day wave strokes
export const DASH_COLOR_NIGHT = '#9aa3af' // grey family — matches the night wave art

// ─── Field tuning ─────────────────────────────────────────────────────────────────────────────
const SPARK_LAYERS = 7 // generated per load…
const SPARK_SKIP_CHANCE = 0.28 // …each with this chance of sitting the whole load out
const SPARK_ON_S = 0.1 // a glint: ~0.1s lit
const SPARK_PERIOD: [number, number] = [0.9, 2.0] // s between glints, per layer
const DASH_LAYERS = 4 // 2 riding wave layer A + 2 riding B; 2 dashes per tile
const DASH_ON: [number, number] = [0.35, 0.45] // s lit per twinkle
const DASH_DUTY: [number, number] = [0.42, 0.58] // fraction of time lit ⇒ ~50% of dashes ON

const CREST = { a: 22, b: 92 } // thick-line inflection y per tile
type Group = 'a' | 'b'

interface Layer {
  cls: string // per-layer class; its blink keyframes/delays live in the injected stylesheet
  group: Group // which wave layer it rides: drift direction + sway sign
  day: string // data-URI tile (day palette)
  night: string
  dx: number // tile x-offset (px) — realises the random wave coordinate
  period: number // blink period (s)
  delay: number // blink phase (s, subtracted — randomised onset)
  onS: number // lit time per period (s)
}

// ─── PRNG — mulberry32 (tiny, seedable; seed = Date.now(), app code so that's fine) ──────────
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

const f1 = (n: number) => String(Math.round(n * 10) / 10)
const svgUri = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>${body}</svg>`)}`

// Crest arc of a thick line: y at parameter t (x = 70t on the crest half).
const arcY = (c: number, t: number) => c - 36 * t * (1 - t)
// Pair midline (thick+thin averaged = thick shape +14px) at any wave coordinate 0..140.
function midY(c: number, wx: number): number {
  const x = ((wx % 140) + 140) % 140
  const t = (x % 70) / 70
  const bump = 36 * t * (1 - t)
  return x < 70 ? c + 14 - bump : c + 14 + bump
}

// ─── SVG generation ───────────────────────────────────────────────────────────────────────────
// One sparkle per layer: a plus-fleck + core + 0–2 satellite dots, drawn at tile x=70 (edge-safe);
// the layer's --twk-dx = waveX − 70 places it at the sampled wave coordinate. waveX = 70t with t
// biased slightly past the crest peak (like the hand-placed art at x=46); y sits in the lens band
// between the crest arc and the inflection chord y=c.
function genSparkLayer(rnd: () => number, i: number): Layer {
  const group: Group = rnd() < 0.5 ? 'a' : 'b'
  const c = CREST[group]
  const t = Math.min(0.92, Math.max(0.12, 0.58 + (rnd() + rnd() - 1) * 0.35)) // past-peak bias
  const y = arcY(c, t) + (0.12 + 0.73 * rnd()) * (c - arcY(c, t))
  const s = 0.75 + 0.4 * rnd() // glyph scale
  const x = 70
  const parts = (col: string, core: string) => {
    let p =
      `<g stroke='${col}' stroke-width='${f1(1.6 * s)}' stroke-linecap='round'>` +
      `<path d='M${f1(x)} ${f1(y - 4.2 * s)} V${f1(y + 4.2 * s)}'/>` +
      `<path d='M${f1(x - 4.2 * s)} ${f1(y)} H${f1(x + 4.2 * s)}'/></g>` +
      `<circle cx='${f1(x)}' cy='${f1(y)}' r='${f1(1.4 * s)}' fill='${core}'/>`
    const sats = rnd() < 0.35 ? 2 : 1
    for (let k = 0; k < sats; k++) {
      const offX = (rnd() < 0.5 ? -1 : 1) * (3 + 5 * rnd())
      const ts = Math.min(0.98, Math.max(0.02, t + offX / 70))
      const ys = arcY(c, ts) + (0.2 + 0.7 * rnd()) * (c - arcY(c, ts))
      p += `<circle cx='${f1(x + offX)}' cy='${f1(ys)}' r='${f1(0.9 + 0.4 * rnd())}' fill='${col}' fill-opacity='${f1(0.55 + 0.35 * rnd())}'/>`
    }
    return p
  }
  // ONE consumption of rnd for both palettes: generate the day body, then substitute colours.
  const day = parts(SPARK_COLOR, SPARK_CORE)
  const night = day.split(SPARK_COLOR).join(SPARK_COLOR_NIGHT).split(SPARK_CORE).join(SPARK_CORE_NIGHT)
  const period = SPARK_PERIOD[0] + (SPARK_PERIOD[1] - SPARK_PERIOD[0]) * rnd()
  return {
    cls: `iw-twk-ls${i}`,
    group,
    day: svgUri(day),
    night: svgUri(night),
    dx: Math.round(70 * t) - 70,
    period,
    delay: rnd() * period,
    onS: SPARK_ON_S,
  }
}

// Two accent dashes per layer, at tile x≈45 and x≈95 (edge-safe); each dash's wave coordinate is
// tileX + dx, and its y/shape follow the pair midline there (either half of the swell), ±jitter —
// PRNG-varied kin of the old hand-baked dashes (a: M18 29.4…, b: M88 112.8…), now dynamic.
function genDashLayer(rnd: () => number, i: number, group: Group): Layer {
  const c = CREST[group]
  const dx = Math.floor(rnd() * 140)
  // Same geometry for both palettes: sample the random numbers ONCE, then re-emit per colour.
  const spots: Array<[number, number]> = [45 + (rnd() - 0.5) * 14, 95 + (rnd() - 0.5) * 14].map(
    (tx) => [tx, 0.32 + 0.12 * rnd()] as [number, number],
  )
  const jits = spots.map(() => (rnd() - 0.5) * 5)
  const emit = (col: string, dim: number) =>
    spots
      .map(([tx, op], k) => {
        const wx = tx + dx
        const y0 = midY(c, wx) + jits[k]
        const y1 = midY(c, wx - 8.5) + jits[k]
        const y2 = midY(c, wx + 8.5) + jits[k]
        const yc = 2 * y0 - (y1 + y2) / 2 // quadratic through the three midline samples
        return `<path d='M${f1(tx - 8.5)} ${f1(y1)} Q${f1(tx)} ${f1(yc)} ${f1(tx + 8.5)} ${f1(y2)}' fill='none' stroke='${col}' stroke-opacity='${f1(op * dim)}' stroke-width='2' stroke-linecap='round'/>`
      })
      .join('')
  const onS = DASH_ON[0] + (DASH_ON[1] - DASH_ON[0]) * rnd()
  const duty = DASH_DUTY[0] + (DASH_DUTY[1] - DASH_DUTY[0]) * rnd()
  const period = onS / duty
  return {
    cls: `iw-twk-ld${i}`,
    group,
    day: svgUri(emit(DASH_COLOR, 1)),
    night: svgUri(emit(DASH_COLOR_NIGHT, 0.92)),
    dx,
    period,
    delay: rnd() * period,
    onS,
  }
}

// ─── Per-layer stylesheet ─────────────────────────────────────────────────────────────────────
// Each layer gets its own blink keyframes + three state rules. The drift/coast transforms REUSE
// the wave keyframes (iw-wave-drift-l/r, iw-wave-coast-l/r) so the art rides its wave layer in
// exact lockstep; the blink rides alongside as a second animation on the same node. Delays:
// the drift keeps var(--wave-phase) (the shared load clock); the blink subtracts the surface's
// --twk-shift (set at container mount = −elapsed-since-epoch) so every surface — the loading
// shell AND the editor's surface beneath it — shows the SAME blink phase, like the waves do.
function rulesFor(l: Layer): string {
  const pct = (s: number) => (Math.min(0.99, s / l.period) * 100).toFixed(2)
  const ramp = l.onS <= 0.15 ? 0.03 : 0.1 // glints snap; dashes ease
  const kf = `${l.cls}-b`
  const P = l.period.toFixed(3)
  const blinkDelay = `calc(var(--twk-shift, 0s) - ${l.delay.toFixed(3)}s)`
  const drift = l.group === 'a' ? 'iw-wave-drift-l' : 'iw-wave-drift-r'
  const coast = l.group === 'a' ? 'iw-wave-coast-l' : 'iw-wave-coast-r'
  return (
    `@keyframes ${kf}{0%{opacity:0}${pct(ramp)}%{opacity:1}${pct(l.onS - ramp)}%{opacity:1}${pct(l.onS)}%,100%{opacity:0}}\n` +
    // Base (resting sway) — blink only; position tracks ±--wave-x via .iw-twk-a/b.
    `.${l.cls}{animation:${kf} ${P}s linear infinite;animation-delay:${blinkDelay}}\n` +
    // Load drift — blink + the wave layer's own drift keyframes (compositor, phase-locked).
    `.inkwave-editor-surface.iw-wave-anim .${l.cls}{animation:${drift} 1.944s linear infinite,${kf} ${P}s linear infinite;animation-delay:var(--wave-phase, 0s),${blinkDelay};will-change:transform,opacity}\n` +
    // Coast — blink + the wave layer's ease-to-rest (delay 0 like the wave pseudos').
    `.inkwave-editor-surface.iw-wave-coast .${l.cls}{animation:${coast} var(--wave-coast-T, 3s) cubic-bezier(0.33333, 1, 0.66667, 1) 1 forwards,${kf} ${P}s linear infinite;animation-delay:0s,${blinkDelay};will-change:transform,opacity}`
  )
}

// ─── Module state (one shared field per page load — every surface mounts the SAME layers, so
// overlapping surfaces paint pixel-identically, exactly like the wave pseudos) ────────────────
let sparkDefs: Layer[] | null = null
let dashDefs: Layer[] | null = null
let sparkStyle: HTMLStyleElement | null = null
let dashStyle: HTMLStyleElement | null = null
let epoch = 0 // blink clock zero (first generation) — --twk-shift aligns later mounts to it
let listening = false
const tokens = new WeakMap<HTMLElement, number>()

function decodeAll(defs: Layer[]): Promise<void> {
  return Promise.all(
    defs.flatMap((l) => [l.day, l.night]).map((u) => {
      const img = new Image()
      img.src = u
      return img.decode().catch(() => {}) // decode() is a hint; failure must never block mounting
    }),
  ).then(() => {})
}

function ensureDefs(): void {
  if (sparkDefs) return
  epoch = performance.now()
  const rnd = mulberry32(Date.now() >>> 0)
  sparkDefs = []
  for (let i = 0; i < SPARK_LAYERS; i++) {
    if (rnd() < SPARK_SKIP_CHANCE) continue // this sparkle sits the load out
    sparkDefs.push(genSparkLayer(rnd, i))
  }
  dashDefs = [0, 1, 2, 3].map((i) => genDashLayer(rnd, i, i < DASH_LAYERS / 2 ? 'a' : 'b'))
  sparkStyle = document.createElement('style')
  sparkStyle.textContent = sparkDefs.map(rulesFor).join('\n')
  dashStyle = document.createElement('style')
  dashStyle.textContent = dashDefs.map(rulesFor).join('\n')
  document.head.append(sparkStyle, dashStyle)
}

function applyVars(el: HTMLElement, l: Layer): void {
  el.style.setProperty('--twk-day', `url("${l.day}")`)
  el.style.setProperty('--twk-night', `url("${l.night}")`)
  el.style.setProperty('--twk-dx', `${l.dx}px`)
}

function layerNode(l: Layer): HTMLDivElement {
  const el = document.createElement('div')
  // LITERAL class names, not `iw-twk-${l.group}`: Tailwind tree-shakes custom @layer base rules
  // by scanning source for literal tokens — the interpolated form got .iw-twk-a/.iw-twk-b PURGED
  // from the built CSS (the resting sway silently stopped tracking --wave-x).
  el.className = `iw-twk ${l.group === 'a' ? 'iw-twk-a' : 'iw-twk-b'} ${l.cls}`
  applyVars(el, l)
  return el
}

async function applySet(host: HTMLElement, token: number, setCls: string, want: boolean, defs: Layer[]): Promise<void> {
  const existing = host.querySelector(`:scope > .${setCls}`)
  if (!want) {
    existing?.remove()
    return
  }
  if (existing) return
  await decodeAll(defs) // raster-ready BEFORE first mount — a twinkle must never hitch
  if (tokens.get(host) !== token || host.querySelector(`:scope > .${setCls}`)) return
  const set = document.createElement('div')
  set.className = `iw-twk-set ${setCls}`
  set.append(...defs.map(layerNode))
  host.appendChild(set)
  // EXACT drift-clock adoption (audit probe, 2026-07-09): twinkle layers mount post-hydration with
  // delay 0, which left them ~35px BEHIND their surface's waves (flecks off the crests). Adopt the
  // epoch drift animation's literal startTime, exactly like later surfaces do in Scroll.tsx.
  const epochAnim = (window as unknown as { __iwWaveEpochAnim?: Animation }).__iwWaveEpochAnim
  if (epochAnim && typeof epochAnim.startTime === 'number') {
    try {
      for (const a of set.getAnimations({ subtree: true })) {
        if (((a as CSSAnimation).animationName ?? '').startsWith('iw-wave-drift')) a.startTime = epochAnim.startTime
      }
    } catch { /* not critical — the --twk-shift fallback still holds */ }
  }
}

// ZOOM RESEED (Peter's spec): on zoom settle the visible dash set recalculates. Same node count,
// same classes/groups — only the art, tile offsets, periods and phases change, and only after the
// fresh URIs are decoded: a background-image + var swap plus one small <style> rewrite.
function reseedDashes(): void {
  if (!dashDefs || !dashStyle || !document.querySelector('.iw-twk-dashes')) return
  const rnd = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0)
  const next = dashDefs.map((old, i) => genDashLayer(rnd, i, old.group))
  void decodeAll(next).then(() => {
    if (!dashStyle) return
    dashDefs = next
    dashStyle.textContent = next.map(rulesFor).join('\n')
    for (const set of Array.from(document.querySelectorAll('.iw-twk-dashes'))) {
      next.forEach((l, i) => {
        const node = set.children[i] as HTMLElement | undefined
        if (node) applyVars(node, l)
      })
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────────────────────
// Idempotent per (host, wants): call from an effect whenever the wave mode changes. Sparkles are
// mounted while the load animation runs and removed at rest; dashes persist on desktop (they
// decorate the resting sway too) and exist only during the load on phone (no waves at rest there).
export function syncTwinkles(host: HTMLElement, want: { sparks: boolean; dashes: boolean }): void {
  ensureDefs()
  if (!listening) {
    listening = true
    window.addEventListener('inkwave:zoom-settled', reseedDashes)
  }
  if (!host.style.getPropertyValue('--twk-shift')) {
    // Align this surface's blink phase to the shared epoch (the wave-phase trick, for opacity).
    host.style.setProperty('--twk-shift', `${((epoch - performance.now()) / 1000).toFixed(3)}s`)
  }
  const token = (tokens.get(host) ?? 0) + 1
  tokens.set(host, token)
  void applySet(host, token, 'iw-twk-sparks', want.sparks, sparkDefs!)
  void applySet(host, token, 'iw-twk-dashes', want.dashes, dashDefs!)
}
