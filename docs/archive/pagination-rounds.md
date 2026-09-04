# Pagination — the measurement rounds

The **rules** live beside the code in `src/editor/extensions/PaginationExtension.ts`,
`src/editor/arithmeticLayout.ts`, `src/editor/staticPagination.ts`, `src/editor/arithMeasure.ts`,
`src/editor/breakTable.ts` and `src/editor/editorSchema.ts`. This file holds the **why**: the
incidents, the numbers, and the hypotheses that were refuted on the way.

Page breaks are CANONICAL — the same text on page N at every zoom, on phone, and in print — so
every change here is verified by `pnpm prove:breaks` printing byte-identical break positions AND
the same `contentWidth` (601.7007874015749).

Convention: `docs/archive/README.md`. Rule form and the R1–R9 patterns: `docs/RULES.md`.

---

## <a id="arith-engine"></a>The arithmetic layout engine

A reflow-free third acquisition path for `collectLines`: instead of forcing a full-document browser
reflow and reading each block's geometry with `range.getClientRects` (path 1), or replaying a
per-node block-relative cache (path 2, the round-6/7 LineCache), it COMPUTES a block's wrapping from
the boxes of its measurable elements. Output is byte-identical in shape to `collectLines` — per-line
intrinsic tops plus block boundaries — so it feeds the same `computeBreaks` splitter and produces
the same page-break signatures.

### The measurable-element model

Every flowing element supplies a stable box: an INLINE advance plus a line-height demand, or a BLOCK
height plus margins, from a source needing no full-document reflow (computed, or a one-time measure
cached by an immutable key). "Arithmetic-eligible" means "reflow-free-measurable": a block qualifies
when every element in it supplies such a box AND the DOM verifier stays stable over it (the
inline-atom fit guard, `LINE_STABILITY_EPS`).

### Why text is sound — the round-7 certification

Canvas `measureText` reproduces the browser's advance widths to **Δ≤0.05px**, and a greedy break
lands on the SAME word boundaries — but ONLY for the certified font palette. Uncertified fonts
diverge on integer-px advance quantization, which is fatal because canonical breaks must be
cross-device identical.

⚠ The round-7 "failed fonts" list was **retracted** on 2026-07-16: it had measured canvas against a
plain span with ligatures ON on both sides, while prosemirror-view's injected sheet renders the
editor with ligatures OFF. Re-measured in the real context, all 13 previously-failing families
scored Δ0.0000. The cause was named correctly ("hinting/ligature divergence") but blamed on the
wrong half.

### The eligibility table

**Arithmetic-eligible**
- a `paragraph` of text runs (bold/italic/underline/family) at UNIFORM text size in certified fonts —
  mid-word mark straddles are handled piece-by-piece
- …the same paragraph MAY also contain inline MATH atoms that carry a box AND fit the text line
  (`LINE_STABILITY_EPS`) — the common textstyle formula (x², a/b, √, sub/superscripts)
- a block-atom `mathBlock` (or a future `figure`) that carries a reflow-free box

**DOM-only — deferred, never guessed**
- a `citation` inline atom: no stable reflow-free geometry. It is a React NodeView, reflows on
  bibliography hydration and style switches, and measures ~9px off even on plain paths. Recorded as
  a FUTURE measurable, keyed by citekey + style + hydration-epoch.
- a TALL inline formula that exceeds the line (a fraction or ∑ with limits) — the `getClientRects`
  verifier becomes order-unstable, so it defers
- MIXED text sizes in one paragraph — same verifier instability
- uncertified fonts; `orderedList` / `bulletList` / `taskList`, `horizontalRule`, `referenceList` —
  no box supplied

`blockEligibility` returns the exact reason, so the wire-in logs a per-document coverage map.

### ⚠ Why it must not graduate as it stands

`prove:arith` reported **0 divergences across 4k/6k/8k** when the engine was unparked. That number
was true when written and is false now: HEAD measures **every break divergent — 17/17, 25/25,
34/34**.

Bisected on one machine, same fonts, probe file unchanged: clean through `68ff277`, red from
`8f5ae9d` ("page breaks no longer cut a line in half at any zoom") onward. **The arith side is
byte-unchanged** across the range (15/23/31 both before and after); it is the **DOM side that
moved**, to 17/25/34.

