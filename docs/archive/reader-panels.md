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

---

# <a id="address"></a>`reader/address.ts` — what a typed string means, and which mode can serve it

Pure functions over URLs: no React, no DOM, no fetch, no module state. They were declared inside
`SourceBrowser.tsx` and exported from it, and `components/address.test.ts` — 28 tests — already
imported them from there, so the module boundary this file draws was one the tests had assumed for
some time without it existing.

Keeping them out of the component matters for one reason beyond tidiness: these rules decide whether
a search becomes Google-in-a-frame or a reader fetch, and that decision is read from THREE places in
the panel (the address bar, `go()`, and the framing effect). A second copy of it is how the address
bar and the navigator start disagreeing about what the same string means — which is why `canFrameRef`
exists in the component. One definition, three readers.

## <a id="addr-google-stale"></a>⚠ A BANNER THAT OUTLIVED ITS OWN MEASUREMENT — found and merged 2026-09-05

`GOOGLE_SEARCH_URL` carried an 18-line banner concluding:

> So the rule is not "Google or DuckDuckGo", it is "which mode can serve a search at all":
>   with framing  → GOOGLE, in the LIVE frame, where its own JavaScript runs and it is really Google.
>   without       → DuckDuckGo's no-JS HTML endpoint, in the READER…

**Every clause of that conclusion is contradicted by this same file, ~100 lines further down, and by
a test.** `searchUrlFor`'s own docblock records the later measurement — google.com/search frames
successfully and then REDIRECTS ITSELF to `/sorry/index`, its anti-abuse page, which Peter hit
immediately ("google search aren't [working]") — and `address.test.ts` carries
*"GOOGLE_SEARCH_URL is not used as a search endpoint by any path"*, asserting `searchUrlFor(true)`
and `searchUrlFor(false)` are both something else. The no-framing half is stale too: the reader's
engine has not been DuckDuckGo since 2026-08-31.

The constant is still right to exist — `isSearch` and the copy both reason about Google — and its
test is a real guard against a regression re-pointing search at it. What was wrong was a banner
stating a routing rule the code does not implement, in the most emphatic voice in the file. The
DURABLE half of it survives as the rule at the constant, because it is what stops the idea being
retried:

* **READING: Google can never be read here.** google.com/search fetched server-side returns ONE block
  and the words "click here" — its results are JavaScript-rendered. No extension changes that:
  fetching from the writer's own address changes WHO ASKS, not what comes back.
* **FRAMING: the header is strippable, and the old note that said otherwise was right for a web page
  and wrong once the extension shipped** (2026-08-30). Every engine sends `X-Frame-Options` or
  `frame-ancestors 'self'`; an extension strips those before the browser reads them. PROVED headed,
  `pnpm prove:framing`: REFUSED → framed.
* **And Google still declines to serve a search inside a frame anyway** — that is its policy, not a
  header we can strip.

## <a id="addr-search-chain"></a>The reader's engine is the one our SERVER can reach — and it is a CHAIN

⚠ THE READER'S SEARCH ENGINE IS THE ONE OUR SERVER CAN ACTUALLY REACH (2026-08-31). It was
html.duckduckgo.com, and Peter reported "not searching anything" five times in one evening. Measured
through the DEPLOYED /api/reader, same query, same minute:

    html.duckduckgo.com   502  0 blocks      lite.duckduckgo.com  502  0 blocks
    www.mojeek.com        502  0 blocks      search.marginalia.nu 200  119 blocks / 69 links

**Search engines refuse a data centre and serve a person.** So the READER path — the one that runs
with no extension installed — had never worked and could never have worked; it was a fallback to a
wall. Every "it's broken" was that, and I kept fixing the routing that led to it instead of the
destination.

Marginalia is not a compromise for this app: it deliberately indexes non-commercial, long-form,
text-heavy pages. Measured on "identity over time philosophy" it returns the SEP entry, a philosophy
department's event page and a course's lecture notes — which is what an honours student is looking
for, and closer to it than a commercial engine's first page.

⚠ A CHAIN, NOT AN ENGINE — because a single one is measurably not enough. Called four times in a row
through the deployed /api/reader with one query, old-search.marginalia.nu answered
**170 / 170 / 3 / 3** blocks: it works and then intermittently returns nothing. A search box that is
empty half the time is what Peter reported five times, and pinning one engine — however well it
scored once — reproduces that. The shipped chain: Marginalia (170 blocks / 90 linked at best) then
SearXNG (104 / 66, and steady across the runs where marginalia collapsed to 3).

