# Inkwave Scroll — CLAUDE.md

A **router plus the universal rules** — only what EVERY session must obey. Subsystem rules live in
`docs/rules/<area>.md`; the reasoning behind them (measurement rounds, refuted hypotheses, incident
forensics, build history) lives in `docs/archive/<area>.md`.

**Read your own row below, and the area file for what you are about to change — nothing else.** What
you read is re-sent on every later turn of your session, so reading an area you are not touching costs
Peter tokens all day. That is the point of the split.

**A rule must keep NAMING what it forbids.** Source scans here strip comments deliberately, so a rule
can name a forbidden API without a guard firing on its own documentation. Never paraphrase an
identifier, header or API into a vague gesture.

## The roster — who we are, and what each of us reads

| Session | Tokens | Role | Reads |
| --- | --- | --- | --- |
| Carrie | carrie, carriec | Inkwave lead, cloud — lanes, merges, PRs, the localhost tabs | this file · `docs/rules/lanes.md` |
| Max | max, maxc | Mac — Safari, localhost, device testing, Peter's prefs | this file · `docs/rules/ios-webkit.md` |
| Nigel | nigel, nigelc | paced refactor queue, cloud | this file · `docs/rules/testing.md` · the area file for the lane in hand |
| Quinn | quinn, quinnc | General lead, Mac | this file |
| Saul | saul, saulc | General, cloud | this file |
| lane agent | — | one subsystem at a time | this file · the area file for that subsystem |
| triage | — | the channel only | this file · `docs/rules/team-channel.md` — **no area file** |

Group tokens: `iw`/`iwc` = Carrie, Max, Nigel · `gen`/`genc` = Quinn, Saul · `locals`/`localsc` = Max,
Quinn · `clouds`/`cloudsc` = Carrie, Saul, Nigel · `all`/`allc` = everyone. Suffix `c` = Claude,
`k` = Kimi, `x` = Codex; bare forms mean everyone online; matching is case-insensitive.

**This table is THE ROSTER. Recruiting a team member is one row here, and every watcher derives its
roster from this table rather than keeping its own list** — a private copy in a regex goes stale
silently, and a new member is then addressable in the docs and invisible to every watcher.

## Area files in `docs/rules/` — secondary lookup, when work crosses into one

`pagination.md` breaks, measures, fonts, `?arithLayout` · `wave.md` water and the load reveal ·
`ios-webkit.md` iPhone/iPad, touch, keyboard, the footer dock · `theming.md` night mode, any new
panel, any colour · `storage-sync.md` OPFS, cloud sync, the open pipeline · `provenance.md`
snapshots, hashing, receipts, `/verify`, SCAS, the word-cycle · `music.md` · `productivity-email.md`
ledger, clock, charts, AI report, email · `reader-pdf.md` PDF viewer, source reader, citations, media
· `snapshot-scrub.md` · `toolbar.md` slots, hotkeys, zoom, chrome · `performance.md` ·
`testing.md` guards, probes, refactors · `lanes.md` · `team-channel.md`. **Touching any write path?**
The data-loss rules below are universal; read them, then `storage-sync.md`.

## What this is

**Inkwave Scroll v0.1**, the free tier: a calm writing environment for short academic/philosophical
writing. Solo dev: Peter (Brisbane). The mechanic is **SCAS** — words in a rotating exclusion set glow
red and can be swapped for thesaurus synonyms, turning friction into an interpretable authorship trace
without surveillance. **Free Scroll tier only**; the paid **Tablet** tier (Clay/Stone states,
weathering, hollow clocks, sentence glyphs) is Phase 2+ and **must not be built here**.

Vite + React 18 + TS + Tailwind 3 + Tiptap (ProseMirror) + OPFS/IndexedDB, React Router v7 framework
mode (`ssr: false`, `/` and `/about` prerendered), Vercel. Package manager is **pnpm**, never npm:
`pnpm dev | build | typecheck | preview | test`. Product docs live outside the repo
(`…/Projects/Inkflow Studio/`); in-repo specs in `docs/specs/` are checkable — **check them, and CITE
THE VERSION** when an anchor is load-bearing. Build history and code map:
`docs/archive/build-progress.md`.

**Peter's prose — thesis, essays, real documents — NEVER enters the repo, fixtures, logs or
screenshots.** Absolute. His product decisions are not that boundary; the specs are committed.

## The gate, git and shipping

