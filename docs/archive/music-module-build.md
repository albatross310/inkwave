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

---

# <a id="piece-contract"></a>`src/music/types.ts` — the Piece contract

The rules live beside the code as short imperative comments ending
`→ docs/archive/music-module-build.md#<anchor>`. This section carries the reasoning that produced
them.

## <a id="piece-storage-posture"></a>The storage posture — the spec promises encryption, the code writes plaintext

⚠️ STORAGE POSTURE — READ BEFORE WRITING ANY UI COPY OR COMMENT.

Spec §0 lists "encryption at rest" among what is reused from the Inkwave engine, and §1 says the
Piece is "stored in the user's own storage and encrypted at rest". **THAT IS NOT TRUE TODAY** —
verified in the code (2026-07-17): `storage/opfs.ts` writes `JSON.stringify(data)` in PLAINTEXT,
there is no `crypto.subtle.encrypt`/AES-GCM anywhere in src, and package.json carries no crypto
library (`@noble/ed25519` is for SIGNING). A Piece is gzip'd/plain JSON in OPFS — protected by the
browser's origin sandbox and the device's own disk encryption, not by Inkwave. The spec is a PLAN;
a plan is not a property. ZERO-RETENTION *is* real (there is no server holding any of it), so the
true and shippable sentence is the one the email lane landed on after hitting this same wall:

> "Stored on your device — we never hold it."

Do NOT write music-only encryption to paper over an app-wide gap. See CLAUDE.md (email layer §B2.2).

The naming ruling belongs beside it, for the same reason — snake_case is deliberate and is NOT repo
style drift. The Piece is a DOCUMENT/WIRE contract (it is persisted into a `.studio` file and read
by independent lanes), and the spec writes it in snake_case. `productivity/types.ts` made the same
call for the same reason. Three lanes reading one spec and typing what they see is worth more than
internal-style consistency; don't "tidy" it to camelCase.

And the file as a whole is a CONTRACT: three lanes build against it — the photo path (§A1/§A2), the
MusicXML path (§B), and lesson capture (§A3). A silent change here breaks the other two. If a lane
needs a shape that isn't here, ADD to it — never redefine a field's meaning in place.

## <a id="anchor-union"></a>Why `Anchor` is a union, and why `bar` is optional on every variant

Anchors are how EVERYTHING links to the music (§A2 last bullet):

> "Every annotation carries an `anchor` (page + x,y region, and — once barlines are marked, §A5 —
> the bar number) so it can be linked to lesson feedback, the heatmap, and recordings."

A discriminated union, NOT one loose bag of optional fields: §1 says an anchor is "page + region
for photo; note/measure id for MusicXML", and those are genuinely different addressing schemes.
The union makes a consumer handle both explicitly instead of silently reading `page` as 0 on a
MusicXML piece. `bar` is the JOIN KEY and is optional on BOTH variants — it is what lets a lesson
note ("bar 24 — watch the dynamics"), a heatmap range, and a recording refer to the same music
regardless of which path the Piece came in through.

MusicXML addressing is §B4's: "anchor comments to specific notes/measures (addressable in MusicXML —
even cleaner than the photo path's region anchors)". Owned by the MusicXML lane; declared in the
contract so one Annotation type serves both paths and a bar means the same thing on both.

## <a id="anchor-source-space"></a>Anchors live in SOURCE-IMAGE space; the reflow is a pure view transform

THE COORDINATE SPACE IS THE SOURCE IMAGE — the photograph as captured, before reflow.

This is load-bearing and was a real design decision, not an accident of implementation.
Annotation-space reflow (§A1) INSERTS blank bands between systems, which changes the rendered
page's geometry every time the student drags a manual adjust handle. If an anchor were stored in
rendered/reflowed coordinates, nudging one handle would silently slide every annotation below it
off its music. So: the reflow is a pure VIEW TRANSFORM over immutable source coordinates
(`reflow.ts` → `sourceToLayout` / `layoutToSource`), and an anchor never moves when the layout does.

The one case source coordinates cannot express is an annotation written INTO inserted space — it
has no source pixel, which is the entire point of the gap. Those carry `gap_after_system` + a
normalised offset WITHIN that gap, so they stay pinned to the stave they belong to and travel with
it when the gap is resized. See `GapOffset`.

## <a id="bar-anchor"></a>`BarAnchor` — "bar 24", AND NOTHING ELSE

ADDED 2026-07-17, answering the lesson lane's `BarOnlyAnchor` ask. That lane found the gap and
REFUSED all three dishonest ways round it — fabricating a `region` rect the student never drew,
misusing `MusicXmlAnchor` on a photo Piece, or re-forking its own anchor type — and reported it
instead. It was right on every count, and the gap was real: `RegionAnchor` demands a page and a
rect, `MusicXmlAnchor` demands notation, and **mid-lesson the student has neither**. They are
typing while their teacher talks, on a photograph whose barlines may never be marked.

This is not a special case bolted on — it is what BarRef's "both optional" MEANS, made reachable.
A bar-only anchor is the join key when the join key is all that is known:

    { kind: 'bar', bar_label: '24' }              ← mid-lesson: a teacher SAID "bar 24"
    { kind: 'bar', bar_label: '24', bar_index: 23 } ← later, once barlines exist to resolve against

`page` is optional and is a HINT, not an address: on a multi-page photo Piece a student may know
which page they are looking at, and that narrows a later resolution. It never makes this a region.

⚠️ It carries NO region and MUST NOT GROW ONE. The moment this variant can hold coordinates, the
temptation returns to fill them in with a guess — which is the exact lie the lesson lane refused.
If coordinates are genuinely known, that is a `RegionAnchor` and the caller should build one.

## <a id="barref"></a>`BarRef` — one name that was being read three ways

⚠️ THIS REPLACED `bar: number` / `measure: number` (2026-07-17), and the reason is not tidiness —
the single name `bar` was being read three different ways by three lanes at once:

* the MusicXML lane's `Measure.index`  — a 0-based ORDINAL
* the lesson lane's `{ bar: 24 }`      — a number a TEACHER TYPED, i.e. a printed label
* this lane's heatmap `bars: [a, b]`   — an ordinal RANGE to sweep a Pencil across

Those are not the same quantity, and a join key that means three things joins nothing.

THE FACTS THAT DECIDE IT, and they come from the MusicXML lane's own parser (`parse.ts`), not
from taste:

1. **A printed bar number is a STRING by MusicXML spec** — `'0'` pickups, `'8a'`/`'8b'` repeat
   endings. `parse.ts` keeps it verbatim and is right to.
2. **A printed bar number is NOT UNIQUE.** `indicesOfPrintedBar` returns an ARRAY because repeat
   endings reuse numbers and multi-movement files restart at 1; `onlyIndexOf` REFUSES an
   ambiguous reference rather than resolve it to the first hit. So a printed number is
   structurally incapable of being a key — it can match two different bars in one score.
3. Only the ordinal can be sorted, ranged, or joined. A heatmap sweep, a recording's span and an
   excerpt's extent are all ordinal facts.

SO: two fields, and the NAMES carry the semantics because the old name is exactly what failed.

* `bar_index` — 0-based ORDINAL, identical to `parse.ts` `Measure.index` (no conversion for that
  lane, and nobody can misread `bar_index: 23` as "bar 23"). THE JOIN KEY.
* `bar_label` — the bar number as PRINTED or as SPOKEN ('0', '8a', '24'). Display + citation.
  Ambiguous by spec. NEVER a key, never sorted, never ranged.

BOTH ARE OPTIONAL, and that is deliberate rather than lax: they are populated at different times.
A teacher saying "bar 24" during a lesson on a PHOTO piece gives a LABEL and nothing else — that
Piece has no bar model until the student taps barlines (§A4) or the CV pre-detects them, so there
is no ordinal to record and inventing one would be a guess. `bar_index` fills in when the piece
gains a bar model. Carry what you actually know; resolve later; never fabricate the key.

## <a id="asset-ref"></a>`AssetRef` — a handle to bytes, never the bytes

WHY (CLAUDE.md, "Load performance is sacred"): a Piece is a few photographed pages — megabytes.
Inlining base64 into the JSON would put a whole-file parse of every page image on the load path,
which is precisely the class of bug that cost this app ~10s per open (the `blobToBase64` /
heartbeat findings). Refs resolve lazily, on demand, exactly like the PDF sidecars do.

## <a id="system-atomic"></a>A system is atomic to the slicer, whatever it contains

One SYSTEM is the unit the reflow slices between and must NEVER cut through (§A1). A grand stave
(piano treble+bass, or any braced group) is ONE system with several `staves`. `is_grand_stave` is a
rendering/UX convenience; the invariant that matters is structural — a system is atomic to the
slicer, whatever it contains.

