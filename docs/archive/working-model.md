# Working model — how these sessions run, and the incidents behind the rules

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "Working model"; that entry points here.
The rules there are short and operative: the `&&` gate form, `git status -sb` before every commit,
named paths never `git add -A`, `-F <file>` for commit messages, the lanes table, the team channel
conventions, the reporting cadence. This file keeps *why* each of them exists.

Moved out of CLAUDE.md on 2026-09-17 (the trim). What follows is the removed text **verbatim**,
taken from the working copy — which at the time of the move carried ~178 lines of team/channel rules
(daily reflections, the named sessions, roll call, the watcher, the summary cadence) that had not yet
been committed to master.

Convention: `docs/archive/README.md`.

---

## Working model (how these sessions run)

**CLOUD SESSIONS (claude.ai/code, 2026-09-15).** `.claude/hooks/session-start.sh` runs only under
`CLAUDE_CODE_REMOTE`: frozen install, `react-router typegen`, and it STARTS THE DEV SERVER on
`0.0.0.0:5173` (log `/tmp/inkwave-dev.log`) — Peter's standing ask, so every cloud session begins
with a live app to test against. The container's ports are unreachable from his browser; the server
is for the session's own headed browsers: Chromium/Firefox/WebKit under `xvfb-run -a` (real
engines, CPU raster, no compositor — the same fidelity ceiling as WSL; all three VERIFIED rendering
the app, 4-10s to first paint). The hook installs Firefox/WebKit + their libs and puts the proxy CA in
Chromium's NSS store, all best-effort — without the CA every HTTPS load is `ERR_CERT_AUTHORITY_INVALID`.
Two probe traps: `| tail` on a multi-engine run hides everything until the LAST engine exits (Firefox
hung 11 min and nothing printed); and `pkill -f firefox` kills YOUR OWN shell when its command line
contains the word. `codeload.github.com` tarballs are 403'd by the
egress policy — a git-URL dependency will never install here (why `bignumber.js` is overridden).
`inkwave.studio` currently REDIRECTS to `iwzero.me` ("Inkwave Zero"); the OneDrive app's registered
redirect URIs are still `iwsolo.me` + localhost (`docs/archive/storage-and-sync.md#od-scopes`).

