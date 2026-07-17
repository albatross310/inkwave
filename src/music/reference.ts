// ─── §A4: the reference track ────────────────────────────────────────────────
//
// "Reference source (free / self-serve): paste a YouTube link (IFrame API: embed, `seekTo`,
// `setPlaybackRate` for slow-down) or upload an audio file (full control: waveform, loop,
// slow-down). **No Spotify, no licensed embed.**"
//
// ONE INTERFACE, ADAPTERS — the `MailSender` precedent (`email/sender.ts`), for the same reason:
// `sync.ts` needs a CLOCK and a seek, and it must not care whether they come from an `<audio>`
// element or a cross-origin iframe. That is also what makes §C3's dependency risk survivable —
// "videos can be region-locked/removed… user-file upload is the resilient fallback and should ship
// alongside" — because the fallback is a different adapter, not a different feature.
//
// ⚠️ NOT SPOTIFY, and this is a product constraint rather than an oversight: Premium-only (so it
// paywalls a free tier) and no playback-rate control (so it cannot do the one thing a practising
// student needs). Do not add it.

export type ReferenceKind = 'youtube' | 'file'

export interface ReferencePlayer {
  readonly kind: ReferenceKind
  /** Current position, in track seconds. This is what `cursorAt` is fed. */
  time(): number
  duration(): number
  play(): Promise<void>
  pause(): void
  playing(): boolean
  /** §A4: "seek-to-bar (jump the track to a bar's timestamp)". */
  seek(sec: number): void
  /** §A4: slow-down. 1 = normal. */
  setRate(rate: number): void
  rate(): number
  destroy(): void
}

// ─── The loop ────────────────────────────────────────────────────────────────

/**
 * §A4: "loop-a-section (define a loop between two bar anchors for repetitive practice)".
 *
 * The DRIVER, not the player: both adapters get looping from this one function, because a loop is a
 * rule about time and neither an `<audio>` element nor a YouTube iframe knows anything about bars.
 * `wrapLoop` is REUSED from `player.ts` (the MusicXML lane's) rather than rewritten — it is pure,
 * it already exists, and §B3's "loop a bar-range" is the same concept with a different clock. Two
 * implementations of "where does the playhead go at the loop boundary" is exactly how the off-by-one
 * that file warns about ("miserable to debug through a speaker") gets in twice.
 */
import { wrapLoop } from './player'

export interface LoopRange { startSec: number; endSec: number }

/**
 * Watch a player and fold it back into `loop`. Returns a stop function.
 *
 * Polls rather than using a timeupdate event: `<audio>`'s timeupdate fires ~4×/s (far too coarse —
 * a loop would overshoot by up to 250ms, audibly), and the YouTube IFrame API has no time event at
 * all, so its position must be polled regardless. One mechanism for both.
 */
export function driveLoop(
  player: ReferencePlayer, getLoop: () => LoopRange | null, intervalMs = 60,
): () => void {
  const id = setInterval(() => {
    const loop = getLoop()
    if (!loop || !player.playing()) return
    const t = player.time()
    const wrapped = wrapLoop(t, loop)
    // Only seek when the wrap actually moved us — seeking every tick would stutter the audio and,
    // on YouTube, hammer the iframe with postMessage.
    if (Math.abs(wrapped - t) > 0.02) player.seek(wrapped)
  }, intervalMs)
  return () => clearInterval(id)
}

// ─── The file adapter ────────────────────────────────────────────────────────
//
// §A4's "upload an audio file (full control…)" and §C3's resilient fallback. It is a plain
// HTMLAudioElement, which is the point: no third party, no network, no ToS, and it works offline.

export function makeFilePlayer(src: string): ReferencePlayer {
  const el = new Audio(src)
  el.preload = 'metadata'
  return {
    kind: 'file',
    time: () => el.currentTime,
    duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
    play: () => el.play(),
    pause: () => el.pause(),
    playing: () => !el.paused && !el.ended,
    seek: (s) => { el.currentTime = s },
    // `preservesPitch` — WITHOUT it, half speed drops the recording an octave and the student is
    // practising against a different piece. It is the default in modern engines but is explicitly
    // asserted here because the whole point of the slow-down is to hear the SAME music, slower.
    setRate: (r) => { el.preservesPitch = true; el.playbackRate = r },
    rate: () => el.playbackRate,
    destroy: () => { el.pause(); el.src = '' },
  }
}

