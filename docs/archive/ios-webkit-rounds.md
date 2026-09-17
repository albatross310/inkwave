# iOS / WebKit — the rounds behind the invariants

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "iOS / WebKit invariants"; that entry
points here. Every rule in that list was a live bug on Peter's iPhone, and several were re-introduced
once already because the rule had been kept and the reason discarded.

Moved out of CLAUDE.md on 2026-09-17 (the trim). What follows is the removed text **verbatim** —
the measurements (375x667 geometry, contrast ratios, tap-target collisions), the probe artefacts that
accused working features, and the corrections where this file had itself been wrong.

The toolbar entries that used to sit in this section (the footer-band collision, the toolbar
contract, positional hotkeys, slots as one population) moved to `docs/archive/editor-surface.md`;
the scoped-measure, font-certification and `?arithLayout` entries moved to
`docs/archive/pagination-rounds.md`.

Convention: `docs/archive/README.md`.

---

## iOS / WebKit invariants (2026-07-08/09 — each was a live bug)

- ALL OPFS writes go through `storage/opfsWrite.ts` (WebKit has NO createWritable; worker
  createSyncAccessHandle, serialized — ONE open handle per file or it throws; truncate/flush/close
  awaited for ≤16.x).
- File inputs: NO `accept` extension lists on touch (unregistered UTIs grey out every file).
- `navigator.storage.persist()` on first write (Safari's 7-day eviction); iOS <16.4 (no
  CompressionStream) degrades gracefully + banner.
- touch-action does NOT inherit — per-element, hence the universal phone rule; mid-gesture elements
  that own a drag (SCAS reel) need their own `touch-action:none`.
- iOS auto-zooms (and STAYS zoomed) focusing controls <16px — global 16px floor on phone.
- **THE FLOOR SETS A FONT AND NOBODY EVER GREW THE BOXES (2026-08-30).** That rule is
  `font-size: max(16px, 1em) !important` on `input, select, textarea` — it changes the TYPE and
  nothing else, so a control declared at `height: 22` is now shorter than the line it has to hold.
  Measured on the source reader's address bar, its composer, its two reading selects, the live-mode
  page-width select, the PDF's note-size select and the PDF reader view's font select: every one
  had been floored months ago and every one was still a 22-28px box. `TOUCH_FIELD_H = 40`
  (SourceBrowser) is the answer, and 40 rather than 34 for a structural reason: **a `<select>` is a
  REPLACED element and renders no `::before`/`::after` in Chrome or Safari**, so it can never
  borrow a pseudo-element hit region — its own box is the only target it has.
- **TAP TARGETS: GROW THE HIT REGION, NOT THE LAYOUT — `.iw-tap` / `.iw-tap-row` (index.css,
  2026-08-30).** Measured at 375×667 with touch: reader header icons 24×24, markup tools 26×26,
  zoom −/+ 22×22, the notice's ✕ 12.7×14; the whole PDF toolbar 28×28; a text note's delete badge
  16×16. Both bars are DELIBERATELY dense (Peter asked the PDF toolbar down to ONE row; the reader's
  phone dock is 50dvh), so the painted control keeps its size and only its hit region grows — a
  `::after` on the control, which is part of that control's own hit region, so nothing reflows.
  · **THE WIDTH IS HALF THE ROW GAP PER SIDE, NEVER A FLAT 44px.** Two neighbours each claiming 44
    OVERLAP, and the later sibling paints last and WINS the overlap — an unconditional expansion
    TAKES a tap target away. `--iw-tap-x` is the row's own gap, set per row (8/6/2px in the reader,
    3px in the PDF toolbar); one shared constant would be wrong in most of them.
  · **NEVER INSIDE A VERTICAL MENU.** `.iw-tap-row` treats every descendant button, and the PDF's ⋮
    drop-up is a COLUMN 2px apart — 44px regions there would make "Print" eat part of "Export".
    `[role="menu"] button::after { content: none }`, and those rows grow for real instead.
  · **RESIDUAL, STATED:** horizontal reaches only (control + gap) — 29-32px. A dense icon row cannot
    give every icon 44px WIDE without reflowing, and that is Peter's call. Most misses on a
    horizontal row are vertical, which is the half this fixes.
