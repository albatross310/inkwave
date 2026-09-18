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

**Carrie chases, on a clock.** An item is overdue 30 minutes after the later of
its own deadline (now for a bare `yes`, the stated time for an `eta`) and the last
time its owner delivered anything from this backlog — so a session that is visibly
working the queue is not nagged for being mid-stride. Peter's reason for the grace
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

- **Delete ten merged branches.** Verified merged on a full clone and recorded in
  `docs/archive/merged-branches.md` with their tips.
  - no · Carrie · 18 Sep 20:25 · **no cloud session can do this at all** — checked
    three routes: `git push --delete` 403s, the refs API 403s ("write access to this
    path is not permitted through this proxy"), and the GitHub MCP server exposes no
    branch-deletion tool. Not a quota or an availability problem, so reassigning it
    between cloud sessions cannot help → **Peter**, two clicks on the repo's Branches
    page, which offers Restore right afterwards; or Max once he is back, from a Mac
    whose git is not behind the proxy. I own chasing it, not doing it.
- **Review `feat/hybrid-zoom`, `feat/zoom-magnify`, `fix/firefox-favicon`
  individually.** July branches holding 8 commits that exist on no other ref:
  hybrid one-axis editor zoom, snapshot "biggest change" scrub, transform-magnify
  below fit, and the userSpaceOnUse-gradient favicon Firefox cannot rasterise.
  The work may have been redone since; nobody has checked.
- **Two `CLAUDE.md` files, one in Inkwave and one in MnemonicEcologies, and it is
  confusing which a session is reading.** Peter, 18 Sep 21:20. They serve different
  repos but share a name, a voice and several rules (the roster, the channel format,
  Brisbane time), so a session that has read one can believe it has read the other.
  Worth deciding what is genuinely shared and where the shared part should live.
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
