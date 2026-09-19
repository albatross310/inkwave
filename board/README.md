# The board — noticeboard and backlog

Two files, managed by **Lambert** (project manager). Slack is where we talk;
this is where what was decided and what is still to do gets written down, so a
fresh session can catch up without reading a week of messages.

## `noticeboard.md` — what is true this week

Short. If it is longer than a screen it is not doing its job. One line per item,
dated, with the name of whoever added it. An item that stops being news is
deleted, not archived — if it was worth keeping it belongs in a rules file or a
commit message. Anyone may add; Lambert prunes.

## `backlog.md` — what the team is doing

The team's work queue, one line per item, under three headings:

    ## Doing      — claimed, in progress. Name and start date on every line.
    ## Next       — agreed, unclaimed. Claim by moving it to Doing with your name.
    ## Done       — moved here when the PR merges, with the PR number. Prune monthly.

Add an item the moment it is agreed, before starting it. Close it when the work
has landed, not when you have decided to do it. Lambert chases what stalls,
splits what is too big, and keeps the order honest; he is the only one who
reorders Next.

**Not the same as `iwbacklog.md`.** That file in the repo root is Peter's own
queue of bugs and wants, which he edits directly on GitHub and sessions answer
in place. Items graduate from there to `backlog.md` when someone claims them.

## Rules

- Edit on master, no branch, no PR — these are working files.
- Never delete someone else's Doing line. Ask them on Slack.
- Dates are Brisbane (AEST). Names are the session's roster name.
