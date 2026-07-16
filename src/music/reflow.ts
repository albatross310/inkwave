// ─── Annotation-space reflow: the CV (build-spec §A1 — the distinctive feature) ───
//
// "Detect the whitespace gaps *between systems* (row-darkness / projection profile — easy CV, no
// note recognition), slice the image at those gaps, and insert blank space so the student has room
// to write. Keep grand staves (piano treble+bass) together; never split a system."
//
// ⚠️ THE HARD NON-GOAL: **NO OMR. NOTHING HERE RECOGNISES A NOTE.** (§0, repeatedly.) Every signal
// below is barline/whitespace GEOMETRY: how much ink is in a row, how long a horizontal run is, how
// long a vertical run is. There is no glyph classification, no template matching, no pitch, no
// duration — and none may be added. If a future change needs to know WHAT a mark is rather than
// WHERE ink sits, it is out of scope and belongs in a conversation with Peter, not in this file.
//
// PURE BY DESIGN: this module takes a plain buffer and returns plain data — no DOM, no canvas, no
// ImageData. That is what lets the whole detector be tested in node against synthetic fixtures with
// KNOWN GROUND TRUTH (`fixtures.ts`), including the ones where it is *supposed* to be hard. The
// browser adapter (`capture.ts`) is the only place that touches a canvas.

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
// LOCAL, not global (Bradley–Roth: compare each pixel to the mean of its own neighbourhood via an
// integral image). A photographed page — which is the whole point of §A1 — has a lighting gradient
// and often a shadow from the phone itself; a single global threshold turns the dark corner into
// solid ink and loses the staves there entirely. Local thresholding is O(n) and immune to that.

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
 * This is the signal that separates a STAFF LINE from everything else, and it is why row-darkness
 * alone is not enough: a row crossing a dense chord or a line of lyrics can carry as much total ink
 * as a stave line, but it carries it in short broken pieces. A stave line is one long unbroken run.
 * Still pure geometry — it does not know or care what the ink depicts.
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
// A photographed page is never square to the camera. Skew smears every staff line across many rows,
// which flattens the projection profile until the peaks that ARE the staves stop being peaks — so
// deskew is not cosmetic, it is what makes the rest of the pipeline work at all on real input.
//
// MODEL: a small rotation ≈ a vertical shear (y' = y + (x − cx)·tanθ). Exact enough below ~8°, and
// it makes the search a cheap profile computation rather than a resample per candidate angle.
// SCORE: variance of the row profile. Aligned staff lines concentrate ink into few rows ⇒ high
// variance; skewed ones spread it ⇒ low. Classic, and it needs no notion of what a note is.

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
 * ⚠️ THE `repair` STEP IS NOT OPTIONAL POLISH — WITHOUT IT DESKEW MAKES THINGS WORSE, SILENTLY.
 * MEASURED (the skewedPhoto fixture, 2.4°): the skew estimate came back EXACT (2.40 vs a truth of
 * 2.4) and detection still found **0 staves**, because a binary shear rounds each column's shift to
 * a whole row — so a staff line lands on row N for ~24 columns, then N+1 for the next ~24, and no
 * single ROW carries a long run any more. Longest run collapsed to 0.15 of the width, under any
 * usable threshold. The 1px vertical dilation stitches the wobble back into one line: 0 staves → 4,
 * at exactly the fixture's truth positions.
 *
 * This is why the repair lives HERE and not in `detectStaves`: the wobble is an artefact this
 * function's own quantisation introduces, so this function cleans it up. Detection then sees one
 * kind of image whether or not the page was skewed — rather than two rules for one pipeline, which
 * is the shape of CLAUDE.md's round-11 bug.
 *
 * The cost is a staff line thickened by ±1px, which `detectStaves` already absorbs (it merges
 * vertically-adjacent candidate rows into one line at the run-weighted centre).
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
// THIS IS THE LOAD-BEARING IDEA, and gap size alone is not a substitute for it.
//
// The obvious heuristic — "a small gap means one system, a big gap means a break" — fails exactly
// where it matters. Engravers tighten system spacing to fit a page, and on a cramped piano score the
// treble→bass gap and the system→system gap can be nearly the same size. A heuristic that only ranks
// gaps by size will then cut a grand stave in half: it splits the pianist's left hand from the right
// and inserts writing space between them. That is the one outcome §A1 forbids ("never split a
// system"), and `reflow.test.ts` has a fixture built to make it happen.
//
// The robust signal is STRUCTURAL and still pure geometry: staves inside one system are JOINED — by
// barlines running through the gap, and by the brace/bracket at the left edge. Between systems,
// nothing crosses. So: look in the gap for a column carrying a long vertical ink run. That is a
// barline test — explicitly the "easy CV" §A1 sanctions — and it reads the same on a cramped page as
// on a spacious one, because it measures the engraver's INTENT rather than their spacing budget.

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
 * NOTE ON THE LEFT MARGIN: a brace/bracket also spans the gap, at the very left edge — and it is a
 * *curve*, so it drifts across columns rather than filling one. It is a real connector and a real
 * signal, but a fragile one to measure, so the barlines (which are dead vertical and appear at every
 * bar) do the work and the left `braceMargin` is excluded to keep the brace from being counted as a
 * half-height smear. If a system somehow has no interior barline in the band, the gap-size vote in
 * `groupStavesIntoSystems` is the fallback.
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
}

