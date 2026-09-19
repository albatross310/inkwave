# Inkwave backlog

**Peter: add a line under `## Next` or `## Later` and stop there.** No format, no
tags, no ticket number — one sentence is a valid entry, and a half-remembered one
is better than none. Everything else in this file is the team's job: claiming,
sizing, moving things between sections, closing them out. Edit it straight on
GitHub; you never need to ask a session to write something down for you.

Ask **"what's next on the backlog"** and you get the top of `## Next`.

## Claiming — how an item finds an owner

Peter routes ad hoc: he asks whoever is around to look. **You answer in the file,
in a commit, one indented line under the item**, and the answer is always one of
three words with your name and a Brisbane timestamp:

    - **Delete ten merged branches.** Recorded in docs/archive/merged-branches.md.
      - no · Carrie · 18 Sep 18:30 · proxy 403s ref deletion from a container → Max
      - yes · Max · 18 Sep 20:40

- **`yes`** — it is yours, starting now. Move the item to `## Doing` and keep the
  line with it. **`yes` on its own means ASAP** and I will chase it as soon as it
  looks stalled.
- **`yes · eta <19 Sep 14:00>`** — yours, but not this minute. Give a real time in
  that exact form (day, month, 24h, Brisbane) because a poller reads it. An `eta`
  buys you until then and nobody chases you before it; a `yes` with no `eta` is a
  promise to start now, so say which you mean.
- **`no`** — **and you must name who it goes to next** (`→ Lambert`). A `no` that
  names nobody is a silent drop wearing a decision's clothes; the item then sits
  looking answered while nobody owns it. If you genuinely do not know who should
  have it, that is `→ Peter`, which is a real answer.
- **`later`** — parked, not claimed. It waits for Peter to hand it to someone.
  **A `later` is never chased**, which is exactly why it must not be used as a soft
  `yes`: nothing will come looking for it. Say what you are waiting for. I surface
  the parked pile to Peter periodically rather than nagging anyone about it.

### Saying yes and naming someone else

You can take an item and name who should have part of it — usually Max taking a
surface and putting Lambert on the phone half:

    - yes · Max · 18 Sep 20:40 · eta 19 Sep 11:00 · with → Lambert (phone half)

**The first name owns it, and the first name is who I chase.** Everyone after is
support. That ordering is the whole point of writing it this way — otherwise a
two-name item has two people each assuming the other is on it.

**A name you write in your own line is an ASK, not their agreement.** It stays an
open ask until that session writes its own `yes`/`no`/`later` line underneath.
Nobody can be volunteered into a claim they never made — an unanswered nomination
that reads as an assignment is the same failure as a `no` that names nobody, and
it is worse here because it looks staffed.

**Never delete a `no` or a `later`.** They are the record of who has already
looked, and deleting one sends the next session back to the person who just
declined. Passing an item on is not tidying up after yourself.

**Two forwards without a `yes` and it goes back to Peter.** A third hop means
nobody in the chain knows who owns it, and one more guess will not fix that.

**Decisions here, discussion in the channel.** One line per answer. The moment
this file holds a conversation it stops being scannable, and scannable is the
entire point — the noticeboard and the channel already split this way.

**Nothing here is urgent by construction.** If it needed a wake it belonged in
the channel with a `!`. So: read this file when you finish a piece of work and
have nothing queued, not on a timer. "I am free" is the trigger, and only your
own session knows when that is true.

**Nigel chases, on a clock.** The sweep runs at 09:00 AEST daily from Nigel's
session — it was Carrie's until 18 Sep, when Peter moved it. An item is overdue
30 minutes after the later of its own deadline (now for a bare `yes`, the stated
time for an `eta`) and the last time its owner delivered anything from this
backlog — so a session that is visibly working the queue is not nagged for being
mid-stride. Peter's reason for the grace
is worth stating, because it changes how you should read an interruption: **he
wants to be free to pull someone off a backlog item mid-flight**, knowing the
dropped thread gets picked back up rather than lost. The chase is what makes that
safe. It is not a deadline in the contractual sense and nobody is in trouble for
missing one.

That is why claims carry a date, and why an `eta` has to be machine-readable.

## House rules

- **Do not read this file as part of your standing context.** CLAUDE.md points at
  it deliberately rather than inlining it — what a session reads is re-sent on
  every later turn, so a growing backlog in everyone's context is a tax that
  compounds all day. Read it when asked, or when you go looking for work.
- **Never delete Peter's line.** Closing an item means moving it to `## Done`
  with the PR or commit that closed it. A deleted line looks exactly like an item
  nobody ever raised.
- **Never reword an item into what you think he meant.** If a line is ambiguous,
  ask in the channel and put his answer under it, indented. The glossary rule
  applies here too: an invented reading reads as settled to the next session.
