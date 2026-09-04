// ─── Wave video (EXPERIMENTAL — localStorage `inkwave:waveVideo` = '1' | 'debug') ────────────
// A pregenerated loop of THIS water played on the hardware media pipeline, for the LOAD window
// ONLY; at rest it hands back to the CSS water, which owns scroll-time sway. The CSS/WAAPI unit
// runs HIDDEN underneath (`html.iw-wave-video-on`) and is the fallback at EVERY step.
//
// ⛔ NOTHING HERE MAY TOUCH THE DOM BEFORE HYDRATION. React owns every node, so a pre-hydration
// append is a hydration mismatch: React REPLACES the <html> element, the new one carries no
// `.iw-water-ready` and no `data-theme`, and every wave layer goes display:none FOR THE SESSION.
// Every DOM write waits behind `hydrated()`.
//
// ⚠️ EVERY EXIT MUST HAND THE WATER BACK AND RELEASE THE REVEAL — see `bail`. The fallback chain is
// otherwise SILENT (AV1 → H.264 → CSS) and CSS water looks identical, so `?waveVideo=debug` is the
// only instrument: Peter tests on an iPhone 8 with no Web Inspector (R4).
//
// iOS AUTOPLAY needs BOTH `muted` and `playsinline`, as attributes AND properties, and fails
// SILENTLY otherwise; Low Power Mode blocks it outright ('autoplay-blocked').
// → docs/archive/editor-surface.md#wave-video

// ─── THE LADDER: CROP, NEVER RESIZE ──────────────────────────────────────────────────────────────
// ⚠️ THE WAVE TILE MUST BE 140 CSS px AT EVERY VIEWPORT — that congruence IS the hand-off to the CSS
// water. So the trio is: clip encoded at (design CSS × dsf) + element sized to the design CSS box +
// `object-fit: fill`, and the VIEWPORT crops the overflow. `cover` scaled the tile to 122.5–157.5px
// against the CSS water's unwavering 140; `object-fit: none` would render a dsf:2 clip 2× too big.
// A design box must COVER the viewport or there is nothing to crop from — past `wide`, pickRung
// returns null and the CSS water plays, which is the honest answer rather than a stretched clip.
// → docs/archive/editor-surface.md#wave-ladder
type Rung = {
  name: string
  cssW: number; cssH: number   // the DESIGN CSS box — the element's literal size
  dsf: number                  // clip pixels per CSS px (clip is cssW*dsf × cssH*dsf)
  coarse: boolean              // touch rung? (never offered to a mouse, and vice versa)
}
// Every rung must stay inside H.264 Level 4.0 (~2.1 Mpx) unless it is desktop-only — that pin is
// what keeps an iPhone able to decode it at all.
const RUNGS: readonly Rung[] = [
  // Covers every phone CSS viewport in portrait; 880×1912 = 1.68 Mpx, inside Level 4.0.
  { name: 'phone', cssW: 440, cssH: 956, dsf: 2, coarse: true },
  // FULL HD, Peter's word. 2.07 Mpx, still inside Level 4.0.
  { name: 'desk', cssW: 1920, cssH: 1080, dsf: 1, coarse: false },
  // The crop headroom a 2560-wide desktop needs. Desktop-only ⇒ Level 5.1 is safe here.
  { name: 'wide', cssW: 2560, cssH: 1440, dsf: 1, coarse: false },
]

// ── On-device diagnostic state (rendered by the overlay under ?waveVideo=debug) ──
type Diag = {
  flag: string; codec: string; rung: string; theme: string; clip: string
  fetch: string; ready: number; advancing: boolean; master: boolean; reason: string
  viewport: string; loop: string
}
const diag: Diag = { flag: '?', codec: '?', rung: '?', theme: '?', clip: '—', fetch: '—', ready: -1, advancing: false, master: false, reason: 'starting…', viewport: '?', loop: 'not started' }
// ⚠ EVERY exit runs through here, which is what makes the two gates below safe to wait on: a bail
// ALWAYS hands the water back (drop the white wait → CSS water) and ALWAYS releases the reveal, or
// a failed decode leaves Peter on a white screen with no document.
const bail = (reason: string) => {
  diag.reason = reason; diag.master = false
  endWait()
  releaseLoop(`released by a bail — no video (${reason.slice(0, 40)})`)
}
// PROBE SEAM (same contract as `window.__iwTwkPool`): probes read THIS object, never the overlay's
// rendered HTML — that is a formatted string for a phone camera, and parsing it measures the
// formatting. `masterEver` is the durable fact a short sample can otherwise miss entirely (R6).
// → docs/archive/editor-surface.md#wave-white-wait
let masterEver = false
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__iwWaveVideo', {
    configurable: true,
    get: () => ({ ...diag, masterEver }),
  })
}

