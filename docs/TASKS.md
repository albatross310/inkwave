# Inkwave — open work

Written 2026-08-28 from a full re-read of the session. Everything Peter asked for that is NOT
finished, plus the verification debt I owe. Ordered by lane, not priority; each item says what
"done" means, because several things in this session were reported done when they were only built.

**Rules for this file.** An item leaves this list when it is (a) built, (b) gated green by exit code,
and (c) either browser-proved or explicitly marked STATED-NOT-PROVED with the reason. "It compiles"
is not done. A comment describing a feature the code lacks has happened three times in one session —
if the note and the branch disagree, the branch is the truth.

---

## Lane A — Fetch from the writer's own IP (the extension)

Peter: *"is it possible for us to run the window from the user's IP?"* — yes, and it is the key to
several other things. Search engines and many publishers refuse Vercel's datacenter address while
serving people normally (MEASURED against the deployed endpoint: duckduckgo/mojeek/lite-ddg blocked,
searx "verifying your browser", priv.au captcha, marginalia 5 blocks & 0 links, wikipedia fine).

- [x] **A1** Extension background `fetchPage(url)` handler — returns `{finalUrl, html}` over the
      EXISTING content-script bridge (`reader/ping`+`reader/fetch`, relayed to `inkwave:fetchPage`).
      `<all_urls>` is an **optional** host permission granted from the popup, so the install prompt
      is unchanged; the rules that can be tested without a network live in `src/reader/fetchRules.ts`.
      ⚠ STATED, NOT PROVED: nothing here builds or loads the extension — `extension-src` is a
      separate pnpm workspace with no `node_modules`, outside `tsc -b` and outside vitest's
      `src/**` include, so the background worker is written-and-reviewed, never executed.
- [x] **A2** `src/reader/pageSource.ts` — extension first, `/api/reader` second, and the SAME
      `extract.mjs` runs either way (a test asserts the extension path's blocks are byte-identical
      to calling the extractor directly). The fallback is for a FAILED FETCH only: a page the
      extension fetched and found no prose in does not get sent to our server for a second opinion.
- [x] **A3** Search works when the extension is the fetcher — `pnpm prove:readerext`, 12/12, two
      cells: permitted ⇒ results render from the extension's bytes and `/api/reader` is never
      requested (observed at the network); not-permitted ⇒ the identical search goes to the server
      and says so. ⚠ THE REMAINING LINK IS UNPROVEN AND ONLY PETER CAN CLOSE IT: the extension's own
      request to DuckDuckGo **from his address** is not exercised by any test here. One real search
      with the extension loaded settles it.
- [ ] **A4** Sites that refuse framing become READABLE through the extension (JSTOR, Springer,
      Wiley), using the writer's own session. This is the bigger prize than search. NOT STARTED.
      NB the honesty limit found in A1: an extension-worker fetch is cross-site by initiator, so a
      site's SameSite=Lax/Strict cookies are NOT sent — "your own session" is partly true and the
      shipped copy therefore claims only the ADDRESS.
- [x] **A5** The reader says which connection fetched the page — a pill in the markup bar on every
      article ("⌂ your connection" / "☁ Inkwave's server"), the privacy notice varies with it, and
      where the extension is installed-but-unpermitted the pill becomes the button that offers the
      grant. Kept by `SourceBrowser.fetch.test.tsx` (mutation-proved: force the server path ⇒ 2 die;
      make the notice constant ⇒ 1 dies).

## Lane B — PDF reader view

Peter: *"build the reader view for pdfs. make sure highlights and text boxes translate between it…
don't worry about the existing highlights. just change the whole layout and method for future ones."*

- [ ] **B1** Extract per-page text via pdf.js's text layer; render reflowed with the app's own fonts
      and line spacing.
- [ ] **B2** New marks anchor BY TEXT (the model in `src/reader/marks.ts`), not by rectangle — so a
      highlight survives reflow and a different font size.
- [ ] **B3** Text boxes anchor to the NEAREST TEXT. A note at page coordinates has no meaning in a
      reflowed column; Peter has accepted paragraph-level placement.
- [ ] **B4** Old rect-anchored marks may go stale — his explicit call. They must not be DELETED, and
      the view must say when it cannot place one.
- [ ] **B5** Line spacing and font controls, which is what he originally asked for and what a fixed
      PDF layout structurally cannot give.

## Lane C — PDF export / print

- [ ] **C1** A ⋮ menu on the PDF toolbar with **Export** and **Print** of the MARKED-UP pdf (his
      words: "export/print the marked up pdf as a pdf … or to printer").
- [ ] **C2** One mechanism if possible: render pages with overlays into a print view, which gives
      both printing and the browser's own Save-as-PDF.

## Lane D — Reader tools

- [ ] **D1** A coloured-text tool: *"an input text which allows us to input coloured text at the
      cursor"*.
- [ ] **D2** A textbox tool in the reader, like the PDF's sticky note.
- [ ] **D3** *"all the same zoom settings etc"* — the reader has font and line-spacing choices but no
      zoom.
