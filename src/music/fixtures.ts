// ─── Synthetic score fixtures for the §A1 reflow detector ────────────────────
//
// WHY SYNTHETIC, AND WHY THIS FILE EXISTS AT ALL:
//
// 1. COPYRIGHT / THESIS INTEGRITY (standing rule). No real score may enter this repo — a photographed
//    score is someone's engraving, and Peter's own material never becomes a fixture. Drawing them
//    means the repo carries only geometry we generated.
// 2. GROUND TRUTH. A photo of a real page has to be hand-labelled, and a hand-labelled fixture drifts
//    the moment anyone re-crops it. Here the generator KNOWS where every system is, because it put
//    it there.
// 3. **THE FIXTURE MUST BE ABLE TO FAIL.** This is the point that matters most, and it is the
//    standing brief's: "a fixture of clean evenly-spaced scans proves nothing". So the generator is
//    parameterised on precisely the things that break a whitespace detector — system spacing that
//    collides with grand-stave spacing, skew, lighting gradients, speckle, lyrics sitting in the gap,
//    a page with a single system and therefore no gap distribution to reason from.
//
// HONESTY ABOUT WHAT A SYNTHETIC FIXTURE PROVES: it proves the ALGORITHM's geometry — the grouping
// rule, the connector test, the abstention. It does NOT prove the pipeline against a real phone
// photograph of a real page (paper texture, focus falloff, JPEG ringing, perspective rather than
// pure rotation). That needs a real device and real paper, and it is called out as an open gap in the
// report rather than quietly implied by a green suite.
//
// The renderer deliberately does NOT model perspective (keystone) — only rotation. A page held at an
// angle to the phone has converging staff lines that no shear can straighten. That is a REAL residual
// and the manual adjust handles are the current answer to it.

import type { GrayImage } from './reflow'

// ─── Spec ────────────────────────────────────────────────────────────────────

export interface SystemSpec {
  /** 1 = a single stave; 2 = a grand stave (piano treble+bass); more = a bracketed group. */
  staves: number
  /** px between staves INSIDE this system (the treble→bass distance). */
  interStaveGap: number
  /**
   * Draw barlines through the system's full height, joining its staves — what real engraving does,
   * and the signal `hasVerticalConnector` reads. Settable to false to model an engraving whose band
   * happens to carry no interior barline, which is the connector test's own blind spot.
   */
  connected?: boolean
}

export interface ScoreSpec {
  width: number
  height: number
  margin: number
  /** Staff line spacing in px — the page's unit of scale. */
  lineGap: number
  systems: SystemSpec[]
  /** px between one system's bottom line and the next system's top line. */
  systemGap: number
  /** Draw noteheads. They add ink WITHOUT long horizontal runs — which is what makes row-darkness
   *  alone insufficient and `rowLongestRun` necessary. On by default. */
  notes?: boolean
  /** Draw lyric/text blobs in the gap below each system — ink in the whitespace the detector must
   *  still recognise as whitespace (no long runs, no tall verticals). */
  lyrics?: boolean
  /** TRUE rotation in degrees (not the shear the detector approximates it with — see below). */
  skewDeg?: number
  /** Uneven lighting: 0 = flat, 1 = a strong corner-to-corner falloff, as a phone shadow gives. */
  lighting?: number
  /** Salt-and-pepper speckle, 0..1. */
  noise?: number
  /** Deterministic seed for notes/noise placement — a fixture that differs per run is not a fixture. */
  seed?: number
}

export interface SystemTruth {
  /** Row of the system's topmost staff line, BEFORE rotation. */
  top: number
  /** Row of its bottom-most staff line, before rotation. */
  bottom: number
  staves: number
  isGrandStave: boolean
}

