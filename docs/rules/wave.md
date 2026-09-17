<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Wave / water system

Rounds, the wave-video ladder, the refuted desync hypothesis: `docs/archive/wave-system-rounds.md`.
**EVERY RULE BELOW WAS A LIVE BUG.**

**The wave video itself was REMOVED 2026-09-16** (Peter's ruling, decision 2 in
`docs/REFACTOR-QUEUE.md`): `?waveVideo` never graduated (unresolved desync), and `waveVideo.ts`, the
`public/wave/*.mp4` rungs, the SW's `/wave/` Range path and its six probes went together. The rules
below that name the video (`iw-wave-video-on`, `pickRung`, the tile rung) are kept as written — each
was a live bug, and each is about the CSS water's own hand-offs too; read them as the lesson's
origin, not as a description of shipped code.

- **`--iw-water-gradient` is the single background source** (CSS `165deg`; `#302438` → `#41425b` 18%
  → `#3b606a` 88% → `#3b6f75`), with one warm-ivory `#f3edcf` for marks, specks and sparkles. No
  per-surface gradient copies. Wave SVGs carry no vertical colour gradient — weight and opacity give
  depth. Before the atomic reveal, day mode paints pure white.
- **Playback is COMPOSITOR-ONLY** — precomputed, no per-frame JS. Exactly two control events cross
  from the app: START (the prerendered `.iw-wave-anim` class) and SETTLE (`inkwave:reveal-imminent`).
- **ONE backstop only: a loud 30s watchdog**, which must never fire on a healthy load — no short
  wall-clock cap. `window.__iwWaterGate.reason` records `complete`/`no-surface`/`timeout`.
- **The marks are one immutable, checked-in scene** (`waveSceneData.ts`, from the fixed-seed
  `scripts/generate-wave-scene.mjs`). Runtime randomness, canvas rasterisation, async art decode,
  server-fed instructions, respawn and duplicate blink/rest populations are FORBIDDEN. ≥180px
  horizontal separation per band; each dash stores its exact local wave tangent; the browser mounts
  the whole table synchronously before the gate opens.
- **A dash's x/y is its CENTRE** — render with `translate(-50%, -50%)` before its rotation. Each centre
  sits a generated `10–20px` BELOW the thick wave (`offsetY`, positive screen-y); a uniform gap or an
  on-wave/negative offset is a regression.
- **Intro objects have exactly one finite opacity window and never reappear.** Objects own opacity
  only; the two group fields own all spatial motion, via the same named CSS drift + additive coast
  animations as the wave tiles. **Never add a parent/field opacity transition.**
