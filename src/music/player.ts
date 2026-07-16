// Transport for the MusicXML path (build spec §B3): play/pause, tempo, loop a bar-range, and the
// automatic cursor that "follows the synth precisely".
//
// ─── Why the cursor reads the AUDIO clock ────────────────────────────────────────────────────
// The cursor position is derived from `AudioContext.currentTime`, never from Date.now() or a frame
// counter. Web Audio schedules on its own hardware clock; a wall clock and an audio clock drift
// apart (and diverge badly when the tab is backgrounded or the buffer glitches). A cursor on the
// wrong clock looks fine for eight bars and is visibly late by the end of a page — which is exactly
// the drift the photo path's tap-sync has to fight, and exactly what clean notation is supposed to
// buy us. So: one clock, the one making the sound.
//
// ─── Lookahead scheduling ────────────────────────────────────────────────────────────────────
// Note starts are queued AHEAD of the audio clock on a timer (the standard Web Audio pattern):
// a setInterval tick that schedules everything falling in the next LOOKAHEAD seconds. Scheduling
// note-by-note from rAF would put every onset at the mercy of main-thread jank — the notes would
// audibly stagger whenever React rendered.
//
// The scheduling DECISIONS are pure functions (`eventsInWindow`, `wrapLoop`) so they can be tested
// without a sound card; the class below is the thin shell that drives them.

import { measureAtSeconds, measureRangeSeconds, noteEvents, scoreDurationSeconds } from './events'
import { SimpleSynth, type Instrument } from './synth'
import type { NoteEvent, Score } from './score'

const LOOKAHEAD_SEC = 0.15   // how far ahead of the audio clock we schedule
const TICK_MS = 40           // how often we look

/** Events whose onset falls in [fromSec, toSec). Half-open so a tick boundary can't double-fire. */
export function eventsInWindow(events: NoteEvent[], fromSec: number, toSec: number): NoteEvent[] {
  return events.filter(e => e.timeSec >= fromSec && e.timeSec < toSec)
}

/**
 * Where the playhead really is, given a loop.
 *
 * Returns the position folded back into the loop, and how many times it wrapped. Pure, because the
 * off-by-one at a loop boundary (does the last note of the range play before jumping back?) is the
 * kind of thing that is miserable to debug through a speaker.
 */
export function wrapLoop(posSec: number, loop: { startSec: number; endSec: number } | null): number {
  if (!loop) return posSec
  const span = loop.endSec - loop.startSec
  if (span <= 0) return loop.startSec
  if (posSec < loop.startSec) return loop.startSec
  if (posSec < loop.endSec) return posSec
  return loop.startSec + ((posSec - loop.startSec) % span)
}

export interface PlayerOptions {
  /** 1 = written tempo, 0.5 = half speed (§B3 practice slow-down). */
  tempoScale?: number
  /** Restrict playback to a bar range (0-based, inclusive) — an excerpt (§B6) plays only its bars. */
  fromMeasureIndex?: number
  toMeasureIndex?: number
  /** Re-base the excerpt so it starts at 0. */
  rebase?: boolean
}

export class ScorePlayer {
  private ctx: AudioContext
  private instrument: Instrument
  private score: Score
  private events: NoteEvent[]
  private tempoScale: number

  /** AudioContext time at which position 0 would have played. Playing iff not null. */
  private originSec: number | null = null
  /** Where we are when paused. */
  private pausedAtSec = 0
  private scheduledUpTo = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private loop: { startSec: number; endSec: number } | null = null
  private lastMeasure: number | null = null
  private measureListeners = new Set<(measureIndex: number | null) => void>()
  private stateListeners = new Set<(playing: boolean) => void>()

  constructor(score: Score, ctx: AudioContext, opts: PlayerOptions = {}, instrument?: Instrument) {
    this.score = score
    this.ctx = ctx
    this.tempoScale = opts.tempoScale ?? 1
    this.instrument = instrument ?? new SimpleSynth(ctx)
    this.events = noteEvents(score, {
      fromMeasureIndex: opts.fromMeasureIndex,
      toMeasureIndex: opts.toMeasureIndex,
      rebase: opts.rebase,
      tempoScale: this.tempoScale,
    })
  }

  get playing(): boolean { return this.originSec !== null }

  get durationSec(): number {
    return scoreDurationSeconds(this.score, this.tempoScale)
  }

  /** Playhead position in seconds, read from the AUDIO clock. */
  get positionSec(): number {
    if (this.originSec === null) return this.pausedAtSec
    return wrapLoop(this.ctx.currentTime - this.originSec, this.loop)
  }

  /** The bar under the cursor right now (§B3). */
  get currentMeasure(): number | null {
    return measureAtSeconds(this.score, this.positionSec, this.tempoScale)
  }

