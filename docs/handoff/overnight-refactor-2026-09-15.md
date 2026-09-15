# Overnight refactor run — hand-off (2026-09-15, written by the cloud session at the rate-limit halt)

Peter's ask: work through `docs/REFACTOR-QUEUE.md` items 1–3 (then 5 as a report, then the next
three), each as its own lane, each ending in a DRAFT PR; one consolidated report at breakfast plus
ONE PushNotification headline. Then, after four lanes at extra effort burned the 5-hour window in
under an hour: **"make a way of only working to eighty percent."**

## PACING RULES (the reason this file exists)

- **Max 2 lanes at once.** Four lanes × extra effort ≈ 380k tokens each per ~25 min = 1.5M tokens in
  under an hour = the whole 5-hour window. Two lanes is the ceiling until Peter calibrates.
- **Read the rate-limit status before launching anything**: `get_session` (Claude_Code_Remote MCP)
  → `external_metadata.rate_limit_info.status`. `allowed` → may launch. `allowed_warning` → launch
  NOTHING new; let running lanes finish; wait for `resetsAt`. `rejected` → everything is stalled
  until `resetsAt`; re-arm a check-in for just after it. There is no percentage exposed here — the
  percentage is on Peter's Usage page; when he gives a number, set the lane count from it.
- Hourly check-in (`send_later`, 60 min): read status, resume stalled lanes via SendMessage on their
  EXISTING transcript (never a fresh agent for the same lane — a user-stopped agent cannot be
  resumed, a rate-limited one can), open draft PRs for finished lanes, launch the next lane only if
  status is `allowed` and fewer than 2 are running.
- Effort: lanes inherit the session's effort. Peter chose extra for this work; the pacing lever is
  lane COUNT, not effort.

## STATE AT HALT

| lane | item | branch | state |
|---|---|---|---|
| A breakrule | queue 1 | `claude/refactor-breakrule` | nothing written (died at start, twice) |
| B daysummary | queue 2 | `claude/refactor-daysummary` | WIP `a5a8a39` — 4 files, 145+/27−, NOT gated |
| C editorsplit | queue 3 | `claude/refactor-editorsplit` | WIP `f85868d` — 8 files, 995+/344−, NOT gated; ~25 min of work incl. characterization tests |
| D probetriage | queue 5 | `claude/refactor-probetriage` | DONE `b93e8ee` → draft PR #6 (report only) |
| E jcs | perf report 6 | `claude/refactor-jcs` | nothing written |
| F api-handler | perf report 9 | — | not started |
| G cloud-sync | perf report 5 / queue 3 seam 2 | — | not started; branch FROM C's branch, only after C's final SHA |

WIP commits are notes, not code to keep: re-read them, keep what the characterization-first rule
allows, re-derive anything unproved.

Also known: PR #5 (toolbar side-reserve) merged today at `ea349cc`; the local Mac session follows a
branch via `scripts/follow-branch.sh` and reports back with `claude -p --cloud <session_id>` — give
Peter the NEW session id so he can re-point it; `LOCAL: <request>` empty commits on the followed
branch reach it in ~10s. Lane D installed Playwright chromium-1223 into /opt/pw-browsers (the image
ships 1194; @playwright/test 1.60 wants 1223) — a fresh container may need that again.

## LANE RULES (every lane)

Own worktree: `git worktree add --detach /home/user/wt-<name> origin/master` (or origin/<its
branch> where a WIP exists) → `git checkout -b claude/refactor-<name>` (or checkout the existing
branch) → `pnpm install --frozen-lockfile`. Own ONLY the files its brief names. Characterization
tests BEFORE the move, against the unmoved code (CLAUDE.md, docs/RULES.md R6). Gate as ONE chain:
`pnpm typecheck >/dev/null 2>&1 && pnpm exec vitest run >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 && echo GREEN`.
`git status -sb` before every commit; named `git add` paths; `git commit -F <file>` heredoc (no
backticks in -m); commit footer:
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: <the running session's URL>
```
Push its branch; do NOT open a PR (the coordinator does, draft, subscribed). Never bare `git stash`
(shared stack). Ports: A 5181, B 5182, C 5183, D 5184, E 5185, F 5186, G 5187; never 5173. Headless
Chromium at /opt/pw-browsers, proxy CA trusted. Final message starts
`📋 REPORT — <feature in Peter's words> (<LIVE | behind flag>)`, numbers not adjectives, ends with
the final SHA and what it could NOT do.

## BRIEFS

### A — the page breaks (LIVE): three copies of the break rule → one
`PaginationExtension.computeBreaks` (+ `shouldSnapToBlock`, src/editor/extensions/PaginationExtension.ts
~L431-530, production), `staticPagination.computeBreakPicks` (src/editor/staticPagination.ts ~L210-240,
/snapshot pane, live), `arithmeticLayout.paginate` (src/editor/arithmeticLayout.ts ~L571-640, parked
`?arithLayout`, lacks shouldSnapToBlock). Read first: CLAUDE.md "Canonical pagination" + the
`?arithLayout` DO-NOT-GRADUATE entry; queue item 1; docs/archive/pagination-rounds.md#arith-engine;
src/editor/breakRuleParity.test.ts (EXISTS — extend it), paginationSnap.test.ts, staticPagination
tests. Method: (1) extend the parity fixtures so they can tell the rules apart on every shape where
copies could differ (block boundary mid-page, orphan 0/>0, liveIsCanonical, lastBreakAt≠0, atomLike
per-line reset, refList pos, gapped/ungapped, block taller than a page); record production `sig` via
`_computeBreaksForTest`. (2) BEFORE editing: `pnpm build && pnpm prove:breaks` → save output
(the "before"). (3) One pure module (src/editor/breakRule.ts) taking geometry + policy inputs,
returning picks; the three call it; production decos AND sig byte-identical. (4) arith stays parked;
if prove:arith now agrees, report it, flip nothing. (5) Gate, then prove:breaks "after" — IDENTICAL
BREAKS: true, same first-10 positions and contentWidth; prove:pagcheck if it runs. (6) ANY break
moving by a line → STOP and report, push nothing. Update CLAUDE.md's "three copies" text + the queue
entry in the same commit. Don't touch TiptapEditor.tsx / ClockMenu / productivity / scripts.