A `Stave` is one stave — five lines — detected by GEOMETRY only (row-darkness peaks), never by
reading notes. OMR is an explicit, repeated non-goal (§0): nothing in this module may recognise a
note.

`System.confidence` is how confident the detector is that the boundary BELOW this system is a real
system break ([0,1]). Surfaced to the manual adjust handles (§A1 "manual adjust handles for
messy/skewed photos") so a low-confidence cut is offered for review rather than applied silently.

## <a id="page-reflow"></a>`PageReflow` is a plan, never a mutation

The reflow PLAN for one page: how much blank space to insert after each system. This is a VIEW
TRANSFORM, never a mutation of the image. It is stored (so it survives a reload and travels in the
.studio), it is fully reversible, and the source image is never re-encoded. `gaps` is sparse — a
system with no entry gets `default_gap`.

## <a id="symbol-kind"></a>`symbol` is an ADDITIVE annotation kind

§1 declares `kind: freehand|text|highlight|leader|sticky`. `symbol` is ADDITIVE and is §A2's own
requirement — "musical symbols from a small palette" — which §1's list omits. It is a distinct
kind rather than a `text` with a glyph in it because a symbol has no prose to search, spell-check,
or distil, and the palette must be able to enumerate its own marks.

Its `symbol` field is a palette id (e.g. 'forte', 'crescendo', 'fermata') — NOT a bare glyph: the
palette must be able to render, search and re-style its own marks, and a raw codepoint carries no
meaning.

## <a id="leader-route"></a>The leader route is DERIVED, never stored

Smart leader-line routing (§A2 — distinctive):

> "When the space above/below a stave is cramped, the student draws a curved connector so a
> dynamics/feedback note can sit where there's room and still point to the right place."

The ROUTE IS DERIVED, not stored: `from`/`to` are the two endpoints and `leader.ts` computes the
curve. Storing a baked path would freeze the routing against a reflow the student later adjusts —
the same failure mode the source-coordinate rule above exists to prevent.

`side` is a hint for the router: which side of the stave the target belongs to, §A2's
"above-midline → belongs to the stave below" rule. Derived on creation, overridable by the student.

## <a id="lesson-note-ownership"></a>`LessonNote` is a CONTRACT type, and the import direction was backwards

§1/§A3: "the *raw* transcript is **never** stored here — only the student's own distilled
snippets." There is deliberately NO `transcript` field on Piece and there must never be one:
the session-scoped, non-storable transcript is the entire reassurance that makes a teacher
comfortable being recorded. If a lane needs the live transcript it lives in session memory and
dies with the session — it does not reach this type.

DECLARED ONCE — HERE, IN THE CONTRACT — AND IMPORTED BY `lesson/types.ts`.

The direction matters and I had it BACKWARDS on this branch: I imported these FROM the lesson
lane, which (a) was circular the moment that lane unforked and imported the contract, and (b) had
the ownership wrong. §1 itself declares `lesson_notes: [LessonNote]` and spells out
`LessonNote { id, snippet, anchor(optional → bar), created_at }` — so it is a CONTRACT type that
the lesson lane fills, not a lesson type the Piece borrows. That lane reached the same conclusion
independently on its rebase and deleted its copies; this is the other half. Two identical shapes
are not harmless — they drift the first time one side gains a member (CLAUDE.md: `DocType`).

The teacher's dictated recap (§A3b) can attach "for next week" items — an `Assignment`. Storable BY
DESIGN — the teacher chose to leave it, unlike the raw transcript. `due: 'next_week'` is the only
value §1 names; widen only with Peter's call.

## <a id="barline-anchor"></a>Tapped barlines are the only bar model a photo Piece has — and the `bar` → `bar_index` rename

ONE TAPPED BARLINE — the SPATIAL half of §A4's sync, and the thing that gives a photographed
Piece a bar model at all.

§A4: "MVP: the student marks barlines by tapping their positions on the photo (robust on any
image)." That is not a fallback — it is load-bearing. `reflow.ts` REFUSES to pre-detect barlines
on a single stave (a note stem is not distinguishable from a barline by geometry alone), so for a
violin or vocal part these taps are the ONLY source of bars, and without them the heatmap has
nothing to colour.

An anchor marks a barLINE (a boundary), not a bar. Consecutive anchors on the SAME system are what
define a bar — see `sync.ts` `barSpansFromAnchors`, which is also what makes the cursor incapable
of sweeping across a line end.

On `BarlineAnchor.bar_index`, the 0-based ORDINAL of the bar this barline OPENS:

> ⚠️ Was `bar: number` — renamed 2026-07-17 to match the ruling this same file makes 300 lines
> above. §A4's types were written before it and kept the retired name, which is precisely how a
> vocabulary drifts back in: the rule was documented, and the file that documented it still had
> two counter-examples in its own tail. A closing barline (the last on a piece) opens no bar and
> carries the ordinal one past the final bar.

The TEMPORAL half is `BeatMapEntry` (§A4: "the student taps the beat (counts 1-2-3-4) once"). Its
`beat` is 1-based WITHIN the bar, as counted aloud: musicians count from one, and this is a number
a human taps rather than a key anything joins on.

## <a id="practice-session-ref"></a>A practice session is a REFERENCE into the ledger, not a copy of one

§A5: "practice sessions write to the productivity ledger, so practice counts toward the student's
overall work stats." The ledger owns the measurement (`productivity/types.ts` SessionRow). Copying
minutes here would put a SECOND copy of every measured number beside the ledger's own — which is
exactly the trap CLAUDE.md records (§A6.4, "one representation of measurement, always": two copies
is how a narrative ends up contradicting the bars).

## <a id="master-ref"></a>`MasterRef` is not an `AssetRef`

A MASTER SCORE ID — `MasterMeta.id` from `music/master.ts`. NOT an `AssetRef`.

The question the photo lane left open, answered by the lane that owns the field:
`PieceSource.xml_ref` and `music.masters[]` can name the same bytes, and §B6 is explicit that the
MusicXML is "stored ONCE ... deduplicated". So there is only one right answer: **xml_ref names a
master**, and the master store IS the deduplicated store. It is not a copy in the Piece's assets.

The two stores are genuinely different and neither is wrong:

    AssetRef  → `library/pieces/<pieceId>/assets/<ref>` — PER-PIECE bytes (page photos, recordings).
                Resolved with `getAsset(pieceId, ref)`. Deleting the Piece deletes them.
    MasterRef → `library/scores/<masterId>.musicxml`    — CROSS-DOCUMENT, content-deduplicated.
                Resolved with `loadMasterXml(id)`. Two Pieces of the same public-domain score share
                ONE master (dedup is by contentHash at import), and a master outlives any one Piece —
                which is exactly what makes §B6's "fix the master, every excerpt updates" possible.

WHY A SEPARATE TYPE AND NOT `AssetRef`: `getAsset(pieceId, ref)` resolves a PER-PIECE path. Hand
it a master id and it returns `null` — which surfaces as "this score has no notation", with no
error, on exactly the Pieces that came in through the MusicXML path. Typing this as `AssetRef`
invites that call. The distinct name is the warning; see `pieceSource.test.ts`, which asserts no
call site ever routes an `xml_ref` through the asset store.

RESIDUAL, for the contract's owner: both are `string` aliases, so the wrong call still COMPILES.
Branding them (`string & {__brand}`) would make it a type error rather than a test — worth doing,
but `AssetRef` is the photo lane's field and that is their call, not mine.

## <a id="piece-markup-only"></a>The Piece is markup-only, never editable

§1's Piece is implemented field-for-field. Everything about one piece of music lives in that one
object, and it is what goes in the `.studio`.

The score is MARKUP-ONLY, NEVER EDITABLE (§0, repeatedly): there is no field there that changes a
note, and none may be added. Inkwave consumes Sibelius/MuseScore/Dorico output and adds a study
layer; it does not compete with them.

`newPiece()` returns every collection present and empty — a consumer never has to null-check a
list, which is how an optional array silently becomes `undefined.map is not a function`.

---

# <a id="micboundary"></a>`music/lesson/micBoundary.ts` — the microphone firebreak

## <a id="mic-why"></a>Why the file exists: one API, two promises

Two features want the same Web API and must keep DIFFERENT promises:

* **§A5 — A STUDENT RECORDING THEMSELVES PRACTISING**: consensual, deliberate, theirs, and storable.
  *"each recording is anchored to the bar where it starts… the score itself becomes the index of your
  practice history."* `getUserMedia` → `MediaRecorder` → OPFS. Nothing blocks it and nothing should.
* **§A3 — A TEACHER'S VOICE DURING A LESSON**, where *"there is provably no keepable recording of
  you"* is the entire product, and the person relying on the sentence is not holding the device.

