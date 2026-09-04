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

// ─── THE LADDER: CROP, NEVER RESIZE (2026-07-17 — Peter's ruling, and it is a bug fix) ───────────
// "render the video at one higher resolution and then crop it to the screen rather than resizing
// it… preserve dpi rather than the fixed boundaries of the movie".
//
// WHY THIS IS NOT A PREFERENCE. The video stands in for the CSS water for the load and HANDS BACK
// at the coast, so its wave tile must be 140 CSS px at EVERY viewport — that congruence IS the
// hand-off. `object-fit: cover` scaled the clip to the viewport, so the tile became
// 140 × max(vw/designW, vh/designH): MEASURED 122.5px at 1100×700 and 157.5px at 1440×900 against
// the CSS water's unwavering 140.0 — a 12.5% jump at the swap, exactly Peter's live report ("the
// video resolution and size of the waves does not match that of the background"). Crop measured
// 140.0 vs 140.0, 0.0% error, at a viewport where cover reads 122.5 (`tilescale.prove.mjs`).
//
// THE MECHANISM: the element is sized to the clip's DESIGN CSS BOX (`cssW`×`cssH`, fixed at the
// top-left) and `object-fit: fill` maps the clip's pixels onto it 1:1. The clip is encoded at
// `cssW × dsf` — so on a device whose DPR === dsf, one clip pixel is one DEVICE pixel ("preserve
// dpi"). The VIEWPORT then crops whatever overflows. A design box must therefore COVER the
// viewport, or there is no pattern to crop from and the surface would show a bare edge.
//
// ⚠️ `object-fit: none` is NOT the same fix: it maps 1 video px → 1 CSS px, so a dsf:2 clip would
// render 2× too big. The trio is: clip @ (design CSS × dsf) + element @ design CSS + `fill`.
//
// THE CEILING IS PETER'S ("Why don't we just do full hd. Or even 720p"): the desk rung is FULL HD
// at dsf 1, chosen over a retina 3840×2160 because he asked for the smaller file and because the
// water is a gradient + soft 140px lines — and because 1920×1080 (2.07 Mpx) still fits H.264
// **Level 4.0** (~2.1 Mpx), the iPhone-conservative pin `generate.mjs` has always carried. A 4K
// clip would force Level 5.1. `wide` (2560×1440) exists because a 1920-wide design box has nothing
// to crop from on a 2560 desktop; it is DESKTOP-ONLY by construction (`pickRung` partitions on the
// pointer type), so its Level 5.1 never reaches an iPhone.
//
// ABOVE `wide`, pickRung returns null and the CSS water plays — the honest answer, not a stretched
// clip. A <video> cannot be background-repeated, two tiled videos are two `currentTime`s, and
// canvas-tiling needs a per-frame JS driver (the one thing this whole unit exists to avoid).
type Rung = {
  name: string
  cssW: number; cssH: number   // the DESIGN CSS box — the element's literal size
  dsf: number                  // clip pixels per CSS px (clip is cssW*dsf × cssH*dsf)
  coarse: boolean              // touch rung? (never offered to a mouse, and vice versa)
}
const RUNGS: readonly Rung[] = [
  // Covers every phone CSS viewport in portrait (iPhone 8 375×667 · 12 390×844 · 14 Pro Max 430×932).
  // dsf 2 is dpi-exact on an iPhone 8 and 0.67× on a DPR-3 phone — soft by Peter's own budget, not
  // by accident. 880×1912 = 1.68 Mpx, also inside Level 4.0.
  { name: 'phone', cssW: 440, cssH: 956, dsf: 2, coarse: true },
  // FULL HD, Peter's word. Covers a desktop CSS viewport up to 1920×1080 at DPR 1.
  { name: 'desk', cssW: 1920, cssH: 1080, dsf: 1, coarse: false },
  // The crop headroom a 2560-wide desktop needs. Desktop-only ⇒ H.264 Level 5.1 is safe here.
  { name: 'wide', cssW: 2560, cssH: 1440, dsf: 1, coarse: false },
]

// ── On-device diagnostic state (rendered by the overlay under ?waveVideo=debug) ──
type Diag = {
  flag: string; codec: string; rung: string; theme: string; clip: string
  fetch: string; ready: number; advancing: boolean; master: boolean; reason: string
  viewport: string; loop: string
}
const diag: Diag = { flag: '?', codec: '?', rung: '?', theme: '?', clip: '—', fetch: '—', ready: -1, advancing: false, master: false, reason: 'starting…', viewport: '?', loop: 'not started' }
// EVERY exit runs through here, and that is what makes the two gates below safe to wait on: a bail
// must ALWAYS hand the water back (drop the white wait → CSS water) and ALWAYS release the reveal
// (or a failed decode would leave Peter on a white screen with no document).
const bail = (reason: string) => {
  diag.reason = reason; diag.master = false
  endWait()
  releaseLoop(`released by a bail — no video (${reason.slice(0, 40)})`)
}
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

