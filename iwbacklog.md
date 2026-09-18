# Inkwave backlog

**Peter: add a line under `## Next` or `## Later` and stop there.** No format, no
tags, no ticket number — one sentence is a valid entry, and a half-remembered one
is better than none. Everything else in this file is the team's job: claiming,
sizing, moving things between sections, closing them out. Edit it straight on
GitHub; you never need to ask a session to write something down for you.

Ask **"what's next on the backlog"** and you get the top of `## Next`.

House rules for sessions, so the file stays cheap and honest:

- **Do not read this file as part of your standing context.** CLAUDE.md points at
  it deliberately rather than inlining it — what a session reads is re-sent on
  every later turn, so a growing backlog in everyone's context is a tax that
  compounds all day. Read it when asked, or when you go looking for work.
- **Claiming is moving the line to `## Doing` with your name on it**, in a commit.
  Two sessions on one item is the failure this prevents, and the commit is what
  makes the claim visible to someone who has not read the channel.
- **Never delete Peter's line.** Closing an item means moving it to `## Done`
  with the PR or commit that closed it. A deleted line looks exactly like an item
  nobody ever raised.
- **Never reword an item into what you think he meant.** If a line is ambiguous,
  ask in the channel and put his answer under it, indented. The glossary rule
  applies here too: an invented reading reads as settled to the next session.

---

## Doing

_(nothing claimed)_

## Next

- **Delete ten merged branches.** Verified merged on a full clone and recorded in
  `docs/archive/merged-branches.md` with their tips. A cloud container cannot do
  it — the proxy 403s ref deletion and tag writes — so this needs Max, or Peter
  two clicks on the repo's Branches page, which offers Restore afterwards.
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
