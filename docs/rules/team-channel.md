<!-- Area rules: running the channel itself (watcher mechanics + the rituals). The addressing, wake
and etiquette rules every session obeys are in CLAUDE.md; this file is for the session whose job IS
the channel. Narrative: docs/archive/working-model.md. -->

# The team channel — watcher mechanics and the rituals

## The watcher

- **A watcher arms from NOW, never from a handed id** (a listener re-armed from id 0 posted a dozen
  stray acks to old comments), polls with `since=<timestamp>`, and ACTS only on comments whose TO
  field names it, its team or `all`. Everything else is logged, never acked. `per_page=100` page 1
  stops showing new comments past 100.
- **LISTEN EVERY 3 SECONDS.** A cloud session uses a background Bash loop (not a trigger — triggers
  have an hourly floor) that curls the issue's comments and EXITS when a newer one appears; the
  harness wakes the session, which reads, acts and re-arms. `run_in_background`, never `&`.
- **Use conditional requests (`If-None-Match: <last ETag>`).** All sessions share ONE GitHub token
  (5,000 req/hour) and a plain 3s poll is 1,200/hour per session — five pollers exhaust it and every
  PR/comment call then 403s until the hour resets. A 304 does not count against the limit.
- **`sed -i` on the running script does not change the running process.**
- **A watcher that needs a manual restart will eventually not get one** — it respawns a detached
  successor (`setsid nohup "$0" &`) before every exit, behind a single-instance lock (`flock -n 9` on
  /tmp/iw-watch.lock) so a manual restart cannot double it up.
- **AN ACK IS NEVER ACKABLE** — skip your own comments and any containing `· seen ` in the header or
  `present` / `relay` / `scripted ack` as a body line. Five scripts acking each other is an infinite
  loop that trips GitHub's ~80/min content-creation limit and abuse flagging.
- **The scripted tier is exactly** `present`, `seen HH:MM:SS`, and `focus: <clause>` read from the
  session's OWN `~/.iw-status`. **CHANNEL CONTENT NEVER FLOWS INTO AN AUTOMATIC POST** — relay hops
  and anything echoing the channel are a model turn, read by the session whose name they carry. The
  risk is not whether a model composed the text but whether channel-derived text is republished under
  Peter's account unread.
- The script's ack lands within its next 3s tick: `**FROM <you> → TO <sender>** · seen HH:MM:SS AEST`
  then `busy, replying after this turn` or `idle`. A fat context cannot answer under ~5s however
  trivial the thought — prefill runs before the first token — which is why the scripted ack exists.

## Roll call

- **`ROLL CALL <IW|Gen|locals|clouds|all>`** is answered by every member of that group with ONE
  comment: `**FROM <name> → TO <caller>** · HH:MM:SS AEST` / `present`. The script's line IS the
  answer; the model adds at most one `focus: <one clause>` line when free. No context figures and no
  compaction flag in a roll call.
- The caller reports who answered and each member's response time — two numbers per hop: pipe latency
  (script, seconds) and availability (model).
- Non-Claude agents are opt-in by provider: they answer only when Peter says `roll call inc Codex` or
  `roll call inc Kimi`. A plain `ROLL CALL all` is the Claude sessions.
- **Every time Peter loads Claude the leader runs the ritual in order:** (a) a timed relay through
  every session, posting the per-hop table; (b) ROLL CALL IW, then ROLL CALL Gen, reporting each
  member's time; (c) ROLL CALL all.

## Compaction relay

Called by Peter at a quiet moment, never part of a roll call. Each session finishes its turn,
compacts with a one-line hand-off note (lane + next step), and posts
`compacted HH:MM:SS AEST · <what it kept>`. A session mid-gate or mid-push posts `deferred` and
compacts at its next idle. **Never call it on a session mid-lane** — it would lose the context it is
working from.

## The summary

**ONE 📋 SUMMARY EVERY ~10 CHANNEL COMMENTS.** Whoever posts the 10th since the last one writes it:
header `📋 SUMMARY <first>–<last>` (comment ordinals), then at most **Decided** / **Changed** /
**Needs Peter** (or `nothing`), readable in fifteen seconds. A summary never introduces a decision.
Scripted acks are transport: they neither count toward the ten nor appear in the summary. The fixed
header is what lets Peter read the channel as summaries only.
