<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Editor chrome, zoom and the toolbar

Why: `docs/archive/editor-surface.md`.

- **`<Scroll>`'s fixed full-region container is opt-in via `fill`** — live editor only; SnapshotView
  reuses `<Scroll>` in-flow inside its split pane and fixed there covers the diff panel.
- **Hybrid zoom: TWO zooms, ONE owner module `src/editor/magnify.ts`.** Ctrl/⌘+wheel over the PAGE =
  font-reflow zoom (`--iw-editor-zoom`, `inkwave:editorZoom`); over the WATER or a page gap = GPU
  transform-magnify (`--iw-magnify` on `.iw-magnify-box`, top-left origin, NO transform at scale 1).
  Fit-to-width binds when the window is narrower than the page (caps zoom-in; magnify may go far
  below). The wrapper is sized to the page's VISUAL dims.
  · **Coordinate convention:** rects under the transform are VISUAL px — convert via `scaleFor(el)` /
  `unscale()`, NEVER ad-hoc reads. Pagination measures where magnify is forced to 1.
  · Phone zoom = pinch → the font-reflow pipeline; browser-native zoom is suppressed app-wide on phone.
- **THE TOOLBAR CONTRACT IS `editor/toolbarContract.ts` — one file, the only way in.** Register a
  button by adding to `SlotId` + `ALL_SLOTS` (+ `IMPLEMENTED_SLOTS` when it actually renders — a slot
  that cannot render must never paint a dead circle nor strand a stored id); own a second bar row by
  adding to `BarLayerId`. Nothing else. `migrateSlots` is generational (KEEP what is valid in the
  writer's order, FILL from canonical order, never reset); `planBarToggle` makes mutual exclusion
  STRUCTURAL.
- **A SLOT IS A TRIGGER, NEVER AN OWNER** — two access paths write ONE lifted state (the ◈
  ReceiptPanel is the precedent).
- **Toolbar hotkeys are POSITIONAL: Alt+1…Alt+6 = the row, Alt+0 = the ▲ drawer, Mod+, = Settings.**
  Hold Alt on desktop and each circle wears its number. **THE HOTKEY IS THE TAP** — dispatch the
  slot's own button `.click()`, never an action registry. **NOT Alt+<letter>**: Firefox on
  Windows/Linux (Peter's browser) binds Alt+F/E/V/S/B/T/H to the menu bar. Phone binds nothing.
  ⚠ UNRESOLVED: ReviewBar binds Alt+S, which is Firefox's History menu.
- **Toolbar slots are ONE population** — 6 row circles + the ▲ drop-up overflow (style and settings are
  slots too). Six because it fits on phone; the population grows freely because ▲ is the app drawer.
- **The layout follows the `.studio`** (`doc.toolbar`, `ToolbarConfig`): `bundle.ts` emits it,
  `openDoc.ts` restores it. Chain: doc config → the writer's own last layout
  (`inkwave-toolbar-slots`) → the first-run six (page, style, info, settings, media import, review). A
  received document can never hide ▲/⋮ or name a button this build lacks.
- **The toolbar config is NOT anchored and must stay out of the hash** (Peter: "it doesn't need to be
  in provenance") — a recipient who rearranges buttons must not be told the writing was altered.
  `editor/toolbarHash.test.ts` proves it.
- **⚠ MIGRATION IS A RENDER RULE — KEEP IT OUT OF THE BYTES.** `migrateSlots` resolves against the
  FLAG-SENSITIVE `livePopulation()`, so migrating in, out or through deletes a slot from the AUTHOR'S
  file the first time anyone opens it with a flag off. Use `carryToolbarConfig` (verbatim order,
  registered ids only) for in/out, `mergeRowIntoConfig` for the post-drag write-back — drawer
  membership is DERIVED, so a live slot missing from the new row was demoted deliberately.
- **ONE ROW SIZE:** phone circle width derives from `--iw-row-slots`, never a second hand-written copy
  of ROW_SLOTS in CSS. The guard reads index.css itself (jsdom does not resolve custom properties from
  a stylesheet).
- **`scripts/toolbar.prove.mjs` is LOAD-FLAKY and fails toward "the feature is missing"** — re-run it
  quiet before reading any verdict; wait for the CONTENT, not the clock.
- **THE FOOTER BAND IS THREE INDEPENDENT FIXED ELEMENTS AND THEY COLLIDE** (centred toolbar,
  edge-anchored sync and snaps pills). **Sweep the WIDTH RANGE, not a point** — it is invisible above
  ~700px and Peter runs a ~570px window.
  · **ONE BUDGET, TWO CONSUMERS** — `--iw-bar-budget` caps the box AND drives the circle-shrink clamp.
  · **CIRCLE SIZE IS COMPUTED FIRST; GAPS TAKE THE REMAINDER.**
  · **A collapsed `max-height: 0` row STILL HAS A WIDTH** — use `width: 0; min-width: 100%` while
  collapsed, or the hidden style bar sizes the pill.
  · `TOOLBAR_SIDE_RESERVE_PX` is divided by the transform scale (max-width is LAYOUT px, the collision
  is PAINTED px).
  · **THE TWO SIDE PILLS ARE ONE PAIR — `components/sidePill.ts` owns height, font and offset.**
  `sidePillBottom()` centres each on the toolbar MIDLINE, reading the live `--iw-toolbar-h`.
  · **`🗀` has no glyph on macOS** — check decorative codepoints on both platforms.
- **Review layer is MERGED AND LIVE ON MASTER** (ReviewBar.tsx + the ✎ trigger — Peter renamed it
  **suggests** on 2026-09-19; the layer id in code stays `review`): live suggestion mode behind a
  toggle, comments as sticky notes over the wave, nav (←/→, Alt+A accept, Alt+S discard), named
  annotation sets via a drop-up.
  - **The suggests row retracts like style, except while suggestion mode is on** (2026-09-18), and
    **with the mode on another bar takes its place, then the row comes back** (2026-09-19: "change
    back to another bar ... without doubling up, then revert"). Only the ✎ trigger's own toggle-off
    ends the mode; any other retreat leaves it on, and an empty pill with the mode on re-lands the
    row after `BAR_HANDOFF_MS`, never under an open panel. The trigger fills while the mode is on.
    Guarded by `barClose.test.ts`.

