// ─── Annotation-space reflow: the CV (build-spec §A1 — the distinctive feature) ───
//
// Detect the whitespace gaps BETWEEN systems, slice there, insert blank space to write in — and
// never split a system.
//
// ⚠️ THE HARD NON-GOAL: **NO OMR. NOTHING HERE RECOGNISES A NOTE.** (§0, repeatedly.) Every signal
// below is GEOMETRY — ink per row, longest horizontal run, longest vertical run. No glyph
// classification, no template matching, no pitch, no duration, and none may be added. A change that
// needs to know WHAT a mark is rather than WHERE ink sits is out of scope and belongs in a
// conversation with Peter.
//
// PURE BY DESIGN — a plain buffer in, plain data out — which is what lets the whole detector be
// tested in node against fixtures with KNOWN GROUND TRUTH, including the ones that are meant to be
// hard. `capture.ts` is the only place that touches a canvas.
// → docs/archive/music-module-build.md#reflow

// ─── Image types ─────────────────────────────────────────────────────────────

/** Single-channel luminance, 0 = black … 255 = white, row-major, one byte per pixel. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** Binarised: 1 = ink, 0 = paper. */
export interface BinaryImage {
  width: number
  height: number
  ink: Uint8Array
}

// ─── Binarisation ────────────────────────────────────────────────────────────
//
// ⚠ LOCAL, not global (Bradley–Roth), because a photographed page has a lighting gradient and often
// the phone's own shadow: one global threshold turns the dark corner into solid ink and loses the
// staves there entirely. → docs/archive/music-module-build.md#reflow-binarise

export interface BinariseOptions {
  /** Neighbourhood side length in px. Default: ~1/24 of the short edge, min 15, forced odd. */
  window?: number
  /** Ink if pixel < localMean × (1 − t). Default 0.15. */
  t?: number
}

export function binarise(img: GrayImage, opts: BinariseOptions = {}): BinaryImage {
  const { width: w, height: h, data } = img
  const t = opts.t ?? 0.15
  let win = opts.window ?? Math.max(15, Math.round(Math.min(w, h) / 24))
  if (win % 2 === 0) win += 1
  const r = (win - 1) >> 1

  // Integral image of luminance. Float64 — a 4000×3000 page sums to ~3e9, past exact int32.
  const sum = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowRun = 0
    for (let x = 0; x < w; x++) {
      rowRun += data[y * w + x]
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)] + rowRun
    }
  }

  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const s =
        sum[(y1 + 1) * (w + 1) + (x1 + 1)] - sum[y0 * (w + 1) + (x1 + 1)] -
        sum[(y1 + 1) * (w + 1) + x0] + sum[y0 * (w + 1) + x0]
      ink[y * w + x] = data[y * w + x] * area < s * (1 - t) ? 1 : 0
    }
  }
  return { width: w, height: h, ink }
}

// ─── Projection profiles ─────────────────────────────────────────────────────

/** Row-darkness profile: per row, the fraction of the width that is ink. §A1's "row-darkness". */
export function rowDarkness(bin: BinaryImage): Float64Array {
  const { width: w, height: h, ink } = bin
  const prof = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let n = 0
    const base = y * w
    for (let x = 0; x < w; x++) n += ink[base + x]
    prof[y] = n / w
  }
  return prof
}

/**
 * Per row, the LONGEST horizontal ink run, as a fraction of the width.
 *
 * ⚠ THIS, not row-darkness, is what finds a staff line: a row crossing a dense chord or a line of
 * lyrics carries as much total ink, but in short broken pieces. A stave line is one long unbroken
 * run. Still pure geometry. → docs/archive/music-module-build.md#reflow-longest-run
 */
