// ─── §A4: tap-sync — where the cursor is at time t ───────────────────────────
//
// "Cursor logic: for each tapped beat time, place the vertical cursor at the interpolated
// x-position between the surrounding barline anchors, advancing at the tapped tempo and wrapping to
// the next system at line-ends. **Bar-level interpolation is smooth enough — no note-level
// positions (that would need OMR) are required.**"
//
// TWO ANCHOR SETS, AND THEY ARE INDEPENDENT — that is the whole design:
//   · SPATIAL  (`barline_anchors`) — WHERE bar N sits on the photograph. Tapped once, ever.
//   · TEMPORAL (`beat_map`)        — WHEN bar N is played. Tapped once per reference track.
// Neither knows about the other. A student can re-tap the tempo for a different recording without
// re-tapping the barlines, and re-crop the photo without re-tapping the beat. Fusing them into one
// "sync" table is how one re-tap would destroy the other's work.
//
// PURE — no DOM, no audio, no clock. The player pushes `t` in; this decides where the cursor goes.
// That is what lets every case below be tested in node, including the ones a browser makes hard to
// stage (a rubato performance, a line end, a bar nobody tapped).
//
// ⚠️ NO OMR, and this is the file where the temptation would live: a note-level cursor would need to
// know where the notes ARE. §A4 answers it directly — bar-level interpolation is enough. Nothing
// here looks at the image.

import type { BarlineAnchor, BeatMapEntry, Sync } from './types'

// ─── Spatial: bars from tapped barlines ──────────────────────────────────────

/** One bar's extent on the page. `x0`/`x1` are normalised across the page width. */
export interface BarSpan {
  bar_index: number
  page: number
  system: number
  x0: number
  x1: number
}

/**
 * Turn tapped barLINES into bar SPANS.
 *
 * ⚠️ THIS IS WHAT MAKES THE LINE-END WRAP STRUCTURAL RATHER THAN A SPECIAL CASE, and it is the
 * single most important line in the file. A bar is formed ONLY from two consecutive anchors **on the
 * same system of the same page**. So a bar can never span a line end, and the cursor — which only
 * ever interpolates *within* a span — is incapable of sweeping across one.
 *
 * The naive alternative is to sort anchors by bar and lerp x between anchor N and anchor N+1. It
 * looks correct and it is catastrophic: the last bar of a line starts at x≈0.9 and the next starts
 * at x≈0.08 on the line below, so the cursor flies BACKWARD across the page during that bar, every
 * line, forever. `sync.test.ts` runs that model as a live known-negative and watches it happen.
 *
 * The last anchor on a system CLOSES its final bar and opens nothing — a system with n anchors has
 * n−1 bars, exactly like `reflow.ts` `barsOf`. Same rule, both paths: fewer than two anchors on a
 * system means its bar structure is unknown, and the honest answer is no bars rather than one bogus
 * bar spanning the whole line.
 */
export function barSpansFromAnchors(anchors: readonly BarlineAnchor[]): BarSpan[] {
  // Group by (page, system), then order across each line. Taps arrive in whatever order the student
  // made them — including out of order, because a student who missed one goes back for it.
  const lines = new Map<string, BarlineAnchor[]>()
  for (const a of anchors) {
    const k = `${a.page}:${a.system}`
    const arr = lines.get(k)
    if (arr) arr.push(a)
    else lines.set(k, [a])
  }

  const spans: BarSpan[] = []
  for (const arr of lines.values()) {
    const sorted = [...arr].sort((p, q) => p.x - q.x)
    for (let i = 1; i < sorted.length; i++) {
      const open = sorted[i - 1]
      spans.push({
        // The OPENING anchor names the bar. Taken from the anchor rather than counted here, so a
        // student who taps a pickup as bar 0 keeps their own numbering.
        bar_index: open.bar_index,
        page: open.page,
        system: open.system,
        x0: open.x,
        x1: sorted[i].x,
      })
    }
  }
  return spans.sort((a, b) => a.bar_index - b.bar_index)
}

/** The span for one bar, or null if nobody tapped it. */
export function spanOfBar(spans: readonly BarSpan[], barIndex: number): BarSpan | null {
  return spans.find(s => s.bar_index === barIndex) ?? null
}

// ─── Temporal: absolute beats from the tapped beat map ───────────────────────

/**
 * A tapped beat as ONE number: beats since the start of the piece.
 *
 * Collapsing (bar, beat) into an absolute beat is what lets the tempo be interpolated at all —
 * you cannot lerp between "bar 3 beat 4" and "bar 4 beat 1" while they are two fields.
 *
 * `beat` is 1-based (a musician counts "1-2-3-4"), so it is decremented here exactly once. That
 * conversion living in one place is deliberate: a 1-based count and a 0-based ordinal in the same
 * expression is how an off-by-one gets into a tempo map and produces a cursor that is confidently
 * one beat wrong all the way through.
 */