`SEARCH_REFUSED` records what a server cannot READ (502, or a challenge page with no results) so
nobody re-adds them from memory. It is NOT a blocklist for the live frame — duckduckgo.com frames
beautifully, and `LIVE_SEARCH_URL` is the real duckduckgo.com used exactly where the extension can
frame it (5,993 characters, 34 result links, its own styling). Two endpoints because they answer two
different questions: "what can a server fetch and read" and "what can this browser display".

`LEGACY_DDG_SEARCH` is kept so `isSearch` still recognises old URLs.

## <a id="addr-external-hosts"></a>⚠ COUNTING LINKS IS NOT COUNTING RESULTS

The first version of `searchLooksEmpty` got this wrong in the way that matters. MEASURED through the
deployed function: bing answers with 31 linked blocks, **every one of them pointing back at
bing.com** — pagination, "images", "next page". A naive link count scores that as a healthy search
and the chain never falls forward, so the writer sees a page of an engine's own furniture and no
results at all.

So the signal is the number of DISTINCT EXTERNAL HOSTS. It is what a result IS: somewhere else to go.
It also degrades correctly — an engine serving a challenge page or its own index has zero, whatever
its status code says, and every one of those answers 200. `externalHostCount` is pure so the rule can
be tested without a browser and the panel cannot grow a second copy of it; an engine's own redirector
counts as the engine, not as a destination.

## <a id="addr-ecosia"></a>Ecosia was asked for and is refused ON MEASUREMENT

Peter, 2026-08-30: *"lets use ecosia instead of duckduckgo. its more sexy"*. It is a
reasonable-sounding idea, so record why it cannot work or the next reader will try it again. Measured
both paths, headed, with the shipped framing rule:

* READ (server or extension fetch): **403**, 2 blocks, 0 links — Cloudflare refuses the fetch.
* FRAMED, with the extension stripping the framing headers: it frames, and then renders
  **"Just a moment…"** — a Cloudflare interstitial. 147 characters, 0 result links.

Shipping it would put a challenge page where the results go. It is not a header we can strip and not
a path an extension changes: **Cloudflare is judging the CLIENT, and we are not one it trusts.**

The same measuring run found the answer he actually wanted, though: with framing, the real
`duckduckgo.com` frames and renders in full. So the ENGINE does not follow the capability — Google
still cannot serve a framed search — but the ENDPOINT does: the pretty one where it works, the plain
one a server fetch can read where it does not.

## <a id="addr-inkwave-itself"></a>⚠ INKWAVE MAY NOT OPEN INKWAVE

2026-08-30 — Peter loaded `https://iwzero.me` in the panel. Today it shows the browser's broken-page
icon, because the app sends `x-frame-options: DENY` and `frame-ancestors 'none'`. **That is not what
makes this a refusal**: the extension's rule STRIPS both, so once it is installed this would very
likely start working — and working is the problem.

A framed Inkwave boots a SECOND full editor inside the first: a second Tiptap, a second OPFS client, a
second provenance session — and a second claimant on the SAME document lock (`storage/tabDoc.ts`
`claimDocLock`). This repo has already lived through one tab holding two document locks: StrictMode's
double-invoke did it by accident and the writer-facing symptom was "This document is open in another
window" on a plain refresh. Framing ourselves reproduces that on purpose. And the inner copy has a
reader panel of its own, so it recurses.

MODE-INDEPENDENT deliberately: reader mode is no better, because the app is a client-rendered SPA and
extracting its shell yields a page with no prose in it.

The origins come from `APP_INITIATORS` (reader/framingRule.ts) — the SAME list the extension scopes
its rule to. A private copy would be how a rename puts a guard quietly to sleep.

## <a id="addr-playable"></a>Playable media — why ChatGPT can frame YouTube and a web app cannot

Peter, 2026-08-28: *"if gpt can play youtube then surely we can?"* — with a screenshot of ChatGPT
showing youtube.com in a panel, tabs and all.

