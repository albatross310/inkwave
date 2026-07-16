// ─── Wave loop+brake video generator (production ladder, 2026-07-15) ─────────────────────────
// Renders the REAL app's load water — gradient + drifting wave lines + the STATIC single-band wave
// marks + glitters — into short seamless LOOP clips + phase-0 BRAKE clips, per rung × theme × codec,
// committed under public/wave/ and played by src/editor/waveVideo.ts behind `inkwave:waveVideo`.
//
// WHY SCREENSHOTS OF THE LIVE APP: the clip must be pixel-authentic to the CSS water (it IS the
// water on the load). We load the BUILT app, re-raise the loading shell (bare open-begin), pause
// EVERY animation on one normalized clock (frame 0 ≡ drift phase 0), and step them in lockstep.
//
// STATIC MARKS: the wave marks are baked static + single-band (Peter's rebuild). The rest layer is
// shown (blink layer hidden) and drifts with the wave via the tile-drift keyframe, so a mark stays
// on the wave and the LINES loop seamlessly at one tile (1.944s). Marks + glitters that don't close
// at one tile pop softly at the seam (measured ~0.1-0.27% of px, sparse — Peter: "doesn't matter").
//
// LOOP = one tile (120 content frames @ 60fps = 2.0s; the 60fps-exact retime — content sampled at
// 16.2ms, played 60fps → a 2000ms/70px-s loop, 2.8% slower than the DOM's 1944ms, imperceptible).
// BRAKE = the S-curve slow-down (v_total = v·(1−smoothstep(τ)); phone 2s/72px, desktop 2.5s/90px),
// stepped FROM phase 0 so brake frame 0 ≡ loop frame 0 — the media-pipeline loop→brake join is
// pixel-identical (waveVideo swaps at the loop wrap).
//
// CODECS: AV1 (libsvtav1, tiny — modern) + H.264 (libx264, universal — iPhone 8 / A11, no AV1).
// FILENAMES (must match waveVideo.ts): {rung}.{theme}.{codec}.mp4 (loop) and
// {rung}.{theme}.{codec}.brake.mp4 (brake), rung ∈ {phone,desk}, theme ∈ {day,night}, codec ∈ {av1,h264}.
//
// Usage:  node scripts/wave-video/generate.mjs [rung ...] [--theme day|night|both]
//   env:  PORT=4319 KEEP_FRAMES=1 CRF_AV1=58 CRF_H264=30
// Needs: the app built (pnpm build), @playwright/test, ffmpeg (libsvtav1 + libx264).
// Runtime is minutes per rung×theme. Run MANUALLY after any water-look change, NEVER from pnpm build.
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const OUT = join(ROOT, 'public', 'wave')
const BUILD = join(ROOT, 'build', 'client')

// The ladder — MUST mirror RUNGS in src/editor/waveVideo.ts. Cover-fit (object-fit: cover) means one
// clip fills any viewport, so just two: a portrait phone rung + a landscape desktop rung. vw/vh/dsf
// = capture geometry; encW/encH = the encoded resolution (the measured crisp floor); coastT = brake ms.
const LADDER = [
  { name: 'phone', vw: 440, vh: 956, dsf: 2, encW: 540, encH: 1170, mobile: true, coastT: 2000 },
  { name: 'desk', vw: 1280, vh: 800, dsf: 1, encW: 1280, encH: 800, mobile: false, coastT: 2500 },
]
const DT_CONTENT = 16.2 // ms of animation time per video frame (120 per 1944ms tile loop)
const FPS = 60
// LOOP LENGTH. 120 = ONE tile loop (k=1, 2.0s): the wave LINES close exactly (the tile is
// 140px-periodic), but the glitters/marks are mid-schedule at the wrap → a sparse seam pop
// (measured 0.27% of px, a few instances). 1440 = the FULL POOL CYCLE (k=12, 23.328s): every
// animation period divides the span, so the seam is EXACT (frame 1440 ≡ frame 0, byte-identical)
// and there is no pop at all — at ~8-12× the bytes. k=1 is the shipped default; set
// LOOP_FRAMES=1440 for the seam-exact clip once the capture harness is stable for long runs
// (2026-07-15: the headless renderer dies silently past ~100-400 frames — see the report).
const LOOP_FRAMES = Number(process.env.LOOP_FRAMES || 120)
const CRF_AV1 = process.env.CRF_AV1 || '58'
const CRF_H264 = process.env.CRF_H264 || '30'
const PORT = Number(process.env.PORT || 4319)
// FIXED pool seed — the loop and brake clips are captured in separate browser sessions and MUST
// bake the identical marks/glitters, or the phase-0 loop→brake swap teleports them. Any constant
// works; change it only to reroll the baked geography (then regenerate the whole matrix).
const POOL_SEED = Number(process.env.POOL_SEED || 20260715)

