# Music module + lesson capture — build log (2026-07-17 → 2026-07-19)

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "Music module"; that entry points here.

Both modules are built and live. What is preserved here is the *reasoning*, because three of these
decisions are ones a later lane will be tempted to reverse:

1. **No OMR, ever.** The CV is barline/whitespace geometry only. Nothing recognises a note.
2. **Barline pre-detection REFUSES a single stave, and the refusal is the feature.** It is not
   solvable by geometry there — the only separating threshold exists because a synthetic barline is
   geometrically perfect, and calibrating on that fixture would be circular. A hallucinated bar
   mis-anchors every heatmap range, lesson note and recording pinned to it *and looks correct*.
3. **`webkitSpeechRecognition` is classified 'unverifiable', not 'on-device'.** The spec promised
   on-device STT; the primary sources say WebKit asks for it only opportunistically and falls back
   to Apple's servers silently, and the page cannot query or observe which happened. A promise whose
   whole value is that it is provable cannot rest on it.

---

## Music module — photo score + reflow + markup (2026-07-17, `src/music/`, flag `?music`, DEFAULT ON since 2026-07-19)

Spec: `Inkwave-Music-Module-BuildSpec-v0.1.md` §A1/§A2 (now COMMITTED at `docs/specs/` — Peter, 2026-07-17: "commit the specs"
into the repo). Build order step 1 of 7. All canvas work sits behind a lazy import (`MusicStudio`
29kB/11.3kB gzip) so the flag being ON costs nothing on the editor's own load path BY CONSTRUCTION.

**⚠ SUPERSEDES THE PARAGRAPH ABOVE — `/music` IS GONE, AND THE MODULE IS LIVE (2026-07-18/19).**
Peter: *"music as a LAYER over the editor … no /music doesn't survive. it should all be in panels."*
`33013fa` retired the route (`routes/Music.tsx` + `app/routes/music.tsx` deleted; a stale bookmark
falls through the catch-all to the editor). The module is now reached from the toolbar's **♪ bar**
(`components/MusicBar.tsx`): "Import a score" opens `MusicPanel` (MusicXML import/play/excerpt-attach)
and "Score studio" opens `MusicStudio` (photo/markup/heatmap), both as **portalled panels over the
open editor** — `lazy(() => import(...))`, two separate chunks behind the editor's own dynamic import,
so the editor's static graph stays untouched. `MusicStudio` takes `documentId`: over an open document
it loads THAT document's Piece; on a prose document (no Piece) it says so honestly rather than minting
one over an essay. `3eaa098` (2026-07-19) then graduated `musicEnabled()` itself to **DEFAULT ON**
(`!== '0'`; `?music=off` persists a sticky `'0'` opt-out) — both halves of the module were judged real
(the ♪ bar reaches a live studio/panel, and photo→Piece creation below means the studio opens an
actual score, not just the demo harness), so per the "STOP FLAGGING EVERYTHING" rule below it ships.
The ♪ slot itself stays in the ▲ drawer, not the main row. Heavy chunks remain lazy — confirmed
browser-verified: default ON with no URL param, the OSMD/heavy-music chunk is NOT fetched on `/`.

**"Make this a music score" (2026-07-18, `50fc8b7`).** The media-import photo button wires straight
into `MusicStudio` via `store.ts savePiece` + `newPieceDocument` — a photo LIVES IN a document and
*becomes* its own `docType:'music'` `.studio` (it does not convert the essay you imported it from).
This is what let the graduation above claim the studio reaches a REAL score.