function flagValue(): string {
  try { return localStorage.getItem('inkwave:waveVideo') ?? '(unset)' } catch { return '(no-storage)' }
}

// ─── THE DELIBERATE DELAY: the reveal waits for one whole loop ───────────────────────────────────
// THE BOUNDARY IS THE VIDEO'S OWN CLOCK WRAPPING, never a timer — a timer is a guess about a decode
// we do not control, and on a busy load it releases mid-loop.
// ⚠️ ALWAYS ARRIVES, AND IS ASKABLE (this module has been bitten by the one-shot-async-signal twice):
// every exit fires it — bail, decode timeout, autoplay refusal, the wrap, the settle, the cap — and
// a late reader asks `__iwWaveVideoLoopDone` rather than waiting for an event already in the past.
// TiptapEditor's reader carries its own cap for the case where this module never loads at all.
// → docs/archive/editor-surface.md#wave-loop-gate
let loopDone = false
function releaseLoop(why: string): void {
  if (loopDone) return
  loopDone = true
  diag.loop = why
  ;(window as unknown as { __iwWaveVideoLoopDone?: boolean }).__iwWaveVideoLoopDone = true
  window.dispatchEvent(new Event('inkwave:wave-video-loop'))
}

// Watch for the wrap: rVFC where it exists (it ticks with the DECODER), else a 40ms poll of the
// same fact — the poll is what `wireSettle` already uses for this identical boundary (R2).
// The cap is not the timer sneaking back in as the release mechanism: a stalled media element must
// not hold the document hostage, and it NAMES itself in `diag.loop` so it cannot read as a real one.
function releaseAtLoopPoint(video: HTMLVideoElement): void {
  const start = video.currentTime
  let last = start
  const cap = setTimeout(() => releaseLoop(`CAPPED at 6s — no wrap seen (currentTime ${video.currentTime.toFixed(2)})`), 6000)
  const seen = () => {
    if (loopDone) return
    const now = video.currentTime
    // The wrap: the clock ran backwards. The second arm covers `start` being mid-clip — a full
    // duration's worth of advance is also one whole loop.
    if (now < last - 0.01 || (video.duration > 0 && now - start >= video.duration - 0.05)) {
      clearTimeout(cap)
      releaseLoop(`one full loop played (wrapped at ${last.toFixed(2)}s)`)
      return
    }
    last = now
    schedule()
  }
  type RVFC = { requestVideoFrameCallback?: (cb: () => void) => number }
  const schedule = () => {
    const rv = (video as unknown as RVFC).requestVideoFrameCallback
    if (typeof rv === 'function') rv.call(video, seen)
    else setTimeout(seen, 40)
  }
  schedule()
}

// ─── BLANK WHITE UNTIL THE VIDEO COMES UP ────────────────────────────────────────────────────────
// `html.iw-wave-video-wait` whites the surface so a load never shows a frame of CSS water the video
// is about to replace. A CLASS on <html> set by entry.client, never a node append (see the ⛔ rule).
// ⚠ IT MUST NEVER BE PERMANENT: every exit clears it — the master hand-off swaps it for
// `.iw-wave-video-on`, every bail drops it, and entry.client carries an independent timeout for the
// case where this module never loads. → docs/archive/editor-surface.md#wave-white-wait
function endWait(): void { document.documentElement.classList.remove('iw-wave-video-wait') }

// AV1 first (av01, ~1/4 the bytes), then H.264 (avc1 — iPhone 8 / A11 have NO AV1). Both in mp4.
function pickCodec(): 'av1' | 'h264' | null {
  const probe = document.createElement('video')
  if (probe.canPlayType('video/mp4; codecs="av01.0.05M.08"')) return 'av1'
  const h = probe.canPlayType('video/mp4; codecs="avc1.640028"')
  if (h === 'probably' || h === 'maybe') return 'h264'
  return null
}