**THE DIFFERENCE IS NOT EFFORT, IT IS WHAT KIND OF PROGRAM EACH ONE IS.** `X-Frame-Options` and
`frame-ancestors` govern EMBEDDING ONE PAGE INSIDE ANOTHER PAGE, and that is the only thing a web app
can do: `<iframe>` (and `<embed>`/`<object>`) are the entire vocabulary, and all of them are covered.
That restriction is not an oversight we can route around — it is what stops a page wrapping your bank
in an invisible frame, so no browser offers an escape hatch. ChatGPT's panel is not an iframe: it is a
NATIVE app hosting a real browser view (Electron/WKWebView), which is a TOP-LEVEL browsing context,
and the header simply does not apply to it. The day Inkwave ships as a desktop app it gets the same
thing for free; as a web page it never can.

**BUT VIDEOS ARE A DIFFERENT MATTER, and here the answer is simply yes.** YouTube publishes an
endpoint whose whole purpose is to be embedded, and it sends NO framing restriction at all (checked:
`/embed/` returns 200 with no X-Frame-Options and no frame-ancestors, unlike `/watch`). So a YouTube
link is rewritten to it and plays. Same for Vimeo. `-nocookie` is the same player without YouTube
setting tracking cookies for a video the reader opened from inside their own document; it frames
identically (checked).

## <a id="addr-hygiene"></a>Tracking parameters, DuckDuckGo's redirector, and the known-refusers list

**TRACKING PARAMS.** Peter, 2026-08-28, seeing `?utm_source=chatgpt.com` in the address bar: they are
added by whoever gave you the link, not by us — but a reader is a place you READ, and carrying
someone's campaign tag into every request and every citation is noise at best. Stripped on navigation;
nothing else about the URL changes.

**THE REDIRECTOR.** DuckDuckGo wraps every result in `/l/?uddg=<encoded>`. Unwrap it, so clicking a
result goes to the SITE — otherwise every navigation from a search lands on a redirector, which the
reader then has nothing to extract from.

**`KNOWN_NO_FRAME`.** Hosts known to send X-Frame-Options / frame-ancestors. NOT a security control and
never exhaustive — the load deadline is what catches the general case; this just skips the wait for
the ones we have already met (Peter hit abc.net.au and youtube.com within a minute of each other).

---

# <a id="pagesource"></a>`reader/pageSource.ts` — where the reader's fetch actually happens

## <a id="ps-why-extension"></a>The writer's own browser first, our server second

Peter, 2026-08-28: *"is it possible for us to run the window from the user's IP?"* The reason the
question came up is MEASURED and is not going to be argued away by tuning a user-agent string:
against the DEPLOYED endpoint, duckduckgo, lite-ddg and mojeek answer "fetch failed", searx.be answers
"Verifying your browser…", priv.au serves a captcha and marginalia returns 5 blocks and ZERO links,
while wikipedia and plato.stanford.edu are served normally. **A search engine will serve a person and
refuse a data centre. The extension IS a person's browser.**

⚠ WHAT THE EXTENSION PATH ACTUALLY BUYS, STATED PRECISELY, because the UI quotes this module:

* the request leaves the WRITER'S OWN ADDRESS, not a Vercel IP. That is Peter's question and it is
  unambiguously true.
* our server never learns the URL, because it is not in the path at all. Strictly stronger than the
  "sees the address for an instant, logs nothing" posture the server endpoint documents.
* cookies: an extension-worker fetch is cross-site by initiator, so a site's SameSite=Lax/Strict
  cookies are NOT sent. Some session state travels, some does not, and which is the site's choice.
  **UNVERIFIED per-site, so the UI claims the ADDRESS and says nothing about being signed in.**

## <a id="ps-one-extractor"></a>ONE extractor, two fetchers — and still no HTML reaches the renderer

`extract.mjs` was split out of `api/_reader-core.mjs` for exactly this and is imported here — the same
function turns HTML into blocks whichever machine fetched it. A client-side second copy would drift
the first time either side was tuned, and both feed one renderer (the pmToText/textMap lesson, one
directory along). `pageSource.test.ts` pins that the extension path's output is byte-identical to
calling the extractor directly.

⚠ AND STILL NO HTML REACHES THE RENDERER. The extension hands back an HTML STRING — the one thing
`api/_reader-core.mjs`'s header says must never cross — and it is consumed in this module by the
extractor, which returns `{kind, text, href}`. Nothing downstream of `loadSource` has ever seen
markup, so injection stays **unrepresentable rather than filtered**. The string does exist in this
origin's memory for the length of one call; it is never assigned to innerHTML, never parsed by
DOMParser, never inserted. (DOMParser would be the tempting "better" extractor and it is the one thing
this must not become: `new DOMParser().parseFromString(html, 'text/html')` builds real elements — img
src fires no request in a detached document today, but that is a browser behaviour, not a guarantee we
control, and the tolerant scanner needs no such promise.)

