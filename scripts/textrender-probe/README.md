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
- `opfs.prove.mjs` — **the break-table store's FIRST EXECUTION.** `loadTables`/`putTable`/`getTable`/
  `persist`/`tableStats` had zero callers and had never run once. Builds 116 tables → persists through
  `storage/opfsWrite.ts` → **reloads the page** → hydrates from real OPFS → asserts a hit with
  byte-identical starts. Gates: a non-trivial table (an empty one round-trips perfectly and proves
  nothing), a cold lookup that MISSES before `loadTables` (or memory survived and the reload proved
  nothing), the signature REPRODUCING across the reload, and a mutated signature REFUSED + counted —
  then the correct sig hitting again, which is what proves the negative discriminates rather than just
  breaking the cache. ONE browser context throughout: OPFS is per-origin, so a fresh context would be
  a fresh disk. Chromium only — Playwright's Linux WebKit has no `navigator.storage`, so the iOS
  worker `createSyncAccessHandle` branch is unproven here.
  `PROBE_PORT=… node scripts/textrender-probe/opfs.prove.mjs`
- `versioncost.prove.mjs` / `versioncost.attrib.mjs` — what a build ACTUALLY costs per version, and
  why two readings of the same operation disagreed. Confirms the ~9.1s/116 baseline is real, shows the
  word-width cache is already built and already banked (67% off a cold build), and pins the 2.4×
  discrepancy on **JIT tier-up** (291.7 → settled 81.8ms in-page). Timing a handful of builds over
  separate CDP round-trips measures the tier-up, not the build.
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
13. **GREP IS BLIND TO `textRender.ts` — IT CONTAINS A NUL BYTE (2026-07-17).** Line 620 is
    `const k = font + '\0' + text` (a deliberate cache-key separator). One NUL makes `file` call the
    file "data", and **grep then treats it as BINARY: it matches nothing and exits 1**. Searching it
    returns silence that reads as "the symbol doesn't exist" rather than "grep refused to look" —
    committed since 21febe3, so every agent in this file has been misled by it. Use `grep -a`. The
    house disease, in the tooling: an instrument that cannot report its own failure.
14. **A SIGNATURE MADE OF SESSION STATE CANNOT SURVIVE THE RELOAD IT EXISTS TO SURVIVE
    (2026-07-17).** `contextSig` embedded `bibProvider.getVersion()` — a monotonic counter of
    bibliography notifications THIS SESSION (15 before reload, 2 after, same document). Every
    hydrated break table stale-missed, always: the OPFS layer could never score a hit, and would have
    shipped reporting "116 tables persisted" while serving zero lookups. It was invisible because the
    layer had ZERO CALLERS — untouched code that has never run is a plan, not a feature. `opfs.prove
    .mjs` caught it on the layer's FIRST EXECUTION, only because it asserts the sig REPRODUCES across
    the reload rather than assuming it. Rule: no component of a persisted signature may be counted
    since page load; hash the STATE, not the number of times it changed.
15. **Structurally blind fixtures.** A one-line-block fixture makes the buggy branch a no-op. The
    fixture puts NodeViews MID-paragraph in MULTI-line paragraphs, and the math formulas are
    deliberately sub/superscript- and fraction-heavy — a plain `x+1` pill has no off-baseline
    interior and reproduces nothing.
16. **A COUNT THAT AGREES CAN HIDE A SAMPLE POINT THAT DOES NOT (2026-07-17 — the list break bug).**
    `range.selectNodeContents(el).getClientRects()` returns the border box of every ELEMENT it
    contains, not only text lines. For a `<ul>` each `<li>` contributed ONE rect spanning the whole
    item, `keepLineRects` admitted it (58.2px, under the 80px tall-box cut), and it sat exactly
    **3.000px** above its own first text rect — so the `top - lastTop <= 3` dedup DELETED the item's
    first real line and the container's box stood in for it. Six rects for six lines: every
    count-based check passed. But collectLines samples `r.top + r.height/2`, and half of a 58px item
    box is **line 2** — so the break attributed to the item's first line resolved, via posAtCoords,
    to the second line's doc position. The page then carried 26.5px more than its own text area.
    Three instruments were blind to it, each for its own reason, and that is the lesson:
    · the MID-LINE audit read 0 — 25383 IS a line start, just the wrong one;
    · `blockGeoCheck` and every height/line-count check agreed — the totals TELESCOPE;
    · `topdiag.mjs` (model tops vs the DOM's own text rects) read **1483/1483, 0px drift** — the
      model's geometry was exact all along; the editor's line LIST was not the DOM's text rects.
    What found it: `rectdiag.mjs`, which stopped comparing derived numbers and printed the RAW rects
    the editor's own collector receives. When a bug survives every check built from the line list,
    print what goes INTO the line list.
17. **THE DIAGNOSTICS THIS ROUND LEFT BEHIND** (not gates — attribution tools; the gates are
    `textRender.lists.test.ts`, `collectLines.container.test.ts` and `textRender.test.ts`):
    · `topdiag.mjs`   — model line tops vs the DOM's own text rects, whole document. Answers "is this
      a GEOMETRY bug at all?" before anyone theorises. It said no, and it was right.
    · `breakwhere.mjs`— localises the first divergent break to a block, and names which model LINE
      each side's position points at. That is what separated "broke at a different line" from "broke
      at the same line and called it something else".
    · `listdiag.mjs`  — a list's model box + trailing advance vs the live `<ul>`'s own rect and its
      real gap to the next sibling. The evidence for the margin-collapse fix.
    · `rectdiag.mjs`  — the raw rects the editor's collector sees for a list, and keepLineRects
      applied verbatim. The evidence for the container-box fix.
    · `strutrule.mjs` — per-family DOM line gap inside the real `.ProseMirror` vs the model's strut,
      scored against the candidate eligibility rule, counting UNSAFE (rule says fine, DOM grows)
      separately from over-defer. The evidence for the mixed-family defer.
