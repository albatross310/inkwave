// @vitest-environment jsdom
//
// The transport (§B3). Two layers, tested differently:
//
//  - `eventsInWindow` / `wrapLoop` are pure → tested directly, including their boundaries.
//  - `ScorePlayer` is driven against a FAKE AudioContext whose clock we advance by hand, plus a
//    recording Instrument. That lets us assert what was scheduled and WHEN — on the audio clock —
//    which is the property the whole design rests on and which no amount of listening would confirm.
//
// The fake is a stand-in for the CLOCK and the SPEAKER, not for the code under test: the real
// ScorePlayer, the real event generation and the real tempo map all run.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventsInWindow, ScorePlayer, wrapLoop } from './player'
import { midiToFreq } from './synth'
import { parseMusicXml } from './parse'
import { SIMPLE_SCALE } from './scoreFixtures'
import type { Instrument } from './synth'
import type { NoteEvent } from './score'

const ev = (timeSec: number, midi = 60, measureIndex = 0): NoteEvent =>
  ({ timeSec, durationSec: 1, midi, measureIndex, noteId: `n${timeSec}` })

describe('eventsInWindow', () => {
  const events = [ev(0), ev(1), ev(2), ev(3)]

  it('selects the events inside the window', () => {
    expect(eventsInWindow(events, 1, 3).map(e => e.timeSec)).toEqual([1, 2])
  })

  it('is half-open, so a tick boundary cannot fire a note twice', () => {
    // The bug this prevents: consecutive windows [0,2) and [2,4) must not BOTH contain t=2.
    const first = eventsInWindow(events, 0, 2).map(e => e.timeSec)
    const second = eventsInWindow(events, 2, 4).map(e => e.timeSec)
    expect(first).toEqual([0, 1])
    expect(second).toEqual([2, 3])
    expect(first.filter(t => second.includes(t))).toEqual([])
  })

  it('returns nothing for an empty window', () => {
    expect(eventsInWindow(events, 2, 2)).toEqual([])
  })
})

describe('wrapLoop', () => {
  const loop = { startSec: 4, endSec: 8 }

  it('passes a position inside the loop through untouched', () => {
    expect(wrapLoop(5, loop)).toBe(5)
  })

  it('folds a position past the end back into the loop', () => {
    expect(wrapLoop(8, loop)).toBe(4)   // exactly at the end → back to the start
    expect(wrapLoop(9, loop)).toBe(5)
    expect(wrapLoop(13, loop)).toBe(5)  // more than one lap
  })

  it('pulls a position before the loop up to its start', () => {
    expect(wrapLoop(0, loop)).toBe(4)
  })

  it('does nothing without a loop', () => {
    expect(wrapLoop(99, null)).toBe(99)
  })

  it('does not divide by zero on a degenerate loop', () => {
    expect(wrapLoop(10, { startSec: 4, endSec: 4 })).toBe(4)
  })
})

describe('midiToFreq', () => {
  it('anchors A4 at 440Hz', () => {
    expect(midiToFreq(69)).toBe(440)
  })

  it('doubles every octave', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
  })

  it('puts middle C near 261.63Hz', () => {
    expect(midiToFreq(60)).toBeCloseTo(261.626, 3)
  })
})

// ─── the fake clock + speaker ────────────────────────────────────────────────────────────────

class FakeCtx {
  currentTime = 0
  state: 'running' | 'suspended' = 'running'
  async resume() { this.state = 'running' }
  advance(sec: number) { this.currentTime += sec }
}

/** Records what was asked to sound, and at what audio-clock time. */
class RecordingInstrument implements Instrument {
  played: { midi: number; atSec: number; durationSec: number }[] = []
  offCount = 0
  play(midi: number, atSec: number, durationSec: number) { this.played.push({ midi, atSec, durationSec }) }
  allOff() { this.offCount++ }
}

function makePlayer(opts = {}) {
  const ctx = new FakeCtx()
  const instrument = new RecordingInstrument()
  const score = parseMusicXml(SIMPLE_SCALE) // 60bpm → one note per second
  const player = new ScorePlayer(score, ctx as unknown as AudioContext, opts, instrument)
  return { ctx, instrument, player, score }
}

