#!/usr/bin/env bash
# Delete remote branches that are FULLY MERGED into master.
#
# For Peter, or any session on a machine whose git is not behind the cloud proxy.
# Cloud sessions cannot do this at all: `git push --delete` and the refs API both
# 403 through the agent proxy, and the GitHub MCP server exposes no branch-delete
# tool. That is a capability gap, not a permissions setting anyone can toggle.
#
#   ./scripts/prune-merged.sh          # list what WOULD be deleted, touch nothing
#   ./scripts/prune-merged.sh --yes    # actually delete them
#
# Safety, in order:
#   1. Refuses to run on a SHALLOW clone. A shallow clone presents its cut as the
#      repo root, so merge-base returns nothing for anything that forked earlier
#      and a fully merged branch reads as unrelated history — it would report
#      every branch as unmergeable and, run the other way, could hide a real one.
#   2. Re-verifies EVERY branch at delete time, not from a list written earlier.
#   3. Never touches the trunk, HEAD, or any branch with even one commit not in it.
# GitHub keeps a deleted branch restorable from its Branches page for a while, and
# the commits are in master's history regardless.
set -u

DO_IT=0
[ "${1:-}" = "--yes" ] && DO_IT=1

if [ -f "$(git rev-parse --git-dir)/shallow" ]; then
  echo "REFUSING: this is a shallow clone, so 'merged' cannot be answered here."
  echo "Run this first, then try again:   git fetch --unshallow origin"
  exit 1
fi

git fetch origin --prune --quiet || { echo "fetch failed"; exit 1; }

# ASK THE REMOTE which branch is the trunk. Hardcoding "master" was right for inkwave
# and silently wrong for MnemonicEcologies, whose default is "main" -- and the failure
# is not an error, it is `git rev-parse origin/master` exiting non-zero on a repo where
# the question was simply asked in the wrong language.
TRUNK=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
TRUNK=${TRUNK#origin/}
if [ -z "$TRUNK" ]; then
  TRUNK=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
fi
[ -n "$TRUNK" ] || { echo "REFUSING: cannot tell which branch is the trunk here."; exit 1; }
git rev-parse --verify --quiet "origin/$TRUNK" >/dev/null || {
  echo "REFUSING: origin/$TRUNK does not exist locally. Run: git fetch origin $TRUNK"; exit 1; }
echo "trunk: $TRUNK"
MASTER=$(git rev-parse "origin/$TRUNK") || exit 1

# The branch names that ACTUALLY EXIST on the remote right now. A remote-tracking
# ref is a local cache and can hold things that are not remote branches at all --
# Peter's checkout carries a packed `refs/remotes/origin` with no trailing path,
# whose short name is bare "origin", and an earlier cut of this script offered to
# delete it. Nothing on the remote matched, so it would have failed rather than
# destroyed anything, but a delete list must be built from the remote's own answer,
# not from what our cache happens to contain.
REMOTE=$(git ls-remote --heads origin | sed 's#.*refs/heads/##') || { echo "ls-remote failed"; exit 1; }
[ -n "$REMOTE" ] || { echo "REFUSING: the remote listed no branches at all."; exit 1; }

KEEP=0 GONE=0
for full in $(git for-each-ref --format='%(refname)' refs/remotes/origin); do
  # Full refname, never the short form: stripping "origin/" off a short name turns
  # the bare ref "origin" into the branch name "origin".
  case "$full" in refs/remotes/origin/*) ;; *) continue ;; esac
  b=${full#refs/remotes/origin/}
  case "$b" in "$TRUNK"|HEAD|"") continue ;; esac
  printf '%s\n' "$REMOTE" | grep -qxF "$b" || continue
  ref="$full"
  ahead=$(git rev-list --count "$ref" --not "$MASTER")
  if [ "$ahead" != 0 ]; then
    KEEP=$((KEEP+1))
    continue
  fi
  if [ "$DO_IT" = 1 ]; then
    if git push origin --delete "$b" >/dev/null 2>&1; then
      echo "deleted  $b"
      GONE=$((GONE+1))
    else
      echo "FAILED   $b  (no permission to delete refs from here?)"
    fi
  else
    echo "would delete  $b   (tip $(git rev-parse --short "$ref"), last commit $(git log -1 --format=%ad --date=short "$ref"))"
    GONE=$((GONE+1))
  fi
done

echo
if [ "$DO_IT" = 1 ]; then
  echo "$GONE deleted, $KEEP left alone (they have commits not in the trunk)."
else
  echo "$GONE would be deleted, $KEEP left alone (they have commits not in the trunk)."
  echo "Nothing has changed. Run again with --yes to do it."
fi