Same API, different guarantee. So the separation has to be STRUCTURAL — the standard already applied
to non-storability (`#private` field, `toJSON()` redacts, `LessonRecord` has no field to hold a
transcript, both mutations proved to fail). **The lesson path must not acquire microphone access as a
side effect of the music module gaining it.** Nobody would decide to break that; it would simply stop
being true, which is how every guarantee in CLAUDE.md's catalogue died.

## <a id="mic-layers"></a>The three layers, and the one that already existed

1. **`Permissions-Policy: microphone=()` — vercel.json, DEPLOYED.** PROBED, and it is the strongest
   thing here: the microphone is disabled for this origin AT THE HTTP HEADER, so
   `getUserMedia({audio:true})` cannot succeed anywhere in Inkwave no matter what any module calls.
   This is not something this lane added — it was already true, and it is why the lesson's copy is
   honest today. **It is also the REAL LINE: §A5's recordings cannot ship until someone edits that
   header, which makes the header the one place the decision must be made.**
2. **A source allow-list** — which module may name a capture API at all (`MIC_CAPABLE`).
3. **An import-graph firebreak** — nothing reachable from `src/music/lesson/` may be mic-capable.
   Layer 3 is the one that survives the API moving: once §A5 puts `getUserMedia` behind a helper, a
   grep for `getUserMedia` in `lesson/` passes while `lesson/` imports the helper. **A scanner that
   only greps the module's own files would report a firebreak that no longer exists — vacuously,
   forever.** So reachability is followed, not assumed.

**THE COPY IS BOUND TO LAYER 1, NOT TO A COMMENT.** "Inkwave does not record audio" stops being true
the moment §A5 ships. So the lesson's claim is SCOPED to the lesson screen ("nothing on this screen
can reach a microphone"), and `micBoundary.test.ts` reads the real header out of vercel.json and
asserts the copy matches the policy. Change the header and the copy test fires. **That is a test that
fires when the line moves, at the line itself.**

`MIC_CAPABLE` is EMPTY today and that is the point. §A5's practice recordings will add exactly one
entry (`src/music/recording/`), and that edit is the moment someone must ALSO change `microphone=()`
→ `microphone=(self)` in vercel.json, update `/privacy` IN THE SAME COMMIT (the standing rule), and
rewrite any copy that says Inkwave does not record audio. **The tests force all four to happen
together instead of the first one happening alone.**