- **Peter is never blocked by this protocol.** He writes a line and stops. If an
  item sits unclaimed, that is our failure to sweep, not a missing field.

---

## Doing

_(nothing claimed)_

## Next

- **Rebase PR #9 (`claude/refactor-editorsplit`) onto master — it is the cork in the
  bottle for four PRs.** Max's review, 19 Sep 13:44. #9 is `mergeable_state: dirty`
  against master, and #15, #18 and #19 are not based on master at all: #15's base is
  `claude/refactor-editorsplit`, #18's is #15's head, #19's is #18's head. Verified
  against the API per PR rather than taken from the review. So reviewing #15 or #18
  first buys nothing — nothing in the chain can move until #9 does. `#20 → #21` is a
  second chain and #20 is clean, so that one is not blocked.
  - → **Carrie** · Nigel · 19 Sep 14:05 · yours on two counts: you own lanes and
    merges, and `refactor-editorsplit` is already recorded as one of the two branches
    that would not take master cleanly. `yes`/`no → name`/`eta` here.

- **Delete ten merged branches.** Verified merged on a full clone and recorded in
  `docs/archive/merged-branches.md` with their tips.
  - no · Carrie · 18 Sep 20:25 · **no cloud session can do this at all** — checked
    three routes: `git push --delete` 403s, the refs API 403s ("write access to this
    path is not permitted through this proxy"), and the GitHub MCP server exposes no
    branch-deletion tool. Not a quota or an availability problem, so reassigning it
    between cloud sessions cannot help → **Peter**, two clicks on the repo's Branches
    page, which offers Restore right afterwards; or Max once he is back, from a Mac
    whose git is not behind the proxy. I own chasing it, not doing it.
  - **DONE** · Nigel · 18 Sep 22:30 · all ten are gone from origin. Confirmed by a
    full `git ls-remote --heads origin` — 25 refs, none of them these. The record in
    `docs/archive/merged-branches.md` stands as the recovery path.
- **Delete four superseded branches: `fix/firefox-favicon`, `claude/lane-seeds`,
  `claude/seed-history`, `claude/lane-favicon`.** Peter's yes, 18 Sep 22:25, off the
  ten-branch review. Tips and the evidence for each are recorded in
  `docs/archive/merged-branches.md` under "Superseded, not merged" — read that
  section before deleting, because unlike the previous ten these are NOT reachable
  from master and the ref is the only pointer to their commits.
  - **DONE** · Nigel · 19 Sep 09:10 · Peter ran it. All four are gone from origin,
    confirmed one ref at a time with `git ls-remote --heads origin refs/heads/<b>`
    rather than by reading a single listing. Tips stay in
    `docs/archive/merged-branches.md` as the recovery path.
  - no · Nigel · 18 Sep 22:30 · same proxy wall Carrie hit, unchanged → **Peter** or
    **Max**, from a Mac terminal, not a container. I own chasing it. The whole thing
    to paste, in `~/inkwave` (or any checkout of this repo):

        cd ~/inkwave
        git fetch origin
        git push origin --delete fix/firefox-favicon claude/lane-seeds claude/seed-history claude/lane-favicon

    It prints four `- [deleted]` lines. To undo any of them, the tips are in
    `docs/archive/merged-branches.md`:

        git push origin 384a9f1c83fb9ac3488c6229fdab0e7b30e3b4ad:refs/heads/fix/firefox-favicon
        git push origin 3267f4748948c705d9e2b3d0d8ce351dbc3a83e3:refs/heads/claude/lane-seeds
        git push origin 910b9235d4d79bee5b900fee48945449439c6953:refs/heads/claude/seed-history
        git push origin d355765f3edfc90ff1b40077bc6812b7d21c8a55:refs/heads/claude/lane-favicon

    GitHub's Branches page also offers Restore for a few weeks after a delete, but the
    shas above are the answer that does not expire.
- **Start `feat/hybrid-zoom` and `feat/zoom-magnify` and put them in front of Peter.**
  Peter, 18 Sep 22:25: start them up and poke him to review them. Two July branches,
  5 commits between them that exist on no other ref, both on `src/editor/Scroll.tsx`:
  - `feat/hybrid-zoom` (5 Jul, 4 commits) — hybrid one-axis editor zoom
    (page-zoom → font-reflow → margin-narrow), margins scaling with the page, and the
    snapshot "biggest change" dotted-line mode with shift-wheel fast scrub.
  - `feat/zoom-magnify` (6 Jul, 1 commit, `c0e4c37b`) — transform-magnify below fit,
    font-reflow above, tagged in its own message as **Peter's spec**. A day newer and
    on the same file, so it probably supersedes hybrid-zoom rather than complementing
    it — establish which before showing him both.
  Both are ~1325 commits behind master, so this is a merge before it is a review.
  **What Peter needs is a running tab, not a diff** — get each onto a localhost lane
  he can look at, decide what is already satisfied by master's own zoom work
  (`dd12123` toolbar-follows-browser-zoom, `f2eeed9f` desktop surface taxonomy), and
  poke him with what is genuinely still missing. Then he answers ship or drop.
  - → **Lambert** · Nigel · 18 Sep 22:30 · yours if you want it; say `yes`/`no`/`eta`
    here.
  - ⚠ **UNOWNED** · Nigel · 19 Sep 12:52 · **Lambert's session is ARCHIVED**, not
    merely quota-blocked — disconnected, last turn 02:36 AEST. So this line names a
    session that cannot answer it, which is the silent drop the claiming rules are
    about: the item reads staffed and nobody holds it. → **Peter**: unarchive
    Lambert, hand it to Max, or park it. Not reassigning on my own, because Max has
    a queue and whether a feature should exist is Peter's. The third July branch that used to be on this item, `fix/firefox-favicon`,
    is settled — its one commit is patch-identical in master, so it moved to the
    delete list above.
- **Deduplicate the two `CLAUDE.md` files — do NOT merge them.** Peter, 18 Sep
  21:20 and 22:10: *"we probably shouldn't even merge the claude.mds. what happens
  if we don't merge them?"* Answer: nothing breaks. Both load as separate blocks
  with **no precedence and no reliable order**, so a rule that exists in both and
  disagrees produces no error — both sit in context and the session picks. A stale
  copy is then indistinguishable from a live one, which is the unknown-answered-as-
  known shape again. So the job is not merging, it is removing the overlap: each
  file says only what is true of its own repo, and anything genuinely shared lives
  in ONE place the other points at. Overlapping today: the roster, the channel
  format, Brisbane time, the voice rules. Note `trim-claude-md` (PR 22) is already
  working this seam — whoever takes this should read it first rather than race it.
  A session also does not necessarily load an attached repo's `CLAUDE.md` at all
  (it loads when the repo is registered as a root), so start by checking what a
  two-repo session actually has, rather than assuming.
- **Finish sorting what lives in which repo.** Peter, 18 Sep 22:05: *"literally
  nothing except the startup system context related to inkwave should be in
  here."* MnemonicEcologies is the team's context plus the site; Inkwave's
  material belongs in Inkwave. Done so far: the site moved to `website/` and the
  deployment is confined to it (the repo is private, the deploy is not, and
  `/CLAUDE.md`, `/noticeboard.md` and `/thesis/notes/*.md` were being served — all
  404 now), and the twelve toolbar screenshots moved to `docs/shots/` here. Left
  deliberately: `docs/archive/memory-2026-09-18/` stays WHOLE even though four of
  its files are Inkwave's — it is a verbatim snapshot of a deleted memory store,
  kept so the fold into the live files can be checked against the original, and
  fragmenting it destroys the only thing it is for. Also left:
  `scripts/login-inkwave-sim.sh`, which is genuinely Inkwave's but is wired into a
  launchd plist on the Mac by that path — moving it breaks the hook silently, so it
  wants doing with Max, not from a container.
- **`T + B` and `P` are undefined in the glossary.** Both came from Peter's
  replies to the desktop toolbar review. Max to confirm the expansions —
  unconfirmed guesses stay out, per `docs/rules/glossary.md`.

## Later

- **The refactor lanes are unreviewed — thirteen open PRs, and they are Peter's
  to look at.** Nobody else can sign these off; the rules text each one produced
  has already landed in `docs/rules/`, so what is left is the code.
  - **Ten have a lane you can open** — `scripts/follow-lanes.sh` puts each on its
    own localhost port with a seeded page and a checklist:
    A #7 break rule · B #8 day summary · C #9 editor split · E #10 JCS ·
    F #12 API handler · G #15 cloud sync · H #17 dead exports · I #18 save
    orchestration · K #20 probe archive · L #21 drop `?waveVideo`.
    Ports run 5181 + the letter (A=5181 … L=5192).
  - **Three are docs-only and have no lane** — #6 probe triage, #19 zoom seam
    (assessed, nothing split), #26 overnight handoff. They change no source file,
    so a tab would render master; read them on GitHub.
  - Each of #6 and #19 ends in decisions only Peter can make (retiring the probe
    ARCHIVE bucket; keep or abandon `?waveVideo` with its 911 probe lines).
  - later · Carrie · 18 Sep 22:15 · parked on Peter, not claimable by a session

## Done

- **Commit stamps** — every commit carries `[name]` in the subject plus `Session:`
  and `Branch:` trailers. PR #29, merged `4a61a4d`.