describe('ScorePlayer — transport', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('starts paused at the beginning', () => {
    const { player } = makePlayer()
    expect(player.playing).toBe(false)
    expect(player.positionSec).toBe(0)
  })

  it('resumes a suspended context — otherwise the first press of play is silent', async () => {
    const { ctx, player } = makePlayer()
    ctx.state = 'suspended'
    await player.play()
    expect(ctx.state).toBe('running')
  })

  it('advances the playhead on the AUDIO clock, not the wall clock', async () => {
    const { ctx, player } = makePlayer()
    await player.play()

    // Wall-clock timers fire, but the audio clock has NOT moved: the playhead must not move either.
    vi.advanceTimersByTime(1000)
    expect(player.positionSec).toBe(0)

    // Now move the audio clock.
    ctx.advance(2)
    expect(player.positionSec).toBe(2)
  })

  it('reports the bar under the cursor as the audio clock runs', async () => {
    const { ctx, player } = makePlayer() // 4s per bar
    await player.play()
    expect(player.currentMeasure).toBe(0)
    ctx.advance(4.5)
    expect(player.currentMeasure).toBe(1)
    ctx.advance(4)
    expect(player.currentMeasure).toBe(2)
  })

  it('notifies listeners when the bar changes, and NOT on every tick', async () => {
    const { ctx, player } = makePlayer()
    const seen: (number | null)[] = []
    player.onMeasure(m => seen.push(m))

    await player.play()
    expect(seen).toEqual([0])         // where the cursor starts — the UI has to be told once

    // Several ticks INSIDE bar 0 must add nothing: the callback drives a re-render.
    ctx.advance(1); vi.advanceTimersByTime(TICK)
    ctx.advance(1); vi.advanceTimersByTime(TICK)
    ctx.advance(1); vi.advanceTimersByTime(TICK)
    expect(seen).toEqual([0])

    ctx.advance(2); vi.advanceTimersByTime(TICK)
    expect(seen).toEqual([0, 1])      // crossed into bar 1, exactly once
  })

  it('schedules notes ahead of the clock, at their absolute audio times', async () => {
    const { ctx, instrument, player } = makePlayer()
    await player.play()
    vi.advanceTimersByTime(TICK)

    // Lookahead is 0.15s, so only the note at t=0 is due yet.
    expect(instrument.played.map(p => p.midi)).toEqual([60])
    expect(instrument.played[0].atSec).toBe(0)

    // Run the clock out to 3.2s; the scale's first four notes should all have been scheduled, each
    // at its own second — the timing coming from the score, not from when the tick happened to run.
    for (let i = 0; i < 80; i++) { ctx.advance(0.04); vi.advanceTimersByTime(TICK) }
    expect(instrument.played.map(p => p.midi)).toEqual([60, 62, 64, 65])
    expect(instrument.played.map(p => p.atSec)).toEqual([0, 1, 2, 3])
  })

  it('never schedules a note in the past when the main thread stalls', async () => {
    const { ctx, instrument, player } = makePlayer()
    await player.play()

    // Only notes scheduled AFTER the stall are in question. The one already queued at t=0 was
    // scheduled while the clock read 0 and was perfectly on time — judging it against a later clock
    // would fail a correct implementation.
    instrument.played.length = 0

    // The stall: the audio clock ran on to 2.5s before the scheduler next got to look. Notes at
    // t=1 and t=2 are now overdue.
    ctx.advance(2.5)
    vi.advanceTimersByTime(TICK)

    expect(instrument.played.length).toBeGreaterThan(0) // the window really did contain overdue notes
    for (const p of instrument.played) {
      // Handed to Web Audio with a past timestamp, they would all fire at once in a burst.
      expect(p.atSec).toBeGreaterThanOrEqual(ctx.currentTime)
    }
  })

  it('pauses where it was, and resumes from there', async () => {
    const { ctx, player, instrument } = makePlayer()
    await player.play()
    ctx.advance(2.5)
    player.pause()

    expect(player.playing).toBe(false)
    expect(player.positionSec).toBe(2.5)
    expect(instrument.offCount).toBe(1)   // notes silenced, not left ringing

    ctx.advance(10)                        // time passes while paused...
    expect(player.positionSec).toBe(2.5)   // ...and the playhead does not move

    await player.play()
    ctx.advance(1)
    expect(player.positionSec).toBe(3.5)
  })

  it('stop returns to the beginning', async () => {
    const { ctx, player } = makePlayer()
    await player.play()
    ctx.advance(5)
    player.stop()
    expect(player.playing).toBe(false)
    expect(player.positionSec).toBe(0)
  })

  it('seeks to a bar (what a citation does — §B4)', () => {
    const { player } = makePlayer()
    player.seekToMeasure(2)              // bar 3 of a 60bpm 4/4 score
    expect(player.positionSec).toBe(8)
    expect(player.currentMeasure).toBe(2)
  })

  it('clamps a seek past the end rather than running off the score', () => {
    const { player } = makePlayer()
    player.seekToSeconds(9999)
    expect(player.positionSec).toBe(player.durationSec)
  })
})

describe('ScorePlayer — loop a bar range (§B3)', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('jumps the playhead into the loop when one is set', () => {
    const { player } = makePlayer()
    player.setLoop(1, 2)          // bars 2-3 → 4s..12s
    expect(player.positionSec).toBe(4)
  })

  it('wraps the playhead at the end of the loop', async () => {
    const { ctx, player } = makePlayer()
    player.setLoop(1, 2)
    await player.play()

    ctx.advance(7.9)
    expect(player.positionSec).toBeCloseTo(11.9, 6)   // still inside
    ctx.advance(0.2)
    expect(player.positionSec).toBeCloseTo(4.1, 6)    // wrapped back to the loop start
  })

  it('refuses a loop over bars the score does not have', () => {
    const { player } = makePlayer()
    expect(() => player.setLoop(0, 99)).toThrow(/doesn’t have them/)
  })

  it('stop returns to the loop start, not to the top of the piece', async () => {
    const { ctx, player } = makePlayer()
    player.setLoop(1, 2)
    await player.play()
    ctx.advance(2)
    player.stop()
    expect(player.positionSec).toBe(4)
  })
})

describe('ScorePlayer — tempo (§B3)', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('stretches the piece when slowed down', () => {
    const { player } = makePlayer({ tempoScale: 0.5 })
    expect(player.durationSec).toBe(32)  // 16s at written tempo
  })

  it('keeps the student on the same BAR when the tempo changes mid-flight', () => {
    // Their place in the MUSIC is the bar, not the second count. Preserving seconds instead would
    // teleport them somewhere else in the score the moment they touched the speed control.
    const { player } = makePlayer()
    player.seekToMeasure(2)
    expect(player.currentMeasure).toBe(2)

    player.setTempoScale(0.5)
    expect(player.currentMeasure).toBe(2)   // same bar...
    expect(player.positionSec).toBe(16)     // ...at half speed, twice as many seconds in
  })

  it('ignores a nonsense tempo', () => {
    const { player } = makePlayer()
    player.setTempoScale(0)
    expect(player.durationSec).toBe(16)
  })
})

const TICK = 40
