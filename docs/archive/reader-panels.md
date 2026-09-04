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

---

# <a id="sourcebrowser"></a>`components/SourceBrowser.tsx`

⚠ This file changed eight times on 2026-08-30/31 (search chain, PDF save, section menu, framing
effects, refresh, extension offer). Its newest rules are the CURRENT design, not churn: read the
anchor before proposing an alternative.

## <a id="sb-what"></a>What the reader is, and why the iframe survives as the fallback

> THE IN-APP SOURCE READER — read the page a citation points at, and cite what you select in it.
>
> Peter, 2026-08-28: "let's build a browser inside our app like ChatGPT does", after being shown
> that an iframe can display a page but can never let us see a selection inside it. That is true of
> an iframe and only of an iframe. So the page is FETCHED (api/_reader-core.mjs — read its header
> for the privacy posture, which Peter authorised explicitly) and arrives as STRUCTURED BLOCKS,
> which are rendered as React elements here. Two consequences, both the point:
>   • the text is in OUR document, so `window.getSelection()` works and "highlight the heading and
>     cite it" is finally expressible;
>   • no HTML string exists anywhere in the path, so injection into an origin holding the writer's
>     thesis and signing session is unrepresentable rather than merely filtered.
>
> The iframe survives as the FALLBACK. Some pages defeat extraction (a JS-rendered app has no prose
> in its HTML) and some hosts refuse framing (JSTOR sends X-Frame-Options: DENY — checked). Between
> them the panel always has something to offer, and it SAYS which mode it is in rather than leaving
> the reader to guess why selection does or doesn't work.

## <a id="sb-surfaces"></a>Two surfaces, two palettes

> TWO SURFACES, TWO PALETTES, AND EVERY COLOUR HERE BELONGS TO EXACTLY ONE OF THEM.
> This panel is not one surface. Its HEADER is chrome (the dolphin-grey `.iw-nightable` panel);
> its ARTICLE, its MARKUP BAR and every control face in that bar are reader PAPER, which now has
> its own night (index.css, the reader token block). Getting a control's surface wrong is not a
> near-miss — it produced BOTH of Peter's 2026-08-30 complaints at once, in opposite directions:
> a literal `#5c2d8a` left on the night HEADER measured 1.13:1 (invisible), and chrome tokens
> leaking onto the near-white markup BAR washed its labels out to ~1.2:1.
> So: ask which surface the control sits on FIRST, then take that surface's token.

## <a id="sb-touch"></a>Touch sizing — and why a typed control is the exception

> TOUCH SIZING.
> The ICON buttons keep their painted size on every device and grow only their HIT REGION, via the
> `.iw-tap` rule in index.css — see its header for why (a dense bar cannot grow to 44px per control
> without wrapping to three rows inside a 50dvh phone dock).
> A control you TYPE IN is the exception, and it is not a taste call: the global phone rule floors
> every input/select at 16px (`input, select, textarea { font-size: max(16px, 1em) }` — iOS zooms
> the whole page to anything smaller and STAYS zoomed), so a 22px box is shorter than the line it
> now has to hold. The FONT was floored months ago and the BOXES were never grown with it.
> 40, not 34: a `<select>` cannot borrow the `.iw-tap` hit region (a replaced element renders no
> pseudo-element in Chrome or Safari), so for these controls the painted box IS the target and it
> has to carry the whole size on its own.

## <a id="sb-pagewidth"></a>Page width in live mode is the READER's choice

> PAGE WIDTH IN LIVE MODE (Peter, 2026-08-28: "it's not using the whole space").
> The iframe's width IS the CSS viewport the site lays out for, so "not using the whole space" is
> not something we can fix by stretching anything — it is the site's own responsive layout at
> whatever width we hand it. Britannica at ~900px picks its DESKTOP layout, right rail and all,
> and leaves the rail empty; the same site at ~500px picks its phone layout and fills the width.
> So this is a CHOICE, and it belongs to the reader:
>   auto   — the panel's real width, 1:1 (what it did before)
>   narrow — lay out at 520px and scale UP: the phone layout, big text, no empty rails
>   wide   — lay out at 1400px and scale DOWN: the full desktop layout, smaller text
> Implemented by sizing the iframe to the chosen viewport and transform-scaling it to fit, which
> is the only way to give a cross-origin document a viewport it did not ask for.

