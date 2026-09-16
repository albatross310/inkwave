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
ports=()
printf '%-5s %-7s %-6s %s\n' LANE PORT PR BRANCH
while IFS=$'\t' read -r lane branch pr; do
  case "$lane" in ''|\#*) continue ;; esac
  [ "$want" = "  " ] || [[ "$want" == *" $lane "* ]] || continue
  port=$((5181 + $(printf '%d' "'$lane") - 65))
  printf '%-5s %-7s %-6s %s\n' "$lane" "$port" "${pr:-—}" "$branch"
  LANE="$lane" PR="${pr:-}" SEED=1 OPEN=0 "$ROOT/scripts/follow-branch.sh" "$branch" > "/tmp/inkwave-lane-$lane.log" 2>&1 &
  pids+=($!); ports+=("$port")
done < "$TABLE"
[ "${#pids[@]}" -gt 0 ] || { echo "no lanes matched in $TABLE"; exit 1; }
echo "logs: /tmp/inkwave-lane-<LANE>.log — Ctrl-C stops all"
# Open every tab from HERE, in the foreground, once each server answers — the per-lane open inside a
# backgrounded follow-branch.sh never fired on the Mac (Max, 2026-09-16), and Peter needs the tabs
# in his Safari, not a report that they were opened.
for port in "${ports[@]}"; do
  for _ in $(seq 1 90); do curl -sfo /dev/null "http://localhost:$port/" && break; sleep 1; done
  url="http://localhost:$port/?seed"
  if command -v open >/dev/null; then open -a Safari "$url" 2>/dev/null || open "$url"; else xdg-open "$url" 2>/dev/null; fi
  echo "opened $url"
done
trap 'kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM
wait
