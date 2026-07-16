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

// Called from entry.client's gate (flag-gated). Resolves when the loop's first frame is decoded
// (or we give up → CSS water); entry.client folds it into `.iw-water-ready` (bounded by its timeout).
export function prepareWaveVideo(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  diag.flag = flagValue()
  if (diag.flag === 'debug') mountOverlay()
  return new Promise<void>((resolve) => {
    void run().then(() => resolve()).catch((e) => { bail(`crashed: ${String(e).slice(0, 60)}`); resolve() })
  })
}
export function initWaveVideo(): void { void prepareWaveVideo() }

async function run(): Promise<void> {
  const codec = pickCodec()
  diag.codec = codec ?? 'NONE'
  if (!codec) { bail('no decodable codec (no av01, no avc1) → CSS water'); return }
  const rung = pickRung()
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'
  diag.rung = rung.name; diag.theme = theme
  const base = `/wave/${rung.name}.${theme}.${codec}`
  const loopUrl = `${base}.mp4`
  const brakeUrl = `${base}.brake.mp4`
  diag.clip = loopUrl

  // DIRECT same-origin src, NOT a blob (2026-07-16 — THE iPhone-8 fix). iOS decodes a <video> only
  // when it can Range-request the moov atom; a blob URL cannot be ranged → readyState stuck at 0
  // (Peter's overlay: fetch 200, readyState 0, decode timeout). The SW serves /wave/ cache-first
  // WITH 206 Range, so a direct URL is still one fetch + cached, and iOS can seek the metadata.
  const video = mkVideo()
  video.loop = true
  video.src = loopUrl

  // iOS loads a <video> only while it is IN THE DOM (a detached element never fetches on WebKit),
  // so attach NOW — invisible (opacity 0) — and keep it attached via the self-heal guard (React
  // reconciles the prerendered `.iw-wave-twinkles` host during hydration). We become MASTER (hide
  // the CSS water) only once play() RESOLVES, so a decode/autoplay failure always leaves the CSS
  // water visible. `diag.fetch` is filled by the SW response path; keep the overlay honest.
  diag.fetch = 'requested (direct URL via SW)'
  guardAttached(video)
  video.load()

  const playable = new Promise<void>((res) => {
    if (video.readyState >= 2) res()
    else video.addEventListener('loadeddata', () => res(), { once: true })
  })
  await Promise.race([playable, new Promise<void>((r) => setTimeout(r, 2500))]) // iOS metadata is slower
  diag.ready = video.readyState
  if (video.readyState < 2) { teardown(video); bail(`decode timeout (readyState ${video.readyState} after 2.5s) → CSS water`); return }
  diag.fetch = '200 / decoded'

  // Don't become master before the atomic water has painted, and never veil a load that already
  // reached its coast/rest (a slow decode on a fast open) — that would show drift over settled text.
  await new Promise<void>((res) => {
    if (document.documentElement.classList.contains('iw-water-ready')) res()
    else window.addEventListener('inkwave:water-ready', () => res(), { once: true })
  })
  if (!document.querySelector('.inkwave-editor-surface.iw-fill.iw-wave-anim')) {
    teardown(video); bail('load already past drift → CSS water'); return
  }

  video.play().then(() => {
    video.style.opacity = '1' // THE loop was invisible: CSS defaults .iw-wave-video-el to opacity 0
    document.documentElement.classList.add('iw-wave-video-on')
    diag.master = true
    diag.reason = 'VIDEO is master'
    wireSettle(video, brakeUrl)
  }).catch((e) => {
    bail(`autoplay-blocked (${String(e).slice(0, 50)}) → CSS water`)
    teardown(video)
  })
}

// SELF-HEALING ATTACH. Does the FIRST attach (as soon as the host exists) AND re-attaches if React
// ever reconciles our <video> away while it's still ours. `.iw-wave-twinkles` is React-rendered and
// present in the prerendered html, so a video appended before that subtree hydrates gets wiped —
// which (with the class set) would blank the surface. Belt-and-braces: the guard keeps it in the DOM
// so iOS can decode it AND so it stays visible once master. Stops at teardown (data-going).
function guardAttached(video: HTMLVideoElement): void {
  const tryAttach = () => {
    if (video.hasAttribute('data-going')) return true
    if (video.isConnected) return false
    const host = document.querySelector<HTMLElement>(
      '.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .iw-wave-twinkles',
    )
    if (!host) return false
    host.appendChild(video)
    if (diag.master) void video.play().catch(() => { /* re-play denied — finish restores CSS water */ })
    return false
  }
  tryAttach()
  const t = setInterval(() => { if (tryAttach() || video.hasAttribute('data-going')) clearInterval(t) }, 150)
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
  const paint = () => {
    const v = document.querySelector<HTMLVideoElement>('video.iw-wave-video-el')
    if (v) { diag.ready = v.readyState }
    const head = diag.master
      ? '<b style="color:#4ade80">● VIDEO ON SCREEN</b>'
      : '<b style="color:#f87171">● CSS WATER (no video)</b>'
    box.innerHTML = `${head}
flag      ${diag.flag}
codec     ${diag.codec}   rung ${diag.rung}/${diag.theme}
clip      ${diag.clip}
fetch     ${diag.fetch}
readyState ${diag.ready} ${diag.ready >= 2 ? '(decoded)' : '(NOT decoded)'}
advancing ${diag.advancing ? 'YES (real decode)' : 'NO (frozen/none)'}
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
  let last = -1
  setInterval(() => {
    keepAttached()
    const v = document.querySelector<HTMLVideoElement>('video.iw-wave-video-el')
    const now = v ? v.currentTime : -1
    diag.advancing = v ? now > last + 0.001 : false
    last = now
    paint()
  }, 400)
  paint()
}
