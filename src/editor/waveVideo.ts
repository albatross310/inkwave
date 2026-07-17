// ─── Wave video (EXPERIMENTAL — localStorage `inkwave:waveVideo` = '1' | 'debug') ────────────
// Peter's proposal: play a pregenerated loop video of the water on the hardware media pipeline
// (decode + composite off the main thread — immune to the raster-scheduling residual class: blue
// flash, wave lines lagging their wave). The video is an OPAQUE, baked copy of THIS water
// (gradient + drifting lines + marks + glitters) for the LOAD window only; at rest it hands back
// to the CSS water, which owns scroll-time sway. The CSS/WAAPI unit keeps running HIDDEN
// underneath (`html.iw-wave-video-on`) and is the automatic fallback at EVERY step.
//
// SCOPE (say it plainly): this covers the LOAD animation ONLY — the drift + the S-curve slow-down.
// It cannot affect scroll-time artifacts, because at rest the video is gone and the CSS water is
// back. Load-time targets = blue flash + lines lagging their wave.
//
// ⚠️ THE FALLBACK CHAIN IS OTHERWISE SILENT (AV1 → H.264 → CSS) and CSS water looks IDENTICAL to
// the video. `?waveVideo=debug` renders an on-device overlay naming exactly what is on screen and
// WHY — Peter tests on an iPhone 8 with no Mac/Web Inspector, so without it a failed video is
// indistinguishable from a working one and every verdict is uninterpretable.
//
// iOS AUTOPLAY: inline autoplay requires BOTH `muted` and `playsinline` (as attributes AND
// properties — older WebKit reads the attribute) and fails SILENTLY otherwise. Low Power Mode
// blocks autoplay outright; that surfaces as reason 'autoplay-blocked'.
//
// ⛔ NOTHING HERE MAY TOUCH THE DOM BEFORE HYDRATION (2026-07-17 — Peter's "the video works but it
// never loads", PROBED). `hydrateRoot(document)` makes React own EVERY node, so appending our
// <video> (or the overlay) into the PRERENDERED `.iw-wave-twinkles` before hydration is a
// hydration MISMATCH: React throws #418, discards the server HTML and client-renders the whole
// document (#423) — which REPLACES the <html> element with a new node. The new <html> carries no
// `.iw-water-ready` and no `data-theme`, so `:root:not(.iw-water-ready)` puts every wave layer
// (and the twinkle host our own <video> lives in) at display:none FOR THE SESSION: the CSS water
// dies, the video paints nothing, and on phone the surface is left a flat aqua gradient with no
// waves — the 2026-07-10 "gradient without waves" catastrophe, re-triggered by this flag.
// entry.client's MutationObserver stamp-guard cannot save it: it watches the ORIGINAL <html>,
// which React detached. Hence `hydrated()` below — every DOM write waits behind it.

const RUNGS = [
  { name: 'phone', w: 540, h: 1170 },
  { name: 'desk', w: 1280, h: 800 },
] as const

// ── On-device diagnostic state (rendered by the overlay under ?waveVideo=debug) ──
type Diag = {
  flag: string; codec: string; rung: string; theme: string; clip: string
  fetch: string; ready: number; advancing: boolean; master: boolean; reason: string
}
const diag: Diag = { flag: '?', codec: '?', rung: '?', theme: '?', clip: '—', fetch: '—', ready: -1, advancing: false, master: false, reason: 'starting…' }
const bail = (reason: string) => { diag.reason = reason; diag.master = false }
// PROBE SEAM (same contract as `window.__iwTwkPool`): probes must read this object, never scrape
// the overlay's rendered HTML — the overlay is a formatted STRING for Peter's phone camera, and a
// probe that parses it measures the formatting. `masterEver` is the durable fact a 12s sample can
// otherwise miss entirely: the video can become master and hand back before any single read lands,
// which reads identically to "the video never ran" — the exact ambiguity that makes a green
// meaningless.
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

// AV1 first (av01, ~1/4 the bytes), then H.264 (avc1 — iPhone 8 / A11 have NO AV1). Both in mp4.
function pickCodec(): 'av1' | 'h264' | null {
  const probe = document.createElement('video')
  if (probe.canPlayType('video/mp4; codecs="av01.0.05M.08"')) return 'av1'
  const h = probe.canPlayType('video/mp4; codecs="avc1.640028"')
  if (h === 'probably' || h === 'maybe') return 'h264'
  return null
}


