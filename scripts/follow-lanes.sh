#!/usr/bin/env bash
# Run EVERY lane in scripts/lanes.tsv on its own localhost port and open each in a tab with sample
# text (Peter, 2026-09-16: "tell local inkwave to open them all for me with some example text").
#
#   scripts/follow-lanes.sh            # all lanes in lanes.tsv
#   scripts/follow-lanes.sh A C        # only these lanes
#
# Port is fixed by lane letter (A=5181 … G=5187) and the tab title reads "<pr>/<lane>", so the URL
# and the tab both say which PR you are looking at. Ctrl-C stops every lane.
set -u
ROOT="$(git rev-parse --show-toplevel)"
TABLE="$ROOT/scripts/lanes.tsv"
want=" $* "
pids=()
printf '%-5s %-7s %-6s %s\n' LANE PORT PR BRANCH
while IFS=$'\t' read -r lane branch pr; do
  case "$lane" in ''|\#*) continue ;; esac
  [ "$want" = "  " ] || [[ "$want" == *" $lane "* ]] || continue
  port=$((5181 + $(printf '%d' "'$lane") - 65))
  printf '%-5s %-7s %-6s %s\n' "$lane" "$port" "${pr:-—}" "$branch"
  LANE="$lane" PR="${pr:-}" SEED=1 "$ROOT/scripts/follow-branch.sh" "$branch" > "/tmp/inkwave-lane-$lane.log" 2>&1 &
  pids+=($!)
done < "$TABLE"
[ "${#pids[@]}" -gt 0 ] || { echo "no lanes matched in $TABLE"; exit 1; }
echo "logs: /tmp/inkwave-lane-<LANE>.log — Ctrl-C stops all"
trap 'kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM
wait