The cause is structural rather than a bug in either half. `8f5ae9d` snaps a break to the block
boundary when `!liveIsCanonical`. Whole-doc arith is gated to `!canonicalIsLive`, and
`arith.prove.mjs` therefore *sets* `inkwave:editorZoom = 1.2` to reach the engine at all. **The two
gates are exact complements: the engine only ever runs in the condition the new snap rule governs**,
so it is now guaranteed to disagree on every break.

Canonical rendering is byte-unchanged (`prove:breaks` green), which is why this sat red for two days
without anything a writer sees being affected. The real blocker is now `arithmeticLayout.ts` not
implementing `shouldSnapToBlock` — not the WebKit cross-device pass, which is still required but no
longer first. Graduating on a WebKit pass alone would ship an engine that cuts lines in half at
every zoom, reintroducing verbatim the bug Peter reported on 2026-08-28.

---

## `editorSchema.ts` — the schema outside the editor

<a id="schema-outside-editor"></a>
### Why the file exists at all — the /snapshot blocker

THE SCHEMA, OUTSIDE THE EDITOR (2026-07-17 — the /snapshot blocker).

`buildBreakTable`/`buildRenderModel` take a real ProseMirror `Node`. On /edit that Node is
`editor.state.doc` and its schema came from the editor's constructor. On /snapshot there IS no
editor (`useEditor` is absent from SnapshotView), so a version's `contentJson` — plain JSON in the
.studio file — had nothing to be parsed against. That, and only that, is why the plaintext page
renderer could not go live: every one of its numbers was measured against the live editor's doc.