function pickRung(): typeof RUNGS[number] {
  // Cover-fit means either rung fills any viewport; pick by device class.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || window.innerWidth < 900 ? RUNGS[0] : RUNGS[1]
}

let started = false

// THE HYDRATION BARRIER (see the ⛔ note in the header). `inkwave:twinkles-ready` is the app's
// existing post-hydration signal: waveTwinkle announces it once the pool is mounted from a LAYOUT
// EFFECT, which React can only run after the hydration commit. Deliberately NOT `.iw-water-ready`
// — that gate has a 1500ms timeout path (entry.client) that can open it BEFORE hydration on a slow
// device (an iPhone 8 is exactly that device), which would put us right back in the mismatch.
// `__iwTwinklesReady` covers the fired-before-we-listened race, as it does for the gate itself.
// If the twinkles never announce, this never resolves and the video simply never runs — the CSS
// water is the intended fallback at every step, and entry.client only ever `void`s us.
// ASK, THEN SUBSCRIBE — and only ever wait on a signal that ALWAYS arrives. `inkwave:hydrated`
// (entry.client's beacon) fires from a post-commit effect on every load, and `__iwHydrated` makes
// it askable, so a caller that arrives late can never wait for an event already in the past. The
// check and the subscribe are one synchronous block — nothing can slip between them.
//
// This first keyed on `inkwave:twinkles-ready`. That was post-hydration, but it is NOT guaranteed:
// the pool announces only if BOTH its sets generate, while the water gate opens regardless on its
// own 1500ms timeout — so a load whose pool never announced hung the video FOREVER with the water
// gate wide open (PROBED 2026-07-17: reason stuck at 'waiting for hydration…', clip/fetch never
// even set). Correctness of the video must not depend on the twinkles succeeding.
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
  // Choose the clip and START THE DOWNLOAD before the barrier. Picking a codec and fetching bytes
  // touch NO DOM, so they are safe pre-hydration — and this is the whole reason the clip used to
  // arrive in time. The first cut of the barrier moved the fetch behind hydration too, which on
  // Peter's A11 pushed the download ~2s later and cost the video its 2.5s decode budget (his
  // 8:15am overlay: `readyState 0`, `fetch requested`). Only the ATTACH has to wait.
  const clip = planClip()
  if (!clip) return Promise.resolve()
  warmBytes(clip.loopUrl) // fire-and-forget: SW-cached, so the <video>'s Range probes hit memory
  diag.reason = 'waiting for hydration…'
  return new Promise<void>((resolve) => {
    void hydrated()
      .then(() => {
        // The overlay appends to <body> — a DOM write, so it waits behind the barrier too. It was
        // the second offender: with `=debug` it broke hydration all by itself.
        if (diag.flag === 'debug') mountOverlay()
        return run(clip)
      })
      .then(() => resolve())
      .catch((e) => { bail(`crashed: ${String(e).slice(0, 60)}`); resolve() })
  })
}

type Clip = { loopUrl: string; brakeUrl: string }

// DOM-FREE. Everything here is a capability query or a string.
function planClip(): Clip | null {
  const codec = pickCodec()
  diag.codec = codec ?? 'NONE'
  if (!codec) { bail('no decodable codec (no av01, no avc1) → CSS water'); return null }
  const rung = pickRung()
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'
  diag.rung = rung.name; diag.theme = theme
  const base = `/wave/${rung.name}.${theme}.${codec}`
  diag.clip = `${base}.mp4`
  return { loopUrl: `${base}.mp4`, brakeUrl: `${base}.brake.mp4` }
}

// The warm fetch the SW's /wave/ handler was written to receive ("non-Range GET (our warm fetch…)"):
// ONE full 200 that populates the cache, so the <video>'s later Range probes are served from the
// cached buffer with no network. Fire-and-forget on purpose — nothing may AWAIT this, or a stalled
// network would become a stalled load. If it loses to the <video>, the SW just fetches once more.
function warmBytes(url: string): void {
  diag.fetch = 'warming bytes (pre-hydration)…'
  void fetch(url)
    .then((r) => { diag.fetch = r.ok ? `warm ${r.status} → cached` : `warm FAILED ${r.status}` })
    .catch((e) => { diag.fetch = `warm FAILED (${String(e).slice(0, 30)})` })
}
export function initWaveVideo(): void { void prepareWaveVideo() }

