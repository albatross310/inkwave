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
#
# ⚠ NEVER OPEN A TAB THAT IS ALREADY OPEN (Peter, 2026-09-17: "someone keeps making a billion new
# Inkwave localhost tabs"). This script opens one tab per lane EVERY TIME IT STARTS, and the Mac
# session restarts it on a timer while the LaunchAgents are unloaded — twelve tabs a half-hour,
# for weeks if nobody looks. Ask Safari what it already has and skip those ports. `open` on a URL
# Safari already holds does NOT focus the existing tab, it mints another one, so the check has to
# happen here. REOPEN=1 forces a fresh tab (after a branch moves and the seed must be re-minted).
open_ports() {
  osascript -e 'tell application "Safari" to get URL of every tab of every window' 2>/dev/null | tr ',' '\n'
}
already="$(open_ports)"
for port in "${ports[@]}"; do
  for _ in $(seq 1 90); do curl -sfo /dev/null "http://localhost:$port/" && break; sleep 1; done
  url="http://localhost:$port/?seed=fresh"
  if [ "${REOPEN:-0}" != 1 ] && printf '%s' "$already" | grep -q "localhost:$port"; then
    echo "already open, skipped $port"; continue
  fi
  # -g: open QUIETLY in the background — never steal Peter's focus or raise Safari over his screen.
  if command -v open >/dev/null; then open -g -a Safari "$url" 2>/dev/null || open -g "$url"; else xdg-open "$url" 2>/dev/null; fi
  echo "opened $url"
done
trap 'kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM
wait
