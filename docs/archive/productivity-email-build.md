# Productivity + email layers — build log (2026-07-17 → 2026-07-19)

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "Productivity + email"; that entry
points here. Spec: `docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md` (cite the version —
a spec edit silently re-points an unversioned § reference).

Five lanes built in parallel and merged: the ledger (P1a-core), the graphs (P1a-viz), the AI report
(P1c), the email layer (P1b), and their integration. All live except email send.

Four things here are worth reading before changing anything in `src/productivity/`:

1. **The deep-vs-shallow heuristic deviates from the spec's own example, and the measurement is
   why** — the spec's `ratio + duration` rule would have told a writer they spent the month drafting
   when they spent half of it editing. The scoring table is in this file.
2. **The F1/F2 audit findings** — a fixture whose classes were disjoint in the proxy the rule reads,
   so `expect(wrong).toBe(0)` was a property of the data; and a defensive `clamp()` that laundered a
   broken Pearson formula past 1054 tests. Both are worked examples of a green suite proving nothing.
3. **§A5 was REVERSED on 2026-07-17** — the tone is honest first, funny second, kind third. Do not
   restore the "kind, non-shaming" rule from the earlier draft; a test asserts it is gone.
4. **The silent break the integration found** — one lane read notes off `agg.sessions` at every
   window while the ledger had decided `sessions: []` at weekly+. Both suites were green, because
   the demo fixtures still carried the pre-decision shape.

---

## Email application surface — W1 (2026-09-04, `feat/gmail-send`)

Part D's first build slice is live. New email documents now replace the parchment with one A4/Letter-
sized application box containing the frozen-or-editable headers, actions/status, the real Tiptap body,
and provenance/send disclosure. Snapshot email bodies use the same frame, so an historical message is
one recorded-email object rather than a header card followed by apparently unrelated prose.

The reusable seam is `ApplicationSurface` plus `Scroll`'s `presentation` mode. Email is only the first
consumer: contextual mode and later music/application tools can reuse the frame without cloning the
editor. There remains exactly one `EditorContent`, autosave path, SCAS layer, and schema. Application
mode changes presentation only: the canonical pagination extension stays in the shared extension list
but emits zero-size break markers rather than visible page gaps; snapshot pagination follows the same
rule so navigation geometry remains available.

The browser probe measured one editable body inside the message slot, no `inkwave-gapped` class, zero
paper top padding, and equal 794px surface/paper widths plus equal 1123px heights. The full gate passed:
237 test files, 3,055 tests passed (2 skipped), typecheck, and production build. W2 contextual studio,
multi-message batches, subdoc sequencing, overview, containers, and sync fan-out remain spec only.

Peter's first W1 visual pass found the message inset still inherited his document-page margin and the
body flex/min-height left most of the page looking like an empty input. Application surfaces now own a
fixed compact inset instead of reading `--iw-page-side-margin`; the body has a modest content-sized
typing floor and the disclosure follows it. A browser check with a deliberately exaggerated 196px
document margin measured the message at 25px from the application edge, proving the settings are no
longer coupled.

---

## Productivity AI report — the free paste-back path (P1c, 2026-07-17, `?prodReport` DEFAULT ON since 2026-07-18)

`src/productivity/report/` — spec §A7.1 Path 1: Inkwave compiles a payload, the WRITER runs it in
their own AI and pastes the reply back, Inkwave parses + merges + graphs client-side. Inkwave sends
nothing; no account, no key, never paywalled (§C6). Path 2 (backend) and Path 3 (BYO-key) NOT built.

**GRADUATED (2026-07-18, `77b8564`)** — Peter: *"take all the flags off for music and everything"*
(see "STOP FLAGGING EVERYTHING" below). `prodReportEnabled` (`flag.ts`) reader flipped to `!== '0'`
(on unless explicitly off); `?prodReport=off` writes a sticky `'0'`. The heavy modal stays a dynamic
import; its demo-fixtures import is now gated on demo MODE, not the flag, so a real writer's session
never fetches the fixtures chunk.

- **⚠️ §A5 WAS REVERSED 2026-07-17 — the tone is "honest first, funny second, kind third".** Peter:
  *"it's too nice and not enough humour… read like a comedian wrote it"* / *"It doesn't need to be
  kind. It needs to be honest."* Do NOT restore the kind/non-shaming rule from an earlier draft; a
  test asserts it is GONE. **What makes the reversal safe is §A5's surviving distinction, and it is
  the whole thing: PRODUCTIVITY GUILT IS A STANDARD IMPOSED ON THE WRITER; ACCOUNTABILITY IS A GOAL
  THE WRITER SET (§A5b).** "You only managed 200 words, poor effort" is imposed and banned. "You
  said Friday and you've opened it twice" is his own words quoted back, and is the point.
