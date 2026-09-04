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

---

## `breakTable.ts` — the whole-document page index

<a id="break-table"></a>
### What it is, and why it replaces a bitmap cache rather than joining one

BREAK TABLE (2026-07-17) — the whole-document index, at ~8 bytes per page.

WHAT IT IS. Per version: the doc position each page STARTS at. That is all a renderer needs to be
whole-document, because a page's layout is PREFIX-INDEPENDENT (proved before this was built:
windowProof/windowCost — 30/30, 31/31, 31/31 line starts at 2k/10k/40k, mid-line negatives
collapsing to 0). A break `at` IS a line start and greedy wrap restarts deterministically there,
so the prefix is needed ONLY to FIND the break, never to draw the page.

WHY IT REPLACES A BITMAP CACHE RATHER THAN JOINING ONE. A thumbnail is a picture of one pane, at
one scrollTop, at one zoom, for one version — coverage means baking every page of every version,
and it goes stale the moment the reader scrolls somewhere new. That is the mechanism behind doc's
116/116-baked-yet-12%-real. A table has no window to fall outside of:

    171 pages x 8B = 1.4KB/version   ·   116 versions ~ 158KB   (vs 1.53MB/version = 177.8MB fat)

Cost: ONE full build per version (measured 4/16/62ms at 2k/10k/40k), once, then every page of
that version renders on demand in ~0.6ms.

STALENESS MUST FAIL LOUDLY. A table is a function of the canonical context. If that context moves
and we hydrate anyway, we paint the WRONG WORDS on the page and report success — which is exactly
what paginate()'s retired orphan rule did to us once already. So every table carries its context
SIGNATURE and a mismatch is a MISS (rebuild), never a silent reuse.

POSITIONAL RELIABILITY: pages [0, reliablePages) are trustworthy. A bibliography is force-broken
onto its own page at the END, so a whole-table boolean threw away ~57 of 58 exact pages and told
us nothing about WHERE. The table carries the boundary so a caller can render the exact pages and
fall back to the bitmap ONLY from there on.

### The context signature — zoom and DPR are deliberately absent

THE CONTEXT SIGNATURE. Everything the break positions are a function of, and nothing they aren't.