// ─── pickRung — the app detects the device; Peter never tells us his resolution ───────────────────
// ⚠️ THE SMALLEST rung of the right device class whose design box COVERS the viewport in both axes;
// nothing covers it ⇒ null ⇒ CSS water. It must NEVER return a rung that has to be stretched —
// that is the bug the ladder exists to fix, and reintroducing it is worse than not playing.
// THE DEVICE CLASS IS A HARD PARTITION: `phone` is a picture of the app under PHONE CSS, so a
// coarse device is never offered a desk clip even where `desk` would cover it (a landscape iPad).
// `coarse` IS A PARAMETER, not a matchMedia read (R5 — under vitest's node environment an internal
// read returns false for every case, making the whole touch half of the suite a silent copy of the
// desktop half). DPR is detected and REPORTED but does not SELECT: it could only choose between two
// rungs of one class differing in `dsf`, and this ladder has no such pair. Add one and this gains
// the argument. → docs/archive/editor-surface.md#wave-rungs
export function pickRung(vw: number, vh: number, coarse: boolean): Rung | null {
  const fits = RUNGS.filter((r) => r.coarse === coarse && r.cssW >= vw && r.cssH >= vh)
  if (!fits.length) return null
  // Smallest by AREA rather than by ladder order, so a future rung cannot be mis-ranked by where
  // someone happened to paste it.
  return fits.slice().sort((a, b) => a.cssW * a.cssH - b.cssW * b.cssH)[0]
}

// The dpi the chosen rung delivers, for the overlay. `1` = one clip pixel per device pixel.
// Reported, never enforced.
function dpiRatio(r: Rung, dpr: number): number { return r.dsf / dpr }

let started = false

// ⚠️ THE HYDRATION BARRIER (the ⛔ rule in the header). ONLY EVER WAIT ON A SIGNAL THAT ALWAYS
// ARRIVES, AND MAKE IT ASKABLE: `inkwave:hydrated` fires from a post-commit effect on EVERY load,
// and `__iwHydrated` covers the already-fired race — so ask and subscribe in ONE synchronous block.
// NOT `inkwave:twinkles-ready` (the pool announces only if both its sets generate, so a load whose
// pool never announced hung the video forever — correctness must not depend on another feature
// succeeding) and NOT `.iw-water-ready` (its 1500ms timeout can open BEFORE hydration on exactly
// the slow device this is for). → docs/archive/editor-surface.md#wave-hydration
function hydrated(): Promise<void> {
  const w = window as unknown as { __iwHydrated?: boolean }
  if (w.__iwHydrated) return Promise.resolve()
  return new Promise<void>((res) => window.addEventListener('inkwave:hydrated', () => res(), { once: true }))
}

// Called from entry.client's gate (flag-gated). Resolves when the loop's first frame is decoded
// (or we give up → CSS water). NOT a gate condition — entry.client `void`s this (awaiting it would
// deadlock: we wait for hydration, which the gate's own conditions precede).
export function prepareWaveVideo(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  diag.flag = flagValue()
  // Choose the clip and START THE DOWNLOAD IN FRONT OF THE BARRIER: a codec query and a fetch touch
  // NO DOM, so they are safe pre-hydration, and only the ATTACH has to wait. Moving the fetch behind
  // it too cost the video its whole decode budget on Peter's A11.
  const clip = planClip()
  if (!clip) return Promise.resolve()
  warmBytes(clip.loopUrl) // fire-and-forget: SW-cached, so the <video>'s Range probes hit memory
  diag.reason = 'waiting for hydration…'
  return new Promise<void>((resolve) => {
    void hydrated()
      .then(() => {
        // The overlay appends to <body> — a DOM write, so it waits behind the barrier too; with
        // `=debug` it broke hydration all by itself.
        if (diag.flag === 'debug') mountOverlay()
        return run(clip)
      })
      .then(() => resolve())
      .catch((e) => { bail(`crashed: ${String(e).slice(0, 60)}`); resolve() })
  })
}

type Clip = { loopUrl: string; brakeUrl: string; rung: Rung }

