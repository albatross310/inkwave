# Hourly inline clock (Peter, 2026-09-17)

A `UserPromptSubmit` hook that prints the Brisbane time at most once an hour, so a long
session carries timestamps without one on every prompt. It shows the time to Peter
(`systemMessage`) and hands it to the model (`additionalContext`), so a session stamping
channel comments reads the clock rather than guessing.

Add to `~/.claude/settings.json` (merge, do not replace an existing `hooks` block):

```json
{
  "timeZone": "Australia/Brisbane",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 5,
            "command": "S=~/.claude/.last-clock; N=$(date +%s); L=$(cat $S 2>/dev/null || echo 0); if [ $((N-L)) -ge 3600 ]; then echo $N > $S; T=$(TZ=Australia/Brisbane date \"+%a %-d %b %H:%M AEST\"); printf \"{\\\"systemMessage\\\":\\\"🕐 %s\\\",\\\"hookSpecificOutput\\\":{\\\"hookEventName\\\":\\\"UserPromptSubmit\\\",\\\"additionalContext\\\":\\\"Current time is %s (Brisbane).\\\"}}\" \"$T\" \"$T\"; fi"
          }
        ]
      }
    ]
  }
}
```

**The gate is a state file**, `~/.claude/.last-clock`, holding the epoch seconds of the last
stamp. Delete it to force the next prompt to stamp. One state file per machine, so two
sessions on the same Mac share the hour rather than each printing their own.

**Verify before trusting it**: `echo '{}' | bash -c '<the command>'` prints the JSON on the
first run and nothing on the second. A hook that silently does nothing looks identical to a
hook that is not installed.

**`/hooks` must be opened once** (or Claude Code restarted) for a newly created settings file
to be picked up — the config watcher only watches directories that had a settings file when
the session started.

**The simpler alternative, if an hourly gate stops mattering**: `showMessageTimestamps: true`
with `timeZone` and `timeFormat` are built-in settings and stamp every message, no hook.
