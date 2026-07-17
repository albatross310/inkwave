// §A4's reference track — the pure parts.
//
// The adapters themselves need a browser (an <audio> element, a cross-origin iframe) and are driven
// by `music.prove.mjs`. What is testable here is what a URL means and what the loop does at its
// boundary — the off-by-one `player.ts` calls "miserable to debug through a speaker".

import { describe, expect, it, vi } from 'vitest'
import { driveLoop, youtubeIdOf, PLAYBACK_RATES, type ReferencePlayer } from './reference'

describe('youtubeIdOf', () => {
  it('accepts the forms a student actually pastes', () => {
    const ID = 'dQw4w9WgXcQ'
    expect(youtubeIdOf(ID)).toBe(ID)
    expect(youtubeIdOf(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(youtubeIdOf(`https://youtu.be/${ID}`)).toBe(ID)
    expect(youtubeIdOf(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
    expect(youtubeIdOf(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID)
    // The share link carries a timestamp and a tracking param — both must survive.
    expect(youtubeIdOf(`https://www.youtube.com/watch?v=${ID}&t=42s&si=abc`)).toBe(ID)
    expect(youtubeIdOf(`  https://youtu.be/${ID}  `)).toBe(ID)
  })

  it('REFUSES a non-YouTube URL rather than scraping an id out of it', () => {
    // An 11-char path segment is not an id just because it is 11 chars long. Refusing means the UI
    // says "that doesn't look like a YouTube link" instead of embedding something arbitrary.
    expect(youtubeIdOf('https://vimeo.com/dQw4w9WgXcQ')).toBeNull()
    expect(youtubeIdOf('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeIdOf('https://open.spotify.com/track/abc')).toBeNull()   // §A4: no Spotify, ever
    expect(youtubeIdOf('not a url')).toBeNull()
    expect(youtubeIdOf('')).toBeNull()
  })

  it('is not fooled by a hostname that merely ENDS with the real one', () => {
    // `notyoutube.com` and `youtube.com.evil.example` must not pass.
    expect(youtubeIdOf('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeIdOf('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    // …while a real subdomain still does.
    expect(youtubeIdOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
})

describe('the loop driver', () => {
  function fakePlayer(over: Partial<ReferencePlayer> = {}): ReferencePlayer & { t: number } {
    // Annotated explicitly: `time: () => p.t` references `p` inside its own initializer, so TS
    // cannot infer the type without one (TS7022).
    const p: ReferencePlayer & { t: number } = {
      t: 0,
      kind: 'file' as const,
      time: () => p.t,
      duration: () => 100,
      play: async () => {},
      pause: () => {},
      playing: () => true,
      seek: (s: number) => { p.t = s },
      setRate: () => {},
      rate: () => 1,
      destroy: () => {},
      ...over,
    }
    return p
  }

  it('folds the playhead back to the loop start when it runs past the end', () => {
    vi.useFakeTimers()
    const p = fakePlayer()
    const stop = driveLoop(p, () => ({ startSec: 8, endSec: 14 }))
    p.t = 14.5
    vi.advanceTimersByTime(100)
    expect(p.t).toBeCloseTo(8.5, 6)     // wrapped, keeping the overshoot — never a hard jump to 8
    stop()
    vi.useRealTimers()
  })

  it('does not seek while the playhead is inside the loop — a seek per tick would stutter', () => {
    vi.useFakeTimers()
    const seek = vi.fn()
    const p = fakePlayer({ seek })
    p.t = 10
    const stop = driveLoop(p, () => ({ startSec: 8, endSec: 14 }))
    vi.advanceTimersByTime(300)
    expect(seek).not.toHaveBeenCalled()
    stop()
    vi.useRealTimers()
  })

  it('does nothing while paused, or with no loop set', () => {
    vi.useFakeTimers()
    const seek = vi.fn()
    const paused = fakePlayer({ seek, playing: () => false })
    paused.t = 99
    const s1 = driveLoop(paused, () => ({ startSec: 8, endSec: 14 }))
    const noLoop = fakePlayer({ seek })
    noLoop.t = 99
    const s2 = driveLoop(noLoop, () => null)
    vi.advanceTimersByTime(300)
    expect(seek).not.toHaveBeenCalled()
    s1(); s2(); vi.useRealTimers()
  })

  it('stops when told to — a leaked interval would seek a destroyed player forever', () => {
    vi.useFakeTimers()
    const seek = vi.fn()
    const p = fakePlayer({ seek })
    const stop = driveLoop(p, () => ({ startSec: 8, endSec: 14 }))
    stop()
    p.t = 20
    vi.advanceTimersByTime(300)
    expect(seek).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('the playback rates', () => {
  it('offers only rates BOTH adapters honour', () => {
    // YouTube accepts a fixed set; an <audio> element accepts anything. A slider would snap on one
    // path and not the other — the same control meaning two different things.
    for (const r of PLAYBACK_RATES) expect(r).toBeGreaterThanOrEqual(0.25)
    expect(PLAYBACK_RATES).toContain(1)
    expect(Math.max(...PLAYBACK_RATES)).toBe(1)   // slow-DOWN: §A4 asks for practice, not speed-run
  })
})
