// ─── §A4: tap-sync — where the cursor is at time t ───────────────────────────
//
// ⚠ TWO ANCHOR SETS, AND THEY MUST STAY INDEPENDENT: SPATIAL (`barline_anchors` — where bar N sits
// on the photograph) and TEMPORAL (`beat_map` — when bar N is played). Neither knows about the
// other, so re-tapping the tempo for a new recording costs no barlines and re-cropping the photo
// costs no beats. Fusing them into one "sync" table is how one re-tap destroys the other's work.
//
// PURE — no DOM, no audio, no clock — which is what lets every case be tested in node, including the
// ones a browser makes hard to stage (a rubato performance, a line end, an untapped bar).
//
// ⚠️ NO OMR, and this is where the temptation lives: a note-level cursor would need to know where the
// notes ARE. §A4 answers it — bar-level interpolation is enough, and nothing here looks at the image.
// → docs/archive/music-module-build.md#sync

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
 * ⚠️ THE LINE-END WRAP IS STRUCTURAL, NOT A SPECIAL CASE, and this is the line that makes it so: a
 * bar is formed ONLY from two consecutive anchors ON THE SAME SYSTEM OF THE SAME PAGE, so a bar can
 * never span a line end and the cursor — which only interpolates WITHIN a span — cannot sweep across
 * one. Lerping between anchor N and N+1 instead looks correct and flies the cursor BACKWARD across
 * the page at every line end, forever.
 *
 * Fewer than two anchors on a system ⇒ NO bars (same rule as `reflow.ts` `barsOf`).
 * → docs/archive/music-module-build.md#sync-line-end
 */
export function barSpansFromAnchors(anchors: readonly BarlineAnchor[]): BarSpan[] {
  // Group by (page, system), then order across each line. Taps arrive in whatever order the student
  // made them — out of order included, because someone who missed one goes back for it.
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
        // The OPENING anchor names the bar — taken from the anchor rather than counted, so a student
        // who taps a pickup as bar 0 keeps their own numbering.
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
 * A tapped beat as ONE number: beats since the start of the piece. Collapsing (bar, beat) is what
 * lets the tempo be interpolated at all.
 *
 * ⚠ `beat` is 1-based and is decremented HERE, in exactly one place: a 1-based count and a 0-based
 * ordinal in the same expression is how an off-by-one gets into a tempo map and produces a cursor
 * that is confidently one beat wrong all the way through.
 */
export function absoluteBeat(e: BeatMapEntry, beatsPerBar: number): number {
  return e.bar_index * beatsPerBar + (e.beat - 1)
}

/** The beat map in time order, cleaned. Exported for the tapper's own display. */
export function orderedBeats(beat_map: readonly BeatMapEntry[], beatsPerBar: number): BeatMapEntry[] {
  return [...beat_map]
    .sort((a, b) => a.time_sec - b.time_sec)
    // A tap going BACKWARD in absolute beat while going forward in time is a mis-tap (the student
    // lost their place and restarted the count). Keeping it jumps the cursor backwards mid-piece;
    // the tapper shows the count, so dropping it is visible rather than silent.
    .filter((e, i, arr) => i === 0 || absoluteBeat(e, beatsPerBar) > absoluteBeat(arr[i - 1], beatsPerBar))
}

/**
 * Fractional bar position at time `t`, from the tapped beats. Null before the first tap.
 *
 * PIECEWISE-LINEAR BETWEEN TAPS, which is the point of tapping rather than entering a BPM: a real
 * performance breathes, and each pair of taps carries its own local tempo. ⚠ BEFORE the first tap it
 * is null, NOT zero — pinning to bar 0 asserts the piece had not started when it may well have.
 * After the last tap it extrapolates at the last observed tempo and FLAGS that it did.
 * → docs/archive/music-module-build.md#sync-tempo
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
 * ⚠ NULL IS A REAL ANSWER AND IS RETURNED OFTEN — before the first tapped beat, and for any bar
 * whose barlines nobody tapped. Placing it SOMEWHERE means a confident vertical line over the wrong
 * music. Same rule as the barline refusal it depends on: a wrong answer that looks right is worse
 * than no answer. → docs/archive/music-module-build.md#sync-null-is-an-answer
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
    // Interpolate WITHIN the span only — the span cannot cross a line end, so the wrap is a
    // consequence of the data model rather than a rule applied here.
    x: span.x0 + f * (span.x1 - span.x0),
    bar_index: barIndex,
    extrapolated: pos.extrapolated,
  }
}

// ─── The inverse: seek-to-bar, and loops ─────────────────────────────────────

/**
 * When bar `barIndex` begins, in track seconds. Null if the taps do not cover it.
 *
 * ⚠ Derived from the SAME beat map as `barPositionAt`, so a seek lands exactly where the cursor says
 * the bar is — a second, independent rule is how "jump to bar 24" and "the cursor at bar 24" end up
 * disagreeing by a beat. → docs/archive/music-module-build.md#sync-null-is-an-answer
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
  // ⚠ Outside the tapped span: REFUSE rather than extrapolate. A seek is a COMMAND and a guessed
  // timestamp moves the student's music. The cursor may extrapolate because it only draws.
  return null
}

/** §A4: "loop-a-section (define a loop between two bar anchors)". Null if either end is untapped. */
export function loopForBars(
  beat_map: readonly BeatMapEntry[], fromBar: number, toBar: number, opts: SyncOptions = {},
): { startSec: number; endSec: number } | null {
  const lo = Math.min(fromBar, toBar), hi = Math.max(fromBar, toBar)
  const startSec = timeOfBar(beat_map, lo, opts)
  // To the START of the bar AFTER the last one — "bars 4 to 6" must PLAY bar 6, so it ends where
  // bar 7 begins.
  const endSec = timeOfBar(beat_map, hi + 1, opts)
  if (startSec === null || endSec === null || endSec <= startSec) return null
  return { startSec, endSec }
}

// ─── Building the bar model from taps (the payoff) ───────────────────────────

/**
 * Tapped barlines → the `BarRegion[]` a page carries, so the HEATMAP can colour them. THIS is why
 * §A4 is load-bearing rather than a playback feature: `reflow.ts` refuses single-stave barlines, so
 * the tap is the ONLY thing that gives a violin or vocal Piece any bars at all — and it fills them
 * in for every feature at once, because they all join on `bar_index`.
 *
 * ⚠ `bar_label` is NOT set: the student tapped a POSITION, not a number.
 * → docs/archive/music-module-build.md#sync-payoff
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
 * The NEXT bar ordinal to assign as the student taps down a page — "one more than the highest so
 * far", because tapping is sequential. ⚠ DERIVED, never a stored counter: a counter keeps climbing
 * when a student deletes a mis-tap while the anchors below it renumber.
 */
export function nextBarIndex(anchors: readonly BarlineAnchor[]): number {
  return anchors.reduce((n, a) => Math.max(n, a.bar_index + 1), 0)
}