export interface GroupOptions extends ConnectorOptions {
  /**
   * Use the vertical-connector test. Default TRUE.
   *
   * Exposed ONLY so the test suite can run the detector WITHOUT it and prove that the grand-stave
   * fixture then splits — i.e. that the fixture is genuinely hard and the connector test is what
   * carries it. A negative that cannot fail is not a negative. Do not turn this off in the app.
   */
  connectorTest?: boolean
}

/**
 * Group detected staves into systems (§A1's atomic unit).
 *
 * TWO VOTES, and the connector wins when they disagree:
 *  1. CONNECTOR (structural): ink crosses the gap ⇒ same system. Right even on cramped spacing.
 *  2. GAP SIZE (statistical): the gap is small relative to the page's gaps ⇒ probably same system.
 *     Only decides when there is nothing crossing — a real system break, or an engraving with no
 *     barline in the band.
 */
export function groupStavesIntoSystems(
  bin: BinaryImage, staves: DetectedStave[], opts: GroupOptions = {},
): System[] {
  if (!staves.length) return []
  const useConnector = opts.connectorTest ?? true

  const gaps: number[] = []
  for (let i = 1; i < staves.length; i++) gaps.push(staves[i].top - staves[i - 1].bottom)

  // The gap-size vote's cut-point. Not a magic constant: split the observed gaps at the widest
  // jump between consecutive SORTED gaps (a 1-D 2-means by inspection). On a page whose gaps are
  // all alike — one system, or uniform spacing — there is no meaningful jump, so the cut sits above
  // everything and the vote abstains rather than inventing a boundary.
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
      // Nothing crosses, and the gap is on the small side. Without a connector there is no positive
      // evidence of a join, so treat it as a break but say so quietly — this is exactly the case the
      // manual adjust handles exist for.
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
 * The whole §A1 detection pass over one already-binarised page.
 *
 * Returns coordinates in the DESKEWED image's space. Deskew belongs to CAPTURE (`capture.ts` rotates
 * the bitmap once, before storing) so that the stored page image, the anchors, and the reflow all
 * share ONE coordinate space. Two spaces for one page is how the annotations and the music drift
 * apart — the same class of failure as CLAUDE.md's round-11 "two rules, one pane".
 */
export function analysePage(bin: BinaryImage, opts: AnalyseOptions = {}): PageAnalysis {
  const skewDeg = opts.assumeDeskewed ? 0 : estimateSkew(bin, opts.skew)
  const straight = Math.abs(skewDeg) < 0.05 ? bin : deskew(bin, skewDeg)

  const staves = detectStaves(straight, opts)
  const systems = groupStavesIntoSystems(straight, staves, opts)

  // Slice at the MIDPOINT of each inter-system gap — the whitespace's own centre, so neither
  // system loses its ledger lines, dynamics or lyrics to the cut.
  const cuts: number[] = []
  for (let i = 1; i < systems.length; i++) {
    cuts.push(Math.round((systems[i - 1].bottom + systems[i].top) / 2))
  }
  const spacing = median(staves.map(s => s.spacing))
  return { skewDeg, systems, cuts, staveSpacing: spacing }
}

// ─── Source ↔ layout mapping (the view transform) ────────────────────────────
//
// The reflow NEVER rewrites the image. It is a pure mapping from source-image coordinates to laid-out
// coordinates, so that adjusting a handle re-lays-out instantly and moves NO annotation off its
// music (see types.ts, RegionAnchor: anchors are stored in source space precisely so this holds).

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
