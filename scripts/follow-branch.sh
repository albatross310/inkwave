#!/usr/bin/env bash
# Follow a cloud session's branch on your own machine: pull every 5s and keep `pnpm dev` up,
# so every push from a Claude Code cloud session shows on http://localhost:5173 via HMR without a
# hand in it (Peter, 2026-09-15: "test on localhost all the changes you make on the cloud
# automatically"). Usage:  scripts/follow-branch.sh <branch> [interval-seconds]
# Runs in a THROWAWAY worktree (../inkwave-follow) so it never touches the checkout you write in —
# see CLAUDE.md "NEVER share a checkout". Ctrl-C stops both the puller and the dev server.
set -u
BRANCH="${1:?usage: scripts/follow-branch.sh <branch> [interval]}"
EVERY="${2:-5}"
ROOT="$(git rev-parse --show-toplevel)"
WT="$ROOT/../inkwave-follow"

git -C "$ROOT" fetch -q origin "$BRANCH" || { echo "no such branch on origin: $BRANCH"; exit 1; }
if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q "$WT" "origin/$BRANCH" --detach
fi
cd "$WT"
pnpm install --frozen-lockfile >/dev/null 2>&1

pnpm dev &
DEV=$!
trap 'kill $DEV 2>/dev/null; exit 0' INT TERM

last=""
while kill -0 $DEV 2>/dev/null; do
  git fetch -q origin "$BRANCH" 2>/dev/null
  head="$(git rev-parse "origin/$BRANCH")"
  if [ "$head" != "$last" ]; then
    git checkout -q --detach "$head"
    # a lockfile change means new deps; HMR cannot cover that
    git diff --quiet "${last:-$head}" "$head" -- pnpm-lock.yaml || pnpm install --frozen-lockfile >/dev/null 2>&1
    echo "[follow] $(date +%H:%M:%S) now at ${head:0:7}: $(git log -1 --format=%s "$head")"
    last="$head"
  fi
  sleep "$EVERY"
done