export function rowLongestRun(bin: BinaryImage, tolerance = 2): Float64Array {
  const { width: w, height: h, ink } = bin
  const prof = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    const base = y * w
    let best = 0, run = 0, gap = 0
    for (let x = 0; x < w; x++) {
      if (ink[base + x]) { run += gap + 1; gap = 0; if (run > best) best = run }
      else if (run > 0 && gap < tolerance) { gap++ }  // bridge a few px — print/photo speckle
      else { run = 0; gap = 0 }
    }
    prof[y] = best / w
  }
  return prof
}

// ─── Deskew (§A1 "messy/skewed photos") ──────────────────────────────────────
//
// Not cosmetic: skew smears every staff line across many rows until the peaks that ARE the staves
// stop being peaks, so this is what makes the rest of the pipeline work on real input. A small
// rotation ≈ a vertical shear (exact enough below ~8°), scored by the row profile's variance.
// → docs/archive/music-module-build.md#reflow-deskew

export interface SkewOptions {
  /** Search ±this many degrees. Default 6. */
  range?: number
  /** Coarse search step in degrees. Default 0.5; refined to 0.1 around the winner. */
  step?: number
}

/** Row profile of `bin` under a vertical shear of `tan` — without materialising the sheared image. */
function shearedRowInk(bin: BinaryImage, tan: number): Float64Array {
  const { width: w, height: h, ink } = bin
  const cx = w / 2
  const prof = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) {
      if (!ink[base + x]) continue
      const yy = Math.round(y - (x - cx) * tan)
      if (yy >= 0 && yy < h) prof[yy] += 1
    }
  }
  return prof
}

function variance(a: Float64Array): number {
  let mean = 0
  for (let i = 0; i < a.length; i++) mean += a[i]
  mean /= a.length
  let v = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - mean; v += d * d }
  return v / a.length
}

/** Estimated skew in DEGREES: positive = the page's content runs downhill to the right. */
export function estimateSkew(bin: BinaryImage, opts: SkewOptions = {}): number {
  const range = opts.range ?? 6
  const step = opts.step ?? 0.5
  const search = (lo: number, hi: number, st: number): number => {
    let bestA = 0, bestV = -Infinity
    for (let a = lo; a <= hi + 1e-9; a += st) {
      const v = variance(shearedRowInk(bin, Math.tan((a * Math.PI) / 180)))
      if (v > bestV) { bestV = v; bestA = a }
    }
    return bestA
  }
  const coarse = search(-range, range, step)
  return search(coarse - step, coarse + step, 0.1)
}

/** Dilate vertically by `r` rows. Horizontal runs are unaffected; vertical runs only lengthen. */
export function dilateVertical(bin: BinaryImage, r = 1): BinaryImage {
  const { width: w, height: h, ink } = bin
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) {
      if (!ink[base + x]) continue
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy >= 0 && yy < h) out[yy * w + x] = 1
      }
    }
  }
  return { width: w, height: h, ink: out }
}

/**
 * Resample `bin` to remove `deg` of skew (vertical shear about the horizontal centre).
 *
 * ⚠️ THE `repair` STEP IS NOT OPTIONAL POLISH — WITHOUT IT DESKEW MAKES THINGS WORSE, SILENTLY. A
 * binary shear quantises each column to a whole row, so an EXACT skew estimate still detected 0
 * staves (measured); the 1px vertical dilation stitches the wobble back into one line and gives 4.
 * It lives HERE, not in `detectStaves`, because the wobble is this function's own artefact — two
 * rules for one pipeline is the round-11 bug.
 * → docs/archive/music-module-build.md#reflow-deskew
 */
export function deskew(bin: BinaryImage, deg: number, opts: { repair?: boolean } = {}): BinaryImage {
  const { width: w, height: h, ink } = bin
  const tan = Math.tan((deg * Math.PI) / 180)
  const cx = w / 2
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) {
      if (!ink[base + x]) continue
      const yy = Math.round(y - (x - cx) * tan)
      if (yy >= 0 && yy < h) out[yy * w + x] = 1
    }
  }
  const sheared: BinaryImage = { width: w, height: h, ink: out }
  return (opts.repair ?? true) ? dilateVertical(sheared, 1) : sheared
}