// DOM-FREE. Everything here is a capability query or a string.
function planClip(): Clip | null {
  const codec = pickCodec()
  diag.codec = codec ?? 'NONE'
  if (!codec) { bail('no decodable codec (no av01, no avc1) → CSS water'); return null }
  // Peter never tells us his resolution — we ask the browser, every load.
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  diag.viewport = `${vw}x${vh} dpr${dpr} ${coarse ? 'coarse' : 'fine'}`
  const rung = pickRung(vw, vh, coarse)
  if (!rung) {
    bail(`viewport ${vw}x${vh} (${coarse ? 'coarse' : 'fine'}) is past the ladder → CSS water`)
    return null
  }
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'
  diag.rung = `${rung.name} ${rung.cssW}x${rung.cssH}css @dsf${rung.dsf} (dpi ${dpiRatio(rung, dpr).toFixed(2)}x)`
  diag.theme = theme
  const base = `/wave/${rung.name}.${theme}.${codec}`
  diag.clip = `${base}.mp4`
  return { loopUrl: `${base}.mp4`, brakeUrl: `${base}.brake.mp4`, rung }
}

// The warm fetch the SW's /wave/ handler was written to receive: ONE full 200 that populates the
// cache, so the video's later Range probes hit memory. FIRE-AND-FORGET — nothing may AWAIT this,
// or a stalled network becomes a stalled load.
function warmBytes(url: string): void {
  diag.fetch = 'warming bytes (pre-hydration)…'
  void fetch(url)
    .then((r) => { diag.fetch = r.ok ? `warm ${r.status} → cached` : `warm FAILED ${r.status}` })
    .catch((e) => { diag.fetch = `warm FAILED (${String(e).slice(0, 30)})` })
}
export function initWaveVideo(): void { void prepareWaveVideo() }

async function run(clip: Clip): Promise<void> {
  const { loopUrl, brakeUrl } = clip

  // ⚠ DIRECT same-origin src, NEVER a blob: iOS decodes a video only when it can Range-request the
  // moov atom, and a blob URL cannot be ranged (readyState stuck at 0). The SW serves /wave/
  // cache-first WITH 206 Range, so a direct URL is still one fetch and iOS can seek the metadata.
  const video = mkVideo(clip.rung)
  video.loop = true
  video.src = loopUrl

  // iOS loads a video only while it is IN THE DOM, so attach — invisible — before load(). We are
  // POST-HYDRATION here, so ONE plain append is enough. Become MASTER (hide the CSS water) only
  // once play() RESOLVES, so a decode/autoplay failure always leaves the CSS water visible.
  // ⚠️ ONE HOST, ONE CLOCK: `:not(.iw-wave-covered)` means exactly ONE <video> per load, and that is
  // load-bearing. Two media elements are two `currentTime`s with no shared timeline and no adopt
  // possible — the two-clock shape Scroll.tsx's startTime adoption exists to prevent, measured at
  // 43-60px of mark-vs-wave skew on the CSS side. Do not add a second video without an answer to
  // "which clock, and who slaves to it". → docs/archive/editor-surface.md#wave-one-clock
  const host = document.querySelector<HTMLElement>(
    '.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .iw-wave-twinkles',
  )
  if (!host) { bail('no water host on this page → CSS water'); return }
  guardMaster(host)
  // ⚠ `reason` MUST TRACK WHERE THIS FUNCTION ACTUALLY IS — a field nobody updates is a field that
  // lies, and a stale one sends the next reader hunting a bug that had already resolved.
  diag.reason = 'hydrated — attaching + decoding…'
  host.appendChild(video)
  video.load()

  const playable = new Promise<void>((res) => {
    if (video.readyState >= 2) res()
    else video.addEventListener('loadeddata', () => res(), { once: true })
  })
  await Promise.race([playable, new Promise<void>((r) => setTimeout(r, 2500))]) // iOS metadata is slower
  diag.ready = video.readyState
  if (video.readyState < 2) { teardown(video); bail(`decode timeout (readyState ${video.readyState} after 2.5s) → CSS water`); return }

  // Never become master before the atomic water has painted, and never veil a load that already
  // reached its coast (that would show drift over settled text). ASK, THEN SUBSCRIBE, as in
  // `hydrated()`: the class alone is unsafe to test (a hydration recovery can strip it) and the
  // event may have fired while we were decoding.
  diag.reason = 'decoded — waiting for the water gate…'
  await new Promise<void>((res) => {
    const w = window as unknown as { __iwWaterReady?: boolean }
    if (w.__iwWaterReady || document.documentElement.classList.contains('iw-water-ready')) res()
    else window.addEventListener('inkwave:water-ready', () => res(), { once: true })
  })
  if (!document.querySelector('.inkwave-editor-surface.iw-fill.iw-wave-anim')) {
    teardown(video); bail('load already past drift → CSS water'); return
  }
  diag.reason = 'starting playback…'

  video.play().then(() => {
    video.style.opacity = '1' // THE loop was invisible: CSS defaults .iw-wave-video-el to opacity 0
    // ONE swap, THIS ORDER: -on goes on before -wait comes off, so the white and the video never
    // both let the CSS water through for a frame (both are <html> classes = a single recalc).
    document.documentElement.classList.add('iw-wave-video-on')
    endWait()
    diag.master = true; masterEver = true
    diag.reason = 'VIDEO is master'
    diag.loop = 'playing — waiting for the wrap'
    releaseAtLoopPoint(video) // the document may not reveal until this video has looped once
    wireSettle(video, brakeUrl, clip.rung)
  }).catch((e) => {
    bail(`autoplay-blocked (${String(e).slice(0, 50)}) → CSS water`)
    teardown(video)
  })
}

