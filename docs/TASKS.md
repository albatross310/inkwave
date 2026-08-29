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

- [ ] **A1** Extension background `fetchPage(url)` handler — returns HTML + final URL, using the
      reader's own address and session. Broaden `host_permissions`.
- [ ] **A2** Client fetch layer: try the extension, fall back to `/api/reader`. `src/reader/
      extract.mjs` is already split out and browser-safe, so the SAME extractor runs either way.
- [ ] **A3** Search works again once A1/A2 land. Re-verify **from production**, not from a laptop —
      that mistake is why this item exists.
- [ ] **A4** Sites that refuse framing become READABLE through the extension (JSTOR, Springer,
      Wiley), using the writer's own session. This is the bigger prize than search.
- [ ] **A5** Say plainly, in the UI, when the extension is doing the fetching and when it is not.

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

- [ ] **F1** Zoom "even better" — the ~80ms per-notch reflow, untouched since he first asked. Needs
      a real change to in-gesture reflow, not another constant.

---

## Done this session (for the record, and because several were reported done twice)

Red text (track changes, not a colour) · pinch zoom · scrub feel ×2 · page breaks cutting lines at
any zoom · the idle scroll jump (8813px, reproduced) · per-document citation library · new tabs open
blank · scroll position across a refresh · citation locators (§/¶/ch.) · the in-app reader, its
markup, LaTeX, section list and indicators · YouTube/Vimeo playback · one-axis PDF scroll · PDF
supersampling · comment margin · note drag/delete · the ⤢ fit · toolbar compaction.
