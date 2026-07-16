// ─── The §A1 reflow detector, tested where it can actually fail ──────────────
//
// THE STANDING RULE THIS SUITE IS WRITTEN AGAINST (CLAUDE.md's sixteen burns, and the brief's
// restatement of them): "a self-check that measures in a fiction does not fail loudly — it silently
// DISABLES the feature it guards, and the feature's absence looks exactly like the feature being
// unnecessary." A reflow detector that only ever sees clean, evenly-spaced, square-on scans will
// pass forever while being unable to do the one thing it exists for.
//
// So the fixtures are built to break it (see fixtures.ts), and the central claim — that the
// CONNECTOR TEST is what keeps a cramped grand stave intact — is proved by a KNOWN-NEGATIVE that is
// shown TO FIRE: with the connector test off, the same image splits the grand staves. If that
// negative ever stops firing, the fixture has gone soft and every verdict below it is worthless.

import { describe, expect, it } from 'vitest'
import {
  analysePage, binarise, buildLayout, countVerticalConnectors, deskew, detectStaves, estimateSkew,
  gapAt, gapOffsetToLayout, groupStavesIntoSystems, layoutToSource, rowDarkness, rowLongestRun,
  sourceToLayout,
} from './reflow'
import {
  cleanThreeSystems, crampedGrandStaves, harshShadow, mixedGrandAndSingle, renderScore, singleSystem,
  skewedPhoto, withLyrics,
} from './fixtures'

// ─── The control ─────────────────────────────────────────────────────────────

describe('clean, well-spaced page (the control)', () => {
  it('finds every system and cuts in the whitespace between them', () => {
    const { img, truth } = cleanThreeSystems()
    const a = analysePage(binarise(img))

    expect(a.systems).toHaveLength(3)
    expect(a.cuts).toHaveLength(2)
    a.cuts.forEach((cut, i) => expect(Math.abs(cut - truth.cuts[i])).toBeLessThanOrEqual(6))
    // Every cut must land in genuine whitespace — never through a system.
    for (const cut of a.cuts) {
      for (const s of a.systems) expect(cut < s.top || cut > s.bottom).toBe(true)
    }
  })

  it('locates each system on its real staves', () => {
    const { img, truth } = cleanThreeSystems()
    const a = analysePage(binarise(img))
    a.systems.forEach((s, i) => {
      expect(Math.abs(s.top - truth.systems[i].top)).toBeLessThanOrEqual(4)
      expect(Math.abs(s.bottom - truth.systems[i].bottom)).toBeLessThanOrEqual(4)
      expect(s.isGrandStave).toBe(false)
    })
  })
})

// ─── The case the feature exists for ─────────────────────────────────────────