export function absoluteBeat(e: BeatMapEntry, beatsPerBar: number): number {
  return e.bar_index * beatsPerBar + (e.beat - 1)
}

/** The beat map in time order, cleaned. Exported for the tapper's own display. */
export function orderedBeats(beat_map: readonly BeatMapEntry[], beatsPerBar: number): BeatMapEntry[] {
  return [...beat_map]
    .sort((a, b) => a.time_sec - b.time_sec)
    // A tap that goes BACKWARD in absolute beat while going forward in time is a mis-tap (the
    // student lost their place and re-started the count). Keeping it would make the cursor jump
    // backwards mid-piece; dropping it silently is better than rendering a lie, and the tapper
    // shows the count so the student can see it happen.
    .filter((e, i, arr) => i === 0 || absoluteBeat(e, beatsPerBar) > absoluteBeat(arr[i - 1], beatsPerBar))
}

/**
 * Fractional bar position at time `t`, from the tapped beats. Null before the first tap.
 *
 * PIECEWISE-LINEAR BETWEEN TAPS, and that is the point of tapping rather than entering a BPM: a real
 * performance breathes. A student practising Chopin taps rubato and the cursor follows it, because
 * each pair of taps carries its own local tempo. A single global BPM would drift away from the
 * recording within a few bars — `sync.test.ts` measures exactly that against a rubato fixture.
 *
 * BEFORE the first tap: null, not zero. We do not know the tempo before the student started
 * counting, and pinning the cursor to bar 0 would assert the piece had not started when it may well
 * have. The caller hides the cursor.
 *
 * AFTER the last tap: extrapolated at the LAST OBSERVED tempo — the one honest guess available, and
 * flagged so the caller can render it differently. §A4 has the student tap the whole piece through
 * once, so this is the tail, not the normal case.
 */
export interface BarPosition {
  /** 0-based ordinal, plus the fraction through that bar. */
  bar: number
  /** True when `t` is past the last tap and the tempo is being extrapolated, not measured. */
  extrapolated: boolean
}

export function barPositionAt(
  beat_map: readonly BeatMapEntry[], t: number, beatsPerBar: number,
): BarPosition | null {
  const beats = orderedBeats(beat_map, beatsPerBar)
  if (beats.length === 0) return null
  if (t < beats[0].time_sec) return null

  // A single tap gives a position but no tempo — there is nothing to measure a rate from.
  if (beats.length === 1) {
    return { bar: absoluteBeat(beats[0], beatsPerBar) / beatsPerBar, extrapolated: true }
  }

  for (let i = 1; i < beats.length; i++) {
    if (t > beats[i].time_sec) continue
    const a = beats[i - 1], b = beats[i]
    const dt = b.time_sec - a.time_sec
    const f = dt > 0 ? (t - a.time_sec) / dt : 0     // two taps at one instant ⇒ no local tempo
    const beat = absoluteBeat(a, beatsPerBar) + f * (absoluteBeat(b, beatsPerBar) - absoluteBeat(a, beatsPerBar))
    return { bar: beat / beatsPerBar, extrapolated: false }
  }

  // Past the end: continue at the last measured rate.
  const a = beats[beats.length - 2], b = beats[beats.length - 1]
  const dt = b.time_sec - a.time_sec
  const rate = dt > 0 ? (absoluteBeat(b, beatsPerBar) - absoluteBeat(a, beatsPerBar)) / dt : 0
  const beat = absoluteBeat(b, beatsPerBar) + rate * (t - b.time_sec)
  return { bar: beat / beatsPerBar, extrapolated: true }
}

// ─── The cursor ──────────────────────────────────────────────────────────────

export interface Cursor {
  page: number
  system: number
  /** Normalised across the page width. */
  x: number
  bar_index: number
  extrapolated: boolean
}

export interface SyncOptions {
  /** Beats in a bar, from the Piece's time signature. Default 4. */
  beatsPerBar?: number
}

/**
 * Where the cursor sits at playback time `t`. Null when it cannot be known.
 *
 * NULL IS A REAL ANSWER AND IS RETURNED OFTEN — before the first tapped beat, and for any bar whose
 * barlines nobody tapped. The alternative is to place the cursor SOMEWHERE, which on a
 * half-tapped photo means a confident vertical line sitting over the wrong music. Same rule as the
 * barline refusal it depends on: a wrong answer that looks right is worse than no answer.
 */
