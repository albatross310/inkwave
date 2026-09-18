<!-- Area rules: running lanes and the localhost tabs. CLAUDE.md carries the one-line universal form.
Narrative: docs/archive/working-model.md. -->

# Lanes, the localhost tabs and the seeded document

- **Every cloud lane gets a row in `scripts/lanes.tsv`** — lane letter, branch, PR number,
  tab-separated — **when it opens its PR**, plus `scripts/lanes/<L>.json`
  (`{title, paragraphs, checks}`): that PR's plain-English summary and a ☐ checklist. **A lane
  without a row is one Peter cannot open; a row without a JSON file opens on text that tells him
  nothing.**
- `scripts/follow-lanes.sh` runs each row in its own throwaway worktree (`../inkwave-lane-<L>`) on a
  FIXED port — **A=5181, B=5182, C=5183, D=5184, E=5185, F=5186, G=5187** — pulling every 5s and
  opening `http://localhost:<port>/?seed`. The single-branch `scripts/follow-branch.sh` serves 5173
  with no lane.
- **The tab title and favicon are the BARE LANE LETTER** (`VITE_LANE`, unset in prod) so Peter flicks
  between tabs by letter; the PR number lives in `lanes.tsv` and the start-up table, not the tab.
- **The favicon must be a REAL URL** — `scripts/laneIcon.mjs` bakes a PNG served at
  `/__lane-icon.png?l=A`, and `root.tsx`'s `links()` points at it **in DEV generally**, not only when
  `VITE_LANE` is set: no lane means the main dev server, which wears `iω` on an inverted ground so a
  localhost tab is never mistaken for live iwzero.me. **Safari never repaints a tab icon swapped at
  runtime**; a fresh `<link>` href at page load is the only thing it honours. Dev also serves its own
  `/__lane-manifest.webmanifest`, so an installed localhost PWA carries the lane in its Dock name.
- **A new lane letter needs a GLYPH** — `FONT` covers A–Z; it covered A–L while `lanes.tsv` already
  had lane M, and M rendered a blank square. `src/dev/devIcon.test.ts` holds every letter in
  `lanes.tsv` against the font, so the table can never again name a lane the icon cannot draw.
- `?seed` is DEV-only (`src/dev/seedDocument.ts`), reachable only from the absence path, never Peter's
  prose. `?seed=fresh` always mints a NEW seeded document for the tab — plain `?seed` leaves an
  existing one alone, which is how a tab ends up showing stale sample text.
- **A seeded document lands as ONE write and therefore has ◈ 0** — snapshots mint only when text
  arrives in chunks (a paragraph, Enter, a pause), never on a whole-document insert. A lane whose
  checklist needs a snapshot must open with "type a paragraph yourself" as its first step; the seed
  cannot do it for him.
- Cloud sessions: `.claude/hooks/session-start.sh` (under `CLAUDE_CODE_REMOTE`) does a frozen install,
  `react-router typegen`, and starts the dev server on `0.0.0.0:5173` for the session's own headed
  browsers (Chromium/Firefox/WebKit under `xvfb-run -a`; the proxy CA must be in Chromium's NSS store
  or every HTTPS load is `ERR_CERT_AUTHORITY_INVALID`). Traps: `| tail` on a multi-engine run hides
  everything until the LAST engine exits; `pkill -f firefox` kills YOUR OWN shell when its command
  line contains the word; `codeload.github.com` tarballs are 403'd by the egress policy, so a git-URL
  dependency will never install here.

## Running the lanes (the lead's rules)

- **KEEP AT LEAST 5 AGENTS RUNNING** whenever there is work left that doesn't need Peter — the
  bottleneck is his attention, not the machine: a lane that finishes while he sleeps costs nothing, an
  idle lane costs a night. Treat dropping below five as a bug in the session and refill without being
  asked. **Two exemptions, only two:** no work left that doesn't need him, and a lane blocked on a
  decision only he can make (say it is blocked and on what; never spawn filler to hit the number).
  **6 lanes is the observed safe ceiling** (13 OOM'd WSL2 at its 7GB default; `.wslconfig` now allots
  11GB + 8GB swap). If lanes start dying, suspect memory before suspecting the code.
- **Batch the reporting — protect Peter's focus.** He writes while agents run, and every notification
  breaks his concentration. Do NOT ping per-merge: merge each through the full gate as it lands with a
  bare non-message turn-ending, and send ONE consolidated report when ALL agents are done. Default to
  the quietest cadence unless he is actively testing. Final reports open with the sentinel
  **📋 REPORT** so his hook can sound them differently.
- **Keep agents alive with their memories intact — always.** Never discard an agent's context: resume
  completed or failed agents via SendMessage (their transcripts restore full context) rather than
  spawning fresh ones for follow-ups in the same domain; salvage worktrees and transcripts when an
  agent dies; preserve agent worktrees until their work is merged.
- Merges run serially into master through the full gate; Peter tests live on iPhone + desktop and
  reports in batches.
