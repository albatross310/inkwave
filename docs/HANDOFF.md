# Handoff — Inkwave refactor programme

Written 2026-09-05 for whoever resumes this (Codex / GPT Pro / a later Fable pass). Everything below
is either landed on `master` or a finding with a file:line you can check yourself. **Nothing here is
an estimate.**

---

## 1. Where things stand

`origin/master` is green: `pnpm typecheck && pnpm test && pnpm build` all pass, `pnpm prove:breaks`
prints byte-identical break positions, every browser probe that can run here passes.

**Landed this session**

| | |
|---|---|
| `docs/RULES.md` | Nine rule patterns (R1–R9), a standard comment form, a length budget. **Cite these by number** — it is what makes duplicates visible. |
| `docs/REFACTOR-QUEUE.md` | Five large refactors with evidence and risk. Still current; §4 below supersedes its ordering. |
| `docs/archive/` (7 files, ~7,700 lines) | Narrative moved out of source. Guarded by `src/audit/archivePointers.test.ts` — 215 pointers, 0 dangling, mutation-proved. |
| `scripts/README.md` | Index of all 142 scripts: which 77 have a `pnpm` command, which 65 are manual tools. |
| `scripts/prose-only.mjs` (`pnpm prose-only <rev>`) | Proves a change is comments-only by stripping comments and comparing code. **Caught three real code slips** the gate would have shipped. |
| Narrative→archive pass | `src/` 80,632 → 76,469 raw (−4,163, 5.2%); code 51,833 → 51,789. 51 files, all verified code-identical. |
| A live bug fixed | `unreflectedRows` let post-hoc rows into the reflection prompt, so 45 *remembered* minutes could open a panel saying "45 focused minutes. What was that, while you remember?" |

**Two instruments you must know about, both measured**

1. **`pnpm build` is NOT deterministic** — two builds of an unchanged tree differ in **14 chunks**.
   Never diff bundles to prove a change is behaviour-free. Use `pnpm prose-only` (comments) or the
   suite + the relevant `pnpm prove:*` (code).
2. **Playwright's headless Chromium does not load extensions here** — measured across three modes
   with a canary rule that stayed silent. Extension probes must be headed, and
   `--window-position=-32000,-32000` **does not work on macOS** (it is the Linux trick; macOS clamps
   the window onto a visible display). Use `hideBrowser()` from `scripts/offscreen.mjs`, which hides
   the process and *returns whether it took*.

**Working discipline that is not optional here**

- The main checkout `/Users/a/inkwave` is SHARED and currently sits on `feat/gmail-send` (another
  lane, 44 commits ahead of master) with that lane's files dirty. `git status -sb` before anything;
  merge in a separate worktree.
- Gate with `&&` chained and **nothing between the links** — `set -e` is silently ignored by this
  shell, and `cmd > log 2>&1; echo "EXIT=$?"` reports the echo's status. Both have shipped broken
  commits here.

---

## 2. The findings, ranked by value-per-risk

Four parallel reviews completed (duplication/editor, layering/guards, CSS↔TS, reader/PDF/music).
Every line reference below came from one of them and is checkable.

### TIER A — bugs on the page, small fixes

**A1. `--iw-reader-shadow` has no night value — a CSS parse defect.**
`src/styles/index.css:1914` sits **outside any rule block** (the `:root[data-theme="night"]` block
closes at 1913). Verified with PostCSS: it parses with `parent === Root`, so browsers drop it. The
night reader keeps the day `rgba(0,0,0,0.16)` — exactly the failure its own comment describes.
Consumers: `SourceBrowser.tsx:1409,1456,1468,2002`. `readerContrast.test.ts` misses it because the
token *is* declared, at 1881. **One-line fix; add a "declared inside a rule" check.**

**A2. Printed sticky notes are the wrong colour.** `pdfAnnotatedPages.ts:249` uses bare `#2a2a2a`
while `PdfViewer.tsx:67`, `PdfReaderView.tsx:44` and `SourceBrowser.tsx:64` all use
`var(--iw-reader-on-mark, #2c2a28)`. `PdfViewer.tsx:63-66` declares this exact bug closed — the
export path was never swept. R2.