export interface ScoreTruth {
  systems: SystemTruth[]
  /** The midpoints between systems — where a correct slicer cuts. Before rotation. */
  cuts: number[]
  lineGap: number
  skewDeg: number
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

const PAPER = 246
const INK = 38

function blank(w: number, h: number): GrayImage {
  const data = new Uint8ClampedArray(w * h)
  data.fill(PAPER)
  return { width: w, height: h, data }
}

function put(img: GrayImage, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = y * img.width + x
  if (v < img.data[i]) img.data[i] = v            // darken only — ink over ink stays ink
}

function hLine(img: GrayImage, x0: number, x1: number, y: number, thick = 1, v = INK) {
  for (let t = 0; t < thick; t++) for (let x = Math.round(x0); x <= Math.round(x1); x++) put(img, x, Math.round(y) + t, v)
}

function vLine(img: GrayImage, x: number, y0: number, y1: number, thick = 2, v = INK) {
  for (let t = 0; t < thick; t++) for (let y = Math.round(y0); y <= Math.round(y1); y++) put(img, Math.round(x) + t, y, v)
}

function blob(img: GrayImage, cx: number, cy: number, rx: number, ry: number, v = INK) {
  for (let y = Math.round(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.round(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) put(img, x, y, v)
    }
  }
}

/** Deterministic PRNG (mulberry32) — a fixture whose noise differs per run cannot be reasoned about. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── The generator ───────────────────────────────────────────────────────────

export function renderScore(spec: ScoreSpec): { img: GrayImage; truth: ScoreTruth } {
  const {
    width: w, height: h, margin, lineGap, systems, systemGap,
    notes = true, lyrics = false, skewDeg = 0, lighting = 0, noise = 0, seed = 1,
  } = spec
  const rand = rng(seed)
  let img = blank(w, h)
  const x0 = margin, x1 = w - margin

  const truth: SystemTruth[] = []
  let y = margin

  for (const sys of systems) {
    const staveTops: number[] = []
    for (let s = 0; s < sys.staves; s++) {
      staveTops.push(y)
      for (let l = 0; l < 5; l++) hLine(img, x0, x1, y + l * lineGap, 1)
      y += 4 * lineGap                                  // bottom line of this stave
      if (s < sys.staves - 1) y += sys.interStaveGap    // to the next stave's top line
    }
    const top = staveTops[0]
    const bottom = y
    truth.push({ top, bottom, staves: sys.staves, isGrandStave: sys.staves > 1 })

    // Barlines. For a multi-stave system they run the system's FULL height (crossing the inter-stave
    // gaps) — that is the connector. For a single-stave system they span only that stave, so nothing
    // ever crosses a system boundary.
    const connected = sys.connected ?? true
    const nBars = 4
    for (let b = 0; b <= nBars; b++) {
      const bx = x0 + ((x1 - x0) * b) / nBars
      if (connected) vLine(img, bx, top, bottom, 2)
      else for (const st of staveTops) vLine(img, bx, st, st + 4 * lineGap, 2)
    }
    // The brace at the left edge of a grand stave — a real connector, drawn for realism. The detector
    // deliberately does NOT rely on it (it excludes the left margin): a curve smears across columns.
    if (sys.staves > 1) {
      for (let yy = top; yy <= bottom; yy++) {
        const t = (yy - top) / (bottom - top)
        const bulge = Math.sin(t * Math.PI) * lineGap * 0.9
        put(img, Math.round(x0 - lineGap * 0.7 - bulge), yy, INK)
        put(img, Math.round(x0 - lineGap * 0.7 - bulge) + 1, yy, INK)
      }
    }

    if (notes) {
      for (const st of staveTops) {
        for (let n = 0; n < 14; n++) {
          const nx = x0 + lineGap * 2 + rand() * (x1 - x0 - lineGap * 4)
          const ny = st + rand() * (4 * lineGap)
          blob(img, nx, ny, lineGap * 0.62, lineGap * 0.48)
          vLine(img, nx + lineGap * 0.6, ny - lineGap * 3.2, ny, 1)   // stem
        }
      }
    }

    if (lyrics) {
      // Ink in the gap — no long horizontal runs, no tall verticals. Must NOT read as a system.
      for (let n = 0; n < 26; n++) {
        const lx = x0 + rand() * (x1 - x0)
        const ly = bottom + lineGap * 1.4 + rand() * lineGap
        blob(img, lx, ly, lineGap * 0.35, lineGap * 0.35)
      }
    }

    y = bottom + systemGap
  }

  const cuts: number[] = []
  for (let i = 1; i < truth.length; i++) cuts.push(Math.round((truth[i - 1].bottom + truth[i].top) / 2))

  // ROTATE — genuinely, about the image centre.
  //
  // THIS IS DELIBERATE AND IT MATTERS: the detector models skew as a vertical SHEAR. If the fixture
  // also sheared, the fixture and the model would share one assumption and the test would certify
  // that assumption against itself — the house disease exactly (a known-negative that scores
  // identically to the right answer BY CONSTRUCTION). Generating with true rotation makes the
  // estimator work against something it does not perfectly model, which is the honest test.
  if (skewDeg !== 0) img = rotate(img, skewDeg)

  if (lighting > 0) applyLighting(img, lighting)
  if (noise > 0) applyNoise(img, noise, rand)

  return { img, truth: { systems: truth, cuts, lineGap, skewDeg } }
}

function rotate(img: GrayImage, deg: number): GrayImage {
  const { width: w, height: h } = img
  const out = blank(w, h)
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(-a), sin = Math.sin(-a)
  const cx = w / 2, cy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const sx = Math.round(cx + dx * cos - dy * sin)
      const sy = Math.round(cy + dx * sin + dy * cos)
      out.data[y * w + x] = (sx >= 0 && sy >= 0 && sx < w && sy < h) ? img.data[sy * w + sx] : PAPER
    }
  }
  return out
}

/** A corner-to-corner falloff — the phone's own shadow. This is what kills a GLOBAL threshold. */
function applyLighting(img: GrayImage, strength: number) {
  const { width: w, height: h, data } = img
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.6 + (y / h) * 0.4
      const f = 1 - strength * 0.55 * t
      data[y * w + x] = Math.max(0, Math.min(255, data[y * w + x] * f))
    }
  }
}