  onMeasure(cb: (measureIndex: number | null) => void): () => void {
    this.measureListeners.add(cb)
    return () => this.measureListeners.delete(cb)
  }

  onStateChange(cb: (playing: boolean) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  async play(): Promise<void> {
    if (this.playing) return
    // Browsers start the context suspended until a user gesture. Without this the first press of
    // play does nothing at all, silently.
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.originSec = this.ctx.currentTime - this.pausedAtSec
    this.scheduledUpTo = this.pausedAtSec
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
    this.emitState(true)
  }

  pause(): void {
    if (!this.playing) return
    this.pausedAtSec = this.positionSec
    this.stopClock()
    this.instrument.allOff()
    this.emitState(false)
  }

  stop(): void {
    this.stopClock()
    this.instrument.allOff()
    this.pausedAtSec = this.loop ? this.loop.startSec : 0
    this.emitMeasure()
    this.emitState(false)
  }

  /** Jump the playhead. Used by a citation ("see m. 34" drives cursor + playback, §B4). */
  seekToSeconds(sec: number): void {
    const was = this.playing
    if (was) this.pause()
    this.pausedAtSec = Math.max(0, Math.min(sec, this.durationSec))
    this.emitMeasure()
    if (was) void this.play()
  }

  seekToMeasure(measureIndex: number): void {
    const span = measureRangeSeconds(this.score, measureIndex, measureIndex, this.tempoScale)
    if (span) this.seekToSeconds(span.startSec)
  }

  /** Loop a bar range for repetitive practice (§B3). */
  setLoop(fromMeasureIndex: number, toMeasureIndex: number): void {
    const span = measureRangeSeconds(this.score, fromMeasureIndex, toMeasureIndex, this.tempoScale)
    if (!span) throw new Error(`Can’t loop bars ${fromMeasureIndex}–${toMeasureIndex}: the score doesn’t have them.`)
    this.loop = span
    if (this.positionSec < span.startSec || this.positionSec >= span.endSec) {
      this.seekToSeconds(span.startSec)
    }
  }

  clearLoop(): void { this.loop = null }

  /**
   * Change speed mid-flight. Rebuilds the event times and keeps the playhead on the same BAR — the
   * student's place in the music, which is what they mean by "where I am", not the second count.
   */
  setTempoScale(scale: number): void {
    if (!(scale > 0)) return
    const wasPlaying = this.playing
    const measure = this.currentMeasure
    this.pause()

    const ratio = this.tempoScale / scale
    this.tempoScale = scale
    this.events = noteEvents(this.score, { tempoScale: scale })
    if (this.loop) this.loop = { startSec: this.loop.startSec / ratio, endSec: this.loop.endSec / ratio }
    if (measure !== null) this.seekToMeasure(measure)
    if (wasPlaying) void this.play()
  }

  dispose(): void {
    this.stopClock()
    this.instrument.allOff()
    this.measureListeners.clear()
    this.stateListeners.clear()
  }

  // ─── internals ─────────────────────────────────────────────────────────────────────────────

  private stopClock(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.originSec = null
  }

  private tick(): void {
    if (this.originSec === null) return
    const pos = this.positionSec
    const horizon = pos + LOOKAHEAD_SEC

    if (this.loop) {
      // Schedule to the end of the loop, then fold the origin back so the next tick continues from
      // the loop's start. Folding at the TICK (not at each event) keeps one clock authoritative.
      const toEnd = eventsInWindow(this.events, this.scheduledUpTo, Math.min(horizon, this.loop.endSec))
      this.emitEvents(toEnd, pos)
      if (horizon >= this.loop.endSec) {
        this.originSec = this.ctx.currentTime - this.loop.startSec - (horizon - this.loop.endSec)
        this.scheduledUpTo = this.loop.startSec
      } else {
        this.scheduledUpTo = horizon
      }
    } else {
      this.emitEvents(eventsInWindow(this.events, this.scheduledUpTo, horizon), pos)
      this.scheduledUpTo = horizon
      if (pos >= this.durationSec) this.stop()
    }
    this.emitMeasure()
  }

  private emitEvents(due: NoteEvent[], pos: number): void {
    if (this.originSec === null) return
    for (const e of due) {
      // Absolute audio-clock time for this onset. Never schedule in the past — Web Audio would fire
      // it immediately and bunch the notes.
      const at = Math.max(this.originSec + e.timeSec, this.ctx.currentTime)
      this.instrument.play(e.midi, at, e.durationSec, 1)
    }
    void pos
  }

  private emitMeasure(): void {
    const m = this.currentMeasure
    if (m === this.lastMeasure) return
    this.lastMeasure = m
    for (const cb of this.measureListeners) cb(m)
  }

  private emitState(playing: boolean): void {
    for (const cb of this.stateListeners) cb(playing)
  }
}
