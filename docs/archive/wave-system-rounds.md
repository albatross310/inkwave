# Wave / water system — the rebuild and its rounds (2026-07-11 → 2026-07-18)

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "Wave / water system"; that entry points
here.

Peter's brief for the rebuild, verbatim: *"just sine waves, some stochastic glitters and wave marks
from a precalculated data pool, and an S-curve slow down — all of which on a different workflow to
whatever has to load so it doesn't get interrupted."*

Two things make this file worth keeping. First, **every invariant in the CLAUDE.md entry was a live
bug** — the list reads like preference and is not. Second, the wave video rounds are the best
worked example in the repo of an **instrument lying in the direction of "the feature is broken"**:
an overlay reported `advancing YES (real decode)` for a video holding no data, printed a stale
`reason` that sent two rounds chasing a released barrier, showed red on a healthy run because a
completed hand-off looks identical to a video that never ran, and its screenshots crossed a deploy
with no build marker to say so. A separate round then REFUTED the standing "marks are out of sync
with the waves" clock hypothesis by measurement (0.00px on 4/5 loads) — WAAPI and CSS animations
share `document.timeline`, so a clock difference was never available as an explanation.

---

## Wave / water system (REBUILT 2026-07-11 — Peter's strip-down)

Peter's spec, verbatim intent: "just sine waves, some stochastic glitters and wave marks from a
precalculated data pool, and an S-curve slow down — all of which on a different workflow to
whatever has to load so it doesn't get interrupted." The load animation is a SELF-CONTAINED,
PRECOMPUTED unit; playback is COMPOSITOR-ONLY (the "different workflow"); exactly TWO control
events cross from the app into it.

**The water.** Cyan→aquamarine gradient (`#00b4d8 → #00bfa8`, 98.5°). Waves = two 140px SVG
data-URI tiles as vars `--iw-wave-a/b` (night re-points them; thick line on TOP), drawn by
`::before`/`::after` with ±280px overdraw = exactly two tiles (keep it ≡0 mod 140 or the
transform↔background-position handoff tears). Drift = CSS `iw-wave-drift-l/r`, 72px/s (140px per
1.944s loop), in the prerendered class → runs from first paint.

**The pool** (`waveTwinkle.ts`). Sparks (glitters) + dashes (wave marks) are generated in ONE
pass before playback: positions through the never-strike-twice sampler (`memPick`, per-band ring
memory, localStorage-persisted), canvas-rastered PNG art (NEVER per-instance SVG URIs — Chromium
builds an IsolatedSVGDocumentHost per unique URI, ~4.3s at ~600), and a per-instance SCHEDULE: a
~46.7s cycle (24 tile loops) of blink envelopes (dash: 0.3s S rise / 0.4s hold / 0.3s S fall),
each at a fresh 140px-lattice slot (same wave phase ⇒ same art stays valid; own recent slots
excluded ⇒ no repeats). Playback = two looping WAAPI tracks per instance (opacity envelopes +
transform that moves at EXACTLY the drift velocity while lit — the mark rides its crest — and
glides to the next slot while dark). ZERO per-frame JS during the load: no rAF driver, no
respawns, no style writes — main-thread starvation is physically incapable of touching it. One
clock, set once per load: `alignTracks()` batch-sets track startTimes ≡ the tile drift's literal
startTime (mod 1944ms) with a random whole-loop offset. A `.iw-twk-rest` layer (static texture,
hidden during drift) fades in over the coast; the blink layer fades out — twinkling calms exactly
as the water slows.

**The two events.**
1. START — implicit: prerendered `.iw-wave-anim` + pool mount. ATOMIC WATER: everything is gated
   behind `.iw-water-ready` on `<html>` (entry.client decodes the tile URIs AND waits for
   `inkwave:twinkles-ready`) — colour, waves, twinkles land in one paint. Add any NEW tile var to
   that decode list.