describe('cramped grand staves — NEVER SPLIT A SYSTEM (§A1)', () => {
  it('keeps each piano grand stave whole even though the system gap is barely larger', () => {
    const { img, truth } = crampedGrandStaves()
    const bin = binarise(img)

    // The fixture really is adversarial: confirm the two gap populations nearly collide, so that a
    // pass here cannot be an easy page wearing a hard name.
    const staves = detectStaves(bin)
    expect(staves).toHaveLength(6)                         // 3 systems × treble+bass
    const gaps = staves.slice(1).map((s, i) => s.top - staves[i].bottom)
    const inner = [gaps[0], gaps[2], gaps[4]]              // treble→bass, within a system
    const outer = [gaps[1], gaps[3]]                       // system→system
    const worst = Math.min(...outer) / Math.max(...inner)
    expect(worst).toBeLessThan(1.6)                        // i.e. gap size alone cannot separate them

    const a = analysePage(bin)
    expect(a.systems).toHaveLength(3)
    for (const s of a.systems) {
      expect(s.isGrandStave).toBe(true)
      expect(s.staves).toHaveLength(2)
    }
    expect(a.cuts).toHaveLength(2)
    a.cuts.forEach((cut, i) => expect(Math.abs(cut - truth.cuts[i])).toBeLessThanOrEqual(8))
  })

  // ─── THE KNOWN-NEGATIVE ────────────────────────────────────────────────────
  // Proves the connector test is doing the work, and that the fixture can fail. If this ever passes
  // (i.e. no split without the connector), the fixture has stopped being hard — fix the FIXTURE, not
  // this assertion.
  it('KNOWN-NEGATIVE: without the connector test the same page splits the grand staves', () => {
    const { img } = crampedGrandStaves()
    const bin = binarise(img)
    const staves = detectStaves(bin)

    const withConnector = groupStavesIntoSystems(bin, staves, { connectorTest: true })
    const without = groupStavesIntoSystems(bin, staves, { connectorTest: false })

    expect(withConnector).toHaveLength(3)
    expect(without.length).toBeGreaterThan(3)              // the bug reproduces
    expect(without.some(s => s.isGrandStave)).toBe(false)  // …by cutting every grand stave in half
  })

  it('the connector is really there to be found: barlines cross the inner gap, nothing crosses the outer', () => {
    const { img } = crampedGrandStaves()
    const bin = binarise(img)
    const staves = detectStaves(bin)
    // treble→bass (staves 0→1): joined by barlines.
    expect(countVerticalConnectors(bin, staves[0].bottom + 1, staves[1].top - 1)).toBeGreaterThan(0)
    // system→system (staves 1→2): nothing crosses.
    expect(countVerticalConnectors(bin, staves[1].bottom + 1, staves[2].top - 1)).toBe(0)
  })
})

// ─── Messy input ─────────────────────────────────────────────────────────────

describe('a real-ish photograph: skew + uneven lighting + speckle', () => {
  it('estimates the skew close to truth', () => {
    const { img, truth } = skewedPhoto()
    const skew = estimateSkew(binarise(img))
    // The detector models rotation as a shear and the fixture rotates for real, so exactness is not
    // available — half a degree is well inside what the pipeline needs.
    expect(Math.abs(skew - truth.skewDeg)).toBeLessThan(0.6)
  })

  it('still finds both grand staves, whole', () => {
    const { img } = skewedPhoto()
    const a = analysePage(binarise(img))
    expect(a.systems).toHaveLength(2)
    for (const s of a.systems) expect(s.isGrandStave).toBe(true)
  })

  it('KNOWN-NEGATIVE: skipping deskew on the same photo degrades detection', () => {
    // Proves the deskew step earns its place rather than being decoration.
    const { img } = skewedPhoto()
    const bin = binarise(img)
    const skipped = analysePage(bin, { assumeDeskewed: true })
    const proper = analysePage(bin)
    const wholeGrandStaves = (a: typeof proper) =>
      a.systems.length === 2 && a.systems.every(s => s.isGrandStave)
    expect(wholeGrandStaves(proper)).toBe(true)
    expect(wholeGrandStaves(skipped)).toBe(false)
  })

  it('recovers the staff lines as long runs once deskewed', () => {
    const { img } = skewedPhoto()
    const bin = binarise(img)
    // MEASURED ON THE DESKEWED IMAGE, deliberately. The first cut of this test read runs off the
    // SKEWED binary and asserted long runs were present — they cannot be: at 2.4° a staff line
    // crosses ~23 rows on its way across the page, so no row holds it. The test was measuring the
    // skew and calling it a thresholding failure. Deskew first, then ask anything else.
    const straight = deskew(bin, estimateSkew(bin))
    const runs = Array.from(rowLongestRun(straight))
    expect(runs.filter(r => r > 0.5).length).toBeGreaterThan(15)   // 4 staves × ~5 lines
    expect(runs.filter(r => r > 0.95).length / runs.length).toBeLessThan(0.3)  // nothing flooded
  })
})

// ─── Thresholding, tested against the thing it claims to beat ────────────────