### B — the clock drop-up's daily summary (LIVE): `daySummary` → `aggregate.ts`
src/components/ClockMenu.tsx `daySummary` (~L156-176, `_daySummaryForTest`) is a second "sum the
day's minutes"; every guard sits on src/productivity/aggregate.ts, which is how 45 remembered minutes
were once shown as focused. Read: CLAUDE.md Productivity section (post-hoc via `isPostHoc()` only;
"a guard on one implementation says nothing about the other"; §A5 tone), queue item 2, ClockMenu.test.tsx,
aggregate.ts (`dayAggregate`, `splitByEntry`), aggregate.test.ts, sessionLogic.ts, spec v0.2 §A5/§A6.1.
Method: characterization of every daySummary branch's exact string FIRST (empty / post-hoc only /
timed / mixed / net + − 0 / plurals / 25 & 90-minute bands); move only the ARITHMETIC onto
aggregate's primitive, prose stays; plant the violation (post-hoc counted as measured) in the shared
primitive and confirm BOTH aggregate's guards AND the drop-up tests go red — if the drop-up stays
green the consolidation bought nothing. If the two genuinely compute different things, STOP and
report "two honest copies". Update CLAUDE.md's daySummary sentence + queue entry. WIP `a5a8a39` exists.

### C — the editor file split (LIVE, zero behaviour change): TiptapEditor.tsx by responsibility
3,698 lines, 63 effects. Queue item 3's test: name each side in ONE phrase or don't split. Seam 1:
toolbar slot customisation (~L124-857: slot state, phone hold-drag reorder, Alt+1…6/Alt+0/Mod+,
hotkeys — the hotkey IS the tap, drag from ▲ onto a slot) → a hook under src/editor/ named for its
responsibility; rules in src/editor/toolbarContract.ts. Seam 2 only if 1 is proved: save
orchestration, `recoverAndPurge` STAYS. Read: CLAUDE.md characterization-before-the-move,
"Typing performance invariants" (`shouldRerenderOnTransaction:false`; render body never reads
editor.state), "Editor mounts ONCE", pagination hard-won bug (a), "Component tests are possible now"
(afterEach(cleanup) mandatory; vi.mock hoisting), toolbar contract/hotkey entries; RULES R6/R7.
Effects run in declaration order — keep the hook call where the block was or prove order is free.
Path-keyed guards that read TiptapEditor.tsx BY PATH must be re-pointed AND re-proved to fire in the
same commit: src/editor/commitDoc.test.ts, src/components/touchTargets.test.ts,
src/styles/toolbarOutline.test.ts, src/music/chunk.test.ts (grep for more). Expect net +lines.
`pnpm prove:toolbar` is load-flaky toward "missing" — run quiet, twice, compare to master. After push:
`LOCAL:` request to the Mac for a visual pass at 296/570/1200 + typing. WIP `f85868d` exists (~25 min
of work — read before redoing).

### E — the provenance signing (LIVE): one JCS canonicaliser for client and server
src/provenance/hash.ts and api/_provenance-core.mjs (~L49-61, "MUST match byte-for-byte") are two
copies held together by a comment; a byte of drift makes every receipt unverifiable. Read: CLAUDE.md
M1/M3/M5 + "what we SIGN with is not what we ACCEPT", M2's note on why api/ is plain .mjs;
src/verify/index.test.ts (6 interop tests run the REAL server core), receipts/session-auth/
multiKeyVerify tests, src/audit/apiFunctionsParse.test.ts, vite.config.ts (dev middleware for api/),
vercel.json. Shape: a dependency-free module importable by BOTH the Vite/TS client (no Node
built-ins; WebCrypto) and Vercel's Node .mjs functions — check how api/ resolves imports at Vercel
build time before choosing the path. Characterization corpus FIRST pinning exact canonical string +
sha256 hex from BOTH implementations (unsorted keys, unicode/surrogates/escapes, -0, 1e21, 0.1,
empty containers) + a known-negative (unsorted serialisation rejected). Keep hash.ts's public API.
Gate + api parse test + build; say what about Vercel deploy could not be verified and the one command
Peter can run.

### F — the api handlers: one wrapper for the 21 api/*.mjs functions
REFACTOR-PERFORMANCE-REPORT.md item 9 (`withHandler()`/`jsonPost()`). Owns api/*.mjs except
_provenance-core.mjs while E runs. Characterize each handler's status codes / error bodies / CORS
headers first (the parse test + any api tests); zero wire change. Coordinate with E if both touch
session.mjs/sign.mjs — F goes after E.

### G — the editor's cloud-sync orchestration out of TiptapEditor.tsx
Perf report item 5 (`useCloudSync`), 37 sync references in TiptapEditor.tsx. Branch FROM
claude/refactor-editorsplit after C's final SHA. CLAUDE.md data-loss family rules apply to every
write path it moves — `oneDriveWriteNow`'s local-read check is load-bearing; the cloud mirrors do not
re-read; grow-only snapshots. Same characterization-first + path-keyed-guard discipline as C.

## MORNING REPORT
One message: per lane — what changed, the proof (numbers), what it could not do, PR link; the three
probe-triage decisions from PR #6; E/F/G status; then ONE PushNotification headline (<200 chars).
