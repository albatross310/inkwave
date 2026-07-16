// Score → playable note events (build spec §B3: "generate note events from the parsed MusicXML").
//
// This is the piece that makes the MusicXML path "the easy win": the notation CARRIES the timing, so
// there is no tap-sync (§A4's photo-path chore). Everything below is pure — no Web Audio, no DOM —
// so the timing model is testable without a sound card, and the synth stays a thin player of it.

import type { NoteEvent, Score, TempoMark } from './score'

/**
 * Convert a position in quarter notes to seconds, honouring every tempo change before it.
 *
 * The tempo map is piecewise-constant: each mark holds until the next. Integrating segment by
 * segment (rather than scaling by one global bpm) is what keeps a rit./accel. score in sync.
 */
export function quartersToSeconds(tempos: TempoMark[], quarters: number): number {
  if (quarters <= 0) return 0
  let sec = 0
  for (let i = 0; i < tempos.length; i++) {
    const from = tempos[i].onsetQuarters
    if (from >= quarters) break
    const to = Math.min(tempos[i + 1]?.onsetQuarters ?? Infinity, quarters)
    // bpm is quarter-notes per minute → 60/bpm seconds per quarter note.
    sec += (to - from) * (60 / tempos[i].bpm)
  }
  return sec
}

export interface EventOptions {
  /** Only include events from these 0-based measure indices (inclusive). Used by excerpt playback. */
  fromMeasureIndex?: number
  toMeasureIndex?: number
  /**
   * Re-base times so the first included measure starts at 0. An excerpt of bars 12-16 should play
   * immediately, not after 30s of silence for the bars it doesn't show.
   */
  rebase?: boolean
  /** Global tempo scale: 0.5 = half speed. The spec's practice slow-down (§B3 "Controls: tempo"). */
  tempoScale?: number
}

/**
 * Flatten a Score into timed, pitched events across ALL parts.
 *
 * Rests are dropped (nothing to sound) — but they have already done their job by advancing the
 * onsets during parsing, so the notes after them land in the right place.
 */
export function noteEvents(score: Score, opts: EventOptions = {}): NoteEvent[] {
  const from = opts.fromMeasureIndex ?? 0
  const to = opts.toMeasureIndex ?? Infinity
  const scale = opts.tempoScale && opts.tempoScale > 0 ? opts.tempoScale : 1

  // Re-base against the measure's start, not the first NOTE's onset: a bar beginning with a rest
  // must keep that rest's silence, or the excerpt would start on the wrong beat.
  let offsetSec = 0
  if (opts.rebase) {
    const startQuarters = startOfMeasure(score, from)
    if (startQuarters !== null) offsetSec = quartersToSeconds(score.tempos, startQuarters)
  }

  const events: NoteEvent[] = []
  for (const part of score.parts) {
    for (const measure of part.measures) {
      if (measure.index < from || measure.index > to) continue
      for (const note of measure.notes) {
        if (!note.pitch) continue // a rest
        const startSec = quartersToSeconds(score.tempos, note.onsetQuarters)
        const endSec = quartersToSeconds(score.tempos, note.onsetQuarters + note.durationQuarters)
        events.push({
          timeSec: (startSec - offsetSec) / scale,
          durationSec: (endSec - startSec) / scale,
          midi: note.pitch.midi,
          measureIndex: measure.index,
          noteId: note.id,
        })
      }
    }
  }
  events.sort((a, b) => a.timeSec - b.timeSec || a.midi - b.midi)
  return events
}

/** The onset (in quarter notes) of a measure index, taken from whichever part defines it. */
export function startOfMeasure(score: Score, measureIndex: number): number | null {
  for (const part of score.parts) {
    const m = part.measures[measureIndex]
    if (m) return m.onsetQuarters
  }
  return null
}

/** The end (in quarter notes) of a measure index. */
export function endOfMeasure(score: Score, measureIndex: number): number | null {
  for (const part of score.parts) {
    const m = part.measures[measureIndex]
    if (m) return m.onsetQuarters + m.durationQuarters
  }
  return null
}

/**
 * Wall-clock span of a bar range — what a bar-range loop (§B3 "loop a bar-range") and a citation
 * ("see m. 34" drives cursor + playback, §B4) need.
 */
export function measureRangeSeconds(
  score: Score,
  fromMeasureIndex: number,
  toMeasureIndex: number,
  tempoScale = 1,
): { startSec: number; endSec: number } | null {
  const startQ = startOfMeasure(score, fromMeasureIndex)
  const endQ = endOfMeasure(score, toMeasureIndex)
  if (startQ === null || endQ === null) return null
  const scale = tempoScale > 0 ? tempoScale : 1
  return {
    startSec: quartersToSeconds(score.tempos, startQ) / scale,
    endSec: quartersToSeconds(score.tempos, endQ) / scale,
  }
}

/**
 * The measure index sounding at a given time — the cursor's position (§B3 "automatic cursor").
 * Returns null before the first measure or after the last.
 */
export function measureAtSeconds(score: Score, timeSec: number, tempoScale = 1): number | null {
  const scale = tempoScale > 0 ? tempoScale : 1
  const t = timeSec * scale
  const part = score.parts.reduce((a, b) => (b.measures.length > a.measures.length ? b : a), score.parts[0])
  if (!part) return null
  for (const m of part.measures) {
    const startSec = quartersToSeconds(score.tempos, m.onsetQuarters)
    const endSec = quartersToSeconds(score.tempos, m.onsetQuarters + m.durationQuarters)
    if (t >= startSec && t < endSec) return m.index
  }
  return null
}

/** Total sounding length of the score in seconds. */
export function scoreDurationSeconds(score: Score, tempoScale = 1): number {
  let maxQ = 0
  for (const part of score.parts) {
    const last = part.measures[part.measures.length - 1]
    if (last) maxQ = Math.max(maxQ, last.onsetQuarters + last.durationQuarters)
  }
  const scale = tempoScale > 0 ? tempoScale : 1
  return quartersToSeconds(score.tempos, maxQ) / scale
}