- **AN ELEMENT THAT OWNS A DRAG DECLARES `touch-action`, and two shipped ones did not (2026-08-30).**
  The rule was already in this list; these are the instances it had not reached. The PDF's TEXT NOTE
  (drag-to-move) and the PDF reader view's SIZE and LINE-SPACING sliders both own a drag, and under
  the app-wide `pan-x pan-y` a finger on either was a candidate PAN: the browser took the gesture,
  scrolled, and sent `pointercancel`. **`setPointerCapture` cannot override that** — capture routes
  events, it does not claim the gesture — so the note simply never moved and the sliders never slid,
  silently, on the only device that matters here. No UA stylesheet sets touch-action on
  `input[type=range]`; do not assume one does.
- **A HOLD GESTURE NEEDS `onPointerCancel`, and a DISMISS SCRIM NEEDS `onPointerDown` (2026-08-30).**
  The reader's hold-to-open palette had no pointercancel while the PDF toolbar's identical gesture
  always had: a finger that drifted got no `pointerup`, so the 400ms timer still fired — the palette
  opened under a finger that had left AND `heldRef` stayed set, swallowing the next tap on that tool.
  Separately, all three full-screen scrims (both colour palettes, the ⋮ export menu) dismissed on
  `mousedown` alone; **iOS withholds the synthetic mouse event whenever the gesture is treated as a
  scroll or a touchmove was preventDefaulted** — which this panel's own `.iw-touch-guard` handler
  does. A scrim on mousedown is a dismiss that sometimes is not there.
- **A POPOVER CENTRED ON YOUR FINGER HANGS OFF A 375px SCREEN.** The reader's selection popover and
  its coloured-text composer are `left: x; translateX(-50%)`; the composer is ~354px wide, so any
  selection near a margin put half of it — and the ✓/✕ that commit or cancel — past the edge
  (`useClampedX`, a layout effect so the clamp lands before paint). The PDF's ⋮ menu measured
  **left = −134**: it is `right: 0` of the ⋮ BUTTON and the toolbar WRAPS on a phone, so the ⋮ can
  land near the left edge with a 232px right-aligned card behind it.