function applyNoise(img: GrayImage, amount: number, rand: () => number) {
  const { data } = img
  for (let i = 0; i < data.length; i++) {
    if (rand() < amount) data[i] = rand() < 0.5 ? INK + 20 : PAPER
  }
}

// ─── Named fixtures — each exists to break something specific ─────────────────

/** The easy case: three well-spaced single-stave systems, clean scan. The control. */
export function cleanThreeSystems(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 600, height: 800, margin: 40, lineGap: 8, systemGap: 70,
    systems: [{ staves: 1, interStaveGap: 0 }, { staves: 1, interStaveGap: 0 }, { staves: 1, interStaveGap: 0 }],
  })
}

/**
 * THE ONE THAT MATTERS: piano grand staves at CRAMPED system spacing.
 *
 * interStaveGap 26 (treble→bass) vs systemGap 34 (system→system). The two are nearly the same, so a
 * gap-size heuristic has almost nothing to separate them — and when it guesses wrong it slices a
 * grand stave in half and inserts writing space between the pianist's hands. Only the connector test
 * (barlines cross the treble→bass gap; nothing crosses the system gap) gets this right, and
 * `reflow.test.ts` proves that by turning it off and watching the split happen.
 */
export function crampedGrandStaves(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 600, height: 900, margin: 40, lineGap: 7, systemGap: 34,
    systems: [
      { staves: 2, interStaveGap: 26 },
      { staves: 2, interStaveGap: 26 },
      { staves: 2, interStaveGap: 26 },
    ],
  })
}

/** A skewed, unevenly-lit, speckled photograph of a grand-stave page — the realistic capture. */
export function skewedPhoto(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 640, height: 900, margin: 46, lineGap: 8, systemGap: 60,
    systems: [{ staves: 2, interStaveGap: 30 }, { staves: 2, interStaveGap: 30 }],
    skewDeg: 2.4, lighting: 0.8, noise: 0.012, seed: 7,
  })
}

/**
 * A HARSH phone shadow across the page — the case that actually separates local from global
 * thresholding.
 *
 * MEASURED, and it corrected a claim this file made before it was checked: at `skewedPhoto`'s
 * lighting (0.8) a global Otsu threshold detects the systems just as well as the local one — ink and
 * paper stay separable everywhere, so the local threshold wins nothing and a test claiming otherwise
 * proves nothing. The populations only overlap at strength ≥1.3, where shadowed paper gets darker
 * than lit ink: global then floods 36% of the page to ink and detection collapses from 2 systems to
 * 1, while local holds at 2. That is the fixture worth having, so this is it.
 */
export function harshShadow(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 640, height: 400, margin: 46, lineGap: 8, systemGap: 60,
    systems: [{ staves: 2, interStaveGap: 30 }, { staves: 2, interStaveGap: 30 }],
    lighting: 1.4, seed: 7,
  })
}

/** One system, no gaps at all — there is no gap distribution to reason from. The detector must
 *  return exactly one system and NOT invent a boundary out of a population of size zero. */
export function singleSystem(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 600, height: 300, margin: 40, lineGap: 9, systemGap: 60,
    systems: [{ staves: 2, interStaveGap: 32 }],
  })
}

/** Lyrics under every system: ink sitting in the whitespace the detector wants to cut through. */
export function withLyrics(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 600, height: 820, margin: 40, lineGap: 8, systemGap: 76,
    systems: [{ staves: 1, interStaveGap: 0 }, { staves: 1, interStaveGap: 0 }, { staves: 1, interStaveGap: 0 }],
    lyrics: true, seed: 3,
  })
}

/** Mixed: a grand stave followed by two single staves — grouping must not be uniform-by-assumption. */
export function mixedGrandAndSingle(): { img: GrayImage; truth: ScoreTruth } {
  return renderScore({
    width: 600, height: 900, margin: 40, lineGap: 8, systemGap: 64,
    systems: [
      { staves: 2, interStaveGap: 30 },
      { staves: 1, interStaveGap: 0 },
      { staves: 1, interStaveGap: 0 },
    ],
  })
}