- **§A5b GOALS ARE THE PRECONDITION, NOT A FOLLOW-UP.** `DocGoals` on `InkwaveDocument`
  (types/document.ts — a document property, declared once, the `DocType` precedent). No goal ⇒ the
  prompt says NO GOALS WERE SHARED / DESCRIBE, DO NOT PUSH. **Structural, not asked:** goals travel
  only on their own tick, so a model sent none has nothing to hold him to. ⚠ **NOTHING AUTHORS
  GOALS YET** — no editor UI (Peter's design call, raised). Every doc is `undefined` today, which
  takes the honest branch. Never default it to an empty goal: empty and absent are different states.
- **THE GUILT LIST WAS RE-DERIVED, NOT DELETED.** The old prompt banned words ("only", "just",
  "failed to"…) — most are now exactly right when quoting a missed goal. The rule is about the
  SUBJECT and the STANDARD, not vocabulary: `claims.ts findPersonVerdicts` flags only what can never
  be said about a Tuesday (lazy/pathetic/…, plus ranking + comparison to other people); "wasted" is
  deliberately NOT on it ("you wasted three sessions circling the intro" is about the sessions).
  Quoted spans are skipped — the narrative may quote his own diary note back.
- **THE RULE (§A6.4): measured numbers never round-trip.** Out yes (the model can't narrate what it
  can't see), back never. `judged.ts` REFUSES a judged table carrying any measured column;
  `claims.ts` flags narrative numerals absent from the payload. PROBED: empty MEASURED_COLUMNS and a
  measured table is STILL refused (exact-header rule) — two guards; the list supplies the diagnosis.
- **§A6.1 — "which sessions produced your best content" REQUIRES content.** You cannot judge writing
  from minutes and word counts; that is vibes-as-numbers wearing a judged label. So `insight`/
  `quality` (CONTENT_ONLY_COLUMNS) are asked for ONLY when text was sent and **REFUSED** otherwise,
  with a message saying to tick a document. `contentIncluded` defaults FALSE so a caller that forgets
  it refuses a guess rather than accepts one. Weekly+ has no quality column at all — the ledger sends
  `sessions: []` there, so nothing grounds a per-day verdict.
- **THE LEDGER+DOC COMBO (`report/excerpts.ts`)** — Peter's "structured ledger+doc combo data". Each
  session paired with the prose it produced, **from the snapshot record, exactly**: baseline = last
  snapshot ≤ session start, final = last ≤ end, diff the adds. DAILY only (the `sessions: []`
  contract makes per-session pairing structurally impossible at weekly+, and §A7.3 agrees content
  belongs on daily). §A7.3 gates every word — ticked docs only. **THE `diffWords` ARTIFACT BIT HERE
  TOO:** it tokenises [word][trailing-whitespace], so appending re-emits the OLD last token as
  del+add and a naive `filter(type==='add')` credits the session with the sentence before it
  (measured — the first cut did exactly that). `capture.ts wordDiffStats` hit the same thing but
  CANNOT be reused: it normalises for COUNTING (strips punctuation/paragraphs). Same insight, other
  purpose. Honest limits, all surfaced in the payload: snapshots are event-triggered so a real
  session may have none (says so — a gap in the RECORD, not the writer doing nothing); pairing is by
  the writer's LOCAL CLOCK (ordering only, never authority — not a provenance claim); a wide baseline
  is labelled. The demo carries `s-4` deliberately to SHOW the gap state.
- **§A6.2 — THE HEDGE IS THE LINE (Peter relaxed this TWICE, both 2026-07-17 — read them together
  or the rule reads as toothless).** (1) *"I want correlations on daily too. Just more brief"* ⇒
  daily DESCRIBES co-occurrence. (2) *"I sort of want them to hazard guesses at causality too. They
  don't have to commit… 'the break maybe helped' or 'you could've taken more breaks'"* ⇒ daily may
  GUESS. **He moved the line; he did not delete it:** `"the break helped."` = an assertion one day
  cannot support → still flagged. `"the break maybe helped."` = a hypothesis announced as one → IN,
  and wanted. A guess that announces itself is honest; a guess dressed as a finding is not.
  `findCausalClaims` SKIPS hedged CLAUSES (`isHedged`) and fires only on the unhedged assertion.
  **This sits INSIDE §A6.2, not against it** — the spec line, in full (BuildSpec-v0.2 §A6.2 L139,
  re-verified verbatim; the spec is NOT in this repo): *"Confident pattern claims (breaks help/hurt,
  best time of day) are permitted only at weekly+ **where there's enough data**."* Hedging removes
  the confidence; we read a ban on the SUBJECT where it bans the CERTAINTY. Suggestions must be
  TETHERED to the window's own evidence: *"you should take a break every 25 minutes"* is a standard
  he never set — **a hedge does not launder an invented standard**.
- **F18 — THE HEDGE MUST GOVERN THE CLAIM IT EXEMPTS (2026-07-17, auditor).** The scan was a
  substring match over the whole SENTENCE, but the argument is about a claim's MODALITY, and
  modality belongs to a CLAUSE. A hedge in a different clause exempted a confident claim beside it:
  *"Your peak hours are nine to eleven, which suggests protecting them"* went quiet, and so did
  *"You always write best in the morning, as you have since **May**"* — `/\bmay\b/i` matched the
  MONTH. Fixed twice over, independently: clause splitting (**punctuation ONLY** — splitting on
  connectives would destroy the markers, since "which is why" and "because" ARE markers; proved by
  mutation) and a **case-sensitive** `/\bmay\b/`. **The deeper lesson is about the documented
  limit:** the old note pinned *"the break definitely helped, maybe"* — a sentence nobody writes —
  and read as though that were the boundary, while the realistic misses went unpinned. A documented
  limit should be the one people actually hit. Now pinned, in the order you meet them: (1) no marker,
  no flag (*"your best writing came after the walk"* — the commonest miss, and no marker list fixes
  it); (2) a hedge inside the claim's OWN clause exempts it (needs a parser, not a regex); (3) a
  run-on with no punctuation is one clause. **Tests carry a pair-VALIDITY check**: strip the hedge
  from each hedged half and it must fire, or the pair is blind and proves nothing — one such blind
  pair ("might have DRIVEN" vs "DROVE": differed by verb, not hedge) was live until it was written.
- **FIVE consent tiers** (metadata always · diary notes · **place labels, SEPARATE** · goals+plan ·
  per-document content). Peter split notes from places: one tier by provenance, two very different
  disclosures. Each absence is STATED in the prompt — a model told only what it HAS will fill the
  gap, and "you didn't record where you worked" is a claim we'd be inventing. **`place` is a word the
  writer TYPES — no geolocation. Never write copy implying otherwise (§C1.4).**
- **The payload is an ALLOW-LIST** (compile.ts names every field that leaves) so a field the ledger
  gains later cannot ride out. A deny-list fails the other way, silently. Tested.
- **TWO PROVIDERS, free on Path 1** (he runs it himself). No Claude-isms: the parser is tested
  against tagged/untagged/uppercase/tilde/4-backtick fences, prose wrappers, pipe tables, and BARE
  unfenced CSV (`allowUnfenced` — what a copy-code button yields, used only by the dedicated table
  box). Path 2 multi-provider is a real cost — NOT built.
- **The panel type ramp has ONE root** (`PANEL_ROOT_PX = 18`, everything an `em` of it) — Peter:
  "every font proportionally up", scrolling acceptable. Inputs land ≥16px (the iOS auto-zoom floor).
- `/privacy` has a "Your work report" section naming the tiers — keep it in sync with the code.
- ~142 report tests. Every guard mutation-proved to FIRE. `scripts/prodreport.prove.mjs` drives the
  REAL built app 51/51 (own port 4933). **THREE INSTRUMENT TRAPS caught there, all the house
  speciality:** (1) it served a STALE `build/` and reported a real feature missing — rebuild before
  reading a verdict; (2) every section heading appears TWICE (the prompt explains it, the data
  carries it), so `payload.includes('WHAT EACH SESSION PRODUCED')` is true whenever the PROMPT
  mentions it — four excerpt checks passed with the feature SUPPRESSED until they were scoped to the
  data section, proved by suppressing it; (3) the excerpt prose also appears in DOCUMENT TEXT, so an
  unscoped prose check cannot discriminate either.

## Productivity layer — P1a-viz: aggregates + graphs (2026-07-17, `feat/prod-graphs`)

The read half of the productivity layer (build-spec §A3.3/§A8 — the spec is COMMITTED at
`docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md`; Peter approved 2026-07-17). `src/productivity/`: ~~`ledger.ts` (the §A3.2 row CONTRACT)~~ — **that mirror is RETIRED; the schema
is `types.ts` and `ledger.ts` is now the real attested per-month ledger (see the integration section
below)**, `aggregate.ts` (pure day/week/month rollups, now sharing one module with the ledger's
window builder), `phase.ts` (the deep-vs-shallow rule), `judged.ts` (the
AI seam + the honesty gate), `summary.ts` (the copy), `charts/` (hand-rolled SVG — NO chart
dependency; follows `src/verify/ActivityGraph.tsx`), `ProductivityPanel.tsx`, `fixtures.ts`.
~~Route `/productivity`~~ **RETIRED 2026-07-18 (`92425e0`) — panel-ified.** The charts moved from a
route to a portalled night-mode panel opened from the clock drop-up (see the restructured clock UI
below); the route is gone and a catch-all redirects stale bookmarks to the editor. Flag
`inkwave:prodGraphs` (`?prodGraphs=1` / `=demo` / `=off`, sticky, the `?auth` pattern) **graduated
DEFAULT OFF → DEFAULT ON in the same commit** — its only caller had been the now-retired route, and
once it was a panel the "no routes, all panels" ethos applied and it shipped live too. The heavy
chart code stays a lazy import off the editor's own load path either way (`Report-*.js`, 21kB/7kB
gzip). Nothing reads the `.studio` or walks the doc; aggregation is pure and runs on mount.

**THE HEURISTIC DEVIATES FROM THE SPEC'S EXAMPLE, AND THE MEASUREMENT IS WHY.** §A3.3 offers "high
add-to-delete ratio + long sessions → drafting; high delete + short → editing" as an `e.g.`. Scored
against labelled synthetic writing (`phase.variants.test.ts`, 64 sessions, 48.4% drafting truth):

    rule                        precision   coverage   called-drafting
    ratio + duration (spec e.g.)   100.0%      34.4%      81.8%   ← skews the mix badly
    ratio only            SHIPPED  100.0%      78.1%      50.0%   ← mix ≈ the 48.4% truth
    duration only                   47.2%      82.8%      79.2%   ← worse than chance, 28 wrong

Session LENGTH does not track what the writer is doing (long revising sessions and short drafting
bursts are both ordinary). Conjoined it never causes a WRONG call, but it suppresses coverage to 34%
and skews survivors to 82% drafting against a 48% truth — i.e. the spec's rule would tell a writer
they spent the month drafting when they spent half of it editing. So the ratio ships ALONE; the
duration thresholds remain only as the scored alternative. ⚠ Peter to confirm the deviation.
`unclear` is a first-class share, not a rendering failure: forcing a call is exactly where precision
breaks (93.8%, 4 wrong). Residual, honest: it declines ~25% of HARD drafting sessions (they cut most
of what they lay down — indistinguishable from editing to a word counter) and ~half of `revising`.