**Webcam capture in media import (2026-07-18, `4f963c5` + `bbe87a0`).** Peter: *"the photo button
isn't working with my laptop's webcam (which it should)."* The Photo button previously only opened a
file dialog (`<input accept="image/*">` has no camera on desktop). On laptop/desktop it now opens a
webcam-capture POPUP (live preview → Take photo → video frame → canvas → JPEG blob), through the SAME
`importMedia` path a file import uses — no second media store. Touch devices keep the native
`image/*` picker (it already offers the OS camera). Required `vercel.json`'s `Permissions-Policy` to
grant `camera=(self)` (was `camera=()`, disabling the camera at the HTTP header for every origin) —
the exact mirror of the microphone firebreak's line; `microphone=()`/`geolocation=()`/`payment=…` are
untouched, only `camera` changes, to the narrowest grant that works. `camera.ts` is the ONLY module
allowed to name `getUserMedia`, and only because it names no audio-specific API — the mic firebreak
(`music/lesson/micBoundary.ts`) gained a `CAMERA_CAPABLE` exemption for it, but `add2487` (same day)
closed a real gap: the exemption's `AUDIO_ONLY_PATTERN` didn't read the *constraints*, so a
`camera.ts` edited to pass `audio:true` would have opened a microphone through the "camera" file
without tripping the sweep (not a live breach — `microphone=()` still denied the track at the
platform — but the source firebreak wasn't independently holding). Fixed: `\baudio\s*:\s*true\b` now
trips the pattern; a bare, ambiguous `getUserMedia` token stays exempt. The camera releases every
track the instant capture completes or the popup closes (mutation-proved). Captured photos stay
LOCAL (OPFS) — no network, no upload; provenance-untouched (media on `doc.media`, the PDF precedent).

- **⚠️ NO OMR, EVER (§0, repeatedly).** The CV is barline/whitespace GEOMETRY only: row darkness,
  longest horizontal run, longest vertical run. Nothing recognises a note, and nothing may. The score
  is **markup-only, never editable** — no field on `Piece` changes a note. Inkwave consumes
  Sibelius/MuseScore/Dorico output; it does not compete with them.
- **`music/types.ts` IS A CONTRACT** — the §1 `Piece`. Two other lanes (MusicXML §B, lesson capture
  §A3) build against it. snake_case is deliberate (a document/wire contract written as the spec
  writes it, so three lanes reading one spec converge); don't "tidy" it. ADD to it; never redefine a
  field in place. `Anchor` is a discriminated union (`region` for photo | `musicxml` for notation)
  with `bar_index`/`bar_label` as the JOIN KEY on both (see the BarRef ruling below) — that is what
  links a lesson note, a heatmap range and a recording to the same music whichever path the Piece
  came in through.
- **⚠️ `bar: number` IS GONE — IT MEANT THREE DIFFERENT THINGS AT ONCE (2026-07-17, the Piece owner's
  ruling, raised by the MusicXML lane which refused to fork).** One field name was being read as: the
  MusicXML lane's `Measure.index` (a 0-based ORDINAL), the lesson lane's `{bar: 24}` (a number a
  TEACHER TYPED, i.e. a printed label), and the heatmap's `bars: [a,b]` (an ordinal RANGE). The facts
  that decide it come from `parse.ts`, not from taste: **a printed bar number is a STRING by MusicXML
  spec** ('0' pickups, '8a'/'8b' repeat endings) **and is NOT UNIQUE** (`indicesOfPrintedBar` returns
  an ARRAY; multi-movement files restart at 1; `onlyIndexOf` REFUSES ambiguity). A value that can
  match two different bars cannot be a key. So:
  · **`bar_index`** — 0-based ORDINAL, identical to `parse.ts` `Measure.index` (no conversion for that
    lane, and nobody misreads `bar_index: 23` as "bar 23"). Sortable, rangeable. THE JOIN KEY.
  · **`bar_label`** — the bar as PRINTED or SPOKEN. Display + citation. Ambiguous. NEVER a key.
  BOTH OPTIONAL, and that is the point: they are known at different times. A teacher saying "bar 24"
  mid-lesson on a PHOTO piece gives a label and nothing else — that Piece has no bar model until
  barlines are tapped (§A4) or pre-detected, so there is no ordinal and inventing one is a guess.
  Carry what you know; resolve later; never fabricate the key. FOUND ON THE WAY: `LessonPanel` did
  `Number(bar) > 0` on the teacher's typed value, so **'8a' → NaN and '0' → false BOTH silently
  dropped the anchor** — the note attached to nothing, no error. It stores the label verbatim now.
  **Carry what you know; resolve later; never fabricate the key.**
  `LessonNote`/`Assignment` are declared ONCE — in `types.ts`, the CONTRACT — and IMPORTED by
  `lesson/types.ts`. The direction was WRONG on this branch first (types.ts imported them FROM the
  lesson lane), which went circular the moment that lane unforked: §1 itself declares
  `lesson_notes: [LessonNote]` and spells the type out, so it is a contract type the lesson lane
  FILLS, not a lesson type the Piece borrows. Both lanes reached "declare once" independently; only
  the arrow needed settling.
- **`Anchor` HAS A THIRD VARIANT — `BarAnchor` `{kind:'bar', bar_index?, bar_label?, page?}` (2026-07-17),
  answering the lesson lane's `BarOnlyAnchor` ask.** That lane found §1's union could not express
  **"bar 24" alone** — which is ALL a student has mid-lesson, typing while their teacher talks on a
  photograph whose barlines may never be marked — and REFUSED all three dishonest ways round it
  (fabricate a `region` rect the student never drew; misuse `MusicXmlAnchor` on a photo Piece; fork
  its own anchor). It was right on every count. The variant is not a special case bolted on: it is
  what BarRef's "both optional" MEANS, made reachable. It carries NO region and **must not grow
  one** — the moment it can hold coordinates, the temptation returns to fill them with a guess,
  which is the exact lie that lane refused. `page` is a HINT for later resolution, never an address.
  Consequence: `PinnedLessonNote` is GONE (the bar rides inside `LessonNote.anchor`, where §1 always
  said it belonged) and a bar-pinned lesson note round-trips into `Piece.lesson_notes[].anchor` for
  real. NB the ask proposed `bar: number`; the answer is `bar_label` (a teacher SAYS a label), with
  `bar_index` left absent until there is a bar model to resolve against.
- **THE HEATMAP (§A2, step 5 — `heatmap.ts` pure + 21 tests, `HeatmapScreen.tsx`).** Sweep a Pencil
  across bars, pick a colour. **MANUAL ANNOTATION, NEVER AN AI JUDGEMENT** ("nothing opaque to
  defend") — nothing computes, scores or suggests a colour, and the palette carries NO severity
  ordering precisely because a numeric level is the field a later change would start averaging
  (asserted structurally). Rules that are load-bearing: a recolour **KEEPS what it covered** (§A2's
  record is "over TIME", so `colourAt` = latest-by-ts and `historyAt` shows the layers — deleting
  would let the anchored record attest a history that had been rewritten); `erase` **refuses across
  the author boundary** and SAYS so (a student's stray tap must not delete what the teacher marked
  mid-lesson); a backwards sweep is NORMALISED (right-to-left is as natural, and unnormalised
  `colourAt` finds nothing between 4 and 2 — a stroke that silently does nothing); `heatmapHash`
  reuses `provenance/hash`'s JCS+SHA-256 and sorts by (ts,id) so **array order cannot move it** (two
  devices legitimately differ; a hash that moved with order would cry tamper on a mere sync).
- **BARLINE PRE-DETECTION EXISTS AND REFUSES SINGLE STAVES — the refusal IS the feature.** §A2 allows
  optional bar pre-detection "to make selection easier". On a GRAND STAVE it is decisive and
  structural: barlines cross between the staves, a stem is trapped in one, so the populations are
  ~1.0 vs <0.7 — measured, threshold-independent. On a SINGLE stave it is **not solvable by geometry**:
  a stem on a note sitting on the bottom line reaches the top line (real engraving, not a fixture
  artifact). MEASURED on `cleanThreeSystems`: real barlines coverage 1.000 / stems 0.848–**0.939**,
  and longest-run does NOT separate them either (stems reach 1.000 by bridging their gaps) — system 2
  hallucinated FOUR extra bars. The only separator is a cut in (0.939, 1.000), **a margin that exists
  only because a synthetic barline is geometrically perfect**; a photographed one fades and breaks, so
  the cut would reject real barlines on real paper. Calibrating it here would be `phase.variants`' F1
  circularity exactly (a synthetic fixture can prove a rule INSENSITIVE; it cannot CALIBRATE a
  cut-point). So it is not calibrated — it refuses, and §A4's MVP (the student taps) takes over. A
  hallucinated bar mis-anchors every heatmap range, lesson note and recording pinned to it AND looks
  like a correct answer. `{singleStave:true}` exists ONLY as the test's known-negative. Resolving a
  single stave needs to know a line is attached to a NOTEHEAD — that is note recognition. Never.
- **⚠️ THERE IS NO AT-REST ENCRYPTION — the spec says there is, and it is WRONG.** §0 lists
  "encryption at rest" as reused from the engine and §1 repeats it. Verified in the code (again,
  2026-07-17): `storage/opfs.ts` writes `JSON.stringify` in PLAINTEXT, no `crypto.subtle.encrypt`/
  AES-GCM anywhere in src, no crypto library in package.json (`@noble/ed25519` is for SIGNING).
  Copy tracks the CODE, not the spec — a plan is not a property. The shipped sentence is the email
  lane's: **"Stored on your device — we never hold it"**, which is exactly true (zero-retention IS
  real: no server holds any of it). Do not build a music-only encryption scheme over an app-wide gap.
