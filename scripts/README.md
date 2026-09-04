# The script toolbox

Every `.mjs` under `scripts/`, what it is for, and how it is run. Generated 2026-09-05 because 19
of them were referenced by nothing at all — not `package.json`, not a doc, not another script.

That is not the same as dead. `fontCertify.crossEngine.mjs` is the WebKit pass
`docs/REFACTOR-QUEUE.md` names as required before the arithmetic engine can graduate;
`create-paypal-plan.mjs` is how the billing plan gets recreated and says *"run it yourself so your
secret never leaves your machine"*. A line-reduction pass came within one command of deleting both.
**Undiscoverable is the problem; an index is the fix.**

`pnpm <script>` where one is listed. Everything else is `node <path>` and is a deliberate manual
tool — a benchmark, a certification, a screenshot run, or a diagnostic kept beside the probe it
belongs to.

## `scripts/`

| script | run as | what it does |
|---|---|---|
| `arithmeticLayout.prove.mjs` | `pnpm prove:arithmeticlayout` | PROVER for the arithmetic layout engine (src/editor/arithmeticLayout.ts). |
| `create-paypal-plan.mjs` | manual | Create a PayPal subscription PRODUCT + PLAN via the API, since the dashboard UI is hard to find. |
| `cssfloor.prove.mjs` | `pnpm prove:cssfloor` | DOES THE index.css PHONE FLOOR ACTUALLY BEAT AN INLINE 13px fontSize? |
| `email.prove.mjs` | `pnpm prove:email` | EMAIL LAYER LIVE PROBE (2026-07-17) — drives the REAL app in a REAL browser. |
| `ext-release.mjs` | `pnpm ext:release` | Cutting an extension release, as far as a script honestly can. |
| `fetch-fonts.mjs` | manual | Self-host the app's web fonts. Run when the font set changes: |
| `fontCertify.crossEngine.mjs` | manual | CROSS-ENGINE FONT CERTIFICATION (2026-07-16) — Chromium + WebKit. |
| `fontCertify.fetch.mjs` | manual | Fetch the NON-SHIPPED families (the r7/r8 FAILED list + the certified-but-cut list) into a temp |
| `fontCertify.prove.mjs` | `pnpm prove:fontcertify` | ROUND-9 FONT CERTIFICATION — the r7/r8 grid RE-RUN IN THE EDITOR'S REAL CONTEXT (2026-07-16). |
| `fontStrip.mjs` | manual | STRIP LIGATURE FEATURES FROM THE SELF-HOSTED FACES (2026-07-16 — the iOS rescue attempt). |
| `fontStrip.prove.mjs` | `pnpm prove:fontstrip` | DOES STRIPPING LIGATURES FROM THE SERVED FACES RESCUE THE ENGINE ON iOS? (2026-07-16) |
| `fontStrip.verify.mjs` | manual | VERIFY THE REGENERATED BUILD (2026-07-16) — not the artifacts, the actual pipeline output. |
| `framing.prove.mjs` | `pnpm prove:framing` | DOES THE SCOPED RULE ACTUALLY FIRE? (2026-08-30) |
| `ledger-ui.prove.mjs` | `pnpm prove:ledgerui` | The clock drop-up + countdown: does it LOOK right, and does it cost typing? |
| `ledger-wiring.prove.mjs` | `pnpm prove:ledgerwiring` | PROVE THE WIRING FIRES — the productivity ledger's capture tap, in the real app. |
| `music.prove.mjs` | `pnpm prove:music` | MUSIC MODULE PROVER (2026-07-17) — drives the REAL built app. |
| `musiclayer.prove.mjs` | `pnpm prove:musiclayer` | feat/music-layer PROBE (2026-07-18) — renders the music BAR + PANEL over the editor, day+night. |
| `offscreen.mjs` | manual | KEEPING A HEADED BROWSER OFF PETER'S SCREEN, ON macOS. |
| `pdfexport.prove.mjs` | `pnpm prove:pdfexport` | PROVE THE MARKED-UP EXPORT IN A REAL BROWSER — Lane C (Peter: "a three dots button with an export |
| `pdfposthoc.prove.mjs` | `pnpm prove:pdfposthoc` | The PDF reading indicator + the post-hoc manual add — day and night, desktop and phone. |
| `prod-graphs-shots.mjs` | manual | Screenshots of the productivity CHARTS PANEL in DAY and NIGHT, at each report window. |
| `prodLoadPath.prove.mjs` | `pnpm prove:prodloadpath` | PROVE: the productivity/email lane costs the load path NOTHING with its flags off. |
| `prodreport.prove.mjs` | `pnpm prove:prodreport` | PRODUCTIVITY REPORT PROVER (2026-07-17) — drives the real built app, because a flag-gated |
| `prose-only.mjs` | `pnpm prose-only` | PROVE A CHANGE IS COMMENTS-ONLY. |
| `renderGap.prove.mjs` | `pnpm prove:rendergap` | FORCED MID-PARAGRAPH BREAK PROVER (2026-07-16) — the case the standalone render prover can't see. |
| `renderWrap.prove.mjs` | `pnpm prove:renderwrap` | RENDER-FONT WRAP PROVER (2026-07-16) — the arithmetic engine at the PHONE RENDER size (22.5px = |
| `toolbar.prove.mjs` | `pnpm prove:toolbar` | The footer toolbar contract, driven in the REAL built app. |

## `scripts/archguard-probe/`

| script | run as | what it does |
|---|---|---|
| `repro.mjs` | manual | THE SNAPSHOTS — a failed read of the archive must never truncate it. Real OPFS, real Chromium. |

## `scripts/bench/`

| script | run as | what it does |
|---|---|---|
| `harness.mjs` | manual | Keystroke-latency benchmark harness (HONEST, one identical method for every editor). |

## `scripts/bench/tiptap-src/`

| script | run as | what it does |
|---|---|---|
| `vite.config.mjs` | manual | Relative base so the built assets load under /tiptap/ on the static server. |

## `scripts/lib/`

| script | run as | what it does |
|---|---|---|
| `stripLigatures.mjs` | manual | Strip the ligature GSUB features out of self-hosted faces — shared by the font pipeline |

## `scripts/openguard-probe/`

| script | run as | what it does |
|---|---|---|
| `blankdoc.mjs` | manual | THE SWALLOWED READ — 2026-07-15 11:19:40, reproduced, and its guard proved. |
| `repro.mjs` | manual | THE BLIND-OVERWRITE INCIDENT — 2026-07-15 11:30:18, reproduced, and its guard proved. |

## `scripts/opfs-inspector-probe/`

| script | run as | what it does |
|---|---|---|
| `probe.mjs` | manual | OPFS INSPECTOR PROBE — does the recovery surface actually recover an ORPHANED document? |

## `scripts/pdfzoom-probe/`

| script | run as | what it does |
|---|---|---|
| `fixture.mjs` | manual | A DETERMINISTIC PDF, GENERATED — never one of Peter's own documents (CLAUDE.md: his prose never |
| `geom.prove.mjs` | `pnpm prove:pdfgeom` | ═══════════════════════════════════════════════════════════════════════════════════════════════ |
| `zoomanchor.prove.mjs` | `pnpm prove:pdfzoom` | ═══════════════════════════════════════════════════════════════════════════════════════════════ |

## `scripts/scrub-probe/`

| script | run as | what it does |
|---|---|---|
| `probe-anchor.mjs` | manual | REGISTRATION at FULL SAMPLE — does the doc pane land the SAME CONTENT at the centre across |
| `probe-badges.mjs` | manual | HEADER BADGES (+N/-N) — do they track the PRESENTED version, or the frozen heavy pair? |
| `probe-bakebox.mjs` | manual | PROVE THE BOX GUARD. The bake/lookup key now has ONE source (the surface). The guard that |
| `probe-coldwarm.mjs` | manual | COLD-RANGE WARM-UP measurement (Peter: "how quickly will it load the new warm window once you |
| `probe-drive.mjs` | manual | THE DRIVER'S INPUT SIDE — events IN vs versions OUT. |
| `probe-flipbook-clean.mjs` | manual | Clean flipbook swap-cost + fidelity: warm a contiguous window, QUIESCE captures, then shift-wheel |
| `probe-mem.mjs` | manual | THE EVICTION RULE — does the mem budget actually hold, and is every bound NAMED? |
| `probe-overlay.mjs` | manual | Job 1+2+3: does the SWEEP fill the cache from cold, and what does the ?snapThumbs=debug overlay |
| `probe-peterscale.mjs` | manual | PETER-SCALE REPRO — 742 words / 116 snapshots (his recorded burst), not the 20k/36 fixture. |
| `probe-recorder.mjs` | manual | Round 10 — PROVE THE INSTRUMENT, THEN READ IT. |
| `probe-reverse.mjs` | manual | THE REVERSAL ACCEPTANCE TEST (Peter's oldest complaint). |
| `probe-shiftwheel.mjs` | manual | Shift-wheel ROOT-CAUSE probe (Apple-Photos bar): why don't intermediate versions flicker past |
| `probe-sweep-panes.mjs` | manual | Round 10: does the sweep now bake ALL THREE panes, so a fast fling into a COLD range presents |
| `probe-thumbkeys.mjs` | manual | Round 10: WHY is the thumb column zero? The store is a two-sided key contract — bake writes a |
| `probe-thumbs.mjs` | manual | Pre-baked snapshot thumbnail proof. Uses a REAL in-memory OPFS shim (the base probe shim |
| `probe-thumbsize.mjs` | manual | Thumbnail BYTE-SIZE measurement for the pre-bake assessment: a representative text-page canvas |
| `probe.mjs` | manual | snapshot scrub-bitmap probe: seeds a thesis-scale doc (36 snapshots, ~20k words) through an |
| `server.mjs` | manual | Fallback-faithful static server for /snapshot probes (NOT vite preview — that serves the |

## `scripts/tabdoc-probe/`

| script | run as | what it does |
|---|---|---|
| `locks.mjs` | manual | DOES THIS PLATFORM ACTUALLY HAVE WEB LOCKS? — and specifically, does it do the ONE thing |
| `newtab.prove.mjs` | `pnpm prove:newtab` | NEW TAB → BLANK. HARD REFRESH → THE SAME DOCUMENT. TWO TABS → NEVER THE SAME ONE. |
| `repro.mjs` | manual | TAB DOCUMENT IDENTITY — the data-loss reproduction, and the proof of its fix. |
| `unsynced.mjs` | manual | THE UNSYNCED-WORK NOTICE — does the wiring actually fire? |

## `scripts/textrender-probe/`

| script | run as | what it does |
|---|---|---|
| `_zoombreak.local.mjs` | manual | IS THE MID-LINE BREAK A ZOOM ARTEFACT? Page breaks are CANONICAL — measured in a forced context |
| `arith.prove.mjs` | `pnpm prove:arith` | Usage: pnpm build && pnpm prove:arith   (boots its own server on an ephemeral port) |
| `bandcost.diag.mjs` | manual | WHY DOES `readBands()` COST ~70ms DURING A ZOOM GESTURE AND ~0.2ms AT REST? |
| `bothhalves.prove.mjs` | `pnpm prove:bothhalves` | DO THE TWO HALVES AGREE? — the canvas model vs the DOM landing, on the same version. |
| `breakdensity.prove.mjs` | `pnpm prove:breakdensity` | IS "THE MODEL'S BREAKS ARE BYTE-IDENTICAL TO THE LIVE EDITOR" TRUE, OR TRUE ON ONE FIXTURE? |
| `breaks.prove.mjs` | `pnpm prove:breaks` | Usage: pnpm build && pnpm prove:breaks   (boots its own server on an ephemeral port) |
| `breakwhere.mjs` | manual | DIAGNOSTIC: WHERE does the first divergent break fall, and in what? |
| `btdebug.prove.mjs` | `pnpm prove:btdebug` | Does the iOS debug script RUN, and can it go RED? Peter is about to run this on his phone; a |
| `btrace.prove.mjs` | `pnpm prove:btrace` | DOES THE LIBRARY-HYDRATION RACE REPRODUCE, AND DOES THE FIX CLOSE IT? (2026-07-17) |
| `contrastWalker.mjs` | manual | THE CONTRAST WALKER — ONE definition, shared by every night-mode probe. |
| `coverage.mjs` | manual | COVERAGE — the measurement that decides whether the text renderer is usable on real prose. |
| `crossdevice.prove.mjs` | `pnpm prove:crossdevice` | CANONICAL PAGINATION IS CROSS-DEVICE — the load-bearing invariant this fix must not break. |
| `csszoom.prove.mjs` | `pnpm prove:csszoom` | Does CSS `zoom` on the PAPER preserve the wrap? — the /snapshot doc pane's convention, probed. |
| `editorbytes.prove.mjs` | `pnpm prove:editorbytes` | WHAT THE EDITOR ACTUALLY DOWNLOADS (2026-07-17 — the "costs Peter nothing" claim, from outside). |
| `fidelity.mjs` | manual | FIDELITY: the text render vs the REAL editor render, same page, same machine, pixel diff. |
| `fixture.mjs` | manual | SYNTHETIC CITATION-HEAVY FIXTURE — the shape of a real Honours proposal, none of its content. |
| `fontfallback.prove.mjs` | `pnpm prove:fontfallback` | WHY DOES A **CERTIFIED** FONT MARK DIVERGE? — textStyle:fontFamily, Δ76, matched 0/50, SILENT. |
| `halvesbisect.prove.mjs` | `pnpm prove:halvesbisect` | WHICH CONTENT KIND MAKES THE TWO HALVES DISAGREE? — the control bisect. |
| `incremental.prove.mjs` | `pnpm prove:incremental` | DOES THE INCREMENTAL BLOCK CACHE PRODUCE THE SAME PAGINATION, AND IS IT FAST ENOUGH? (2026-07-17) |
| `isolate.prove.mjs` | `pnpm prove:isolate` |  |
| `jumpguard.prove.mjs` | `pnpm prove:jump` | DOES THE DOCUMENT MOVE ON ITS OWN? Peter: "the doc keeps jumping down… it doesn't happen straight |
| `landingcost.prove.mjs` | `pnpm prove:landingcost` | WHAT DOES A RICH PANE COST AT REST? — the number Peter is being asked to pay for formatted pages. |
| `linecount.prove.mjs` | `pnpm prove:linecount` | THE PHANTOM LINE, MEASURED DIRECTLY — per block, not per break. |
| `listdiag.mjs` | manual | DIAGNOSTIC: localise the list divergence against the REAL DOM. |
| `liveimages.prove.mjs` | `pnpm prove:liveimages` | DO IMAGES LOAD IN THE READER'S LIVE (IFRAME) MODE? |
| `mapcompare.mjs` | manual | MAP COMPARISON — the line-rect hypothesis, shown rather than asserted. |
| `midline.prove.mjs` | `pnpm prove:midline` | THE MID-LINE BREAK PROVER — does every LIVE page break land at a true line start? |
| `mountcount.prove.mjs` | `pnpm prove:mount` | EDITOR MOUNTS ONCE — the 2026-07-11 double-mount bug, re-probed for the schema round (2026-07-17). |
| `nightaudit.prove.mjs` | `pnpm prove:nightaudit` | NIGHT MODE, MEASURED — the reader, the PDF viewer, the references panel, and the back chip. |
| `opfs.prove.mjs` | `pnpm prove:opfs` | DOES THE BREAK-TABLE OPFS LAYER SURVIVE A REAL RELOAD? (2026-07-17) |
| `pagcheck.prove.mjs` | `pnpm prove:pagcheck` | SCOPED == FULL, on citation prose, with the NodeView collapse in place. |
| `panecontent.prove.mjs` | `pnpm prove:panecontent` | WHAT DOES THE /snapshot DOC PANE ACTUALLY RENDER? |
| `panerect.mjs` | manual | DIAGNOSTIC + GATE: what LINES does the /snapshot pane's own collector see inside a container? |
| `panezoom.prove.mjs` | `pnpm prove:panezoom` | DOES THE /snapshot DOC PANE'S FIT-CAPPED CSS `zoom` MOVE THE PAGE BREAKS? |
| `parsecost.prove.mjs` | `pnpm prove:parsecost` | THE PARSE INCREMENT — the cost /snapshot's sweep adds that no existing number covers (2026-07-17). |
| `pdffixture.mjs` | manual | A DETERMINISTIC MULTI-PAGE PDF, BUILT BY HAND. |
| `pdfreader.prove.mjs` | `pnpm prove:pdfreader` | THE PDF READER VIEW, DRIVEN IN A REAL BROWSER FOR THE FIRST TIME. |
| `phonetouch.prove.mjs` | `pnpm prove:phonetouch` | THE PHONE AUDIT — every new reader surface, at Peter's own iPhone-8 width, with touch. |
| `probe.mjs` | manual | TEXT-RENDER PROBE — the honest measurement. |
| `reader.prove.mjs` | `pnpm prove:reader` | THE SOURCE READER, DRIVEN END TO END. |
| `readerext.prove.mjs` | `pnpm prove:readerext` | DOES SEARCH WORK WHEN THE EXTENSION IS THE FETCHER? — driven through the REAL reader UI. |
| `readerflow.prove.mjs` | `pnpm prove:readerflow` | THE SOURCE READER, DRIVEN THE WAY PETER DRIVES IT: open it, type a search, follow a result, come |
| `rectdiag.mjs` | manual | DIAGNOSTIC: what LINES does the editor's own collector see inside a list? |
| `reflarrow.prove.mjs` | `pnpm prove:reflarrow` | WHAT RAISES THE ENTRY'S LAST LINE? — a CAUSAL test, not an arithmetic coincidence. |
| `reflchrome.prove.mjs` | `pnpm prove:reflchrome` | CAN THE BACK-REF BOX BE COMPOSED WITHOUT RENDERING IT? — and IS IT A BOX AT ALL? |
| `refldemand.mjs` | manual | WHAT LINE-BOX HEIGHT DOES THE `+` BUTTON ACTUALLY FORCE? |
| `reflharvest.prove.mjs` | `pnpm prove:reflharvest` | DO THE HARVEST SELECTORS SELECT THE ELEMENT THAT CARRIES THE BOX? |
| `reflist.mjs` | manual | What a placeholdered bibliography ACTUALLY looks like, side by side with the editor's own pixels. |
| `reflistcensus.mjs` | manual | WHAT THE RENDERED BIBLIOGRAPHY ACTUALLY IS — asked of the real DOM, before anything is designed. |
| `refltree.mjs` | manual | The refList's real DOM TREE + where its box actually comes from. |
| `rescuearms.prove.mjs` | `pnpm prove:rescuearms` | THE .iw-nightable RESCUE ARMS, COUNTED — which of them still catches anything. |
| `schemaIdentity.prove.mjs` | `pnpm prove:schema` | THE /snapshot SCHEMA SEAM — proved against the LIVE editor, from outside (2026-07-17). |
| `serve.mjs` | manual | SELF-SERVING PROBES — one command, and NO PORT COLLISION (2026-07-17). |
| `snapnight.prove.mjs` | `pnpm prove:snapnight` | THE /snapshot PALETTE, MEASURED IN A REAL BROWSER — every surface, both themes. |
| `snapsweep.prove.mjs` | `pnpm prove:snapsweep` | THE SWEEP, ON THE REAL /snapshot ROUTE (2026-07-17 — closing my own flagged gap). |
| `snapswipe.prove.mjs` | `pnpm prove:snapswipe` | THE SIDEWAYS SWIPE ON /snapshot — the browser must not take it, and the view must still have it. |
| `strutrule.mjs` | manual | DIAGNOSTIC: score the candidate ELIGIBILITY RULE for the mixed-family line-box growth. |
| `table.prove.mjs` | `pnpm prove:table` | BREAK TABLE: size, build cost, and the PORTABILITY claim verified against a known-negative. |
| `tail.prove.mjs` | `pnpm prove:tail` | WHY IS THE LAST PAGE UNREACHABLE BY CONTENT? |
| `topdiag.mjs` | manual | DIAGNOSTIC: the model's LINE TOPS vs the DOM's own, gap-free, over the whole document. |
| `trace.mjs` | manual | Why does the audit consider 6789 a line start on the UNFIXED build? Trace the votes. |
| `typefixtures.mjs` | manual | PER-TYPE FIXTURES — one document per text type Inkwave supports, built to be ABLE to fail. |
| `typematrix.prove.mjs` | `pnpm prove:typematrix` | PETER'S BAR: "perfectly accurate across all text types we currently support — and if not possible |
| `versioncost.attrib.mjs` | manual | WHY DOES ONE WARM build() COST 249ms WHILE storeProof AVERAGES 103ms/version? (2026-07-17) |
| `versioncost.prove.mjs` | `pnpm prove:versioncost` | WHAT DOES A BREAK-TABLE BUILD ACTUALLY COST PER VERSION? (2026-07-17) |
| `warmaudit.diag.mjs` | manual | THROWAWAY DIAGNOSTIC — is the between-notch warm's cached geometry the same as measuring live? |
| `window.prove.mjs` | `pnpm prove:window` | THE CRUX: can a page be laid out EXACTLY without laying out the pages before it? |
| `windowcost.prove.mjs` | `pnpm prove:windowcost` |  |
| `zoom.prove.mjs` | `pnpm prove:zoom` | ZOOM INVARIANCE — verified, not asserted. |
| `zoomcost.prove.mjs` | `pnpm prove:zoomcost` | WHAT DOES ONE ZOOM NOTCH ACTUALLY COST? |

## `scripts/wave-desk/`

| script | run as | what it does |
|---|---|---|
| `adopttrace.mjs` | manual | WHY does the adopt fail? Timestamp each surface's arrival vs the water gate, and watch whether |
| `composited.prove.mjs` | `pnpm prove:composited` | Peter, live on desktop Chrome (2026-07-17): "the opening animation is still css in chrome and |
| `markphase.prove.mjs` | `pnpm prove:markphase` | Peter, desktop, 2026-07-17: "I suspect the problem is with the little short lines as on both FF |

## `scripts/wave-video/`

| script | run as | what it does |
|---|---|---|
| `autoserve.mjs` | manual | SELF-SERVING WAVE PROBES — the wave-video/wave-desk half of `textrender-probe/serve.mjs`. |
| `barrier.prove.mjs` | `pnpm prove:barrier` | Round 2 of Peter's iPhone bug (2026-07-17). The wave video may not touch the DOM before React |
| `generate.mjs` | manual | Renders the REAL app's load water — gradient + drifting wave lines + the STATIC single-band wave |
| `loopgate.prove.mjs` | `pnpm prove:loopgate` | "we have to just have blank white screen until the video comes up and play the video every time" |
| `markskew.prove.mjs` | `pnpm prove:markskew` | "the little short lines… often appear out of sync with the waves") ───────────────────────────── |
| `master.prove.mjs` | `pnpm prove:master` | Peter, live desktop, 2026-07-17: "After I signed in just now the wave background completely went |
| `reveal.prove.mjs` | `pnpm prove:reveal` | Peter's live iPhone-8 bug (2026-07-16): "The video works but it never loads." The video half is |
| `server.mjs` | manual | Fallback-faithful static server for the WAVE VIDEO probes. Same contract as |
| `tilescale.prove.mjs` | `pnpm prove:tilescale` | Peter, live desktop 2026-07-17: "the video resolution and size of the waves does not match that |
| `twoload.prove.mjs` | `pnpm prove:twoload` | Peter, iPhone 8, 2026-07-17: "The first time the video ran, from then on just the CSS." |

