// ─── Wave video (EXPERIMENTAL — localStorage `inkwave:waveVideo` = '1') ──────────────────────
// Peter's proposal, GO 2026-07-15: play a pregenerated loop video of the water on the hardware
// media pipeline (decode + composite fully off the main thread — immune to BOTH main-thread
// starvation AND the raster-scheduling artifact class behind the real-device residuals: blue
// flash, wave lines lagging their wave). The video is an OPAQUE, baked copy of THIS water
// (gradient + drifting lines + the static single-band marks + glitters). The CSS/WAAPI water keeps
// running HIDDEN underneath (`html.iw-wave-video-on` hides the pseudos + twinkles by visibility) and
// is the automatic fallback at EVERY step: no decodable codec, slow/failed fetch, autoplay denial
// (iOS Low Power Mode), no covering rung, hidden tab, resize, or a night theme with no night clip.
//
// SHAPE (2026-07-15 production design):
//   • Two codecs shipped: AV1 (tiny, modern) and H.264 (universal — covers iPhone 8 / A11, no AV1).
//     Runtime picks the smallest decodable one; else the CSS water simply stays.
//   • CACHE-ONCE: the ONE matched rung+codec+theme clip (loop + brake) is fetched once and kept in
//     the SW Cache Storage; a module-level blob URL is reused across every editor / new-file /
//     SnapshotView mount — zero network after first load.
//   • ATOMIC: prepareWaveVideo() resolves once the loop's first frame is decoded; entry.client folds
//     that into the `.iw-water-ready` gate (bounded by the gate's own timeout — a slow video never
//     holds the page hostage). So on a warm load the video is the water from the very first paint.
//   • PHASE-0 LOOP→BRAKE at SETTLE: the loop starts at phase 0; on `inkwave:reveal-imminent` we swap
//     the looping clip for the BRAKE clip (the S-curve slow-down), which is baked starting at that
//     SAME phase-0 boundary — the join is pixel-identical (proven: brake frame0 ≡ loop frame0). The
//     brake decelerates to rest on the media pipeline (no CSS coast handoff → the residual class is
//     bypassed for the slow-down too), then hands to the CSS water at rest for scroll-time sway.

const RUNGS = [
  { name: 'phone', w: 540, h: 1170 },
  { name: 'desk', w: 1280, h: 800 },
] as const

// Reused across mounts (editor / new file / SnapshotView) — one fetch + one blob per clip per
// session; the SW's cache-first (versioned) keeps it across sessions until a deploy. Zero network
// after first load.
const blobUrls = new Map<string, string>()

// AV1 first (av01, ~1/4 the bytes), then H.264 (avc1 — iPhone 8 / any older device). Both in mp4.
function pickCodec(): 'av1' | 'h264' | null {
  const probe = document.createElement('video')
  if (probe.canPlayType('video/mp4; codecs="av01.0.05M.08"')) return 'av1'
  if (probe.canPlayType('video/mp4; codecs="avc1.640028"') === 'probably'
    || probe.canPlayType('video/mp4; codecs="avc1.640028"') === 'maybe') return 'h264'
  return null
}

// Fetch a clip ONCE (the SW serves it cache-first — persistent across sessions until a deploy),
// hand back a blob URL reused across all mounts this session. The <video> plays from the blob, so
// no Range request ever reaches /wave/. Returns null on network failure → CSS water stays.
async function cachedURL(url: string): Promise<string | null> {
  if (blobUrls.has(url)) return blobUrls.get(url)!
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    // Force the MIME on the blob (a misconfigured host serving octet-stream would leave a <video>
    // src unplayable) — the container is always mp4 (av01 or avc1). Tiny files, so the copy is free.
    const obj = URL.createObjectURL(new Blob([await resp.arrayBuffer()], { type: 'video/mp4' }))
    blobUrls.set(url, obj)
    return obj
  } catch { return null }
}

function pickRung(): typeof RUNGS[number] {
  // Cover-fit (object-fit: cover) means either rung fills any viewport; pick by device class —
  // the portrait phone rung for coarse/narrow, the landscape desktop rung otherwise.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || window.innerWidth < 900 ? RUNGS[0] : RUNGS[1]
}

let started = false
let readyResolve: (() => void) | null = null

// Called from entry.client's gate (flag-gated). Kicks off fetch+decode; the returned promise
// resolves when the loop's first frame is decoded (or we give up → CSS water). entry.client folds
// this into `.iw-water-ready` (bounded by the gate's timeout).
export function prepareWaveVideo(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  return new Promise<void>((resolve) => {
    readyResolve = resolve
    void run().then(() => resolve()).catch(() => resolve())
  })
}
// Back-compat entry point (older entry.client) — just prepares; the gate wiring is optional.
export function initWaveVideo(): void { void prepareWaveVideo() }