// ─── Staff-line and stave detection ──────────────────────────────────────────

export interface StaffLine {
  y: number                 // row index (deskewed space)
  strength: number          // longest-run fraction that flagged it
}

export interface DetectedStave {
  top: number               // first line's row
  bottom: number            // last line's row
  lines: StaffLine[]        // the 5 (or, on a damaged photo, 4–6) lines
  spacing: number           // median inter-line distance — the page's natural unit of scale
}

export interface StaveOptions {
  /** A row is a staff-line candidate if its longest ink run covers ≥ this fraction of the width. */
  minRunFraction?: number
  /** Accept a stave with this many lines (a photo can merge or drop one). Default [4, 6]. */
  lineCount?: [number, number]
}

/**
 * Find the staves. A stave is FIVE roughly-evenly-spaced long horizontal runs — a purely geometric
 * description that never asks what sits on the lines.
 */
export function detectStaves(bin: BinaryImage, opts: StaveOptions = {}): DetectedStave[] {
  const minRun = opts.minRunFraction ?? 0.5
  const [minLines, maxLines] = opts.lineCount ?? [4, 6]
  const runs = rowLongestRun(bin)

  // Candidate rows → merge vertically-adjacent ones (a line is 1–3px thick, and thicker when the
  // photo is soft) into a single line at the run-weighted centre.
  const lines: StaffLine[] = []
  let y = 0
  while (y < bin.height) {
    if (runs[y] < minRun) { y++; continue }
    let end = y, wsum = 0, wy = 0
    while (end < bin.height && runs[end] >= minRun) { wsum += runs[end]; wy += runs[end] * end; end++ }
    lines.push({ y: Math.round(wy / wsum), strength: wsum / (end - y) })
    y = end
  }
  if (lines.length < minLines) return []

  // Group into staves: walk the lines and cut where the gap to the next jumps well past the local
  // inter-line spacing. Inter-LINE gaps within one stave are near-identical by construction (the
  // engraver drew them that way); the gap to the next stave is several times larger.
  const staves: DetectedStave[] = []
  let group: StaffLine[] = [lines[0]]
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y
    const inner = group.length >= 2 ? median(diffs(group)) : gap
    // 2.2× the established inter-line spacing ⇒ this is not the same stave.
    const sameStave = group.length < 2 ? true : gap <= inner * 2.2
    if (sameStave && group.length < maxLines) group.push(lines[i])
    else { flush(); group = [lines[i]] }
  }
  flush()
  return staves

  function flush() {
    if (group.length < minLines) return
    const sp = median(diffs(group))
    staves.push({ top: group[0].y, bottom: group[group.length - 1].y, lines: group.slice(), spacing: sp })
  }
}