// ─── THE DELIBERATE DELAY (Peter: "make it show at least one loop before the file comes up.
// purposefully delay it. (And use that time to warm up the document)") ───────────────────────────
//
// The reveal gate (TiptapEditor) waits on this alongside fonts.ready + the first pagination
// measure — so "warm up the document" needs no code of its own: the warm-up IS what the load was
// already doing, and this simply stops the reveal from cutting it short.
//
// THE BOUNDARY IS THE VIDEO'S OWN, NOT A TIMER. `releaseAtLoopPoint` watches `currentTime` WRAP —
// a looping media element's clock running backwards is the loop point, OBSERVED. A
// `setTimeout(2000)` would be a guess about a decode we do not control, and a measurement whose
// verdict depends on who else is running is not a guard: on a busy first load the clip starts
// late, so a timer would release mid-loop and Peter would see exactly the half-loop he asked us
// to stop showing him.
//
// ALWAYS ARRIVES, AND IS ASKABLE (the one-shot-async-signal rule — this module has been bitten by
// it twice already). Every exit fires it: bail, decode timeout, autoplay refusal, the wrap, the
// settle, and the cap. A reader that arrives late asks `__iwWaveVideoLoopDone` rather than waiting
// for an event in the past. If this module never loads at all, nothing here fires — which is why
// the reader in TiptapEditor carries its own independent cap.
let loopDone = false
function releaseLoop(why: string): void {
  if (loopDone) return
  loopDone = true
  diag.loop = why
  ;(window as unknown as { __iwWaveVideoLoopDone?: boolean }).__iwWaveVideoLoopDone = true
  window.dispatchEvent(new Event('inkwave:wave-video-loop'))
}

