<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Theming (MANDATORY for every new panel)

One switch: `src/editor/theme.ts` sets `<html data-theme="night">` (applied pre-hydration in
`entry.client.tsx`). All colours are CSS custom properties in the **NIGHT MODE block at the bottom of
`src/styles/index.css`** — never scatter per-component night overrides. Why:
`docs/archive/panels-and-popovers.md`, `docs/archive/reader-panels.md`.

**Every floating panel / menu / modal MUST:**
1. **Put `iw-nightable` on its outer container** (without it, white-on-white at night). A PORTALLED
   panel carries `iw-nightable` + `iw-touch-guard` itself.
2. **Use a token with a day fallback for any custom inline colour, never a hard-coded hex:**
   `var(--iw-ink, #302438)`, `var(--iw-light, #41425b)`, `var(--iw-cite-color, #302438)`,
   `var(--iw-pill-fg, #78716c)`, `var(--iw-nightable-border, …)`, `var(--iw-verified, #15803d)`,
   `var(--iw-newbtn-fg, …)`, `var(--iw-addbtn-*)`. Define a NEW token in the night block rather than
   inlining a night hex.
3. Rely on `.iw-nightable`'s existing remaps (Tailwind stone/gray/neutral text, `bg-white`, borders,
   hover fills, inputs/selects). New day UI uses black-plum/indigo tokens, not the retired bright
   university-purple.

- **A `var()` with a fallback always renders something, so an UNDECLARED token fails SILENTLY** — kept
  by a sweep in `readerContrast.test.ts`: every `var(--iw-…)` a reader reads must be DECLARED in
  index.css.
- **Charts theme too** — every `fill`/`stroke` in `src/productivity/charts/` is a token with a day
  fallback; `judged.test.ts` fails the build on a bare hex in SERIES_STYLE.
- **jsdom does NOT resolve custom properties from a stylesheet** — a "the night colour applies" unit
  test passes while proving nothing. `theme.test.ts` instead checks: no bare hex in the TS, every
  token defined in both themes *with different values* (read off index.css itself), and the resolver's
  fallback logic.
- **Component tests work** (vite.config.ts drops the React Router plugin under vitest).
  `afterEach(cleanup)` is MANDATORY (no `globals: true` here) or a test measures the previous test's
  still-mounted components. In `.tsx`, `vi.mock`'s factory is hoisted above vitest's own import —
  build recorders inside the factory from plain functions.
- Panels already migrated (add yours): MediaMenu, CitationPanel + EditDialog, ReceiptPanel,
  SyncStatus, footer toolbar, OptionsMenu, SettingsMenu, PageMenu, LimitSelector, StyleBar popups,
  ReviewBar, VerifyModal, AccountControl, the Drive/OneDrive pickers, the PDF find bar,
  ProductivityReportModal, ProductivityPanel, ClockMenu, OpfsInspector, EmailComposePanel,
  LessonPanel, MusicPanel + ScoreView, MusicStudio + ScorePage + HeatmapScreen.

**The reading surfaces have their own night** (SourceBrowser + PdfReaderView, live). Peter: *"the
whole read mode on both pdfs and web pages needs a night mode too — but make sure the palette is
slightly different from the main page and there's a dividing line between."*

- **A mark's IDENTITY (its stored hex) never changes with theme**; what changes is the CONTRAST
  PAIRING — the ink ON it (`--iw-reader-on-mark`, day value byte-equal to the day paper ink).
- **Coloured TEXT is a stroke, so it is cast for DISPLAY ONLY** (`src/reader/markInk.ts` `readerInk()`
  maps stored → token). Nothing is written back; an unknown colour passes through; the output always
  carries the stored value as the `var()` fallback.
- **Night reading paper is warm charcoal `#26241f`** against the editor's cool `--iw-paper: #2c2e35`
  and chrome `#454e59` — same value range, different temperature.
- **WHICH SURFACE A CONTROL SITS ON IS THE WHOLE QUESTION.** The reader panel is not one surface: its
  HEADER is chrome (`--iw-reader-chrome-fg`/`-dim`) while its ARTICLE, MARKUP BAR and every control
  face in that bar are reader PAPER. Error screens render in both, so they take the one ink measuring
  ≥4.5:1 on BOTH.
- **The divider is a token and a dock panel MUST carry `.iw-dock-panel`** —
  `.iw-nightable { border-color: … !important }` beats an INLINE border, so without the class the
  token is inert.
- **The highlight wash is a token** (`--iw-reader-wash`: 55% day, 100% night) applied via
  `.iw-mark-fill`, with the opaque declaration as the `@supports` fallback.
- **A disabled control is exempt from WCAG 1.4.3, so a probe must NAVIGATE first.**
- Guards: `pnpm prove:nightaudit` measures what the pixels ARE (a contrast walker ran 0 failures in
  both themes on the build Peter complained about); `readerContrast.test.ts`, `markInk.test.ts` and
  the `dockLayout.test.ts` divider pair are the unit half.
- **⚠ WHAT NEEDS PETER'S EYES:** casting his coloured *text* is the one place a stored mark renders as
  a different colour by theme. His call whether a maroon annotation reading as light red at night is
  right, or whether that palette should be re-chosen to work on both.