**A3. Two toolbars, one gesture, 2.3× apart.** `useLongPress.ts:8` `HOLD_MS = 175` (used only by
StyleBar); `PdfViewer.tsx:2057` hand-rolls a timeout with the imported constant;
`SourceBrowser.tsx:1967` hand-rolls **`400`**. `useLongPress.ts:1-4` exists specifically to prevent
this. R2.

**A4. `LessonPanel.tsx` runs the type ladder `typeScale.ts` replaced** — 33 Tailwind size classes,
no `typeScale` import, including `text-xs` (12px) and `text-sm` (14px). `typeScale.ts:22-28` claims
every step is ≥16 so "the iOS trap is unreachable by construction". It is simply not applied to this
file — the one used on a student's iPad mid-lesson.

**A5. One highlight, three colours.** The wash rule exists four ways: `PdfViewer.tsx:528`
(0.4 multiply), `pdfAnnotatedPages.ts:202` (0.4 multiply), `index.css:1096` (55% day / 100% night
token), `SourceBrowser.tsx:189` (full strength, no wash). `PdfReaderView.tsx:60-67` removed *one*
copy and left the others.

### TIER B — a guard that cannot fail, on the most load-bearing invariant

**B1. `CANONICAL_FONT_SIZE`'s only test is a tautology.**
`canonicalMeasure.test.ts:32` asserts `editor.props.get('font-size') === CANONICAL_FONT_SIZE` — the
constant against itself. It never reads `index.css`. The value is written in **four** places:
`canonicalMeasure.ts:14` (`1.125rem`), `index.css:1148`, `index.css:831` (phone ×1.25),
`index.css:1509` (print). Change the CSS base font and **every canonical break in every document
moves** while the measurement forces the old size — suite fully green.

The fix pattern already exists in this repo: `prodType.test.ts:213-231` reads `index.css`, extracts
the floor, and asserts it against a TS constant. Copy that.

**B2. Same shape, lower stakes.** `pageGap.ts:10 PHONE_SHEET_RADIUS = 28` ↔ `index.css:820`
`border-radius: 28px` (comment says "must match", nothing checks). Wave constants `140px` / `1.944s`
are written on both sides *and a third time in two probes* — `Scroll.tsx:97`, `waveTwinkle.ts:43,46`,
`index.css:305-306,323,…`, `markphase.prove.mjs:42-43`, `markskew.prove.mjs:39`. Coast duration
`10.5s`/`10s` likewise: `Scroll.tsx:99` computes `D = T + COAST_HOLD_MS/1000`, `index.css:349,360,
626,630` hard-code the result.

**B3. Print CSS freezes a derived constant.** `index.css:1453,1573,1466` say `64px`, which is
`pageSettings.MARGIN_BOTTOM(72) − 8`. `printPageStyle.ts:69` computes it. For a `scroll`-paper
document `printPageStyle` removes its tag entirely (`:50`), so the frozen 64 is the ONLY rule.

### TIER C — the three break-rule copies, now with a decision matrix

`docs/REFACTOR-QUEUE.md#1` said this was the top item. It still is, and a full 22-row matrix now
exists comparing `PaginationExtension.computeBreaks:440-519` (P), `arithmeticLayout.paginate:589-636`
(A) and `staticPagination.computeBreakPicks:220-244` (S). **The reviewer's ranked findings:**

1. **S has NO reference-list force-break.** P `478-485` and A `611-616` have it; `grep refList
   staticPagination.ts` → 0 hits. **Any /snapshot document with a bibliography pages differently
   from the editor.** `breakRuleParity.test.ts` passes `refListPos = -1` everywhere (`65,88,93`) and
   structurally cannot see it.
2. **`arithmeticLayout.ts:620` still contains the retired widow/orphan rule**, reachable via
   `snapOrphans` — the only copy where it still exists. And `pagination-rounds.md:596`'s claim that
   "nothing in production calls `paginate()`" is **now false**: `textRender.ts:668` does.