// ⚠️ `iw-wave-video-on` IS A PROMISE THAT SOMETHING ELSE IS DRAWING THE WATER, so it must be DERIVED
// from a live element and NEVER latched: it suppresses the CSS water outright, so when a re-render
// tears our <video> out (mounting Clerk at sign-in does exactly that) the surface is left a bare
// gradient with nothing drawing. Event-driven, not polled — MutationObserver callbacks are
// microtasks, so the CSS water is back before the bare frame can paint; `:not([data-going])` keeps
// the legitimate loop→brake swap a non-event. LIMIT: this sees our element leaving the host and the
// host leaving its parent, not a higher ancestor replaced wholesale (a subtree observer over the
// surface would re-run on every keystroke — the --wave-x lesson).
// → docs/archive/editor-surface.md#wave-master-derived
function guardMaster(host: HTMLElement): void {
  const check = () => {
    if (!diag.master) return
    if (document.querySelector('video.iw-wave-video-el:not([data-going])')) return
    document.documentElement.classList.remove('iw-wave-video-on')
    diag.master = false
    diag.reason = 'video element vanished (a re-render?) → CSS water'
  }
  const mo = new MutationObserver(check)
  mo.observe(host, { childList: true })
  if (host.parentElement) mo.observe(host.parentElement, { childList: true })
}

// THE CROP, in two lines: the element is the clip's DESIGN CSS BOX and nothing else, and the size
// MUST be written here rather than in CSS because it is a per-rung fact.
function mkVideo(rung: Rung): HTMLVideoElement {
  const v = document.createElement('video')
  v.style.width = `${rung.cssW}px`
  v.style.height = `${rung.cssH}px`
  // iOS inline autoplay REQUIRES muted + playsinline, as BOTH property and attribute.
  v.muted = true; v.defaultMuted = true
  v.autoplay = true; v.preload = 'auto'; v.playsInline = true
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '')
  v.setAttribute('aria-hidden', 'true')
  v.disablePictureInPicture = true
  v.className = 'iw-wave-video-el'
  return v
}

// ⚠ Teardown ALWAYS restores the CSS water: dropping the class is what makes the DOM water the
// fallback, and leaving it set with no video is a blank surface.
function teardown(v: HTMLVideoElement | null, delay = 0): void {
  if (!document.querySelector('video.iw-wave-video-el:not([data-going])')) {
    document.documentElement.classList.remove('iw-wave-video-on')
    diag.master = false
  }
  if (!v) return
  v.setAttribute('data-going', '')
  setTimeout(() => {
    try { v.pause() } catch { /* detached */ }
    v.remove()
    if (!document.querySelector('video.iw-wave-video-el')) {
      document.documentElement.classList.remove('iw-wave-video-on')
      diag.master = false
    }
  }, delay)
}

