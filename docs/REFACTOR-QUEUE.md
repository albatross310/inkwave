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

---

## What is NOT on this list, and why

- **Splitting a file purely to get under a line count.** Adds a false boundary and costs lines.
  `waveTwinkle.ts` at 1,281 does one job and should stay one file.
- **Cutting per-field doc comments or blank lines.** Measured: 48% of the comment corpus is
  rule-shaped runs of 1–7 lines. Cutting those makes the core harder to read, which is the opposite
  of the goal.
- **`recoverAndPurge` out of `TiptapEditor.tsx`.** It deleted 79 Bitcoin-anchored snapshots to 4 on
  Peter's real thesis; trading a live diagnostic for tidiness is the wrong direction there.