function diffs(l: StaffLine[]): number[] {
  const d: number[] = []
  for (let i = 1; i < l.length; i++) d.push(l[i].y - l[i - 1].y)
  return d
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── The connector test — how a grand stave is kept together ─────────────────
//
// ⚠ THIS IS THE LOAD-BEARING IDEA, AND GAP SIZE ALONE IS NOT A SUBSTITUTE. Engravers cramp system
// spacing to fit a page, so ranking gaps by size cuts a grand stave in half — the pianist's hands
// separated by writing space, the one outcome §A1 forbids. The robust signal is STRUCTURAL and still
// pure geometry: staves inside one system are JOINED by barlines crossing the gap, and between
// systems nothing crosses. It measures the engraver's INTENT rather than their spacing budget.
// → docs/archive/music-module-build.md#reflow-connector

export interface ConnectorOptions {
  /** A column counts as a connector if ink covers ≥ this fraction of the gap's height. Default 0.8. */
  minCoverage?: number
  /** Ignore this fraction of the width at each edge... see `braceMargin`. */
  braceMargin?: number
  /** How many connecting columns are needed. Default 1. */
  minColumns?: number
}

/**
 * Does anything connect the two staves across `[y0, y1]`?
 *
 * The left `braceMargin` is EXCLUDED: a brace spans the gap too, but it is a curve that drifts
 * across columns rather than filling one, and counting it reads as a half-height smear. The
 * barlines — dead vertical, at every bar — do the work.
 * → docs/archive/music-module-build.md#reflow-connector
 */
export function hasVerticalConnector(
  bin: BinaryImage, y0: number, y1: number, opts: ConnectorOptions = {},
): boolean {
  return countVerticalConnectors(bin, y0, y1, opts) >= (opts.minColumns ?? 1)
}

/** How many columns carry a near-full-height vertical run across the band. */
export function countVerticalConnectors(
  bin: BinaryImage, y0: number, y1: number, opts: ConnectorOptions = {},
): number {
  const cover = opts.minCoverage ?? 0.8
  const margin = opts.braceMargin ?? 0.04
  const { width: w, ink } = bin
  const top = Math.max(0, Math.ceil(y0)), bot = Math.min(bin.height - 1, Math.floor(y1))
  const span = bot - top + 1
  if (span <= 2) return 0
  const need = Math.ceil(span * cover)
  const x0 = Math.floor(w * margin), x1 = Math.ceil(w * (1 - margin))
  let cols = 0
  for (let x = x0; x < x1; x++) {
    let n = 0
    for (let y = top; y <= bot; y++) if (ink[y * w + x]) n++
    if (n >= need) cols++
  }
  return cols
}

// ─── Grouping staves into systems ────────────────────────────────────────────

export interface System {
  staves: DetectedStave[]
  top: number
  bottom: number
  isGrandStave: boolean
  /** Confidence that the boundary BELOW this system is a real system break, [0,1]. */
  confidence: number
  /** x of each detected barline across this system, left→right (`detectBarlines`). */
  barlines: number[]
}

export interface GroupOptions extends ConnectorOptions, BarlineOptions {
  /**
   * Use the vertical-connector test. Default TRUE.
   *
   * ⚠ Exposed ONLY so the suite can run WITHOUT it and watch the grand-stave fixture split — a
   * negative that cannot fail is not a negative. NEVER turn this off in the app.
   */
  connectorTest?: boolean
}

/**
 * Group detected staves into systems (§A1's atomic unit). TWO VOTES, and ⚠ the CONNECTOR wins when
 * they disagree — the gap-size vote only decides when nothing crosses.
 * → docs/archive/music-module-build.md#reflow-connector
 */
export function groupStavesIntoSystems(
  bin: BinaryImage, staves: DetectedStave[], opts: GroupOptions = {},
): System[] {
  if (!staves.length) return []
  const useConnector = opts.connectorTest ?? true

  const gaps: number[] = []
  for (let i = 1; i < staves.length; i++) gaps.push(staves[i].top - staves[i - 1].bottom)

  // The gap-size vote's cut-point — not a magic constant, but the widest jump between consecutive
  // SORTED gaps. ⚠ On a page whose gaps are all alike there is no jump, so the vote ABSTAINS rather
  // than inventing a boundary.
  const cut = gapCutPoint(gaps)

  const groups: DetectedStave[][] = [[staves[0]]]
  const breakConf: number[] = []
  for (let i = 1; i < staves.length; i++) {
    const gap = staves[i].top - staves[i - 1].bottom
    const connected = useConnector &&
      hasVerticalConnector(bin, staves[i - 1].bottom + 1, staves[i].top - 1, opts)
    const bigGap = cut !== null && gap > cut

    if (connected) {
      groups[groups.length - 1].push(staves[i])     // joined ⇒ one system, whatever the spacing
    } else if (bigGap || cut === null) {
      groups.push([staves[i]])
      breakConf.push(confidenceFor(gap, gaps, connected))
    } else {
      // Nothing crosses and the gap is small: no positive evidence of a join, so treat it as a break
      // but say so QUIETLY — exactly the case the manual adjust handles exist for.
      groups.push([staves[i]])
      breakConf.push(0.35)
    }
  }

  return groups.map((g, i) => ({
    staves: g,
    top: g[0].top,
    bottom: g[g.length - 1].bottom,
    isGrandStave: g.length > 1,
    confidence: i < breakConf.length ? breakConf[i] : 1,
    // ⚠ MULTI-STAVE ONLY unless explicitly overridden — a single stave cannot separate a barline
    // from a note stem by geometry, and a hallucinated bar mis-anchors everything pinned to it.
    // Empty means "the student taps them" (§A4's MVP), NOT "no bars".
    barlines: (g.length > 1 || opts.singleStave)
      ? detectBarlines(bin, g[0].top, g[g.length - 1].bottom, opts)
      : [],
  }))
}

/** Split the sorted gaps at their widest relative jump; null ⇒ no defensible cut. */
function gapCutPoint(gaps: number[]): number | null {
  if (gaps.length < 2) return null
  const s = [...gaps].sort((a, b) => a - b)
  let bestI = -1, bestRatio = 1
  for (let i = 1; i < s.length; i++) {
    const ratio = (s[i] + 1) / (s[i - 1] + 1)
    if (ratio > bestRatio) { bestRatio = ratio; bestI = i }
  }
  // Require a real separation (≥1.6×) — otherwise the gaps are one population and we must abstain.
  if (bestI < 0 || bestRatio < 1.6) return null
  return (s[bestI] + s[bestI - 1]) / 2
}

function confidenceFor(gap: number, gaps: number[], connected: boolean): number {
  if (connected) return 0.1
  const mx = Math.max(...gaps, 1)
  return Math.max(0.4, Math.min(1, gap / mx))
}

// ─── Barline detection (§A2's optional bar pre-detection) ────────────────────
//
// STILL NO OMR: one question per column — does ink run the FULL height of the system here? The same
// vertical-run measurement `countVerticalConnectors` makes.
//
// ⚠️⚠️ THIS RUNS ON MULTI-STAVE SYSTEMS ONLY, AND THE REFUSAL IS THE DESIGN. READ BEFORE "FIXING".
// A note stem on a bottom-line note reaches the top line, so on a SINGLE stave a stem is not
// separable from a barline by geometry (measured: stems scored 0.848–0.939 coverage against a
// barline's 1.000, and one system hallucinated FOUR extra bars). The only cut that separates them
// exists BECAUSE a synthetic barline is geometrically perfect — calibrating there would be circular,
// and a real photographed barline fades and would be rejected. A multi-stave system is different in
// KIND: its barlines cross the gap BETWEEN staves and a stem is trapped inside one.
//
// ⚠ A HALLUCINATED BAR MIS-ANCHORS EVERY HEATMAP RANGE, LESSON NOTE AND RECORDING PINNED TO IT, AND
// LOOKS EXACTLY LIKE A CORRECT ANSWER. §A4 already puts the single-stave case with the student.
// (Doing it properly needs to know a line is attached to a NOTEHEAD. That is note recognition, an
// explicit non-goal. Do not add it.) → docs/archive/music-module-build.md#reflow-barline-refusal

export interface BarlineOptions {
  /** Ink must cover ≥ this fraction of the system's height. Default 0.9. */
  minCoverage?: number
  /** Merge detected columns closer than this fraction of the page width. Default 0.008. */
  mergeWithin?: number
  /**
   * Run detection on SINGLE-stave systems too. Default FALSE, and ⚠ the default is load-bearing —
   * see the banner above. Exposed ONLY so the suite can watch the detector hallucinate, which is
   * what proves the refusal earns its place. NEVER turn this on in the app.
   */
  singleStave?: boolean
}

/**
 * Find the barlines across one system. Returns x positions (px, left→right), including the opening
 * and closing lines, so consecutive pairs are the bars.
 *
 * Callers should prefer `System.barlines` (populated by `groupStavesIntoSystems`), which applies the
 * multi-stave-only rule. This is the raw measurement.
 */
export function detectBarlines(
  bin: BinaryImage, top: number, bottom: number, opts: BarlineOptions = {},
): number[] {
  const cover = opts.minCoverage ?? 0.9
  const { width: w, ink } = bin
  const y0 = Math.max(0, Math.round(top)), y1 = Math.min(bin.height - 1, Math.round(bottom))
  const span = y1 - y0 + 1
  if (span < 4) return []
  const need = Math.ceil(span * cover)

  // Columns whose ink runs the system's height. TOTAL ink, not the longest unbroken run: a barline
  // crossing the inter-stave gap is continuous anyway, and tolerating breaks is what survives a
  // photographed line that fades.
  const hits: number[] = []
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = y0; y <= y1; y++) if (ink[y * w + x]) n++
    if (n >= need) hits.push(x)
  }
  if (!hits.length) return []

  // A barline is 1–3px wide (more when the photo is soft), so adjacent hits are ONE line.
  const merge = Math.max(2, Math.round(w * (opts.mergeWithin ?? 0.008)))
  const out: number[] = []
  let run = [hits[0]]
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i - 1] <= merge) run.push(hits[i])
    else { out.push(centre(run)); run = [hits[i]] }
  }
  out.push(centre(run))
  return out

  function centre(r: number[]): number { return Math.round(r.reduce((a, b) => a + b, 0) / r.length) }
}