## <a id="sb-framable"></a>`onLoad` lies; only the server can tell

> ⚠ ASK THE SERVER; `onLoad` LIES (2026-08-28, Peter: "we need to replace this with a proper
> error message that explains some pages can't be read in their original form"). A refused frame
> FIRES `load` — on Chrome's own "refused to connect" page — so the deadline-cancelled-by-onLoad
> detector written earlier never fired at all, and the grey broken-page icon kept showing. I had
> written that exact trap down in a probe ("onLoad is worthless on its own") and then relied on it
> in the component anyway. Nothing INSIDE the page discriminates either: contentWindow and
> contentDocument throw identically for a real cross-origin document and for the error page.
> The HEADERS do, and only the server can read them (/api/reader?probe=1 → checkFramable).
> The probe runs IN PARALLEL with the frame, so a page that works is never delayed by the question.

## <a id="sb-who-fetches"></a>Who fetches the page, and saying so

> WHO FETCHES THIS PAGE.
> Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" — yes, through
> the extension this repo already ships (reader/pageSource.ts). MEASURED, from the DEPLOYED
> function and not from a laptop: duckduckgo, lite-ddg and mojeek answer "fetch failed", searx.be
> answers "Verifying your browser…", priv.au a captcha, marginalia 5 blocks and zero links, while
> wikipedia and plato.stanford.edu are served normally. Search engines serve people, not data
> centres — so the fetch moves to the writer's own browser when there is one to move it to.
>
> ⚠ THE PANEL MUST SAY WHICH HAPPENED. `via` is rendered, never inferred: a privacy posture the
> writer cannot see is a privacy posture they do not have, and this reader has already shipped
> two controls that looked identical whether or not they did anything.

## <a id="sb-framing-install"></a>The framing rule must be installed BEFORE the frame loads

> LIVE VIEW THROUGH THE EXTENSION.
> Peter, 2026-08-30: "build the extension." X-Frame-Options and CSP frame-ancestors are enforced
> by the BROWSER, so no page can opt out of another site's refusal — but an extension can strip
> them before the browser reads them. Measured headed, with a canary proving the ruleset live and
> a control proving refusals were detectable at all: google / youtube-watch / abc.net.au /
> facebook all go REFUSED → framed (docs/SEARCH-AND-THE-EXTENSION.md).
>
> ⚠ THE RULE MUST BE INSTALLED BEFORE THE FRAME LOADS, which is what `frameKey` is for: it
> remounts the iframe once the rule lands. Without it the frame is refused first and the rule
> arrives at an error page that will not retry itself — the feature would appear to work only on
> the second attempt, which reads as flakiness rather than as ordering.

## <a id="sb-embed-skip"></a>An embed needs no rule — and the skip is only safe now

> ⚠ AN EMBED NEEDS NO RULE, AND ASKING FOR ONE KILLED A PLAYING VIDEO. Peter, watching a cat
> video: "youtube was working a minute ago." youtube-nocookie /embed/ sends no framing headers,
> so the rule buys nothing there — but installing it bumps `frameKey`, which REMOUNTS the
> iframe, which restarts the player under him.
>
> This skip existed before and I removed it, correctly at the time: back then the early return
> sat above a cleanup that RELEASED the tab's rule, so skipping also tore down framing for
> every other page. Now that teardown lives in its own effect below, the skip is inert rather
> than destructive — it declines to install and removes nothing. Both facts had to be true
> before this line was safe, which is why it is worth the paragraph.

## <a id="sb-no-release"></a>Install and teardown are TWO effects with different lifetimes

> ⚠ NO RELEASE HERE, AND THAT IS THE FIX FOR "a lot of things are never loading now".
> This effect re-runs on every navigation, so releasing in its cleanup meant each new page
> fired BOTH a release and an install — two independent async chains to the worker
> (`releaseFraming` is fire-and-forget by design, `allowFramingVia` awaits a reply) with no
> ordering guarantee between them. When the release landed second it removed the rule that had
> just been installed, and the page never loaded. Intermittent, and worse the more the writer
> clicked, which is exactly how it was reported.
> Nothing needs releasing between pages anyway: the rule is per-tab and each install REPLACES
> it. Teardown belongs to leaving live view, which is the effect below.

Pattern **R7**, in its purest form: React runs cleanup on every dependency change, so an effect
whose cleanup has a different lifetime from its body must be two effects.

## <a id="sb-canframe"></a>`canFrame` must agree with the install effect

> Keep the ref in step. `ready` means the extension answered AND holds the <all_urls> grant, so
> it is exactly the condition under which a framing rule can be installed.
> ⚠ THIS MUST AGREE WITH THE INSTALL EFFECT OR SEARCH BREAKS. `canFrame` decides that a typed
> query becomes the REAL duckduckgo.com opened in the live frame rather than the no-JS endpoint
> read in the panel — so if it says yes while framing is disabled, every search routes to a page
> we then refuse to show. Peter hit exactly that within a minute of the flag landing: "not
> working", on a search, with the refusal card. `liveFrameEnabled()` is not optional here.

## <a id="sb-reader-only"></a>Reader-only is an invariant, not a navigation-time decision

> ⚠ READER-ONLY IS AN INVARIANT, NOT A DECISION TAKEN AT NAVIGATION TIME. `go()` applies
> `mustUseReader` when the writer navigates — but the live/reader toggle is PERSISTED
> (`inkwave:readerLive`), so a reload restores live view without going through `go()` at all.
> Land on a reader-only address in that state and the panel shows the framing-refusal card for a
> page it was never going to frame, with no way out but the toggle. Peter hit it twice in a row
> on a search: "grr".
>
> It also has to be a live rule rather than a one-shot, because `canFrame` CHANGES underneath the
> panel — the extension can be granted mid-session, and `liveFrameEnabled()` can be flipped — and
> each change moves the answer for the page already on screen.

## <a id="sb-search-chain"></a>Search is a CHAIN, it falls back to the reader, and it judges THIS address

> ⚠ A REFUSED SEARCH FALLS BACK TO THE READER INSTEAD OF SHOWING A CARD.
> Peter, repeatedly: "its broken again… its not doing basic things." Every time, the same chain —
> framing is ON, so a typed query routes to the real duckduckgo.com in the live frame; the
> extension's rule does not apply (most often because the worker is a build behind: reloading the
> EXTENSION is a separate act from reloading the tab, and I changed that worker six times today);
> Chrome refuses the frame; and the panel shows a refusal card on the one page he starts from. So
> the whole panel reads as dead when a single request failed.
>
> Searching is the load-bearing case, so it must not depend on an extension being current. If a
> search is refused, drop to the endpoint a plain fetch CAN read and show results. The live
> attempt is an upgrade; the reader is the floor, and a floor you fall through is not one.
>
> Scoped to searches deliberately: for an ordinary page the refusal card is correct and offers
> real choices (read it here / open in a tab). It is only a search — where we chose the live URL
> on the writer's behalf — that must repair itself rather than blame the site.