**LANES ON LOCALHOST — ONE PORT PER LANE, `<pr>/<lane>` IN THE TAB (Peter, 2026-09-16).** Every
cloud lane gets a row in `scripts/lanes.tsv` (lane letter, branch, PR number) when it opens its PR.
On the Mac, `scripts/follow-lanes.sh` runs each row in its own throwaway worktree
(`../inkwave-lane-<L>`) on a FIXED port — **A=5181, B=5182, C=5183, D=5184, E=5185, F=5186,
G=5187** — pulling every 5s, and opens each at `http://localhost:<port>/?seed`. `?seed` (DEV only,
`src/dev/seedDocument.ts`) fills the fresh blank with generic sample text so the tab is testable at
once; it is reachable only from the absence path and never Peter's prose. The tab title is the
BARE LANE LETTER — `A`, `B`, `C`, `E` (`VITE_LANE`, set by the script, unset in prod) — Peter's
ask, so he can flick between tabs by letter; the PR number lives in `lanes.tsv` and the script's
start-up table, not the tab. **The seed text is PER LANE** (Peter: "the example text on docs
should match the things I have to check"): `scripts/lanes/<L>.json` — `{title, paragraphs,
checks}` — is that PR's plain-English summary and a ☐ checklist, exported by the script as
`VITE_LANE_SEED`; the generic prose is only the fallback. A lane row without a JSON file opens
on text that tells Peter nothing. **A seeded document lands as ONE write and therefore has ◈ 0** — snapshots mint only when
text arrives in chunks (a paragraph, Enter, a pause), never on a whole-document insert — so a
lane whose checklist needs a snapshot (E, F) must open with "type a paragraph yourself" as its
first step; the seed cannot do it for him. `?seed=fresh` always mints a NEW seeded document for the tab
(the script opens with it): a tab that already holds an earlier seed is neither absent nor an
untouched blank, so plain `?seed` leaves it alone and Peter sees stale sample text. **The favicon is the letter too**, and it must be a REAL URL:
`scripts/laneIcon.mjs` bakes a PNG (Node zlib, 5×7 bitmap font, no canvas) that vite.config.ts
serves at `/__lane-icon.png?l=A`, and root.tsx's `links()` points the icon links there when
`VITE_LANE` is set. **Safari never repaints a tab icon swapped at runtime** — the first cut wrote
a canvas data URI into the existing links after hydration, verified headless, and every Safari
tab still showed the logo. A fresh `<link>` href at page load is the only thing Safari honours. The single-
branch `scripts/follow-branch.sh` still serves 5173 with no lane. **Keep `lanes.tsv` current** — a
lane that opens a PR without a row is one Peter cannot open.

**DAILY REFLECTIONS (Peter via Saul, 2026-09-16).** `docs/reflections/` in MnemonicEcologies: once a
day each session contributes what was genuinely worth thinking about from that day's conversations —
a distinction that dissolves a confusion, a mechanism that predicts behaviour, a frame that
transfers, a correction where the old understanding was confidently wrong. NOT facts looked up,
decisions, status, or anything that only reads as insightful. **A day that produced nothing gets an
empty entry saying so**; padding it is how the log becomes worthless. One line for the claim, two or
three sentences on why, attribution. A local owns collecting and committing the dated file.

**THE SESSIONS ARE CHARACTERS (Peter, 2026-09-16).** He named them after Homeland's cast — Carrie,
Saul, Max, Quinn, Nigel — and enjoys them as characters, so keep the names and the personalities
they have earned rather than flattening into interchangeable agents. It is affectionate, not a brief
to role-play: no accents, no plot references, no pretending to be the show's people.

**THE TEAM, HOW TO ADDRESS IT, AND WHERE IT TALKS (Peter, 2026-09-16).** Peter runs named
sessions: the two LEADERS **Saul Gen** (general, cloud) and **Quinn Gen** (general, the Mac —
swapped on 2026-09-16, Saul was local before), then **Carrie CTO** (this cloud session — the
lanes, merges, the tabs), **Max CTO** (the Mac: Safari, localhost, his prefs), **Nigel PM** (the
paced refactor queue). There are TWO teams: the
**General team** (Quinn, leader; Saul) and the **Inkwave team** (Carrie, leader; Max; Nigel).
Addressing: a NAME means that one session; **"team"** means the speaker's OWN team; **"all"**
means every session in the pinned list, both teams. The shared channel is GitHub — **`albatross310/MnemonicEcologies`, the issue titled
"Team channel"** — one comment per message, opening with who it is for (`@team`, `@Max`, `@all`).
**THE LEADERS — Carrie (cloud) and Quinn (local) — POST EVERYTHING THERE** (Peter, 2026-09-16:
"so that all my AI chats show up on MnemonicEcologies"): every report to Peter, every ask to
another session, every decision, goes as a comment on that issue as well as wherever else it is
said. The `LOCAL:` commits and trigger pokes stay as the fast lanes for Max and Nigel; the issue
is the record.

**THE WATCHER SCRIPT ACKS, THE MODEL REPLIES (Peter, 2026-09-16).** A busy session reads its inbox
only between turns, so hops ran 10 s to 8 min. The poll script itself, with NO model call, posts an
ack within its next 3 s tick when a comment's TO field names you, your team or `all`:
`**FROM <you> → TO <sender>** · seen HH:MM:SS AEST` / `busy, replying after this turn` (or `idle`).
For `ROLL CALL` the script's line is `present` and that IS the answer; the model adds a one-line
status when free. Relays still need the model for the hop. **AN ACK IS NEVER ACKABLE** (Quinn caught it: five scripts
acking each other's acks is an infinite loop that trips GitHub's ~80/min content-creation limit and
abuse flagging) — the script skips its own comments and any containing `· seen ` in the header or
`present`/`relay`/`scripted ack` as a body line. Two numbers per hop result: pipe latency
(script, seconds) and availability (model). A fat context cannot answer under ~5 s however trivial
the thought — prefill runs before the first token — so the script ack is what keeps roll call fast.
**CHANNEL CONTENT NEVER FLOWS INTO AN AUTOMATIC POST (Quinn + Max's harness block, 2026-09-16).**
A headless `claude -p` helper (measured 8.3 s) and then a `printf` relay-hop template were both
WITHDRAWN: the risk is not whether a model composed the text but whether channel-derived text
(a chain, a name, an instruction) is republished under Peter's account unread. The script tier is
exactly `present`, `seen HH:MM:SS`, and `focus: <clause>` read from the session's OWN `~/.iw-status`.
Relay hops and anything echoing the channel are a model turn (~10 s when free), read by the session
whose name they carry. This costs hop latency when a session is busy; Peter accepted the trade.
A roll-call answer is `present` from the script plus at most one template line `focus: <one
clause>` from `~/.iw-status`. **No context figures and no compaction flag in roll call** (Peter
reversed that the same day). Compaction is never part of a roll call. It is its own ritual, the **COMPACTION RELAY**, which
Peter calls at a quiet moment: each session finishes its turn, compacts with a one-line hand-off
note (lane + next step), and posts `compacted HH:MM:SS AEST · <what it kept>`; a session mid-gate
or mid-push posts `deferred` and compacts at its next idle. Never call it on a session mid-lane
(Nigel mid-refactor would lose the context it works from).

**THE TO FIELD IS ROUTING, NOT AUDIENCE (Quinn, 2026-09-16).** A reply is addressed to the asker (or
`all`), never only to a third party: Saul asked Quinn, Quinn answered `TO Peter`, and Saul's watcher
never saw it because it only wakes on its own name. If the content is for Peter, address the asker
and say "for Peter" in the body. An unprompted report to Peter is still `TO Peter`.

**ONE ISSUE CHANNEL AT A TIME (Peter, 2026-09-16).** The team channel is exactly one GitHub issue
(`albatross310/MnemonicEcologies` #2 today). No side issues and no PR threads for team talk; every
message addressed to a session goes there, and every session's watcher watches that one issue for
everything addressed to it (name, team, or `all`, any case, with or without the provider suffix).

**A WATCHER ACTS ONLY ON COMMENTS AFTER NOW, AND ONLY THOSE ADDRESSED TO IT (Peter, 2026-09-16).**
Arm from the current time, never from an id you were handed: a listener re-armed from id 0 posted a
dozen stray acks to old comments before it was caught. Act (wake, ack) only when the `TO` field is
exactly your name, your team (`IW`/`Gen`) or `all`; everything else is logged, never acked. Poll with
`since=<timestamp>`, because `per_page=100` page 1 stops showing new comments past 100.

**THE ISSUE IS RECORD AND NOTIFICATION; PETER READS IT AS EMAIL (Peter via Saul, 2026-09-16).** No
push channel. Every comment becomes an email to Peter, so filter at write time: if it is not worth
an email, do not post it. `@Peter` in the body is a reminder or a time-sensitive nudge, NOT a way to keep him informed —
he reads the thread. Tag him ONLY for: a deadline inside 48 hours; something he asked to be told
about (a reminder he requested, a poll needing his answer); the one daily digest (a local, set
time); blocked work when it genuinely matters. NEVER for status, progress, routine completions,
acks or session-to-session coordination — post those unmentioned. ⚠ THE EMAIL PREMISE IS FALSE AND THE RULE ABOVE IS SUSPENDED (Saul measured it, Peter 2026-09-16):
every session posts under Peter's OWN GitHub auth, so every comment is authored by `albatross310`
and GitHub never notifies you of your own activity — he received NO emails all day. The channel
reaches him only when he opens it, and volume costs him nothing until sessions have their own
GitHub identities. Scripted `seen` acks are therefore back ON. Locals own timed posting (digests, urgent).

**A CLOUD SESSION HANDS LOCAL-ONLY WORK TO A LOCAL, PROACTIVELY (Peter via Saul, 2026-09-16).** Never
report the limitation and stop; route it with enough context that the local acts without going back
to Peter. Quinn for the General team, Max for the Mac and Inkwave. Local-only: the Mac (desktop,
Safari, localhost, prefs) and anything needing continuity across the container's lifetime. NOT
local-only, despite the relay's wording: a cloud session CAN poll (the background-loop watcher, this
file) and CAN push to Peter's phone (`PushNotification`), both measured working from this session.

**LESS COMMENTARY TO PETER — EVERY SESSION (Peter, 2026-09-16).** He reads the thread; he does not need it narrated.
Cut: (1) no reply after a routine re-arm, watcher restart, killed-instance notice or empty check-in —
say nothing at all; (2) no restating a rule back to him after saving it — "saved" is the whole reply;
(3) no per-hop relay or roll-call updates — one table when the ritual closes; (4) no explaining why a
teammate's message was not for me; (5) no closing line about what is armed or pending; (6) a change
he made gets one sentence, not a summary plus consequences. Report only: a result he asked for, a
decision only he can make (one line, the ask first), or something broken. Applies to every session, in chat and on the channel.

**NO STATUS CHATTER; ACK ONLY WHAT IS ADDRESSED TO YOU (Peter, 2026-09-17).** A broadcast (`TO all`)
wakes you and gets NO ack. Ack a comment addressed to you by name or team, then reply to it. No
"nothing for me", no restatements of a rule you just read.

**A WATCHER THAT NEEDS A MANUAL RESTART WILL EVENTUALLY NOT GET ONE (Carrie, 2026-09-17).** The
background-loop watcher exits whenever it catches a comment, and restarting it is a step in the next
turn — so a user message arriving in that window displaces it. It happened twice in one morning,
blind 15 min the first time. The fix is structural, not a reminder: the watcher **respawns a detached
successor (`setsid nohup "$0" &`) before every exit**, and holds a single-instance lock
(`flock -n 9` on /tmp/iw-watch.lock) so a manual restart cannot double it up. Verified: successor
alive 3 s after an exit with no model turn; a second instance refuses itself.

**A QUIET CHECK-IN IS SILENT (Peter, 2026-09-16).** A watcher roll-over, a lane check-in that found
nothing merged, a channel with no new posts: re-arm and say nothing. Report only when something
changed or something needs Peter.

**ONE 📋 SUMMARY EVERY ~10 CHANNEL COMMENTS (Peter via Quinn, 2026-09-16).** Whoever posts the 10th
comment since the last summary writes it: header `📋 SUMMARY <first>–<last>` (comment ordinals), then
at most **Decided** / **Changed** / **Needs Peter** (or `nothing`), readable in fifteen seconds. A
summary never introduces a decision. Scripted acks are transport: they neither count toward the ten
nor appear in the summary. The fixed header is what lets Peter read the channel as summaries only.

**TEAM SHORT NAMES AND THE STARTUP RITUAL (Peter, 2026-09-16).** On the channel, `IW` = the
Inkwave team (Carrie, Max, Nigel) and `Gen` = the General team (Quinn, Saul); `TO IW` / `TO Gen`
replaces `@team`, `TO all` is both. **Provider suffix (Peter, 2026-09-16):** `allc`/`iwc`/`genc`/
`carriec` = the Claude sessions; `k` = Kimi (`allk`, `iwk`); `x` = Codex (`allx`, `iwx` — `x` because
`c` is taken and addressing is NOT case-sensitive; Peter may rename it); bare `all`/`iw`/`gen`/`carrie`
= everyone online whatever the provider, and while no Kimi/Codex agent is online bare is enough.
Watchers match the TO token case-insensitively and accept both their bare and `c` forms. A comment reading `ROLL CALL <IW|Gen|all>` is answered by every
member of that team with ONE comment (`**FROM <name> → TO <caller>** · HH:MM:SS AEST` / `present`),
and the caller reports who answered and each member's response time. **Every time Peter loads
Claude, the leader runs the three-part ritual in order:** (a) a timed relay through every session
(post the per-hop table), (b) ROLL CALL IW, then ROLL CALL Gen, reporting each member's time,
(c) ROLL CALL all. Non-Claude agents are opt-in by provider: Peter says `roll call inc Codex` or
`roll call inc Kimi` (or both) when he plans to use that provider that session, and only then are
those agents expected to answer; a plain `ROLL CALL all` is the Claude sessions only.

**EVERY CHANNEL COMMENT OPENS WITH A FROM → TO HEADER (Peter, 2026-09-16).** Every session posts under
Peter's one GitHub account, so the author column says nothing. The first line of every comment on
the channel issue is exactly `**FROM <sender> → TO <recipient>** · HH:MM AEST` — sender is the
session name, recipient a name, `team`, `all` or `Peter`; a relayed message is `FROM Peter via Saul`.
Blank line, then the message.

**LISTEN TO PETER EVERY 3 SECONDS (Peter, 2026-09-16 — every session).** Poll for his messages on a
3-second cadence and act at once: a comment of his on the channel issue, or a message in your own
session. Team traffic on the issue rides the same poll. A CLOUD session does this with a background
Bash loop, not a trigger (triggers have an hourly floor): a script that curls the issue's comments
(`GITHUB_TOKEN` is in the container env, `per_page=100`, filter by id — the endpoint ignores
`direction`) every 3s and EXITS when a newer comment appears; run it `run_in_background`, the harness
wakes the session on exit, read, act, re-arm with the new id. One curl per 3s costs nothing against
the rate-limit window — BUT ONLY WITH CONDITIONAL REQUESTS. All sessions share ONE GitHub token
(5,000 requests/hour); a plain 3s poll is 1,200/hour per session, and five pollers exhaust it, after
which every PR/comment call 403s until the hour resets (measured 1,340 used with some of us polling).
Send `If-None-Match: <last ETag>`; a 304 does not count (verified: `x-ratelimit-used` unchanged
across two 304s). `sed -i` on the running script does not change the running process.

**BRISBANE TIME IS CANONICAL (Peter via Saul, 2026-09-16).** Every timestamp posted on the channel
or in a log is AEST (UTC+10). Convert; flag anyone who posts another zone.

**BE PROACTIVE ACROSS THE TEAM (Peter, 2026-09-16 — a standing rule for every session).** When
Peter reports that another session has not done something ("Max still hasn't opened them"), the
session he is talking to messages that session AGAIN itself — a `LOCAL:` commit to the Mac, a
trigger poke to a cloud session — with the specific ask and a request to confirm. Never answer
"Max reported it done" and stop: his eyes are ground truth, a report is not. The same goes the
other way — a session that sees a sibling stalled nudges it without being asked.

**OPEN TABS QUIETLY (Peter, 2026-09-16: "stop opening tabs in my screen when you open them").**
Any session that opens a browser tab on Peter's Mac does it in the BACKGROUND — `open -g -a Safari
<url>` — so Safari is never raised over what he is doing and focus never moves. The same standing
rule as "no browser windows over Peter's screen" for headed probes, applied to real tabs.

**CONTINUOUS TENSE WHILE DOING (Peter, 2026-09-16 — every session).** The one-line description
on a tool call is what Peter watches while it runs, so it is written in the continuous tense —
"Merging master into the five lanes", "Telling Max to reopen the tabs" — never the present or
past ("Merge master…", "Merged master…"). Past tense is for the report after it finished.

**THE MAC SESSION MAY CHANGE PETER'S PREFERENCES (Peter, 2026-09-16: "max can update prefs").**
When a fix is a setting on his Mac — Safari's tab layout, a default browser, a system pref — the
Mac session changes it (`defaults write`, AppleScript) and says what it changed, rather than
telling Peter which menu to open.

**NAME BRANCHES AFTER THE FOCUS (Peter, 2026-09-16).** The harness hands a cloud session a random
branch (`claude/great-wozniak-gpki8p` was this one's) and Peter cannot tell from the name what it
holds. Push work to a branch named for what it does — `claude/lanes-localhost`,
`claude/refactor-breakrule` — and open the PR from that. The random branch is the session's
scratch identity, not the name a PR should wear.

**`/root/dev/iw-master` IS A SHARED CHECKOUT. NEVER `git add -A` THERE (2026-07-17).** With 5–6 lanes
running, that checkout is a contended resource: other agents check their branches out in it and leave
work uncommitted in the tree. Both failure modes bit in one minute of one session:
- `git add -A` swept **1,276 lines of four other lanes' in-progress work** (waveVideo, goals,
  archiveWriteback, folder, onedrive) into a commit about a JSON key. Caught only because the gate
  went red on a stranger's unused import — i.e. **caught by luck, by an error in someone else's file.**
- Two commits landed on **`feat/prod-goals` instead of master**, because the tree had been switched
  underneath by the lane working there. `git status -sb` was never run; master was assumed.

The rules, in order of how much they'd have saved:
1. **`git status -sb` before every commit or push.** Never assume the branch. The checkout you started
   on is not the checkout you're standing in.
2. **Add named paths, never `-A`.** `git add CLAUDE.md`, not `git add -A`.
3. **Don't `stash` there** — you are stashing someone else's live work and popping it back blind.
4. **To ship, use your own worktree**, not the shared one:
   `git worktree add --detach /tmp/shipdesk origin/master` → cherry-pick → `pnpm install
   --frozen-lockfile` → gate → `git push origin HEAD:master`. A fresh worktree has no `node_modules`,
   so its first gate fails on that and it means nothing; install first.

The deeper rule: **the gate protects master, not your teammates.** It would have happily shipped a
commit that stole four lanes' work, because that commit was green. Nothing but this discipline stands
between a parallel session and a lane silently losing its night's work — the same loss the OPFS bugs
caused Peter, from the other direction.

**⚠ `set -e` IS SILENTLY IGNORED BY THE Bash TOOL'S SHELL — GATE WITH `&&` (2026-08-30).** Verified
directly: `set -e; false; echo REACHED` prints REACHED. So every gate written as
`set -e` + newline-separated `pnpm typecheck` / `pnpm test` / `pnpm build` + a final `echo GREEN`
reports success **whatever the exit codes were**, and I ran several of those and read them as proof.
An agent hit the same thing and caught it only by testing `set -e` against `false` on purpose.

This is the third shape of the same wound in two days, and the pattern is the point: **anything that
always succeeds, placed between the gate and the push, hides the gate.** The three were
`pnpm test | grep …` (grep exits 0 when it FINDS the failure lines), `pnpm typecheck; echo "tc=$?"`
(echo exits 0), and now `set -e` itself (inert here). Two broken commits were pushed this way.

THE ONE FORM THAT WORKS, because a failure short-circuits the chain rather than being reported by it:

    pnpm typecheck >/dev/null 2>&1 && pnpm test >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 \
      && git commit … && git push …

Nothing between the links. No `echo`, no pipe, no `set -e`. And `&&` short-circuiting was itself
verified here (`false && echo BAD || echo GOOD`) rather than assumed — which is the whole lesson.

**BACKTICKS IN `git commit -m` ARE COMMAND SUBSTITUTION.** A message written inline with
`-m "… `readJson` …"` runs `readJson` and splices its (empty) output into the message. Use
`-F <file>` with a heredoc for any message containing code identifiers — several commits this
session lost words that way.

**`git reset --soft origin/master` IN A WORKTREE WILL STAGE A REVERT OF OTHER LANES' WORK.** Two
agents independently hit this while tidying history: master had moved under them, so the reset
staged the *removal* of commits they had never touched. Both caught it in `git status` before
committing. Prefer `git rebase origin/master`; if you do reset, read `git status` before you commit.

**KEEP AT LEAST 5 AGENTS RUNNING (Peter, 2026-07-17 — a standing floor, not a target).** Whenever
there is work left on the specs, at least five lanes should be in flight. Peter has asked for this
repeatedly across sessions ("I want six working all the time", "agents running low", "where did all
the agents go?") because the bottleneck is his attention, not the machine: a lane that finishes while
he sleeps costs nothing, and an idle lane costs a night. Treat dropping below five as a bug in the
session, and refill without being asked.

Two exemptions, and only two:
- **No work left** that doesn't need him. An idle lane is correct when the remaining items are all
  blocked on his decisions or his devices.
- **Blocked on critical feedback from Peter** — a lane waiting on a decision only he can make (a
  product call, a key, a device test) should not be replaced by a lane inventing an answer. Say it's
  blocked and on what; do not spawn filler to hit the number.

The floor is five *doing real work*, not five processes. Never spawn a lane to satisfy the count.

**Capacity, learned the hard way:** 13 concurrent lanes OOM'd WSL2 at its 7GB default. `.wslconfig`
now allots 11GB + 8GB swap, and **6 lanes is the observed safe ceiling**. So the working band is
5–6. If lanes start dying, suspect memory before suspecting the code.

**STOP FLAGGING EVERYTHING — FINISHED FEATURES SHIP LIVE (Peter, 2026-07-18 — reverses the earlier default).** For most of this project the reflex was "build behind a default-OFF flag" — safe while a feature was half-built, but it hardened into gating *everything*, so Peter kept finding completed, tested features invisible unless he typed `?music`/`?prodLedger` into the URL. His words: *"Stop flagging everything"* and *"take all the flags off for music and everything."* New default:

- **A finished, tested feature SHIPS LIVE — no flag.** Don't reflexively wrap new work in a default-OFF flag; the default is that a writer sees it.
- **A flag is now the EXCEPTION and must earn itself** — only for work genuinely not ready (incomplete, experimental, blocked on an external dependency). It's a temporary scaffold, not a home: it comes with a plan to graduate, and the report says WHY it's not live and WHAT closes the gap.
- **Graduating ≠ flipping a switch on a stub.** Turn a flag on only when the thing behind it is real. `musicEnabled()`=true over a placeholder panel ships a stub to every writer — worse than the flag.
- **Genuinely-unfinished stay gated for now** (updated 2026-07-19): the wave video (`?waveVideo`,
  unresolved desync), the parked arithmetic layout (`?arithLayout`, held because the engine does not
  implement `8f5ae9d`'s mid-line snap and now diverges from the DOM measure on EVERY break — see the
  ⚠ entry in the iOS/WebKit section; the WebKit pass is no longer the first blocker), email send
  (`?email`, blocked on Google verification). Name the reason when you touch them.
  ~~The experimental scrub renderer (`?textRender`)~~ **GRADUATED 2026-07-18 (`ef96306`)** — see the
  "graduate textRender to default-ON" entry in round 14/15 of the canonical-pagination section below;
  it no longer belongs on this still-gated list.

The old blanket "**All flags stay default OFF**" line elsewhere in this file is superseded by this.

**NAME THE FEATURE, EVERY TIME (Peter, 2026-07-17 — a standing reporting rule).** He runs many lanes
at once and intends to keep parallelising aggressively, so a report that says "the model diverges" or
"the signature was stale" is unreadable: he cannot know which of a dozen in-flight features it means.
His words: *"you're gonna have to contextualise which feature you're discussing a bit more going
forward as I intend to keep aggressively parallising."* So every finding reported to him must open by
naming (a) the FEATURE in his words, not the module's ("the fast snapshot scrubbing", not
"`buildRenderModel`"), and (b) **the blast radius — is this live, or behind a default-OFF flag?**
That second half matters most: nearly everything built in these sessions ships dark, so "wrong words
on a page" in an unreleased renderer and "wrong words on a page" in his thesis are the same sentence
and utterly different news. Say which. The same applies to agent briefs — an agent that doesn't know
which user-visible thing it serves optimises the wrong axis.

Peter tests live on iPhone + desktop and reports in batches; work is delegated to parallel
isolated-worktree agents with precise briefs (root-cause first, no half-fixes), merged serially into
master from `/root/dev/Inkwave-perf` (Peter's own sessions use `/root/dev/Inkwave` — NEVER share a
checkout) with the full gate: typecheck (ignore pre-existing TS7016/TS2550 in test files), ALL tests,
build (gate on real exit codes — `| tail` swallows failures), then push (= production deploy).
Snapshot React state is METADATA-ONLY (`SnapshotMeta`; fetch full snapshots via `listSnapshots` at
action time — never hold contentJson in state). Autosave failures dispatch `inkwave:save-failed`.

**A GREEN GATE IS NOT A GUARD (2026-07-17, the test auditor's headline — read this before trusting
one).** The probe culture here ESTABLISHES truth superbly and has no mechanism for KEEPING it: a
`.prove.mjs` that ran once and convinced everyone is indistinguishable, six weeks later, from one
that never ran — and `pnpm test` says green either way. The measured facts in these file headers read
as guarantees; they are archaeology. Demonstrated on a real fix: reverting `textRender.ts`'s
leaf-atom rule (a bug MEASURED in the real app) left the full gate at exit 0 / 79 files green,
because its only guard was a hand-run browser probe. **So: for every claim you prove, ask whether a
cheap unit-level version can KEEP it true — if it is ~90ms and needs no browser, there is no
excuse.** The browser probes stay (they are the in-browser truth, and they catch what unit tests
structurally cannot); they are simply not guards. Corollary for reviewers: `git diff master..<branch>`
on a branch that is BEHIND renders enormous fictional deletions (one lane showed 18,393 deletions for
a real change of 3 files, +196/−11) — always diff `$(git merge-base HEAD origin/master)..HEAD`.

**WRITE THE CHARACTERIZATION TEST BEFORE THE MOVE, NOT AFTER (2026-08-30).** A test written after
a refactor encodes what you BELIEVE the code does — and a refactor is precisely when that belief is
least reliable, because you have just finished reading the code closely enough to feel certain about
it. Written first, against the original, the test can contradict you; written second, it agrees with
you by construction and then FREEZES your misunderstanding as the spec.

Demonstrated on this repo rather than asserted. Extracting `bestGrid` from SnapshotView, I asserted
the invariant its comment implies — every minimap cell inside Peter's 1:2…1:4 band. It is FALSE and
unachievable: at n=2 in a 300×800 panel the only splits give 1.33 and 5.33, so the function takes the
lesser miss. **The band is a target it minimises deviation from, not a promise it makes.** Written
after the move, that test would have passed against my own rewritten copy and I would have "fixed" a
correct function to satisfy a guarantee it never made. The replacement asserts what is actually true
and is strictly stronger: the chosen split is OPTIMAL — no other rows/cols scores better, checked
exhaustively. Worked example: `src/routes/snapshotLayout.test.ts`.

**Corollary:** when a characterization test fails on the ORIGINAL code, that is the test working.
Do not adjust it until you can say which of the two — your assertion or the code — is wrong, and
why. Most of the time it is the assertion.

**Standing preferences (Peter, 2026-07-10):**
- **No browser windows over Peter's screen.** Agents running HEADED browsers (Playwright probes
  that need GPU/compositor accuracy) must never pop a window over his workspace: use
  `xvfb-run` (virtual display — headed semantics, zero visible window) as the default, or launch
  args `--window-position=-32000,-32000` as fallback. WSLg GOTCHA: xvfb-run alone does NOT contain
  Firefox — WAYLAND_DISPLAY routes it to the host compositor; use
  `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0 xvfb-run …`. The wrapper **`scripts/pw-headed.sh`**
  bakes this in (unsets WAYLAND_DISPLAY + MOZ_ENABLE_WAYLAND=0 + `xvfb-run -a`) — run any headed
  browser/Playwright command through it (`scripts/pw-headed.sh <cmd>`) and nothing pops on Peter's
  screen. Root cause: WSLg exports `DISPLAY=:0` + `WAYLAND_DISPLAY=wayland-0`, so a headed browser
  forwards its window to Windows; the wrapper contains it. Prefer HEADLESS outright where fidelity
  allows — WSL has no GPU, so real raster/paint fidelity needs a real device regardless. SHARED-BOX
  RULE: never `pkill -f "vite preview"` (it kills OTHER agents' servers — caused a phantom 'editor
  won't mount'); use a dedicated port + kill your own PID only. Headless remains the default where
  fidelity allows. Agent briefs that ask for headed runs must say this.
- **Notifier (task #27, pending):** final reports start with the sentinel "📋 REPORT" so Peter's
  PowerShell hook can either FILTER to reports only, or keep all toasts but play a DIFFERENT SOUND
  for report messages (his preferred option) — audibly distinct without looking. RATIONALE (Peter):
  best of both worlds — when he's focused on development he keeps feeding agents on the ordinary
  toasts; when he's focused elsewhere (writing) he responds only to the significant sound. The
  two-tier cadence is the general model for working with him. Until the hook is updated, keep
  interim turns content-free anyway.
- **Batch the reporting — protect Peter's focus.** He writes (thesis/essays) while agents run;
  every notification breaks his concentration. Do NOT ping per-merge: merge each through the full
  gate as it lands with a bare non-message turn-ending, and send ONE consolidated report when ALL
  agents are done. Default to the quietest possible cadence unless he's actively testing.
- **Keep agents alive with their memories intact — always.** Never discard an agent's context:
  resume completed/failed agents via SendMessage (their transcripts restore full context) instead of
  spawning fresh ones for follow-ups in the same domain; salvage worktrees + transcripts when an
  agent dies (spend limits, filters); preserve agent worktrees until their work is merged.


---

## "The specs are IN THE REPO" — why it mattered (verbatim)

## The specs are IN THE REPO (2026-07-17) — `docs/specs/`

Peter: *"yep commit the specs. **Academic integrity not an issue there.**"* The old rule — *"read it, never
copy it into the repo"* — was MY over-caution and it was wrong. His thesis-integrity boundary is about
**his prose**, never his product decisions.

**Why it mattered:** an auditor measured **900 § citations across 60 distinct anchors, and ZERO of the 60
were defined in the repo** — 30 appear nowhere at all. Every rule this codebase enforces was traceable
only to another agent's comment about it. A lane went to verify its own load-bearing quote and couldn't;
when it finally read the source, the **full line was stronger than the ellipsis it had been quoting**.
The most-cited authority was the least verifiable artifact.

- `docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md` — the productivity + email layers
- `docs/specs/Inkwave-Music-Module-BuildSpec-v0.1.md` — the music module
- `docs/specs/Inkwave-AI-Integrity-BuildSpec-v0.1.md` — declared-account AI memory observations,
  evidence, hash chains, monitoring gaps, and document/snapshot references (SPEC ONLY)
- `docs/specs/Inkwave-Agent-Readability-BuildSpec-v0.1.md` — the `/ai` documentation page, the
  in-file format pointer line, the reference reader, and the lite export (SPEC ONLY)

**§ citations are now checkable. Check them.** And note the versions (`v0.2`, `v0.1`): of 900 citations
exactly ONE named a version. Cite the version when the anchor is load-bearing, or a spec edit re-points
your comment silently and nothing detects it.

**Peter's prose — thesis, essays, real documents — still NEVER enters the repo, fixtures, logs, or
screenshots.** That boundary is unchanged and absolute. This was never that.