// ── SETTLE: phase-0 loop→brake swap on the media pipeline, then hand to the CSS water at rest ──
function wireSettle(loop: HTMLVideoElement, brakeUrl: string, rung: Rung): void {
  let done = false
  // PRELOAD the brake now, as a sibling of the loop in the same host (so the guard covers it too):
  // on iOS a brake created at swap-time would stall exactly like the loop did.
  const brake = mkVideo(rung)
  brake.loop = false
  brake.src = brakeUrl
  brake.style.opacity = '0'
  const host = loop.parentElement
  if (host) host.appendChild(brake)
  brake.load()

  const finish = (fadeMs: number) => {
    if (done) return
    done = true
    window.removeEventListener('inkwave:reveal-imminent', onImminent)
    window.removeEventListener('inkwave:open-begin', onAbort)
    window.removeEventListener('resize', onAbort)
    document.removeEventListener('visibilitychange', onVis)
    document.documentElement.classList.remove('iw-wave-video-on') // CSS water back (at its own rest)
    endWait()
    // The abort paths (open-begin / resize / an error / the tab hiding) land here and can outrun
    // the wrap, so release: the delay is a courtesy to the animation, never a dependency of the
    // document.
    releaseLoop('released at settle — the load ended before the wrap')
    diag.master = false; diag.reason = 'handed back to CSS water (rest)'
    loop.style.opacity = '0'
    teardown(loop, fadeMs + 40)
    teardown(brake, fadeMs + 40)
  }
  const onImminent = () => {
    if (done) return
    // Swap at the loop's PHASE-0 boundary: the brake is baked from that same boundary with the SAME
    // pool seed, so its first frame ≡ the loop's frame 0 (pixel-exact join).
    const swap = () => {
      if (done) return
      brake.style.opacity = '1'
      loop.style.opacity = '0'
      void brake.play().catch(() => finish(0))
      diag.reason = 'BRAKE (slow-down) playing'
      teardown(loop, 80)
      brake.addEventListener('ended', () => {
        document.documentElement.classList.remove('iw-wave-video-on')
        diag.master = false; diag.reason = 'brake ended → CSS water (rest)'
        brake.style.opacity = '0'
        teardown(brake, 240)
        done = true
      }, { once: true })
    }
    const startT = loop.currentTime
    let waited = 0
    const poll = setInterval(() => {
      if (done) { clearInterval(poll); return }
      if (loop.currentTime < startT || waited > 2200) { clearInterval(poll); swap() }
      waited += 40
    }, 40)
  }
  const onAbort = () => finish(0)
  const onVis = () => { if (document.hidden) finish(0) }
  window.addEventListener('inkwave:reveal-imminent', onImminent)
  window.addEventListener('inkwave:open-begin', onAbort)
  window.addEventListener('resize', onAbort)
  document.addEventListener('visibilitychange', onVis)
  loop.addEventListener('error', onAbort)
}