The extractor is untyped Node-free ESM, so its shape is asserted at the boundary here and nowhere else.

## <a id="ps-ask"></a>ASK, DO NOT WAIT TO BE TOLD

`ask()` is one request, one reply, correlated and deadlined — the shape all the exchanges share.

An "the extension is here" announcement is a ONE-SHOT ASYNC SIGNAL and this repo has the scar tissue:
a listener attached after it fired waits for ever, silently, and a feature that is merely disabled is
indistinguishable from a feature nobody built. So the page asks; `null` back means the deadline
passed, which is an ANSWER and not a hang.

The uuid is not decoration either: without it, a late reply to an EARLIER question satisfies a later
one, and the reader believes an extension that has since gone away. And the subscription happens
BEFORE the post, because the content script may answer synchronously.

`ExtensionState` has three members and the middle one is the point: `blocked` (installed and
answering, but not granted permission to fetch) must never be silently treated as `absent` — it is one
click away from `ready` and the UI can say so. `absent` covers "not installed" and "not answering"
together, because from here they are indistinguishable and the writer's remedy is the same.

The `Port` bridge is injected so these rules can be tested without a browser or an extension — which,
given nobody can load an unpacked extension inside `pnpm test`, is the difference between a guard and
a hope. The real bridge delivers only messages from THIS window and THIS origin, the same two checks
`citations/extensionChannel.ts` makes.

## <a id="ps-memo"></a>The session's answer, asked once

The probe costs a round trip, and re-running it per navigation would put its deadline in front of
every link the reader follows. So it is memoised for the page's lifetime — with two rules that are
easy to get wrong and expensive to get wrong:

* **NEVER CACHE THE SSR ANSWER.** There is no window during prerender, so an eager module-scope probe
  would bake 'absent' into the build's first paint and the extension would be invisible until a
  reload. `typeof window === 'undefined'` returns without writing the memo.
* **`refresh` EXISTS BECAUSE THE ANSWER CHANGES.** Granting the permission happens in the extension's
  popup, which cannot tell the page anything; the reader re-asks when the window regains focus, which
  is exactly when the writer has come back from doing it.

`_resetExtensionMemo` is exported rather than reached into, so the memo stays module-private and a
test cannot accidentally depend on its shape.

## <a id="ps-fallback"></a>⚠ THE FALLBACK IS FOR A FAILED FETCH, NOT FOR A DISAPPOINTING PAGE

If the extension fetched the page and the extractor found no prose in it, that IS the answer: falling
back would send the address to our server for a second opinion the writer did not ask for, **on the
one path whose whole point is that our server is not in it.** A JS-rendered app has no article in its
HTML from anyone's IP. The reader offers Live mode for that, as it already did.

The caller is TOLD which machine fetched, because a privacy posture nobody can see is a privacy
posture nobody has.

Two smaller rules on the same surface. `openExtensionPopup` returns false when it could not — INCLUDING
when it did not answer at all — and the caller MUST still show the writer how to do it by hand:
`action.openPopup()` is a recent API and may simply refuse, and a button whose only fallback is
silence is the dead button this reader has already been bitten by twice. And `releaseFraming` is
fire-and-forget BY DESIGN: it runs from the panel's teardown, and on a tab close there is no later turn
in which an ack could arrive — waiting would make the common path the one that never completes. The
rule is session-scoped in the worker precisely so a lost release cannot leave framing open past the
browser session.

`allowFramingVia` answering true means A RULE WAS INSTALLED — it does not mean the page will render,
and the caller must not tell the writer otherwise. Measured in a real browser
(docs/SEARCH-AND-THE-EXTENSION.md): abc.net.au and youtube's own watch page render properly, facebook
still refuses in its BODY where there is no header to strip, google served a CAPTCHA, and ANY logged-in
site renders SIGNED OUT because `SameSite=Lax` — the default a cookie gets when it says nothing — is
dropped in a third-party frame. That last one is the browser's own rule and no header we remove
touches it.

## <a id="ps-pdf-routes"></a>Fetching a PDF: two routes, and the server is deliberately not a third