async function run(clip: Clip): Promise<void> {
  const { loopUrl, brakeUrl } = clip

  // DIRECT same-origin src, NOT a blob (2026-07-16 — THE iPhone-8 fix). iOS decodes a <video> only
  // when it can Range-request the moov atom; a blob URL cannot be ranged → readyState stuck at 0
  // (Peter's overlay: fetch 200, readyState 0, decode timeout). The SW serves /wave/ cache-first
  // WITH 206 Range, so a direct URL is still one fetch + cached, and iOS can seek the metadata.
  const video = mkVideo()
  video.loop = true
  video.src = loopUrl

  // iOS loads a <video> only while it is IN THE DOM (a detached element never fetches on WebKit),
  // so attach — invisible (opacity 0) — before load(). We are POST-HYDRATION here, so ONE plain
  // append is enough: React rendered `.iw-wave-twinkles` as a stable EMPTY container and never
  // touches its children again (waveTwinkle owns them imperatively and only ever removes its OWN
  // `.iw-twk-set` nodes — it never clears the host). The old 150ms re-attach interval existed
  // solely to heal the wipe caused by attaching PRE-hydration; with the barrier there is no wipe,
  // so the interval is gone rather than re-tuned. We become MASTER (hide the CSS water) only once
  // play() RESOLVES, so a decode/autoplay failure always leaves the CSS water visible.
  // ⚠️ ONE HOST, ONE CLOCK — AND IT MUST STAY THAT WAY (2026-07-17, flagged by fix/wave-desktop-jitter).
  // `querySelector` + `:not(.iw-wave-covered)` means exactly ONE <video> exists per load: the shell's,
  // never the covered editor's. That is load-bearing, not incidental. During the load there are TWO
  // drifting surfaces, and the CSS water solves them by making both adopt ONE literal startTime — the
  // whole "sibling clock adopt" invariant in Scroll.tsx exists because two copies of this water at
  // 33-500ms of skew showed doubled lines through the reveal fade. Give the second surface its own
  // element and you get the identical two-clock shape WITH DECODERS: two `currentTime`s, no shared
  // timeline, no adopt possible (a media element's clock cannot be assigned like an animation's
  // startTime). The jitter lane measured what that costs on the CSS side — 43-60px of mark-vs-wave
  // skew on 4 of 5 clean loads, from two animations resolving their startTime independently. Do not
  // add a second video without an answer to "which clock, and who slaves to it".
  const host = document.querySelector<HTMLElement>(
    '.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .iw-wave-twinkles',
  )
  if (!host) { bail('no water host on this page → CSS water'); return }
  guardMaster(host)
  // `reason` MUST TRACK WHERE THIS FUNCTION ACTUALLY IS (2026-07-17). It used to be written once
  // before the barrier and then never again until play() resolved, so a video stuck in its decode
  // still displayed 'waiting for hydration…' — and that stale line sent the next reader hunting a
  // barrier bug that had already released (clip/fetch on the same overlay proved run() was well
  // past it). A field nobody updates is a field that lies.
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

  // Don't become master before the atomic water has painted, and never veil a load that already
  // reached its coast/rest (a slow decode on a fast open) — that would show drift over settled text.
  // ASKABLE, not just an event: the class is not a safe thing to test alone (a hydration recovery
  // can strip it — that WAS this bug), and the event may have fired while we were decoding. Same
  // rule as `hydrated()`: ask first, subscribe only if the answer is no.
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
    document.documentElement.classList.add('iw-wave-video-on')
    diag.master = true; masterEver = true
    diag.reason = 'VIDEO is master'
    wireSettle(video, brakeUrl)
  }).catch((e) => {
    bail(`autoplay-blocked (${String(e).slice(0, 50)}) → CSS water`)
    teardown(video)
  })
}

