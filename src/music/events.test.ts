// @vitest-environment jsdom
//
// The timing model (§B3). These numbers are arithmetic a reader can check by hand — the fixtures
// are deliberately at 60bpm (one quarter note = exactly one second) so an expected value is
// obvious rather than something copied out of whatever the code happened to print.

import { describe, expect, it } from 'vitest'
import { parseMusicXml } from './parse'
import {
  measureAtSeconds,
  measureRangeSeconds,
  noteEvents,
  quartersToSeconds,
  scoreDurationSeconds,
} from './events'
import { PIANO_SCORE, REST_START_SCORE, SIMPLE_SCALE, TEMPO_CHANGE_SCORE, TIED_SCORE } from './scoreFixtures'

const STEADY = [{ onsetQuarters: 0, bpm: 60 }]   // 1 quarter note = 1 second

describe('quartersToSeconds', () => {
  it('converts at a steady tempo', () => {
    expect(quartersToSeconds(STEADY, 0)).toBe(0)
    expect(quartersToSeconds(STEADY, 4)).toBe(4)
  })

  it('scales with the tempo', () => {
    expect(quartersToSeconds([{ onsetQuarters: 0, bpm: 120 }], 4)).toBe(2)
  })

  it('INTEGRATES across a tempo change instead of scaling by one global bpm', () => {
    // The distinction that matters: bars 1 (60bpm) then 2-3 (120bpm).
    // A single-tempo model would say 12 quarters × 1s = 12s, or × 0.5s = 6s. Neither is right.
    const tempos = [{ onsetQuarters: 0, bpm: 60 }, { onsetQuarters: 4, bpm: 120 }]
    expect(quartersToSeconds(tempos, 4)).toBe(4)   // 4 quarters at 60
    expect(quartersToSeconds(tempos, 8)).toBe(6)   // + 4 quarters at 120 = 2s
    expect(quartersToSeconds(tempos, 12)).toBe(8)  // + 4 more at 120 = 2s
  })

  it('handles a position part-way through a tempo segment', () => {
    const tempos = [{ onsetQuarters: 0, bpm: 60 }, { onsetQuarters: 4, bpm: 120 }]
    expect(quartersToSeconds(tempos, 6)).toBe(5)   // 4s + 2 quarters at 120 = 1s
  })

  it('never returns negative time', () => {
    expect(quartersToSeconds(STEADY, -5)).toBe(0)
  })
})

describe('noteEvents', () => {
  it('times a scale one note per second at 60bpm', () => {
    const events = noteEvents(parseMusicXml(SIMPLE_SCALE))
    expect(events.slice(0, 4).map(e => [e.timeSec, e.midi])).toEqual([
      [0, 60], [1, 62], [2, 64], [3, 65],
    ])
  })

  it('gives every event a duration', () => {
    const events = noteEvents(parseMusicXml(SIMPLE_SCALE))
    expect(events[0].durationSec).toBe(1)
    expect(events[events.length - 1].durationSec).toBe(2) // the closing half note
  })

  it('drops rests but keeps the silence they created', () => {
    const events = noteEvents(parseMusicXml(PIANO_SCORE))
    // No event may be pitchless...
    expect(events.every(e => Number.isFinite(e.midi))).toBe(true)
    // ...but the D4 after bar 2's half rest still lands where the rest left it. PIANO_SCORE has no
    // tempo mark → 120bpm → a quarter note is 0.5s, so quarter 6 is 3s.
    expect(events.find(e => e.midi === 62)?.timeSec).toBe(3)
  })

  it('sounds a chord as simultaneous events', () => {
    const events = noteEvents(parseMusicXml(PIANO_SCORE))
    const atZero = events.filter(e => e.timeSec === 0).map(e => e.midi)
    expect(atZero).toEqual([36, 60, 64, 67]) // C2 bass + C major triad, all together
  })

  it('plays a tie as ONE long event, not two', () => {
    const events = noteEvents(parseMusicXml(TIED_SCORE))
    expect(events).toHaveLength(1)
    expect(events[0].durationSec).toBe(4) // 8 quarters at 120bpm
  })

  it('tags each event with the bar it belongs to', () => {
    const events = noteEvents(parseMusicXml(SIMPLE_SCALE))
    expect(events[0].measureIndex).toBe(0)
    expect(events[4].measureIndex).toBe(1)
  })
})