Peter: *"also can we have a downloads."* Bringing a browsed PDF into the citation library needs its
BYTES, and where they can come from is not a preference — it is decided by two rules, one of which is
OURS:

* **THE EXTENSION CAN FETCH ANYTHING.** It holds `<all_urls>`, neither CORS nor our CSP applies to it,
  and the request leaves the writer's own address like every other reader fetch.
* **THE PAGE CAN FETCH ALMOST NOTHING, AND THE REASON IS OUR OWN CSP, NOT CORS.** Measured in a real
  browser: `middleware.ts` sets `connect-src 'self' <named hosts>`, so a cross-origin request from
  here is refused BY US before CORS is consulted. See `pdfRouteFor` for why that header stands and the
  feature bends instead.

So `pdfRouteFor` decides FIRST and the panel draws accordingly — there is no doomed attempt whose only
product is a console error and a wasted press. What this must never do is FAIL SILENTLY:
`savePdfSource.ts` turns each code into a sentence, and the panel offers the extension at exactly the
wall it would remove.

⚠ THE SERVER IS DELIBERATELY NOT A THIRD ROUTE. `api/pdf.mjs?proxy=` was removed on 2026-07-08 for
being slow, often blocked, and the one PDF path that passed a writer's reading through our machine.
Re-adding it here would undo that decision quietly, inside a feature about convenience.

⚠ `no route` IS AN ANSWER, NOT A BUG. When the extension is absent AND the host refuses cross-origin
reads there is genuinely nothing this origin can do, and saying so — with the extension offered beside
it — is the honest end of the path. Guessing, retrying, or quietly storing an error page is not.

And a refusal the WRITER can act on must survive the fallback: `needs-permission`, `too large` and
`not a pdf` are verdicts about THIS FILE, and reporting the direct fetch's generic CORS failure over
the top of one of them would send the writer looking in the wrong place. Everything else on the direct
arm is the browser refusing to let us READ the reply — an opaque CORS failure with no detail, which is
exactly the wall the extension removes.

---

# <a id="extensionprotocol"></a>`reader/extensionProtocol.ts` — the reader↔extension wire

## <a id="ep-one-channel"></a>One channel, and the names live in `src/`

⚠ ONE CHANNEL, NOT A SECOND ONE. The bridge already exists: the app talks to
`extension-src/entrypoints/content-inkwave.ts` with `window.postMessage`
(`citations/extensionChannel.ts` is the other end of it), and that content script talks to the
background worker with `runtime.sendMessage`. `cite/visitSource` → `inkwave:watchPanel` is the
precedent this follows verbatim. A parallel port would be a second thing to keep in sync with the
first.

⚠ AND THE NAMES LIVE IN `src/`, BECAUSE THE EXTENSION IMPORTS FROM `src/` AND NEVER THE REVERSE (the
`@inkwave/citations` alias in `extension-src/wxt.config.ts`). A copy of these strings on the extension
side is how a rename becomes a feature that silently stops answering — which, on this channel, is
**indistinguishable from the extension not being installed.**

## <a id="ep-shape-guards"></a>What the shape guards are actually for

The page listens on `window`, so anything in this origin could post one of these. That is the same
trust boundary `citations/extensionChannel.ts` already sits on, and it is not the interesting one: a
script running in this origin already holds the writer's thesis and their signing session. What these
guards are for is the ordinary case — a message from some other library that happens to share a field
name must never be read as an answer to OUR question, and an answer to an EARLIER question must never
satisfy a later one (hence the uuid, checked in the guard and not by the caller).

`NEEDS_PERMISSION` is the one error the UI must ACT on rather than merely report: the extension is
installed but has not been granted permission to fetch, which one click in its popup fixes. Everything
else on this path is an ordinary failure and falls back to the server.

`EXT_MAX_BYTES` is lower than the server core's 4MB because every byte crosses `runtime.sendMessage`
AND `window.postMessage` as a JSON string, and a page that large has no article in it anyway.

## <a id="ep-grant"></a>⚠ THE GRANT CANNOT HAPPEN IN THE APP

`permissions.request()` is honoured only from a user gesture inside an EXTENSION PAGE — not from a web
page, not from a content script (which has no `permissions` API at all), not from the background
worker. So the most the reader can do at the moment the permission would help is ask the extension to
open its own popup, where the real button lives. `ok:false` is an ordinary answer — `action.openPopup()`
is recent and may refuse — and the UI must therefore carry the manual instruction whether or not this
succeeds, rather than depending on it.

