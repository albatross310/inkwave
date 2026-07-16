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
```

## Files

- `probe.mjs` — the perf matrix: {2k,10k,40k words} × {build cold/warm, paint text/rects, map strip}
  + BASELINE A (real SVG-foreignObject bake) + BASELINE B (real WebP encode→decode→blit) + memory.
- `breaks.prove.mjs` — **the load-bearing one.** Compares the arithmetic model's break positions
  against the LIVE editor's own gap widgets. This is what caught the orphan-snap drift.
- `fidelity.mjs` — screenshot diff vs the real ProseMirror, with an offset sweep + ink denominator.
- `mapcompare.mjs` — the minimap question, shown: real editor pixels downscaled vs text vs line-rect.

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
