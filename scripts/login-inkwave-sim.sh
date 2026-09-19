#!/usr/bin/env bash
# On login: bring up Inkwave in the iOS simulator, with no Claude session involved.
#
# Deliberately not owned by a session. A session has to be running to do anything,
# and at login none is — the same reason the channel doorbell cannot be permanent
# while the pollers can. launchd is the right layer for "every time I log in".
#
# Chain: dev server on :5173 -> simulator booted -> Safari opened at the app.
#
# ⚠ THE COPY THAT RUNS IS NOT THIS ONE. launchd (~/Library/LaunchAgents/com.inkwave.max.sim.plist)
#   executes ~/.inkwave-max/login-inkwave-sim.sh on Peter's Mac, by absolute path. That is
#   deliberate: a hook that runs at login must not depend on a checkout that may be mid-rebase,
#   half-cloned or on another branch. This file is the SOURCE OF RECORD — edit here, then copy to
#   ~/.inkwave-max/ and the change takes effect at the next login.
#   The two drifted once already (2026-09-17 to 09-19: this copy still said iPhone 17 Pro while the
#   running one had moved to the iPhone 12 bench), and nothing could detect it, because no test and
#   no plist reads this path. If you change the device here, change it there in the same breath.
set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT="/Users/a/inkwave"
PORT=5173
DEVICE="iPhone 12"
LOG="$HOME/Library/Application Support/mnemonicecologies/login-inkwave-sim.log"
mkdir -p "$(dirname "$LOG")"
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

log "--- login run ---"

# 1. Dev server. Reuse whatever is already serving :5173 rather than starting a
#    second copy — the lane servers occupy 5180-5192 and a duplicate here would
#    just fail to bind.
if curl -s -o /dev/null --max-time 3 "http://localhost:$PORT"; then
  log "dev server already up on :$PORT"
else
  log "no server on :$PORT — starting pnpm dev"
  cd "$PROJECT" || { log "FATAL: $PROJECT missing"; exit 1; }
  nohup pnpm dev --host >> "$LOG" 2>&1 &
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "http://localhost:$PORT" && break
    sleep 2
  done
  curl -s -o /dev/null --max-time 3 "http://localhost:$PORT" \
    && log "dev server came up after ~$((i*2))s" \
    || { log "FATAL: dev server did not come up within 120s"; exit 1; }
fi

# 2. Simulator. simctl boot exits non-zero if already booted, which is not an error.
state=$(xcrun simctl list devices | grep -F "$DEVICE (" | head -1)
case "$state" in
  *Booted*) log "simulator already booted" ;;
  *) xcrun simctl boot "$DEVICE" 2>/dev/null ;;
esac

# `simctl list` reports Booted as soon as the device object exists, well before
# the system inside it can accept a command — opening a URL at that point fails
# with "Invalid device state / server died". bootstatus blocks until the device
# is genuinely ready, which is the difference between the state flag and the
# thing the flag is supposed to mean.
if xcrun simctl bootstatus "$DEVICE" -b >>"$LOG" 2>&1; then
  log "$DEVICE fully booted"
else
  log "FATAL: bootstatus did not reach ready"; exit 1
fi

open -a Simulator 2>/dev/null

# 3. Open the app. The simulator shares the host's network stack, so plain
#    localhost reaches the Mac's dev server.
#
# Launch Safari FIRST. On a freshly booted device with Safari not running,
# `openurl` returns 0 and leaves a black screen — it succeeds at handing off the
# URL and there is nothing there to receive it. Another exit code that is not an
# outcome.
xcrun simctl launch booted com.apple.mobilesafari >>"$LOG" 2>&1
sleep 3

if xcrun simctl openurl booted "http://localhost:$PORT" 2>>"$LOG"; then
  log "opened http://localhost:$PORT in simulator Safari"
else
  log "FAILED to open URL in simulator"
  exit 1
fi

log "done"
