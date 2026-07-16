# textRender probe harness

Measures the plaintext page renderer (`src/editor/textRender.ts`) IN THE REAL APP — real built
bundle, real shipped+stripped fonts, real device DPR, real live ProseMirror document. Flag
`inkwave:textRender` (default OFF); `?textRender` arms it.

## Run

```sh
pnpm build
node scripts/scrub-probe/server.mjs "$(pwd)/build/client" 4231 &   # own port + PID
PROBE_PORT=4231 NODE_PATH="$(pwd)/node_modules" node scripts/textrender-probe/probe.mjs
PROBE_PORT=4231 node scripts/textrender-probe/breaks.prove.mjs   # arith breaks == live editor breaks
PROBE_PORT=4231 node scripts/textrender-probe/fidelity.mjs       # pixel diff vs the real editor
PROBE_PORT=4231 node scripts/textrender-probe/mapcompare.mjs     # thumbnail vs text vs line-rect
PROBE_PORT=4231 node scripts/textrender-probe/isolate.prove.mjs  # engine vs live, per content kind

# The collectLines NodeView-rect fix (2026-07-17) — all three must pass:
PROBE_PORT=4231 node scripts/textrender-probe/linecount.prove.mjs    # phantom lines, per block
PROBE_PORT=4231 node scripts/textrender-probe/midline.prove.mjs      # every break at a true line start
PROBE_PORT=4231 node scripts/textrender-probe/crossdevice.prove.mjs  # canonical breaks: desktop == phone
PROBE_PORT=4231 node scripts/textrender-probe/pagcheck.prove.mjs     # scoped measure == full measure
EXPECT_POSITIVE=1 … node scripts/textrender-probe/midline.prove.mjs  # run against an UNFIXED build:
                                                                     # the probe must REPRODUCE the bug
```

## Files

- `probe.mjs` — the perf matrix: {2k,10k,40k words} × {build cold/warm, paint text/rects, map strip}
  + BASELINE A (real SVG-foreignObject bake) + BASELINE B (real WebP encode→decode→blit) + memory.
- `breaks.prove.mjs` — **the load-bearing one.** Compares the arithmetic model's break positions
  against the LIVE editor's own gap widgets. This is what caught the orphan-snap drift.
- `fidelity.mjs` — screenshot diff vs the real ProseMirror, with an offset sweep + ink denominator.
- `mapcompare.mjs` — the minimap question, shown: real editor pixels downscaled vs text vs line-rect.
- `landingcost.prove.mjs` — what a RICH pane costs at rest, measured against the rich landing that
  already exists (`ops === null` → DocView) vs the flat one, byte-identical content, thesis scale,
  desktop + phone-emu. Answer: rich paginates ~2× CHEAPER than flat. Both numbers are floors and both
  caveats favour flat; the unmeasured number is RichDiffView's diff-mark increment.
  `TRIALS=12 PROBE_PORT=… node scripts/textrender-probe/landingcost.prove.mjs`
- `panecontent.prove.mjs` — **read this before wiring anything into `show()`.** Asks the /snapshot
  doc pane what it is actually made of. Every other probe here drives the LIVE EDITOR; this one drives
  the pane the renderer is meant to PAINT, and they are not the same document (round 12). Its control
  is snap-00 (`ops === null` → rich DocView) vs snap-01 (`ops !== null` → flat FullDiffView) on
  BYTE-IDENTICAL content: one census, one route, one pane, so a blind census reports "no headings" on
  the rich path too and the probe exits 1 rather than return a verdict.

## Traps this harness had to survive (each produced a confident WRONG number first)

1. **JS-only timing.** `fillText` RECORDS a command; it does not rasterise. Timing the record loop
   said 0.1ms/page. Forcing the raster (1px readback) says ~5ms. Always quote `flushedMs`.
2. **Fresh canvas per page.** Allocating a 3.5MP canvas per paint costs 15-40ms and is a HARNESS
   artifact — production reuses one canvas per pane. Measure on a reused canvas.
