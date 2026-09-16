# The bigger-picture refactor queue

Small, independently-revertible changes are done as they are found. This file holds the ones that
are **too big for that** — each needs its own lane, its own proof, and a decision from Peter before
it starts. Written 2026-09-04 while the evidence was fresh, so the next pass does not re-derive it.

Every entry says what the change is, **what evidence already exists**, what could go wrong, and how
you would know it had. Ordered by value-per-risk.

---

## 1. Three copies of the break rule → one

**What.** `PaginationExtension.computeBreaks`, `arithmeticLayout.paginate` and
`staticPagination.computeBreakPicks` each implement the page-break rule.

**Evidence it matters.** CLAUDE.md records a retired widow/orphan rule that was fixed in two of the
three and missed in the third, putting the snapshot pane +2 pages out on plain prose. That is R2
(one definition, not two) with a shipped consequence.

**Risk: the highest in the repo.** Page breaks are CANONICAL — the same text on page N at every
zoom, on phone and in print — and the provenance snapshots' page labels and the print path depend on
them. A refactor that moves one break by a line is a behaviour change on Peter's thesis.

**How you would know.** `pnpm prove:breaks` must print byte-identical positions AND the same
`contentWidth` before and after every commit. `inkwave:pagCheck=1` runs both measure paths and
compares signatures. Compare break POSITIONS, not page counts — equal counts hide divergent offsets.

**Note.** `arithmeticLayout` is parked and does not implement `shouldSnapToBlock`, so it currently
disagrees with the DOM measure on every break (→ `docs/archive/pagination-rounds.md#arith-engine`).
Consolidating may be easier *after* that is resolved, or may be the thing that resolves it.

---

## 2. `daySummary` → `aggregate.ts`

**What.** `ClockMenu.tsx` carries a second implementation of "sum the day's minutes".

**Evidence.** CLAUDE.md: every guard was on `aggregate.ts`, so the drop-up reported 45 *remembered*
minutes to Peter as "focused minutes" with the whole suite green. R2 again, and the consequence was
a number shown to the writer that was not true.

**Risk: low-to-moderate.** The two may genuinely differ in what they must compute — the drop-up is a
day view, `aggregate` serves rollups. If they differ, two honest copies beat a forced merge.

**How you would know.** After consolidating, plant a violation and watch the EXISTING `aggregate`
guards fail on the drop-up's path. If they do not, the consolidation bought nothing.

---

## 3. Split `TiptapEditor.tsx` (3,463 lines) by responsibility

**What.** Save orchestration, the footer toolbar, the zoom handlers and the effect cluster are
genuine seams.

**The test for whether a split is good.** Can you name what each side is responsible for, in one
phrase, without saying "part 1" or "the rest"? *"Save orchestration"* passes. *"TiptapEditor core"*
and *"TiptapEditor effects"* fail — that is a line-count split wearing a responsibility name.

**Risk.** A module boundary is a CLAIM that two things are separable. An arbitrary one is a false
claim, and a false claim is worse than none because the next reader acts on it. Concretely here:
`DocLayer` binds shared refs in a CHILD layout effect because child effects flush before the
parent's — split those across files and the ordering dependency becomes invisible.

**And it costs lines.** Yesterday's four extractions were net **+598**: a header, imports, and the
tests that logic never had. Do not run this expecting a smaller repo.

**How you would know.** Characterization tests written BEFORE the move, against the unmoved code —
`docs/RULES.md` R6, and the `bestGrid` case is the worked example of why after-the-fact tests encode
your belief instead of the behaviour. Plus: every path-keyed guard that scans a moved file
(`touchTargets`, `snapshotPalette`, `readerContrast`, `noAutoDelete`) must be re-pointed AND
re-proved to fire in the same commit.