/**
 * The bars of a system, as [xStart, xEnd] spans between consecutive barlines.
 *
 * ⚠ Fewer than two barlines ⇒ NO bars, deliberately: an unknown bar structure said honestly, rather
 * than one bogus bar spanning the whole system that would look correct and mis-anchor everything
 * pinned to it. The student taps them (§A4's MVP is manual anyway).
 */
export function barsOf(barlines: number[]): Array<[number, number]> {
  const bars: Array<[number, number]> = []
  for (let i = 1; i < barlines.length; i++) bars.push([barlines[i - 1], barlines[i]])
  return bars
}

// ─── The page analysis ───────────────────────────────────────────────────────

export interface PageAnalysis {
  /** Detected skew in degrees. The CAPTURE step applies this, so the stored page has one space. */
  skewDeg: number
  systems: System[]
  /** Where the slices go: y (in the analysed image's rows) after each system but the last. */
  cuts: number[]
  /** The page's natural scale — median stave line spacing. Used to size a sensible default gap. */
  staveSpacing: number
}

export interface AnalyseOptions extends GroupOptions, StaveOptions {
  /** Skip skew estimation (the caller already deskewed at capture). Default false. */
  assumeDeskewed?: boolean
  skew?: SkewOptions
}

/**
 * The whole §A1 detection pass over one already-binarised page, in the DESKEWED image's space.
 *
 * ⚠ DESKEW BELONGS TO CAPTURE (`capture.ts` rotates once, before storing) so the stored image, the
 * anchors and the reflow share ONE coordinate space. Two spaces for one page is how the annotations
 * and the music drift apart. → docs/archive/music-module-build.md#reflow-one-space
 */