describe('local thresholding under a harsh shadow', () => {
  /** A global Otsu threshold — the alternative this pipeline rejected. The known-negative's engine. */
  function otsu(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }) {
    const hist = new Array(256).fill(0)
    for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++
    const total = img.data.length
    let sum = 0
    for (let t = 0; t < 256; t++) sum += t * hist[t]
    let sumB = 0, wB = 0, best = 0, bestVar = -1
    for (let t = 0; t < 256; t++) {
      wB += hist[t]
      if (!wB) continue
      const wF = total - wB
      if (!wF) break
      sumB += t * hist[t]
      const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
      if (v > bestVar) { bestVar = v; best = t }
    }
    const ink = new Uint8Array(img.width * img.height)
    for (let i = 0; i < ink.length; i++) ink[i] = img.data[i] <= best ? 1 : 0
    return { width: img.width, height: img.height, ink }
  }
  const inkFraction = (b: { ink: Uint8Array }) =>
    b.ink.reduce((a: number, v: number) => a + v, 0) / b.ink.length

  it('KNOWN-NEGATIVE: a global threshold floods the shadow and loses a system; the local one holds', () => {
    // This is the whole justification for `binarise` being local rather than global, and it is the
    // claim that was WRONG until it was measured: at the moderate lighting of `skewedPhoto` (0.8),
    // global does just as well — ink and paper never overlap, so nothing is being tested. Only a
    // harsh shadow (1.4) makes shadowed paper darker than lit ink, which is where one global cut
    // point cannot exist. If this negative stops firing, `binarise` has no proven reason to be local.
    const { img } = harshShadow()
    const global = otsu(img)
    const local = binarise(img)

    expect(inkFraction(global)).toBeGreaterThan(0.25)     // the shadow read as ink — flooded
    expect(inkFraction(local)).toBeLessThan(0.12)         // local tracked the gradient

    expect(analysePage(global).systems).toHaveLength(1)   // the bug: two systems fused into one
    const l = analysePage(local)
    expect(l.systems).toHaveLength(2)
    expect(l.systems.every(s => s.isGrandStave)).toBe(true)
  })
})

describe('lyrics in the gap', () => {
  it('does not mistake text in the whitespace for a system', () => {
    const { img } = withLyrics()
    const a = analysePage(binarise(img))
    expect(a.systems).toHaveLength(3)
  })

  it('lyric ink is real: it raises row darkness without creating long runs', () => {
    // Guards the fixture itself — if the lyrics stopped being drawn, the test above would pass
    // vacuously and we would never know the case was untested.
    const { img, truth } = withLyrics()
    const bin = binarise(img)
    const dark = rowDarkness(bin)
    const runs = rowLongestRun(bin)
    // Span the WHOLE gap. The first cut sampled ±14 rows around the gap's midpoint and found no ink
    // at all — the lyrics sit just under their own system, not at the midpoint — so it reported "no
    // ink in the gap" on a fixture that draws lyrics into every gap. A window that misses the thing
    // it is looking for reports its own miss as the subject's absence.
    const band = (a: Float64Array) =>
      Array.from(a.slice(truth.systems[0].bottom + 3, truth.systems[1].top - 3))
    expect(Math.max(...band(dark))).toBeGreaterThan(0.02)   // there IS ink in the gap
    expect(Math.max(...band(runs))).toBeLessThan(0.5)       // but no long run — it is not a stave
  })
})

describe('degenerate pages', () => {
  it('a single system yields one system and no cuts — it invents no boundary', () => {
    const { img } = singleSystem()
    const a = analysePage(binarise(img))
    expect(a.systems).toHaveLength(1)
    expect(a.systems[0].isGrandStave).toBe(true)
    expect(a.cuts).toEqual([])
  })

  it('a blank page yields nothing rather than throwing', () => {
    const { img } = renderScore({
      width: 300, height: 400, margin: 30, lineGap: 8, systemGap: 60, systems: [],
    })
    const a = analysePage(binarise(img))
    expect(a.systems).toEqual([])
    expect(a.cuts).toEqual([])
  })
})