const themeArg = (() => { const i = process.argv.indexOf('--theme'); return i >= 0 ? process.argv[i + 1] : 'both' })()
const THEMES = themeArg === 'both' ? ['day', 'night'] : [themeArg]
const wantRungs = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== themeArg)
const rungs = wantRungs.length ? LADDER.filter((r) => wantRungs.includes(r.name)) : LADDER

if (!existsSync(join(BUILD, 'index.html'))) { console.error('build/client missing — run pnpm build first'); process.exit(1) }
mkdirSync(OUT, { recursive: true })

// ── Fallback-faithful static server (own port, own PID — never touch other agents' servers) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
const server = createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '')
    let file = join(BUILD, p)
    if (p === '' || (existsSync(file) && statSync(file).isDirectory())) file = join(file, 'index.html')
    if (!existsSync(file)) file = join(BUILD, '__spa-fallback.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e)) }
})
await new Promise((r) => server.listen(PORT, r))

// cumulative drift-advance (ms) realising the coast displacement at time t (ms) — v cancels out:
// cum(t)=∫0..t(1−smoothstep(τ/T))dτ = t − t³/T² + t⁴/(2T³) (total displacement = vT/2 = 72/90px).
const cum = (t, T) => { const x = t / T; return t - t * x * x + (t * x * x * x) / 2 }
const kb = (f) => (statSync(f).size / 1024).toFixed(0)