3. **`arithmeticLayout.ts:485-486` carries a FALSE parity claim** — it asserts per-line pseudo-block
   treatment for atoms that its own splitter (`585`, `589-636`) cannot perform.
4. **Two "is the layout canonical?" predicates that read different DOM nodes.**
   `PaginationExtension.canonicalIsLive:539-548` reads inline style on the *surface*;
   `textRenderProbe.renderingIsCanonical:315` reads `getComputedStyle(documentElement)`. So a
   magnified editor can have one say canonical and the other not. **Both bypass `magnify.getMagnify()`
   against `magnify.ts:19-20`'s explicit prohibition.**

### TIER D — a module duplicated whole

**D1. `PdfSidePanel.tsx` is a complete second copy of `dockLayout.ts`** and imports nothing from it.
Nine rules re-implemented (min sizes, storage keys, phone dock height *character-for-character*, the
wide breakpoint twice, orientation, room vars, panel position, handle position, resize clamp). The
divider string `1px solid var(--iw-reader-divider, #cfc7dc)` is re-typed **six times** at
`PdfSidePanel.tsx:257(×2),260,263,264,265`.

`dockResize` **already diverges**: the copy clamps to `window.innerWidth - 80`, the canonical has no
upper clamp. And `dockLayout.ts:5-7` asserts "BOTH the PDF viewer and the source reader read from
it" — the actual geometry consumer is `SourceBrowser.tsx` alone.

**D2. Two live hand-rolled `computeTextFit` copies**, both missing `reservedRight`:
`PdfViewer.tsx:902-916` (initial load — already documented as broken at `pdfGeometry.ts:146-151`,
deliberately not fixed because it changes first paint) and `PdfViewer.tsx:2118-2120` (the rotate
button, **undocumented, and it drops the text-fit branch entirely** so rotating falls back to
page-flush).

**D3. A forbidden `atob` loop on the page side.** `pageSource.ts:269-271` hand-rolls the base64
decode that `extensionProtocol.ts:127-128`, `fetchRules.ts:99` and `reader-panels.md:1007` each
forbid by name ("a 20M-iteration main-thread stall the last time somebody wrote one"). Two more at
`verify/ots.ts:58-62` and `provenance/receipts.ts:64`.

### TIER E — effect lifetimes (the R7 family)

The incident that bit three times in one evening is **fixed and documented** in
`SourceBrowser.tsx:775-788` (install and teardown are two effects with different deps, on purpose).
Residual and new:

1. **`SourceBrowser.tsx:638-646` — the same shape, still live.** The cleanup zeroes the editor's dock
   room and **consumes `handingOverRef.current`**, but deps are `[orientation, dockSide, width,
   height]` and `width`/`height` change on **every pointermove frame** of a resize. Any commit
   between the hand-over flag being set (`:972`) and unmount silently eats it — the editor snaps
   wide for a frame, the exact thing the flag prevents.
2. **`PdfSidePanel.tsx:224-239` — same, with no guard at all.**
3. **`ThesaurusPopover.tsx:379-429`** — a capture-phase **window** keydown listener with `cycle` in
   its deps, and `cycle` is a fresh object *per animation frame*. The global handler is removed and
   re-added ~60×/s during a reel spin; anything dispatched in the gap is dropped.
4. **`SnapshotView.tsx:2593-2640`** — a multi-await read-modify-write loop over the snapshot archive
   whose only cancellation is checked *before* the write, never after. Toggle the AI summaries off
   and on quickly and two loops interleave writes to the provenance record.

### TIER F — structure (see `docs/REFACTOR-QUEUE.md#3` for the principle)

A full structural survey exists for four files. Verdicts:

- **`Scroll.tsx` (1,599) — four genuine seams**, and one of them is a module hiding in a component:
  the load-wave choreography already owns module globals (`loadCoast`, `driftSurfaces`, `watchdogT`)
  and a module-level window listener, and its correctness is *cross-instance*. The `phone && covered`
  special cases exist only because instance-scoped effects drive global state.
- **`CitationPanel.tsx` (1,126) — six seams**, and it is the worst layering offender in the repo:
  34 bare hex literals, 8 direct `localStorage` sites, 3 network modules called from handlers, and
  it hand-builds the browser-extension message envelope (`736-747`) while `extensionChannel` exists.
