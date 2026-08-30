# The PDF panel — measurement rounds (2026-08-28 → 2026-08-30)

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "PDF viewer + annotations"; that entry
points here.

Three rounds, and what they share is worth more than any one of them: **in all three a plausible
mechanism was shipped and written up before it was measured, and the measurement refuted it.** The
zoom snap-back "fix" of 2026-08-28 was a no-op indistinguishable from its own control. The fit
regression was blamed on the 180px gutter, which was measured inert at rest before a line changed.
The reader-view probe accused four working features before it found a real bug.

So: **the fix you can argue for is not the fix. Reproduce the symptom against a control in the SAME
build, or you are writing fiction with a passing test attached.** The seams named here
(`__iwPdfZoomAnchor`, `__iwPdfFitRule`) exist FOR that control — if the probe goes, the seam goes.

---

- **THE PDF READER VIEW IS NOW DRIVEN IN A REAL BROWSER — `pnpm prove:pdfreader` (2026-08-30).**
  `pdfReflow.ts` + `pdfReflowStore.ts` + `PdfReaderView.tsx` (the ¶ toggle: the PDF's text re-set in
  the reader's own font and line spacing, marks anchored BY TEXT via `src/reader/marks.ts`) shipped
  to master on unit tests and the gate alone — and the gate can see none of what it promises. LIVE,
  no flag; Peter reads his sources here daily. `scripts/textrender-probe/pdfreader.prove.mjs` seeds a
  deterministic 3-page PDF (`pdffixture.mjs`, generated in-repo from text you can read — his own
  sources never enter this repo) as a real source through the real OPFS paths, opens it by clicking
  an in-text citation, and MEASURES: all 8 reflowed paragraphs byte-equal to the fixture's own text;
  Garamond→JetBrains changes the paragraph's laid-out height 129.19→193.78px at a FIXED column width
  (the height IS the proof the font swapped — `document.fonts.check()` lies); lead 1.7→3.0 grows it
  ×1.765 against a line-height ×1.765; a highlight over a unique phrase persists with a TEXT anchor
  (+ rects, so the page view draws it too) and survives a font change, a line-spacing change and a
  RELOAD, same id, same words; a text note lands 16px under its own paragraph with the paragraph's
  opening 60 chars as its anchor; and the two seeded rect-only legacy marks are drawn at
  byte-identical normalised rectangles before, after and across the reload. 47/47.
  **FOUR PROBE BUGS, EVERY ONE OF WHICH ACCUSED A WORKING FEATURE** — read these before writing any
  probe against this panel: (1) `fetch('data:…')` is refused by the app's own CSP and reads as "OPFS
  is broken" — use `atob`; (2) `getSelection().toString()` after the mouseup is EMPTY because
  `createFromSelection` clears the selection on SUCCESS — read it before dispatching; (3) **Escape
  does not disarm the tool, it CLOSES THE PANEL** (PdfViewer and PdfSidePanel both listen; the panel
  wins) — toggle the tool button; (4) `page.mouse.click(5,5)` lands on the editor, which is how a
  bottom-docked panel is *designed* to close. Hence the probe's helpers return **null, never an
  empty list**, when the reader is off screen — "no marks painted" and "there is nothing to paint on"
  are different answers, the same distinction `readJson` and `readSnapshotsFromDisk` exist to keep.
  MUTATION-PROVED (drop `anchor` ⇒ 6 fail + 1 VOID · hardcode `lineHeight` ⇒ 1 · shift the page rect
  2% ⇒ 3). HONEST GAPS, stated: Chromium only (WebKit has no `navigator.storage` here, so the iOS
  worker write path is untouched); the fixture is a born-digital text-layer PDF, so a SCANNED page
  with no text layer takes the "use the page view" branch unprobed; and multi-column, RTL and
  footnote-heavy real typesetting are not represented — the fixture proves the reflow RULES against
  the thresholds they were written for, not against a publisher's page.
- **⚠ THE PDF ZOOM SNAP-BACK — THE SHIPPED MECHANISM WAS WRONG, AND THE FIX BUILT ON IT WAS A NO-OP
  (2026-08-30, `pnpm prove:pdfzoom`).** Peter: *"when you zoom the pdf … it goes towards the cursor
  then flashes back centrally after you finish zooming."* LIVE, no flag. The 2026-08-28 fix
  re-asserted the scroll anchor after paint and again next frame, on a **STATED, NOT PROVED** theory
  that `scrollLeft` was being clipped to a stale scroll range. `scripts/pdfzoom-probe/` reproduced
  the symptom and **refuted that theory outright**: legacy and "fixed" trajectories were identical to
  0.1px, and **not one scrollLeft write was ever clamped** — the single write asked for 570.7 into a
  range of 1778. A fix nobody could distinguish from its own control had been shipped and written up.
  - **THE REAL CAUSE IS A LAYOUT CONSTANT MULTIPLIED BY THE ZOOM RATIO.** `overscrollPx`
    (`PDF_OVERSCROLL_PX = 180`, the gutter that lets you scroll past a zoomed page) was keyed to the
    LIVE `zoom`, so it appeared the instant the first notch crossed 1.02 — **in the middle of the
    CSS-transform preview, whose entire premise is "scale the CURRENT render, no reflow"**. The pages
    jumped 180px right under a transform anchored where they used to be. Then the settle's
    `scrollLeft = (scroll + ax) * ratio - ax` scaled that 180px — and the scroller's own 12px padding
    — as though they were content. Closed forms, confirmed TO THE PIXEL across 5 notches:
    in-gesture err = **180 × liveScale** (198.0 / 217.8 / 239.6 / 263.5 / 289.9); settled err =
    **(12 + 180) − 12 × ratio** = 170.7 predicted vs 170.2 measured. Vertical takes the same
    disease from the 12px page margins (−9.5px).
  - **THE ERROR IS INDEPENDENT OF THE CURSOR** — which is exactly why it reads as "flashes back
    *centrally*" rather than as a cursor-tracking bug, and why staring at the anchor arithmetic
    (which is correct) never found it.
  - THE FIX, two halves: the gutter now follows the **RENDERED** zoom (it belongs to the laid-out
    render, so it changes when the render does), and the anchor is a fraction of the **PAGE'S OWN
    BOX** applied as a scroll DELTA — paddings, margins, gutters and scroll-origin conventions all
    cancel because they are already inside `page.left`, so none of them can be mis-scaled. The
    delta is applied again after React commits the gutter (**probed load-bearing**: the write moves
    561 → 741, exactly the 180). MEASURED: settled 170.2 → **0.2px**, in-gesture 318.9 → **0.0px**,
    vertical −9.5 → **−0.5px**.
  - KEPT by `src/components/pdfZoomAnchor.test.ts` — 11ms, no browser: it models the real horizontal
    layout (12px pad + 180px gutter + a scaling page) and proves the page-fraction rule invariant
    while the proportional rule is off by the closed form. Mutation-proved BOTH ways: making the
    delta forget the layout offset kills 2; **and setting the model's gutter to 0 kills the
    known-negative**, so the negative discriminates rather than passing by construction.
  - THE SEAM: `window.__iwPdfZoomAnchor = 'legacy'` restores BOTH halves of the old behaviour so the
    control reproduces the bug in the SAME build. It exists FOR the probe; if the probe goes, it goes.
  - **AND THE PROBE'S OWN CONTROL WAS MIS-FRAMED FIRST.** It demanded that the control TRACK the
    cursor during the gesture — reading "goes towards the cursor" as a report that the preview phase
    was fine. It is not: the preview is where the 180px drift lives. Scoring a control against what
    you assumed instead of what it does is how a probe certifies the wrong half.
- **⚠ THE PDF PAGE STOPPED FILLING THE PANEL, AND STOPPED FOLLOWING THE WINDOW (2026-08-30,
  `pnpm prove:pdfgeom`).** Peter: *"there's also a bug now where PDFs no longer change size, and
  there's a no man's land space of empty background between the page and left side — page is a bit
  narrower than web page viewer."* LIVE, no flag; this is the panel he reads his sources in.
  **THREE SYMPTOMS, ONE STATE, ALL THREE REAL AND ALL THREE MEASURED.** They are not the 180px
  gutter (the prime suspect, and it is inert at rest — `viewerPadL` reads 0 until `renderedZoom`
  passes 1.02, confirmed on the DOM before anything was changed).
  - **THE CAUSE: `zoom === 1` was being read as "the reader has not chosen a zoom", and it cannot
    mean that.** `zoom` is a MULTIPLIER on the fit baseline, it is PERSISTED to
    `inkwave:pdfUserZoom` for every document and every reload, and the ctrl+wheel gesture can never
    land back on exactly 1 (a Mac trackpad pinch fires ctrl+wheel, so it is one careless gesture
    away). Every re-fit path — the resize ResizeObserver, the comment-margin re-fit, the
    fullscreen↔dock transition — opened with `if (zoom !== 1) return`, under the comment "manual
    zoom wins, and rightly: a resize must not undo a zoom the reader chose". That reasoning is right
    about the ZOOM and wrong about the FIT: re-basing the fit and rendering at fit × zoom respects
    the chosen magnification exactly *and* follows the window. The ⤢ button was shipped 2026-08-28
    as the remedy for this ("it RESETS THE ZOOM OVERRIDE… once you had zoomed, the flushness stopped
    following the window") — i.e. the behaviour was known and papered over with a button labelled
    "Fit the text to the window" rather than fixed.
  - **MEASURED, control vs fixed in ONE build, at 570 / 1100 / 1440px** (Peter runs a ~570px
    half-screen window; 570 is a BOTTOM dock and the two side-dock widths need the drag handle,
    because a side dock's px `width` does NOT follow the viewport — resizing the window there widens
    nothing and a naive probe reads "frozen" about a working build):
        1440px, persisted zoom 0.6 · pane 719 → dock dragged 300px wider
          CONTROL  page 503 → 503 (frozen), dead strip 108px → 258px
          FIXED    page 695 → 1003,          dead strip 12px → 12px  (12 = the scroller's own padding)
    And symptom 3, in the SAME dock: PDF page 695px vs the source reader's column 655px — the reader
    is `flex-1` minus its own 64px of padding so it always fills the dock; the frozen PDF did not.
  - **THE FIX IS A FLOOR THAT IS A FUNCTION OF THE PANE, NOT A CONSTANT** (`minUserZoom`,
    exported + unit-tested). `computeTextFit` already refuses to go below whole-page fit
    (`Math.max(pageFit, …)`); the user multiplier was the one path around that floor. Zooming OUT
    still runs the whole useful range — text-flush down to page-flush, ~0.76× — it just stops where
    the page stops filling the width. **It clamps the ZOOM VALUE, not the render**: clamping only
    the render leaves `zoom` below the floor, so the first notches back IN would change nothing on
    screen — "zoom does nothing", the very complaint, reintroduced one layer down.
  - ALSO FIXED ON THE WAY, because the file had a fourth copy of the rule: the fullscreen refit
    hand-rolled `computeTextFit` inline and **never subtracted the comment margin**, so entering
    fullscreen with the margin open re-fitted as though it were not there. It calls the real one now.
  - **STATED, NOT FIXED — THE OVERSCROLL REACH IS ASYMMETRIC AND ALWAYS WAS.** Sweeping the gutter
    0 → 180 → 600px moved the LEFT reach 12 → 192 → 612px and the RIGHT reach **0 → 0 → 0**:
    `.pdfViewer` is a block, so a page wider than its content box overflows it symmetrically under
    `margin: 0 auto`, the left overflow is not scrollable, and the right padding sits underneath the
    right overflow. So Peter's "scroll a bit of a way past the edge for a textbox at the edge of the
    document" works on the LEFT margin only. Identical in both cells, untouched by this lane, and
    reported rather than implied closed.
  - **STATED CEILING:** above a ~1860px container `computeTextFit`'s own `Math.min(3, …)` cap binds
    and a Letter page cannot fill the pane (40px residual at 1900px). Pre-existing; pinned by a test
    so changing that cap is a decision.
  - KEPT by `src/components/pdfFit.test.ts` — 12 tests, **8ms, no browser**, mutation-proved 8/2/1
    (flat `ZOOM_MIN` floor / drop the cap at 1 / floor forgets the comment margin).
    `scripts/pdfzoom-probe/geom.prove.mjs` is the in-browser truth, with
    `window.__iwPdfFitRule = 'legacy'` as its live known-negative — the seam exists FOR that probe
    and goes with it, the rule this file already applies to `__iwPdfZoomAnchor`.
  - Regressions re-run clean: `prove:pdfzoom` (anchor 0.0/0.2px, control still reproduces),
    `prove:pdfreader` 47/47, `prove:pdfexport` 16/16, and the default no-persisted-zoom path is
    untouched (fit-to-text still overflows the pane on purpose: gapLeft −77, and still tracks).