ZOOM AND DPR ARE DELIBERATELY ABSENT — canonical pagination's whole point is that breaks are
measured in a forced canonical context and are therefore device- and zoom-independent ("same text
on page N at every zoom, on phone, and in print"). That makes a table PORTABLE: baked once, valid
at any zoom, on any device, across reloads. This is a claim the codebase makes, so it is VERIFIED
by probe (zoomPortability, and panezoom.prove.mjs on BOTH engines) rather than trusted.

EVERY COMPONENT MUST BE CONTENT-DERIVED, NOT SESSION-DERIVED. A signature that embeds anything
counted since page load cannot survive the reload it exists to survive. `bibSig` replaced the
session epoch for exactly that reason — see below.

### Memory is authoritative for what it holds

MEMORY IS AUTHORITATIVE FOR WHAT IT HOLDS (fixed 2026-07-17 — the layer's first execution
caught this). `getTable` used to early-return a MISS whenever `!i.loaded`, i.e. before loadTables()
had run. But putTable() populates `tables` WITHOUT setting `loaded`, so a session that built
its own tables and then looked one up MISSED EVERY TIME — a cache that reports a full index
and never serves a single hit, silently rebuilding forever. `loaded` only ever meant "ABSENCE
is authoritative"; absence already returns null → rebuild, which is correct either way. So the
flag has no business gating a PRESENT table. Same family as the signature-blind bake counter
reporting 116/116 while every lookup missed.

A hydrated table has no LRU history — `loadTables` seeds it so the first `evict()` cannot prefer a
just-loaded table over one this session built. A corrupt index starts fresh: a table is
regenerable.

### The budget, and why eviction must be named

BUDGET + EVICTION (2026-07-17). A table is ~1.4KB, so 116 versions is ~158KB and eviction should
NEVER fire at Peter's scale — which is exactly why the budget must exist and must be REPORTED
rather than assumed: a store with no bound is one long session away from being the thing that
fills the origin's quota, and "it's only 1.4KB" is a claim about today's document. Every drop is
NAMED (`dropped`), because bounded coverage that reports as total is how "we covered everything"
becomes false without anyone noticing — the grow-only snapshot truncation, same lesson.

Counters are PER-DOC because that is the scope `tableStats()` is asked about. A global counter
answering a per-doc question is how the signature-blind bake counter reported 116/116 while every
lookup correctly missed.

At ~1.4KB a table survives reload trivially, which KILLS the cold-start penalty that has flattered
every bitmap number we have taken (a cold scrub far from the origin currently presents ~0 real
intermediates). The store's shape mirrors snapThumbs' OPFS store — one index JSON per doc — rather
than inventing a second scheme. It NEVER travels with the .studio: regenerable, local, Peter's
hard-minimise rule.

<a id="bib-signature"></a>
### `bibSignature` — the session counter that made the cache structurally incapable of a hit

THE BIBLIOGRAPHY'S CONTRIBUTION TO WRAP, AS A CONTENT SIGNATURE (2026-07-17).

WHY THIS EXISTS — and it is the single thing that made persistence possible at all. `contextSig`
used to embed `opts.bibEpoch` = `bibProvider.getVersion()`, which is a **monotonic session event
counter** (`notify()` does `this._version++`). It counts how many bibliography notifications have
fired THIS SESSION. It is not derived from content, so it does not reproduce across a reload:
measured 15 on the writing session and 2 after reload, on a byte-identical document. Every
hydrated table therefore stale-missed, ALWAYS. The layer was structurally incapable of ever
scoring a hit — it would have shipped reporting "116 tables persisted" and served ZERO lookups,
forever, while looking like a working cache. That is exactly the disease: the feature's absence
looks identical to the feature being unnecessary.

The ORIGINAL INTENT was right — a citation's box changes its wrap, so the bibliography genuinely
belongs in the signature. The INSTRUMENT was wrong: an epoch is a proxy for "something changed",
not a description of WHAT THE STATE IS, and only the latter survives a process boundary.

So: hash the entries themselves. If the CSL data and the style are byte-identical, every citation
resolves to the same in-text string, so every citation box is the same width, so the wrap is the
same. OVER-invalidation is safe here (a miss rebuilds and is counted); UNDER-invalidation is the
direction that paints wrong words — so this hashes the WHOLE entry rather than guessing which
fields a given CSL style reads.

The epoch keeps its ONE legitimate job: an in-session memo key. Hashing the library is O(entries)
and the epoch tells us for free when that work can be skipped.

The hash itself is FNV-1a over the serialized entries. Not cryptographic — this guards a
regenerable cache, and a collision costs a stale-looking hit on byte-identical-but-for-a-collision
data. Cheap and stable is what matters; the entries are sorted so Map iteration order can never
move the signature.

---

## The snapshot pane, and the rules it shares with the editor

<a id="static-pane"></a>
### `staticPagination.ts` — canonical gapped pages for static content

CANONICAL GAPPED PAGES FOR STATIC CONTENT — the snapshot view's document pane.

The live editor's PaginationExtension measures line layout inside a forced canonical context
and places gap widgets at page-break DOCUMENT POSITIONS. The snapshot doc pane renders STATIC
HTML (FullDiffView / DocView — no ProseMirror), so this module re-implements the same pipeline
against plain DOM:

1. measure line rects in the SAME forced canonical context (canonicalMeasure: mm paper width,
   desktop side margins, zoom 1, base font — plus the pane's own CSS-`zoom` wrapper forced
   to 1), inside one synchronous no-paint window;
2. compute breaks with the SAME page box (pageModel) and the SAME overflow rules as
   PaginationExtension.compute() — INCLUDING its retirement of the widow/orphan snap. That
   sentence used to say "orphan-snap rules" and this file still snapped after the editor
   stopped, which is precisely how a claim of sameness outlives the sameness. It is now
   MEASURED rather than asserted: halvesbisect.prove.mjs reads the model, the LIVE EDITOR's own
   gap widgets and this pane from ONE document and requires all three to agree.
3. insert the SAME gap elements (pageGap.ts) at the break points — recorded as text-node
   CHARACTER OFFSETS, the static analog of a ProseMirror document position, so breaks ride
   any live reflow (diff zoom, phone width, editor-zoom var) exactly like the editor's
   widgets ride theirs.

The sheet panels + aqua bands reuse the editor's CSS classes (.inkwave-gapped /
.inkwave-sheets / .inkwave-sheet / .inkwave-page-gap-band), so day/night theming and the phone
band styling apply unchanged. Ungapped mode inserts the zero-height break MARKERS instead; the
pane's PageGuides (Scroll.tsx) pick them up off 'inkwave:pagination-measured' and draw the
dashed rules — full parity with the editor's two page modes.