// ── The on-device diagnostic overlay (?waveVideo=debug) ──
function mountOverlay(): void {
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'z-index:2147483647', 'pointer-events:none',
    'font:11px/1.35 ui-monospace,Menlo,monospace', 'color:#fff',
    'background:rgba(0,0,0,0.82)', 'padding:6px 8px', 'max-width:92vw',
    'border-bottom-right-radius:8px', 'white-space:pre-wrap', 'word-break:break-word',
  ].join(';')
  // ⚠️ "ON SCREEN" MUST MEAN ON SCREEN: ASK THE LAYOUT ENGINE (box / display / visibility / opacity),
  // never the decoder. Keyed on play() resolving, this read green on Peter's iPhone while the
  // element sat in a display:none host painting nothing — a broken build talking us out of a real
  // bug. → docs/archive/editor-surface.md#wave-overlay
  const painted = (v: HTMLVideoElement): { ok: boolean; why: string } => {
    if (!v.isConnected) return { ok: false, why: 'DETACHED from the DOM' }
    const r = v.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return { ok: false, why: 'ZERO BOX (a display:none ancestor?)' }
    const cs = getComputedStyle(v)
    if (cs.display === 'none') return { ok: false, why: 'display:none' }
    if (cs.visibility !== 'visible') return { ok: false, why: `visibility:${cs.visibility}` }
    // A HALF-FADED VIDEO IS PAINTING; only a fully transparent one is not. An `opacity >= 0.9` test
    // cried NOT PAINTED for the 270ms fade-in of every successful start.
    if (+cs.opacity <= 0.01) return { ok: false, why: `opacity:${cs.opacity}` }
    return { ok: true, why: `${Math.round(r.width)}x${Math.round(r.height)} op=${(+cs.opacity).toFixed(2)}` }
  }
  const paint = () => {
    // THE LIVE ELEMENT, not just the first: during the swap the dying loop sits in the DOM for
    // 80ms marked data-going, and picking it cried "NOT PAINTED" mid-hand-off.
    const v = document.querySelector<HTMLVideoElement>('video.iw-wave-video-el:not([data-going])')
      ?? document.querySelector<HTMLVideoElement>('video.iw-wave-video-el')
    if (v) { diag.ready = v.readyState }
    // ⚠ NO ANGLE BRACKETS IN ANY OF THESE STRINGS: the box is written with innerHTML, so a literal
    // tag is PARSED and swallows the lines after it. The instrument must not be able to blank itself.
    const p = v ? painted(v) : { ok: false, why: 'no video element' }
    // ⚠ AN ALARM THAT FIRES ON THE HEALTHY PATH TRAINS PETER TO DISTRUST THE INSTRUMENT, so a
    // COMPLETED run must not look like one that never ran (`masterEver` is what tells them apart) —
    // and there is NO "benign" state for master-without-an-element, because master suppresses the
    // CSS water and so master with nothing painting IS the water dying. The legitimate loop→brake
    // swap is excluded by reading the LIVE element, never by excusing the symptom.
    const gate = document.documentElement.classList.contains('iw-water-ready')
    const head =
      diag.master && p.ok ? '<b style="color:#4ade80">● VIDEO ON SCREEN</b>'
        : diag.master ? `<b style="color:#fbbf24">▲ VIDEO IS MASTER BUT NOT PAINTED — ${p.why}</b>`
          : masterEver ? '<b style="color:#4ade80">✔ VIDEO RAN, then handed back to the CSS water — HEALTHY</b>'
            // Red means exactly ONE thing: the video never ran on this load. `reason` says which exit.
            : '<b style="color:#f87171">● CSS WATER — the video never ran this load</b>'
    box.innerHTML = `${head}
build     ${__BUILD_COMMIT__}
flag      ${diag.flag}
viewport  ${diag.viewport}
codec     ${diag.codec}   theme ${diag.theme}
rung      ${diag.rung}
clip      ${diag.clip}
fetch     ${diag.fetch}
loop-gate ${diag.loop}
readyState ${diag.ready} ${diag.ready >= 2 ? '(decoded)' : '(NOT decoded)'}
advancing ${diag.advancing ? 'YES (real decode)' : 'NO (frozen/none)'}
painted   ${p.ok ? `YES (${p.why})` : `NO — ${p.why}`}
water-gate ${gate ? 'OPEN' : '*** CLOSED — water is dead ***'}
reason    ${diag.reason}`
  }
  // KEEP IT ATTACHED: React owns <body>, so a plain appended overlay is reconciled AWAY during
  // hydration. Re-append whenever it is gone — this is Peter's only on-device instrument.
  const keepAttached = () => {
    if (!box.isConnected && document.body) document.body.appendChild(box)
  }
  keepAttached()
  // currentTime advancing = a REAL decode (not a frozen first frame — the iOS silent-failure tell).
  // ⚠ A SENTINEL MUST NOT BE ABLE TO MASQUERADE AS A MEASUREMENT: seeded at -1 as a "previous
  // reading", the first tick of any video satisfied `now > last + 0.001` and reported a real decode
  // for a video holding NO DATA. Require `readyState >= 2` AND a delta against a genuine sample;
  // `last = -1` means "no sample yet", which can never look like motion.
  let last = -1
  setInterval(() => {
    keepAttached()
    const v = document.querySelector<HTMLVideoElement>('video.iw-wave-video-el')
    const now = v ? v.currentTime : -1
    diag.advancing = !!v && v.readyState >= 2 && last >= 0 && now > last + 0.001
    last = now
    paint()
  }, 400)
  paint()
}
