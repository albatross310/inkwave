<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Music module (`src/music/` — LIVE, default ON)

Photo score + reflow + markup, the MusicXML path, lesson capture (`src/music/lesson/`, `?lesson`,
DEFAULT OFF). Reached from the toolbar's ♪ bar as portalled panels; `/music` the route is GONE; heavy
canvas/OSMD chunks stay behind lazy imports. Build log: `docs/archive/music-module-build.md`. Spec:
`docs/specs/Inkwave-Music-Module-BuildSpec-v0.1.md`.

- **⚠ NO OMR, EVER.** The CV is barline/whitespace GEOMETRY only — row darkness, longest horizontal
  run, longest vertical run. Nothing recognises a note and nothing may. The score is **markup-only,
  never editable**; no field on `Piece` changes a note. Inkwave consumes Sibelius/MuseScore/Dorico
  output; it does not compete with them.
- **Barline pre-detection REFUSES a single stave, and the refusal IS the feature** — the populations
  overlap and calibrating on a synthetic barline would be circular. **A hallucinated bar mis-anchors
  every heatmap range, lesson note and recording pinned to it, and looks correct.**
  `{singleStave:true}` exists ONLY as the test's known-negative.
- **`groupStavesIntoSystems`' connector test is what keeps a grand stave whole** — a gap-size
  heuristic slices a pianist's hands apart. `{connectorTest:false}` is a known-negative only.
- **`deskew`'s `repair` step is not polish** — without the 1px vertical dilation an EXACT skew
  estimate still detects 0 staves.
- **`binarise` is LOCAL because a harsh shadow demands it**, not on principle. If the `harshShadow`
  known-negative stops firing, local has no proven reason to be there.
- **Anchors live in SOURCE-IMAGE space; the reflow is a pure view transform.** Marks in inserted gaps
  carry a `GapOffset`. Deskew happens at capture, ONCE, so image, anchors, layout and bar regions
  share one coordinate space.
- **A Piece is an ORDINARY document** (`docType: 'music'`, `piece.id === doc.id`) — history, hashing,
  capture and sync come from being a document. No parallel container. `piece` and `music` are
  DIFFERENT fields: `music` is prose that QUOTES music, `piece` is a document that IS it.
- **`bar_index` (0-based ordinal) is the JOIN KEY; `bar_label` (as printed) is NEVER a key** — by
  MusicXML spec it is a STRING and not unique. **Carry what you know; resolve later; never fabricate
  the key.** `BarAnchor` carries no region and **must not grow one**.
- **A recolour KEEPS what it covered** (`colourAt` is latest-by-ts); **`erase` refuses across the
  author boundary and says so**; a backwards sweep is NORMALISED; `heatmapHash` sorts by (ts,id). The
  palette carries NO severity ordering.
- **Rendered notation cannot use `var()`** — OSMD accepts only concrete hex, so `music/theme.ts`
  RESOLVES tokens against the live DOM at draw time and a `data-theme` observer redraws. A score
  container missing `iw-nightable` silently reads every day fallback and renders black on charcoal.
- **The reflow GAP BAND is PAPER, not chrome** — `--iw-score-gap` in both themes.
- **ONE type ramp** (`music/typeScale.ts`, five semantic steps, every step ≥16px so the iOS auto-zoom
  floor is unreachable). Pick a step by what the text is FOR, not by size.
- **§A5 practice recordings CANNOT SHIP without editing `vercel.json`'s `microphone=()`** — the lesson
  lane's deliberate firebreak and the single place that decision is made. Coordinate first.
- **Lesson STT is 'unverifiable', not on-device, and no copy may claim otherwise** —
  `webkitSpeechRecognition` falls back to Apple's servers SILENTLY. The transcript is non-storable
  STRUCTURALLY (`#private` field, redacting `toJSON`, no field on `LessonRecord`). Copy is SCOPED to
  the screen ("nothing on this screen can reach a microphone") because the app-wide claim expires when
  §A5 ships.
- **⚠ THERE IS NO AT-REST ENCRYPTION IN THIS BUILD** (both music specs say there is; `storage/opfs.ts`
  writes plaintext JSON, no `crypto.subtle.encrypt` in src). The shippable sentence is "Stored on your
  device — we never hold it".
- **`vercel.json` TAKES NO COMMENTS** — a `"//"` key is a hard schema reject that fails every deploy
  **before the build starts**, and `pnpm build` never reads the file, so a clean local build passes
  with the site broken.