Break specs are cached per (snapshot, page settings, font state) as {block, charOffset} — so
scrubbing back through visited snapshots re-inserts gaps with NO canonical re-measure (zero
forced hypothetical reflows; just the insertion itself).

### The probe seam — the line list, not the breaks, and a callback rather than a buffer

PROBE SEAM (the `window.__iwPerf` contract in perflog.ts, one step up): a harness assigns
`window.__iwStaticLinesHook = (root, lines) => {…}` and this hands it the line list this pane
ACTUALLY measured. A single property check otherwise, zero cost.

WHY THE LINE LIST AND NOT THE BREAKS. The breaks are already in the DOM as `.inkwave-page-gap`
widgets and any probe can walk them — that is what halvesbisect does. But a 3.000px error in
this list only reaches those widgets when a boundary lands within 3px of the overflow cliff, so
reading the gaps measures a coincidence rather than the rule. MEASURED: with the pre-fix rule
restored, halvesbisect moves NOT ONE of 25 breaks on a lists fixture.

WHY A CALLBACK AND NOT AN ARRAY. It is invoked HERE, still inside the FORCED CANONICAL WINDOW
(paper width, side margins, zoom 1 — see the caller). These tops mean nothing in the pane's
live layout, which wraps at a different width and may carry a fit-capped CSS zoom: comparing
canonical tops against live rects is trap #8, "the verdict is unreadable off-canonical". A
buffer would hand the probe numbers it could only read after the context was restored. A hook
lets the probe's own comparison run in the coordinate system the numbers belong to — and keeps
the probe's logic in the probe.

<a id="container-rects"></a>
### A container's element children are not lines — the same bug, found twice

**MERGED ENTRY.** This story was told twice, ~33 lines each, in
`extensions/PaginationExtension.ts` (the editor's copy) and `staticPagination.ts` (the pane's).
It is one principle with two authorities, so it is one entry. Both files now carry a short rule
pointing here.

THE PRINCIPLE: a rect may only be admitted if it IS a line. `range.selectNodeContents(el)
.getClientRects()` returns, per CSSOM-View, the border box of every element the range SELECTS whose
parent it does not — i.e. the range container's own element children — and not only text-line
rects. For a `<p>` that is harmless: its element children are inline mark spans whose per-line
fragment boxes coincide with the text rects and are eaten by the 3px dedup. For a `<ul>` or a
`<blockquote>` it is not — a `<li>` box is a CONTAINER of lines.

**In the editor** (2026-07-17, the list break fix). MEASURED in the real editor
(scripts/textrender-probe/rectdiag.mjs, canonical 18px, 3-item list):

    raw rects 9 = 3 li boxes (h 58.219) + 6 text rects (h 23) — the li box at 725.188 and its own
    first text rect at 728.188, exactly 3.000 apart, so `top - lastTop <= 3` DROPS THE ITEM'S
    FIRST TEXT LINE and the li's box stands in for it.

The count survives (6 kept for 6 lines), which is why every count-based check passed — but the
SAMPLE POINT does not. collectLines samples `r.top + r.height/2`; for a text rect that is the
line's own middle, for a 58px li box it is **the middle of the ITEM** — i.e. on line 2. So the
break attributed to the item's FIRST line resolves, via posAtCoords, to the SECOND line's doc
position. MEASURED: the model breaks at 25306 (the item's line 1, which genuinely overflows —
used 951.9 + 29.1 > textArea 954.5) while the live editor's gap goes in at 25383, one line later,
so the page carries 26.5px MORE than its own text area allows and the gap's declared botMargin
(77.6) describes a page that ends 26.5px lower than it says.