## <a id="ep-framing"></a>Live view: letting a page be framed at all, and the honest half

Peter, 2026-08-30: *"build the extension."* Reader mode extracts an article's TEXT; live view shows the
page itself, and most of the web refuses to be framed — `X-Frame-Options` and CSP `frame-ancestors` are
enforced by the BROWSER, so no web app can opt out of another site's refusal. An extension can, by
removing those response headers before the browser reads them.

MEASURED (headed Chromium, with a canary rule proving the ruleset live and a control run proving
refusals detectable — docs/SEARCH-AND-THE-EXTENSION.md): google, youtube/watch, abc.net.au and facebook
all go REFUSED → framed. abc.net.au renders 14,921 chars of real page; youtube renders its actual watch
page. No framebusting script fired on any of them.

⚠ AND THE HONEST HALF, MEASURED IN THE SAME RUN: `SameSite=Lax` — which is what a cookie gets when it
does not say otherwise — and `Strict` are BOTH dropped in a third-party frame; only `SameSite=None`
survives. So a logged-in site frames and renders SIGNED OUT, and no header we remove can change that:
it is the browser's third-party context rule, not a header. Facebook additionally refuses in the BODY,
where there is nothing to strip. **The UI must say this, because a signed-out page with no explanation
reads as Inkwave being broken.**

⚠ WHY THIS IS SCOPED AND NOT A STANDING RULESET. Removing framing protection browser-wide would make
every site the writer visits clickjackable — a citation tool turning into a hazard on pages it has
nothing to do with. So the rule is (a) SESSION-scoped, added when the reader opens a live page and
removed when it closes, (b) restricted by `initiatorDomains` to Inkwave's own origins, so it can only
ever apply to a frame THIS APP created, and (c) restricted to `sub_frame`. A rule that outlives the
panel is the bug this shape exists to prevent.

The rule's own shape — and `APP_INITIATORS` — live in `./framingRule.ts`, next to the scoping argument
they exist to enforce. `extensionProtocol.ts` stays the WIRE: names and shape guards only.

## <a id="ep-file-message"></a>Fetching a FILE is a second message, and the bytes are base64

⚠ WHY THIS IS A SECOND MESSAGE AND NOT A FLAG ON `reader/fetch`. That exchange is DEFINED to return
text: `decodeHtml` (fetchRules.ts) throws `not html` on anything else, deliberately — "the reader has a
separate answer for a PDF", as its own comment already said. Widening it would make one message whose
reply is sometimes a string and sometimes bytes, and every existing caller would have to learn the
difference. A separate pair keeps `FetchPageResult` exactly as narrow as it is, and keeps a page fetch
**structurally incapable** of returning a binary blob.

⚠ AND WHY THE BYTES ARE BASE64. `runtime.sendMessage` serialises as JSON — it is NOT structured clone —
so an ArrayBuffer cannot cross the content-script↔worker hop intact. base64 is the honest cost of that
boundary, and it is why `PDF_MAX_BYTES` exists at all. The page decodes it with `base64ToBlob`
(citations/pdfStore.ts), the same native data-URL decode every other binary path here uses — **never a
hand-rolled atob loop, which was a 20M-iteration main-thread stall the last time somebody wrote one.**

`FetchFileResult.mime` is what the SERVER said — kept for the record and for the diagnosis in a
refusal, and never what decides whether the bytes are stored.

---

# <a id="pdfaddress"></a>`reader/pdfAddress.ts` — a PDF found while browsing becomes a source

## <a id="pa-the-ask"></a>The ask, and the observability boundary that decides the feature's shape

Peter, 2026-08-30: *"also can we have a downloads"* — said while browsing in the source panel. Taken
literally that is a downloads folder, which is not a thing this app has or should grow. He reads papers
in order to CITE them, so the valuable reading of the ask is the one that closes that loop: the PDF he
is looking at becomes a source, with its bytes where every other source PDF's bytes already live (OPFS
`library/pdfs/`), so it opens in the PDF viewer he already has and appears beside its citation. The
literal reading is answered too, and separately — the live frame's `sandbox` was missing
`allow-downloads`, so an ordinary download link inside a framed page did nothing at all, silently.

