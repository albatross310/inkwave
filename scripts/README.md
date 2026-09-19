# The script toolbox

Every `.mjs` under `scripts/`, what it is for, and how it is run. Generated 2026-09-05 because 19
of them were referenced by nothing at all — not `package.json`, not a doc, not another script.

That is not the same as dead. `fontCertify.crossEngine.mjs` is the WebKit pass
`docs/REFACTOR-QUEUE.md` names as required before the arithmetic engine can graduate;
`create-paypal-plan.mjs` is how the billing plan gets recreated and says *"run it yourself so your
secret never leaves your machine"*. A line-reduction pass came within one command of deleting both.
**Undiscoverable is the problem; an index is the fix.**

**2026-09-16:** 71 one-shot probes (62 ARCHIVE + 9 CONVERT in `docs/PROBE-TRIAGE.md`) were retired to
`docs/archive/probes/`, each with its claim's new home named in that folder's README. They are no
longer indexed here; `zoom.prove.mjs` stayed (the instrument of the open decision 3).

`pnpm <script>` where one is listed. Everything else is `node <path>` and is a deliberate manual
tool — a benchmark, a certification, a screenshot run, or a diagnostic kept beside the probe it
belongs to.

## `scripts/`

| script | run as | what it does |
|---|---|---|
| `arithmeticLayout.prove.mjs` | `pnpm prove:arithmeticlayout` | PROVER for the arithmetic layout engine (src/editor/arithmeticLayout.ts). |
| `create-paypal-plan.mjs` | manual | Create a PayPal subscription PRODUCT + PLAN via the API, since the dashboard UI is hard to find. |
| `email.prove.mjs` | `pnpm prove:email` | EMAIL LAYER LIVE PROBE (2026-07-17) — drives the REAL app in a REAL browser. |
| `ext-release.mjs` | `pnpm ext:release` | Cutting an extension release, as far as a script honestly can. |
| `fetch-fonts.mjs` | manual | Self-host the app's web fonts. Run when the font set changes: |
| `fontCertify.crossEngine.mjs` | manual | CROSS-ENGINE FONT CERTIFICATION (2026-07-16) — Chromium + WebKit. |
| `fontCertify.fetch.mjs` | manual | Fetch the NON-SHIPPED families (the r7/r8 FAILED list + the certified-but-cut list) into a temp |
| `fontCertify.prove.mjs` | `pnpm prove:fontcertify` | ROUND-9 FONT CERTIFICATION — the r7/r8 grid RE-RUN IN THE EDITOR'S REAL CONTEXT (2026-07-16). |
| `fontStrip.verify.mjs` | manual | VERIFY THE REGENERATED BUILD (2026-07-16) — not the artifacts, the actual pipeline output. RECIPE (the retired `fontStrip.prove.mjs`'s claim — stripped faces make raw canvas == DOM on WebKit — is held only by running this): `node scripts/fontStrip.verify.mjs` after `node scripts/fetch-fonts.mjs`; needs WebKit (`scripts/pw-headed.sh`) for the iOS half. |
| `framing.prove.mjs` | `pnpm prove:framing` | DOES THE SCOPED RULE ACTUALLY FIRE? (2026-08-30) |
| `ledger-wiring.prove.mjs` | `pnpm prove:ledgerwiring` | PROVE THE WIRING FIRES — the productivity ledger's capture tap, in the real app. |
| `music.prove.mjs` | `pnpm prove:music` | MUSIC MODULE PROVER (2026-07-17) — drives the REAL built app. |
| `offscreen.mjs` | manual | KEEPING A HEADED BROWSER OFF PETER'S SCREEN, ON macOS. |
| `pdfexport.prove.mjs` | `pnpm prove:pdfexport` | PROVE THE MARKED-UP EXPORT IN A REAL BROWSER — Lane C (Peter: "a three dots button with an export |
| `pdfposthoc.prove.mjs` | `pnpm prove:pdfposthoc` | The PDF reading indicator + the post-hoc manual add — day and night, desktop and phone. |
| `prod-graphs-shots.mjs` | manual | Screenshots of the productivity CHARTS PANEL in DAY and NIGHT, at each report window. |
| `prodreport.prove.mjs` | `pnpm prove:prodreport` | PRODUCTIVITY REPORT PROVER (2026-07-17) — drives the real built app, because a flag-gated |
| `prose-only.mjs` | `pnpm prose-only` | PROVE A CHANGE IS COMMENTS-ONLY. |
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
| `server.mjs` | manual | Fallback-faithful static server for /snapshot probes (NOT vite preview — that serves the |

## `scripts/tabdoc-probe/`

| script | run as | what it does |
|---|---|---|
| `newtab.prove.mjs` | `pnpm prove:newtab` | NEW TAB → BLANK. HARD REFRESH → THE SAME DOCUMENT. TWO TABS → NEVER THE SAME ONE. |
| `repro.mjs` | manual | TAB DOCUMENT IDENTITY — the data-loss reproduction, and the proof of its fix. |
| `unsynced.mjs` | manual | THE UNSYNCED-WORK NOTICE — does the wiring actually fire? |

## `scripts/textrender-probe/`

| script | run as | what it does |
|---|---|---|
| `arith.prove.mjs` | `pnpm prove:arith` | Usage: pnpm build && pnpm prove:arith   (boots its own server on an ephemeral port) |
| `breaks.prove.mjs` | `pnpm prove:breaks` | Usage: pnpm build && pnpm prove:breaks   (boots its own server on an ephemeral port) |
| `contrastWalker.mjs` | manual | THE CONTRAST WALKER — ONE definition, shared by every night-mode probe. |
| `crossdevice.prove.mjs` | `pnpm prove:crossdevice` | CANONICAL PAGINATION IS CROSS-DEVICE — the load-bearing invariant this fix must not break. |
| `fixture.mjs` | manual | SYNTHETIC CITATION-HEAVY FIXTURE — the shape of a real Honours proposal, none of its content. |
| `halvesbisect.prove.mjs` | `pnpm prove:halvesbisect` | WHICH CONTENT KIND MAKES THE TWO HALVES DISAGREE? — the control bisect. |
| `jumpguard.prove.mjs` | `pnpm prove:jump` | DOES THE DOCUMENT MOVE ON ITS OWN? Peter: "the doc keeps jumping down… it doesn't happen straight |
| `midline.prove.mjs` | `pnpm prove:midline` | THE MID-LINE BREAK PROVER — does every LIVE page break land at a true line start? |
| `mountcount.prove.mjs` | `pnpm prove:mount` | EDITOR MOUNTS ONCE — the 2026-07-11 double-mount bug, re-probed for the schema round (2026-07-17). |
| `nightaudit.prove.mjs` | `pnpm prove:nightaudit` | NIGHT MODE, MEASURED — the reader, the PDF viewer, the references panel, and the back chip. |
| `opfs.prove.mjs` | `pnpm prove:opfs` | DOES THE BREAK-TABLE OPFS LAYER SURVIVE A REAL RELOAD? (2026-07-17) |
| `pagcheck.prove.mjs` | `pnpm prove:pagcheck` | SCOPED == FULL, on citation prose, with the NodeView collapse in place. |
| `panezoom.prove.mjs` | `pnpm prove:panezoom` | DOES THE /snapshot DOC PANE'S FIT-CAPPED CSS `zoom` MOVE THE PAGE BREAKS? |
| `pdffixture.mjs` | manual | A DETERMINISTIC MULTI-PAGE PDF, BUILT BY HAND. |
| `pdfreader.prove.mjs` | `pnpm prove:pdfreader` | THE PDF READER VIEW, DRIVEN IN A REAL BROWSER FOR THE FIRST TIME. |
| `phonetouch.prove.mjs` | `pnpm prove:phonetouch` | THE PHONE AUDIT — every new reader surface, at Peter's own iPhone-8 width, with touch. |
| `reader.prove.mjs` | `pnpm prove:reader` | THE SOURCE READER, DRIVEN END TO END. |
| `readerext.prove.mjs` | `pnpm prove:readerext` | DOES SEARCH WORK WHEN THE EXTENSION IS THE FETCHER? — driven through the REAL reader UI. |
| `readerflow.prove.mjs` | `pnpm prove:readerflow` | THE SOURCE READER, DRIVEN THE WAY PETER DRIVES IT: open it, type a search, follow a result, come |
| `schemaIdentity.prove.mjs` | `pnpm prove:schema` | THE /snapshot SCHEMA SEAM — proved against the LIVE editor, from outside (2026-07-17). |
| `serve.mjs` | manual | SELF-SERVING PROBES — one command, and NO PORT COLLISION (2026-07-17). |
| `snapnight.prove.mjs` | `pnpm prove:snapnight` | THE /snapshot PALETTE, MEASURED IN A REAL BROWSER — every surface, both themes. |
| `snapsweep.prove.mjs` | `pnpm prove:snapsweep` | THE SWEEP, ON THE REAL /snapshot ROUTE (2026-07-17 — closing my own flagged gap). |
| `typefixtures.mjs` | manual | PER-TYPE FIXTURES — one document per text type Inkwave supports, built to be ABLE to fail. |
| `typematrix.prove.mjs` | `pnpm prove:typematrix` | PETER'S BAR: "perfectly accurate across all text types we currently support — and if not possible |
| `zoom.prove.mjs` | `pnpm prove:zoom` | ZOOM INVARIANCE — verified, not asserted. |

## `scripts/wave-desk/`

| script | run as | what it does |
|---|---|---|
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

