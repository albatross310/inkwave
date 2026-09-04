// ─── Smart leader-line routing (build-spec §A2 — distinctive feature) ────────
//
// Reflow gives the student room to write, but the room is not next to the thing they are writing
// about, and a straight line between them cuts through the music. So the connector LEAVES the note
// sideways, travels through whitespace, and ARRIVES from the side that has clearance.
//
// PURE — no DOM. ⚠ Coordinates are LAYOUT space, because a leader is a thing you SEE and what it must
// avoid is where the systems are ON SCREEN. Its endpoints are STORED as anchors in source/gap space
// and resolved each render, so a reflow adjustment re-routes rather than strands the line.
// → docs/archive/music-module-build.md#leader

export interface Point { x: number; y: number }

/** An occupied band in LAYOUT space — a system the connector should not cut through. */
export interface Obstacle {
  y0: number
  y1: number
  /** Layout-space x-extent. Systems span the page, but a bar-scoped obstacle need not. */
  x0?: number
  x1?: number
}

export interface LeaderRoute {
  /** SVG path data, ready for a <path d>. Cubic Bézier — one curve, no joints to look wrong. */
  path: string
  /** Sampled points along the curve, for hit-testing and for scoring. */
  points: Point[]
  /** Which side the line arrives at the target from. */
  approach: 'above' | 'below'
  /** How many obstacle bands the chosen route crosses. 0 whenever a clear route exists. */
  crossings: number
}

export interface RouteOptions {
  from: Point                 // where the note body sits (layout space)
  to: Point                   // the point on the music being indicated
  obstacles?: Obstacle[]
  /**
   * Page aspect (width / height) in layout space. Control offsets are computed per axis, so without
   * it the same offset is a different DISTANCE on each: a curve looks limp on a tall page and like a
   * hairpin on a wide one.
   */
  aspect?: number
  /** Force the approach side (the student's override of the §A2 midline rule). */
  side?: 'above' | 'below'
}

// ─── The midline rule (§A2) ──────────────────────────────────────────────────

/**
 * §A2's ownership rule for a mark between two staves: "above-midline → belongs to the stave below".
 *
 * ⚠️ IMPLEMENTED LITERALLY, AND THE SPEC IS GENUINELY AMBIGUOUS HERE — flagged for Peter rather than
 * guessed at, because the two readings disagree for exactly the marks near the midline, the ones
 * that need the rule. So this is a DEFAULT and `LeaderContent.side` overrides it: a default that is
 * wrong half the time is survivable; a rule with no override would not be.
 * → docs/archive/music-module-build.md#leader-midline
 */
export function ownerOfGapMark(markY: number, gapTop: number, gapBottom: number): 'above' | 'below' {
  const midline = (gapTop + gapBottom) / 2
  // Above the midline ⇒ it belongs to the stave BELOW ⇒ the note sits ABOVE its owner.
  return markY < midline ? 'below' : 'above'
}

// ─── Routing ─────────────────────────────────────────────────────────────────

function bezier(p0: Point, c1: Point, c2: Point, p1: Point, n = 48): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
    pts.push({
      x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
      y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
    })
  }
  return pts
}

function inside(o: Obstacle, p: Point): boolean {
  if (p.y < o.y0 || p.y > o.y1) return false
  if (o.x0 !== undefined && p.x < o.x0) return false
  if (o.x1 !== undefined && p.x > o.x1) return false
  return true
}

/**
 * How many obstacle bands the sampled path passes through. Counts BANDS ENTERED, not points inside —
 * otherwise a long curve lying along a system scores worse than a short stab straight through it.
 *
 * ⚠️ THE TARGET'S OWN BAND IS NOT AN OBSTACLE, and getting this wrong made every route look bad: a
 * leader points at a BAR, a bar is inside a system, so any route that does its job ends up inside
 * one. Excluding only the final POINT is not enough — the curve enters the band a third of its
 * length before the end — so the whole band is dropped.
 * → docs/archive/music-module-build.md#leader-crossings
 */
export function countCrossings(points: Point[], obstacles: Obstacle[]): number {
  if (!points.length) return 0
  const target = points[points.length - 1]
  let n = 0
  for (const o of obstacles) {
    if (inside(o, target)) continue          // the destination, not an obstacle
    let was = false
    for (const p of points) {
      const now = inside(o, p)
      if (now && !was) n++
      was = now
    }
  }
  return n
}