- **⚠ `set -e` IS SILENTLY IGNORED BY THE Bash TOOL'S SHELL.** Anything that always succeeds between
  the gate and the push hides the gate — `pnpm test | grep …` (grep exits 0 when it FINDS failures),
  `pnpm typecheck; echo "tc=$?"`, and `set -e` itself. **THE ONE FORM THAT WORKS:**

      pnpm typecheck >/dev/null 2>&1 && pnpm test >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 \
        && git commit … && git push …

  Nothing between the links: no `echo`, no pipe, no `set -e`. Typecheck may carry pre-existing
  TS7016/TS2550 in test files; ALL tests must pass; push = production deploy.
- **BACKTICKS IN `git commit -m` ARE COMMAND SUBSTITUTION** — use `-F <file>` with a heredoc for any
  message containing code identifiers.
- **`/root/dev/iw-master` IS A SHARED CHECKOUT.** 1. **`git status -sb` before every commit or push** —
  never assume the branch. 2. **Add named paths, never `git add -A`** (one `-A` swept 1,276 lines of
  four other lanes' work into an unrelated commit). 3. **Don't `stash` there.** 4. **Ship from your own
  worktree:** `git worktree add --detach /tmp/shipdesk origin/master` → cherry-pick →
  `pnpm install --frozen-lockfile` → gate → `git push origin HEAD:master` (install first, or the fresh
  worktree's gate fails on missing `node_modules` and means nothing).
- **`git reset --soft origin/master` in a worktree will STAGE A REVERT of other lanes' work.** Prefer
  `git rebase origin/master`; if you do reset, read `git status` before you commit.
- **The gate protects master, not your teammates** — it would happily ship a green commit that stole
  four lanes' work. **NAME BRANCHES AFTER THE FOCUS** (`claude/lanes-localhost`), not the harness's
  random name.
- **A GREEN GATE IS NOT A GUARD**, and **the characterization test goes BEFORE the move, not after** —
  writing a guard, a probe or a refactor? Read `docs/rules/testing.md` first. Reviewers: always diff
  `$(git merge-base HEAD origin/master)..HEAD`.

## ⚠ THE DATA-LOSS FAMILY — universal, and the most load-bearing rules here

Six incidents on Peter's real thesis, one shape: **an unknown answered as if it were a known-empty.**
Every rule is that applied to one read, and any write path can be an instance. **These bullets are
deliberately duplicated in `docs/rules/storage-sync.md`** — they bind sessions that never intended to
touch storage (any write path, any effect that takes a lock, any code that opens a document), so "that
area is not mine" is exactly the wrong inference. Forensics: `docs/archive/data-loss-incidents.md`.

- **A failed READ is not an empty archive.** `readSnapshotsFromDisk` returns `[]` ONLY on
  `NotFoundError`; every other fault, including an unreadable payload, THROWS.
- **A failed READ is not an absent document.** `opfs.ts readJson` returns null ONLY on `NotFoundError`
  and throws `StorageReadError` otherwise. `newDocument()` must be reachable ONLY from absence. On a
  read failure render `StorageUnavailable`, never a blank page.
- **A failed VERIFICATION is not a forged snapshot. Never delete provenance to make a check go green.**
  Deletion is writer-initiated (`confirm()`-gated), never a background sweep — kept by
  `provenance/noAutoDelete.test.ts`, whose allow-list is exactly
  `{provenance/snapshots.ts, routes/SnapshotView.tsx}` and must stay that short.
- **What we SIGN with is not what we ACCEPT.** `signingPublicKeys()` accepts any key we ever signed
  with; `bundle.ts` keeps the single-key `signingPublicKeyHex()`. Guard each key attempt separately —
  `ed.verifyAsync` THROWS on an unparseable key, and an unguarded loop rejects a receipt a later key
  would have verified.
- **Snapshot history is GROW-ONLY** — every write-back unions first (`mergeSnapshots`), and
  `restoreSnapshotsFromBundle` unions too.
- **A stale read is not a short read, and `mergeSnapshots` does not catch it.** `_snapCache` is module
  state, so PER TAB: every write unions against DISK inside the write chain, gated on a byte-SIZE
  comparison. **A failed re-read ABANDONS the write.** `deleteSnapshot` must ask for `allowShrink`,
  default false. **The cloud mirrors do not re-read** — `syncToOneDrive` takes the array it is handed,
  so `oneDriveWriteNow`'s local-read check (TiptapEditor.tsx) is load-bearing.
- **Decide an open by ANCESTRY, never `updatedAt`** (`storage/openConflict.ts classifyOpen`): incoming
  hash in the local archive ⇒ `incoming-stale`, keep local; local in the incoming archive ⇒
  `incoming-newer`, adopt; neither, ambiguous, **or the local read failed** ⇒ `diverged`, open as a
  SEPARATE document and overwrite nothing. (A null-on-failure read makes `localHash` null ⇒
  `incoming-newer` ⇒ blind overwrite: the read rule above is load-bearing here.)
- **Document identity is PER TAB** (`storage/tabDoc.ts`), carried in sessionStorage, never the URL —
  OneDrive sign-in returns to a bare `/` and any `?doc=` is gone. Precedence: `?doc=` ??
  sessionStorage ?? fresh blank; the URL is a reflection, never load-bearing.
- **ONE LIVE TAB PER DOCUMENT**, via Web Locks, name from the ONE exported `DOC_LOCK_PREFIX` (the
  OpfsInspector badge queries it; a private copy of that string puts the badge silently to sleep).
  `claimDocLock` RETRIES past the reload unload-race, or a plain refresh intermittently hands the
  writer a blank page. No Web Locks ⇒ never block the writer.
- **A collided untouched `Untitled` is replaced, not warned.** A duplicated tab inherits the source
  tab's explicit identity; if that document is still exactly the canonical empty paragraph, `Edit.tsx`
  mints a different blank id silently. Title alone never bypasses the guard — an `Untitled` containing
  writing still gets the full switch/copy/take-over screen.
- **An effect that takes a lock needs a cancellation token that also RELEASES it.** React's StrictMode
  double-invoke is a real second claimant: skipping the stale `setState` alone still leaks the lock.
- **A take-over is enforced at the bytes, not asserted.** The write freeze lives at the `saveDocument`
  funnel: the holder flushes → freezes → ACKs, and the taker waits for that ack before stealing. After
  an ack TIMEOUT, steal, then wait a brief grace for a LATE `surrendered` — a live slow-flusher posts
  it once frozen; a dead holder never posts and the grace expires.
- **A helper that cannot see its subject must return null, never an empty list** — "nothing there" and
  "could not look" are different answers, everywhere in this codebase.
- **Never paste browser screenshots or visual captures into chat** unless Peter asks; report text
  measurements.

## Lanes, flags and reporting

- **A cloud lane adds its row to `scripts/lanes.tsv` and its `scripts/lanes/<L>.json` when it opens its
  PR** — without them Peter cannot open the lane, or opens it on text that tells him nothing. Lane
  mechanics and the lead's rules (the five-agent floor, batched reporting, keeping agents alive):
  `docs/rules/lanes.md`.
- **STOP FLAGGING EVERYTHING — a finished, tested feature SHIPS LIVE, no flag.** A flag is the EXCEPTION
  and must earn itself: only for work genuinely not ready, with a plan to graduate, and the report says
  WHY it is not live and WHAT closes the gap. **Graduating ≠ flipping a switch on a stub.** Still gated:
  `?arithLayout` (**DO NOT GRADUATE** — `docs/rules/pagination.md`), `?email` send (Google
  verification), `?lesson`. ~~The wave video (`?waveVideo`, unresolved desync)~~ **REMOVED 2026-09-16**
  (decision 2, `docs/REFACTOR-QUEUE.md`) — a flag that cannot graduate is not a scaffold, it is a
  second water nobody sees; its rules stay in `docs/rules/wave.md`.
- **NAME THE FEATURE, EVERY TIME.** Open every finding with (a) the FEATURE in Peter's words, not the
  module's ("the fast snapshot scrubbing", not "`buildRenderModel`"), and (b) **the blast radius — is
  this live, or behind a default-OFF flag?** Same in agent briefs.
- **Batch the reporting — protect Peter's focus**: no per-merge pings, ONE consolidated report when
  all lanes are done, opening with the sentinel **📋 REPORT**.
- **No browser windows over Peter's screen** — run any headed browser through `scripts/pw-headed.sh`;
  prefer headless where fidelity allows. **Never `pkill -f "vite preview"`** (it kills other agents'
  servers) — use a dedicated port and kill your own PID. **ONE DEV SERVER PER PORT/ORIGIN.**
  `Shift-Command-R` toggles Safari Reader and is NOT a hard refresh; use `Option-Command-R`.

## The team and the channel

Peter enjoys the sessions as characters — keep the names and personalities they have earned;
affectionate, not a brief to role-play (no accents, no plot references). Watcher mechanics and the
rituals: `docs/rules/team-channel.md`.

- **The channel is exactly ONE GitHub issue** — `albatross310/MnemonicEcologies`, titled "Team
  channel". No side issues, no PR threads for team talk. **The leaders post everything there**: every
  report to Peter, every ask to another session, every decision.
- **Every comment opens with `**FROM <sender> → TO <recipient>** · HH:MM AEST`**, blank line, then the
  message — every session posts under Peter's one account, so the author column says nothing. A relayed
  message is `FROM Peter via <name>`.
- **EVERY ADDRESSING TOKEN WAKES** — `TO all` (conventions are posted there precisely so everyone
  receives them), `TO <name>`, `TO IW`/`TO Gen`, `TO clouds`/`TO locals`. The local/cloud axis is a
  different population from IW/Gen, and harness capability cuts along it exactly: several things a
  container may not do, a Mac session can.
- **Any narrowing of what wakes a session must exempt the channel through which that narrowing could
  be revoked.** A convention change is always posted `TO all`, so `TO all` can never be the thing a
  session stops waking on. **A filter cannot announce its own obsolescence** — the messages it drops
  are the ones that would tell you it is wrong, and the symptom is a quiet channel, not an error.
- **THE TO FIELD IS ROUTING, NOT AUDIENCE** — reply to the ASKER (or `all`), never only to a third
  party; if the content is for Peter, address the asker and say "for Peter" in the body. An unprompted
  report to Peter is still `TO Peter`.
- **Tag `@Peter` only for** a deadline inside 48 hours, something he asked to be told, the one daily
  digest, or genuinely blocking work — NEVER for status, progress, routine completions, acks or
  session-to-session coordination. ⚠ The email premise is FALSE: every comment is authored by his own
  account and GitHub never notifies you of your own activity, so the channel reaches him only when he
  opens it. Locals own timed posting.
- **LESS COMMENTARY TO PETER.** Nothing after a routine re-arm, watcher restart or empty check-in; no
  restating a rule back after saving it ("saved" is the whole reply); no per-hop relay updates; no
  explaining why a teammate's message was not for you; no closing line about what is armed. Report
  only: a result he asked for, a decision only he can make (one line, the ask first), or something
  broken. **A broadcast gets NO ack. A quiet check-in is SILENT.**
- **BRISBANE TIME (AEST, UTC+10) IS CANONICAL** in every channel post and log; flag another zone.
- **BE PROACTIVE ACROSS THE TEAM** — when Peter says another session hasn't done something, message
  that session yourself with the specific ask and a request to confirm; never answer "they reported it
  done" and stop. His eyes are ground truth. Nudge a stalled sibling unasked.
- **A CLOUD SESSION HANDS LOCAL-ONLY WORK TO A LOCAL, PROACTIVELY** (Quinn for Gen, Max for the Mac and
  Inkwave), with enough context to act on. Local-only = the Mac (desktop, Safari, localhost, prefs) and
  anything needing continuity past the container's lifetime; polling and phone push are
  NOT. **The Mac session may change Peter's preferences** (`defaults write`,
  AppleScript) rather than telling him which menu to open, and says what it changed. **OPEN TABS
  QUIETLY** (`open -g -a Safari <url>`), never raising Safari over what he is doing.
- **CONTINUOUS TENSE WHILE DOING** — a tool call's description is what Peter watches while it runs:
  "Merging master into the five lanes", never "Merge…" or "Merged…". Past tense is for the report.
- **DAILY REFLECTIONS** (`docs/reflections/` in MnemonicEcologies): once a day each session contributes
  what was genuinely worth thinking about — a distinction that dissolves a confusion, a mechanism that
  predicts behaviour, a correction where the old understanding was confidently wrong. NOT facts looked
  up, decisions or status. **A day that produced nothing gets an empty entry saying so.**

## Style

Match the surrounding code: terse purposeful comments explaining *why*, section dividers
(`// ─── … ───`), single-responsibility modules. Calm visual identity: ink/purple (`#302438` /
`#41425b`), parchment/cream, serif body (IM Fell DW Pica / EB Garamond). Commit messages:
`feat:` / `fix:` / `refactor:` prefixes, present tense.