// ─── The YouTube adapter ─────────────────────────────────────────────────────
//
// §A4/§C1: the YouTube IFrame Player API — free, self-serve, no licence to negotiate. It is also
// the one part of this module that talks to a third party, so:
//
// · **`youtube-nocookie.com`, always.** Inkwave's whole posture is that it holds nothing about the
//   writer; embedding the tracking-cookie host would quietly make that false ON THE STUDENT'S
//   BEHALF, on a page they think is private. The nocookie host is the same player and the same API.
// · The CSP (`middleware.ts`) had NO youtube host and NO iframe anywhere in this repo — this is the
//   first one. `frame-src` + `script-src` were added narrowly, for this host only.
// · §C3's risk is real and unfixable from here: a video can be region-locked or removed. The file
//   adapter is the answer and ships alongside — do not let the YouTube path become the only one.

/** The one place a YouTube id is extracted. A URL a student pastes is not a clean id. */
export function youtubeIdOf(input: string): string | null {
  const s = input.trim()
  // A bare id — 11 chars of the YouTube alphabet.
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (!/(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null
    if (u.hostname.endsWith('youtu.be')) {
      const id = u.pathname.slice(1)
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    const v = u.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    // /embed/<id> and /live/<id>
    const m = u.pathname.match(/^\/(?:embed|live|v)\/([\w-]{11})/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(sec: number, allowSeekAhead: boolean): void
  setPlaybackRate(rate: number): void
  getPlaybackRate(): number
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}

let apiPromise: Promise<void> | null = null

/**
 * Load the IFrame API script, once.
 *
 * A LATCH, not an event — the shape CLAUDE.md records as a live bug class in two lanes on one day:
 * `onYouTubeIframeAPIReady` is a ONE-SHOT global that fires exactly once, so a second caller that
 * merely subscribes waits forever. Memoising the promise means "already happened" resolves
 * immediately, "in flight" shares, and "never started" starts it.
 */
function loadYouTubeApi(): Promise<void> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void }
    if (w.YT?.Player) return resolve()
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => reject(new Error('YouTube’s player could not be loaded.'))
    document.head.appendChild(s)
  })
  return apiPromise
}

export async function makeYouTubePlayer(host: HTMLElement, videoId: string): Promise<ReferencePlayer> {
  await loadYouTubeApi()
  const YT = (window as unknown as { YT: { Player: new (el: HTMLElement, o: unknown) => YTPlayer; PlayerState: { PLAYING: number } } }).YT

  const yt = await new Promise<YTPlayer>((resolve, reject) => {
    const p: YTPlayer = new YT.Player(host, {
      videoId,
      host: 'https://www.youtube-nocookie.com',   // see the banner: never the tracking host
      playerVars: {
        // No related videos from other channels, no annotations, no branding — this is a practice
        // tool, not a viewing session, and a student practising bar 24 must not be offered a mix.
        rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
      },
      events: {
        onReady: () => resolve(p),
        onError: () => reject(new Error('That video can’t be played here — it may be private, removed, or blocked in your country.')),
      },
    })
  })

  return {
    kind: 'youtube',
    // getCurrentTime() is the ONLY clock the iframe offers, and it is coarse (~250ms granularity).
    // That is a REAL limit on the cursor's smoothness on this path — the file adapter's is exact —
    // and it is why `cursorAt` interpolates from the BEAT MAP rather than from the clock's deltas.
    time: () => yt.getCurrentTime(),
    duration: () => yt.getDuration(),
    play: async () => { yt.playVideo() },
    pause: () => yt.pauseVideo(),
    playing: () => yt.getPlayerState() === YT.PlayerState.PLAYING,
    seek: (s) => yt.seekTo(s, true),
    setRate: (r) => yt.setPlaybackRate(r),
    rate: () => yt.getPlaybackRate(),
    destroy: () => yt.destroy(),
  }
}

/**
 * The rates §A4's slow-down offers.
 *
 * YouTube accepts only a fixed set (`getAvailablePlaybackRates()` → 0.25…2), so offering a slider
 * would silently snap on one adapter and not the other — the same control meaning two things. These
 * are the rates BOTH paths honour.
 */
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1] as const