export function cursorAt(sync: Sync, t: number, opts: SyncOptions = {}): Cursor | null {
  const beatsPerBar = opts.beatsPerBar ?? 4
  const pos = barPositionAt(sync.beat_map, t, beatsPerBar)
  if (!pos) return null

  const spans = barSpansFromAnchors(sync.barline_anchors)
  const barIndex = Math.floor(pos.bar)
  const span = spanOfBar(spans, barIndex)
  if (!span) return null                    // nobody tapped this bar's barlines

  const f = Math.min(1, Math.max(0, pos.bar - barIndex))
  return {
    page: span.page,
    system: span.system,
    // Interpolate WITHIN the span only. The span cannot cross a line end (barSpansFromAnchors), so
    // neither can this — the wrap is a consequence of the data model, not a rule applied here.
    x: span.x0 + f * (span.x1 - span.x0),
    bar_index: barIndex,
    extrapolated: pos.extrapolated,
  }
}

// ─── The inverse: seek-to-bar, and loops ─────────────────────────────────────

/**
 * When bar `barIndex` begins, in track seconds. Null if the taps do not cover it.
 *
 * Powers §A4's "seek-to-bar (jump the track to a bar's timestamp)" and the loop's endpoints. It is
 * the inverse of `barPositionAt` and is derived from the SAME beat map, so a seek lands exactly
 * where the cursor says the bar is — a second, independent rule here is how "jump to bar 24" and
 * "the cursor at bar 24" end up disagreeing by a beat.
 */
export function timeOfBar(
  beat_map: readonly BeatMapEntry[], barIndex: number, opts: SyncOptions = {},
): number | null {
  const beatsPerBar = opts.beatsPerBar ?? 4
  const beats = orderedBeats(beat_map, beatsPerBar)
  if (beats.length < 2) return null
  const target = barIndex * beatsPerBar

  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1], b = beats[i]
    const ba = absoluteBeat(a, beatsPerBar), bb = absoluteBeat(b, beatsPerBar)
    if (target < ba || target > bb) continue
    const db = bb - ba
    const f = db > 0 ? (target - ba) / db : 0
    return a.time_sec + f * (b.time_sec - a.time_sec)
  }
  // Outside the tapped span. Refuse rather than extrapolate: a seek is a COMMAND, and sending the
  // track to a guessed timestamp moves the student's music. The cursor may extrapolate because it
  // only draws; a seek acts.
  return null
}

/** §A4: "loop-a-section (define a loop between two bar anchors)". Null if either end is untapped. */
export function loopForBars(
  beat_map: readonly BeatMapEntry[], fromBar: number, toBar: number, opts: SyncOptions = {},
): { startSec: number; endSec: number } | null {
  const lo = Math.min(fromBar, toBar), hi = Math.max(fromBar, toBar)
  const startSec = timeOfBar(beat_map, lo, opts)
  // The loop runs to the START of the bar AFTER the last one — a loop over "bars 4 to 6" must play
  // bar 6, so it ends where bar 7 begins.
  const endSec = timeOfBar(beat_map, hi + 1, opts)
  if (startSec === null || endSec === null || endSec <= startSec) return null
  return { startSec, endSec }
}

// ─── Building the bar model from taps (the payoff) ───────────────────────────

/**
 * Tapped barlines → the `BarRegion[]` a page carries, so the HEATMAP can colour them.
 *
 * THIS IS WHY §A4 IS LOAD-BEARING RATHER THAN A PLAYBACK FEATURE. `reflow.ts` refuses to pre-detect
 * barlines on a single stave, so a violin or vocal Piece has NO bars — and the heatmap (§A2) has
 * nothing to select, the lesson note's `bar_index` has nothing to resolve against. The tap is the
 * only thing that fills that in, and it fills it in for every feature at once, because they all
 * join on `bar_index` (types.ts, BarRef).
 *
 * `bar_label` is NOT set: the student tapped a POSITION, not a number. If they want to say "this is
 * bar 8a" that is a separate act. Same rule as the CV's — it knows where, not what is printed.
 */
export function barRegionsFromAnchors(
  anchors: readonly BarlineAnchor[], page: number, systemRegion: (system: number) => { y: number; h: number } | null,
): Array<{ bar_index: number; system: number; region: { x: number; y: number; w: number; h: number } }> {
  return barSpansFromAnchors(anchors)
    .filter(s => s.page === page)
    .flatMap(s => {
      const sys = systemRegion(s.system)
      if (!sys) return []      // a tap on a system the page does not have — drop, never guess
      return [{
        bar_index: s.bar_index,
        system: s.system,
        region: { x: s.x0, y: sys.y, w: s.x1 - s.x0, h: sys.h },
      }]
    })
}

/**
 * The NEXT bar ordinal to assign as the student taps down a page.
 *
 * Tapping is sequential — you work along the line — so the ordinal is just "one more than the
 * highest so far". Derived rather than stored as a counter, because a counter drifts the moment a
 * student deletes a mis-tap: the count would keep climbing while the anchors below it renumber.
 */
export function nextBarIndex(anchors: readonly BarlineAnchor[]): number {
  return anchors.reduce((n, a) => Math.max(n, a.bar_index + 1), 0)
}