**LANDED 2026-09-15 — seam 1: toolbar slot customisation** (`src/editor/useToolbarSlots.ts`). One
phrase: *the writer's arrangement of the footer's slot row, and the positional hotkeys that address
it.* TiptapEditor.tsx 3,698 → 3,370 (the heading's 3,463 was already stale when this lane started);
the hook is 407 lines, of which 330 are the moved block byte-for-byte (diffed against the original
line ranges, not eyeballed) and 77 are header, imports, the input/output interfaces and the return.
Net **+79** on the two files and **+598** across `src/editor` with the three test files — the "+598" warning
above held, to the line.
- **Characterization before the move, as R6 demands, in two halves.** `toolbarSlotsWiring.test.ts`
  (8, path-keyed on TiptapEditor.tsx) ran green on the UNMOVED file (8/8, re-proved 2026-09-15 by
  checking master's file back in) and 5 JSX mutants were killed there; it pins the footer JSX's half
  of the seam, which does not move. `useToolbarSlots.test.tsx`
  (28, jsdom) was authored from the unmoved code on the `docTitle.test.ts` precedent and runs
  against the hook; its first cut failed on the ORIGINAL behaviour (it assumed the ledger flag off;
  the flag is default ON wherever a window exists) — the corollary working — and the premise is
  now SET in the test, not assumed. 7 named mutants die (the list is in the test's header); the
  WIP had claimed 10 against a list its commit message never carried, so 7 is the measured number.
- **Rendering TiptapEditor in jsdom was tried and abandoned on evidence**: 8 missing platform
  APIs/contexts across 3 render layers (canvas, Router, matchMedia, ResizeObserver,
  elementFromPoint, indexedDB, navigator.storage) with the 63-effect layer only just begun. R5.
- **Path-keyed guards.** `commitDoc.test.ts` now scans the hook too (measured first: with the
  longhand triple pasted into the hook, the un-re-pointed guard stayed 4/4 green). `touchTargets`
  and `toolbarOutline` read JSX/guard text that did not move — verified green, not re-pointed.
  `noAutoDelete.test.ts` WALKS all of `src/`, so the hook is in its scope with no re-point (a planted
  `deleteSnapshot` in the hook turns it red); `cloudLocalRead.test.ts` names TiptapEditor.tsx only in
  prose and reads no file.
  `chunk.test.ts` was never a source guard on TiptapEditor.tsx: its walker starts at
  `app/routes/home.tsx` and stops at Edit.tsx's `import()` (a music value import in the hook
  leaves it 15/15 green, as it would have in TiptapEditor.tsx); its built-assets guard covers the
  hook because it bundles into the same chunk.
- **Effect order (R7):** the hook is called at the block's exact position; the 14 lines it skips
  over (the lifted ledger/graphs/opps state, "a slot is a trigger, never an owner") declare no
  effects, so the three moved effects keep their place in the sequence.
- **Still here:** save orchestration, the zoom handlers, the effect cluster — and `recoverAndPurge`
  stays regardless (below). Save orchestration was NOT attempted this lane: it threads through
  `commitDoc`, the OneDrive throttle, the folder mirror, the heartbeat and the unsynced notice, and
  one evening's proof budget was spent on seam 1.

**LANDED 2026-09-15 — seam 2: cloud sync + writer-held files** (`src/editor/useCloudSync.ts`). One
phrase: *the document's writer-held destinations — a granted folder, OneDrive, Google Drive —
connecting them, mirroring the record to them, and the state the sync pill reports.* This is THE
DATA-LOSS FAMILY's code (CLAUDE.md), so the move was held to "verbatim or nothing".
TiptapEditor.tsx 3,370 → 2,940; the hook is 570 lines, of which 446 are the moved lines byte-for-byte
(the diff of the deleted non-import lines against the extraction is EMPTY; one edit, the heartbeat's
`[doc.id]` → `[docId]`) and 124 are header, imports, the two interfaces and the return. Effects 61 →
55 + 6. Net **+140** on the two files, **+1,218** across `src/editor` with the two test files.
- **The map, before deciding the boundary:** 20 state/ref declarations, 24 functions and 6 effects
  MOVE; the tab-title effect, the `syncActive` derivation + the unsynced notice's wiring (a CONSUMER
  that reads four flags), `saveRecord`, the four `mirrorIfActive()` provenance checkpoints and all
  the JSX (pill, banner, pickers, openers, phone ☁, ⋮ menu) STAY and read the hook's return; ONE
  two-way coupling — `ensureDocFresh` (stays) clears `lastFileSave`/`lastSync`/`lastGdriveSync`, so
  those three setters are exposed rather than hidden. Inputs: `docRef`, `docId`, `ensureDocFresh`,
  `snapshotsForAction` (the R1 archive-read guard every PUBLISHING action shares — not sync-specific,
  so it stays), `runWhenQuiet`.
- **What did NOT move, and why:** `fetchCloudBytes` + the two cloud openers DID move (they adopt the
  opened file as the sync target and own the opener state); print/export (`printDoc`, `exportPdf`,
  `exportLatex`, `exportEquations`) sat physically INSIDE the block and stayed — they are not
  destinations. `snapshotsForAction`, `ensureDocFresh`, `exportBundle`, `commitDoc`, `saveDocument`,
  `recoverAndPurge` untouched.
- **Characterization before the move, R6, in two halves.** `cloudSyncWiring.test.ts` (12, path-keyed
  on TiptapEditor.tsx) ran green on the UNMOVED file first — its writer-count assertion FAILED on the
  original (it assumed 8 call sites; the file had 10), the corollary working, and the measured
  number is the one it carries. `useCloudSync.test.tsx` (37, jsdom, the storage layer mocked at the
  module boundary) was written from the unmoved code and run against the BYTE-IDENTICAL extraction
  while TiptapEditor.tsx was still untouched (commit `e3deb8b` has the hook + tests and no editor
  change). 10 mutants, 10 die — the list is in the test's header; the three that matter are the
  three "archive unreadable ⇒ no write" refusals (OneDrive / Drive / folder), each a named test.
- **Effect order (R7) — the one place this seam differs from seam 1.** The block was NOT contiguous:
  its state stood at L252–296 (read by the tab-title effect at L272 and the unsynced notice at L376)
  and its functions/effects at L1966–2417. A hook is called at ONE position, so it is called where
  the STATE stood and its six effects moved from sequence positions 55–60 to 5–10. Proved free by
  inspection of each effect's synchronous acts: two resolve promises (Drive/OneDrive resume), one
  `void linkSaveFileNow()` + a listener on `inkwave:save-file-linked` (its ONLY listener), two
  `runWhenQuiet` timers, and the heartbeat's `setOtherDevice(false); setConflictDismissed(false)`
  + a `void check()` whose ref reads see refs nothing sets synchronously in ANY effect. No effect in
  positions 5–54 reads a value one of the six sets synchronously. The alternative — calling the hook
  at L1966 — would have required moving the tab-title effect and the four unsynced-notice effects
  later, which is a reorder of NON-sync effects, or a two-hook line-count split.
- **Path-keyed guards.** `commitDoc.test.ts` now scans this hook too (measured FIRST: with the
  longhand triple planted in useCloudSync.ts the un-re-pointed guard stayed 4/4 green; re-pointed,
  it fails). `noAutoDelete.test.ts` walks `src/` — a planted `deleteSnapshot` in the hook turns it
  red with no re-point. `touchTargets` (`[data-iw-selectable]`) and `toolbarOutline` (the reconnect
  pill's JSX) read text that did not move — verified green, not re-pointed. `cloudLocalRead.test.ts`
  reads no file; its prose named TiptapEditor.tsx as the guard's home and now names the hook.
- **In-browser:** the editor mounts, typing works and the sync pill renders on the branch build;
  `scripts/tabdoc-probe/unsynced.mjs` (the notice's wiring, which READS the hook's flags) run on the
  branch and on unmoved `83d0d93` in the same container — see the lane report for the cells.
  NOT verifiable headless: OneDrive/Drive sign-in (needs a real account) and a Chromium folder grant
  (needs a real gesture) — the same two gaps `cloudWriteback.test.ts` states.
- **Still here:** the zoom handlers, the effect cluster, `recoverAndPurge` (stays regardless).

---

## 4. Dead exports

~89 flagged by `ts-prune`, perhaps 50 real. Being done incrementally as a small-change lane. Route
exports, `_reset*` hooks and `extension-src/utils/constants.ts` are legitimate; the failure mode is a
string-keyed dynamic lookup `ts-prune` cannot see.

---

## 5. Probe scripts — 23,472 lines, 92 files

**What.** Many proved a fact once. CLAUDE.md's own rule is that *a proof that ran once is
indistinguishable from one that never ran* — archaeology, not a guard.

**The candidate.** Retire the one-shot probes into `docs/archive/` with their findings, keep the ones
that guard a live invariant. This is the single largest honest line reduction available anywhere in
the repo, and it touches no production code.

**Risk: low, but easy to get wrong in one direction.** A probe that looks one-shot may be the only
thing holding a rule no unit test can reach. The rot audit found 11 rotten checks and 34 probes that
could not run at all — triage first, retire second.

---

## What is NOT on this list, and why

- **Splitting a file purely to get under a line count.** Adds a false boundary and costs lines.
  `waveTwinkle.ts` at 1,281 does one job and should stay one file.
- **Cutting per-field doc comments or blank lines.** Measured: 48% of the comment corpus is
  rule-shaped runs of 1–7 lines. Cutting those makes the core harder to read, which is the opposite
  of the goal.
- **`recoverAndPurge` out of `TiptapEditor.tsx`.** It deleted 79 Bitcoin-anchored snapshots to 4 on
  Peter's real thesis; trading a live diagnostic for tidiness is the wrong direction there.