2. SETTLE — `inkwave:reveal-imminent` (TiptapEditor's settle gate / LoadingVeil's ready): the
   S-curve slow down. The drift is NEVER stopped — the coast class adds a BRAKE composited on top
   (`animation-composition: replace, add`): injected literal sampled keyframes (#iw-coast-kf,
   Scroll.tsx) of the ZERO-JERK profile v(τ) = −v·(1−smoothstep(τ)) (add ∝ τ³ near 0; T/d =
   2.5s/90px desktop, 2s/72px phone) then a LINEAR HOLD at +v that cancels the drift — the total
   pose is STATIC after T. Brakes (and the coast-length fades) are born CSS-PAUSED and started by
   the FORWARD ANCHOR: one rAF after the swap commit, t_a = timeline.currentTime + 150ms slack;
   drift pose at t_a computed from the drift animation's own startTime, rest pose device-pixel
   snapped, keyframes finalized, then every coast animation gets play() + startTime = t_a. This
   is THE tick fix (2026-07-12): engines resolve pending CSS animations at STYLE time, so under a
   CPU spike the first presented brake frame showed brake(commit-lag) — a backward step ∝ lag².
   Paused-birth + future anchor makes the start compositor-exact at any spike size, and the τ³
   curve makes any residual lag sub-pixel. Rest handoff = timer at t_a+T+80ms → write `--wave-x`
   = the snapped end, drop classes, dispatch `inkwave:wave-rest`.

**Kept invariants (each was a live bug — do not regress):**
- PHONE: surfaces are in-flow, so the shell surface is VIEWPORT-PINNED (fixed, inset 0, z 0 under
  the z:1 transparent covered editor) while wave classes run; gradient `background-attachment:
  scroll` + 100lvh sizing (WebKit fixed-attachment is flaky; browser-UI transitions must not
  reshape the water). Shell stays OPAQUE until wave-rest AND the paper fade completes; parchment
  only over still water. The covered phone editor renders NO wave classes and never syncs
  twinkles (its early 'off' would clobber the global mode).
- Editor mounts ONCE per load (no lazy/Suspense around TiptapEditor); the editor chunk is eagerly
  imported at module scope. A surface mounting mid-load adopts its sibling's drift startTime
  (pixel-identical copies — the old reveal hiccup); pre-gate mounts need nothing (same recalc).
  The adopt must RE-ASSERT at each animation's `ready`: a startTime write to a play-pending CSS
  animation is CLOBBERED when the pending start resolves (live 2026-07-12: the covered editor ran
  33-500ms out of phase → doubled lines through the reveal fade + marks off their crests).
