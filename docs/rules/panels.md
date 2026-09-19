<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Panels, popups and bars — the desktop UI taxonomy

Why: Peter, 2026-09-18 12:11 and 14:36 (the channel). Every floating surface on desktop is ONE of
three things, and the thing decides its size, its place and its type. The numbers live in ONE file,
`src/styles/panelSheet.ts`; a component picks its category there and carries no anchor maths, no
width and no font size of its own. Phone sheets (`PHONE_SHEET`, `phoneSheetStyle`) are a separate,
finished design — nothing below touches them, and a desktop change that moves a phone pixel is a bug.

| Category | What it is | Helper / class | Size | Place | Type |
| --- | --- | --- | --- | --- | --- |
| **popup** | small, from a button: ⋮ menu, ❐ import, ⚙ settings, Σ math, the ⋮ toasts | `desktopPopupStyle(rect)` · `iw-desktop-popup` | content-sized, 200–340 | `DESKTOP_POPUP.gapPx` above its button, centred on it, clamped `edgePx` from the viewport; the tail (`--iw-tail-x`) keeps pointing at the button | 14px |
| **panel** | big, over the writing: P page, i guide, ‟ citations, ⏱ clock, ⋮ → Storage / Recent, the ⋮ modals | `desktopPanelStyle()` · `iw-desktop-panel` | `clamp(420px, 92% of --iw-paper-w, 960px)` — a bit under the paper, so it zooms with the page | centred on the writing area (shifted off a docked PDF) | 15px |
| **bar** | a second row that MERGES with the toolbar: Style, Review, Music | `DESKTOP_BAR_CLASS` (TiptapEditor) · `iw-desktop-bar` | the toolbar's own outline, colour and font | above the pill, same outline | 14px |

- **Every surface wears the sheet edge** — `desktopSheetStyle()`: `DESKTOP_SHEET.radiusPx`,
  `.shadow`, `.border`. That includes the Style-bar popups, the Review set menu, the email provider
  menu, the AI-consent and work-report dialogs, the camera popup. A `rounded-lg shadow-lg` or a
  literal `borderRadius: 12` on a floating box is the bug this rule names.
- **A popup must not be `overflow: hidden`** — the tail hangs outside its box. Scroll an inner div.
- **Every panel starts the same height off the toolbar**, is draggable by its `SheetHeader` and
  resizable (`usePanelDrag`, `components/PanelSheet.tsx`). Drag runs on POINTER events start to
  finish: the grip fires `onPointerDownCapture` with `preventDefault`, which suppresses the
  compatibility `mouseup`, so a `document.addEventListener('mouseup', …)` drag never ends.
- **Bars are the exception to "the second toolbar stays up"**: a bar merges with the toolbar, so it
  retracts on a pointerdown outside the footer chrome or on its own button. No idle timer.
- **Popups open on click-and-hold; a second click on the button closes only the popup** (Peter,
  14:36 — the Style bar must not vanish with it).

### Type — three ramps, and which one a run of text takes

- **Sheet ramp** (`SHEET_TYPE` → `--iw-sheet-body / -small / -meta / -label`; desktop 15/13/12/11,
  phone 17/15/13/11 on `.iw-phone-sheet`). Any text inside a panel or popup. Legacy Tailwind
  `text-sm` / `text-xs` / `text-[11px]` inside a sheet are remapped onto it by index.css.
- **Music / productivity ramp** (`music/typeScale.ts` `TYPE` → `--iw-t-title / -heading / -body /
  -label / -meta`). Desktop `:root` maps it onto the sheet ramp (22/18/15/13/12); the coarse-pointer
  block restores 30/24/20/18/16 (iOS zooms into any control under 16px and stays zoomed).
  `TYPE_PX` holds the phone numbers for the two arithmetic sites (heatmap, score page).
  `prodType.test.ts` guards both and the CSS block that sets them.
- **Bar type** is the toolbar's (`DESKTOP_BAR.fontPx`).
- **Headers, subheads and body text must match across panels** — one `SheetHeader` (small-caps
  label), one `SheetSection`, one body step. A panel with its own `fontSize: '0.72rem'` fine print
  (Math, until 2026-09-18) or its own 18px root (the work report, same day) is the bug.

### Geometry rules still to land (Peter, 14:36 — write the code, then move the row up)

- Panel-to-page side distance is a PROPORTION of the page, at least 2.5× today's, fixed to the
  current proportion once the page fills the window.
- Column widths inside a panel (Page settings first) are proportions, not px, and more even.
- Line widths of pills, buttons and bars do not change under cmd +/- OR the GPU (wave) zoom.
- The productivity panel's sub-panels take the panel rules and the sheet ramp.
- Settings is narrower; the Sync popup is narrower and its bottom edge matches the other popups.

### Proof

`scripts/ui-snaps.mjs` takes one screenshot per panel × 4 viewports × 2 themes (dev-only; output
ignored). Take a BEFORE, change, take an AFTER, diff. `src/styles/cssBlocks.test.ts` pins the
nesting of index.css's media blocks — the 2026-09-18 stray `}` made ~800 lines of desktop rules
phone-only and looked like a design regression.
