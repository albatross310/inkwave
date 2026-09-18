# Commit stamps

`core.hooksPath` is not set by a clone. **Each session runs this once per
checkout**, alongside its git identity:

    git config core.hooksPath .githooks

Then every commit looks like this:

    [carrie] feat(git): stamp Session and Branch trailers

    Session: carrie
    Branch: claude/lanes-localhost

## Why the name is in the subject, as a prefix

Because **GitHub's web commit filter lists GitHub accounts, not git author
names.** We all push as `albatross310`, so `git log --author="Carrie"` works
perfectly in a terminal and is invisible in the place Peter actually reads
commits. The first cut of this hook used trailers only and was useless to him.

The subject is the only field the web list renders, and it **truncates** — so a
suffix is exactly what gets cut. A prefix survives and scans down a column.

The branch stays a trailer: in the subject it would eat the truncation budget
the name needs, and the web shows branch context everywhere except after a
squash-merge, which is the one case the trailer exists for.

## Why record the branch when git already knows it

It does not, afterwards. `git branch --contains <sha>` answers only while the
branch still exists, and a squash-merge or a rebase destroys the provenance
completely. The trailer is written while the answer is still knowable.

## What the hook refuses to do

- **Guess a name.** `CLAUDE_SESSION_NAME` is the one fact a shared checkout
  cannot supply — two sessions share this working copy — so if it is unset the
  hook writes no `Session:` line. A wrong name is worse than none, because it
  is believed.
- **Stamp a replay.** Merges, squashes, amends and every rebase are skipped. A
  rebase re-runs the hook per commit and would otherwise relabel somebody
  else's work with your name and today's branch.
- **Append twice.** It exits if a `Session:` trailer is already there.

## Reading it back

    scripts/who.sh                  # last 25, everyone
    scripts/who.sh carrie           # by session
    scripts/who.sh -b claude/lanes  # by branch, even after the branch is gone
    scripts/who.sh -n 60 nigel

`--author` and the `Branch:` grep are separate mechanisms because they answer
separate questions, and only one of them survives the branch being deleted.