- **ANCHORS LIVE IN SOURCE-IMAGE SPACE; THE REFLOW IS A PURE VIEW TRANSFORM.** The whole §A1 feature
  inserts blank bands between systems, and the student drags handles to resize them. Had anchors been
  stored in rendered coordinates, one handle-drag would slide every mark below it off its music. So
  `reflow.ts` maps source↔layout (`buildLayout`/`sourceToLayout`/`layoutToSource`) and the image is
  NEVER rewritten — each slice is the same `<img>` shifted under its own window. Marks written INTO
  inserted space have no source pixel (that is the point of the gap), so they carry `GapOffset`
  {after_system, t} and travel with their gap when it resizes. Pinned by tests.
- **DESKEW HAPPENS AT CAPTURE, ONCE** (`capture.ts` rotates the bitmap before storing) so the stored
  image, the anchors, the layout and the bar regions share ONE coordinate space. Two spaces for one
  page is round 11's bug ("two rules, one pane").
- **THE CONNECTOR TEST IS WHAT KEEPS A GRAND STAVE WHOLE — gap size alone cannot.** §A1's "never
  split a system" fails exactly where it matters: engravers cramp system spacing, so on a piano score
  the treble→bass gap and the system→system gap nearly collide and a size heuristic slices the
  pianist's hands apart. The robust signal is structural and still pure geometry: staves inside one
  system are JOINED by barlines running through the gap. `hasVerticalConnector` reads that; it reads
  the same on a cramped page as a spacious one because it measures the engraver's INTENT, not their
  spacing budget. `groupStavesIntoSystems({connectorTest:false})` exists ONLY as the test's
  known-negative (it splits every grand stave) — never turn it off in the app.
- **`deskew`'s `repair` step is NOT polish — without it deskew makes things WORSE, silently.**
  MEASURED: the skew estimate came back EXACT (2.40 vs a 2.4 truth) and detection still found **0
  staves**, because a binary shear rounds each column's shift to a whole row, so a staff line wobbles
  between adjacent rows and no ROW holds a long run (longest collapsed to 0.15 of the width). A 1px
  vertical dilation stitches it back: 0 staves → 4, at the fixture's exact truth positions. It lives
  inside `deskew` because it repairs that function's OWN quantisation.
- **`binarise` is LOCAL (Bradley–Roth), and the reason was measured, not assumed.** At moderate
  lighting a global Otsu threshold does JUST AS WELL — the first version of that test proved nothing.
  Local only wins under a harsh shadow (fixture `harshShadow`, strength 1.4) where shadowed paper is
  darker than lit ink: global floods 36% of the page and detection collapses 2 systems → 1; local
  holds. That is the known-negative; if it stops firing, `binarise` has no proven reason to be local.