`MIC_FORBIDDEN` names the protected side. If whisper-WASM ever lands ON the lesson path, that entry
does not get quietly deleted: the guarantee CHANGES SHAPE (from "there was never any audio" to "the
audio never left the device, and here is how you check"), the copy changes with it, and the teacher is
told the new truth. Deleting the entry without doing that is precisely the erosion this file exists to
make loud.

## <a id="mic-mention-vs-use"></a>⚠ A GUARD THAT CANNOT TELL A MENTION FROM A USE ATTACKS ITS OWN DOCUMENTATION

`stt.ts` must NAME `webkitSpeechRecognition` in order to feature-detect it — that is the entire
finding of that lane, and reading `typeof globalThis.webkitSpeechRecognition` captures exactly no
audio. Only CONSTRUCTING one opens a microphone. So a bare name is allowed and `new` is not.

**The first cut of this file matched these names broadly and immediately flagged `stt.ts`** — i.e. it
would have forced the module that DOCUMENTS the microphone problem onto the microphone allow-list,
which would have made the allow-list mean nothing.

The capture APIs are a broad match because those identifiers have no innocent use: you do not write
`getUserMedia` without asking for a stream. `createMediaStreamSource`/`AudioWorkletNode` are in that
list because **whisper-WASM's route to a microphone is an AUDIO GRAPH, not `MediaRecorder`** — a
firebreak that only knew about recording would miss transcription entirely, which is the one path
that matters most here.

HONEST LIMIT, stated rather than implied: an indirected construction
(`const R = w.webkitSpeechRecognition; new R()`) evades the regex. Static analysis of a dynamic
language cannot be airtight, which is exactly why the firebreak does not rest on it — layer 1 blocks
`getUserMedia` at the platform for the whole origin regardless of who calls it or how cleverly.
**This layer's job is to make an intentional change VISIBLE and deliberate, not to defeat an
adversary.**

`PATTERN_CARRIER` is this file itself, excluded from its own scan: it has to name every capture API
as a string literal in order to forbid them, so it matches by construction. Same shape as
`src/copy/claimMatchers.ts`. **AND THE EXCLUSION IS ASSERTED, so it cannot become a hole**:
`micBoundary.test.ts` proves this file is imported by TEST FILES ONLY. The moment production code
imports it, the exemption would start covering a real code path — an excluded file that nothing
checks is a place to hide a microphone.

## <a id="mic-camera"></a>THE CAMERA IS NOT THE MICROPHONE, AND `getUserMedia` IS BOTH

`getUserMedia` opens EITHER a camera or a microphone — the constraints object decides, and a source
scan cannot read it. So a module that opens the CAMERA (`{video:true}`) names the exact same
identifier a module that opens the MICROPHONE (`{audio:true}`) does. Dropping `getUserMedia` from the
capture list to let a camera through would open a hole for `getUserMedia({audio:true})`, so it stays.
Instead, a camera module is DECLARED by path.

The microphone guarantee does NOT weaken by one bit:

* `Permissions-Policy: microphone=()` blocks the audio track at the PLATFORM for the whole origin, so
  even a camera module that mistakenly asked for `{audio:true}` gets no microphone. The camera got
  `camera=(self)`; the mic header is untouched.
* A camera-declared file is exempt ONLY for `getUserMedia`. If it ALSO names an audio-specific API —
  `MediaRecorder`, the Web Audio graph, a recogniser — it is STILL flagged, because that is reaching
  past a camera. `isCameraOnly` enforces exactly that.

So it is additive: the mic sweep still SEES `getUserMedia` everywhere; it simply no longer mistakes
the declared camera module for a microphone.

**AND THE `audio: true` LITERAL IS CAUGHT, because its absence was a real hole** (auditor A,
2026-07-18, PROBED on the real sweep): with the camera exemption but without that alternative,
flipping `camera.ts`'s `audio: false` to `audio: true` opened the microphone and every mic-boundary
test still passed, because `isCameraOnly` never read the constraint. `microphone=()` in the header
denied the track regardless — **but that coupled the source firebreak to the platform header, and the
two layers must hold independently.** A dynamic constraints object is still only caught by the header,
unchanged.

The bare `getUserMedia` token is deliberately NOT in the audio-only list: it is camera-or-mic, the
ambiguous one, which is the whole reason a camera needs an explicit declaration. `audio: true` in a
constraints object is not ambiguous — it IS a microphone request.

`isCameraOnly`'s `code` should already have comments stripped: a camera module may DISCUSS the
microphone, and this one's neighbours do.

## <a id="mic-policy-parse"></a>An ABSENT `microphone` directive means ALLOWED

`microphone=()` is an empty allowlist — the feature is disabled for every origin including self.
`microphone=(self)` / `microphone=*` are enabled. **ABSENT defaults to self-allowed, which is why an
absent directive must read as ALLOWED, not as denied.** A parser that treated a missing directive as
"off" would report a firebreak that the platform is not enforcing.

---

# <a id="stt"></a>`music/lesson/stt.ts` — speech-to-text, classified by what we can honestly say

## <a id="stt-finding"></a>THE FINDING (probed 2026-07-17, primary sources)

The music build-spec §0/§A3/§C1 names "on-device speech-to-text: Apple Speech framework
(`requiresOnDeviceRecognition`) or whisper.cpp" and promises the teacher that "audio never leaves the
device" — "there is provably no keepable recording of them". Inkwave is a PWA. It has no access to
the Apple Speech framework. So what is actually reachable, and what may we claim?

1. `webkitSpeechRecognition` EXISTS in Safari 14.1+ / iOS 14.5+ (MDN BCD; WebKit's own
   `SpeechRecognition.idl` carries `InterfaceName=webkitSpeechRecognition`).

2. **WebKit DOES ask for on-device recognition — but ONLY OPPORTUNISTICALLY.** Verbatim from
   `Source/WebCore/Modules/speech/cocoa/WebSpeechRecognizerTask.mm` (present on every shipping
   safari-*-branch checked):

       if ([_recognizer supportsOnDeviceRecognition])
           [_request setRequiresOnDeviceRecognition:YES];

   **Read the condition, not the wish.** When `supportsOnDeviceRecognition` is FALSE the request is
   left at its default and the audio goes to APPLE'S SERVERS. There is no error, no event, no flag —
   the fallback is SILENT.

3. **THE PAGE CANNOT REQUIRE IT, QUERY IT, OR OBSERVE IT.** The Web Speech API's on-device controls —
   `processLocally`, `SpeechRecognition.available()`, `install()` — are Chrome 139+ ONLY (MDN BCD:
   safari `version_added: false`, safari_ios mirrors), and WebKit's IDL does not declare one of them.
   Safari's own permission prompt says "Allow “%@” to capture your audio and use it for speech
   recognition?" (WebCore/en.lproj/Localizable.strings) — it does not mention Apple, so the user is
   not told either.

4. **`supportsOnDeviceRecognition` IS FALSE ON REAL TARGET DEVICES.** Apple's on-device speech needs
   an A12 Bionic or later (iOS 15's on-device Siri requirement); Core ML could not reach the ANE
   before A12/iOS 12 — the A11's Neural Engine is Face ID's, not third-party-reachable. **Peter's own
   phone is an iPHONE 8** (A11, ceilinged at iOS 16.7). §A3b hands THAT PHONE TO THE TEACHER to
   dictate the recap. On it, "audio never leaves the device" is FALSE.

CONCLUSION: `webkitSpeechRecognition` is **'unverifiable'** — not "on-device", not "cloud", but
UNKNOWABLE FROM HERE, per utterance, with a silent fallback. **A promise whose entire value is that
it is provable cannot rest on it.** So it is classified honestly and NOT REGISTERED by default.

The one thing we can make structurally true today is stronger than any claim about Apple's pipeline:
**INKWAVE NEVER OPENS THE MICROPHONE.** There is no `getUserMedia` in that module and no audio buffer
to keep, delete, or leak. That is why 'no-audio' is the default source.

## <a id="stt-privacy-tiers"></a>The three privacy classes are a CLAIM-LICENCE, not a performance tier

They decide which sentences `copy.ts` is allowed to say.

* **`no-audio`** — Inkwave never touches the microphone. The words arrive as ordinary text input:
  typed, written with the Pencil, or dictated by the user with THEIR OWN keyboard's mic key (in which
  case the OS shows its own indicator and Apple, not Inkwave, discloses its own handling). PROVABLE,
  and by construction: no `getUserMedia` call exists on this path, so there is no recording to keep.
  **The strongest posture available to a PWA today.**
* **`local-model`** — a model whose weights WE ship and run in this page (whisper.cpp via WASM).
  Audio genuinely never leaves the device, and it is provable because there is no network call to
  make. NOT BUILT; the seam exists so the honest ambient path can land without reshaping the module.
  Its real costs are recorded rather than hidden: a 74MB (tiny) / 142MB (base) model download; WASM
  SIMD; pthreads want SharedArrayBuffer, which needs COOP/COEP cross-origin isolation — and **Safari
  does not support `COEP: credentialless`** (MDN BCD), so isolating the app would break the YouTube
  IFrame embed the SAME spec depends on (§A4/§A3b assignments).
* **`unverifiable`** — the browser recognises speech through a pipeline we do not control and CANNOT
  INSPECT. It may be on-device; it may go to the vendor's servers; the page is not told which, and
  the fallback is silent. **A source of this class may NEVER be described as on-device.** If it is
  ever offered, its consent copy must say plainly that the audio may be sent to Apple.

## <a id="stt-probes"></a>The probes: `globalThis`, feature detection, and the registry's structural refusal

`browserSpeechExists` says nothing about where the audio goes. That question has no answer available
to a web page — which is the whole finding.

`speechGlobal()` reads `globalThis`, not `window` — identical in a browser, but it also makes these
probes RUNNABLE: under vitest's node environment `window` is undefined, so a `window`-bound classifier
answers 'absent' to every question and its tests can only ever assert that. **A capability probe whose
own verdict cannot be exercised is the shape of thing this module exists to avoid.**

`browserSpeechCanProveLocal` is `processLocally` + `available()` — the Chrome 139+ extension. **Its
ABSENCE is the reason Safari's recogniser is classified 'unverifiable': not that we know audio leaves,
but that we are structurally unable to require that it doesn't, or to find out.** Probed by
feature-detecting the real API surface, never by sniffing a user agent — a UA string is a claim, and
this module exists because a claim is not a property.

THE REGISTRY RULE is structural rather than conventional: a source is only reachable through
`availableSources()`, which filters on `available()`. **The 'unverifiable' source is NOT LISTED at
all** — so no UI can offer it, and no accident can make it the default, until Peter has read the
finding and made the call. Adding it later means adding it to `SOURCES` AND writing consent copy that
says the audio may be sent to Apple; `copy.test.ts` will not let it ship claiming otherwise.

---

# <a id="lessonsession"></a>`music/lesson/session.ts` — the one guarantee the feature is worth

## <a id="ls-four-structures"></a>ARRANGE THE CODE SO THERE IS NOTHING TO REMEMBER

§A3, the owner decision, verbatim: *"When the recording session ends, the **raw transcript and the
audio are deleted automatically**; the student **cannot save, export, or otherwise keep** the verbatim
transcript. The only thing that persists is the **student's own curated notes**... This is exactly
what removes the teacher's self-consciousness: there is provably no keepable recording of them."*

The brief's instruction was to build that as a STRUCTURAL guarantee — "no code path that can persist
it — not a policy someone could later 'improve' away". So the discipline is not "remember to delete
the transcript". It is: **arrange the code so there is nothing to remember.** Four structures, each
doing a job a rule would do worse:

1. **THE TRANSCRIPT IS A `#private` FIELD**, not a TypeScript `private` one. TS `private` is a
   compile-time fiction — `(session as any).lines` reads it at runtime, and `JSON.stringify` emits it.
   `#lines` is unreachable from outside the class body in the ENGINE, and invisible to stringify. The
   difference is exactly the difference between a policy and a structure.
2. **`toJSON()` IS OVERRIDDEN TO REDACT.** Every serialiser in the app — OPFS writes, cloud sync, a
   `JSON.stringify` in a log line, a future export — goes through `toJSON`. So a session handed to a
   writer BY MISTAKE still cannot spill: the mistake produces a marker, not a transcript. **This is
   the one that survives the developer who does not read the comment.**
3. **THE PERSISTABLE SHAPE HAS NO FIELD FOR IT.** `toRecord()` returns `LessonRecord`, whose type
   names every surviving field and has no transcript member. A transcript cannot be persisted by
   accident because there is nowhere to put it.
4. **`end()` DROPS THE ARRAY AND THE SESSION CANNOT BE RESTARTED.** Not "clears a buffer" — the
   reference is released and every accessor is closed off behind the null. There is no reopen.
   Subscribers are notified with `[]` (so a panel still on screen empties in the same tick) and then
   dropped, because a retained subscriber closure is exactly the kind of thing that keeps a "deleted"
   transcript alive in a heap. Idempotent: ending an ended session is not an error — the
   postcondition is already true, and throwing would only tempt a caller into a `try {} catch {}`
   around the deletion.

`#lines` is typed `| null` and NULLED rather than emptied, so "ended" and "has no lines" are the same
fact in one place — **two flags that can disagree is how a session ends without ending.**

AND THE STRUCTURE UNDER ALL OF THEM: with the default 'no-audio' source, INKWAVE NEVER OPENS THE
MICROPHONE. §A3 promises the audio is deleted; the stronger and simpler truth available to a PWA is
that there was never any audio to delete.

## <a id="ls-not-claimed"></a>What this file does NOT claim

A student can retype anything they can read; no software prevents that, and pretending otherwise would
be the overclaim this codebase keeps having to walk back. What §A3 actually asks for is that the APP
offer no affordance to keep it — no save, no export, no select-all — and that is what is built:
`distil()` is per-line and deliberate, there is no bulk path, and the transcript dies with the
session. **The teacher's comfort rests on there being no recording, which is true, and not on the
student being prevented from taking notes, which is the point of the lesson.**

`TranscriptLine` is not exported as part of any persisted type, appears in no field of
`LessonRecord`, and has no `toJSON`. It is a render-time value with a session lifetime — which is why
the live view is called `liveLines()` and not `transcript`: the name should stop a reader thinking it
is a document. It returns a fresh shallow copy so a caller cannot mutate the session's own array.

## <a id="ls-preconditions"></a>Consent is a PRECONDITION, and the failures are loud

§A3: "Consent first." A session cannot come into existence unconsented — so there is no window in
which a transcript exists without it, and no ordering bug that could open one. **That is a throw
rather than a `granted` flag on a running session for exactly that reason.**

An unregistered speech source is REFUSED rather than defaulted: a session that silently ran on a
different pipeline than it recorded is exactly the fiction this module exists to prevent.

`append()` after `end()` THROWS rather than no-oping: a source still pushing lines into a dead session
is a real bug (a recogniser that outlived its session), and a silent no-op is how it would run for
months unnoticed. **Fail loudly — the house disease is checks that cannot see their own failure.**

`toRecord()` on a running session throws too. A record is what a lesson LEFT; taking one early would
mean the raw transcript still exists at the moment something storable is produced, which is precisely
the window §A3 closes. **That ordering is the guarantee, not a nicety.**

## <a id="ls-distil"></a>`distil` — one line, one deliberate act

§A3: *"the student distils from it in real time — copying the useful lines into their own notes as the
lesson happens"*, and *"Pin feedback to bars... ('bar 24 — watch the dynamics' → a LessonNote anchored
to bar 24). The under-served differentiator."*

**There is no `distilAll`, no range, no select-all — not as a rule but because no such method
exists.** That is the affordance §A3 rules out, ruled out by absence.

`text` lets the student write their OWN words (a paraphrase); omitted, the line seeds the note, which
is the "copying the useful lines" §A3 describes. Either way the note is the student's — their act,
their selection, and what §1 means by "distilled + curated by the student only".

`#keep` is the one place a note is made — and, as this file predicted, the ONE function that changed
when the contract gained its bar variant. The bar now rides INSIDE `LessonNote.anchor`, which is where
§1 ("anchor(optional → bar)") always said it belonged; `PinnedLessonNote` is gone.

## <a id="ls-recap"></a>§A3b's recap — DELIBERATELY AUTHORED, therefore storable

§A3b: *"the student hands over the phone and the teacher dictates a short summary... Unlike the raw
transcript, this is something the teacher is *choosing* to leave — so it's comfortable, consensual,
and *is* storable."*

**THE DISTINCTION THAT IS THE WHOLE FEATURE** runs through `setRecap`: the summary is a string the
teacher composed and can see, edit, and delete before it is kept. **It is authored. The transcript is
captured.** That is why this one has a home in `LessonRecord` and the other has no field anywhere.

Note what does NOT happen: a recap is not assembled FROM the transcript. **There is no "summarise the
session" path — that would launder captured speech into the storable side and erase the very line the
feature sells.** The teacher writes it, or dictates it with their own keyboard's mic key.

An empty recap is refused: if there is nothing to leave, leave nothing. A teacher may attach "for next
week" items before writing the summary, so `addAssignment` creates an empty-summaried recap — and
`toRecord` REFUSES to persist one, which keeps "everything stored was deliberately left" literally
true rather than persisting a half-thing.

§1's `Assignment` is exactly `{ kind, ref, due }` — no id, no anchor, no created_at. **Those are
fields the lane wanted and did NOT add**: adding them there would fork the contract silently. The ask
is in the report; until then an assignment is identified by its position in the recap.

---

# <a id="lessontypes"></a>`music/lesson/types.ts` — the seam, and the fork deleted on rebase

`LessonNote`, `Assignment` and `Anchor` are the §1 CONTRACT and live in `../types`. This file
declared parallel copies of all three while that branch was unlanded; they are GONE. **Two identical
unions written in parallel are not harmless — they drift the first time one side gains a member** (the
ledger/email merge's `DocType` is the worked example, and `music/types.ts` says the same in its own
header: "ADD to it; never redefine a field in place"). So this file imports the contract and declares
ONLY what is genuinely the lesson's own: the consent record, the recap, and the record a finished
lesson leaves.

**THE ANCHOR GAP IS CLOSED (2026-07-17).** This file used to carry a `BarOnlyAnchor` workaround and an
ask: §1's `Anchor` union could not express **"bar 24" alone**, which is ALL a student has mid-lesson.
It refused all three dishonest ways round it — fabricate a `region` rect, misuse `MusicXmlAnchor` on a
photo Piece, re-fork an anchor — and reported instead. It was right on every count. The contract's
owner answered with `BarAnchor`, so `BarOnlyAnchor` is GONE and with it `PinnedLessonNote`: the bar now
rides INSIDE `LessonNote.anchor` where §1 always said it should, and a bar-pinned note round-trips into
`Piece.lesson_notes[].anchor` for real.

NOTE THE FIELD CHANGE: the ask proposed `bar: number`. The contract says `bar_index` (0-based ordinal,
the key) + `bar_label` (what a human says, never a key), because a printed bar number is a STRING by
MusicXML spec and is NOT UNIQUE. A lesson note gets `bar_label`.

`LessonConsent.who` is the student's record of who agreed — **it is NOT a verification, and nothing in
this build can make it one.** Naming it honestly is the point: this is a prompt that makes the student
ask, and a record that they did. Free text, never a signature or an identity.

`LessonRecap`'s existence IS the authored-vs-captured line, drawn in the SCHEMA rather than by a rule
someone could relax later: a recap is a thing a person deliberately made, so it has a `summary` field;
a transcript is a thing that happened TO a person, so it has no field anywhere.

`LessonRecord` is an ALLOW-LIST BY CONSTRUCTION — it names every field that survives a session, so a
field added to the live session later cannot leak into storage by riding along. (`report/compile.ts`
uses the same discipline for the same reason: a deny-list fails the other way, silently.) **There is
NO transcript field and no audio field. Not "empty by default" — ABSENT.** `source_id` is there for
the record's own honesty: a record made with a source we could not verify must not later be read as
though it were made on-device.

---

# <a id="lessoncopy"></a>`music/lesson/copy.ts` — the copy boundary, and who it protects

## <a id="copy-third-party"></a>Why this matters more here than anywhere else in the app

Every other honesty boundary in Inkwave protects the writer from an overclaim about their own work.
**This one protects A THIRD PARTY WHO IS NOT HOLDING THE DEVICE.** A lesson note is someone else's
voice, distilled — a teacher who agreed to something on the strength of a sentence we wrote. §A3's
whole thesis is that "there is provably no keepable recording of them" is what removes their
self-consciousness. **If that sentence is not literally true, the feature is not merely overclaiming;
it has obtained consent that was not informed.**

The spec (§0, §A3, §C1) says the transcription is "on-device (Apple Speech / whisper.cpp small/base;
iPhone-12-capable) — audio processed locally, never uploaded". IN A PWA THAT IS NOT ACHIEVABLE TODAY
(the detail is at `#stt-finding`). SO THIS BUILD DOES NOT TRANSCRIBE THE TEACHER AT ALL, and none of
the copy says it does. What it says instead is TRUE AND STRUCTURAL, and is a stronger sentence than
the spec's: the spec promises the audio is deleted when the lesson ends; **the honest version is that
there was never any audio.** Three things make that true, and none is a promise in a comment:
`Permissions-Policy: microphone=()`, no capture API in the module's source, and nothing mic-capable
REACHABLE from it. `micBoundary.test.ts` asserts all three and fires if any moves.