// THE MASTER LATCH MUST NOT OUTLIVE THE ELEMENT (2026-07-17 — Peter, live: "after I signed in just
// now the wave background completely went away"; flat teal, no waves, document fine).
//
// `html.iw-wave-video-on` SUPPRESSES the CSS water outright (visibility:hidden on the wave pseudos
// AND the twinkle host) with no dependency on this video existing. The class is therefore a PROMISE
// that something else is drawing the water. When a re-render tears our <video> out of the DOM —
// mounting Clerk at sign-in does exactly that — the promise is broken and the surface is left a
// bare gradient: the CSS water suppressed, the video gone, nothing drawing. The water dies.
//
// So the class must be DERIVED, not latched: the moment nothing of ours is left to draw, hand the
// water straight back. Event-driven, not polled — the host's children change only when the twinkle
// sets or our own videos mount/unmount, and MutationObserver callbacks are microtasks, so the CSS
// water is restored before the bare-gradient frame can paint. `:not([data-going])` is what makes
// the legitimate loop→brake swap a non-event: the dying loop is already marked, the brake is live.
//
// LIMIT, stated: this sees our element leaving the host, and the host leaving its parent. A
// re-render that replaces a HIGHER ancestor wholesale would go unseen — covering that needs a
// subtree observer over the surface, which contains the ProseMirror subtree and would re-run on
// every keystroke (the --wave-x invalidation lesson). Peter's ruling deletes this whole latch
// anyway; this is the smallest thing that makes the live bug impossible.
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

function mkVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  // iOS inline autoplay REQUIRES muted + playsinline, as BOTH property and attribute.
  v.muted = true; v.defaultMuted = true
  v.autoplay = true; v.preload = 'auto'; v.playsInline = true
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '')
  v.setAttribute('aria-hidden', 'true')
  v.disablePictureInPicture = true
  v.className = 'iw-wave-video-el'
  return v
}