async function run(): Promise<void> {
  const codec = pickCodec()
  if (!codec) return // no decodable codec — CSS water stays (the pre-AV1 AND pre-H.264 path)
  const rung = pickRung()
  const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'
  const base = `/wave/${rung.name}.${theme}.${codec}`
  const [loopSrc, brakeSrc] = await Promise.all([cachedURL(`${base}.mp4`), cachedURL(`${base}.brake.mp4`)])
  if (!loopSrc) return // night with no night clip, or fetch failure → CSS water

  const video = mkVideo(rung)
  video.loop = true
  video.src = loopSrc

  const playable = new Promise<void>((res) => {
    if (video.readyState >= 2) res()
    else video.addEventListener('loadeddata', () => res(), { once: true })
  })
  video.load()
  await Promise.race([playable, new Promise<void>((r) => setTimeout(r, 1400))])
  if (video.readyState < 2) { video.remove(); return } // not decoded in time — gate opens on CSS

  // Insert into the VISIBLE water host (not the covered editor beneath the shell) and show it.
  // If the gate is already open the host exists; if not, entry.client's gate is awaiting us, so the
  // host is in the not-yet-painted tree — retry briefly.
  const attach = () => {
    const host = document.querySelector<HTMLElement>(
      '.inkwave-editor-surface.iw-fill:not(.iw-wave-covered) .iw-wave-twinkles',
    )
    if (!host) return false
    host.appendChild(video)
    document.documentElement.classList.add('iw-wave-video-on')
    void video.play().catch(() => teardown(video, 0)) // autoplay denied → CSS water
    return true
  }
  if (!attach()) {
    let tries = 0
    const t = setInterval(() => { if (attach() || tries++ > 20) clearInterval(t) }, 50)
  }

  wireSettle(video, brakeSrc, rung)
}

function mkVideo(rung: { w: number; h: number }): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true; v.defaultMuted = true
  v.autoplay = true; v.preload = 'auto'; v.playsInline = true
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '') // older WebKit reads attributes
  v.setAttribute('aria-hidden', 'true')
  v.disablePictureInPicture = true
  v.className = 'iw-wave-video-el'
  // Cover the viewport; object-fit:cover in CSS. Fixed size hint kept off — CSS drives it.
  void rung
  return v
}

// ── SETTLE: phase-0 loop→brake swap on the media pipeline, then hand to CSS at rest ──
function wireSettle(loop: HTMLVideoElement, brakeSrc: string | null, rung: { w: number; h: number }): void {
  let done = false
  const finish = (fadeMs: number) => {
    if (done) return
    done = true
    window.removeEventListener('inkwave:reveal-imminent', onImminent)
    window.removeEventListener('inkwave:open-begin', onAbort)
    window.removeEventListener('resize', onAbort)
    document.removeEventListener('visibilitychange', onVis)
    // Reveal the CSS water (already at its own rest beneath us) and fade the video off over it.
    document.documentElement.classList.remove('iw-wave-video-on')
    loop.style.opacity = '0'
    setTimeout(() => teardown(loop, 0), fadeMs + 40)
  }

  const onImminent = () => {
    if (done) return
    if (!brakeSrc) { finish(300); return } // no brake clip — just hand back to the CSS coast
    // Swap to the BRAKE clip at the loop's phase-0 boundary. The brake is baked from phase 0, so
    // its first frame ≡ the loop's frame 0 (pixel-identical join). Preload it, wait for the loop to
    // wrap (currentTime → 0), then swap in one frame; the brake plays the S-curve slow-down.
    const brake = mkVideo(rung)
    brake.loop = false
    brake.src = brakeSrc
    brake.style.opacity = '0'
    brake.className = 'iw-wave-video-el'
    const host = loop.parentElement
    if (!host) { finish(0); return }
    host.appendChild(brake)
    const swap = () => {
      brake.style.opacity = '1'
      loop.style.opacity = '0'
      void brake.play().catch(() => finish(0))
      setTimeout(() => teardown(loop, 0), 80)
      // Brake ends at rest → hand to the CSS water (its own coast reached rest under us). A short
      // cross-fade hides the sparse mark/glitter position difference (both are still water).
      brake.addEventListener('ended', () => {
        document.documentElement.classList.remove('iw-wave-video-on')
        brake.style.opacity = '0'
        setTimeout(() => teardown(brake, 0), 240)
        done = true
      }, { once: true })
    }
    // Join at the next loop wrap for a phase-0 start; cap the wait at one loop so settle isn't
    // delayed (the brake's frame0 matches the loop's frame0 regardless, so an immediate swap is
    // also seamless — the wrap wait just avoids a mid-loop cut in the rare within-frame case).
    const startT = loop.currentTime
    let waited = 0
    const poll = setInterval(() => {
      if (done) { clearInterval(poll); return }
      if (loop.currentTime < startT || waited > 2200) { clearInterval(poll); swap() }
      waited += 40
    }, 40)
  }
  const onAbort = () => finish(0)               // new load / resize → honest CSS fallback now
  const onVis = () => { if (document.hidden) teardown(loop, 0) }
  window.addEventListener('inkwave:reveal-imminent', onImminent)
  window.addEventListener('inkwave:open-begin', onAbort)
  window.addEventListener('resize', onAbort)
  document.addEventListener('visibilitychange', onVis)
  loop.addEventListener('error', onAbort)
}

function teardown(v: HTMLVideoElement, delay: number): void {
  setTimeout(() => { try { v.pause() } catch { /* detached */ } v.remove() }, delay)
  if (readyResolve) { readyResolve(); readyResolve = null }
}
