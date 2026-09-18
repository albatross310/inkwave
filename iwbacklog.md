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

- **`yes`** — it is yours. Move the item to `## Doing` and keep the yes line with it.
- **`no`** — **and you must name who it goes to next** (`→ Lambert`). A `no` that
  names nobody is a silent drop wearing a decision's clothes; the item then sits
  looking answered while nobody owns it. If you genuinely do not know who should
  have it, that is `→ Peter`, which is a real answer.
- **`later`** — you will take it, but not yet. Say what you are waiting for, so
  the next reader knows whether the blocker has cleared.

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

**Carrie sweeps `## Doing` once a day** and nudges anything that has gone quiet.
That is why claims carry a date.

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
  - no · Carrie · 18 Sep 18:30 · the proxy 403s ref deletion and tag writes from a
    container, so no cloud session can do this → Max, or Peter in two clicks on the
    repo's Branches page, which offers Restore afterwards
- **Review `feat/hybrid-zoom`, `feat/zoom-magnify`, `fix/firefox-favicon`
  individually.** July branches holding 8 commits that exist on no other ref:
  hybrid one-axis editor zoom, snapshot "biggest change" scrub, transform-magnify
  below fit, and the userSpaceOnUse-gradient favicon Firefox cannot rasterise.
  The work may have been redone since; nobody has checked.
- **`T + B` and `P` are undefined in the glossary.** Both came from Peter's
  replies to the desktop toolbar review. Max to confirm the expansions —
  unconfirmed guesses stay out, per `docs/rules/glossary.md`.

## Later

- **Thirteen refactor lanes (PRs #7–#21) are unreviewed.** Peter's, when he has a
  clear run at them. Rules text already landed in `docs/rules/` on each.

## Done

- **Commit stamps** — every commit carries `[name]` in the subject plus `Session:`
  and `Branch:` trailers. PR #29, merged `4a61a4d`.