**THE EVIDENCE ABOVE WAS ONCE A TAUTOLOGY — the F1 audit finding, and the fix (2026-07-17).** An
external mutation audit found `phase.variants.test.ts` could not feel a wrong threshold: mutating
`draftAddRatio` 0.70 → 0.65/0.75/0.78 and `editAddRatio` 0.50 → 0.79 ALL SURVIVED GREEN. The
assertions weren't the problem — THE FIXTURE was: its `deleteRatio` bands were DISJOINT across the
truth classes (measured: editing topped at addRatio 0.624, drafting started at 0.803, **zero of 64
sessions between them**), so the 0.70 cut sat in a void and every value in [0.625, 0.800] scored
numerically identically. `expect(wrong).toBe(0)` was a property of the data, not of the rule. The
fixture's own header had named the standard it was breaking ("the classes OVERLAP… if they didn't,
this file would be a fiction that always reports success") — they overlapped in DURATION, the proxy
the rule does NOT use. **THE SHAPE: check the overlap in the proxy the rule actually reads, not in
the one that happens to be there.** Fixed by widening the bands to what real writing does (a hard
drafting hour cuts most of what it lays down ⇒ addRatio ~0.58; restructuring writes new connective
prose ⇒ ~0.69) — the classes now overlap [0.577, 0.689] with ~14% of sessions contested.
`phase.thresholds.test.ts` PINS that property (drafting's floor must stay below editing's ceiling,
both classes must be present in the band) and proves all four audit mutants now FAIL (4/3/1/2).
**RE-DERIVED, THE CONCLUSION HELD AND SHARPENED:** ratio-only keeps 100% precision across 7 seeds
(448 sessions, 0 wrong) and its mix lands 47.9% vs a 47.6% truth — the closest of every candidate.
The audit's own sharper claim (that `editAddRatio: 0.65` beats 0.50 on all three criteria) was
ITSELF an artifact of the void: on the corrected fixture it costs 35 wrong calls (90.5% precision).
The thresholds did not move. **A synthetic fixture can prove a rule INSENSITIVE; it cannot CALIBRATE
a cut-point** (tuning thresholds on data invented by the same author who chose them is circular the
other way) — real calibration needs real ledger rows. `phase.sweep.probe.test.ts` prints the
distribution, the overlap band and the full sweep; read it before touching a threshold.

**Three provenances, not two.** §A6.1 names measured + judged; the heuristic is neither (a rule
anyone can re-run — not AI; still an inference — not a measurement), so it gets its own tag/legend
`estimated`. STRUCTURAL, not conventional: a series' style is a function of `series.provenance`
(`charts/series.ts`) with no style prop anywhere, so no caller can paint AI output as a measured bar.
Judged = hatched amber, reusing `--iw-badge-ai` (the amber CitationPanel already uses for AI-sourced
material). Two series sharing a provenance vary by TONE only — never by identity.

**The §A6.2 gate is enforced in the UI, not the prompt** (`selectClaims`): daily is a descriptive
recap and pattern/causal claims are withheld there — and SHOWN AS withheld (§A9: never silently
dropped), pointing at the weekly view. PROVED BOTH WAYS by mutation: forcing the gate open fails 3
tests, forcing it closed fails 2 — a gate that can't fire is a feature silently disabled.
`summary.ts` holds the §A5/§C3 kind, non-shaming copy as pure functions so the constraint is
testable; `summary.test.ts` sweeps every day shape for shaming/target/scoring/causal language and
proves the matchers fire on 17 banned strings. NO RED anywhere in the palette — cutting is writing.
(The first cut of that matcher could NOT catch "productivity down 40%": `down\s+\d\b` fails between
"4" and "0". A matcher that can't catch the thing it names is the house disease in miniature.)

**THE DEFENSIVE CLAMP THAT LAUNDERED A BROKEN FORMULA — the F2 audit finding (2026-07-17).**
`pearson()` shipped as `clamp(num/den, -1, 1)`. The audit dropped the Y spread from the denominator
(`sqrt(dx2*dy2)` → `sqrt(dx2*dx2)` — i.e. NOT Pearson's r at all) and **the whole 1054-test repo
stayed green** (reproduced before fixing). Two things combined: every fixture was degenerate (on the
perfect-positive case the mutant computes r=2 and the clamp returns exactly the 1 the test asserts),
and the ONE non-degenerate fixture asserted only `-1 ≤ r ≤ 1` — **which the clamp guarantees by
construction**. A vacuous assertion sitting on the only data that could have caught it. User-facing:
it feeds `breakVsOutput`, so the mutant would show the writer r=1.0 ("your breaks predict your
output") where the truth is 0.696 — vibes-as-numbers presented as MEASURED, §A6.1's exact failure.
FIXED: that assertion is now `toBeCloseTo(0.696, 3)` plus symmetry and scale-invariance properties
(a denominator that drops an axis is asymmetric and scale-sensitive by construction). **AND THE
CLAMP IS GONE**: for a correct Pearson, Cauchy–Schwarz makes |r| ≤ 1 always, so a wide clamp is
UNREACHABLE in working code and its only possible effect is to disguise a broken formula as a
plausible number. It now snaps only the floating-point hair (±1e-9) and REFUSES anything grossly out
of range — an impossible measurement must stop being reported, not be rounded into looking fine.
Mutation-proved: drop-Y now fails 6 tests (3 from the value assertion, 3 more from the guard).
**THE SHAPE TO REMEMBER: a defensive clamp on a quantity with a provable range is not safety — it is
a silencer.** F3 (also real): pearson's `n`-truncation had never been exercised (every fixture passed
equal-length arrays, so `mean(xs.slice(0,n))` → `mean(xs)` survived); now covered both directions
plus the min-sample gate applying to the TRUNCATED length. Five pearson mutants die (3/6/4/2/2).

**Tests are the deliverable's spine** — 122 across `phase`/`phase.variants`/`phase.thresholds`/
`phase.sweep.probe`/`aggregate`/`judged`/`summary`/`charts`. Fixtures (`fixtures.ts`) generate from labelled BEHAVIOURAL processes
whose ranges deliberately straddle the rule's cut-points, so the classes overlap and the rule CAN
fail; an inverted-classifier known-negative proves the scorer isn't measuring a fiction. Ledger tests
carry explicit UTC offsets — a suite that passes only in Australia/Brisbane is a check that can't see
its own failure. PRE-EXISTING, NOT THIS LANE'S: `vite preview` throws React hydration errors (#418/
#423) on EVERY route — /about and /verify included, 28 apiece — which strips `<html data-theme>` (the
recovery failure entry.client.tsx:100 documents), so the screenshot probe asserts the theme attribute
directly.

## Productivity ledger (P1a-core, 2026-07-17 — `src/productivity/`, flag `inkwave:prodLedger`, DEFAULT ON since 2026-07-18)

Session capture + a per-month ledger, per the Productivity/Email build spec §A3–A5. **The surface is the
TOOLBAR'S CLOCK DROP-UP (`components/ClockMenu.tsx`) — `/ledger` the route is GONE** (Peter, 2026-07-17:
"make the ledger a drop up rather than a new page"; a Pomodoro you must navigate away to reach is not one
you would use while writing). **The schema (`types.ts`) is a CONTRACT** — `feat/prod-graphs`,
`feat/prod-ai-report` and the email layer all read `SessionRow`. snake_case is deliberate (it is a CSV/wire
contract, not repo style); don't "tidy" it. `types.ts` is now the ONE contract file: the AI-report path's
type-only mirrors were folded in on rebase (its aggregate shapes kept verbatim; its SessionRow/DocType
mirrors deleted — the real schema supersedes them, and the names matched already).

### The clock UI (2026-07-17 — Peter's UI round)

- **THE CLOCK IS A SLOT, not a button bolted on the bar.** `SlotId` gains `'clock'`; the row is
  `slotCount()` = 6, or **7 when `?prodLedger` is on** — so a writer without the feature sees no width
  change at all. It migrates the way CLAUDE.md's own 4→6 note documents (append), and is DROPPED from a
  stored row if the flag goes off, so a 7-slot config can't strand an unrenderable id. Reorderable +
  ▲-overflowable like every other slot. PROBED on a 390px iPhone viewport: 7 slots + ▲ + ⋮ FIT.
- **THE TICK NEVER RENDERS REACT — the whole design.** `pomodoroStore.ts` is a module store with TWO
  channels: `subscribe` (state: start/pause/phase/config — RARE, React may use it) and `subscribeTick`
  (the NUMBER, once a second — IMPERATIVE ONLY). `TimeFace`/`TimeRing` write `textContent`/
  `strokeDashoffset` off the tick; the store's interval exists only while a phase counts down. A
  `setState` per second inside TiptapEditor's tree would re-render it every second, forever, while
  someone is typing — the `--wave-x` shape. KEPT IN THE GATE by `components/TimeFace.test.tsx`
  (mutation-proved: the obvious setState-per-second TimeFace kills 2 tests).
  **THE IN-BROWSER TYPING A/B IS VOID ON THIS BOX, and the probe says so rather than passing:** a
  deliberate per-second 40ms main-thread block moved keydown→rAF p95 only 1.20-1.28× — the harness
  could not see its own known-positive through other agents' concurrent probes (idle p50 wandered
  4.8→9.2ms between runs), and RUNNING scored *noisier* than the block. Two instrument lessons: a
  per-second event lands on ~1 of 50 keystrokes so a MEDIAN is structurally blind to it (read the tail);
  and the first known-positive wrote `--wave-x` per second, which costs nothing because the shipped
  FIREBREAK prunes exactly that write on a near-empty document. Re-run on a quiet box for a number.