async function capture(rung, theme, mode /* 'loop' | 'brake' */, dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
  const ctx = await browser.newContext({
    viewport: { width: rung.vw, height: rung.vh }, deviceScaleFactor: rung.dsf,
    ...(rung.mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
  })
  const page = await ctx.newPage()
  await page.addInitScript((cfg) => {
    try { if (cfg.th === 'night') localStorage.setItem('inkwave:theme', 'night'); else localStorage.removeItem('inkwave:theme') } catch { /* private */ }
    // FIXED POOL SEED + cleared strike memory: the LOOP and BRAKE clips are captured in separate
    // browser sessions, so without this they'd bake DIFFERENT marks/glitters and the phase-0
    // loop→brake swap would teleport them (measured 5.8% of pixels). Same seed ⇒ same pool ⇒ the
    // join is pixel-exact. (waveTwinkle reads __iwTwkSeed only when set — test seam.)
    window.__iwTwkSeed = cfg.seed
    try { localStorage.removeItem('inkwave:twkMem:v2') } catch { /* private */ }
    window.__iwRest = 0; window.addEventListener('inkwave:wave-rest', () => window.__iwRest++)
    for (const n of ['inkwave:reveal-imminent', 'inkwave:load-watchdog']) window.addEventListener(n, (e) => { if (window.__iwBlock) e.stopImmediatePropagation() })
    try { localStorage.removeItem('inkwave:waveVideo') } catch { /* private */ }
  }, { th: theme, seed: POOL_SEED })
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__iwRest > 0, null, { timeout: 30000 })
  await page.waitForTimeout(700)
  await page.evaluate(() => { window.__iwBlock = true; window.dispatchEvent(new Event('inkwave:open-begin')) })
  await page.waitForFunction(() => document.getAnimations().some((a) => a.animationName === 'iw-wave-drift-l'), null, { timeout: 20000 })
  await page.waitForTimeout(2500)
  // NB: NO "static marks" injection (2026-07-15 — measured, geometrically impossible). Baking the
  // marks STATIC and drifting them with the wave needs the mark field to be 140px-PERIODIC, or the
  // 140px drift loop teleports every mark at each wrap. It is not: of 117 marks, ZERO have a
  // partner at x+140 and x-mod-140 spreads over 81 distinct values across the ~1783px strip — a
  // static field on the tile drift would snap ~139px every 1.944s (a whole-field jump, far worse
  // than any seam). The BLINK design is exactly what makes marks work against a drifting wave:
  // each rides a wave-locked slot ~1s then relocates in its dark window, and the whole schedule is
  // CYCLE-periodic — so the video simply bakes the water AS IT IS and loops at the FULL CYCLE
  // (LOOP_FRAMES 1440 = 23.328s), where every animation period divides the span and the seam is
  // EXACT (verified below by a byte-compare of frame N against frame 0).
  await page.evaluate(() => {
    const anims = document.getAnimations()
    const drift = anims.find((a) => a.animationName === 'iw-wave-drift-l')
    const phi0 = (Number(drift.currentTime) % 1944 + 1944) % 1944
    window.__base = { drift: Number(drift.currentTime) - phi0 + 23328, pool: null }
    window.__step = new Map()
    for (const a of anims) { a.pause(); const dur = a.effect?.getComputedTiming?.().duration; if (dur === 23328 && window.__base.pool == null) window.__base.pool = Number(a.currentTime) - phi0 + 23328; window.__step.set(a, Number(a.currentTime) - phi0 + 23328) }
    if (window.__base.pool == null) window.__base.pool = window.__base.drift
    window.__seek = (t) => { for (const a of document.getAnimations()) { let b = window.__step.get(a); if (b === undefined) { a.pause(); const dur = a.effect?.getComputedTiming?.().duration; b = dur === 1944 ? window.__base.drift : window.__base.pool; window.__step.set(a, b) } a.currentTime = b + t } }
  })
  const frames = mode === 'loop' ? LOOP_FRAMES : Math.round(rung.coastT / 1000 * FPS) + 1
  console.log(`  ${rung.name}/${theme}/${mode}: ${frames} frames @ ${rung.encW}x${rung.encH}`)
  const cdp = await ctx.newCDPSession(page)
  for (let k = 0; k < frames; k++) {
    const t = mode === 'loop' ? k * DT_CONTENT : cum(k / (frames - 1) * rung.coastT, rung.coastT)
    await page.evaluate((tt) => window.__seek(tt), t)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: rung.vw, height: rung.vh, scale: rung.dsf } })
    writeFileSync(join(dir, `f${String(k).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'))
  }
  await browser.close()
  return frames
}

// Encode one frame dir to BOTH codecs. suffix = '' (loop) or '.brake' — the codec sits BEFORE it,
// so the output is {prefix}.{codec}{suffix}.mp4, matching waveVideo.ts's URL scheme exactly.
function encode(dir, frames, rung, prefix, suffix) {
  const S = `scale=${rung.encW}:${rung.encH}:flags=lanczos`
  const input = ['-framerate', String(FPS), '-i', join(dir, 'f%05d.png'), '-frames:v', String(frames), '-vf', S]
  const av1 = `${prefix}.av1${suffix}.mp4`, h264 = `${prefix}.h264${suffix}.mp4`
  execFileSync('ffmpeg', ['-y', ...input, '-c:v', 'libsvtav1', '-crf', CRF_AV1, '-preset', '6', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', av1], { stdio: 'ignore' })
  // iPhone-8-conservative H.264: Main profile @ Level 4.0 (A11 handles High, but Main is
  // universally decodable), yuv420p, and +faststart (moov atom at the FRONT — without it, a
  // Range-less first load never reaches the metadata and readyState sticks at 0).
  execFileSync('ffmpeg', ['-y', ...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF_H264, '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-level:v', '4.0', '-movflags', '+faststart', h264], { stdio: 'ignore' })
  console.log(`    → ${prefix.split('/').pop()}.<codec>${suffix}.mp4: av1 ${kb(av1)}KB · h264 ${kb(h264)}KB`)
}

for (const rung of rungs) {
  for (const theme of THEMES) {
    for (const mode of ['loop', 'brake']) {
      const dir = join(tmpdir(), `iw-wv-${rung.name}-${theme}-${mode}-${process.pid}`)
      const frames = await capture(rung, theme, mode, dir)
      encode(dir, frames, rung, join(OUT, `${rung.name}.${theme}`), mode === 'loop' ? '' : '.brake')
      if (!process.env.KEEP_FRAMES) rmSync(dir, { recursive: true, force: true })
    }
  }
}
server.close()
console.log('\nDone. Clips under public/wave/. Verify playback + sizes; commit the matched set.')