// Teardown ALWAYS restores the CSS water: dropping the class is what makes the DOM water the
// fallback. (Leaving it set with no video = a blank surface — a real bug, 2026-07-16.)
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
function wireSettle(loop: HTMLVideoElement, brakeUrl: string): void {
  let done = false
  // PRELOAD the brake now (direct URL, in-DOM, invisible, guarded) so it's decoded before SETTLE —
  // on iOS a brake created at swap-time would stall exactly like the loop did. Attaching it as a
  // sibling of the loop in the same host means the guard/host logic covers it too.
  const brake = mkVideo()
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
    diag.master = false; diag.reason = 'handed back to CSS water (rest)'
    loop.style.opacity = '0'
    teardown(loop, fadeMs + 40)
    teardown(brake, fadeMs + 40)
  }
  const onImminent = () => {
    if (done) return
    // Swap to the BRAKE at the loop's phase-0 boundary: the brake is baked from that same boundary
    // with the SAME pool seed, so its first frame ≡ the loop's frame 0 (pixel-exact join).
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
  // "ON SCREEN" MUST MEAN ON SCREEN (2026-07-17). This said VIDEO ON SCREEN whenever play()
  // resolved — a claim about the DECODER, not about pixels. It read green on Peter's iPhone while
  // the element sat inside a display:none host painting absolutely nothing, which is precisely how
  // a broken build talked us out of a real bug. Ask the layout engine instead: a display:none
  // ancestor gives a zero box (and null offsetParent for a non-fixed chain), and visibility/opacity
  // are resolved values, so this sees every way the video can be silently unpainted.
  const painted = (v: HTMLVideoElement): { ok: boolean; why: string } => {
    if (!v.isConnected) return { ok: false, why: 'DETACHED from the DOM' }
    const r = v.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return { ok: false, why: 'ZERO BOX (a display:none ancestor?)' }
    const cs = getComputedStyle(v)
    if (cs.display === 'none') return { ok: false, why: 'display:none' }
    if (cs.visibility !== 'visible') return { ok: false, why: `visibility:${cs.visibility}` }
    // `painted` means PUTS PIXELS ON SCREEN. It demanded opacity >= 0.9, which invented a false
    // alarm out of a legitimate animation: `.iw-wave-video-el` fades in over `transition: opacity
    // 0.3s`, so for ~270ms of every successful start — the exact moment Peter watches, "right
    // before it loads" — a video that WAS painting reported NOT PAINTED. A half-faded video is
    // painting. Only a fully transparent one is not.
    if (+cs.opacity <= 0.01) return { ok: false, why: `opacity:${cs.opacity}` }
    return { ok: true, why: `${Math.round(r.width)}x${Math.round(r.height)} op=${(+cs.opacity).toFixed(2)}` }
  }
  const paint = () => {
    // THE LIVE ELEMENT, not just the first one. During the loop→brake swap the dying loop is still
    // in the DOM for 80ms (opacity 0, marked data-going) while the brake plays — picking it made
    // the overlay cry "NOT PAINTED" in the middle of a perfectly good hand-off.
    const v = document.querySelector<HTMLVideoElement>('video.iw-wave-video-el:not([data-going])')
      ?? document.querySelector<HTMLVideoElement>('video.iw-wave-video-el')
    if (v) { diag.ready = v.readyState }
    // NO ANGLE BRACKETS IN ANY OF THESE STRINGS: this box is written with innerHTML, so a literal
    // "<video>" is parsed as a TAG — it swallowed the water-gate and reason lines whole the first
    // time this ran. The instrument must not be able to blank itself.
    const p = v ? painted(v) : { ok: false, why: 'no video element' }
    // ── THE STATE MACHINE (2026-07-17, round 3) ──
    // The overlay was RED on a working app, and that is worse than green on a broken one: it burns
    // the trust of the one person whose eyes are the ground truth. Success ENDS with the element
    // removed and master cleared, so a completed run displayed the same red '● CSS WATER (no
    // video)' as a video that never ran at all — and Peter, reading it, reported "the first time
    // the video ran, from then on just the css". The finished state and the never-ran state MUST
    // NOT look alike. `masterEver` is what tells them apart.
    const gate = document.documentElement.classList.contains('iw-water-ready')
    // NO "BENIGN" STATE FOR master-WITHOUT-AN-ELEMENT. Round 3 called that a mid-swap transient and
    // greyed it out; Peter's sign-in screenshot then showed EXACTLY that state while his water was
    // dead — `master` suppresses the CSS water, so master with nothing painting IS the water dying.
    // The alarm was telling the truth and I muted it. The legitimate loop→brake swap is excluded
    // properly instead, by reading the LIVE element (`:not([data-going])`) rather than by excusing
    // the symptom.
    const head =
      diag.master && p.ok ? '<b style="color:#4ade80">● VIDEO ON SCREEN</b>'
        : diag.master ? `<b style="color:#fbbf24">▲ VIDEO IS MASTER BUT NOT PAINTED — ${p.why}</b>`
          : masterEver ? '<b style="color:#4ade80">✔ VIDEO RAN, then handed back to the CSS water — HEALTHY</b>'
            // Red means exactly ONE thing: the video never ran on this load. `reason` says which exit.
            : '<b style="color:#f87171">● CSS WATER — the video never ran this load</b>'
    box.innerHTML = `${head}
build     ${__BUILD_COMMIT__}
flag      ${diag.flag}
codec     ${diag.codec}   rung ${diag.rung}/${diag.theme}
clip      ${diag.clip}
fetch     ${diag.fetch}
readyState ${diag.ready} ${diag.ready >= 2 ? '(decoded)' : '(NOT decoded)'}
advancing ${diag.advancing ? 'YES (real decode)' : 'NO (frozen/none)'}
painted   ${p.ok ? `YES (${p.why})` : `NO — ${p.why}`}
water-gate ${gate ? 'OPEN' : '*** CLOSED — water is dead ***'}
reason    ${diag.reason}`
  }
  // KEEP IT ATTACHED. hydrateRoot(document) makes React own <body>, so a plain appended overlay is
  // reconciled AWAY during hydration (why it vanished, 2026-07-16). Re-append whenever it's gone —
  // this is Peter's only on-device instrument, it must survive hydration + every re-render.
  const keepAttached = () => {
    if (!box.isConnected && document.body) document.body.appendChild(box)
  }
  keepAttached()
  // currentTime advancing = a REAL decode (not a frozen first frame — the iOS silent-failure tell).
  // `last` seeded at -1 meant the FIRST tick of any video satisfied `now > last + 0.001` and
  // reported "YES (real decode)" for a video holding NO DATA — Peter's 8:15am overlay showed
  // `readyState 0 (NOT decoded)` next to `advancing YES (real decode)`, a physically impossible
  // pair that cost real time to see through. Require decoded data AND a genuine delta against a
  // previous sample; `last = -1` now means "no sample yet", which can never look like motion.
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