3. **Transparent background.** Every ancestor of `.ProseMirror` is `rgba(0,0,0,0)` (the parchment is
   painted by sheet panels), so trusting a computed bg painted a transparent page and the diff read
   99.9% — a total-failure verdict that was entirely the harness. Sample the parchment from the
   editor's own pixels.
4. **Even page offsets.** The editor is GAPPED (266-275px between sheets); pages are NOT at
   N×pageHeight. Use each page's own `.inkwave-sheet` rect.
5. **Quantised memory.** `performance.memory` buckets to 10MB without `--enable-precise-memory-info`,
   so a real per-model delta reads as exactly 0.00MB — i.e. "free" rather than "not measured".
6. **A differ that can't see.** The pixel differ asserts identical→0% and a 4px shift→>0% before any
   fidelity number is believed.
7. **THE VACUOUS AUDIT (2026-07-17 — cost the most, caught only by tracing a "pass").** The first
   mid-line audit asked the GAPPED DOM whether each break sat at a line start and reported a
   confident **0/104 — on a document with real mid-line breaks**. The page-gap widget is a
   `display:block` span, so it FORCES a line break at its own position: in the gapped DOM every break
   is trivially at a line start. The question answered itself. `midlineAudit` now removes the gaps
   from flow and asks the NATURAL wrapping — the gap-free canonical layout collectLines actually
   measures — and reports `gapsLeftFlow` (gapped height must exceed natural height) so the vacuous
   configuration cannot pass silently. Same family as `canvasShapingMatchesEditor`.
8. **The verdict is unreadable off-canonical.** Breaks are measured in a FORCED canonical context
   (18px base); the phone RENDERS at 22.5px in a ~350px column. Auditing canonical break positions
   against the phone's own reflow reports ~6 "mid-line" breaks that are canonical pagination working
   as designed. `midlineAudit` returns `renderingIsCanonical`; read `midline` only when it is true.
9. **A rate can't see a rare event.** Inline math measured 0 mid-line breaks even UNFIXED — not
   "no phantom", just "no break happened to land on one" (24 pills, 9 breaks). Measuring the ARTIFACT
   per block instead (`lineCountAudit`) showed math over-counting 23 blocks by +30 lines. If an
   instrument depends on a coincidence, build the one that measures the thing itself.
10. **A PROBE SUITE THAT NEVER ASKED THE TARGET (2026-07-17 — round 12, the biggest one yet).** Every
    probe in this harness drives the live editor, because that is where the model can be built. So the
    whole suite measured the EDITOR's rich canonical layout — honestly, and with real numbers — while
    the surface the renderer exists to paint (the /snapshot doc pane) renders flat `pmToText` under
    `pre-wrap` for 115 of 116 versions. Nothing was wrong with any measurement; they were about a
    different document. When a feature's proofs all live on the convenient side of a seam, probe the
    seam itself before building across it. `panecontent.prove.mjs` is that probe.
11. **A gate clause can be wrong without the instrument being wrong.** `panecontent.prove.mjs` first
    gated its control on `distinctFontSizes > 1` and VOIDED — because this app ships Tailwind preflight
    with no typography plugin and no `.ProseMirror h*` rule, so a heading really does compute 18px/400,
    the same as body. The census could see headings perfectly (6/6/18). Read WHY a gate refused before
    assuming it caught something; here it caught the gate.
12. **A metric's silence is not a zero (2026-07-17).** `probePerf` pushes `[label, ms, endTime]` — an
    ARRAY. `landingcost.prove.mjs` first read `e.label`/`e.ms`, which matches nothing, and would have
    reported every timing as an empty list — a blind instrument saying "no cost". Any metric that can
    return nothing must VOID the run explicitly. Related, same probe: the `ops` timing reads ~0ms and
    means "diffCache hit", not "the diff is free" — DocLayer's own UNPROBED useMemo computed it first.
    A probe placed downstream of a cache measures the cache.
13. **Structurally blind fixtures.** A one-line-block fixture makes the buggy branch a no-op. The
    fixture puts NodeViews MID-paragraph in MULTI-line paragraphs, and the math formulas are
    deliberately sub/superscript- and fraction-heavy — a plain `x+1` pill has no off-baseline
    interior and reproduces nothing.