⚠ WHAT IS OBSERVABLE, AND IT DECIDES THE SHAPE OF THE WHOLE FEATURE. A cross-origin iframe tells the
embedder NOTHING: not what was clicked, not that a navigation happened, not what came back. So
"intercept the PDF he clicks in the live frame" is not a thing that can be built — by us or by anyone,
in any browser. What the panel CAN see is its own address (`here`), which every link followed in READER
mode passes through. That is the seam this feature stands on, and it is why the affordance is attached
to the address rather than to a click.

## <a id="pa-magic-bytes"></a>⚠ THE CONTENT-TYPE HEADER IS NOT THE AUTHORITY — THE BYTES ARE

A publisher's "download PDF" link that has quietly become a login wall answers 200 with
`content-type: application/pdf` and an HTML body often enough to matter. Storing that under a `.pdf`
name gives the writer a source that opens to nothing, months later, with no way to tell what happened.
`looksLikePdfBytes` is the gate that must pass before anything is written, and it reads the file's own
magic (`%PDF-`).

`looksLikePdfAddress` is deliberately conservative — it decides whether the panel offers to SAVE, and a
false positive turns a readable article into a card that cannot fetch anything. It is also never the
last word, since the bytes are checked before a single one is stored, so the worst a wrong answer can
do is offer an action that then declines with a reason. Two shapes cover essentially every real case: a
path ending `.pdf`, and the extension-less repository forms — arXiv's `/pdf/2301.12345`, and the
`?…format=pdf` / `?…type=pdf` a journal platform hangs off an article id. **The parameter check is by
NAME as well as value**: a bare `?q=pdf` is somebody searching for the word, and answering that with a
save card is the panel telling the writer it found a file when it found a search.

`PDF_MAX_BYTES` is 20MB: far above any paper, and also the practical ceiling of the wire this travels
on when the extension fetches it. The bytes cross `runtime.sendMessage` (JSON, so base64) and then
`window.postMessage`, which makes a 20MB file a ~27MB string in flight. That is a real cost paid once
on an explicit press, and it is the reason the cap is a number rather than "as big as OPFS will take".
An oversized file is REFUSED and NAMED, never truncated — the media importer's rule, for the same
reason: a silently-degraded import is a file the writer believes they have.

## <a id="pa-citekey"></a>A citekey for a PDF nobody has told us the author of

⚠ IT IS A LABEL, NOT A CLAIM. `makeCitekey` (citations/cslMap.ts) builds `author + year + word` out of
metadata; here there is none — a URL and a filename is genuinely all we know. So the key is derived
from the filename, which is at least the publisher's own name for the thing and is what the writer will
recognise in the panel. `addToLibrary` de-collides it (`freeCitekey`), and the entry is saved with
author and year EMPTY on purpose, so the citation panel shows it as needing them rather than inventing
an attribution the file never carried. An all-digit key (arXiv ids, DOI suffixes) is prefixed with the
host so the library does not fill with keys that read as page numbers.

Title case is not attempted either: a stem like `2301.12345v1` is not a title and dressing it up as one
would be worse than leaving it plain.

## <a id="pa-csp-wall"></a>⚠ THE WALL IS OUR OWN CSP, NOT CORS — measured, and it refuted the first design

MEASURED IN A REAL BROWSER (`pnpm prove:reader`, 2026-08-30). The plan was "try the extension, fall
back to a direct fetch" — reasonable, and WRONG, because the wall is not CORS. It is our OWN
Content-Security-Policy: `middleware.ts` sets `connect-src 'self' <a named list of hosts>`, so a
cross-origin request from this origin is refused BY US, before CORS is ever consulted:

    Refused to connect because it violates the document's Content Security Policy

That header is not a nuisance to route around. This origin holds the writer's thesis and their signing
session, and the allow-list is what stops anything running here from talking to an arbitrary host.
Widening it to `https:` to make a convenience feature work would be trading the document's own
containment for a saved click — so the CSP stands, and the FEATURE bends.

The consequence has to be visible in the UI rather than discovered by pressing: with no extension, a
cross-origin PDF has NO route, and the card must say so up front instead of drawing a button that will
always fail. **"Do not draw a button that does nothing" is this panel's own rule, and a button that
reliably explains a wall is still a button that never does the thing it is labelled with.**

`direct` is NOT dead code and is not decoration: `'self'` is in the CSP, so a PDF served from Inkwave's
own origin genuinely fetches — and that is the case the browser probe exercises, since no probe can
load an unpacked extension.