- **FIXTURES ARE SYNTHETIC AND GENERATED (`fixtures.ts`)** — copyright/thesis integrity (no real
  engraving, none of Peter's material, ever) and ground truth (the generator knows where it put every
  system). They rotate for REAL while the detector models skew as a SHEAR, deliberately: a fixture
  sharing the model's assumption certifies that assumption against itself. Each one exists to break
  something: `crampedGrandStaves` (the collision), `skewedPhoto`, `harshShadow`, `withLyrics` (ink in
  the whitespace), `singleSystem` (no gap population to reason from), `mixedGrandAndSingle`.
  **HONEST GAP: synthetic proves the GEOMETRY, not a real phone photo of real paper** — no
  perspective/keystone (only rotation), no paper texture, no JPEG ringing. A page held at an angle has
  converging staff lines no shear can straighten; the manual handles are the current answer.
- **Leader routing (`leader.ts`) scores candidate curves** (crossings → exit style → length), and its
  "avoidance" has an HONEST LIMIT recorded in the code: a system spans the page width, so a leader
  from a distant gap MUST cross what lies between — no curve routes around a band with no ends. It
  chooses WHERE to cross. What it genuinely routes around are LOCAL obstacles (the student's other
  sticky notes crowding the same gap), which is the congestion §A2 actually describes. The vertical
  exit exists ONLY to dodge; the sideways exit wins ties for LEGIBILITY (a line leaving the label
  sideways reads as a pointer; a vertical one reads as a stem) — it must not win on length, which it
  otherwise does whenever the target sits directly below the label, i.e. the commonest case.
  **⚠️ §A2's midline rule ("above-midline → belongs to the stave below") is GENUINELY AMBIGUOUS** and
  is implemented LITERALLY as a default with `LeaderContent.side` overriding it — Peter to confirm.
- **`scripts/music.prove.mjs`** (headless, own port 4941, nothing on Peter's screen) drives the REAL
  built app: flag-off → stub + the chunk never fetched (with a known-negative proving the listener can
  see a fetch), demo → capture → detect → reflow handles → OPFS round-trip → a stroke → RELOAD → the
  stroke survives. 13/13. **It caught a bug the unit tests structurally could not:** the demo minted a
  fresh `uuidv4()` per load, so reloading orphaned every mark under the old id AND leaked a piece
  (two page images) into OPFS every time. Both live in browser storage, not in the pure detector.
  Its hydration-error control is `/productivity`, NOT `/verify`: /verify is PRERENDERED so it has no
  mismatch to reproduce and threw nothing, which read as "these errors are yours". Non-prerendered
  routes are served the prerendered EDITOR page through the SPA fallback and hydrate against it — the
  same artefact CLAUDE.md records for /snapshot. Compare like with like.
  ROUND 2 (2026-07-17) — 21/21, now also: **the EDITOR's load path** (opening `/` fetches no music
  chunk, with a void-guard so a blind listener can't pass it — "off costs nothing" is a claim about
  `/`, not about /music, and `Edit.tsx`'s module-scope `import()` proves a dynamic import can still
  be eager-in-effect); the heatmap sweep → teacher attribution → provenance hash → reload.
  - **A SEPARATE CHUNK FILE IS NOT EVIDENCE OF LAZINESS — caught here, live.** `demo.ts` statically
    imported `fixtures.ts` (the whole synthetic score GENERATOR, for tests + `?music=demo`) and
    MusicStudio statically imported demo — so the generator's strings were measured INSIDE
    `MusicStudio-*.js`, shipping to every REAL music user. Now `await import('./demo')`: 3.8KB splits
    out, fetched only for `?music=demo`. Grep a surviving STRING LITERAL to locate code in a chunk;
    minified identifiers don't grep.
  - **`chunk.test.ts` READS REAL BUILD OUTPUT — it fails against a STALE `build/`.** It failed the
    full gate here purely because the build predated another lane's merge; `pnpm build` → 12/12. It
    is not flaky; it is telling you the truth about a directory you forgot to refresh.
  - **A PROBE THAT PASSED BY LUCK.** The stroke-persistence check reloaded the instant the pointer
    lifted, racing the async `savePiece`. It passed for a round, then failed when unrelated rendering
    shifted the timing a few ms — i.e. it would have reported "persistence is broken" about a
    persistence layer that works. It waits for the write now.
