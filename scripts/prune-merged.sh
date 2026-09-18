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
#   3. Never touches master, HEAD, or any branch with even one commit not in master.
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
MASTER=$(git rev-parse origin/master) || exit 1

KEEP=0 GONE=0
for ref in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin); do
  case "$ref" in origin/master|origin/HEAD) continue ;; esac
  b=${ref#origin/}
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
  echo "$GONE deleted, $KEEP left alone (they have commits not in master)."
else
  echo "$GONE would be deleted, $KEEP left alone (they have commits not in master)."
  echo "Nothing has changed. Run again with --yes to do it."
fi
