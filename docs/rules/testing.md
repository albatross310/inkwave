<!-- Area rules: test and refactor discipline. Read before writing a guard, a probe, or moving code.
Narrative: docs/archive/working-model.md. -->

# Proving things, and refactoring safely

- **A GREEN GATE IS NOT A GUARD.** The probe culture here ESTABLISHES truth and has no mechanism for
  KEEPING it: a `.prove.mjs` that ran once and convinced everyone is indistinguishable, six weeks
  later, from one that never ran — and `pnpm test` says green either way. The measured facts in file
  headers read as guarantees; they are archaeology. Demonstrated: reverting `textRender.ts`'s leaf-atom
  rule (a bug measured in the real app) left the full gate at exit 0, 79 files green, because its only
  guard was a hand-run browser probe.
  **So: for every claim you prove, ask whether a cheap unit-level version can KEEP it true — if it is
  ~90ms and needs no browser, there is no excuse.** Browser probes stay as the in-browser truth and
  catch what unit tests structurally cannot; they are simply not guards.
- **A `.prove.mjs` is truth where it is KEEP and a guard nowhere** (2026-09-16): 71 one-shot probes
  were retired to `docs/archive/probes/` AFTER their claims moved into unit tests or archive anchors
  (`docs/archive/probes/README.md` maps every file → its guard; `docs/REFACTOR-QUEUE.md` §5 has the
  11-claim table). A probe path cited in these docs that no longer exists under `scripts/` resolves
  one level down there. The 17 `scrub-probe/probe*.mjs` files are among them: the scrub constants
  (`MAX_PER_FRAME`, `LAND_QUIET_MS`, `FREEZE_HOLD`, `RASTER_DPR_CAP`) and the wheel-debt reversal are
  pinned by `src/routes/snapshotScrubDriver.test.ts` now, not by any probe.
- **WRITE THE CHARACTERIZATION TEST BEFORE THE MOVE, NOT AFTER.** A test written after a refactor
  encodes what you BELIEVE the code does — and a refactor is exactly when that belief is least
  reliable, because you have just read the code closely enough to feel certain. Written first, against
  the original, the test can contradict you; written second, it agrees with you by construction and
  FREEZES your misunderstanding as the spec.
  Worked example, `src/routes/snapshotLayout.test.ts`: extracting `bestGrid`, the invariant its comment
  implies (every minimap cell inside Peter's 1:2…1:4 band) is FALSE and unachievable — at n=2 in a
  300×800 panel the only splits give 1.33 and 5.33, so the function takes the lesser miss. **The band
  is a target it minimises deviation from, not a promise it makes.** The replacement asserts what is
  true and is strictly stronger: the chosen split is OPTIMAL, checked exhaustively.
- **When a characterization test fails on the ORIGINAL code, that is the test working.** Do not adjust
  it until you can say which of the two — your assertion or the code — is wrong, and why. Most of the
  time it is the assertion.
- **A guard must be proved to FIRE on known-bad input AND to stay silent on an honest control before
  its verdict is read** — "assert the bad phrase is absent" passes trivially on a broken matcher. The
  same applies to a self-check gate: assert it PASSES on a known-good input, or it will silently
  DISABLE the feature it guards.
- **A guard that reads PROSE as CODE attacks its own documentation.** Comments are STRIPPED before
  every source scan in this repo, deliberately: a rule must NAME what it forbids in order to forbid it.
  Judge what the code DOES — an import, a call, a header actually sent.
- **Reviewers: always diff `$(git merge-base HEAD origin/master)..HEAD`.** `master..<branch>` on a
  branch that is BEHIND renders enormous fictional deletions (one lane showed 18,393 deletions for a
  real change of +196/−11 across 3 files).
- Component tests work under vitest (`vite.config.ts` drops the React Router plugin), with
  `afterEach(cleanup)` MANDATORY — see `docs/rules/theming.md` for the two `.tsx` hoisting gotchas.