⚠ THE CLAIM IS SCOPED TO THIS SCREEN, DELIBERATELY. "Inkwave does not record audio" would be an
APP-WIDE claim, and §A5's bar-anchored practice recordings will make it FALSE. "Nothing on this screen
can reach a microphone" is what the teacher actually needs to know, it is what the firebreak actually
guarantees, and it stays true after §A5 ships. **A sentence that will expire is a sentence that will be
forgotten and go on being read.**

## <a id="copy-three-bans"></a>The other three things this copy may not say

1. **NOT "encrypted".** VERIFIED IN THE CODE 2026-07-17, independently of the email lane which hit
   this same wall: `storage/opfs.ts` writes `JSON.stringify(data)` in PLAINTEXT, there is no
   `crypto.subtle.encrypt`/AES-GCM anywhere in src (only `.digest` for hashing), and package.json
   carries no crypto library. §0 and §1 of the music spec BOTH list "encryption at rest" as reused
   from the existing engine. IT IS NOT TRUE — it is design intent, and **a plan is not a property.
   Copy tracks the CODE.**
2. **NOT "unrecoverable" / "securely erased" / "wiped".** `end()` drops a JavaScript reference. That
   makes the transcript unreachable from the app and leaves no copy in any Inkwave store — which is
   exactly what may be said. It is NOT a secure erase of physical memory; the engine's GC decides when
   those bytes are reused, and we do not control the heap. "Deleted forever" would be the same species
   of overclaim as "encrypted", in a place where a teacher is relying on it.