function pathLength(points: Point[], aspect: number): number {
  let d = 0
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i].x - points[i - 1].x) * aspect
    const dy = points[i].y - points[i - 1].y
    d += Math.hypot(dx, dy)
  }
  return d
}

/**
 * Route one leader line: leave the note HORIZONTALLY (so it reads as coming out of the label) and
 * arrive VERTICALLY (so it points AT the stave). Both approach sides are built and SCORED, because
 * which side is clear changes every time the student drags a handle.
 *
 * ⚠️ HONEST LIMIT ON "AVOIDANCE": a system spans the full page width, so a leader from two systems
 * away MUST pass through what lies between — no curve routes around a band with no ends. For
 * full-width obstacles this chooses WHERE to cross, not WHETHER. What it genuinely routes around are
 * LOCAL obstacles (other sticky notes crowding the same gap), which is the congestion §A2 describes.
 * → docs/archive/music-module-build.md#leader-scoring
 */
export function routeLeader(opts: RouteOptions): LeaderRoute {
  const { from, to, obstacles = [], aspect = 0.75 } = opts

  const build = (approach: 'above' | 'below', exit: 'side' | 'vertical'): LeaderRoute => {
    const dx = to.x - from.x
    const dy = to.y - from.y

    // How the line LEAVES the label. 'side' is the legible default; 'vertical' is the escape hatch
    // for when something sits directly beside the label — with only a sideways exit, a note pinned
    // next to another has nowhere to go but through it (measured: the known-negative crossed on
    // BOTH approach sides until this existed).
    const c1: Point = exit === 'side'
      ? { x: from.x + (Math.abs(dx) < 0.06 ? 0.06 * Math.sign(dx || 1) : dx * 0.5), y: from.y }
      : { x: from.x, y: from.y + (Math.abs(dy) < 0.06 ? 0.06 * Math.sign(dy || 1) : dy * 0.5) }

    // Arrive vertically. The stand-off scales with the vertical distance — a fixed offset overshoots
    // on short runs.
    const stand = Math.max(0.02, Math.min(0.12, Math.abs(dy) * 0.45))
    const c2: Point = { x: to.x, y: approach === 'above' ? to.y - stand : to.y + stand }

    const points = bezier(from, c1, c2, to)
    return {
      path: `M ${f(from.x)} ${f(from.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(to.x)} ${f(to.y)}`,
      points,
      approach,
      crossings: countCrossings(points, obstacles),
    }
  }

  // Score in THIS order:
  //  1. CROSSINGS — a route through the music is wrong at any length.
  //  2. EXIT STYLE — ⚠ a LEGIBILITY rule, not an optimisation: the vertical exit exists ONLY to
  //     dodge, and reads as a stem hanging off the note, so it must not win merely by being shorter
  //     — which it otherwise does whenever the target sits directly below the label.
  //  3. LENGTH — the tie-break within one style.
  const sides: Array<'above' | 'below'> = opts.side ? [opts.side] : ['above', 'below']
  const exits = ['side', 'vertical'] as const
  const candidates = exits.flatMap((exit, rank) =>
    sides.map(s => ({ route: build(s, exit), rank })),
  )

  candidates.sort((a, b) =>
    a.route.crossings !== b.route.crossings ? a.route.crossings - b.route.crossings
      : a.rank !== b.rank ? a.rank - b.rank
        : pathLength(a.route.points, aspect) - pathLength(b.route.points, aspect),
  )
  return candidates[0].route
}

function f(n: number): string {
  // 4dp is ~0.4px on a 4000px page and keeps the stored/serialised path compact.
  return String(Math.round(n * 1e4) / 1e4)
}

/**
 * A straight line from note to target — what the connector replaces. ⚠ Kept as the KNOWN-NEGATIVE's
 * engine, never as a fallback: without a comparator, "the router picks a good route" is
 * unfalsifiable, because every route it returns would look like the right one.
 */
export function naiveRoute(from: Point, to: Point, obstacles: Obstacle[] = []): LeaderRoute {
  const points = bezier(from, from, to, to)
  return {
    path: `M ${f(from.x)} ${f(from.y)} L ${f(to.x)} ${f(to.y)}`,
    points,
    approach: to.y > from.y ? 'above' : 'below',
    crossings: countCrossings(points, obstacles),
  }
}
