<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Productivity + email (`src/productivity/`, `src/email/` — LIVE except email send)

Session capture → a per-month attested ledger → rollups → charts and an AI report the WRITER runs in
their own AI and pastes back. Surface is the toolbar's clock drop-up (`ClockMenu.tsx`); `/ledger` and
`/productivity` the routes are GONE. Spec:
`docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md` — **cite the version.** Build log:
`docs/archive/productivity-email-build.md` — read before changing the heuristic, fixtures or tone.

- **`productivity/types.ts` is a CONTRACT** (`SessionRow`, snake_case because it is a CSV/wire shape —
  don't "tidy" it). `DocType` is declared ONCE in `types/document.ts`.
- **An email is an ORDINARY document** (`docType: 'email'` + an `email` header block; the BODY is
  `contentJson`). The email layer sets `docType` and nothing else; the ledger owns resolution.
- **Email presentation is local view state, never document state.** Focus/Studio moves the SAME
  `EditorContent` between surfaces and must not recreate the EditorView to change chrome
  (`setPaginationGappedMode` changes gaps in place; the stable fit-box wrapper preserves the subtree).
  It lives only under `inkwave:applicationSurface:email:mode:<docId>` — absent from snapshots, bundles
  and hashes.
- **Duplicate-as-new is a new identity, never copied evidence** (`email/duplicateEmail.ts`): copy
  headers/body only after the source flushes; inherit no receipts, verdict state or green anchors. A
  future workspace reuses this constructor rather than growing a second cloning path.
- **Email save status distinguishes persistence from provider sync** — `Saved locally …` only after
  the local ack; `Last synced …` is reserved for a Gmail Draft revision Google acknowledged.
- **Email owns no snapshot mechanism or snapshot state** — every path uses TiptapEditor's one
  `createManualSnapshot` queue.
- **TYPING COST IS THE DESIGN.** Capture rides the existing `onTransaction` stream and reuses
  `countSteps`; every O(doc) number is computed at session CLOSE (the word count at the previous close
  IS the next session's `words_start`). Idle is one 30s interval, never a per-input timer.
- **The tick NEVER renders React.** `pomodoroStore` has two channels: state (rare) and the per-second
  tick (IMPERATIVE ONLY — `TimeFace`/`TimeRing` write `textContent`/`strokeDashoffset`). The countdown
  overlay is PORTALLED to `document.body` with `contain: layout style paint`.
- **Measured, estimated and judged are THREE provenances; a series' style is a function of
  `series.provenance`** — no style prop anywhere, so no caller can paint AI output as a measured bar.
  Post-hoc ("remembered") minutes get SEPARATE COLUMNS at all three split sites.
- **`entered: 'timer' | 'post-hoc'` is explicit on every row — never absence-means-timer.** Read it
  only through `isPostHoc()`. Show "about 45m", never start–end times.
- **A guard on one implementation of a rule says nothing about the other** — `daySummary` in
  `ClockMenu.tsx` WAS a second implementation of "sum the day's minutes" and reported remembered
  minutes as focused minutes with the suite green. Consolidated (queue item 2): `aggregate.ts
  dayTotals` is THE day sum — unrounded, no day filter — and `dayAggregate` (round1, the wire) and
  `daySummary` (Math.round, the screen) both read it. MEASURED: a merge planted in `dayTotals` fails
  5 aggregate guards (the 4 that existed + 1 on `dayTotals` itself) AND 13 of the drop-up's 31
  verbatim-sentence tests; the same plant in `dayAggregate` on master failed 4 and 0. A new
  summariser must call `dayTotals`, never sum for itself.
- **Measured numbers never round-trip** — `judged.ts` REFUSES a judged table carrying any measured
  column; `claims.ts` flags narrative numerals absent from the payload.
- **You cannot judge writing from minutes and word counts** — `insight`/`quality` are asked for ONLY
  when text was sent; `contentIncluded` defaults FALSE.
- **The payload is an ALLOW-LIST** (`report/compile.ts` NAMES every field that leaves). **Never
  reintroduce a deny-list** — it fails the opposite way, silently. Name new columns in compile.ts and
  keep `/privacy` naming the guard that is REAL.
- **`place` is a word the writer TYPES. There is no geolocation anywhere.** Never write copy implying
  otherwise.
- **`sessions: []` at weekly/monthly**; opted-in notes travel as `note_digest` per local day. One
  representation of measurement, always.
- **The deep-vs-shallow heuristic is RATIO ONLY — no duration** (duration scored worse than chance);
  `unclear` is a first-class share. **A synthetic fixture can prove a rule INSENSITIVE; it cannot
  CALIBRATE a cut-point** — and check the classes overlap in the proxy the rule actually READS.
- **A defensive clamp on a quantity with a provable range is not safety — it is a silencer.**
  `pearson()` snaps only floating-point hair and REFUSES anything grossly out of range.
- **§A5 tone: honest first, funny second, kind third.** Do NOT restore the "kind, non-shaming" rule —
  a test asserts it is gone. **Productivity guilt is a standard IMPOSED on the writer; accountability
  is a goal the writer SET** — the ban is on the SUBJECT and the STANDARD, not on vocabulary. Goals
  travel only on their own consent tick; never default a goal to empty (empty and absent differ).
- **A hedge does not launder an invented standard.** Daily may GUESS at causality if the guess
  announces itself ("the break maybe helped"), never assert it, and never suggest a standard the
  writer did not set. The hedge must govern the CLAUSE it exempts.
- **Time is ISO-8601 WITH the local offset — never a bare `Z`.**
- **The ledger is its OWN file beside the `.studio`** and takes READ-MERGE-WRITE on EVERY write — do
  NOT copy the snapshot archive's once-per-session merge gate. `RemoteRead` has NO `null` member:
  'absent' (safe to write) and 'error' (never write) are different words and the type enforces it.
- **⚠ THERE IS NO AT-REST ENCRYPTION.** Spec §C2 says there is; the code writes plaintext JSON.
  **Copy tracks the CODE.**
- **§C1.4 copy guard is PRODUCT-WIDE** (`src/copy/claimMatchers.ts`, swept by `claims.test.ts`).
  Matchers must be proved to FIRE on known-bad copy AND stay silent on an honest control before their
  verdict is read.
- **A guard that reads PROSE as CODE attacks its own documentation.** Comments are STRIPPED before
  every source scan here, deliberately: a rule must NAME what it forbids in order to forbid it.
  **Judge what the code DOES** — an import, a call, a header actually sent — and prove the pair: fires
  on a real use, silent on a mention.