3. **NOT "we cannot read it" / "nobody can hear it".** Zero-knowledge claims this build does not get to
   make (the email lane's rule, for the same reason).

WHAT IS TRUE, and is what the strings say: nothing here is sent anywhere (zero-retention is real —
there is no server to hold it); the live panel is gone when the lesson ends and Inkwave keeps no copy;
only the student's own notes stay with the piece.

**The temptation is always the better-sounding sentence. If a change here starts sounding stronger
than this section, it is wrong.** `copy.test.ts` asserts the forbidden claims are absent — but a test
cannot check a sentence it has never seen, so read the boundary before editing.

## <a id="copy-voice"></a>Two smaller rulings the strings depend on

**THE RECAP COPY IS ADDRESSED TO THE TEACHER**, because at that moment they are holding the device.
That is the whole design of §A3b — "the recap flips the dynamic from 'being recorded' to 'leaving a
note for my student'" — and writing it in the third person would throw it away. The storable note says
so out loud, so the teacher knows which side of the line they are on.

**THE DICTATION HINT DOES NOT OFFER INKWAVE-RUN SPEECH RECOGNITION** and claims nothing about where
the keyboard's dictation sends audio. The teacher's keyboard is the teacher's own tool — their device
shows its own indicator and their OS vendor makes its own disclosure. Inkwave stays out of a claim it
cannot keep.

And the storage claim says the true thing (zero-retention IS real) without the false one. When
app-wide encryption ships, that sentence can grow the word, and not before: **a module-local crypto
scheme over an app-wide gap would be worse than the gap — it would make the sentence true of one file
and imply it of all of them.**

---

# <a id="reflow"></a>`music/reflow.ts` — the annotation-space reflow CV

Spec §A1: *"Detect the whitespace gaps between systems (row-darkness / projection profile — easy CV,
no note recognition), slice the image at those gaps, and insert blank space so the student has room to
write. Keep grand staves (piano treble+bass) together; never split a system."*

⚠️ THE HARD NON-GOAL: **NO OMR. NOTHING HERE RECOGNISES A NOTE.** (§0, repeatedly.) Every signal is
barline/whitespace GEOMETRY: how much ink is in a row, how long a horizontal run is, how long a
vertical run is. There is no glyph classification, no template matching, no pitch, no duration — and
none may be added. If a future change needs to know WHAT a mark is rather than WHERE ink sits, it is
out of scope and belongs in a conversation with Peter, not in this file.

PURE BY DESIGN: the module takes a plain buffer and returns plain data — no DOM, no canvas, no
ImageData. That is what lets the whole detector be tested in node against synthetic fixtures with
KNOWN GROUND TRUTH (`fixtures.ts`), including the ones where it is *supposed* to be hard. The browser
adapter (`capture.ts`) is the only place that touches a canvas.

## <a id="reflow-binarise"></a>Binarisation is LOCAL because a photographed page demands it

Bradley–Roth: compare each pixel to the mean of its own neighbourhood via an integral image. A
photographed page — which is the whole point of §A1 — has a lighting gradient and often a shadow from
the phone itself; a single global threshold turns the dark corner into solid ink and loses the staves
there entirely. Local thresholding is O(n) and immune to that. (The integral image is Float64 because a
4000×3000 page sums to ~3e9, past exact int32.)

## <a id="reflow-longest-run"></a>Longest run, not row darkness, is what finds a staff line

Row darkness alone is not enough: a row crossing a dense chord or a line of lyrics can carry as much
total ink as a stave line, but it carries it in short broken pieces. **A stave line is one long
unbroken run.** Still pure geometry — it does not know or care what the ink depicts. A few pixels of
gap are bridged for print/photo speckle.

## <a id="reflow-deskew"></a>⚠ THE `repair` STEP IS NOT OPTIONAL POLISH — WITHOUT IT DESKEW MAKES THINGS WORSE, SILENTLY

A photographed page is never square to the camera, and skew smears every staff line across many rows
until the peaks that ARE the staves stop being peaks — so deskew is not cosmetic, it is what makes the
rest of the pipeline work at all on real input. The model is a small rotation ≈ a vertical shear, exact
enough below ~8°, which makes the search a cheap profile computation rather than a resample per
candidate angle. The score is the row profile's variance: aligned lines concentrate ink into few rows.

MEASURED (the `skewedPhoto` fixture, 2.4°): **the skew estimate came back EXACT (2.40 vs a truth of
2.4) and detection still found 0 staves**, because a binary shear rounds each column's shift to a whole
row — so a staff line lands on row N for ~24 columns, then N+1 for the next ~24, and no single ROW
carries a long run any more. Longest run collapsed to 0.15 of the width, under any usable threshold.
The 1px vertical dilation stitches the wobble back into one line: **0 staves → 4**, at exactly the
fixture's truth positions.

This is why the repair lives in `deskew` and not in `detectStaves`: the wobble is an artefact of that
function's own quantisation, so that function cleans it up. Detection then sees one kind of image
whether or not the page was skewed — rather than two rules for one pipeline, which is the shape of
CLAUDE.md's round-11 bug. The cost is a staff line thickened by ±1px, which `detectStaves` already
absorbs by merging vertically-adjacent candidate rows at the run-weighted centre.

## <a id="reflow-connector"></a>The connector test is what keeps a grand stave whole

THIS IS THE LOAD-BEARING IDEA, and gap size alone is not a substitute for it.

The obvious heuristic — "a small gap means one system, a big gap means a break" — fails exactly where it
matters. Engravers tighten system spacing to fit a page, and on a cramped piano score the treble→bass
gap and the system→system gap can be nearly the same size. A heuristic that only ranks gaps by size
will then cut a grand stave in half: **it splits the pianist's left hand from the right and inserts
writing space between them.** That is the one outcome §A1 forbids ("never split a system"), and
`reflow.test.ts` has a fixture built to make it happen.

The robust signal is STRUCTURAL and still pure geometry: staves inside one system are JOINED — by
barlines running through the gap, and by the brace/bracket at the left edge. Between systems, nothing
crosses. So: look in the gap for a column carrying a long vertical ink run. That is a barline test —
explicitly the "easy CV" §A1 sanctions — and **it reads the same on a cramped page as on a spacious
one, because it measures the engraver's INTENT rather than their spacing budget.**

NOTE ON THE LEFT MARGIN: a brace/bracket also spans the gap, at the very left edge — and it is a
*curve*, so it drifts across columns rather than filling one. It is a real connector and a real signal,
but a fragile one to measure, so the barlines (dead vertical, and at every bar) do the work and the
left `braceMargin` is excluded to keep the brace from being counted as a half-height smear. If a system
somehow has no interior barline in the band, the gap-size vote is the fallback.

`connectorTest: false` is exposed ONLY so the test suite can run the detector WITHOUT it and prove the
grand-stave fixture then splits — i.e. that the fixture is genuinely hard and the connector test is
what carries it. **A negative that cannot fail is not a negative.** Do not turn it off in the app.

TWO VOTES, and the connector wins when they disagree: (1) CONNECTOR, structural — ink crosses the gap
⇒ same system, right even on cramped spacing; (2) GAP SIZE, statistical — only decides when there is
nothing crossing. The gap-size cut-point is not a magic constant: it splits the observed gaps at the
widest jump between consecutive SORTED gaps (a 1-D 2-means by inspection), and **on a page whose gaps
are all alike there is no meaningful jump, so the vote ABSTAINS rather than inventing a boundary.** A
break with no connector and a small gap is still treated as a break, but quietly (confidence 0.35) —
exactly the case the manual adjust handles exist for.

## <a id="reflow-barline-refusal"></a>⚠⚠ BARLINE DETECTION RUNS ON MULTI-STAVE SYSTEMS ONLY, AND THE REFUSAL IS THE DESIGN

READ BEFORE "FIXING".

**A NOTE STEM IS A LONG VERTICAL LINE INSIDE THE STAVE**, and on a single stave it is not reliably
distinguishable from a barline by geometry alone. A stem on a note sitting on the bottom line reaches
~3.5 stave-spaces up — i.e. to the top line. That is not a fixture artifact; that is what real
engraving does. MEASURED on `cleanThreeSystems` (single staves, with notes):

    real barlines   coverage 1.000        longest-run 1.000
    stems           coverage 0.848–0.939  longest-run 0.879–**1.000**

System 2 hallucinated FOUR extra barlines. Longest-run does not separate them either — a stem bridging
its 1px gaps to the staff lines runs the full height.

So the ONLY separator on a single stave is a coverage cut somewhere in (0.939, 1.000) — **and that
margin exists only because a synthetic barline is geometrically perfect.** A photographed barline
fades, breaks and blurs; a cut at 0.97 would reject real barlines on real paper. Tuning it here would
be calibrating a threshold on data invented by the same author who chose it — precisely the
circularity CLAUDE.md records for `phase.variants` (F1): **a synthetic fixture can prove a rule
INSENSITIVE; it cannot CALIBRATE a cut-point.** So it is not calibrated. It refuses.