// Watch for the wrap. rVFC where it exists (it ticks with the DECODER, so it sees the wrap on the
// frame it happens), else a 40ms poll of the same fact — the poll is what `wireSettle` already
// uses to find this identical boundary, so this is not a second way of asking one question.
// The cap is NOT the timer sneaking back in as the release mechanism: a media element genuinely
// can stall on a dead network, and a load that never reveals the document is a far worse bug than
// a short loop. It NAMES itself in `diag.loop`, so a capped release can never be read as a real one.
function releaseAtLoopPoint(video: HTMLVideoElement): void {
  const start = video.currentTime
  let last = start
  const cap = setTimeout(() => releaseLoop(`CAPPED at 6s — no wrap seen (currentTime ${video.currentTime.toFixed(2)})`), 6000)
  const seen = () => {
    if (loopDone) return
    const now = video.currentTime
    // The wrap: the clock ran backwards. The second arm covers `start` being mid-clip (play() can
    // resolve a frame or two in) — a full duration's worth of advance is also one whole loop.
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

// ─── BLANK WHITE UNTIL THE VIDEO COMES UP (Peter: "we have to just have blank white screen until
// the video comes up and play the video every time") ─────────────────────────────────────────────
// `html.iw-wave-video-wait` whites the surface and hides every water layer, so a load can never
// show a frame of CSS water that the video is about to replace (the "partial/janky first frame").
// It is a CLASS ON <html>, set by entry.client BEFORE hydration — the same shape as
// `.iw-water-ready` and `data-theme`, and deliberately NOT a node append: appending pre-hydration
// is precisely the bug (React #418 → the whole document re-rendered → the water dead for the
// session) that the `hydrated()` barrier below exists to prevent.
//
// IT MUST NEVER BE PERMANENT. Every exit clears it: the master hand-off swaps it for
// `.iw-wave-video-on`, and every bail drops it so the CSS water — the fallback at every step —
// appears. entry.client carries an independent timeout for the case where this module never loads.
function endWait(): void { document.documentElement.classList.remove('iw-wave-video-wait') }

// AV1 first (av01, ~1/4 the bytes), then H.264 (avc1 — iPhone 8 / A11 have NO AV1). Both in mp4.
function pickCodec(): 'av1' | 'h264' | null {
  const probe = document.createElement('video')
  if (probe.canPlayType('video/mp4; codecs="av01.0.05M.08"')) return 'av1'
  const h = probe.canPlayType('video/mp4; codecs="avc1.640028"')
  if (h === 'probably' || h === 'maybe') return 'h264'
  return null
}


// ─── pickRung — PETER NEVER TELLS US HIS RESOLUTION ("inkwave should detect that") ───────────────
// Exported + PURE so the gate can be tested at every device class without a browser. The old rung
// choice was `coarse || innerWidth < 900` and nothing else: under cover-fit either clip stretched
// to fill anything, so the viewport's SIZE genuinely did not matter. Under crop it is the whole
// question — a design box that does not cover the viewport has no pattern to crop from.
//
// THE RULE: the SMALLEST rung of the right device class whose design box covers the viewport in
// BOTH axes. Smallest-that-covers is what keeps a 1280×800 laptop off `wide`'s bytes. Nothing
// covers it ⇒ null ⇒ CSS water. It NEVER returns a rung that must be stretched: that is the bug
// this ladder exists to fix, and silently reintroducing it is worse than not playing at all.
//
// `coarse` IS A PARAMETER, not a `matchMedia` read inside the function — and the first reason is a
// bug these tests caught on their first run: under vitest's node environment there is no `window`,
// so an internal read returns `false` for every case and the ENTIRE touch half of the suite becomes
// a silent second copy of the desktop half — passing, and proving nothing. (waveVideo.test.ts's
// "the stub discriminates" check is what surfaced it.) Second: the device class is an INPUT to this
// decision, so a function that reaches out for it is not the pure rule it claims to be.
//
// THE DEVICE CLASS IS A HARD PARTITION, not a preference. `phone` is captured under the app's PHONE
// CSS (compact 32px page margins, the ×1.25 font rule, in-flow surfaces) and `desk`/`wide` under
// desktop CSS. They are pictures of two different waters. So a coarse device is NEVER offered a
// desk clip — not even a landscape iPad, whose viewport `desk` would happily cover.
//
// ⚠️ DPR IS DETECTED AND REPORTED, BUT IT DOES NOT SELECT — and saying so is the honest version.
// Peter's ask is "detect viewport x DPR at runtime… I shouldn't have to give the res of my
// desktop", and both halves ARE read at runtime (`planClip` → `diag.viewport`, `dpiRatio`). But
// selection is a CHOICE, and DPR can only make one where two rungs of the same device class differ
// in `dsf` — this ladder has no such pair, because Peter's ceiling ("full hd. Or even 720p") is
// exactly what rules out the retina desk clip that would create one. A `dpr` parameter here would
// be a number the function reads and cannot act on: an instrument reporting a decision it never
// makes. WHEN a dsf variant is added, this is the function that gains the argument.
// What DPR would otherwise be for — refusing a rung delivering under 1 clip px per device px — is
// deliberately NOT done. A 440-CSS phone at DPR 3 asks 1320 device px of an 880px clip: still a
// CROP (the tile is 140 CSS px, so the hand-off stays exact) and merely SOFT, which is inside
// Peter's stated budget. Refusing it would drop every modern iPhone to CSS water — trading a PROVED
// bug (the 12.5% tile jump) for a guess about crispness nobody has measured on a device.
//
// ⚠️ STATED CEILING, found by these tests rather than reasoned about: an iPad in PORTRAIT
// (820×1180) matches no rung. `phone` (440×956) cannot cover it and the desk clips are landscape —
// 1080 < 1180, so `desk` fails on HEIGHT even ignoring the partition. It gets CSS water. Deliberate:
// the alternative is an iPad rung nobody asked for, on a device Peter does not test, for a load
// animation whose fallback is already correct.
export function pickRung(vw: number, vh: number, coarse: boolean): Rung | null {
  const fits = RUNGS.filter((r) => r.coarse === coarse && r.cssW >= vw && r.cssH >= vh)
  if (!fits.length) return null
  // Smallest by area — the ladder is ordered, but sort so a future rung cannot be mis-ranked by
  // where someone happened to paste it.
  return fits.slice().sort((a, b) => a.cssW * a.cssH - b.cssW * b.cssH)[0]
}

// The dpi the chosen rung actually delivers, for the overlay. `1` = one clip pixel per device
// pixel. Reported, never enforced — see the note above.
function dpiRatio(r: Rung, dpr: number): number { return r.dsf / dpr }

let started = false

// ASK, THEN SUBSCRIBE — and only ever wait on a signal that ALWAYS arrives. `inkwave:hydrated`
// (entry.client's beacon) fires from a post-commit effect on every load, and `__iwHydrated` makes
// it askable, so a caller that arrives late can never wait for an event already in the past. The
// check and the subscribe are one synchronous block — nothing can slip between them.
//
// This first keyed on `inkwave:twinkles-ready`. That was post-hydration, but the old runtime pool's
// signal was NOT guaranteed: it announced only if BOTH its sets generated, while the water gate
// opened on its own timeout — so a load whose pool never announced hung the video FOREVER with the water
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
  const video = mkVideo(clip.rung)
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
    // ONE swap, this order: -on goes on before -wait comes off, so the white and the video never
    // both let the CSS water through for a frame. Both are classes on <html> = a single recalc.
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

// THE CROP, in two lines: the element is the clip's DESIGN CSS BOX and nothing else. `object-fit:
// fill` (index.css) then maps the clip's pixels onto it with no scaling of its own, so a 140px wave
// tile in the clip is 140 CSS px on screen at EVERY viewport, and the viewport crops the overflow.
// The size MUST be written here rather than in CSS: it is a per-rung fact, and the whole point of
// the ladder is that different devices get different design boxes.
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
function wireSettle(loop: HTMLVideoElement, brakeUrl: string, rung: Rung): void {
  let done = false
  // PRELOAD the brake now (direct URL, in-DOM, invisible, guarded) so it's decoded before SETTLE —
  // on iOS a brake created at swap-time would stall exactly like the loop did. Attaching it as a
  // sibling of the loop in the same host means the guard/host logic covers it too.
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
    // the wrap. Release, or the reveal gate would sit waiting on a loop from a video we just tore
    // down — the delay is a courtesy to the animation, never a dependency of the document.
    releaseLoop('released at settle — the load ended before the wrap')
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