- **The countdown** (`CountdownOverlay.tsx`): faint grey, top-right, DESKTOP only, only while a block
  runs (parking 25:00 over the prose forever is noise), click → opens the drop-up. It is PORTALLED TO
  `document.body` — a SIBLING of the editor, never a descendant — plus `contain: layout style paint`, so
  its per-second write cannot reach the page subtree BY CONSTRUCTION. PHONE: not rendered (the corner is
  the writing area there); the drop-up's own face is the phone's countdown.
- **Chimes are customisable with previews** (`chime.ts`): five SYNTHESISED voices (bell/bowl/glass/wood/
  harp) — sine partials + slow exponential release, no audio assets on a writing app's load path. A
  preview plays from a TAP, which is also the gesture iOS needs to unlock the AudioContext for the real
  chime later. Every voice is gentle by construction: this interrupts someone who is writing.
- **NIGHT MODE FOUND A REAL BUG — `--iw-on-ink` is new (2026-07-17).** The filled controls (Start, the
  active preset pills) were `color: #fff` on `background: var(--iw-ink)`. `--iw-ink` is DARK purple in
  day (white reads) and LIGHT purple in night (#cbb8f2 — white VANISHES). Measured on screenshots, not
  reasoned about. `--iw-on-ink` (day #fff / night #2c2e35) is the token for text on an ink FILL — same
  shape as the existing `--iw-newbtn-fg` ("darker on its light-blue chip in night"). **Any new filled
  control must use it; a literal white on an --iw-ink fill is a night-mode bug by construction.**
- ~~Lengths are PRESET PILLS~~ **SUPERSEDED 2026-07-19 (`f8dd8aa`) — now NUMBER INPUTS**, edited by
  clicking the timer directly, clamped through the same sanitiser the store uses (see the nav-shell
  restructure below). §A5 still holds: completed blocks are DOTS, not a number to beat; no red anywhere.

- **`prodLedgerEnabled` GRADUATED DEFAULT ON (2026-07-18, `77b8564`)** — Peter: *"take all the flags
  off for music and everything"* (see "STOP FLAGGING EVERYTHING" below). Reader is `!== '0'` (on
  unless explicitly off); `?prodLedger=off` / `setProdLedgerEnabled(false)` write a sticky `'0'`.
  Session capture, the clock drop-up, countdown overlay, ledger, goals and reflection now all ship
  live. SSR/prerender/node keep the OFF fallback so capture never runs off the keystroke path. The
  slot-count note two bullets up ("7 when `?prodLedger` is on") is therefore now the DEFAULT shape,
  not the exception — the clock slot is live for every writer out of the box.

### The clock panel — restructured into a 5-button nav shell (2026-07-19, `f8dd8aa`)

**Supersedes the flat drop-up described below where they conflict.** Peter's spec: the clock button
opens a panel with **five nav buttons** — Start/stop work, Goals, Reporting, Progress tracking,
Manage projects — laid out so a sixth is one array entry away. `LedgerDropUp` is now a home screen of
nav rows + per-view sub-panels, wiring the EXISTING pieces behind them (pomodoro, `GoalsSection`, the
AI report modal, the charts modal, the ledger) — never a second copy of any of them.

- **Start-work flow:** Start work → **WHERE** (typed place, reuses `places.ts`) + **WHAT** (intention)
  + optional block length → runs the pomodoro → at the end, a SUMMARY prompt lands as the ledger row's
  note via the existing `annotateRow` path. `workSession.ts` claims only the pomodoro row that started
  at/after the Start action (never a prior session's flush) — mutation-proved.
- **Chime is now a DROPDOWN** — the five synthesised voices plus **Silent** in one `<select>`, with a
  preview affordance (supersedes any earlier "customisable with previews" bullet below where it implied
  a picker grid rather than a dropdown).
- **Repeat + OS notification on timer end:** `playChimeEnd` repeats the chime on the audio clock
  (throttle-proof); `notify.ts` fires a Web Notification (permission requested lazily on the first
  Start-work gesture) and degrades to the in-page toast if denied. A `visibilitychange` reconcile fires
  the overdue transition the moment the tab returns (covers the tab-was-backgrounded-through-the-ding
  case a plain timer callback would miss).

Blast radius: LIVE, default-on (the whole productivity suite graduated the day before). Browser-probed
headless in Chromium, day+night: 5 nav buttons, the WHERE/WHAT/block-length flow, the chime dropdown,
the 4 number-inputs on tapping the timer.

- **The flag is `ledgerFlag.ts` (`?prodLedger=1` / `=off`, sticky), NOT `flag.ts`** — that one is the AI
  report's (`?prodReport`). A `flag.ts`/`flags.ts` pair in one directory is how someone imports the wrong
  feature and never notices; hence the rename.
- **`sessions` at weekly/monthly is `[]` — DECIDED (2026-07-17), answering prod-ai-report's contract ask.**
  Opted-in notes travel as `note_digest` (per LOCAL day) instead. The serious reason is §A6.4: shipping
  session rows at monthly puts a SECOND copy of every measured number in the payload beside the day
  rollups, and two copies is exactly how a narrative ends up contradicting the bars. One representation of
  measurement, always. (§A6/§A7's "rollups, not raw logs" is the second reason; the note TEXT dominates
  tokens either way, so the digest costs the writer's own words and nothing more.) COROLLARY: "where do I
  work best" must be a MEASURED client-side by-place rollup, never inferred by the model from raw rows.
- `installSource.ts` fills prod-ai-report's `setAggregateSource` seam with `aggregate.ts` (real §A3.3
  rollups from the real ledger). Gated on the ledger flag: with capture OFF there is no source, so the
  panel says "tracking is off" rather than measuring an empty ledger and reporting "you did nothing".
  It never clobbers the labelled `?prodReport=demo` fixtures.

- **TYPING COST IS THE WHOLE DESIGN.** The tap rides the EXISTING `onTransaction` stream and reuses
  `countSteps` (provenance/cadence.ts) — no new content instrumentation. Per keystroke it does: countSteps →
  compare 2 numbers → increment 3 fields. **MEASURED (Node, 13k-word doc): 0.30µs/keystroke, flat from 200 →
  40k words (0.39µs → 0.52µs); disabled gate 0.07µs.** The known-positive in `capture.perf.test.ts` (one
  `countWords` walk = 1.97ms, 6581×) proves the harness can SEE an O(doc) cost before its verdict is read.
- **THE BASELINE TRICK (why words_start is free):** a session boundary IS an inactivity gap, so the document
  cannot change while nobody edits it ⇒ the word count at the previous CLOSE is exactly the next session's
  `words_start`. Every O(doc) number (words_end, the word diff) is computed at CLOSE, never on a keystroke.
  Idle is found by ONE 30s interval — never a clearTimeout/setTimeout churn per input.
- **GROW-ONLY (§A9 + the real 2026-07-05 truncation incident):** every write reads the target and UNIONS
  first (`mergeLedgerRows`, keyed by session_id). LWW only within one session_id: later `end` wins, then more
  edit_events, then the RICHER row — that last clause stops a plain copy syncing in from another device from
  erasing a diary note (annotating does NOT change `end`).
- **DAILY ATTESTATION BLOCKS ARE NOT CHAINED TO EACH OTHER — deliberate, a failing test forced it.** A
  cross-day prevHash chain makes any late append (the NORMAL multi-device case) invalidate every later day's
  blockHash and burn its Bitcoin anchor. Each day hashes only its own rows (bound to month+day) and is
  independently OTS-anchorable — exactly how snapshots already work (they aren't chained either; the chain
  lives inside a signing session). Proofs carry over iff the blockHash is unchanged. OTS stamping runs on
  demand for CLOSED days only, NEVER on load (the ~10s sweep rule).
- **`wordDiffStats` (capture.ts), not raw `diffWords`:** diffWords tokenises as [word][trailing-whitespace]
  for display round-tripping, so a 2-word addition measured 3 added + 1 deleted; and `diffStats` counts \S+
  while `countWords` counts [\p{L}\p{N}]+, so `added-removed` would contradict `net_words` in the same row.
  Both are pinned with a live known-negative. HONEST LIMIT: churn that nets out inside one session isn't
  counted (that evidence is the paid cadence tap's, not the ledger's).
- **§A9 time:** `start`/`end` are ISO-8601 WITH the local offset — one field carrying the UTC instant AND
  the offset, so the local day is recoverable. Never emit a bare `Z`.
- **Location: there is NO location collection and no `navigator.geolocation` anywhere.** `place` is a word the
  writer TYPES ("library"), same class as their `note`. Peter overruled §A3.2 to want location, then chose
  user-labelled (2026-07-17). Do not "upgrade" it to real location without re-reading §A3.2 and asking him.
- **`note`/`place` are USER PROSE, not telemetry** — OFF by default, their own opt-in (§A7.3). WHAT ENFORCES
  IT: `report/compile.ts`'s ALLOW-LIST (it NAMES every field that leaves; note/place are not among them) +
  the `includeNotes` gate, default false. **`LEDGER_PRIVATE_FIELDS`/`stripPrivateFields`/`PublicSessionRow`
  are GONE (2026-07-17)** — that deny-list had ZERO non-test callers on every branch incl. master while
  types.ts called it "the DEFAULT payload shape" and `/privacy`'s header cited it as the enforcing mechanism.
  The property held (the allow-list is real, so this was never a leak) — the danger was quieter: editing
  `LEDGER_PRIVATE_FIELDS` to protect a new field would have done NOTHING, silently. Two rules for one
  question, only one live, docs pointing at the dead one. **Do not reintroduce a deny-list** (compile.ts's
  banner has the argument: it fails the opposite way, and that failure is silent); name new columns in
  compile.ts instead. `/privacy` MUST stay in sync and MUST name the guard that is real.
- **`doc_label` IS TIER 1 (ungated); its §A3.2 suppression is now REACHABLE (2026-07-17).** `/ledger` has a
  **Titles** section listing every document the month recorded, with a per-doc Hide/Record toggle wired to
  `setLabelSuppressed` — which until now had ZERO non-test callers, so the mechanism was live and nothing
  could turn it on. It changes what FUTURE sessions record: rows already written sit inside an attested
  daily block, and silently rewriting history is the one thing the ledger exists to make impossible.
  STILL OPEN (Peter's call, proposal with the lane's report): the sharp case is the EXPORT, not the local
  file — the ledger never leaves the device, so the disclosure happens at §A7.3's tick-box. Proposed there:
  a per-document **pseudonym** ("Document 1") rather than dropping the label, which keeps §B1's "40m on
  email" readable while the title stays home. That screen is prod-ai-report's; not built unilaterally.
  THE ORIGINAL FINDING, kept for the argument:
  `isLabelSuppressed` is wired into capture.ts's close path, but `setLabelSuppressed` has ZERO non-test
  callers: no UI turns it on, so in practice EVERY title travels to the AI in tier 1. A title is
  writer-authored prose, so compile.ts's tier-2 rationale ("tiers 1 and 3 alone would let the writer's own
  prose ride out inside 'metadata'") applies verbatim. Why tier 1 is nonetheless right for it: a label is the
  IDENTIFIER of the measured thing, not an extra disclosure — drop it and §B1's "40m on email" cannot be read
  (every row becomes `doc-a1b2f3`), and §A7.3's tick-box lists documents BY LABEL at the moment of consent.
  That covers the ordinary case, not the sharp one ("Chapter 3 — my mother's illness") — which is exactly why
  §A3.2 asks for per-doc suppression. **The missing control is a real gap; placement is a consent decision.**
- **§A5 is a hard constraint:** kind, non-shaming, no scoring. The day summary leads with TIME and SESSIONS;
  a cutting day reads "editing is writing too". Nothing here may grow a red number.
- **CLOUD SYNC IS WIRED (2026-07-17) — `ledgerSync.ts` + `ledgerRemotes.ts`, and it is shaped by the
  2026-07-15 blind overwrite.** The ledger is its OWN file beside the .studio (`inkwave-ledger-2026-07.json`),
  never inside it (the .studio is per-document; the ledger spans all of them). READ-MERGE-WRITE, always:
  - **A FAILED READ IS NOT AN EMPTY REMOTE.** `RemoteRead` is a discriminated union with NO `null` member —
    'absent' (safe to write) and 'error' (never write) are different words and the type system enforces it.
    That distinction IS the 2026-07-15 bug. Malformed/truncated JSON and a wrong-month file are ERRORS, not
    empty ledgers. MUTATION-PROVED: treating 'error' as empty kills exactly the "FAILED READ WRITES NOTHING"
    test; writing local instead of the union kills 5.
  - **NO ONCE-PER-SESSION MERGE GATE.** `syncToOneDrive` merges the remote's snapshots once per session
    because re-reading a 20MB .studio per save is real lag. A month of rows is tens of KB, so the ledger
    takes the safe path on EVERY write. The file's cheapness buys the stronger invariant — don't copy the gate.
  - `mergeIntoLocalLedger` re-reads local INSIDE the per-month write chain (the read-to-write gap is where a
    blind overwrite lives); a row queued mid-sync is pinned by a test.
  - Sync is debounced + single-flight, runs only at session boundaries, and is **DYNAMICALLY imported**
    (`ledgerRemotes-*.js`, 4KB) — PROBED in the real browser: 0 requests on the editor's load, >0 after a
    close (the known-positive, so "never fetched" can't be a blind detector reporting success).
  - ONEDRIVE is the only adapter (the live provider). Drive/folder take the same `LedgerRemote` shape and are
    deliberately NOT written blind — an absent-vs-error mapping never exercised against the real API is the
    guess that becomes a blind overwrite. **STATED, NOT PROBED: Graph 404 ⇒ absent.** It fails SAFE (a wrong
    mapping means sync never starts, never that data is lost), but it needs Peter's account to confirm live.
- **F5 (test auditor) FIXED BEFORE IT WENT LIVE:** `mergeLedgers` returned `attestations: []` — harmless
  while unwired, a proof-shredder the moment sync called it (every write-back would drop both devices'
  Bitcoin anchors and re-stamp the month). It now offers BOTH sides' proofs to `buildAttestations`, which
  keeps one only where it still attests the recomputed block, preferring the strongest (confirmed > pending).
  Mutation-proved: the original bug restored verbatim kills 3 tests.
- **`doc_type` DEFAULTS TO 'essay' — DECIDED (2026-07-17), and there will be no heuristic.** Nothing in the
  document model distinguishes a note from an essay, and inventing a rule (length? title?) is the
  vibes-as-numbers §A6.1 forbids for a measured field. Inkwave's documents ARE prose documents, so 'essay' is
  the honest default and the email layer's explicit `docType: 'email'` — the one distinction any feature
  actually reads (§B1's "40m on email") — flows through untouched. If note-vs-essay ever earns a feature it
  needs a field the WRITER sets, like the email lane's, never a guess.
- NOT wired: at-rest ENCRYPTION — the repo has no encryption layer for ANY document (spec §C2 assumes one),
  so the ledger inherits the same posture. Google Drive / local-folder ledger adapters.

### PDF reading/annotating + the post-hoc manual add (2026-07-17, `feat/prod-pdf-posthoc`, `?prodLedger`)

Two things Peter asked for, both DARK behind the ledger flag. **`reading`/`annotating` existed in the
`DocType` union and NOTHING SET THEM** — declared-but-inert, which was honest (`misc` is the truthful
answer until something observes otherwise). Now something does.

- **SCROLLING IS THE EVIDENCE, and the third state is the product.** Peter: *"Pdf pure reading time
  and annotating time can be 2 separate things… track when people have done an annotation in the last
  5 minutes"* / *"track whether they are scrolling in the pdf… stored client side… a reading indicator
  on the ledger, next to a pdf name."* `productivity/pdfActivity.ts`: scrolling ⇒ `reading`;
  annotation within 5 min ⇒ `annotating` (annotation WINS — you scroll while you annotate, and
  counting both double-counts); **open + no scroll + no annotation ⇒ NOT WORK, never counted.**
  Without the scroll signal "reading time" means only *a PDF was open*, which counts a tab you forgot
  about.
- **IT MAY ONLY EVER REPLACE AN ADMITTED UNKNOWN.** `observedDocType` fires ONLY where `doc_type`
  would have been `misc` AND `edit_events === 0`. So it cannot make any row less true, a DECLARED
  type (the email layer's) is never overridden, and **a session with typing is never filed as
  reading** — which is what makes "reading time is never summed into words written" structural rather
  than a promise: they are different rows in a different column. No activity ⇒ `misc` STANDS (the
  block is still measured — starting the timer IS the claim of work; "not reading" and "not a
  session" are different things, and the four stacked faults the ledger lane fixed stay fixed).
- **A BOOLEAN, NOT A TRACE (§A3.2).** Exactly TWO NUMBERS per citekey — last scroll, last annotation.
  No page, no offset, no count, no history. **NO PROGRESS BAR** — considered and REJECTED: a
  page-by-page reading trace of Peter's private PDFs is a far more sensitive object for no feature
  gain. If the indicator ever seems to need progress, ask him; don't add the field. Persistence
  PRUNES on every write, so the store is structurally incapable of becoming a record of which PDFs
  were opened.
- **IT RIDES THE EXISTING STREAMS** — `PdfViewer`'s already-rAF-coalesced scroll reporter (which
  already computes `scrollTop`) and the two annotation-creation sites. No new listener on a surface
  CLAUDE.md documents as supersampled + lazily rendered. **THE PERF GUARD IS STRUCTURAL, NOT TIMED**,
  copying the ledger's own rule (*"a measurement whose verdict depends on who else is running is not a
  guard"*): `localStorage` is the ONLY route from a scroll frame to the disk, so the test COUNTS
  STORAGE WRITES across a 600-frame burst (expects 0; the debounce timer writes exactly 1). Its
  known-negative proves the spy can see a write, so `not.toHaveBeenCalled()` is a real observation.
- **`entered: 'timer' | 'post-hoc'` — an EXPLICIT union on every row, never absence-means-timer**
  (*"absence-as-classification is the exact trap `misc` just fixed"*). **It is NOT a fourth
  provenance, and the reasoning is load-bearing: `estimated` means a deterministic rule we ran that
  anyone can recompute; a post-hoc block is TESTIMONY — uncheckable, not recomputable.** Different
  epistemics, so it must not borrow that tag. It is a FLAG ON THE ROW; the row is still
  measured-SHAPED, the SOURCE OF THE TIME differs. Legacy rows carry no `entered` and are timer rows
  as a matter of HISTORY (they predate the field) — read only through `isPostHoc()`, which asks the
  POSITIVE question so the reasoning can't be re-derived as `!row.entered` elsewhere.
- **IT NEVER MERGES INTO THE MEASURED BARS (§A6.1)** — and that is enforced by SEPARATE COLUMNS
  (`posthoc_minutes`/`posthoc_session_count`), so conflation is unrepresentable rather than merely
  discouraged. The report must be able to say *"3h40m measured, plus 45m you added from memory"*.
  Three split sites, each independently mutation-proved (5/2/1 deaths): `dayAggregate`, `aggregateDays`
  (the charts — no bar may be part-remembered), `windowDocs`.
- **DO NOT MAKE HIM PRECISE.** Rough duration + rough category, as PILLS — one tap each. A form
  demanding start/end times won't get used on a Tuesday and the feature dies if the ritual becomes
  data entry. The span is DERIVED (ends when he told us, reaches back by the duration); `entered`
  flags the whole row as testimony so the span inherits it, and the card shows **"about 45m"** with NO
  start–end times — printing "13:15–14:00" would dress testimony up as a measurement. Every measured
  field is 0, which is the TRUE value, not missing data. **A repair tool, not an audit** (§A5: *"a
  friend letting you correct the record, not a supervisor auditing your timesheet"*) — collapsed by
  default, never nags, never scolds; a test sweeps the copy for it.
- **⚠️ THE BUG THE UNIT TESTS COULD NOT SEE — `daySummary` IS A SECOND IMPLEMENTATION OF "sum the
  day's minutes".** The drop-up reduced over ALL rows, so the moment a post-hoc block landed it
  reported 45 REMEMBERED minutes back to Peter as **"focused minutes"** — §A6.1's merge, live on his
  screen — while `pnpm test` sat at **1762 passed**. Every guard was on `aggregate.ts`, and the panel
  never calls it. **A guard on one implementation of a rule says nothing about the other.** Found only
  by `pdfposthoc.prove.mjs` driving the real panel and reading the real screen. FIXED, and KEPT by
  `components/ClockMenu.test.tsx` (~40ms, no browser, 5 mutants die) — because a browser probe that
  ran once is not a guard.
- **`scripts/pdfposthoc.prove.mjs`** (`pnpm prove:pdfposthoc`, own port, headless): 18/18 — the
  indicator day+night × desktop+phone (incl. **the stale PDF must NOT appear**, the honest third
  state), and the post-hoc add driven through the real pills. It reads the Add button's **COMPUTED**
  colours rather than asserting a class, because the night bug CLAUDE.md records in this very panel
  was structurally perfect and visually invisible: day `#fff` on `#5c2d8a` (Δlum 0.76), night
  `#2c2e35` on `#cbb8f2` (Δlum 0.57) — `--iw-on-ink` working in both. **A PROBE THAT FAILS BY LUCK is
  as useless as one that passes by luck:** the first cut slept 700ms and reported "the indicator did
  not render" about a panel that renders it, sending me hunting a feature bug that did not exist. Wait
  for the CONTENT, not the clock.
- STATED, NOT PROBED: the `reading` row has not been driven end-to-end in a REAL browser with a REAL
  PDF open (the unit-level joint probe `pdfCapture.test.ts` drives the real `SessionCapture` and is
  mutation-proved both ways — ignore-activity kills 3, hard-wire-`reading` kills 6 — but the
  `PdfViewer` scroll hook itself is wired-and-typechecked, not browser-exercised). The reading
  INDICATOR is browser-proved from seeded state.

## Email layer — P1b (2026-07-17, `src/email/`, flag `?email`, DEFAULT OFF)

### Gmail API send — P2a implementation (2026-08-31, `feat/gmail-send`)

`src/email/gmail.ts` is the first real `MailSender` adapter. It uses Google Identity Services in
the browser and requests exactly `https://www.googleapis.com/auth/gmail.send`; the short-lived token
is kept in memory only. The browser constructs the UTF-8 RFC 5322 message and POSTs it directly to
`users/me/messages/send`, so neither the token nor message content crosses an Inkwave server.

The visible action deliberately orders its boundaries: Google authorization first (the popup needs
the click gesture), then `finaliseEmail` creates the durable local snapshot, then Gmail receives the
message. If the snapshot cannot be created, nothing is sent. The existing Gmail/Outlook/`mailto:`
handoff stays available as fallback. Configuration is `VITE_GOOGLE_CLIENT_ID`; without it direct
send is absent rather than a dead control. Google Cloud still needs the Gmail API, OAuth consent
screen, authorized JavaScript origins, and production verification before public rollout.

The guard set is `email/gmail.test.ts` (scope, MIME bytes, Unicode/long body, API success/failure)
plus `components/EmailComposePanel.gmail.test.tsx` (authorization → record → send, and refusal to
send on record failure). This stage proves Gmail accepted the submitted bytes; it does not claim
delivery or DKIM capture.

**Manual acceptance + hardening (2026-09-03).** Direct Gmail send was exercised through the real
Google account flow and confirmed in the recipient inbox; Peter also confirmed the existing send
and provider-handoff paths in Safari. The apparent “blank body” was a UX ambiguity — the editable
body is the ordinary page below the header card — and is assigned to §D2's full-page email surface,
not a transport defect. The action boundary nevertheless had a real freshness race: the editor
deliberately lets its React `doc` prop lag typing until the 200ms save beat, so every record/send/
handoff action now calls the editor's `ensureDocFresh` once and uses that same current document for
the record and transmitted draft. Snapshot view now renders the snapshot's own frozen To/Cc/Bcc/
Subject above its historical body; it never reads live headers for an old body. Peter confirmed the
four manual acceptance checks on 2026-09-04: frozen To/Subject, historical body, snapshot navigation,
and return to the live editor all passed.

Two hangs found only in live use now have explicit exits: GIS `error_callback` reports a blocked or
closed popup and a 120s fallback handles browser hosts that never return either callback; the OTS
relay aborts after 15s, leaving the already-persisted snapshot unstamped for the normal retry drain
while Gmail send continues.

**Unknown send state (2026-09-04).** A rejected Gmail HTTP response is an authoritative failure, but
a thrown browser `fetch` is not: Gmail may have accepted the request before the response connection
was lost. `SendOutcome` now carries `unknown` for that case. The UI says the local draft is recorded
and tells the writer to check Gmail Sent before retrying; it no longer asserts “was not sent” and
therefore does not invite a duplicate. This needs no read scope. The future connected mailbox can
reconcile the provider state as specified in v0.5 §B3.4/§D2.3.

**Safari hard-refresh report — resolved as Reader mode, not an app defect (2026-09-04).** The
apparent alternating full editor / unstyled page was reproduced by pressing `Shift-Command-R`:
Safari assigns that shortcut to toggling Reader. Reader extracts static text, displays the document
title as a large heading, and excludes the interactive `contenteditable` body; pressing the same
shortcut again exits Reader and restores the editor. The correct reload-from-origin shortcut is
`Option-Command-R`. Service-worker replacement and forced reload attempts did not change the report
and were removed once the premise was falsified. Process inspection separately found duplicate dev
listeners; they were stopped, `strictPort: true` now catches the ordinary duplicate-instance case,
and `CLAUDE.md` records both development rules.

**Connected Gmail mailbox is SPEC ONLY (v0.5, §B3.1–B3.5).** Inbox/Sent (`gmail.readonly`) and Gmail
draft sync (`gmail.compose`) are designed as a separate, explicit restricted-scope connection.
Nothing in this build requests read/compose/modify access; current Gmail remains `gmail.send` only.

**Dual email surfaces and multi-message sending are SPEC ONLY (v0.5, §D2).** New email work will
default to an isolated page-sized email surface. The present writing-page arrangement survives as a
purposeful contextual studio: one or more complete message boxes (body inside each box) can sit among
journal prose and annotations, support recipient variants, and send as a reviewed batch. Every box
remains its own email subdoc; surrounding notes are excluded from sent bytes by structure. Batch
preflight records all selected messages before the first transmission and preserves per-message
`sent` / `failed before acceptance` / `status unknown` results. No part of that UI or data model is
implemented in the current Gmail-send build.

Spec: `Inkwave-Productivity-Email-BuildSpec-v0.2.md` §B (now COMMITTED at `docs/specs/` — Peter, 2026-07-17: "commit the specs"
into the repo). MVP = compose in Inkwave, count it in the productivity ledger, OTS the draft, hand
off to the provider to send. Inkwave never sends mail and never touches an inbox.

**An email is an ORDINARY document — that is the whole design.** `docType: 'email'` + an `email`
header block (To/Cc/Bcc/Subject) on InkwaveDocument; the BODY is `contentJson`. Edit history,
provenance hashing and ledger session capture apply because it is an ordinary document, not because
anything in `src/email/` arranges it. Don't grow a parallel email path.

**THE HONESTY BOUNDARY (§B2.2/§C1.4 — existential, not cosmetic).** OTS proves *this content existed
by time T*. It does NOT prove sending, delivery, or origin. Proof of origin needs DKIM (Phase 3, not
built). The handoff hands the draft to the provider's compose window and the user can edit before
sending — so the provenance is of the *Inkwave draft*, not the sent bytes.

⚠️ **THERE IS NO AT-REST ENCRYPTION IN THIS BUILD — DO NOT SAY THERE IS** (verified in the code
2026-07-17). Spec §C2 says at-rest encryption is "default on" and the P1b brief repeated it as fact,
but it is design INTENT: `storage/opfs.ts` writes `JSON.stringify(data)` through writeOpfsFile in
PLAINTEXT, `crypto.subtle.encrypt`/AES-GCM appear NOWHERE in src, and package.json carries no crypto
library. Documents, snapshots and emails are gzip'd JSON in OPFS — protected by the browser's origin
sandbox and the device's own disk encryption, not by Inkwave. The email copy shipped "stored
encrypted on your device" until the code was checked; it now says "stored on your device — we never
hold it", which is TRUE (zero-retention is real: there is no server holding it). `copy.test.ts`
guards this with a matcher. **Copy tracks the CODE, not the spec** — the spec is a plan, and a plan
is not a property. When §C2's encryption ships, the word can come back. NOT E2E either, ever, unless
the recipient runs PGP/S-MIME.

ALL of the EMAIL lane's in-product copy lives in `src/email/copy.ts` (one source
of truth) and `copy.test.ts` asserts the forbidden claims are absent — each matcher proved to fire on
known-bad copy AND not to fire on an honest control FIRST, because "assert the bad phrase is absent"
passes trivially on empty or broken matchers. The control earned its keep immediately: the naive
matchers flagged "It does not prove that you sent the email" — they could not tell an assertion from
its denial. Hence two matcher classes (affirmative-only vs literal). If new copy sounds better than
"you had written exactly this by this time", it is wrong.

**Hashing — `bundleHash` gained a v:3 form.** v:1 `{contentHash,receipts}` / v:2 adds `bibHash` /
**v:3** `{v:3,contentHash,bibHash:…|null,emailHash,receipts}` when the doc is an email. Snapshots
freeze `email` + `emailHash` exactly as they freeze `bibliography` + `bibHash`; verify recomputes
both and folds them into the bundleHash recompute, so OTS genuinely BINDS the headers. Non-email
docs keep v:1/v:2 BYTE-IDENTICALLY — every already-anchored snapshot verifies unchanged (asserted
against literal canonical forms, not against the function's own output). Headers are canonicalised
before hashing (`email/headers.ts` normaliseHeaders: address lowercased, display name kept,
whitespace collapsed, de-duped, order PRESERVED, absent cc/bcc ⇒ `[]`) so one header set has exactly
one anchored hash. That rule is a provenance boundary like pmToText — changing it changes what past
anchors mean. `pmToText` itself is UNTOUCHED.

**PROVED, not assumed** (`email/roundtrip.test.ts`, 13 tests): drives the REAL
createSnapshotIfChanged → gzip archive → stampSnapshot → buildExportBundle → verifyBundle, with an
in-memory OPFS shim (`email/testOpfsShim.ts`, test-only) and fetch stubbed at the network boundary
only. Asserts the digest submitted to the calendar IS the v:3 bundleHash (not contentHash), and that
tampering with a recipient / subject / bcc / body, STRIPPING the headers (downgrade to v:1), or
tampering-and-recomputing emailHash all FAIL verify. A round-trip that only ever passes proves
nothing.

**Sending — `MailSender` (§B3)**, one interface, `email/sender.ts`. Only adapter today: `handoff`
(Gmail/Outlook compose URL, `mailto:` fallback), no OAuth. Gmail API send (`gmail.send`) is Phase 2
and needs Google's restricted-scope verification — it slots in as another MailSender. If an API
adapter ever lands it is SEND-ONLY; never request inbox-read (§B5). `SendOutcome` has no `'sent'`
variant on purpose — the handoff genuinely cannot know. Over-long drafts are REFUSED, never
truncated (mailto 2000 / web compose 8000 chars, conservative).

**Ledger seam (§A3.2 `doc_type`):** this layer sets `docType: 'email'` on the document and NOTHING
else; `productivity/capture.ts` `resolveDocType(doc)` reads it and tags the session row. The two
branches agreed on this contract independently — the ledger's own comment says "the email layer sets
`docType: 'email'` explicitly and it flows through untouched" — so no field negotiation was needed.
The ledger owns RESOLUTION (its `DEFAULT_DOC_TYPE` is 'essay' for untyped docs); this owns the
classification only. An accessor with a competing 'note' default was written here and REMOVED before
commit: two rules for one question is how implementations drift. MERGE NOTE: `DocType` is declared
in BOTH `types/document.ts` and `productivity/types.ts` (identical unions, written in parallel) —
whichever lands second should import from `types/document.ts` rather than keep the copy.

**Live probe:** `scripts/email.prove.mjs` (headless, own port, nothing on Peter's screen) drives the
REAL built app: flag-off → no panel, `?email=1` → menu → panel, the copy, header PERSISTENCE across
a reload, finalise → frozen canonical headers + emailHash, and asserts the digest the browser
submits to `/api/ots` is the v:3 bundleHash and NOT the contentHash. 16/16. It caught two bugs the
unit tests structurally could not: a header edit never called `scheduleSave` (autosave is driven by
the editor's own update handler, which a header field never fires — headers lived in React state and
died on reload), and `ensureDocFresh` overwrote an email's subject-derived title with the first line
of the BODY. Its copy checks VOID rather than pass when no panel renders — "no forbidden claim" on a
page with no copy is a pass that means nothing, and it did exactly that on the first run.

TRAPS FOUND HERE (both the house speciality): (1) `listSnapshots` serves from a write-through
in-memory cache, so reading back through the same module instance NEVER touches the archive — the
first cut of the persistence test passed while proving nothing; it now resets modules for a genuine
cold gunzip. (2) That cold read exposed a REAL latent bug in `workers/parseClient.ts`
`inlineGunzipJson`: it wrote a raw ArrayBuffer to DecompressionStream, which REJECTS the chunk — and
both promises were `void`ed, so it HUNG forever instead of throwing, defeating the caller's
try/catch. The no-Worker fallback (node/vitest/prerender) had never once been exercised. Fixed
(write a Uint8Array view).

## §C1.4 copy guard — PRODUCT-WIDE (2026-07-17)

The matchers live in **`src/copy/claimMatchers.ts`** (extracted from `email/copy.test.ts`, byte-for-byte,
NOT copied — two copies of these regexes is how one guard silently stops catching what the other does).
Two consumers: the email suite (semantics unchanged, still its own verdict) and **`src/copy/claims.test.ts`**,
a REPO-WIDE sweep of string literals + JSX text across `src/` + `extension-src/`.

- **Why:** `ALL_COPY = Object.entries(copy)` only ever saw ONE file while its describe block read "the real
  in-product copy makes no forbidden claim". §C1.4 is a PRODUCT rule — nothing stopped another lane shipping
  "stored encrypted on your device" with that suite green, and the music lanes are being built against a spec
  whose §0 asserts encryption at rest **which this build does not have**. PROPHYLACTIC: 0 violations today.
- **Scope is deliberate, and both exclusions are asserted, not assumed:** comments are STRIPPED (this repo's
  comments must NAME the forbidden claims in order to forbid them — a guard that can't survive its own
  documentation gets disabled); test files + `claimMatchers.ts` are skipped because they carry `knownBad`
  BY DESIGN. A test asserts the fixture carrier is imported by tests ONLY, so the exclusion can't become a
  hole. VOID conditions fail the suite if the sweep sees <50 files or extracts <200 strings — an empty sweep
  must fail, never pass.
- **PROVED IN SITU:** planting overclaims in REAL production files (`email/copy.ts` AND `routes/Privacy.tsx`
  JSX — a non-email lane) fails the sweep; restoring them greens it.
- **A REAL HOLE WAS FOUND AND CLOSED in `affirmativeOnly`.** The split was punctuation-only, so a negator
  anywhere in an unpunctuated clause deleted the WHOLE clause — overclaim included. Measured:
  "Every note is tamper-proof." → caught; "…, and we cannot read it." → caught; **"…and we cannot read it."
  → MISSED**. One absent comma hid a forbidden claim. Now splits on and/but/though/although/while/yet,
  proved both ways (every knownBad still fires; the honest control still fires nothing).
  **KEEP NEW AFFIRMATIVE MATCHERS CONJUNCTIVE** — the finer split exposes short clauses standalone
  ("that it arrived"), which is safe only because each matcher needs its "prov…" stem in the SAME clause.

## Productivity + email INTEGRATION (2026-07-17, `feat/prod-integrate` — the four lanes merged)

P1a-core (ledger), P1a-viz (graphs), P1b (email) and P1c (AI report) were built in parallel and are
now ONE layer. What was decided on the merge, and what the merge FOUND. **All flags stay default OFF**
(`prodGraphs`, `prodReport`, `prodLedger`, `email`) — verified, not assumed **as of this 2026-07-17
merge only.** Three of the four graduated to DEFAULT ON the following day under "STOP FLAGGING
EVERYTHING" (`prodLedger`/`prodReport` in `77b8564`, `prodGraphs` in `92425e0`) — see each lane's own
section above for the current status. `email` remains DEFAULT OFF (blocked on Google verification).

- **ONE SCHEMA: `productivity/types.ts`.** prod-graphs' `ledger.ts` was an explicit placeholder mirror
  of §A3.2 ("THE LEDGER SEAM: a one-line import swap when feat/prod-ledger lands") — retired exactly
  as it anticipated. `LedgerSession` → the real `SessionRow` everywhere. `ledger.ts` is now the real
  per-month ATTESTED ledger; the mirror's five time functions moved to `sessionLogic.ts`, which
  already owned `localDayOf` — one rule for one question. Its tests live on verbatim in
  `dayKeys.test.ts` (imports re-pointed, not one assertion changed).
- **`DocType` is declared ONCE, in `types/document.ts`** — a document's own property; the ledger READS
  it (`capture.ts` resolveDocType owns the absent→default rule). `productivity/types.ts` re-exports.
  Two identical unions are not harmless: they drift the first time one side gains a member.
- **ONE `aggregate.ts`, TWO output shapes — and that is NOT a fork.** `DayAggregate` (types.ts,
  snake_case) is the §A3.3 WIRE contract the report emits; `ChartDayAggregate` (camelCase) is the
  charts' view model (prod-graphs' `DayAggregate`, renamed — the wire name belongs to the schema
  owner; two exported types sharing one name in one module is how a caller silently gets the wrong
  contract). `busiest_hours` (start-hour) and `hourHistogram` (apportioned across the span) BOTH
  conserve total active minutes, so they cannot contradict each other on any total — they differ only
  in distribution WITHIN a day and each documents its own limitation. Collapsing them would have
  silently rewritten a lane's measured behaviour to make a merge look tidy.
- **The deep-vs-shallow heuristic is RATIO ONLY — no duration.** Do not let a future merge quietly
  reintroduce it; the measurement (39% coverage / 84%-called-drafting vs a 48% truth) is in phase.ts.
  Three provenance tags stay: `measured` / `estimated` / `judged`.
- **THE SILENT BREAK THIS MERGE FOUND (the house disease, live).** `report/compile.ts` read tier-2
  notes off `agg.sessions` at EVERY window — an assumption written BEFORE prod-ledger answered the
  contract question. The ledger's answer: `sessions: []` at weekly/monthly, notes travel as
  `note_digest` per local day (§A6.4 — rows at monthly would put a SECOND copy of every measured
  number beside the day rollups, and two copies is how a narrative ends up contradicting the bars).
  Result: a writer who ticked "include my notes" on a weekly or monthly report got NO notes,
  `notesIncluded: false`, and no error anywhere. **Both lanes' suites were green** — the `?prodReport
  =demo` fixtures still carried the pre-answer shape, so the path a developer eyeballs worked while
  the real ledger's did not. compile.ts now reads `note_digest` first (session fallback kept for daily
  + demo); the fixtures now mirror the decided contract. A demo whose shape the real source never
  produces is a fiction to build against.

**THE JOINT PROBE — `productivity/emailLedger.integration.test.ts`.** §B1's primary goal ("2h10m
writing, of which 40m on email") had never been verified by anything: the email lane owns
`docType: 'email'` but had no ledger to tag; the ledger lane owns the row but nothing in its tree ever
set `docType: 'email'`. It drives the REAL chain — `newEmailDocument` → `SessionCapture` (real PM
steps) → the real debounced `ledgerStore` on a real OPFS shim → the real §A3.3 `aggregate` → the real
`compilePayload` — and asserts 130 active minutes of which 40 are email, with no message text or
address anywhere in the ledger or payload. **PROVED TO FIRE, both directions:** mutate
`resolveDocType` to ignore the document (the real silent bug — every email minute filed as 'essay')
⇒ 4 §B1 tests fail; hard-wire it to 'email' ⇒ the known-negative fails. No constant passes both.

**TEST-HARNESS TRAP, and it cost a real detour.** `storage/opfsWrite.ts` decides ONCE AT MODULE LOAD
whether OPFS writes use createWritable or the parse worker (`hasCreateWritable`), and node has
neither. Under STATIC imports that constant is already false before any `beforeEach` can install the
OPFS shim, so every ledger write routes to a worker that does not exist, throws, and is SWALLOWED by
`writeAppJson`'s catch — the probe then reads an empty ledger and concludes "the email row never
arrives", which is exactly the fiction it exists to detect. Install the shim, THEN `await import()`
the modules under test (`vi.resetModules()` first) — `feat/email-compose`'s `roundtrip.test.ts` does
this for the same reason, and its comment about `_snapCache` is the other half of the same discipline.
`testOpfsShim` also gained `text()`: `storage/opfs`'s readJson reads TEXT where snapshots read
arrayBuffer, and its absence surfaced only as an empty ledger.
