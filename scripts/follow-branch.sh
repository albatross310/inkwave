#!/usr/bin/env bash
# Follow a cloud session's branch on your own machine: pull every 5s and keep `pnpm dev` up,
# so every push from a Claude Code cloud session shows on localhost via HMR without a hand in it
# (Peter, 2026-09-15: "test on localhost all the changes you make on the cloud automatically").
#
#   scripts/follow-branch.sh <branch> [interval-seconds]
#
# Env (all optional; scripts/follow-lanes.sh sets them per lane):
#   LANE=A      lane letter → worktree ../inkwave-lane-A and port 5180+index (A=5181 … G=5187)
#   PR=7        PR number (printed in the table only; the tab title is the bare lane letter)
#   PORT=5181   explicit port (overrides the LANE-derived one; default 5173)
#   SEED=1      open http://localhost:<port>/?seed once the server answers (dev-only sample text)
#   OPEN=0      do not open a browser tab
#
# Runs in a THROWAWAY worktree so it never touches the checkout you write in — see CLAUDE.md
# "NEVER share a checkout". Ctrl-C stops both the puller and the dev server.
set -u
BRANCH="${1:?usage: scripts/follow-branch.sh <branch> [interval]}"
EVERY="${2:-5}"
ROOT="$(git rev-parse --show-toplevel)"

LANE="${LANE:-}"
if [ -n "$LANE" ]; then
  # A–Z, matching scripts/follow-lanes.sh's port formula (5181 + letter - 'A'). It was A–J while
  # lanes.tsv already carried lane M, so `follow-lanes.sh` computed M's port and then this refused
  # to start it — the lane was in the table and unopenable.
  LETTERS=ABCDEFGHIJKLMNOPQRSTUVWXYZ
  idx="${LETTERS%%$LANE*}"; idx="${#idx}"
  [ "$idx" -lt "${#LETTERS}" ] || { echo "LANE must be a single letter A–Z"; exit 1; }
  PORT="${PORT:-$((5181 + idx))}"
  WT="$ROOT/../inkwave-lane-$LANE"
  export VITE_LANE="$LANE"
  # The lane's own summary + checklist for the ?seed page (scripts/lanes/<L>.json, kept by the
  # parent session beside lanes.tsv). Read from ROOT, not the worktree, so it is never behind.
  [ -f "$ROOT/scripts/lanes/$LANE.json" ] && export VITE_LANE_SEED="$(cat "$ROOT/scripts/lanes/$LANE.json")"
else
  PORT="${PORT:-5173}"
  WT="$ROOT/../inkwave-follow"
fi
URL="http://localhost:$PORT/${SEED:+?seed}"

git -C "$ROOT" fetch -q origin "$BRANCH" || { echo "no such branch on origin: $BRANCH"; exit 1; }
if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q "$WT" "origin/$BRANCH" --detach
fi
cd "$WT"
pnpm install --frozen-lockfile >/dev/null 2>&1

pnpm dev --port "$PORT" &
DEV=$!
trap 'kill $DEV 2>/dev/null; exit 0' INT TERM
echo "[follow${LANE:+ $LANE}] $BRANCH → $URL"

# Open the tab once the server answers (macOS `open`, else xdg-open), never before.
if [ "${OPEN:-1}" != "0" ]; then
  ( for _ in $(seq 1 60); do
      if curl -sfo /dev/null "http://localhost:$PORT/"; then
        command -v open >/dev/null && open -g "$URL" || xdg-open "$URL" 2>/dev/null  # -g: quietly, in the background
        break
      fi
      sleep 1
    done ) &
fi

last=""
while kill -0 $DEV 2>/dev/null; do
  git fetch -q origin "$BRANCH" 2>/dev/null
  head="$(git rev-parse "origin/$BRANCH")"
  if [ "$head" != "$last" ]; then
    git checkout -q --detach "$head"
    # a lockfile change means new deps; HMR cannot cover that
    git diff --quiet "${last:-$head}" "$head" -- pnpm-lock.yaml || pnpm install --frozen-lockfile >/dev/null 2>&1
    echo "[follow${LANE:+ $LANE}] $(date +%H:%M:%S) now at ${head:0:7}: $(git log -1 --format=%s "$head")"
    last="$head"
  fi
  sleep "$EVERY"
done
