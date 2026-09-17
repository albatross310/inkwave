<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## iOS / WebKit invariants — each was a live bug

Measurements, probe artefacts, corrections: `docs/archive/ios-webkit-rounds.md`.

- **ALL OPFS writes go through `storage/opfsWrite.ts`** — WebKit has NO `createWritable`; the worker
  uses `createSyncAccessHandle`, serialized, ONE open handle per file, truncate/flush/close awaited
  for ≤16.x.
- **File inputs: NO `accept` extension lists on touch** (unregistered UTIs grey out every file).
- `navigator.storage.persist()` on first write; iOS <16.4 (no `CompressionStream`) degrades gracefully
  + banner.
- **`touch-action` does NOT inherit** — hence the universal `* { touch-action: pan-x pan-y }` phone
  rule. **An element that owns a drag declares its own `touch-action`** (SCAS reel, PDF text note,
  the reader's size and line-spacing sliders), and **`setPointerCapture` cannot override that** —
  capture routes events, it does not claim the gesture. No UA stylesheet sets it on
  `input[type=range]`.
- **iOS auto-zooms (and STAYS zoomed) on controls <16px** — global floor
  `font-size: max(16px, 1em) !important` on `input, select, textarea`. **That rule sets a FONT and
  nobody grew the BOXES**: `TOUCH_FIELD_H = 40`, and 40 rather than 34 because **a `<select>` is a
  REPLACED element and renders no `::before`/`::after`**, so its own box is the only target it has.
- **TAP TARGETS: GROW THE HIT REGION, NOT THE LAYOUT** (`.iw-tap` / `.iw-tap-row`, index.css) — a
  `::after` on the control, so nothing reflows.
  · **THE WIDTH IS HALF THE ROW GAP PER SIDE, NEVER A FLAT 44px** — two neighbours each claiming 44
  OVERLAP and the later sibling wins, so an unconditional expansion TAKES a tap target away.
  `--iw-tap-x` is the row's own gap, set per row (8/6/2px reader, 3px PDF toolbar).
  · **NEVER INSIDE A VERTICAL MENU** — `[role="menu"] button::after { content: none }`; those rows
  grow for real.
  · **⚠ CORRECTED: a flat 44px width is NOT safe, and this file once said it was** (measured: fires
  the collision check on 59 pairs). **The 29–32px horizontal residual stands and cannot be closed
  without reflowing the rows** — Peter's call.
- **A HOLD GESTURE NEEDS `onPointerCancel`** — a drifting finger gets no `pointerup`, the 400ms timer
  still fires and `heldRef` stays set, swallowing the next tap.
- **A DISMISS SCRIM NEEDS `onPointerDown`, not `mousedown`** — iOS withholds the synthetic mouse event
  when the gesture is treated as a scroll or a touchmove was preventDefaulted (which
  `.iw-touch-guard` does).
- **A POPOVER CENTRED ON YOUR FINGER HANGS OFF A 375px SCREEN** — clamp with `useClampedX` in a layout
  effect. A `right: 0` menu on a WRAPPING toolbar can measure `left = −134`.
- **New footer drop-ups MUST carry `iw-touch-guard`** or their taps blur the contenteditable, retract
  the keyboard and slide the docked pill and its menu to the screen bottom. Real form fields are
  exempt from the capture-phase guard.
- **The footer toolbar is slaved to the VISUAL viewport by transform** (`editor/toolbarDock.ts`): iOS
  never resizes the layout viewport for the keyboard and composites keyboard-up pans WITHOUT layout,
  so write `translate3d(0,-off,0)` per frame while geometry moves; `--iw-kb-offset` carries the same
  value. **Never move the lift back into `bottom`/CSS-var positioning.** Transition the transform ONLY
  for large event-driven jumps (>60px); per-frame follow writes stay transition-free. `kbOffsetFor`
  clamps negative `offsetTop`, and the dock freezes whole while overscrolling.
- **PM's `scrollThreshold`/`scrollMargin` stay `toolbarH + 28` ONLY** — prosemirror-view's windowRect
  bottom is ALREADY `visualViewport.height`, so a keyboard-inclusive reserve double-counts it. Keep
  them in sync with any new floating bottom chrome; PM's `scrollIntoView` ignores CSS scroll-padding.
- **Programmatic caret reveals (`keepCaret`) are FORBIDDEN while geometry is moving**
  (`isSettled()` false) — the dock's `onSettled` runs them once, then re-runs at +250/600ms,
  no-op-guarded. The tap, not the first keystroke, owns the reveal.
- **touchstart must stay PASSIVE**; the pinch's non-passive touchmove attaches only while two fingers
  are down, armed inside the second finger's touchstart.
- **iPadOS masquerades as macOS** (detect via `maxTouchPoints`); GIS popups need pre-loaded clients so
  `requestAccessToken` runs inside the tap's transient activation.
- Phone typing scheduling: pagination re-measure 850ms (1200ms keyboard-up), SCAS tick 250ms, autosave
  800ms, word count 1s. `inkwave:perflog=1` for on-device numbers.
- **The SCAS tick is WINDOWED on BOTH platforms, including deletion ticks** — the controller keeps a
  lemma-presence MULTISET (+ slot-original multiset) updated per tick by a top-level block IDENTITY
  diff, so the phantom-snapshot guard holds by construction. **The windowed decoration splice is only
  legal when the tick did NOT change SCAS state** (a verdict change repaints that lemma doc-wide).
- **Enter must do NO O(doc) work on the keystroke** — the paragraph-snapshot trigger reads ONLY the
  completed paragraph's `textContent`, and the snapshot chain is deferred to a genuine input pause
  (`runWhenQuiet` 1.5s); content is captured at WORK time.
- Guards: `src/components/touchTargets.test.ts` (no browser) and `pnpm prove:phonetouch` (375×667,
  real geometry, a DESKTOP CONTROL proving the hit region cannot reach a mouse, a collision check
  proving no region reaches a neighbour's button). **Comments are STRIPPED before scanning** — these
  fixes are explained by sentences containing the literal words "onMouseDown", "mousedown" and
  "pan-x pan-y", and a raw-text guard would fire on its own documentation.
- Probe artefacts that accused working features: a naive overflow walk blamed KaTeX's 1px-clipped
  MathML (`getBoundingClientRect` says where a box WOULD be — intersect with clipping ancestors);
  **Escape dismisses a palette by CLOSING THE READER**; disarming a held tool takes TWO clicks (the
  hold's `heldRef` is consumed by the browser's own post-long-press click).