A MULTI-STAVE SYSTEM IS DIFFERENT IN KIND, not in degree: its barlines cross the gap BETWEEN the staves
and a stem is trapped inside one of them, so a stem scores ~0.35 against a barline's ~1.0. That is a
structural margin — the same signal `hasVerticalConnector` relies on — and it holds on cramped and
spacious pages alike. Measured exact (5/5) on `crampedGrandStaves`.

The single-stave case is therefore left to the student, which is where §A4 already put it: bar
pre-detection is "OPTIONAL … to make selection easier", and the MVP is that "the student marks barlines
by tapping their positions on the photo (robust on any image)". **Inventing four bars that aren't there
would mis-anchor every heatmap range, lesson note and recording pinned to them — and it would look
exactly like a correct answer.** Refusing is the honest half of the feature.

(Resolving a single stave properly needs to know that a line is attached to a NOTEHEAD. That is note
recognition. It is an explicit, repeated non-goal. Do not add it.)

`singleStave: true` exists ONLY so `reflow.test.ts` can turn it on and watch the detector hallucinate,
which is what proves the refusal is earning its place rather than being timidity.

`detectBarlines` counts TOTAL ink in a column rather than the longest unbroken run: a barline crossing a
grand stave's inter-stave gap is continuous anyway, and tolerating breaks is what survives a
photographed line that fades. Adjacent hits are merged because a barline is 1–3px wide, more when the
photo is soft.

`barsOf` returns NO bars for fewer than two barlines, deliberately: a system whose barlines were not
found has an unknown bar structure, and the honest answer is to say so rather than hand back one bogus
bar spanning the whole system — which would look exactly like a correct answer and quietly mis-anchor
everything pinned to it.

## <a id="reflow-one-space"></a>ONE coordinate space per page, and the reflow is a view transform

`analysePage` returns coordinates in the DESKEWED image's space. **Deskew belongs to CAPTURE**
(`capture.ts` rotates the bitmap once, before storing) so that the stored page image, the anchors and
the reflow all share ONE coordinate space. Two spaces for one page is how the annotations and the music
drift apart — the same class of failure as CLAUDE.md's round-11 "two rules, one pane".

Slices go at the MIDPOINT of each inter-system gap — the whitespace's own centre, so neither system
loses its ledger lines, dynamics or lyrics to the cut.

And the reflow NEVER rewrites the image. It is a pure mapping from source-image coordinates to
laid-out coordinates, so that adjusting a handle re-lays-out instantly and moves NO annotation off its
music (see `types.ts` `RegionAnchor`: anchors are stored in source space precisely so this holds). A y
inside a GAP has no source position and clamps to the gap's cut; `gapAt`/`gapOffsetToLayout` are the
seam that places gap-space annotations.

---

# <a id="sync"></a>`music/sync.ts` — §A4 tap-sync, where the cursor is at time t

Spec §A4: *"Cursor logic: for each tapped beat time, place the vertical cursor at the interpolated
x-position between the surrounding barline anchors, advancing at the tapped tempo and wrapping to the
next system at line-ends. **Bar-level interpolation is smooth enough — no note-level positions (that
would need OMR) are required.**"*

⚠️ NO OMR, and this is the file where the temptation would live: a note-level cursor would need to know
where the notes ARE. §A4 answers it directly. Nothing here looks at the image.

PURE — no DOM, no audio, no clock. The player pushes `t` in; this decides where the cursor goes. That
is what lets every case be tested in node, including the ones a browser makes hard to stage (a rubato
performance, a line end, a bar nobody tapped).

## <a id="sync-two-anchor-sets"></a>Two anchor sets, INDEPENDENT — that is the whole design

* **SPATIAL** (`barline_anchors`) — WHERE bar N sits on the photograph. Tapped once, ever.
* **TEMPORAL** (`beat_map`) — WHEN bar N is played. Tapped once per reference track.

Neither knows about the other. A student can re-tap the tempo for a different recording without
re-tapping the barlines, and re-crop the photo without re-tapping the beat. **Fusing them into one
"sync" table is how one re-tap would destroy the other's work.**

## <a id="sync-line-end"></a>⚠ THE LINE-END WRAP IS STRUCTURAL, NOT A SPECIAL CASE

A bar is formed ONLY from two consecutive anchors **on the same system of the same page**. So a bar can
never span a line end, and the cursor — which only ever interpolates *within* a span — is incapable of
sweeping across one.

The naive alternative is to sort anchors by bar and lerp x between anchor N and anchor N+1. It looks
correct and it is catastrophic: the last bar of a line starts at x≈0.9 and the next starts at x≈0.08 on
the line below, so **the cursor flies BACKWARD across the page during that bar, every line, forever.**
`sync.test.ts` runs that model as a live known-negative and watches it happen.

The last anchor on a system CLOSES its final bar and opens nothing — a system with n anchors has n−1
bars, exactly like `reflow.ts` `barsOf`. Same rule, both paths: fewer than two anchors on a system means
its bar structure is unknown, and the honest answer is no bars rather than one bogus bar spanning the
whole line.

Taps arrive in whatever order the student made them — including out of order, because a student who
missed one goes back for it — so each line is sorted by x. The OPENING anchor names the bar, taken from
the anchor rather than counted, so a student who taps a pickup as bar 0 keeps their own numbering.

## <a id="sync-tempo"></a>Absolute beats, dropped mis-taps, and piecewise-linear tempo

Collapsing (bar, beat) into ONE absolute beat is what lets the tempo be interpolated at all — you
cannot lerp between "bar 3 beat 4" and "bar 4 beat 1" while they are two fields. `beat` is 1-based (a
musician counts "1-2-3-4"), so it is decremented in exactly one place: **a 1-based count and a 0-based
ordinal in the same expression is how an off-by-one gets into a tempo map and produces a cursor that is
confidently one beat wrong all the way through.**

A tap that goes BACKWARD in absolute beat while going forward in time is a mis-tap (the student lost
their place and re-started the count). Keeping it would make the cursor jump backwards mid-piece;
dropping it silently is better than rendering a lie, and the tapper shows the count so the student can
see it happen.

PIECEWISE-LINEAR BETWEEN TAPS, and that is the point of tapping rather than entering a BPM: **a real
performance breathes.** A student practising Chopin taps rubato and the cursor follows it, because each
pair of taps carries its own local tempo. A single global BPM would drift away from the recording within
a few bars — `sync.test.ts` measures exactly that against a rubato fixture.

BEFORE the first tap: null, not zero. We do not know the tempo before the student started counting, and
pinning the cursor to bar 0 would assert the piece had not started when it may well have. AFTER the last
tap: extrapolated at the LAST OBSERVED tempo — the one honest guess available, and FLAGGED so the caller
can render it differently. A single tap gives a position but no tempo, because there is nothing to
measure a rate from.

## <a id="sync-null-is-an-answer"></a>NULL IS A REAL ANSWER AND IS RETURNED OFTEN

`cursorAt` returns null before the first tapped beat, and for any bar whose barlines nobody tapped. The
alternative is to place the cursor SOMEWHERE, which on a half-tapped photo means a confident vertical
line sitting over the wrong music. **Same rule as the barline refusal it depends on: a wrong answer
that looks right is worse than no answer.**

The same asymmetry decides `timeOfBar`, which REFUSES outside the tapped span rather than extrapolating:
**a seek is a COMMAND, and sending the track to a guessed timestamp moves the student's music. The
cursor may extrapolate because it only draws; a seek acts.**

`loopForBars` runs to the START of the bar AFTER the last one — a loop over "bars 4 to 6" must play bar
6, so it ends where bar 7 begins.

`timeOfBar` and `barPositionAt` are derived from the SAME beat map, so a seek lands exactly where the
cursor says the bar is: **a second, independent rule is how "jump to bar 24" and "the cursor at bar 24"
end up disagreeing by a beat.**

## <a id="sync-payoff"></a>Why §A4 is load-bearing rather than a playback feature

`barRegionsFromAnchors` turns tapped barlines into the `BarRegion[]` a page carries, so the HEATMAP can
colour them. `reflow.ts` refuses to pre-detect barlines on a single stave, so a violin or vocal Piece
has NO bars — and the heatmap (§A2) has nothing to select, the lesson note's `bar_index` has nothing to
resolve against. **The tap is the only thing that fills that in, and it fills it in for every feature at
once, because they all join on `bar_index`.**

`bar_label` is NOT set: the student tapped a POSITION, not a number. If they want to say "this is bar 8a"
that is a separate act. Same rule as the CV's — it knows where, not what is printed. A tap on a system
the page does not have is DROPPED, never guessed.

`nextBarIndex` is derived rather than stored as a counter, because a counter drifts the moment a student
deletes a mis-tap: the count would keep climbing while the anchors below it renumber.