- Mark tracks are NEVER created-then-re-clocked on VISIBLE water: creation is gated on
  clockReady() (the load clock stamped from the drift's literal startTime), and any deferred
  creation fades the field layer through the transition (a late batch re-clock/mass creation was
  a whole-field teleport/pop measured at +18-62px — Peter's live "backward tick just before the
  slowdown"). Pre-gate boot mounts are exempt (hidden until the gate recalc). A host whose dashes
  mount mid-coast still gets its statics ramp (startRestDrift from mountSet).
- PER-LOAD LIFECYCLE RESET: `inkwave:open-begin` clears the coast record + Edit.tsx's chain state;
  twinkle anim re-entry re-aligns the pool clock. A new load never reuses timers or clocks.
- ONE backstop only: the 30s load watchdog (Scroll.tsx) — if SETTLE never arrives it logs loudly
  and forces the chain (`inkwave:load-watchdog`). It must never fire on a healthy load; the old
  per-stage caps (reveal/shell/covered/veil 4s) are gone BECAUSE playback can't be starved.
- Scroll-time (post-reveal): sway = `--wave-x` on the surface + LITERAL field transforms via
  `swayFields()` — never var() into the twinkle subtree, and `--wave-x: 0px` firebreaks on
  `.iw-magnify-box`/`.scroll-paper`/`.iw-wave-twinkles` (the inherited-var write invalidated the
  whole PM subtree: p50 417→50ms; `@property inherits:false` breaks WebKit pseudo re-resolve).
  Scroll twinkles = driven WAAPI blinks (velocity→playbackRate) with raster-free lattice
  relocation through the same never-twice memory; full art regenerates only at zoom/resize
  reseeds. `memPick`'s farthest-candidate fallback must init bestD to −Infinity (−1 left `best`
  null on saturated rings — real bug).
- IN-FLOW surfaces (SnapshotView doc/diff panes — anything :not(.iw-fill)) get PANE-SCOPED water
  pseudos (position:absolute override in index.css): the snapshot card-flip keep-alive layers are
  stacking contexts, so the old viewport-fixed ::before painted wave lines OVER the minimap/
  summary/diff panels (Peter's 2026-07-12 screenshots; pixel-verified fixed with seeded snapshot
  data). Only .iw-fill surfaces (live editor, LoadingVeil) keep viewport-fixed water.
  PANE-SCOPED WATER MUST STAY UNPROMOTED (2026-07-12 "snapshots lagging massively"): in-flow
  surfaces are CONTENT-tall (>60,000px on a thesis-scale snapshot pane), so the base rule's
  will-change/translateZ gave every keep-alive layer a ~90-megapixel promoted water layer (3-5
  resident = 300MB+ raster, scroll 37fps → 60 once removed). The :not(.iw-fill) override pins
  will-change:auto + transform:none; hidden .iw-snap-layer surfaces paint NO water at all
  (content:none — only the active pane pays); SnapshotView writes NO --wave-x sway (a sway write
  invalidates the whole content-tall pseudo's paint per scroll event).
- **NOTHING MAY WRITE TO THE DOM BEFORE HYDRATION (2026-07-17 — Peter's "the video works but it
  never loads"; the wave video re-triggered the 2026-07-10 catastrophe).** `hydrateRoot(document)`
  makes React own EVERY node, so there is NO DOM anywhere for an imperative pre-hydration append.
  waveVideo appended its `<video>` into the PRERENDERED `.iw-wave-twinkles` before `bootstrap()`
  reached hydrateRoot (it `await`s a dynamic import first, so the video always won) ⇒ React #418 ⇒
  it discarded the server HTML and client-rendered the whole document (#423). THE DAMAGE, PROBED:
  React's recovery **REPLACES the `<html>` ELEMENT** — it does not strip attributes off it. So the
  new `<html>` had no `.iw-water-ready` and no `data-theme`, `:root:not(.iw-water-ready)` put every
  wave layer AND the twinkle host at display:none for the session, and the video — which lives
  inside that host — painted nothing while `play()` resolved happily. On PHONE the reset is
  `.inkwave-editor-surface:not(.is-phone)`, so the aqua GRADIENT still painted: a flat aqua screen,
  no waves, no document. CONFIRMED FIXED ON PETER'S iPHONE 8 (2026-07-17: `water-gate OPEN`). Fix =
  a `hydrated()` barrier — every DOM write waits behind it. The 150ms re-attach interval is GONE:
  it existed only to heal the wipe, and post-hydration React never touches the host's children
  (waveTwinkle removes only its own `.iw-twk-set` nodes). Probes:
  `scripts/wave-video/reveal.prove.mjs` + `barrier.prove.mjs` (both `--expect-broken`).
- **ONE-SHOT ASYNC SIGNALS — THE BUG CLASS, and it hit TWO lanes in the same minute (2026-07-17).**
  A signal you wait on can fail two ways: **(a) it never fires**, or **(b) it already fired before
  you subscribed**. A bare `addEventListener` loses to both, silently and forever — no error, no
  timeout, just a promise that never settles. THE RULE: only ever wait on a signal that ALWAYS
  arrives, and make it ASKABLE — check the state first, subscribe only if the answer is no, both in
  ONE synchronous block so nothing can slip between them. Do NOT paper over it with a timeout; that
  re-creates the self-healing machinery this lane deleted. Instances:
  - The wave video's barrier first keyed on `inkwave:twinkles-ready` — post-hydration, but the pool
    announces only if BOTH its sets generate, while the water gate opens anyway on its own 1500ms
    timeout. A load whose pool never announced hung the video FOREVER with the gate wide open
    (PROBED). Now `inkwave:hydrated` + `__iwHydrated` (entry.client's `HydrationBeacon`, a null
    component whose post-commit effect always fires). `__iwWaterReady` was added for the same reason
    — the class `.iw-water-ready` is not a safe proxy for "it happened", since a recovery strips it.
  - The break-table lane, same minute, same shape: a signature built before `bibProvider` had
    hydrated, keyed on `capa@0` instead of `capa@20`, missing forever after.
  Correctness of a feature must not depend on ANOTHER feature succeeding (the video did not need the
  twinkles; it was merely borrowing their timing).
- **A `reason`/status field that only some code paths write is a field that LIES.** waveVideo's
  `reason` was set once before the barrier and then not again until `play()` resolved, so a video
  stuck in its DECODE still displayed 'waiting for hydration…'. That stale line sent the next reader
  (and Peter's coordinator) hunting a barrier bug that had already released — the same overlay's
  `clip` and `fetch` fields, both written INSIDE `run()`, proved it was well past. Discriminate a
  hang from a stall by asking which fields are POPULATED, not by reading the status string. `reason`
  now tracks every stage of `run()`.
- **`advancing` reported "YES (real decode)" for a video holding NO DATA.** `let last = -1` meant the
  first tick satisfied `now > last + 0.001` for a `currentTime` of 0 — so Peter's overlay showed
  `readyState 0 (NOT decoded)` beside `advancing YES (real decode)`, a physically impossible pair
  that cost real time to see through. It now requires `readyState >= 2` AND a genuine delta against
  a previous sample. Sentinel values must not be able to masquerade as measurements.
- **entry.client's stamp-guard WAS A FICTION until 2026-07-17** — and it failed the one case it was
  written for. It captured `const root = document.documentElement` and observed THAT node, so after
  a recovery it re-stamped a DETACHED element forever while the live `<html>` stayed bare. Never
  hold the node: resolve `document.documentElement` at every use, and watch `document` itself
  (never replaced) with a childList observer to catch the swap + re-arm. Same family as
  canvasShapingMatchesEditor: a guard that cannot see its own failure.
- **`iw-wave-video-on` IS A PROMISE THAT SOMETHING ELSE IS DRAWING THE WATER — and it outlived the
  element (2026-07-17, round 4; Peter, live desktop: "after I signed in just now the wave background
  completely went away", flat teal, document fine).** The class suppresses the CSS water outright
  (`visibility:hidden` on the wave pseudos AND the twinkle host) with NO dependency on the video
  existing, so `master` was a LATCH: when a re-render tore the `<video>` out — mounting Clerk at
  sign-in does exactly that — the CSS water stayed suppressed, the video was gone, and NOTHING drew
  the water. PROVED by removing the element while master (`master.prove.mjs`): class still set,
  `::before` visibility:hidden, `master` still true. `guardMaster` now derives it — a childList
  observer on the host (and its parent) hands the water back the microtask our last live element
  leaves; `:not([data-going])` makes the legitimate loop→brake swap a non-event. **AND THE ALARM WAS
  RIGHT ALL ALONG:** round 3 called `master`-with-no-element a benign swap transient and greyed it
  out — that is EXACTLY this bug's signature, so the instrument would have been blind to the very
  failure it had been reporting. **Excusing a symptom is not the same as excluding a cause**; exclude
  the cause (read the LIVE element) and let the alarm keep firing on everything else.
- **THE OVERLAY WAS RED ON A WORKING APP — and that is worse than green on a broken one (2026-07-17,
  round 3).** A successful run ENDS with the video torn down and `master` cleared, so a completed
  hand-off displayed the identical red `● CSS WATER (no video)` as a video that never ran at all.
  Peter read it and reported "the first time the video ran, from then on just the css" — the fix
  worked, the instrument said otherwise, and two rounds went hunting a phantom. `masterEver` now
  separates them: `✔ VIDEO RAN, then handed back — HEALTHY` vs a red that means EXACTLY "the video
  never ran this load". The ▲ alarm also fired on healthy runs twice over: `painted` demanded
  opacity ≥ 0.9 while `.iw-wave-video-el` fades in over `transition: opacity 0.3s` (~270ms of every
  successful start — "right before it loads", exactly when he was watching), and the overlay picked
  the FIRST `video.iw-wave-video-el` (the dying loop, opacity 0, `data-going`) during the 80ms
  loop→brake swap. A half-faded video IS painting; select `:not([data-going])`. **An alarm that
  fires on the healthy path trains the one person whose eyes are the ground truth to distrust the
  instrument.**
- **THE OVERLAY MUST NAME ITS BUILD.** Peter's three screenshots were read as one healthy run; the
  `fetch` field said otherwise — `200 / decoded` is round-1 code, `warm 200 → cached` is round-2, and
  they CANNOT coexist in one build. Two builds, one minute, and no way to tell from the picture. The
  box now prints `__BUILD_COMMIT__`. Any on-device overlay whose screenshots cross a deploy needs it.
- **THE HARNESS'S FIRST LOAD WAS ITS ONLY LOAD (`twoload.prove.mjs`).** Every wave-video probe did ONE
  load in a FRESH context, so nothing could see what a SECOND load changes: `serviceWorker.controller`
  is NULL on a first load (the SW's cache-first /wave/ handler is not even in the path), Cache Storage
  and the HTTP cache are empty, and there is no saved document. **A race gives you *sometimes*;
  works-once-then-never is STATE.** But: **Linux WebKit CANNOT run the warm load at all** — it has no
  `navigator.storage`, so load 2 reads back the document load 1 created, hits the app's own
  storage-error page, and renders NO editor surface. The video then bails `load already past drift`
  because there is no `.iw-wave-anim` surface ANYWHERE, and the probe reported "PETER'S SEQUENCE
  REPRODUCED" — a fiction; a control with the flag OFF showed the identical dead page. It reports
  INCONCLUSIVE now. Chromium (which has OPFS) renders warm loads and reaches master on all 3, h264
  included. **The drift window (hydrated→settle) DOES halve on warm loads** (WebKit av1 3.3s → 1.7s;
  Chromium 744ms → 427ms) because caching makes everything else faster — a real mechanism by which a
  slow decode could lose on load 2+ and never on load 1, unreproduced in either engine and left
  STATED, not probed.
- **CROP SHIPPED, AND THE LADDER IS NOW VIEWPORT-AWARE (2026-07-17, `feat/wave-rung`) — this
  supersedes the `object-fit: cover` entry below, which is now ARCHAEOLOGY: read it for the
  argument, not for what the code does.** `.iw-wave-video-el` is `object-fit: fill` + an element
  sized inline to the chosen rung's DESIGN CSS BOX; the viewport crops the overflow. MEASURED on the
  SHIPPED styling (`tilescale.prove.mjs --mode crop`, now the DEFAULT and injecting NOTHING):
  **140.0 vs 140.0, 0.0% at 1100x700 / 1440x900 / 1920x1080**, with `--mode cover` kept as the
  COUNTERFACTUAL and proved to still reproduce the bug (116.7 vs 140.0 = 16.6% at 1440x900, 0.1px
  off the cover model) — without that arm firing, crop's 0.0% would be unreadable.
  · **THE LADDER (`RUNGS` in waveVideo.ts, mirrored by `LADDER` in generate.mjs):** phone 440x956
    @dsf2 (880x1912) · desk **1920x1080 @dsf1 — FULL HD, Peter's ceiling** ("Why don't we just do
    full hd. Or even 720p") · wide 2560x1440 @dsf1. Bytes loop+brake, day: phone av1 102KB / h264
    520KB · desk 202/860 · wide 365/1476. Full HD was chosen over a retina 3840x2160 on Peter's
    "smaller file" instruction AND because 2.07 Mpx still fits **H.264 Level 4.0** (~2.1 Mpx), the
    iPhone-8 pin. VERIFIED with ffprobe, not assumed: phone/desk level=40, wide level=51.
  · **`pickRung(vw, vh, coarse)` is PURE and EXPORTED**, and `coarse` is a PARAMETER: it read
    `matchMedia` internally at first, and under vitest's node env there is no `window`, so the whole
    touch half of the suite silently became a copy of the desktop half — passing, proving nothing.
    Rule: the SMALLEST rung of the right device class whose design box COVERS the viewport; nothing
    covers it ⇒ null ⇒ CSS water. It NEVER returns a rung that must be stretched.
  · **DPR IS DETECTED AND REPORTED BUT DOES NOT SELECT, and that is deliberate.** Peter's ask
    ("I shouldn't have to give the res of my desktop") is satisfied — `planClip` reads innerWidth/
    innerHeight/devicePixelRatio every load and the overlay prints them plus the delivered dpi ratio.
    But DPR can only make a CHOICE where two rungs of one device class differ in `dsf`, and Peter's
    own ceiling is what rules out the retina desk clip that would create such a pair. A `dpr`
    parameter would be a number the function reads and cannot act on.
  · **STATED CEILINGS (found by the tests, not reasoned about):** an iPad in PORTRAIT (820x1180)
    matches NO rung — phone can't cover it and the desk clips are landscape (1080 < 1180) — so it
    gets CSS water; a viewport past 2560x1440 likewise. Both pinned by tests so a future rung is a
    DECISION, not an accident.
  · **generate.mjs no longer `-vf scale`s.** encW/encH are DERIVED (`vw*dsf`); the old rows captured
    880x1912 and scaled DOWN to 540x1170, which under `fill` would resize the water again — the same
    defect moved into the encoder. Capture geometry === encode geometry. `-level:v` is per-rung.
  · KEPT IN THE GATE by `src/editor/waveVideo.test.ts` (16 tests, ~44ms, no browser) — the browser
    probe is the truth, not a guard. MUTATION-PROVED, 4 mutants all die: drop the cover test ⇒ 6
    fail · pick the largest rung ⇒ 2 · drop the coarse partition ⇒ 3 · phone dsf 2→3 (past Level
    4.0 on a touch device) ⇒ 1.
- **BLANK WHITE UNTIL THE VIDEO COMES UP + THE DELIBERATE ONE-LOOP DELAY (2026-07-17, Peter).**
  "we have to just have blank white screen until the video comes up and play the video every time"
  and "make it show at least one loop before the file comes up. purposefully delay it. (And use that
  time to warm up the document)".
  · `html.iw-wave-video-wait` (entry.client, pre-hydration — a CLASS ON <html>, the `.iw-water-ready`
    shape, NEVER a node append) whites the surface and hides every water layer, so a load can't show
    CSS water and then swap to the video. waveVideo's `endWait()` clears it on EVERY exit; entry.client
    carries an INDEPENDENT 4s timeout for the one failure waveVideo cannot report — its own module
    failing to load (chunk 404 / parse error). White must never be a state you can get stuck in.
  · **THE LOOP BOUNDARY IS THE VIDEO'S OWN, NOT A TIMER.** `releaseAtLoopPoint` watches `currentTime`
    WRAP (rVFC where available, else the same 40ms poll `wireSettle` already uses for this identical
    boundary). A `setTimeout(2000)` would be a guess about a decode we don't control, and on a busy
    first load it would release mid-loop — exactly the half-loop Peter asked us to stop showing.
  · The reveal gate (TiptapEditor) waits on `inkwave:wave-video-loop` alongside fonts.ready +
    the first pagination measure — so **"warm up the document" needed NO code**: the warm-up is what
    the load already does, given room to finish. ASKABLE (`__iwWaveVideoLoopDone`) + fired on EVERY
    exit (wrap/bail/decode timeout/autoplay refusal/settle) + capped INDEPENDENTLY at 7s in the
    editor, because that guarantee only holds if the module loaded. The 1200ms reveal cap becomes
    8200ms only when the flag is ON — it would otherwise fire straight through a ~2s loop and undo
    the delay on every load. Flag OFF ⇒ the gate is byte-for-byte the old one.
  · **PROVED IN A REAL BROWSER, 9/9 — `loopgate.prove.mjs`** (chromium, own ephemeral port): FLAG OFF
    is the control and nothing changes (reveal 1257ms, the white NEVER appears, no gate event); FLAG
    ON reaches master on `desk 1920x1080css @dsf1 (dpi 1.00x)` — the rung DETECTED, Peter asked
    nothing — the gate reads **"one full loop played (wrapped at 1.96s)"** (a REAL wrap, not the cap),
    the white clears at 1197ms and is GONE at reveal, and the reveal moves **1257ms → 3236ms**: the
    delay is a measured ~2s, not a hope. It VOIDS rather than passes when the video never becomes
    master — a bail releases both gates BY DESIGN, so those checks would otherwise go green for
    exactly the wrong reason.
- **THE SHORT LINES ARE *NOT* OUT OF SYNC WITH THE WAVES BY CLOCK — the hypothesis is REFUTED, by
  measurement (2026-07-17, `markskew.prove.mjs`).** Peter: "the little short lines… often appear out
  of sync with the waves", both engines. The standing hypothesis was that WAAPI and CSS animations
  run on different clocks. **They do not**: a CSS animation from `getAnimations()` and a WAAPI
  animation from `element.animate()` both hang off `document.timeline` and `startTime` is ONE
  coordinate system, so `alignTracks`' congruence is arithmetically sound and a clock DIFFERENCE was
  never available as an explanation. MEASURED on the CSS water (chromium, 1280x800, 5 clean loads,
  ~200 tracks/load), each track scored against **its own surface's** drift-l: **mark-vs-its-own-wave
  0.00px on 4/5 loads, 2.40px on 1/5** (= a 2-frame 33.3ms cross-surface skew, on a 140px-period
  wave — sub-perceptual, and nothing like "often out of sync"). drift-l vs drift-r on a surface: 0ms,
  always. The instrument is armed first: a deliberately de-clocked track (400ms → 28.8px) is SEEN.
  ⇒ **the alignment is excluded as the cause.** What remains is the class CLAUDE.md already records
  under KNOWN RESIDUALS ("white lines briefly lagging their wave") — real-device raster/compositor
  scheduling, which a GPU-less WSL headless box structurally cannot see. **This excludes ONE cause;
  it does not explain the symptom.** Next tool is on-device capture, not another headless probe.
  · TWO INSTRUMENT BUGS caught in this probe before any verdict was read, both the house speciality:
    (1) it first asked the page for `.iw-wave-anim` from node after a wait and read `waveAnim: 0` on a
    healthy app — the drift window is under a second, so a CDP round-trip lands after the COAST and
    the class is gone (blocking `inkwave:reveal-imminent` does NOT hold it: Scroll.tsx also coasts off
    its own `revealed` trigger). Sampling moved in-page, every frame, to the coast. (2) It then
    latched the FIRST complete sample and reported a tidy 0.00px — but only ONE surface had a drift by
    then, so it was structurally incapable of seeing a two-clock bug. (3) It scored every track
    against `surfaces[0]`'s drift and reported **13.2px of "mark skew" that was really the
    CROSS-SURFACE difference** — it recorded each track's surface and then ignored it. A mark can only
    be in or out of sync with the wave **it is drawn over**.
  · **A LATENT STRUCTURAL BUG, NAMED NOT FIXED:** `findDrift()` picks ONE surface's drift and
    `alignTracks` clocks EVERY track to it, including the other surface's. Today that costs 2.4px on
    1/5 loads because Scroll.tsx's sibling adopt usually makes the two agree — but the marks of surface
    B are clocked to surface A's wave BY CONSTRUCTION, so the error is exactly whatever the adopt
    leaves. Peter's call whether to close it.
- **`object-fit: cover` DESTROYS THE 140px TILE INVARIANT — PROBED, 0.0px off the model at every scale
  (2026-07-17; Peter, live desktop: "the video resolution and size of the waves does not match that of
  the background").** The video only ever stands in for the CSS water during the load and HANDS BACK at
  the coast, so its tile must be 140 CSS px at EVERY viewport — that is what a seamless hand-off IS.
  `width:100vw; height:100lvh; object-fit:cover` scales the clip to the viewport instead, so the tile is
  140 × max(vw/1280, vh/800). MEASURED against the CSS water's own tile (`tilescale.prove.mjs`):
      viewport    cover scale   CSS water     VIDEO water   model    error
      1100x700       0.875      140.0 ✓        122.5        122.5    0.0px   ✗ 12.5% — jumps
      1280x800       1.000      140.0 ✓        140.0        140.0    0.0px   ✓ (the rung's own size)
      1440x900       1.125      140.0 ✓        157.5        157.5    0.0px   ✗ 12.5% — jumps
  **PETER'S CROP FIX IS PROVED**: element sized to the clip's DESIGN CSS box, viewport crops the
  overflow ⇒ 140.0 vs 140.0, 0.0% mismatch, at a viewport where cover reads 122.5. ARCHAEOLOGY, and it
  licenses the change: `git log -S"object-fit: cover"` → ONE commit (6674e43, the original production
  video); `-S"object-fit: fill"` → **EMPTY, no commit ever contained it**. So index.css:501's comment
  ("object-fit fill = 1:1 device px at the rung's design scale so wave tiles stay exactly 140 CSS px")
  describes a design NEVER IMPLEMENTED, and cover's only stated justification is "one clip fills any
  viewport… lets the ladder be just 2 rungs" — it solved RUNG EXPLOSION, which cropping solves better.
  **The SSIM ≈ 0.98 that justified it compared the video TO ITSELF SCALED**; it never once compared the
  video to the CSS water it must match. ⚠️ `object-fit: none` is NOT the fix: it maps 1 video px → 1 CSS
  px, so a dsf:2 clip renders 2× too big — "preserve dpi" needs clip @ (design CSS × DPR) + element
  sized to the design box + `fill`. THE CEILING, unowned: a viewport wider than the clip has no pattern
  to crop from, and periodicity CANNOT rescue it (a <video> cannot be background-repeated; two tiled
  videos = two `currentTime`s; canvas-tiling needs a per-frame JS driver). BYTES, measured, for a
  2560×1600@dsf1.5 (3840×2400) desk clip: **AV1 630KB / H.264 2861KB** loop+brake (vs today's 116KB /
  525KB — 9× pixels → 5.4× bytes). generate.mjs pins `-level:v 4.0` (~2.1M px, iPhone-8-conservative);
  3840×2400 is 9.2M px ⇒ Level 5.1 — safe for DESK ONLY, since `pickRung` (`coarse || innerWidth < 900`)
  means an iPhone NEVER decodes the desk clip.
- **THE TILE-SCALE PROBE'S OWN HISTORY IS THE LESSON — THREE FICTIONS BEFORE A MEASUREMENT.** (1) v1
  extracted the period from THRESHOLDED PEAKS and doubled the median gap, assuming an even thick/thin
  pair NEITHER water has. It reported a tidy 24.2% mismatch at 1920×1080 — a perfect confirmation of the
  hypothesis — then its control, at the rung's own size where cover scale is 1.0 and the two MUST agree,
  reported 23.8%. **A mismatch that does not move with the cover factor is not measuring the cover
  factor**; it was a constant extractor offset, reading the CSS water at 130 against a KNOWN 140.
  (2) It sampled CENTRE columns, which hit the PARCHMENT PAGE (the two waters are necessarily sampled at
  different load stages, and by the second the document has revealed): scatter 46.9/55.1/66/244.9. The
  page is centred — sample the EDGES, water at every stage. (3) Autocorrelation suffers OCTAVE ERRORS
  here: the half-period correlates at ~0.97 of the fundamental (thick and thin lines are similar, and
  scaling blurs them closer), so peak-picking read [70,70,140,140] and [157.5,315,315,315] — the truth
  present in both, the median a coin toss. It reported 315 (double the true 157.5) as a confident
  verdict. Fixed by LINEAR detrend (the 121px moving average was comparable to the 140px period — a
  high-pass filter sitting on the signal, which is what let r(280) beat r(140)) + NORMALISED correlation
  + a 0.995 fundamental bar; and octave disagreement across columns now **VOIDS** rather than medians.
  **AND THE CONTROL AT ONE VIEWPORT CERTIFIED AN INSTRUMENT WRONG AT OTHERS** — it passed at 1280×800
  and read 315-for-157.5 at 1440×900. A control must span the measurement RANGE, not one point.
- **`no-store` IS FAITHFUL TO NOTHING.** The probe server sent it for every asset, so waveVideo's
  pre-hydration warm fetch warmed precisely nothing and the `<video>` re-downloaded the whole 280KB
  h264 clip — a "decode timeout" manufactured entirely by the harness. Production serves /wave/
  cache-first from the SW's Cache Storage (permanent per build id); `server.mjs` now serves /wave/
  `immutable` (the behavioural equivalent) and everything else no-store.
- **THE OVERLAY MEASURED THE DECODER AND REPORTED IT AS PIXELS.** `?waveVideo=debug` printed
  "● VIDEO ON SCREEN / advancing YES / VIDEO is master" — all TRUE, all about the decode — while
  the element sat in a display:none subtree painting nothing. Every field was green on a build that
  never rendered a frame, which is exactly how a broken build talks you out of a real bug. It now
  asks the LAYOUT ENGINE (`painted`: box/display/visibility/opacity) and prints the water gate,
  with a distinct third state "▲ VIDEO IS MASTER BUT NOT PAINTED". NB the box is written with
  innerHTML — no angle brackets in any diag string (a literal "&lt;video&gt;" parsed as a TAG and
  swallowed the reason line). Probes read `window.__iwWaveVideo` (masterEver included — the video
  can run and hand back between samples), NEVER the overlay's rendered text.
- PROBE RULES: /snapshot needs a fallback-faithful static server (vite preview serves the
  prerendered editor page → hydration mismatch kills the water); never pkill vite preview; no
  windows over Peter's screen (xvfb; Firefox needs `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0`).
  `window.__iwTwkPool` exposes the pool for probes. The wave-video probes need
  `scripts/wave-video/server.mjs` — the scrub-probe server has no `.mp4` MIME and no Range/206, so
  it would test a transport iOS never uses.

Build marker: Settings footer + console show `__BUILD_COMMIT__` (vite.config.ts).

**ONE CAUSE OF "SHORT LINES OUT OF SYNC" CLOSED (2026-07-18, `a11bd94`) — narrower than the residual
below, do not conflate them.** Root cause: the covered editor surface routinely mounts ~150-250ms
BEFORE the loading shell's drift animation commits its `startTime`, so the sibling-clock adopt's
`sibling != null` gate found nothing yet, skipped adoption, and never retried — the two surfaces'
drifts then resolved independently 10-25px apart FOREVER, and since the marks share ONE clock
(stamped from the first host's drift), that divergence threw the OTHER surface's marks off their own
crest by the identical amount. Fix: the reference surface (first-mounted) is never rewritten; every
later surface waits for it to resolve and adopts it, retrying each frame until it commits. PROVED
(`markskew.prove.mjs`, armed known-negative seen at 28.8px): before, surface-vs-surface drift up to
25px; after, 0.00px across 10/10 clean loads, Chromium. This is the default CSS-water path (flag
off) — it improves what everyone gets today and the video's fallback, but it does NOT resolve the
on-device raster-scheduling residual below (a GPU-less box structurally cannot see that class), so
`?waveVideo` stays default OFF regardless.

KNOWN RESIDUALS (Peter's live verdict, 2026-07-12, build 72783da — "workable on the whole"):
no consistent tick remains, but inconsistent performance artifacts persist, worst on PHONE then
Chrome: occasional blue flash; white lines briefly lagging their wave. Probes pass 9/9 — these
are real-device/raster-scheduling class issues the emulated probes don't catch. Next wave round
starts HERE, not from "all green"; candidate tools: on-device capture, WebKit raster ahead-of-time
hints, reduced phone pool density.