The schema is derived from THE SAME list the editor is built from (`buildEditorExtensions`), so
"the model matches what the editor paginates" holds by construction rather than by vigilance.
It is still PROVED from outside — `schemaIdentity.prove.mjs` compares this schema's spec against
the LIVE editor's `editor.schema` in a real page, on a document carrying citations, math and a
reference list (the NodeView-bearing nodes are exactly the ones that could differ; a document of
bare paragraphs would prove nothing — CLAUDE.md's "trace PASSING results").

`getEditorSchema()` is memoised: resolving ~27 extensions is pure and its result is immutable, and
/snapshot asks once per version (116 of them). It is NOT part of a persisted signature — a program
constant, not document state.

### `nodeFromContentJson` — null, never a throw

It is the seam `TextRenderStore.get`'s `docOf: () => PMNode | null` has always been shaped for
("supplies the version's PM doc (parsed from its contentJson)") and that nothing could satisfy
until now.

Returns null on malformed content rather than throwing: a version that cannot be parsed must MISS
(the caller rebuilds/skips), never take down the snapshot route. The null is COUNTED by the caller,
never swallowed — an unparseable version that silently reads as "no pages" is precisely the house
disease.

### `schemaSpec` — why `Node.eq` cannot be used across schemas

WHY IT IS HERE AND NOT COPIED INTO EACH CHECK. Two callers compare schemas — the in-browser
`schemaIdentity.prove.mjs` (against the live editor) and the gate-kept `editorSchema.test.ts`
(against a real Editor in jsdom). Two copies of "what makes two schemas the same" is precisely how
one of them quietly starts certifying a fiction, which is the same argument that keeps ONE
extension list. So there is one description, used by both.

⚠ AND WHY IT EXISTS AT ALL: `Node.eq` CANNOT be used across schemas. PM's `hasMarkup` compares
`this.type == type` — REFERENCE equality on NodeType — so two Schema instances always compare
unequal whatever their content. An eq-based check reported `false` for an UNTOUCHED document: a
check structurally incapable of passing, which would have condemned a correct schema. Comparison
across schemas must be STRUCTURAL (type names, attr names + defaults, content/marks expressions).

Not a hand-picked subset of "fields we think matter" — that is how a check certifies its own blind
spot. It carries everything PM uses to define a type, plus the atom/inline flags the paginator's
correctness depends on.

<a id="parse-cache"></a>
### The block-level parse cache — keyed on content, never on a diff

BLOCK-LEVEL PARSE CACHE (2026-07-17).

PARSE IS THE FLOOR. With the block LAYOUT cache landed (3.5-4x, byte-identical), /snapshot's
wired cost for Peter's 116 versions is ~3.6s: ~2.6s of build and ~1.06s of PARSE. A build cache
cannot touch parse, and parse ALONE already exceeds Peter's "<1s and we can just load it when the
snapshots screen loads up". So the same lever has to reach one level down.

THE SAME THEOREM, ONE LEVEL DOWN. 98.7% of top-level blocks are byte-identical between adjacent
versions (measured, not assumed — that is the layout cache's reuse rate on the same corpus). A PM
Node is IMMUTABLE and PERSISTENT: structure sharing across documents is what ProseMirror does
natively on every transaction, and a node's doc position comes from the WALK (`doc.forEach((node,
offset))`), never from the node. So an unchanged block's parsed Node can be reused verbatim in the
next version's doc, and then its layout hits the block cache too — skipping BOTH costs.

KEYED ON CONTENT, NEVER ON A DIFF — the same reasoning as the layout cache: a wrong diff silently
reuses the wrong node (right words, wrong page, reports success); a content hash cannot. Two
independent 32-bit FNV-1a streams ⇒ an effective 64-bit key, because a collision is the only way
this can under-invalidate and under-invalidation is the direction that paints wrong words.

IT LIVES HERE, BESIDE `nodeFromContentJson`, DELIBERATELY. A second parse path in another module
is precisely the wound found THREE times today — staticPagination's stale orphan rule,
textRender's duplicate `runOf`, and textRender's paragraph branch carrying its own copy of the
layout+emit loop (which made a block cache reuse 99% of the 40% that didn't matter). One rule,
one seam. Pass no cache and this file behaves byte-identically to before.

The key is FNV-1a x2 over the block's serialized JSON: native `stringify` is far cheaper than
`fromJSON`'s Node/Fragment/Mark allocation, which is the whole point of the trade. Anything not a
plain top-level doc falls back to the ONE full-parse path rather than growing a second set of
structural rules. Eviction is bounded FIFO and COUNTED, never silent.

---

## `arithMeasure.ts` — the arithmetic canonical measure

<a id="arith-measure"></a>
### The third acquisition path, and the scope of its first version

ARITHMETIC CANONICAL MEASURE (Decision 6, 2026-07-15 — flag `inkwave:arithLayout`, default OFF).
The THIRD acquisition path for the pagination measure: instead of forcing a full-document browser
reflow (canonicalMeasure) and reading each block's line geometry with range.getClientRects,
COMPUTE the canonical lines + block boundaries from the arithmeticLayout engine (canvas advances +
greedy wrap — proven byte-identical for the certified font palette). Output is the SAME
{lines, blocks} shape collectLines produces, feeding the SAME computeBreaks — so break positions +
page-break signature are byte-identical, and the caller can SKIP forceCanonicalContext entirely
(no visible-tree reflow) on the paths where the live layout isn't already canonical (phone).

SCOPE OF THIS FIRST VERSION (conservative — correctness over coverage): the whole document must be
arithmetic-eligible TEXT PARAGRAPHS (certified uniform-size fonts, no citations / inline-math /
lists / rules / refList / headings). ANY ineligible block ⇒ return null ⇒ caller falls back to the
DOM measure. Uniform-size + leading-free means firstLineLeadingPx=0 is byte-identical (the leading
only shifts the cosmetic botMargin at a SIZE boundary, which an all-body-text doc never has). The
idle DOM verifier + pagCheck remain the safety net. Extending eligibility (headings via the
per-font leading table, block-math via a cached KaTeX box, per-region scoped use) is the follow-up.

### Inline atoms: a citation is a proven opaque box, everything else defers

INLINE ATOMS: a CITATION is a proven opaque box (CitationNodeView pins `white-space: nowrap`, so
its label has no internal break opportunity and its `normal`-mode subtree cannot reach the
parent's line breaking) — it supplies the cached canonical box harvested by the DOM measure
(citations/citeBox.ts). Anything else (inline MATH) supplies NO box, so blockEligibility's
`!r.box` gate defers the whole block — exactly the gate we want until its own rect-fix lands.
Marked citations cache under their own FONT KEY: real ones nearly always carry a
textStyle{fontFamily} mark, so skipping them would defer ~every citation-bearing block.

`basePx` joins the box lookup: the label sets in `font: inherit`, so its advance is base-dependent
(117px at canonical 18, 143px at the phone's 22.5 render base). A box harvested at a different base
MISSES ⇒ the block defers to the DOM measure rather than wrap on a width that is ~26px wrong per
citation. See citations/citeBox.ts `keyOf`.

`runsOfParagraph` is SHARED by the whole-doc path and the scoped per-block path so the two can
never drift apart.

### `arithBlockLayout` — the scoped seam, and why `relPos` is the payoff

computeScoped's whole cost is measuring the CHANGED blocks live — which is what forces the
canonical context and pays its two full-document reflows (the 400–1100ms phone pause). When every
changed block is arithmetic-eligible we can produce the SAME per-block geometry with no DOM at
all, so the scoped measure needs no forced context and no reflow. Unchanged blocks already reuse
their cached entries, so a typing pause in ordinary prose becomes pure arithmetic.

`relPos` is the payoff: the DOM path leaves each line's doc position LAZY and pays a posAtCoords
hit-test for the one line a break lands on. Arithmetically the position is exact and free —
relPos = 1 + charIndex (the block's content starts at offset+1) — so nothing is ever hit-tested.

<a id="marks-allowlist"></a>
### The mark allow-list — and the `code` mark that measured 47 pages against the editor's 79

MARKS THIS ENGINE MODELS — and marks it has PROVED it may ignore. Anything else DEFERS.

WHY AN ALLOWLIST (2026-07-18, `typematrix.prove.mjs`). `runOf` used to walk `node.marks` and act
on bold/italic/textStyle, SILENTLY IGNORING every other mark. For a metric-neutral mark that is
right by luck; for `code` it was right by nothing at all. The `code` mark renders the run in a
MONOSPACE face, and the engine measured it in the body font: MEASURED against the live editor on
a 13k-word fixture with 434 code runs — **the model said 47 pages, the editor 79, and NOT ONE of
its 79 break positions matched (first divergence at break 0, Δ955)**. It reported
`estimatedBlocks 0` and full reliability the whole time. Wrong words on every page, declared
trustworthy — the worst failure this renderer can produce.

The gate is modelled on `isCertifiedStack`, which already does exactly this for FONTS: an
allowlist, and anything outside it defers to the DOM measure rather than being guessed. The
property that matters is what happens to the NEXT mark someone adds to the schema — today it
would silently corrupt every break below it; with this it defers and says so.

METRIC_NEUTRAL is not an assumption: every family listed is PROVED byte-identical to the live
editor by typematrix.prove.mjs at ~46 breaks/fixture (underline, strike, highlight, scasSlot,
comment, insertion, deletion — decorations and colour, no advance change). If a future change
gives one of them a metric (padding, a font swap), its row goes red and this list is the first
place to look.

An unmodelled mark rides the run so `blockEligibility` can refuse the block. It is carried as a
REASON rather than acted on in `runOf`: that function's job is metrics, and inventing a metric for
a mark we have not certified is precisely the bug.

<a id="forced-breaks"></a>
### `forcedBreaks` — the RENDER pass needs them; the CANONICAL pass must not have them

`fontLoaded(stack, sizePx)` gates a text run whose face isn't loaded (measureText would fall back
to a system face). `ratio` = the render context's line-height (1.618 desktop / 1.55 phone / the
live `--inkwave-lh`). `contentWidthPx` = the CANONICAL content width (pageWidthPx − 2·sideMargin).

`forcedBreaks` — doc positions at which a line MUST start (the mid-block canonical break `at`
positions from computeBreaks). The RENDER pass needs these: a page-gap widget is display:block
inside the `<p>`, so it ends the pre-gap line partial and text resumes AFTER the gap; without it
the continuous wrap fills that slack and loses a render line, drifting every band below. The
CANONICAL pass passes none (it PRODUCES the breaks; feeding them back would be circular and its
own gaps are cleared before it measures). Absent ⇒ byte-identical to the gap-free layout.

Mid-block forced line-starts are mapped per block: doc pos → block-relative char (`pos − offset −
1`). A gap AT the block start (charOffset 0) is a no-op; a break past the content never matches.