> ⚠ A SEARCH THAT COMES BACK EMPTY TRIES THE NEXT ENGINE.
> MEASURED: called four times in a row through the deployed function with one query,
> old-search.marginalia.nu answered 170 / 170 / 3 / 3 blocks. It works, and then intermittently
> does not — and an engine that returns a challenge page answers 200, so nothing upstream can
> tell that from a genuine "no results". Peter reported "not searching anything" five separate
> times; a chain is the difference between a search box and a coin toss.
>
> It advances only ONCE per address (the URL itself moves to the next engine), so there is no
> loop: when the chain is spent the reader shows the ordinary empty-search state.

> ⚠ AND IT MUST JUDGE *THIS* ADDRESS'S PAGE, NOT THE ONE BEFORE IT (2026-08-31, found by
> `pnpm prove:readerflow`). On the commit where `here` changes, this effect's `doc` is still the
> PREVIOUS page's — `setDoc(null)` was queued by the load effect above but closures capture the
> render's values, so the fallback read the article the writer had just been looking at. An
> article has fewer than five linked blocks by definition, so `searchLooksEmpty` was TRUE for
> every search issued from an ordinary page, and the chain advanced before the first engine had
> answered. MEASURED: the first engine was fetched and its results thrown away; the writer landed
> on the LAST engine in the chain every time, so a chain built to survive one engine going quiet
> had already spent itself on arrival — Peter's "not searching anything" if the last one blinks.
> It also truncated forward history, because `go` slices the stack at the current index.
> A REF, not another state: the load effect runs BEFORE this one in the same commit, so clearing
> it there is what makes the stale read unrepresentable rather than merely unlikely.

