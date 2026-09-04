# The reader panels — the WHY behind `PdfViewer.tsx` and `SourceBrowser.tsx`

The rules these files enforce live beside their code as short imperative comments ending
`→ docs/archive/reader-panels.md#<anchor>`. This file carries the reasoning: the incident, the
measurement, the hypothesis that was refuted.

Two neighbours worth reading first:

* **`docs/archive/pdf-panel-rounds.md`** — the three measurement rounds behind the PDF panel's zoom
  snap-back, its fit-to-panel and the reader view. Where a rule below has a round, that is where it
  is written up; this file does not duplicate it.
* **CLAUDE.md**, "THE READING SURFACES HAVE THEIR OWN NIGHT" — the theming ruling both panels obey.

Their shared lesson, stated once: **the fix you can argue for is not the fix.** Reproduce the
symptom against a control in the SAME build. Nearly every entry below began as a plausible mechanism
that measurement later refuted.

---

# <a id="pdfviewer"></a>`components/PdfViewer.tsx`

## <a id="pv-toolbar-theme"></a>The bar is chrome; the page is not

> THE BOTTOM TOOLBAR IS A READER BAR, NOT THE PAGE (2026-08-30).
> This file's chrome did not theme AT ALL, in either direction: at night the toolbar stayed #faf8fc
> with #fff control faces and a #5c2d8a glyph on each — a strip of daylight welded under a dark app,
> directly below a reader header that HAD been migrated. One panel, two themes.
>
> It joins the reader family rather than growing a palette, and the reason is that its day values
> already ARE that family's: bar #faf8fc, face #fff, outline #d6cfe0, glyph #5c2d8a, byte for byte.
> PdfReaderView's header is the same bar in the same panel — the ¶ toggle only swaps what is
> between them. So the day rendering is unchanged BY CONSTRUCTION, not by measurement.
>
> ⚠ THE PAGE IS NOT THE BAR, and the split is the whole care of this change. Anything drawn ON a
> page — a note's sheet and its ink, the eraser ✕, the delete badge, the page canvas — keeps its
> literal: pdf.js renders a picture of a white page in both themes, and a mark's colour is STORED
> IN THE DOCUMENT and shared with the source reader. Re-toning either would make one highlight two
> colours on two devices, which is the fill/stroke rule CLAUDE.md's reader section states. The
> popovers anchored at a click on the page are page surfaces for the same reason and stay light.

## <a id="pv-reveal"></a>The atomic contents reveal, and the barrier that raced