- **`ClockMenu.tsx` (1,055) — three seams, and its own header already predicts the split**
  (Goals/Reporting/Progress are external modules; Work and Projects are inline).
- **`waveTwinkle.ts` (1,281) — ONE coherent job. Do not split it.** Its size is the price of the
  "nothing runs per frame" contract, which is a measured property.

**`daySummary` (queue item 2) — verdict reversed.** An earlier lane declined to merge it on a
rounding argument. On closer reading the four quantities it needs are *exactly* what `dayAggregate`
computes from the *same* `splitByEntry`, with the same reduces; the only real difference is
`Math.round` vs `round1`, and `dayAggregate` is already the per-day function. **The correct shape is
`daySummary(dayAggregate(today, rows))`** — a pure formatter over the aggregate. Only the prose (the
three-band `shape`, the words clause, the zero-row branches) is legitimately local.

---

## 3. Blockers you must respect

- **`recoverAndPurge` stays in `TiptapEditor.tsx`.** It deleted 79 Bitcoin-anchored snapshots to 4 on
  Peter's real thesis.
- **Path-keyed guards: there are 43, not 23.** 22 name a specific production file, 12 walk a tree,
  9 are scripts. `src/editor/arithmeticLayout.ts` alone is read by **seven** scripts. Splitting
  `SourceBrowser.tsx` breaks **four** guards; `SnapshotView.tsx` breaks two including
  `noAutoDelete.test.ts`'s hardcoded ALLOWED set. Re-point AND **re-prove each fires** in the same
  commit.
- **The colour ratchet caps an unknown file at ZERO** (`colourScan.test.ts:117-120`, `CAPS[f] ?? 0`).
  Current caps: CitationPanel 39 · PdfViewer 38 · SourceBrowser 28 · TiptapEditor 16 · SnapshotView 7
  · ClockMenu 4 · Scroll 3, and the per-file caps sum exactly to the 638 total — **zero headroom
  anywhere**. Any split needs a re-baseline; `UPDATE_COLOUR_BASELINE=1` refuses to raise a cap
  without `ALLOW_RAISE=1`.
- **The toolbar contract is not the only way in.** `IMPLEMENTED_SLOTS` does not exist (docs are
  stale; the live equivalents are `SLOT_LIVE`/`slotIsLive`/`livePopulation`). Three real footer
  buttons bypass it (`TiptapEditor.tsx:3251,3273,3287`), and `renderSlotButton:2774-2846` is a
  **second source of truth** — a chain of ten `id === 'x'` tests not derived from `ALL_SLOTS`, with
  no exhaustiveness check. Add a slot and forget the render arm and you get a live, draggable,
  hotkeyed circle that renders nothing.
- **Characterization tests BEFORE any move** (R6). The worked example is `bestGrid`: an agent
  asserted a guarantee the function does not make and would have "fixed" correct code to match.

---

## 4. Suggested order

1. **A1–A5** — five small fixes, each independently revertible, each a thing a writer can see.
2. **B1** — give `CANONICAL_FONT_SIZE` a real guard that reads `index.css`. Cheap, and it protects
   the invariant everything else rests on. Then B2, B3.
3. **C1** — give `staticPagination` the reference-list force-break, and extend
   `breakRuleParity.test.ts` to a fixture with `refListPos >= 0`. This is a correctness bug in
   /snapshot today.
4. **C2/C3** — delete `snapOrphans` (makes the drift unrepresentable), correct the false atom claim,
   update the stale archive line about `paginate()` having no production caller.
5. **D1** — point `PdfSidePanel` at `dockLayout`. Highest volume, lowest risk.
6. **D2, D3, E1–E4** — as capacity allows.
7. **F / queue items 1 and 3** — the structural work, last, and only with characterization tests
   first. Expect it to *add* lines.

Do not chase a line-count target. The narrative pass reached 5.2% of `src/` and the remaining prose
is per-field docs and rules-with-consequences — cutting those makes the core harder to read, which
is the opposite of the goal.