export function analysePage(bin: BinaryImage, opts: AnalyseOptions = {}): PageAnalysis {
  const skewDeg = opts.assumeDeskewed ? 0 : estimateSkew(bin, opts.skew)
  const straight = Math.abs(skewDeg) < 0.05 ? bin : deskew(bin, skewDeg)

  const staves = detectStaves(straight, opts)
  const systems = groupStavesIntoSystems(straight, staves, opts)

  // Slice at the MIDPOINT of each inter-system gap, so neither system loses its ledger lines,
  // dynamics or lyrics to the cut.
  const cuts: number[] = []
  for (let i = 1; i < systems.length; i++) {
    cuts.push(Math.round((systems[i - 1].bottom + systems[i].top) / 2))
  }
  const spacing = median(staves.map(s => s.spacing))
  return { skewDeg, systems, cuts, staveSpacing: spacing }
}

// ─── Source ↔ layout mapping (the view transform) ────────────────────────────
//
// ⚠ THE REFLOW NEVER REWRITES THE IMAGE — a pure mapping from source coordinates to laid-out ones,
// so adjusting a handle re-lays-out instantly and moves NO annotation off its music (types.ts
// RegionAnchor stores anchors in source space precisely so this holds).
// → docs/archive/music-module-build.md#reflow-one-space