describe('mixed layouts', () => {
  it('groups a grand stave and two single staves correctly — not uniformly', () => {
    const { img } = mixedGrandAndSingle()
    const a = analysePage(binarise(img))
    expect(a.systems).toHaveLength(3)
    expect(a.systems.map(s => s.staves.length)).toEqual([2, 1, 1])
    expect(a.systems.map(s => s.isGrandStave)).toEqual([true, false, false])
  })
})

// ─── The view transform ──────────────────────────────────────────────────────
//
// The reflow must never move an annotation off its music: anchors are stored in SOURCE space and the
// layout is a pure function of them (types.ts, RegionAnchor). These pin that.

describe('layout mapping', () => {
  const cuts = [0.3, 0.6]
  const layout = buildLayout(cuts, () => 0.2)

  it('inserts a gap after every system but the last', () => {
    expect(layout.bands.filter(b => b.kind === 'gap')).toHaveLength(2)
    expect(layout.height).toBeCloseTo(1 + 0.4, 6)
  })

  it('round-trips a source position through the layout and back', () => {
    for (const y of [0, 0.1, 0.29, 0.31, 0.5, 0.75, 1]) {
      expect(layoutToSource(layout, sourceToLayout(layout, y))).toBeCloseTo(y, 6)
    }
  })

  it('keeps music BELOW a gap glued to the music, not to the page', () => {
    // A source y just after the first cut lands exactly one gap-height further down.
    expect(sourceToLayout(layout, 0.3)).toBeCloseTo(0.3, 6)
    expect(sourceToLayout(layout, 0.35)).toBeCloseTo(0.35 + 0.2, 6)
    expect(sourceToLayout(layout, 0.65)).toBeCloseTo(0.65 + 0.4, 6)
  })

  it('resizing one gap moves NO annotation relative to its own music', () => {
    // The whole point of anchoring in source space. Grow the first gap; every source position still
    // maps to the same place relative to the system it belongs to.
    const wider = buildLayout(cuts, i => (i === 0 ? 0.5 : 0.2))
    expect(sourceToLayout(wider, 0.2)).toBeCloseTo(sourceToLayout(layout, 0.2), 6)      // above: fixed
    expect(sourceToLayout(wider, 0.5) - sourceToLayout(layout, 0.5)).toBeCloseTo(0.3, 6) // below: shifts as one
    // …and the mark's position WITHIN its own system is unchanged, which is what "never moves off the
    // music" means:
    const relBefore = sourceToLayout(layout, 0.5) - sourceToLayout(layout, 0.45)
    const relAfter = sourceToLayout(wider, 0.5) - sourceToLayout(wider, 0.45)
    expect(relAfter).toBeCloseTo(relBefore, 6)
  })

  it('places and recovers an annotation written INSIDE a gap', () => {
    const mid = 0.3 + 0.1                       // halfway down the first gap
    const g = gapAt(layout, mid)
    expect(g!.afterSystem).toBe(0)
    expect(g!.t).toBeCloseTo(0.5, 6)
    expect(gapOffsetToLayout(layout, 0, 0.5)).toBeCloseTo(mid, 6)
  })

  it('a gap annotation stays put, proportionally, when its gap is resized', () => {
    const wider = buildLayout(cuts, i => (i === 0 ? 0.5 : 0.2))
    const g = gapAt(layout, 0.3 + 0.1)!
    // Same (afterSystem, t) → still halfway down the (now taller) gap, still under the same system.
    expect(gapOffsetToLayout(wider, g.afterSystem, g.t)).toBeCloseTo(0.3 + 0.25, 6)
  })

  it('a layout-space y inside a gap has no source position and clamps to its cut', () => {
    expect(layoutToSource(layout, 0.3 + 0.1)).toBeCloseTo(0.3, 6)
  })

  it('with no gaps the layout is the identity', () => {
    const flat = buildLayout(cuts, () => 0)
    expect(flat.height).toBeCloseTo(1, 6)
    for (const y of [0, 0.25, 0.5, 1]) expect(sourceToLayout(flat, y)).toBeCloseTo(y, 6)
  })
})