- **TYPE SCALE — `music/typeScale.ts`, ONE ramp, five semantic steps** (Peter 2026-07-17: "Music
  likewise needs all the fonts increased… **Every font proportionally up**. **It's okay if users have
  to scroll**"). Before it the module had **NINE nearly-identical sizes** (10,12,13,14,15,16,17,20,22)
  across TWO vocabularies (inline `fontSize` here, Tailwind `text-xs/sm/xl` in `MusicPanel`/
  `ScoreView`) — nobody chose nine, they accumulated one component at a time. Scaling by hand makes
  nine new ones; two lanes doing it independently makes fifteen. Steps are SEMANTIC (`TYPE.label`,
  because the thing IS a label) — "which number is closest" has no answer, "what is this text for"
  does. **title 30 / heading 24 / body 20 / label 18 / meta 16.** Every step ≥16, so the iOS
  auto-zoom trap is unreachable BY CONSTRUCTION rather than by remembering a two-tier rule someone
  forgets the day they add an input. The ramp is FLATTER than the old one (bottom rises 1.6×, top
  1.36×) — a real consequence of the floor, and right: hierarchy is carried by weight and colour, and
  a 10px timestamp was illegible at music-stand distance, which is this module's actual reading
  distance. ⚠️ **OFFERED TO THE MusicXML LANE as the shared ramp** — it has the same instruction.
- **NIGHT MODE, EYEBALLED (2026-07-17) — and the theming rule was WRONG in one place.** The reflow
  GAP BAND carried `iw-nightable`, so it took the dolphin-grey chrome surface and rendered as a DARK
  BAND slicing through a white photograph of a page; it looked like a rendering fault. **The gap is
  not chrome — it is PAPER**, the space the student writes on, inserted into their own photograph,
  and a photograph has no night mode (you cannot invert a picture of a page and still call it their
  score). It now takes `--iw-score-gap` (paper in both themes). Structural assertions could never
  have caught this: the class was present and the token resolved — it was *correct* and *wrong*.
  Bar thumbnails scale with the ramp (`TYPE.title * 2`); words growing while the music stayed at 34px
  would invert the hierarchy of a screen whose whole subject is the music.
- **A PIECE IS AN ORDINARY DOCUMENT — the §1 fork is retired (2026-07-17).** `music/store.ts` wrote a
  PARALLEL container at `music/<pieceId>/piece.json`, beside `documents/<id>/current.json`. §1 says
  "the whole thing is bundled in a single `.studio` file (the Inkwave document container)" and
  explicitly not to have a second one; the cost was concrete — a Piece got no edit history, no
  provenance hashing, no session capture and no cloud sync, because those happen to DOCUMENTS. Now
  `docType: 'music'` + `piece?: Piece` (the email lane's precedent, verbatim: "An email is an ORDINARY
  document — that is the whole design"), and **`piece.id === doc.id`**, which keeps the asset paths
  (`music/<id>/assets/…`) byte-identical across the migration — only the JSON relocates.
  **`listPieceIds()` IS DELETED and the deletion is the point**: it answered "which piece?" by listing
  a private store and taking `[0]`, a question a Piece-as-document does not have (the answer is "the
  document you have open"); keeping it would mean parsing every document on disk to filter by docType.
  `migrateLegacyPieces()` drains the old container on open — idempotent, one-way, and **the DOCUMENT
  wins a tie** (a legacy file can only predate this build; the document's copy is what every write
  since has gone to — the 2026-07-05 truncation shape). ⚠️ `piece` is NOT anchored yet: §A6 says it
  should be (a **v:5** bundleHash, the `musicHash` v:4 precedent) — batched with the other anchored-hash
  questions, Peter's call. Declaring the shape now, unwritten, is the MusicXML lane's `annotations: []`
  move: fix the shape so the anchor lands without a protocol change.
- **`piece` AND `music` ARE DIFFERENT FIELDS AND BOTH ARE RIGHT — do not merge them.** `music:
  MusicAttachments` (§B5/§B6) is prose that QUOTES music (an essay with excerpts transcluded);
  `piece: Piece` (§1) is a document that IS music. A doc may legitimately have both (§A6: "write about
  the piece in Inkwave and cite bars"). OPEN, for the MusicXML lane: `PieceSource{type:'musicxml',
  xml_ref}` and `music.masters[]` can name the same bytes — §B6's design is "stored ONCE … deduplicated",
  so `xml_ref` must REFERENCE a master, not duplicate one. Not guessed at; it is that lane's field.
- **`readDocument`'s THREE OUTCOMES ARE NOT OPTIONAL, and I wrote the bug it exists to prevent.**
  `savePiece` first read `loadDocument(id) ?? newPieceDocument()` — so an ERRORED read collapsed to
  "absent", minted a fresh empty document and blind-overwrote the student's real Piece. That is the
  2026-07-15 incident reproduced in eleven characters, by someone who had just read its write-up. **The
  compiler caught it, not care** — which is the whole argument for the union. `loadPiece` THROWS on a
  failed read rather than returning null for the same reason: absence and ignorance are different
  answers, and if a read error read as "no piece" the studio would open an empty one over a real one.
  Both pinned as known-negatives in `store.test.ts` (13 tests).
- **TWO FIDELITY BUGS IN THE SHARED TEST SHIM (`email/testOpfsShim.ts`), both found by being the first
  caller.** (1) It threw `new Error('NotFoundError')` — whose `.name` is `'Error'`, while production
  asks `(err as DOMException)?.name === 'NotFoundError'`. So through the shim **every absent file read
  as a read FAILURE** and `readDocument` answered `{kind:'error'}` where production answers
  `{kind:'absent'}`. The message was clearly meant to be the name. Nothing caught it because no test had
  exercised `readDocument` through the shim. It throws a real `DOMException` now. (2) It had NO
  `entries()`/`keys()`, and both `storage/opfs.ts listDocumentIds` and `music/store.ts legacyPieceIds`
  wrap their walk in `catch → return []` — so a shimmed listing answered **"there are no documents"**
  rather than "I cannot iterate". Same shape as the `text()` note already in that file: **an absent
  method on a shim looks exactly like a feature that never wrote anything.**
- NOT BUILT: **OMR (never)**; reference tracks/tap-sync §A4 (step 3 — and the barline refusal above
  makes it load-bearing: the tap is what gives a PHOTO Piece its bar model at all); practice tools
  §A5 (step 4 — and §A5 CANNOT SHIP without editing `vercel.json`'s `Permissions-Policy:
  microphone=()`, which is the lesson lane's deliberate firebreak; coordinate before touching it).
  `Practice.sessions` REFERENCES productivity ledger rows rather than copying minutes — §A6.4's
  "one representation of measurement, always". LANDED SEPARATELY: lesson capture §A3
  (`music/lesson/`), the MusicXML path §B, the heatmap §A2 (step 5, above).

### §B5 provenance — `bundleHash` gained a v:4 form (2026-07-17)

v:1 `{contentHash,receipts}` / v:2 adds `bibHash` / v:3 adds `emailHash` / **v:4** `{v:4,contentHash,
bibHash:…|null,emailHash:…|null,musicHash,receipts}` when the document carries an attached score.
Snapshots freeze `music` + `musicHash` exactly as they freeze `email` + `emailHash`; verify recomputes
both and folds them into the bundleHash recompute, so OTS genuinely BINDS the notation. Music WINS
over email (a doc with both is v:4) or the musicHash would be silently dropped from what Bitcoin
commits to. Non-music docs keep v:1/v:2/v:3 BYTE-IDENTICALLY — asserted against LITERAL canonical
strings computed by hand (`provenance/musicHash.test.ts`), never against bundleHash's own output,
which would agree with itself however the function changed.

- **WHAT IS ANCHORED IS THE HASH, NOT THE BYTES.** A master's MusicXML lives in OPFS like a PDF
  sidecar; `musicAttachmentsHash` commits to `{id, contentHash}` per master + the §B6 excerpt
  addresses. So correcting the score under an anchored analysis makes the bundle stop verifying —
  strictly stronger than the PDF precedent, where only citation metadata is anchored. Deliberately
  EXCLUDED: the rendered SVG (a function of engine version — anchoring it would make an OSMD upgrade
  look like tampering) and per-master titles/`addedAt` (display metadata and a local clock are not
  evidence; a corpus renaming a piece must not read as a tamper).
- **`annotations` IS HASHED NOW, AT `[]`** — the `receipts`-before-M3 precedent. An empty array
  canonicalises to `[]` whatever its element type turns out to be, so §B4 can land — and settle the
  contested `MusicXmlAnchor.measure: number` question (bar numbers are STRINGS by spec: '0' pickups,
  '8a' endings) — without a new bundle version and without moving any hash computed today.
- **PROVED, not assumed** (`music/provenance.roundtrip.test.ts`): drives the REAL
  createSnapshotIfChanged → gzip archive → stampSnapshot → buildExportBundle → verifyBundle. Asserts
  the digest submitted to the calendar IS the v:4 bundleHash (not contentHash), and that swapping a
  master's notation, editing an excerpt's bar range, tampering-and-recomputing musicHash, or
  STRIPPING the music all FAIL verify. Both halves mutation-proved: dropping mHash from the snapshot's
  bundleHash ⇒ 3 fail; making the verifier ignore frozen music ⇒ 2 fail.
- **A SHARED MUTABLE FIXTURE IS A TEST MEASURING THE TESTS BEFORE IT.** The music fixture was a
  module-level const passed BY REFERENCE into every document; the first tamper test mutated it, so
  the tamper-and-recompute case later "tampered" with an already-tampered value, changed nothing, and
  VERIFIED — reading exactly like the anchor failing to bind. It is a function now.

## Music lesson capture (§A3/§A3b, 2026-07-17 — `src/music/lesson/`, flag `?lesson`, DEFAULT OFF)

**THE SPEC'S PREMISE DOES NOT HOLD IN A PWA, AND NO COPY CLAIMS IT DOES.** §0/§A3/§C1 promise
on-device STT ("audio never leaves the device… there is provably no keepable recording of them").
PROBED, primary sources:
- Inkwave cannot reach the Apple Speech framework. It is not a native app.
- WebKit DOES ask for on-device, but only opportunistically. Verbatim, `WebCore/Modules/speech/
  cocoa/WebSpeechRecognizerTask.mm` (on every shipping `safari-*-branch` checked):
  `if ([_recognizer supportsOnDeviceRecognition]) [_request setRequiresOnDeviceRecognition:YES];`
  **Read the condition, not the wish** — when it is false the audio goes to APPLE'S SERVERS and the
  fallback is SILENT.
- **Apple's own docs settle it** (`supportsOnDeviceRecognition`): *"If `supportsOnDeviceRecognition`
  is `false`, the `SFSpeechRecognizer` requires a network in order to recognize speech."* And
  `requiresOnDeviceRecognition`: *"The request only honors this setting if the
  `supportsOnDeviceRecognition` property is also `true`"* — plus *"on-device requests won't be as
  accurate"*, so the quality argument does not favour it either. Apple documents **no device
  guarantee**: it is a runtime property, so an iPhone-12/A14 floor does NOT buy the on-device branch.
- **The page cannot require, query, or observe it.** `processLocally`/`available()`/`install()` are
  Chrome 139+ only (MDN BCD: safari `false`) and WebKit's `SpeechRecognition.idl` declares none of
  them. Safari's prompt ("Allow X to capture your audio and use it for speech recognition?") does not
  mention Apple either.
⇒ `webkitSpeechRecognition` is **'unverifiable'** — not on-device, not cloud, but *unknowable from
here*, per utterance. **A promise whose entire value is that it is provable cannot rest on it.** It is
classified in `stt.ts` and NOT REGISTERED; only a `no-audio` source exists. whisper-WASM is the only
provable ambient path (`local-model` seam) and is NOT built — its latency on an A14 is **unmeasured**.
**Correction to an earlier objection: there is NO YouTube IFrame anywhere in this repo** (§A4's player
is unbuilt), so "cross-origin isolation would break the embed" is currently moot — probed by grep.
Note for anyone reviving it: **COOP/COEP and Permissions-Policy are per-DOCUMENT, and this app is an
SPA (`ssr:false`) where a route is NOT a document** — client-side navigation to `/lesson` keeps the
entry document's headers, so isolation would apply only on a hard load. Check `crossOriginIsolated`
at runtime; never assume it from the route.

**THE MICROPHONE FIREBREAK (`micBoundary.ts`) — three layers, and layer 1 already existed.**
§A5's practice recordings (student records themselves: consensual, theirs, storable) and §A3's lesson
(the teacher's voice, where "no keepable recording" IS the product) want the SAME API and keep
DIFFERENT promises. The separation is structural:
1. **`Permissions-Policy: microphone=()` in `vercel.json`, DEPLOYED** — the mic is off for the whole
   origin at the HTTP header, so `getUserMedia` cannot succeed anywhere no matter what any module
   calls. **This is the real line: §A5 cannot ship without editing that header** — which is exactly
   the single place the decision must be made, and `micBoundary.test.ts` **binds the lesson copy to
   it** (flip it to `microphone=(self)` and the copy test FIRES with instructions).
2. A source allow-list (`MIC_CAPABLE`, **empty today**) — naming a capture API is a decision.
3. An **import-graph** firebreak — nothing REACHABLE from `src/music/lesson/` may be mic-capable.
   Layer 3 is the one that survives the API moving behind a helper: a grep of `lesson/`'s own files
   would pass forever once §A5 lands `recording/recorder.ts` and `lesson/` imports it. The walk is
   proved to CROSS a real boundary (`lesson/session.ts` → `../types.ts`) before any "found nothing"
   verdict is read — otherwise it is the empty-list probe.
**⚠️ MENTION vs USE — A GUARD THAT READS PROSE AS CODE ATTACKS ITS OWN DOCUMENTATION. It bit THREE
lanes in one round (2026-07-17); if you are writing a source-scanning guard, read this first.**
This repo's comments must NAME the thing they forbid in order to forbid it, and its JSON notes
explain the very rule they encode — so any guard that greps raw text will fire on the explanation
rather than the violation, and **the tempting fix is always to delete the sentence**. That is the
corrosive direction: `claims.test.ts`'s own next test is "comments are stripped — the guard survives
its own documentation". The three, all real:
- `micBoundary`'s first cut matched capture-API names broadly and flagged **`stt.ts`** — i.e. it
  would have forced the module that DOCUMENTS the microphone problem onto the microphone
  allow-list, making the allow-list mean nothing. Reading `typeof globalThis.webkitSpeechRecognition`
  captures no audio; only `new` does. Hence `CAPTURE_APIS` (broad — these names have no innocent use)
  vs `RECOGNISER_APIS` (construction only).
- **`claims.test.ts`'s carrier check** was a bare `.includes('claimMatchers')` over raw source, so
  `micBoundary.ts` CITING claimMatchers.ts as the precedent it follows turned the repo-wide suite
  red. Now strips comments and matches a real IMPORT — with the narrowed check proved to still fire,
  because a guard you narrow and don't re-prove is how a real hole opens.
- **`probe.test.ts`** regexed `JSON.stringify(rule)` for `/microphone/` and failed on the vercel
  rule's OWN comment saying it grants no microphone. Now judges the headers the rule SENDS.
**THE RULE: judge what the code DOES — an import, a call, a header actually sent — never prose about
it.** And every such guard needs the pair proved: fires on a real use, silent on a mention.
`micBoundary.ts` is itself the PATTERN CARRIER (it names every API as data), excluded from its own
scan and **proved inert** — a test asserts only test files import it, the same guard
`claims.test.ts` puts on `claimMatchers.ts`.
**The copy is SCOPED to the screen, deliberately**: "nothing on this screen can reach a microphone",
never "Inkwave does not record audio" — the app-wide claim EXPIRES when §A5 ships, and an expired
sentence goes on being read.

**⚠️ NO ENCRYPTION (§0 and §1 are both WRONG about this)** — verified independently again here.
The transcript is non-storable STRUCTURALLY: `#private` field (invisible to `stringify`), `toJSON()`
redacts, `LessonRecord` has no field to hold one, `end()` drops the reference. Also refused:
*"unrecoverable"/"securely erased"* — `end()` drops a JS reference; it does not wipe a heap.
**TWO INSTRUMENT TRAPS caught here, both the house speciality:** (1) the first deletion test scanned
an ENDED session, found nothing and went green — but the same scan finds nothing on a RUNNING one,
because `#lines` is genuinely private. It scored both states **identically BY CONSTRUCTION** and could
not tell deletion from encapsulation. Claims are now split: the serialisation firebreak is proved by
the scanner (positive control = a `LeakySession`), the deletion by the session's own API (proved to
show the lines BEFORE `end()`). (2) The `audio never leaves your device` matcher **could never fire** —
an affirmative promise phrased as a DENIAL, so `affirmativeOnly()` stripped it and the matcher read an
empty string, passing vacuously. Now `scope: 'literal'`. **Only the prove-it-first rule caught either.**
NOT WIRED to a surface yet — the Piece is now a document (`docType:'music'`) and the music BAR is the
second toolbar layer, so `?lesson` needs a home on it; coordinate with the photo lane rather than
minting a route (`/music` did not survive: Peter, "it should all be in panels").
**The `BarOnlyAnchor` ask is ANSWERED and the fork is gone** — `Anchor` gained
`BarAnchor {kind:'bar', bar_index?, bar_label?}`, `PinnedLessonNote` is retired, and the bar rides
inside `LessonNote.anchor` where §1 always said it belonged. The lane's own prediction held verbatim
("when the contract gains its variant this is the ONE function that changes" — `session.ts` `#keep`).

**`vercel.json` TAKES NO COMMENTS — a `"//"` key there takes the whole site down (2026-07-17).**
JSON has no comments, and Vercel validates `vercel.json` against a strict schema **server-side, before
the build starts**: any unknown property is a hard reject (`headers[0] should NOT have additional
property "//"`). A `"//"` explaining the probe's COOP/COEP sat in `headers[0]` and failed **every
deploy for hours** while master stayed green and shipped nothing.

The reason this took hours to find is the lesson: **`pnpm build` never reads `vercel.json`**, so a
clean-clone reproduction of the build passes with the site utterly broken. I tested the one artifact
that could not fail and reported the code healthy — a local build is not a deploy, and a green build
is not a green deploy. Before blaming the platform (or the bill), validate the config the platform
actually parses: `python3 -c "import json;json.load(open('vercel.json'))"` proves only syntax, NOT the
schema — the `//` key is *valid JSON*. Only Vercel's schema rejects it, so **the error text from a
failed deploy is the primary evidence and there is no local substitute.** Get it first; do not infer a
cause from whatever anomaly you can measure locally (I blamed a deploy-count cap Peter's Pro plan does
not even have). Rationale for anything in `vercel.json` goes HERE, in CLAUDE.md, where it costs nothing.

**THE WHISPER PROBE — `public/whisper-probe.html`, a STANDALONE static document (2026-07-17).**
Peter ruled "we'll ship whisper", which settles WHETHER; the probe decides WHICH MODEL and THREADED
OR NOT on his iPhone 12. It is deliberately NOT a route: COOP/COEP are per-DOCUMENT and this is an
SPA, so a route-based probe would measure whichever document you happened to arrive in. `vercel.json`
grants COOP/COEP to that one path — and **NO microphone: a latency benchmark needs none, so
`microphone=()` stands untouched**; that change belongs with the capture feature, the copy and
`/privacy` in ONE commit, which `micBoundary.test.ts`'s binding enforces rather than trusting.
- **THE CHUNK-SIZE FINDING — a 5s-only probe would have KILLED A WORKING FEATURE.** Whisper's encoder
  always processes a PADDED 30-SECOND WINDOW, so cost is nearly flat in chunk length. Same model,
  same run: **RTF 4.97 at 5s vs 0.40 at 30s — a 12× swing from chunk size ALONE.** The first design
  measured 5s only and would have reported FAIL for everything. That is the MIRROR IMAGE of an
  overclaim and just as wrong: a confident wrong number that ends a viable path. It measures
  `CHUNKS = [5, 30]` and the verdict picks the lowest LATENCY among configs that keep up — latency
  being **chunk duration + inference**, because the student waits for the chunk to FILL before a
  single sample can be transcribed. Reporting inference alone hides half the wait.
- **"THREADED" WAS UNINTERPRETABLE UNTIL IT COUNTED WORKERS.** Desktop showed threaded only ~16%
  faster than single — which could mean threads-don't-help OR numThreads-was-ignored,
  **indistinguishable by construction** (the bake-counter bug again). ORT builds its pool from Web
  Workers, so the page counts Worker constructions: PROVED 0 for 1-thread, 7 for threaded. A threaded
  run that spawned no workers is reported **N/A, never as a number** under a heading that lies.
  Each config also runs in a FRESH DOCUMENT (reload between) because ORT fixes its thread count at
  first-session — a one-page comparison would silently run both threaded.
- **transformers.js is PINNED to the v3 line.** 4.2.0 cannot create an ORT session for these models
  AT ALL — "TransposeDQWeightsForMatMulNBits Missing required scale", identically across tiny/base
  and every dtype, which is what ruled out the model and the dtype and left the runtime.
- **PEAK MEMORY IS NOT MEASURABLE ON iOS SAFARI** (`performance.memory` is Chrome-only;
  `measureUserAgentSpecificMemory` unimplemented). Rather than print a fabricated figure it leaves a
  localStorage breadcrumb before each run and reports **DIED** if one never came back — which is what
  an iOS OOM actually looks like, and is the honest instrument.
- **THE DESKTOP NUMBERS DO NOT TRANSFER (STATED).** This box is WSL2, memory-capped and shared with
  other lanes; the same config swung 5765→24871ms between runs. They prove the machinery, nothing
  more. The sample is whisper.cpp's canonical public-domain JFK clip — clean studio mono, so every
  number is a **LOWER BOUND**; a real lesson room is harder. One quality signal survives the noise:
  **tiny mis-transcribes the clip's most famous line** ("asked not"), base gets it right with
  punctuation — 41MB vs 77MB.
- `probe.test.ts` guards what nothing else in the gate can see (the probe is plain HTML — invisible
  to typecheck and vitest): the COOP/COEP rule, the v3 pin, both chunk sizes, the worker control, the
  runtime `crossOriginIsolated` read, and the absence of a mic.
- **UNVERIFIED (STATED):** validated on headless Chromium only. iOS Safari + COEP `require-corp` +
  jsDelivr module import + HF model fetch is unproven — if a subresource lacks CORP it fails on
  device. It fails LOUDLY (errors are recorded and displayed), so a broken run is legible.