> ATOMIC CONTENTS REVEAL (Peter, 2026-07-09): the panel window pops instantly (PdfSidePanel) as
> pure WHITE + the ✕ close button — nothing else. The WHOLE viewer (toolbar, context strip, find
> bar, zoom + dock controls, pages) stays at opacity 0 (still laid out + rendering underneath —
> same trick as the editor's settle gate) behind a white cover, and flips in ONE toggle when the
> initial viewport is actually ready: placeholders built + the visible pages' canvas AND text-layer
> spans attached (renderVisibleNow → renderOnePage's text-ready contract) + highlight overlays
> re-drawn + the initial scroll applied. Capped at 1.5s like the editor's reveal gate, so a
> slow/huge PDF can never hold the panel hostage.

> Latch mirror + the ONE reveal decision point. The old one-shot barrier raced the newer render
> paths (fit-to-text / live-fit re-renders supersede the load token, and a superseded
> renderVisibleNow resolves EARLY) — the toolbar then revealed before the text layer (Peter's
> regression). maybeReveal() is instead called after EVERY completed page render (and by the
> load barrier): it flips only when every page actually intersecting the viewport has its
> canvas AND text-layer spans attached (pg.rendered — the text-ready contract). Whatever render
> path completes last is the one that opens the gate, so no path can slip past it.

Pattern **R7** — a one-shot barrier decides once while the render paths keep moving.

## <a id="pv-note-touch"></a>A note owns its drag, and its delete badge sits at the origin

> ⚠ `touch-action:none` — WITHOUT IT DRAG-TO-MOVE DOES NOT EXIST ON TOUCH. The app-wide
> phone rule is `* { touch-action: pan-x pan-y }` and touch-action does NOT inherit, so a
> finger pressed on a note is a candidate PAN: the browser takes the gesture, scrolls the
> PDF and sends `pointercancel`, and `setPointerCapture` cannot override that (capture
> routes events, it does not claim the gesture). The note simply never moves, silently.
> Same rule CLAUDE.md records for the SCAS reel: an element that owns a drag declares it.
> COST, stated: you can no longer start a page scroll with your finger on a note. Notes
> are small boxes; if a tall one ever makes a page hard to scroll, the narrower fix is to
> set this only while the note is SELECTED (tap, then drag) — at the price of dragging
> meaning something different on touch than it does with a mouse.

> TOP-LEFT (Peter, 2026-08-28: "the x needs to be at top left not top right"). A note grows
> rightward and downward from its origin, so the right edge MOVES as the box is resized or
> its text wraps — the handle wandered. The origin does not.
> 16px is a mouse target. On touch the badge grows to 28 and stays CENTRED on the note's
> corner, so it gains its size outward rather than reaching further into the note — a
> delete that is easy to hit by accident is worse than one that is hard to hit on purpose.
> (It cannot use the `.iw-tap` hit region for that reason: a 44px zone here would cover
> the note's top-left corner, and a tap meant to EDIT would delete.)

## <a id="pv-render"></a>Rendering: the text-ready contract, supersampling, the base tier, eviction

> Paint one page's canvas + text layer on demand (called by the IntersectionObserver). Placeholder
> sizes are already correct, so this never reflows — which is also what stops the open-scroll snap.
>
> TEXT-READY CONTRACT (Peter, 2026-07-09 "the text takes a moment longer"): the returned promise
> resolves only when the canvas AND the text-layer spans are actually attached to the DOM (the
> TextLayer render task below is awaited before `rendered` flips). Crucially, a caller that asks
> for a page whose render is already IN FLIGHT — the IntersectionObserver usually starts the
> visible pages before renderVisibleNow asks for them — gets THAT render's promise, not an instant
> resolve. The old `if (rendering) return` early-out is exactly what let the atomic reveal fire
> with the canvas painted but the text layer still streaming in.

> Supersample: render the canvas at ≥2× the CSS size and let the browser downscale, so PDF text
> stays crisp even on 1× displays (or setups that under-report devicePixelRatio). But the viewport
> already grows with zoom, so cap the canvas at 4096px/side to bound memory — supersampling then
> only adds resolution where the page is still small (the default fit view, where the blur shows).
> Supersample to ≥2× (capped 3×): exactly-dpr looked soft on low-dpr displays, and 3–4× shimmered
> on non-integer downscales. 2–3× is the sweet spot — crisp without the aliasing. Capped for memory.
> Touch (iOS) caps at 2×: iPhones report dpr 3, and 3× canvases are 2.25× the bytes for no visible
> gain on those screens — iOS's TOTAL canvas memory budget is the scarce resource (see eviction).
> ⚠ THE CODE CONTRADICTED ITS OWN COMMENT (2026-08-28, Peter: "is there a way for us to simply
> fix the PWA to 100% — the PDFs seem to be blurry otherwise"). It said "render at ≥2× … so PDF
> text stays crisp even on 1× displays", and then took `min(…, devicePixelRatio)`, which CAPS
> the canvas AT the display scale — so a 1× display supersampled by exactly 1×, i.e. not at all.
> And a browser at less than 100% zoom REPORTS A LOWER DPR (Chrome folds zoom into it): at 67%
> on a Retina Mac, dpr ≈ 1.33, so the page rendered at 1.33× and was downscaled into a soft
> mush. That is the blur, and it is why it appeared at "not 100%".
> No page can set the browser's zoom, so the fix is not to demand 100% — it is to stop caring:
> the floor is now 2× whatever the display says, keeping every existing ceiling (3× desktop /
> 2× touch for iOS's canvas-memory budget, and 4096px per side).

> BASE TIER (never blank).
> Fast scroll used to outrun the on-demand sharp renderer and land on white placeholders. So after
> the initially visible pages have painted, a background sweep renders EVERY page once at a cheap
> low resolution into a CSS-stretched canvas UNDER the sharp one. A fast flick then always lands on
> a soft-but-readable page (the sharp render covers it moments later), and the touch-only eviction
> can drop far sharp canvases and fall back to base instead of blank. Sequential, yielding between
> pages, and stalled whenever a sharp render is in flight — it never competes with the visible view.

> Evict far-away rendered pages (TOUCH ONLY). iOS caps the tab's TOTAL canvas memory; a long PDF of
> permanent supersampled canvases blows the budget and Safari blanks pages / jetsams the tab. Keep
> ~6 pages either side of the viewport; beyond that, free the SHARP canvas bitmap NOW (width=0
> releases iOS's canvas accounting immediately — GC alone is too late), clear the text layer, and
> mark the page unrendered so the IntersectionObserver repaints it when it scrolls back near.
> The BASE canvas is deliberately left alive — evicted pages fall back to the soft base render, not
> white. Placeholder sizes are untouched, so eviction never reflows. hlLayer (annotations) is left alone.

## <a id="pv-zoom-anchor"></a>The zoom anchor, and the gutter that moved mid-gesture

Round 1 of `pdf-panel-rounds.md` owns this; the two comments that carried it are:

> ⚠ ANCHOR ON THE PAGE, NOT ON A PROPORTION (2026-08-30 — MEASURED, see
> scripts/pdfzoom-probe/zoomanchor.prove.mjs). The old rule was
>     scrollLeft = (scrollLeft + ax) * ratio - ax
> i.e. "every horizontal offset scales with the zoom". It does not. The scroller's own 12px
> padding, the pages' 12px inter-page margins and — decisively — the 180px overscroll GUTTER
> are CONSTANTS in the layout, and multiplying them by `ratio` is what moved the words.
> MEASURED at 1.77× on a 1400px pane: the content under the cursor settled 170.2px away from
> it, and `192 - 12 * ratio` predicts that to the pixel (192 = 12px scroller pad + 180px
> gutter). It is INDEPENDENT of where the cursor is, which is why it reads as "flashes back
> centrally" rather than as a cursor-tracking error.
> So: record where the cursor sits INSIDE ITS OWN PAGE as a fraction of that page's box, and
> after the re-render put that same fraction back under the cursor as a scroll DELTA. A
> fraction of a real element is immune to every constant in the layout — no padding, margin,
> gutter or scroll-origin convention enters the arithmetic, so none of them can be
> mis-scaled. Applying it as a delta also means an intermediate clamp self-corrects on the
> next application rather than being baked in.

> ⚠ THE GUTTER FOLLOWS THE *RENDERED* ZOOM, NOT THE LIVE ONE (2026-08-30, and it was half of the
> snap-back — see scripts/pdfzoom-probe/zoomanchor.prove.mjs). Keyed to `zoom`, this 180px
> paddingLeft appeared the instant the writer's first notch crossed 1.02, i.e. IN THE MIDDLE of
> the CSS-transform preview, whose entire premise is "scale the CURRENT render — no reflow". The
> pages jumped 180px right under a transform anchored to where they used to be, so the content
> under the cursor slid away by exactly 180 × the live scale (MEASURED: 198.0 at 1.1×, 289.9 at
> 1.61×, 318.9 at 1.77× — 180×ratio to the pixel). The gutter belongs to the laid-out render, so
> it changes when the render does; `legacy` restores the old keying as the probe's control.

## <a id="pv-axis-lock"></a>One axis at a time

> ONE AXIS AT A TIME (Peter, 2026-08-28).
> "restrict the scroll in pdf mode so that you can only go down and up or left to right at a
> time. So the downwards scroll isn't subject to arbitrary drift left and right." A trackpad
> reports both axes on every event and no hand is perfectly vertical, so reading down a zoomed
> page slides it sideways until the column is off-centre. The axis is chosen ONCE per gesture
> (components/axisLock.ts) — per event, a wobble flips it, which is the drift wearing a hat.
> Ctrl/⌘ is left alone above: that gesture is the zoom, and it owns both axes.

## <a id="pv-live-fit"></a>Live fit on resize, and the fullscreen refit

> LIVE FIT ON PANEL RESIZE (Peter, 2026-07-10).
> While the panel is drag-resized (or the window changes width) the fit-to-text baseline tracks
> the live width so the text margins stay snapped to the panel edges through the whole drag. Per
> resize frame: recompute the fit from the stored inputs and CSS-scale the current render (cheap
> — no page repaint); on settle, ONE sharp re-render at the new fit (the same instant-transform +
> settle pattern as the wheel zoom).
>
> ⚠ A MANUAL ZOOM NO LONGER SKIPS THIS — 2026-08-30, and it is the whole of Peter's "PDFs no
> longer change size". The rule was "manual zoom wins: no tracking until they're back at 100%",
> which sounds right and is not, because `zoom` is PERSISTED and the gesture can never land back
> on exactly 1: one ctrl+wheel froze the page size for every PDF, for ever, and the only way out
> was a ⤢ button labelled "fit the text to the window". MEASURED at 1440px, a persisted 0.6:
> dragging the dock 250px wider left the page at 503px — byte-identical — while the dead strip
> beside it grew 108px → 233px. `zoom` is a MULTIPLIER on the fit, so re-basing the fit and
> re-rendering at fit×zoom respects their magnification exactly AND follows the window. Only
> ROTATION still skips (it swaps the page dims out from under the stored inputs).

> FULLSCREEN ENTER/EXIT REFIT (Peter, 2026-07-10: "exit leaves the text ridden off to the
> right") — the dock↔fullscreen jump is the one width change the live-fit RO could leave
> half-done: with a persisted manual zoom (zoomStateRef ≠ 1) the RO deliberately skips, so the
> old fullscreen scrollLeft survived into the much narrower dock — text jammed off-screen. Drive
> the transition deterministically: at the fit baseline, recompute fit for the NEW width, sharp
> re-render, and snap the text's left margin flush; under a manual zoom the magnification is
> carried through the re-fit (2026-08-30 — the same change as the resize observer above: `zoom`
> multiplies the fit, so re-basing the fit keeps the reader's zoom AND follows the width) and the
> pan is SCALED rather than snapped, because a reader who zoomed in chose where they were looking.
> ⚠ THE FIT IS `computeTextFit` NOW, not a fourth hand-rolled copy of it — the old inline copy had
> already drifted: it never subtracted the comment margin, so entering fullscreen with the margin
> open re-fitted the page as though the margin were not there.

## <a id="pv-export"></a>Export / print the marked-up PDF

> EXPORT / PRINT THE MARKED-UP PDF (Peter, 2026-08-28).
> "we need a three dots button with an export and print button that export/print the marked up
> pdf as a pdf … or to printer."
>
> ONE mechanism, two exits: pdfAnnotatedPages re-renders every page from the pdf.js document and
> burns the marks into the canvas; Print and Export then hand the SAME pixels to the browser or
> to a file. See that module's header for why the on-screen canvases could not be reused (most of
> them are a 0.2–0.45× base render, or evicted, or sized for the reader's zoom).
>
> ⚠ IT EXPORTS THE PAGE VIEW, AND ONLY THE PAGE VIEW. There are two views of a PDF now, and
> "the marked-up PDF" means something different in each: this one is the publisher's pages with
> rectangles on them, and the reader view (PdfReaderView) is the text RE-SET in the reader's own
> font — a different document, whose export would be a different feature. Peter asked to
> "export/print the marked up pdf as a pdf", so the pages are what comes out, whichever view
> happens to be on screen when the menu is used.
>   That is not the same as dropping reader-made marks. A mark made in the reader view also
> stores page rects (PdfReaderView → pdfReflow.rectsForRange, "so the two views agree by
> construction"), so it prints here like any other. What cannot be painted is a mark whose rects
> came back EMPTY — `marksWithoutGeometry` finds those, and the menu SAYS how many rather than
> handing over a document quietly missing them.
>
> Every other failure mode is shown in the same place: a source too large to render at readable
> resolution is REFUSED with the reason, a long one asks first, and a cancel throws the partial
> render away instead of exporting the pages that happened to finish.

## <a id="pv-ios-selection"></a>iOS selection has no mouseup

> iOS text selection (long-press + drag handles) never fires mouseup on the container, so the
> pending-annotation toolbar would never appear on touch. Mirror onMouseUp off document.selectionchange
> instead, debounced 300ms so it settles after the handles stop moving. Touch-only: on desktop the
> mouse path already covers it, and a >300ms pause MID-drag would misfire an armed tool.
> Loop guards: a programmatic removeAllRanges refires selectionchange, so (a) skip one event after our
> own clear and (b) never act on a collapsed/outside selection — in particular we never CLEAR pending
> here, because tapping a pending-toolbar button collapses the selection an instant before its click.

## <a id="pv-translation"></a>The text anchor is an addition, never a precondition

> TRANSLATION, PAGE VIEW → READER VIEW.
> A mark made on the printed page gets a TEXT anchor as well as its rects, so the reader view can
> place it. Deliberately AFTER the mark exists and is persisted: the anchor is an addition, never
> a precondition — a page whose text cannot be read (a scan) must still get its highlight, and it
> then simply shows in the reader view's "not placed here" list rather than being refused.
> Returns nothing and swallows nothing silently: a page with no text answers null and the mark
> keeps no anchor, which is the honest state.

## <a id="pv-swatch"></a>A tool button wears the colour it will produce

> THE BUTTON WEARS ITS OWN COLOUR (Peter, 2026-08-28: "the colour of these buttons
> needs to reflect the colour chosen"). Now that each palette lives under its tool,
> the tool is the only place the choice is visible — a fixed yellow ▮ over a pink
> highlighter is a control lying about what it will do. Read from the ref, which is
> fresh on every render because setColor re-renders.
> ⚠ A NOTE IS A COLOURED PIECE OF PAPER, SO THE BUTTON IS TOO (Peter, 2026-08-28:
> "with the text colour, it should be the background not the T that gets coloured",
> "the background should be yellow by default"). The highlighter's colour lives in
> its ▮ mark, which IS the ink; a sticky note's colour is the SHEET, and a coloured
> letter T on white said the wrong thing about what the tool would produce.
> The `text` tool's SHEET colour wins over the armed tint: which colour the note
> will be is the more useful fact, and the ring already shows it is armed.

> ⚠ THE SWATCH MUST STILL BE VISIBLE. Peter's rule above is that the button
> wears the armed colour — but the default is #ffe066 on a white face, which
> MEASURED 1.3:1 (a control needs 3:1), i.e. the one thing the ▮ exists to
> say was the thing you could not see. An outline carries the contrast while
> the fill keeps carrying the colour: the mark still reads as that colour,
> and it reads at all. Not applied to the `text` tool — it colours its whole
> SHEET and puts a dark glyph on top, which already has its own contrast.

## <a id="pv-fontselect"></a>The note-size `<select>` is 34px because it has no pseudo-element

> Narrower (Peter, 2026-08-28: "make the font size button smaller"). The iOS 16px floor
> is untouched on touch — shrinking a control below it makes the page auto-zoom on focus
> and STAY zoomed, which is a far worse bug than a wide select.
> No "px", no dropdown arrow, no reserved arrow gutter (Peter, 2026-08-28) — the row has
> to fit on ONE line and a two-digit number needs none of that to be read as a size.
> A `<select>` gets no pseudo-element in Chrome/Safari, so it cannot borrow the `.iw-tap`
> hit region — its box has to be the target. 34px is also what the forced 16px iOS floor
> (index.css) needs to hold its own line without clipping.