- **`WAVE_MARK_PLAYBACK_RATE = 2` scales mark opacity ONLY** — never fields or wave drift.
- **Keep the paused-at-zero pre-gate and the resolved-clock reassertion** — pre-gate CSS keeps spatial
  animations paint-hidden and paused at currentTime 0 (not `display:none`), and
  `waveTwinkle.alignFieldClocks` binds each field once and reasserts after both pending animations
  resolve (WebKit's provisional-startTime rewrite).
- **The rest population is a pure spatial loop: `scrollTop mod 2240px`** — independent of time,
  velocity, viewport, geometry and zoom; the same absolute scrollTop must reproduce the same state.
  `setScrollScene` only for genuine user/PDF scroll. Resize CLIPS the fixed 2800×1680 scene — never
  regenerate or horizontally centre it. The field starts at `-280px`, an exact two-tile offset.
- **Shell → editor is an ATOMIC water-ownership swap, never a cross-fade** (two translucent copies
  must never be visible together, and hiding one while fading the other is equally wrong).
  `inkwave:editor-revealed` is dispatched in the same task as `setSettled(true)`. Phone keeps its
  separate keep-shell-until-rest rule.
- **NOTHING MAY WRITE TO THE DOM BEFORE HYDRATION** — a pre-hydration append triggers React #418/#423
  and React then REPLACES the `<html>` ELEMENT, losing `.iw-water-ready` and `data-theme` for the
  session. Wait behind `hydrated()`.
- **Only ever wait on a signal that ALWAYS arrives, and make it ASKABLE** — check state and subscribe
  in ONE synchronous block (`__iwHydrated`, `libraryReady()`). Never paper over it with a timeout.
- **Correctness of a feature must not depend on another feature succeeding** — use the guaranteed
  hydration beacon, not another pool's event.
- **A `reason`/status field that only some code paths write is a field that LIES** — discriminate a
  hang from a stall by which fields are POPULATED.
- **Sentinel values must not masquerade as measurements** — require `readyState >= 2` AND a real delta.
- **Never hold `document.documentElement`** — resolve it at every use, observe `document` itself.
- **Ask the LAYOUT ENGINE whether something painted** (box/display/visibility/opacity), never the
  decoder.
- **An alarm that fires on the healthy path trains Peter to distrust the instrument.**
- **`iw-wave-video-on` must be DERIVED from a live element, never latched.**
- **Any on-device overlay whose screenshots may cross a deploy must print `__BUILD_COMMIT__`**
  (Settings footer + console carry it, from vite.config.ts).
- **The tile must be 140 CSS px at every viewport** — never `object-fit: cover`; size the element to
  the chosen rung's DESIGN box with `fill` and let the viewport crop. `pickRung` returns the SMALLEST
  rung of the right device class that COVERS the viewport, never one a phone must decode past H.264
  Level 4.0.
- **Brakes are born CSS-PAUSED and started at a FORWARD anchor** (`t_a = currentTime + 150ms`) —
  engines resolve pending CSS animations at STYLE time. The drift is never stopped; the brake
  composites over it.
- **A surface mounting mid-load ADOPTS the reference surface's drift `startTime` and must RETRY until
  that surface commits** — a `sibling != null` check that runs too early skips adoption forever and
  throws every mark off its crest.
- **Re-assert an adopted `startTime` at each animation's `ready`** (a write to a play-pending CSS
  animation is clobbered when the pending start resolves).
- **Never create-then-re-clock mark tracks on VISIBLE water** — gate creation on `clockReady()`.
- **`--wave-x` must never invalidate the page subtree.** Firebreak it to `0px` on `.iw-magnify-box` /
  `.scroll-paper` / `.iw-wave-twinkles`; twinkle fields take LITERAL transforms via `swayFields()`. A
  new `var(--wave-x)` consumer must not sit under the firebreak roots.
- **In-flow surfaces get PANE-SCOPED water and it must stay UNPROMOTED** (`will-change: auto`,
  `transform: none`); `/snapshot` writes no sway.
- **A twinkle field wakes only on SUSTAINED scroll** (two reports within 200ms).
- **Dashes never respawn when they blink** — reappearance is opacity-only at the same permanent
  wave-relative position.
- **⚠ NAMED OPEN QUESTION, deliberately not closed:** `writeWave()` re-writes `--wave-x` and
  `swayFields()` on zoom-hold frames where the value is provably unchanged. Skipping identical writes
  would strand a field that MOUNTS in the skipped window. **What would license it:** an on-device
  capture showing no dropped transform on a field created mid-gesture AND a measured frame-time win —
  or making `swayFields` idempotent for new leaves. Do not close it by reasoning.
- **⚠ KNOWN RESIDUALS (Peter, live, build `72783da`):** occasional blue flash, white lines briefly
  lagging their wave, worst on phone then Chrome. Probes pass 9/9 — real-device raster scheduling a
  GPU-less headless box cannot see. **The next wave round starts HERE, not from "all green"**; the
  clock hypothesis is REFUTED. Next tool is on-device capture.
- PROBE RULES: `/snapshot` needs a fallback-faithful static server; never `pkill` a shared
  `vite preview`; no windows over Peter's screen (`scripts/pw-headed.sh`); the wave-desk probes need
  `scripts/wave-desk/server.mjs` (via `autoserve.mjs`) — the scrub-probe server has no Range/206.