---

# <a id="leader"></a>`music/leader.ts` — smart leader-line routing (§A2)

The problem in one line: reflow gives the student room to write, but the room is not next to the thing
they are writing about. The note sits in a gap; the bar it is about is inside a system. A straight line
between them cuts through the music. So the connector has to LEAVE the note sideways, travel through
whitespace, and ARRIVE at the target from the side that has clearance.

PURE — no DOM. Coordinates are LAYOUT space, because a leader is a thing you SEE and what it must avoid
is where the systems are ON SCREEN. Its endpoints are stored as anchors in source/gap space and resolved
to layout space by the caller each render, so a reflow adjustment re-routes rather than strands the line.

`aspect` exists because Bézier control offsets are computed in x and y independently: without it a curve
on a tall page looks limp and on a wide one looks like a hairpin — the same offset is a different
DISTANCE on each axis.

## <a id="leader-midline"></a>⚠ THE §A2 MIDLINE RULE IS IMPLEMENTED LITERALLY, AND THE SPEC IS AMBIGUOUS

Flagged for Peter rather than guessed at. Read one way, "above-midline → belongs to the stave below" is
the engraving convention that a marking is written ABOVE the stave it belongs to. Read the other way it
is the opposite of what a pianist expects, since dynamics between the staves of a grand stave usually
belong to whichever hand is nearer. **The two readings disagree for exactly the marks that sit near the
midline — the ones that need the rule.**

So: the function returns the spec's literal rule as a DEFAULT, `LeaderContent.side` overrides it, and the
override is what the UI writes the moment the student drags the line. **A default that is wrong half the
time is survivable; a rule with no override would not be.**

## <a id="leader-crossings"></a>The target's own band is NOT an obstacle

Crossings count BANDS ENTERED, not points inside — a long curve lying along a system would otherwise
score far worse than a short one stabbing straight through it, and the short stab is the worse route.

⚠ AND THE TARGET'S OWN BAND IS EXCLUDED, which getting wrong made every route look bad. A leader points
at a BAR, and a bar is inside a system — so any route that does its job ends up inside a system, and a
metric that counts that scored the correct route as a violation (measured: a clean route reported 1
crossing, and the "smart vs naive" comparison tied at 2-vs-2 because both were being charged for
arriving). **Excluding only the final POINT is not enough either: the curve enters the band a good third
of its length before the end.** So the band CONTAINING the target is dropped wholesale — arriving is the
point; crossing something else is the fault.

## <a id="leader-scoring"></a>Two exits, and why legibility outranks length

THE SHAPE: leave the note HORIZONTALLY (so the line reads as coming out of the label, not stabbing it)
and arrive at the target VERTICALLY (so it points AT the stave, the way a hand-drawn arrow to a bar
does). One cubic Bézier with the control points pulled along those two axes. The stand-off scales with
the vertical distance so a near target gets a gentle hook and a far one a long sweep — a fixed offset
overshoots on short runs.

THE "SMART" PART: both approach sides are built and SCORED. Not a fixed rule, because which side is
clear depends on where the reflow put the gaps, and that changes every time the student drags a handle.

The VERTICAL exit is the escape hatch for when something sits directly beside the label: with only a
sideways exit, a note pinned next to another note has nowhere to go but through it (measured — the
known-negative in `leader.test.ts` crossed on BOTH approach sides until this existed).

The sort order and its reasons: (1) CROSSINGS — a route through the music is wrong at any length;
(2) EXIT STYLE — at equal crossings the sideways exit wins, and **this is a LEGIBILITY rule, not an
optimisation**: a vertical exit reads as a stem hanging off the note, and it exists ONLY to dodge, so it
must not win merely by being shorter — which it otherwise does whenever the target sits directly below
the label, i.e. the commonest case of all; (3) LENGTH — the tie-break within one style.

`naiveRoute` is kept as the KNOWN-NEGATIVE's engine, not as a fallback: `leader.test.ts` asserts it
crosses music that `routeLeader` avoids. **Without a comparator, "the router picks a good route" is
unfalsifiable — every route it returns would look like the right one.**

---

# <a id="piecestore"></a>`music/store.ts` — a Piece persists THROUGH the document, not beside it

§1: *"The whole thing … is bundled in a single `.studio` file (the Inkwave document container), stored
in the user's own storage."*

THIS FILE USED TO BREAK THAT. It wrote `music/<pieceId>/piece.json` — a SECOND document container beside
`documents/<id>/current.json`. §1 says not to have one, and the cost was concrete: **a Piece got no edit
history, no provenance hashing, no session capture and no cloud sync, because those happen to
DOCUMENTS.** Now `savePiece`/`loadPiece` are thin wrappers over the real document store,
`piece.id === doc.id`, and the only thing left in the old location is data to migrate OUT of it.

WHAT `listPieceIds` BECAME: nothing. It is DELETED, and **the deletion is the point rather than a
tidy-up.** It existed to answer "which piece am I looking at?" by listing a private store and taking
`[0]` — a question a Piece-as-document does not have, because the answer is "the document you have
open". Keeping it would have meant walking and parsing every document on disk to filter by docType,
which is precisely the whole-file-scan-on-load class CLAUDE.md forbids.

The asset path is UNCHANGED by the migration, deliberately: `piece.id === doc.id`, so
`music/<id>/assets/<ref>` names the same bytes it always did. A Piece written before the change keeps its
pages without a single byte moving — only the JSON that describes them relocates.

## <a id="store-read-before-write"></a>⚠ The DocRead rule, broken here in eleven characters

`savePiece`'s first version read `loadDocument(id) ?? newPieceDocument()`, so a read that ERRORED (a
private window, a quota fault, a transient OPFS failure) collapsed to `absent`, minted a FRESH EMPTY
document, and **blind-overwrote the student's real Piece with it.** That is the incident `DocRead` exists
to prevent, reproduced in eleven characters — written without noticing, **which is the whole argument
for the union: the compiler is what caught it, not care.**

It THROWS on a failed read AND on a failed write. A silent save failure is data loss; the editor's
autosave follows the same rule, because a student who keeps annotating a piece that stopped persisting
loses the lesson.

`loadPiece` mirrors it: `null` means the document is genuinely not there, and a failed READ THROWS.
**Absence and ignorance are different answers** — if a read error read as "no piece", the studio would
open an empty Piece over the top of a real one and the student would annotate into the replacement.

`piece.id` is authoritative when writing, because a freshly minted document carries its own uuid, which
would orphan every asset already written under `piece.id`.

THE TITLE IS `withPieceTitle`'S JOB. It used to be done inline (`title: piece.title || doc.title`) while
`withPieceTitle` — which documents itself as "the one function that keeps them so" — sat with zero
callers and DIFFERENT semantics for a blank title. **Two rules for one question, the live one
undocumented.** Same for `isPieceDocument`, which `loadPiece` used to inline a copy of: that is how a
predicate documented as "the ONE definition" ends up with no callers.

## <a id="store-migration"></a>The legacy migration: idempotent, one-way, and the document wins a tie

It reads `music/<id>/piece.json`, writes the Piece onto the document, then DELETES the old file — so a
second run finds nothing and does nothing. **The delete is what makes it a migration rather than a fork
with two writers**: leaving the old file would mean two copies of one Piece, and the next bug is "my
annotation came back after I deleted it".

THE DOCUMENT WINS A TIE, deliberately. If a document already has a Piece, the legacy file is stale by
construction — it can only have been written by a build that predates this one, while the document's copy
is what every write since has gone to. **Overwriting live data with an older snapshot is the 2026-07-05
truncation incident's shape**, and this is the cheap way not to repeat it. A read error leaves the legacy
file alone.

`legacyPieceIds` walks the old directory for ONE reason: to empty it. It is not a piece index and must
not become one.

## <a id="store-assets"></a>Assets stay out of the JSON — and this store is TO BE TAKEN FROM THE MEDIA LANE

Page images are referenced by `AssetRef`, the same treatment PDFs get. Inlining base64 would put a decode
of every page on the open path, which is the exact class of bug that cost this app ~10s per load.

⚠ TO BE TAKEN FROM THE MEDIA LANE, NOT KEPT. Its ruling and this lane's agree — "a photo LIVES IN a
document, it does not BECOME one" — so `importMedia`/`mediaStore` owns getting bytes in, and "turn this
photo into a piece" READS an asset it already put there. These primitives stand in until that lane lands;
**when it does, DELETE them and take its store — two importers is the fork this whole file exists to
atone for.**

`assetUrl`'s caller MUST revoke. An object URL pins its blob for the document's lifetime, and a Piece is a
stack of multi-megabyte page images — leaking these is how a review session that flips through pages ends
up holding every page it ever showed.