- KEPT: `src/components/touchTargets.test.ts` (25 tests, ~25ms, no browser, 8 mutants proved to die;
  **comments are STRIPPED before scanning** — these fixes are explained by sentences containing the
  literal words "onMouseDown", "mousedown" and "pan-x pan-y", and a raw-text guard would fire on its
  own documentation). In-browser truth: `pnpm prove:phonetouch`
  (`scripts/textrender-probe/phonetouch.prove.mjs`) — 375×667 `hasTouch`/`isMobile`, computed styles
  and real geometry, with a DESKTOP CONTROL proving the hit region cannot reach a mouse (0 of 16),
  a collision check proving no region reaches into a neighbour's own button, and VOID guards
  throughout.
  · **⚠ CORRECTED 2026-08-31 — A FLAT 44px WIDTH IS NOT SAFE, AND THIS FILE SAID IT WAS.** The line
    here read "a flat `max(100%,80px)` fires it on 24 + 22 pairs; a flat 44px does NOT — it only
    reaches the neighbour's EDGE". MEASURED in the same build by shipping it: `max(calc(100% +
    var(--iw-tap-x)), 44px)` takes every width residual to **0** and fires the collision check on
    **59 pairs** (reader 24 · reader-live 16 · PDF 19). The arithmetic says the same — a 24px
    control with an 8px gap puts the neighbour's painted box 20px from centre and a 44px region
    reaches 22px — so the claim was wrong, not merely optimistic. It is exactly the fix that
    REMOVES tap targets, and a reader trusting that sentence would have shipped it. **The 29-32px
    horizontal residual therefore stands, and it is now measured rather than assumed: it cannot be
    closed without reflowing the rows**, which is Peter's call (he asked the PDF toolbar down to
    ONE row).
  **THREE PROBE ARTEFACTS to know before writing another:** a naive overflow walk accused the reader
  of a 24px overflow that was KaTeX's 1px-clipped MathML (`getBoundingClientRect` answers where a box
  WOULD be — intersect with every clipping ancestor); pressing **Escape to dismiss a palette CLOSES
  THE READER**, so the later checks measured a panel that was not there; and an **armed highlight
  tool deliberately MARKS a selection instead of raising the popover**, so the popover checks
  reported the feature broken until the probe disarmed first (and disarming takes TWO clicks — the
  hold's `heldRef` is consumed by the browser's own post-long-press click, which a synthetic
  pointerdown/pointerup never produces).
- Phone typing scheduling: pagination re-measure 850ms (1200ms keyboard-up), SCAS tick 250ms,
  autosave 800ms, word count 1s — input latency owns the main thread; `inkwave:perflog=1` for
  on-device numbers.
- SCAS suggestions are **OFF by default** and opt-in in Settings. The existing inverse storage key
  is retained for compatibility: `inkwave:scasOff='0'` is an explicit ON, `'1'` is OFF, and an
  absent/unreadable key takes the new OFF default. This switch remains display-only: the provenance
  engine continues remembering words underneath, as before.
- The SCAS tick is WINDOWED on BOTH platforms — INCLUDING deletion ticks (round-4, 2026-07-11,
  Peter's "deleting lags in waves"): the vanished-lemma pass needs whole-doc word PRESENCE, not a
  full rescan, and the controller now maintains a lemma-presence MULTISET (+ slot-original
  multiset) updated per tick by a top-level block IDENTITY diff (persistent PM nodes; per-block
  contributions cached by node identity — `blockLemmas`). The phantom-snapshot guard holds because
  the index is global by construction: a removal anywhere decrements it whether or not the window
  saw it (`controller.presence.test.ts` pins outside-window deletion, duplicate-lemma survival,
  slot protection, split/join). Measured: deletion-tick scas-tick 150ms → ≤21ms (4× phone emu,
  20k words). The windowed decoration splice is only legal when the tick did NOT change SCAS state
  (a verdict change repaints that lemma doc-wide). Word count runs ONLY while ◈ is open.
- Enter must do NO O(doc) work on the keystroke (round-4 "mega lag": Enter p50 300ms → ~100ms,
  ≈2× a plain char): the paragraph-snapshot trigger reads ONLY the completed paragraph's
  textContent, and the snapshot chain (ensureDocFresh + JCS + hash + OPFS + OTS) is deferred to a
  genuine input pause (runWhenQuiet 1.5s — content is captured at WORK time, as it always was).
  The old residual tail (the ~1.1s canonical measure at the 850/1200ms pause) is FIXED by the
  round-5 incremental break recompute below.

- **The footer toolbar is slaved to the VISUAL viewport by transform (2026-07-11).** iOS never
  resizes the layout viewport for the keyboard — it shrinks/pans the visual viewport, and WebKit
  composites keyboard-up pans WITHOUT re-running layout, so a layout-property lift (`bottom`) on
  the fixed wrapper doesn't apply mid-pan: the bar floated "all over the shop". The dock
  (`editor/toolbarDock.ts`, unit-tested against a stubbed vv) writes `translate3d(0,-off,0)` on
  the wrapper per frame while geometry moves (sync write on each vv resize/scroll + rAF follow
  loop for momentum tails + 500ms drift watchdog); `--iw-kb-offset` carries the same value for
  the scroll-padding reserve. PM's scrollThreshold/scrollMargin stay toolbarH + 28 ONLY:
  prosemirror-view's windowRect bottom is ALREADY visualViewport.height, so a kb-inclusive PM
  reserve double-counts the keyboard (probed: +180px over-scroll then −84px pull-back on
  alternating Enters — a screen bounce per keystroke). Programmatic caret
  reveals (keepCaret) are FORBIDDEN while the geometry is moving (`isSettled()` false) — they
  fight iOS's own focus pan (the tap-to-type double-jump); the dock's onSettled runs them once,
  then re-runs at +250/600ms (no-op-guarded — iOS's focus pan can land AFTER our settle and
  re-hide the caret behind the pill; the tap, not the first keystroke, owns the reveal).
  Never move the lift back into `bottom`/CSS-var positioning. Transitioning the transform is
  allowed ONLY for large event-driven jumps (>60px = a keyboard show/hide step gets a 250ms
  ease-out "chase"); per-frame follow writes (pans/momentum) must stay transition-free.
  Rubber-band/pull-to-refresh: kbOffsetFor clamps negative offsetTop AND the dock freezes
  whole while `overscroll` (scrollY outside [0,max]) — elastic geometry is garbage and the
  old math rode the bar to mid-screen.
- **Toolbar menus must not dismiss the keyboard (2026-07-12).** Any tap outside the
  contenteditable blurs it on iOS → keyboard retracts → the docked pill + its just-opened menu
  slide to the screen bottom. A document-level capture pointerdown guard preventDefaults taps
  on `.iw-touch-guard` surfaces (the pill AND every PORTALED drop-up panel — Settings/Options/
  Page/Guide/Math all carry the class) while the editor owns focus; real form fields
  (input/textarea/select/contenteditable) are exempt. New footer drop-ups MUST carry
  `iw-touch-guard` or their taps will retract the keyboard.