export interface Band {
  kind: 'slice' | 'gap'
  /** For a slice: the source y-range it shows. For a gap: the insertion point (y0 === y1). */
  srcY0: number
  srcY1: number
  /** Where it lands in the laid-out page. */
  outY0: number
  outY1: number
  /** For a gap: the system index it follows. */
  afterSystem?: number
}

export interface Layout {
  bands: Band[]
  /** Total laid-out height, normalised to the source page height (1 = no space inserted). */
  height: number
}

/**
 * Build the layout for one page.
 *
 * @param cuts       slice points, normalised [0,1] of source height (from `analysePage`, /height)
 * @param gapFor     gap height after system i, as a fraction of source height
 */
export function buildLayout(cuts: number[], gapFor: (systemIndex: number) => number): Layout {
  const bands: Band[] = []
  let out = 0
  let prev = 0
  for (let i = 0; i <= cuts.length; i++) {
    const to = i < cuts.length ? cuts[i] : 1
    const h = to - prev
    bands.push({ kind: 'slice', srcY0: prev, srcY1: to, outY0: out, outY1: out + h })
    out += h
    if (i < cuts.length) {
      const g = Math.max(0, gapFor(i))
      bands.push({ kind: 'gap', srcY0: to, srcY1: to, outY0: out, outY1: out + g, afterSystem: i })
      out += g
    }
    prev = to
  }
  return { bands, height: out }
}

/** Source y (normalised) → laid-out y (normalised to SOURCE height, matching Layout.height). */
export function sourceToLayout(layout: Layout, srcY: number): number {
  for (const b of layout.bands) {
    if (b.kind !== 'slice') continue
    if (srcY >= b.srcY0 && srcY <= b.srcY1) return b.outY0 + (srcY - b.srcY0)
  }
  const last = layout.bands[layout.bands.length - 1]
  return last ? last.outY1 : srcY
}

/** Laid-out y → source y. A y inside a GAP has no source position; it clamps to the gap's cut. */
export function layoutToSource(layout: Layout, outY: number): number {
  for (const b of layout.bands) {
    if (outY < b.outY0 || outY > b.outY1) continue
    if (b.kind === 'slice') return b.srcY0 + (outY - b.outY0)
    return b.srcY0
  }
  return outY
}

/** Which gap band (if any) a laid-out y falls in — the seam that places gap-space annotations. */
export function gapAt(layout: Layout, outY: number): { afterSystem: number; t: number } | null {
  for (const b of layout.bands) {
    if (b.kind !== 'gap' || b.afterSystem === undefined) continue
    if (outY >= b.outY0 && outY <= b.outY1) {
      const h = b.outY1 - b.outY0
      return { afterSystem: b.afterSystem, t: h > 0 ? (outY - b.outY0) / h : 0 }
    }
  }
  return null
}

/** Place a stored GapOffset back into laid-out space. The inverse of `gapAt`. */
export function gapOffsetToLayout(layout: Layout, afterSystem: number, t: number): number | null {
  for (const b of layout.bands) {
    if (b.kind === 'gap' && b.afterSystem === afterSystem) return b.outY0 + t * (b.outY1 - b.outY0)
  }
  return null
}