## <a id="sb-diagnostic"></a>A readable diagnostic, because "still broken" is not a stage

> Live view through the extension has FIVE places it can fail and they are indistinguishable
> from the panel: no content script in this tab (the commonest — Chrome injects them on page
> load, so a tab open before the install has no bridge), the extension present but not granted
> <all_urls>, the worker missing declarativeNetRequest, the rule refused, or the site refusing in
> its body afterwards. Each needs a different fix and they all look like one refusal message.
> window.__iwReader reports the stage instead of making the writer describe a screenshot.

## <a id="sb-extension-offer"></a>"Get the extension", at the wall

> "GET THE EXTENSION", AT THE WALL (Peter, 2026-08-30: "can we build a little 'download the
> extension' prompt for whenever the user hits a link or tries to search etc. to something not
> supported without the extension").
> There are exactly THREE walls it removes, and the panel already knows which one it is standing
> at: a site that refuses framing, a search our server is not served, and an article our server
> cannot fetch. So the offer goes INSIDE each of those three cards rather than floating as a
> banner — an offer that appears where the disappointment is, and nowhere else.
>
> ⚠ THREE RULES, AND EACH ONE IS THE DIFFERENCE BETWEEN AN OFFER AND A NAG:
>  1. ONLY WHEN IT IS GENUINELY ABSENT. `extState` is 'absent' | 'blocked' | 'ready', and
>     'blocked' means INSTALLED BUT NOT GRANTED — which already has its own correct affordance
>     (askForFetchPermission + the printed instruction). Offering a download to someone who has
>     it installed is telling them to install what they have.
>  2. DISMISSIBLE AND REMEMBERED — the anti-nag clause the unsynced-work notice established:
>     never again once waved away. Keyed per ORIGIN, not per document: whether you have a browser
>     extension is a fact about your browser, not about the essay you are writing.
>  3. NO DEAD "DOWNLOAD" BUTTON. It is in no store: it is built from the repo and loaded
>     unpacked. A button labelled Download that opens instructions is the dead control this panel
>     has already shipped twice, so the button says what it does — it shows the instructions.

## <a id="sb-dock"></a>One dock, one occupant

> ⚠ ONE DOCK, ONE OCCUPANT (2026-08-28, Peter: "clicking a pdf when browser is open doesn't
> replace it. They should seamlessly replace each other with the same page sizing etc"). Both
> panels write the SAME four room variables (components/dockLayout.ts) — that is what makes their
> placement identical — which also means two open at once fight over one strip and the second one
> to write wins. So the reader stands down the moment a PDF is opened. It does NOT clear the room
> on the way out: the PDF panel is about to claim the same geometry, and blanking it first is a
> frame of the editor snapping wide and back, which is the opposite of seamless.

## <a id="sb-scroll"></a>A scroll to 0 because the article vanished is not a reading position

> ⚠ A SCROLL TO 0 BECAUSE THE ARTICLE VANISHED IS NOT THE READER GOING TO THE TOP — and until
> 2026-08-30 the two were the same write. MEASURED by `prove:reader`'s new refresh cell: the
> refresh button sets `doc` to null, the article is replaced by "reading…", the pane loses its
> height, the BROWSER clamps scrollTop to 0 and fires a real scroll event — which landed here
> and overwrote the remembered offset with 0 before anything could restore it. So refresh (and
> any re-render that shrinks the pane) silently sent the writer back to the top. Same family as
> this repo's other absence-vs-failure distinctions: the offset of a placeholder is not a
> reading position, so it is not recorded as one.

Pattern **R1**, applied to a scroll offset.

## <a id="sb-frame-scroller"></a>The live frame pans through a REAL horizontal scroller

> Live page: readable, but the browser keeps its text out of our reach — so the
> selection actions are absent here rather than present and silently inert.
> ⚠ A REAL HORIZONTAL SCROLLER, AND THAT IS THE WHOLE PAN MECHANISM. MEASURED before
> it was built: a two-finger horizontal gesture over a cross-origin frame CHAINS out
> of it into the nearest scrollable ancestor (360px in six notches) while our own
> wheel listener is called ZERO times. So the browser pans this for free the moment
> the host can scroll — and a JS handler here would be a mechanism with no surface,
> which this repo has shipped before and had to go looking for.
> Vertical stays HIDDEN on purpose: the frame is sized so its painted height is
> exactly the host's, so the site keeps its own vertical scrolling and the reader
> never meets a second scrollbar wrapped around the first.

## <a id="sb-sandbox"></a>`allow-downloads` on the live frame

> ⚠ `allow-downloads` (2026-08-30) — THE LITERAL HALF OF "also can we have a
> downloads", and a silent bug on its own account. Without it a download link
> inside a framed page does NOTHING AT ALL: the browser blocks the navigation
> and reports it only to its own console, so the site looks broken and Inkwave
> looks like the reason. It was absent by omission, not by decision — every
> other token here was chosen deliberately and this one was never considered.
>
> WHAT IT PERMITS, precisely: a framed page may start a download, which lands in
> the writer's ordinary Downloads folder through the browser's own UI. It does
> NOT let the page read anything of ours, write anywhere we can see, or install
> anything — a sandboxed frame with `allow-downloads` still cannot reach this
> origin, and the download is subject to the browser's normal prompts, its
> Safe Browsing checks and the file-type rules it applies to every other tab.
> The page could already navigate ITSELF anywhere (allow-scripts + allow-forms),
> so the new capability is narrower than what it holds.
>
> NOT CONDITIONAL ON LIVE FRAMING BEING ON, and that is deliberate: this frame
> only exists in live mode, so there is no second state to guard — and gating a
> sandbox token on a feature flag would mean the same page behaved differently
> in ways nothing in the UI could explain. The extension's framing rule widens
> WHICH pages may be shown; it has no bearing on what a shown page may do.

## <a id="sb-locator"></a>Cite the SECTION the selection is in

> ⚠ CITE THE SECTION THE SELECTION IS IN — not the selection (Peter, 2026-08-28: "if
> we cite as locator what we really want is for it to cite the heading or section
> number as the locator"). It used to hand the SELECTED SENTENCE to
> locatorForHeading, which of course found no number in it and returned the whole
> sentence verbatim as the locator: "(Smith 2005, Each object is, at the later time,
> composed…)". Nonsense, and my mistake — the function was built for headings and I
> fed it prose.

## <a id="sb-embed-contradiction"></a>⚠ TWO COMMENTS, ONE EFFECT, OPPOSITE INSTRUCTIONS — found and merged 2026-09-04

The framing-install effect carried **two** comments about the same `isPlayable` skip, six lines
apart, telling the next reader to do opposite things. The code skips.

The one attached to the flag guard, now removed from the source:

> ⚠ DO NOT SKIP `isPlayable` PAGES. It used to short-circuit here on the reasoning that an
> embed endpoint already frames, so a rule for it "buys nothing" — which ignored that the early
> return happens AFTER the previous run's cleanup ran. Opening one video tore down framing for
> the whole tab ("youtube stopped working… it just never loads"): worked once, then never,
> which is the signature of STATE rather than a race.
> DEFAULT OFF — see src/reader/liveFrameFlag.ts for why, and for what it does not fix.

Both of its claims were stale by the time it was read:

* **"DO NOT SKIP"** describes the hazard as it stood when the early return sat above a cleanup that
  RELEASED the tab's rule. That cleanup moved into its own effect (see `#sb-no-release`), and the
  skip below it explains precisely why it is safe now. `liveFrameFlag.ts` lists this as fixed bug
  **3 of 4** and says all four are pinned.
* **"DEFAULT OFF"** contradicts `reader/liveFrameFlag.ts`, whose own first line is
  **"LIVE FRAMING — DEFAULT ON"**, together with the account of why turning it off was treating the
  symptom. Anyone reading only this file would have believed the feature was dark.

The surviving rule is the one beside the skip, with the historical hazard folded into its last
clause; the flag guard now says DEFAULT ON and states the rule that actually governs that line
(read the flag per effect, never from a cached resolve — `liveFrameFlag.ts` sets `cache: false`
for exactly this reason).