- [ ] **D4** Per-tool CURSORS. `data-iw-tool` is written on the body but **no CSS reads it yet** —
      the attribute is there and does nothing, which is the "mechanism with no surface" failure this
      session hit twice.
- [ ] **D5** Missing images in live mode. `referrerPolicy="no-referrer"` was dropped as a plausible
      cause — STATED, NOT PROVED. Diagnose properly.

## Lane E — Verification debt (mine)

- [x] **E1** DONE 2026-08-29. It was the PROBE, and the diagnosis is worth keeping: asking for a
      document another tab holds is answered with the single-open screen — that IS the fix working —
      but `waitEditor` demanded an EDITOR, so the fixed arm sat for two minutes and died, reading as
      a regression. Cell B's own comment said a second tab is "deliberately NOT required to land on
      it"; its code required exactly that. The comment and the code disagreed and the code was wrong.
      Now: control reproduces loss in A, B, C · fixed loses nothing in any of them.
- [x] **E2** DONE 2026-08-29 — `pnpm prove:reader`. Drives the real app: seeds a document and a
      per-document library in OPFS, boots via `?doc=`, clicks the citation, and uses the reader.
      12 checks green. It found two real bugs on its first honest run (the article's own title being
      offered as a locator, in two places) — the first reader bugs found by me rather than by Peter.
      FOUR wrong theories before it worked, every one of which looked exactly like the feature being
      broken: a route glob that silently did not match, a `page.evaluate` inside a route handler
      deadlocking the pending request, a hand-written URL expectation, and finally the real cause —
      the SERVICE WORKER answering `/api/reader` from its own cache, which `page.route` does not
      intercept (`serviceWorkers: 'block'`).
- [x] **E3** DONE 2026-08-30 — `pnpm prove:pdfzoom`. **The hypothesis was wrong, and the fix built on
      it was a no-op.** Reproduced first: a real ctrl+wheel zoom over a generated PDF fixture,
      sampled every frame. The content under the cursor drifts 198→319px *during* the gesture and
      then jumps 149px when the freeze lifts — and the re-assert made no difference at all (legacy
      and fixed trajectories were identical to 0.1px). **No scrollLeft write was ever clamped**: the
      one write asked for 570.7 into a range of 1778. The real cause is a layout CONSTANT being
      multiplied by the zoom ratio — the 180px overscroll gutter (`PDF_OVERSCROLL_PX`) arrives the
      instant `zoom` crosses 1.02, i.e. mid-preview, and the settle formula
      `(scroll + ax) * ratio - ax` scales it (and the scroller's 12px padding) as though it were
      content. Closed forms confirmed to the pixel: `180 × liveScale` during the gesture,
      `(12 + 180) − 12 × ratio` at the settle. Fixed by keying the gutter to the RENDERED zoom and
      anchoring on a fraction of the page's own box; measured 170.2px → 0.2px, in-gesture 318.9 → 0.0,
      vertical −9.5 → −0.5. Kept by `src/components/pdfZoomAnchor.test.ts` (11ms, no browser,
      mutation-proved).

## Lane F — Editor

- [ ] **F1** Zoom "even better". MEASURED 2026-08-29 (`pnpm prove:zoomcost`, 13k words / 325 blocks
      / 55 gaps, CPU-contended box so read RATIOS not absolutes):

          zoom-commit   p50 103ms   ← the whole synchronous commit, per notch
          zoom-stepEvent p50  68ms   ← 66% of it
          zoom-reflow    p50  32ms   ← the CSS write + the forced anchor read
          zoom-enterLive p50   0ms
          step cache: 1 hit, 11 misses, 17 precomputed

      THE TEXT REFLOW IS NOT THE PROBLEM — the pagination band measure is, and it misses almost
      every time. The cause is not that the precompute failed: it ran (17 entries). It fills
      `stepCache`, while a LIVE gesture reads `liveCache`, because the placeholder regime
      (`iw-zoom-live`) has different geometry and the two must not be mixed — that separation is
      deliberate and correct (see the comment at PaginationExtension.ts ~1341). The consequence is
      that the precompute cannot help the case it exists for: during a gesture every step is a
      synchronous live `readBands()`.

      THE LEVER, therefore, is to warm `liveCache` for the NEXT step IN THE PLACEHOLDER REGIME,
      between notches rather than on the input path — a zoom gesture is monotonic, so the next
      notch is nearly always ±1 in the same direction, and a real wheel leaves 150–260ms of idle
      between notches to do it in. Not attempted yet; the measurement is the deliverable so far.

---

## Done this session (for the record, and because several were reported done twice)

Red text (track changes, not a colour) · pinch zoom · scrub feel ×2 · page breaks cutting lines at
any zoom · the idle scroll jump (8813px, reproduced) · per-document citation library · new tabs open
blank · scroll position across a refresh · citation locators (§/¶/ch.) · the in-app reader, its
markup, LaTeX, section list and indicators · YouTube/Vimeo playback · one-axis PDF scroll · PDF
supersampling · comment margin · note drag/delete · the ⤢ fit · toolbar compaction.
