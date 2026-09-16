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

**DONE 2026-09-16 (branch `claude/refactor-probe-archive`; census in `docs/PROBE-TRIAGE.md`, PR #6 —
that table is the PRE-MOVE census and was not edited).** Peter's condition was met in the order the
triage proposed, one commit per step so the history shows guards landing before deletions:

1. `23cbdf9` — the four header-only findings recorded (numbers, not prose) at
   `pagination-rounds.md#render-provers`, `#fontfallback-refuted`, `snapshot-scrub-rounds.md#tr-refchrome`,
   `panels-and-popovers.md#rescue-arms-count` (the last from a fresh `prove:rescuearms` run).
2. `13de59c` — 8 unit-test files / 47 tests / ~0.5s, the 9 CONVERT rows + the scrub-constants pin;
   15 mutants applied to the guarded code, 15 die.
3. `ff0e9e4` — **71 files / 7,869 lines moved** to `docs/archive/probes/<original subpath>` (the
   triage's 63 / 7,019 ARCHIVE minus `zoom.prove.mjs`, plus the 9 CONVERT sources); 32 `prove:*`
   entries removed (49 remain); the void baseline 25 → 12; the runnability census floor 60 → 40 (the
   one assertion changed, stated in the commit; every other assertion untouched).

**Reclassified, with reason:** `textrender-probe/zoom.prove.mjs` ARCHIVE → stays. It is the named
instrument of decision 3 (live breaks vs the break table at zoom≠1 after `8f5ae9d`) and the only thing
that prints the divergence Peter has to rule on. It remains mute (exit 0) and on the void baseline.

**The 11 unguarded claims — each with its guard or its stated acceptance:**

| # | claim | guard now |
|---:|---|---|
| 1 | arith render pass: forced-gap line count 18/18, phone-size wrap parity, LayoutUnit + hyphen fixes | RECORDED `pagination-rounds.md#render-provers`. No unit guard: the engine is parked (`?arithLayout`) and both provers read a fixture derived from Peter's proposal, outside the repo |
| 2 | back-ref chrome: single-line groups compose to 0.055px (TRUE); multi-line groups not composable (FALSE) | RECORDED `snapshot-scrub-rounds.md#tr-refchrome`; selectors guarded by `blockStyles.harvest.test.tsx` |
| 3 | the certified-font Δ76 was not a font-loading problem | RECORDED `pagination-rounds.md#fontfallback-refuted` (cause: the mixed-family strut, already recorded beside it) |
| 4 | which `.iw-nightable` rescue arms still match | RECORDED `panels-and-popovers.md#rescue-arms-count` (0/0 for the `[style*=…]` arms; 11/42/27/17 for the class arms); tokens held by `readerContrast.test.ts` |
| 5 | registration judged by DRIFT IN PX on the real /snapshot pane | ACCEPTED, because the rule is unit-held (`snapshotAnchor.test.ts`) and the drift is a real-pane measurement no unit test can take; `snapsweep.prove.mjs` (KEEP) is the runnable neighbour if a drift cell is ever re-homed |
| 6 | thumbnails hydrate from OPFS after a presenter dispose; the `realOpfsShim` string-slice | ACCEPTED, because no KEEP probe evals the shim (only its scrub-probe siblings, which moved with it, so the slices still resolve in the archive); the key contract is held by `snapThumbs.test.ts`; hydrate-after-dispose stays unmeasured |
| 7 | `MAX_PER_FRAME=1`, `LAND_QUIET_MS=260`, `FREEZE_HOLD=400`, `RASTER_DPR_CAP=1`, the wheel-debt reversal | `src/routes/snapshotScrubDriver.test.ts` — declaration statements pinned (code, comments stripped); the real `onWheel` debt block executed: cell A reproduces, cell B fixed, trackpad safe. 5 mutants die |
| 8 | live breaks vs the break table at zoom≠1 | `zoom.prove.mjs` KEPT (see above); table invariance held by `breakTable.test.ts`; the live/table relationship is decision 3, Peter's |
| 9 | the on-device `?btDebug` script can go red | ACCEPTED, because it is a manual on-device instrument for the iOS OPFS branch CI cannot reach; minor |
| 10 | images inside the reader's live iframe load; our CSP is not involved | ACCEPTED, because TASKS D5 is still open and the probe itself said it did not reproduce Peter's case — a guard for a symptom nobody has reproduced would be decoration |
| 11 | stripped faces make raw canvas == DOM on WebKit | held by `scripts/fontStrip.verify.mjs` (KEEP, manual); its recipe is now written in `scripts/README.md` |

**KEEP probes re-run after the move (serial, headless, this build):** `breaks` 0 `IDENTICAL BREAKS: true` ·
`schema` 0 PASS · `midline` 0 `0/194` · `crossdevice` 2 VOID · `zoom` 0 (mute; prints the same divergence) ·
`arith` 1 (red by design) · `pdfposthoc` 0 PASS · `toolbar` 1 `36/38` (the same two `reviewLit:false` cells)
— byte-for-byte the verdicts in PR #6's sample-run table. Full gate: typecheck && 267 files / 3,208 tests
&& build, GREEN.

**Unguarded regardless of this decision, unchanged:** the cross-device canonical-pagination invariant
(`crossdevice` VOIDs by design), the music pipeline (`music.prove.mjs` stranded), `sweepBreakTables`
(only `snapsweep.prove.mjs`). Decisions 2 (the `?waveVideo` set) and 3 remain Peter's.

---

## What is NOT on this list, and why

- **Splitting a file purely to get under a line count.** Adds a false boundary and costs lines.
  `waveTwinkle.ts` at 1,281 does one job and should stay one file.
- **Cutting per-field doc comments or blank lines.** Measured: 48% of the comment corpus is
  rule-shaped runs of 1–7 lines. Cutting those makes the core harder to read, which is the opposite
  of the goal.
- **`recoverAndPurge` out of `TiptapEditor.tsx`.** It deleted 79 Bitcoin-anchored snapshots to 4 on
  Peter's real thesis; trading a live diagnostic for tidiness is the wrong direction there.