The mid-line audit could not see it: 25383 IS a line start — just the wrong one. And it only
bites items of 2-ish lines: a 1-line item's box centre lands on its only line (right answer by
luck) and a 3-line item's box is 87px > the 80px cut (dropped, right answer by the old filter).

**In the pane** (2026-07-17, the pane's copy of the fix). MEASURED in the REAL /snapshot pane
(scripts/textrender-probe/panerect.mjs, DocView's own DOM, 8-chapter fixture) against the DOM's own
TEXT-NODE rects — a text node has no border box, so its rects are lines by construction and cannot
contain a container's box:

    529 shipped lines / 529 true lines — the COUNT TELESCOPES, which is why every count- and
    height-based check in this file passed — and **24 of them sit exactly 3.000px too high**:
    UL 8 · OL 8 · BLOCKQUOTE 8. The first `<ul>`'s raw rects, verbatim:
      relTop 0     h 58.219   ← the `<li>`'s BORDER BOX (a 2-line item), admitted as a line
      relTop 3     h 23       ← the item's OWN first text rect — DELETED by `top - lastTop <= 3`
      relTop 32.109 h 23      ← the item's second line
      relTop 62.718 h 87.328  ← a 3-line item's box: over the 80px cut, dropped — right by luck

The 3.000px is the half-leading: (lineHeight 29.109 − text 23) / 2 = 3.05. It is not a list
constant, which is why `<blockquote>`'s `<p>` box does the identical thing.

THE 80px CUT WAS THE ONLY THING STANDING HERE, AND IT IS A COINCIDENCE, NOT A RULE. It admits a
container box of ≤80px and drops one over it, so whether this pane paginates correctly depended
on how many lines an item happened to wrap to: a 2-line `<li>` (58.219px) broke it, a 3-line one
(87.328px) did not. The old comment on that line — "skip tall boxes (nested element border-boxes,
not text lines)" — NAMED this exact class while the constant let the short half of it through.

**TWO AUTHORITIES, ONE RULE.** PaginationExtension asks ProseMirror (`child.isTextblock`) what a
textblock is. The pane HAS NO PM TREE — DocView and FullDiffView render plain DOM — so it asks the
other authority that is actually present: the LAYOUT ENGINE, via `getComputedStyle().display`.
Never a tag name and never a CSS class: either would silently miss the next container the schema
grows, which is the whole reason this bug reached three copies. An element with no block-level
element child IS a textblock and takes the byte-identical single `selectNodeContents` call it
always did — which is what keeps every prose document's breaks bit-for-bit unchanged
(breaks.prove.mjs: [2403,4856,7205,9476,…], identical).

An EMPTY computed display means the element has no resolved box at all (an unrendered subtree —
and jsdom, whose UA stylesheet sets no `display` on `<em>`/`<span>`/`<code>`). Treat it as inline:
something with no box cannot be a container whose box is mistaken for a line, and the only
alternative — descending into it — would fabricate structure the engine says is absent. This is
also what lets the jsdom gate exercise the REAL predicate.

An EMPTY textblock (a blank list item, a blank paragraph inside a blockquote) has no text rect but
still occupies a line. Without the fallback it would vanish from the line list and every break
below it would shift — a missing block is not a smaller block.

The inline run case (text between block-level children, an anonymous block box) cannot arise in
DocView, which wraps every block node in an element — but "it cannot arise today" is exactly the
reasoning that let this rule rot in three copies, and an anonymous block box has no element to ask,
so its lines would simply be LOST rather than mismeasured.

Downstream, `keepLineRects` applies `isLineRect`/`sameLine` (lineRects.ts) — the SAME predicate in
ONE place instead of two. The pane used to carry its own copy of `w < 1 || h < 1 || h > 80 * s ||
top - lastTop <= 3`, its own `80` and its own `3`, under a comment claiming they were "the same
80px filter as the editor" — and the container-box bug then had to be found and fixed twice, once
per copy. `keepLineRects` is extracted verbatim from collectLines so a test exercises the REAL
filter rather than a copy of it: a comparison where both sides run through the same stale copy
cancels its own error. breaks.prove.mjs is the live control on that restatement.

### The live known-negative — because this bug is invisible to a rate

THE LIVE KNOWN-NEGATIVE (the `__iwOpenGuard` / `__iwTabDocRule` / `__iwReadGuard` contract).
`window.__iwStaticLineRule = 'range'` restores the PRE-FIX rule verbatim — ONE
`selectNodeContents` over the whole block, container boxes and all.

IT EXISTS BECAUSE THIS BUG IS INVISIBLE TO A RATE. The artifact is a 3.000px error on a ~29px
line grid, so it moves a page break only when a boundary happens to land within 3px of the
overflow cliff. MEASURED: with the bug fully restored, `halvesbisect` on a 6k-word / 25-break
lists fixture still prints "OFFSETS IDENTICAL" — not one break moves. A probe that waited for a
break to move would therefore certify this bug as fixed while it sat there, which is exactly
what the pre-existing `+ lists` row did for as long as it existed.

So `panerect.mjs` measures the ARTIFACT instead — every line's top, against the DOM's own
text-node rects — and this seam is what lets it prove, against the REAL production path and in
ONE build, that it can still SEE the bug. A negative that cannot fire is not a negative.

<a id="three-copies"></a>
### The break rule exists in three copies — and the orphan snap drifted in two of them

**MERGED ENTRY.** The same incident was written out three times: in `staticPagination.ts` (19
lines), in `arithmeticLayout.ts`'s `paginate()` header (24 lines) and in
`PaginationExtension.ts`'s `_computeBreaksForTest` seam (12 lines). One incident, one entry.

THE ORPHAN SNAP IS GONE — because it is gone in the editor (2026-07-17).

There are three copies of the break rule: `PaginationExtension.computeBreaks` (the original — the
editor's own rule and the definition of canonical pagination), `arithmeticLayout.paginate`, and
`staticPagination.computeBreakPicks`. When production retired the widow/orphan snap
(`const snap = false`, PaginationExtension: "a straddling paragraph is broken at the overflow line
wherever it falls"), `paginate()`'s default was corrected and THE PANE'S COPY WAS MISSED — while
the comment above it claimed "identical policy (and 0.22 constant) to the editor" and that file's
header claimed "the SAME overflow / orphan-snap rules as PaginationExtension.compute()". Both were
false, and the claim is exactly why nobody looked.

MEASURED (halvesbisect.prove.mjs, three corners from ONE document — the canvas model, the LIVE
EDITOR's own gap widgets, and this pane): the pane was +2 pages on a 25-page document, on PLAIN
PROSE — no lists, no citations, no refList. canvas === EDITOR on every shape, so the pane was the
outlier. Snapping pushes a small orphan onto the next page, which the editor stopped doing, so
/snapshot had shown page numbers the editor disagreed with since staticPagination was written
(2026-07-10) — the minimap's and the diff panel's included.

Canonical pagination's whole claim is "the same text on page N at every zoom, on phone, and in
print". A pane that mirrors the editor may not carry a rule the editor retired.

`blockIdx` is all the block tracking the pane's rule needs now: `blockStartUsed`/`blockFirstLine`
existed ONLY to feed the orphan snap, and typecheck flagged them the moment it went — which is its
own small confirmation that the snap was the only thing reading them.

**In `arithmeticLayout.paginate`** the same drift was found + fixed 2026-07-16 by the textRender
pixel diff. It snapped small orphans (≤22% of the text area) to the block start; a consumer taking
the old default got DIFFERENT PAGES than the editor renders — measured on a 4k-word doc: first
break at 2141 vs the live 2403, 17 pages vs 16. THE DEFAULT NOW MATCHES PRODUCTION
(`snapOrphans = false`); anything wanting the retired rule must opt IN. Rationale for flipping
rather than preserving the old default: that function's ONLY job is to model computeBreaks — a
"compatible" default that models a deleted rule is not compatibility, it is a bug every caller
inherits. Blast radius checked before flipping: NOTHING in production calls `paginate()`
(PaginationExtension owns computeBreaks and imports only `makeCanvasMeasure` from there;
arithMeasure doesn't import it) — the callers are this repo's prover and tests.

WHY NO PROVER CAUGHT IT: the prover runs arith-sourced lines AND DOM-sourced lines through THE
SAME function, so a stale rule cancels on both sides and byte-identity still passes. The splitter
is a shared constant in that comparison, and a shared constant is invisible to it — the divergence
only becomes observable against the LIVE editor's own gap widgets
(scripts/textrender-probe/breaks.prove.mjs). Same shape as the `canvasShapingMatchesEditor`
lesson: a check that cannot see a class of error reports success anyway.

AND THE UNIT TESTS WERE STRUCTURALLY BLIND TO IT: arithmeticLayout.test.ts gives every line its own
block with `blocks[i].start === lines[i].pos`, so snapping to the block start yields the IDENTICAL
number and the assertions pass under both rules. A test can only see a rule it varies.

THE TEST SEAMS (2026-07-18 — F19). `PaginationExtension._computeBreaksForTest` exports THE
original: the editor's own break rule, and until then the ONE copy of three that no test could
reach. The other two each mirror it, each was pinned against its OWN fixture, and each passed while
the pane ran +2 pages for a week — because self-consistency is what the disease preserves. `sig`
is already the shared vocabulary: `paginate` emits the same `at:round(botMargin)|…|pages:N` string
"so a prover can compare" (its own header). The seam was designed and never used. Exporting it
changes no behaviour — the function is untouched and the live path still calls it directly — and it
costs nothing, because PaginationExtension imports cleanly under vitest's node env (PROBED, not
assumed: the module was imported in-process and its exports enumerated; the browser dependency is
in the VIEW, not the module).

`staticPagination._computeBreakPicksForTest` is the same move for the pane: the function is PURE —
lines in, picks out, no DOM — so the rule it carries can be pinned in the GATE in milliseconds
instead of only by a hand-run browser probe. That distinction is not academic: the orphan snap
survived here for a week after the editor retired it, with every suite green, because its only
possible witness was a browser comparison nobody ran. A proof that ran once is not a guard.

<a id="band-geometry"></a>
### Band geometry — derive the content extent in ONE layout pass

**MERGED ENTRY.** The same rule and the same measurement are written in both
`staticPagination.ts` and `PaginationExtension.ts`'s `readBands`.

SINGLE-PASS content height (round-4, Peter: "zoom is slow now"): the old read hid the panel layer
+ cleared minHeight to take `sheet.scrollHeight` — a SECOND forced full layout on every paint pass,
cache miss and atomic exit. Same rule staticPagination already proved (2026-07-12 swipe round):
derive the content extent from the IN-FLOW children's rects in the SAME layout pass as the band
reads. In the pane that was roughly half of every band repaint's cost on a thesis-sized doc
(probed 2026-07-11); content bottom = the editor root's rect bottom + the sheet's own bottom
padding.

⚠ Every ABSOLUTELY-positioned child must be skipped, not just the sheet layer: they are inset:0
overlays (the panel layer AND `.iw-page-guides`) that STRETCH to the sheet's minHeight, so reading
their bottom folds our own full-final-page minHeight straight back into `total` → a per-paint +padB
RATCHET (last panel grows every zoom cycle; bug 2026-07-15). Only the real in-flow content (the
.ProseMirror wrapper) may set the extent, so minHeight can never enter a rect read — the old
ratchet fixpoints stay impossible by construction. The panels are absolutely positioned and
minHeight never moves the ROOT, so this equals the old hidden-layer scrollHeight by construction:
the "never retracts" fixpoint and the minHeight ratchet both only ever inflated scrollHeight, never
the root's bottom.

PHASE PROBES (zero cost unless a harness defines `window.__iwPerf`). They are what turned "zoom is
slow" into a fix: `zoom-rbFirstRect` reads 0.0ms, which is the load-bearing fact — the layout is
ALREADY clean there (Scroll.tsx forced it for its anchor read), so `zoom-rbBandLoop`'s cost is not
layout but the per-gap display lock. See the `.inkwave-page-gap` content-visibility exemption in
index.css.

FULL FINAL PAGE (MS-Word style, Peter 2026-07-10): a barely-filled last page still paints as a
whole sheet. Full height = the average of the previous ≤5 page regions in this SAME geometry —
derived from the geometry alone, so step-cache hits reproduce it exactly, and it is correct under
font zoom / phone reflow where the canonical pageH wouldn't match the live layout. Single-page docs
fall back to the canonical pageH.