describe('noteEvents — excerpt playback (§B6: excerpts are playable)', () => {
  it('includes only the requested bars', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    const events = noteEvents(score, { fromMeasureIndex: 1, toMeasureIndex: 2 })
    expect(new Set(events.map(e => e.measureIndex))).toEqual(new Set([1, 2]))
  })

  it('rebases so an excerpt plays immediately, not after the bars it does not show', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    const raw = noteEvents(score, { fromMeasureIndex: 2, toMeasureIndex: 2 })
    const rebased = noteEvents(score, { fromMeasureIndex: 2, toMeasureIndex: 2, rebase: true })

    expect(raw[0].timeSec).toBe(8)      // bar 3 sits 8s into the piece...
    expect(rebased[0].timeSec).toBe(0)  // ...but the excerpt starts now.
  })

  it('rebases to the BAR, not to the first note — a bar opening on a rest keeps its silence', () => {
    // The subtle one, and the one this suite got WRONG first time. Rebasing to the first sounding
    // note would slide the excerpt onto the downbeat and play it on the wrong beat — audible, and
    // invisible to a test that only checks "the first event starts at 0".
    //
    // It MUST be tested on a bar where every voice opens with a rest (REST_START_SCORE). The
    // original fixture had a bass note on the downbeat, which made both implementations agree; a
    // mutation to the wrong one passed all 27 tests. See REST_START_SCORE's comment.
    const score = parseMusicXml(REST_START_SCORE)
    const events = noteEvents(score, { fromMeasureIndex: 1, toMeasureIndex: 1, rebase: true })

    expect(events).toHaveLength(1)
    // Bar 2 starts at quarter 4; the D4 sounds at quarter 6. At 120bpm that is 1s AFTER the bar
    // opens — the rest is preserved. Rebasing to the first note would put it at 0.
    expect(events[0].midi).toBe(62)
    expect(events[0].timeSec).toBe(1)
  })

  it('slows down without changing the notes (§B3 tempo control)', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    const half = noteEvents(score, { tempoScale: 0.5 })
    expect(half[1].timeSec).toBe(2)        // was 1s at full speed
    expect(half[0].durationSec).toBe(2)    // notes are held longer too
    expect(half.map(e => e.midi)).toEqual(noteEvents(score).map(e => e.midi)) // same music
  })

  it('ignores a nonsense tempo scale rather than dividing by zero', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    expect(noteEvents(score, { tempoScale: 0 })[1].timeSec).toBe(1)
  })
})

describe('measureRangeSeconds — bar-range loops and citations (§B3/§B4)', () => {
  it('gives the wall-clock span of a bar range', () => {
    const score = parseMusicXml(SIMPLE_SCALE) // 60bpm, 4/4 → 4s per bar
    expect(measureRangeSeconds(score, 1, 2)).toEqual({ startSec: 4, endSec: 12 })
  })

  it('spans a single bar', () => {
    expect(measureRangeSeconds(parseMusicXml(SIMPLE_SCALE), 0, 0)).toEqual({ startSec: 0, endSec: 4 })
  })

  it('honours a tempo change inside the range', () => {
    const score = parseMusicXml(TEMPO_CHANGE_SCORE)
    expect(measureRangeSeconds(score, 0, 2)).toEqual({ startSec: 0, endSec: 8 })
  })

  it('returns null for a bar that does not exist, rather than a bogus span', () => {
    expect(measureRangeSeconds(parseMusicXml(SIMPLE_SCALE), 0, 99)).toBeNull()
  })
})

describe('measureAtSeconds — the automatic cursor (§B3)', () => {
  it('reports which bar is sounding', () => {
    const score = parseMusicXml(SIMPLE_SCALE) // 4s per bar
    expect(measureAtSeconds(score, 0)).toBe(0)
    expect(measureAtSeconds(score, 3.9)).toBe(0)
    expect(measureAtSeconds(score, 4)).toBe(1)   // the boundary belongs to the NEW bar
    expect(measureAtSeconds(score, 9)).toBe(2)
  })

  it('follows a tempo change, so the cursor does not drift', () => {
    // The payoff of clean notation: bar 2 starts at 4s, and bar 3 at 6s — NOT 8s, which is what a
    // fixed-tempo cursor would say. Drift like this is exactly what tap-sync exists to avoid, and
    // what the MusicXML path gets for free.
    const score = parseMusicXml(TEMPO_CHANGE_SCORE)
    expect(measureAtSeconds(score, 4)).toBe(1)
    expect(measureAtSeconds(score, 6)).toBe(2)
    expect(measureAtSeconds(score, 5.9)).toBe(1)
  })

  it('reports nothing before the start or after the end', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    expect(measureAtSeconds(score, -1)).toBeNull()
    expect(measureAtSeconds(score, 999)).toBeNull()
  })

  it('tracks the slowed-down clock when the tempo is scaled', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    // At half speed a bar lasts 8s, so 6s is still bar 1 — where full speed would already be bar 2.
    expect(measureAtSeconds(score, 6, 0.5)).toBe(0)
    expect(measureAtSeconds(score, 6, 1)).toBe(1)
  })
})

describe('scoreDurationSeconds', () => {
  it('measures the whole piece', () => {
    expect(scoreDurationSeconds(parseMusicXml(SIMPLE_SCALE))).toBe(16) // 4 bars × 4s
  })

  it('accounts for a tempo change', () => {
    expect(scoreDurationSeconds(parseMusicXml(TEMPO_CHANGE_SCORE))).toBe(8)
  })

  it('stretches when slowed down', () => {
    expect(scoreDurationSeconds(parseMusicXml(SIMPLE_SCALE), 0.5)).toBe(32)
  })
})
