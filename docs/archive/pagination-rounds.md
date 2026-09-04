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

---

## `arithmeticLayout.ts` — the engine's body

The engine's own design, its eligibility table and the reason it must not graduate are under
[#arith-engine](#arith-engine) above. This section holds the body's rounds.

<a id="fonts-certified"></a>
### The certified palette — a retirement, and the Inter retraction

ROUND-10 (2026-07-16) — all 18 shipped families verified on BOTH Chromium and WebKit, in the
editor's real context, and (the load-bearing bit) their Chromium DOM wrap == their WebKit DOM wrap
byte-for-byte at the canonical width. Hinting was equalised for that comparison: Chromium's default
Linux fontconfig quantises advances to whole px while WebKit uses fractional, which manufactures
false divergences (`--font-render-hinting=none` removes it; real devices use subpixel).

RETIRED 2026-07-16: Lora + Gelasio — dropped from the PICKER, but their faces are STILL SERVED
(fetch-fonts keeps them): deleting the woff2 would drop legacy marks down their own stacks to
Cambria/Georgia SYSTEM fonts, whose metrics vary by device — silently repaginating old docs
phone-vs-print. Unlisted in `CERTIFIED_FAMILIES` regardless: nobody new can select them, and they
never went through the round-10 cross-engine pass, so the engine must DEFER rather than compute
their wrap.

INTER + OPTICAL SIZING — the correction (2026-07-16). An earlier pass EXCLUDED Inter for a
cross-engine DOM wrap divergence (Δ −12.55px @18px). That was real for the font THAT HARNESS
FETCHED — which requested Inter's OPTICAL SIZE axis (`Inter:ital,opsz,wght@…`). The shipped
fetch-fonts.mjs never requests opsz (it asks `ital,wght@` only), so the font we actually serve
carries NO opsz axis and was never affected: re-measured, Inter's Chromium DOM wrap == its
WebKit DOM wrap byte-for-byte ([0,61,128,196,263,327]) under BOTH font-optical-sizing values,
and it certifies on both engines. Added.

The `:root { font-optical-sizing: none }` policy (index.css) STAYS regardless: measured a
no-op for all 18 shipped faces, and it is the standing guard against any future opsz font —
the hazard is genuine (Chromium resolves opsz from font-size, WebKit does not), it simply
isn't one our current fetch pipeline can produce. NB canvas has no font-optical-sizing
property, so an opsz font ALSO breaks canvas↔DOM parity once the DOM is pinned — an opsz
face is unusable by this engine from both directions. Don't ship one.

Certification is by PRIMARY family: the stack `'EB Garamond', Georgia, serif` is eligible because
EB Garamond loads and is certified; the Georgia/serif tail only matters if the primary fails to
load, in which case `document.fonts.check` is false and the gate defers.

<a id="inline-atom-rect"></a>
### Inline atoms collapse to one rect — the mid-line break fix

**MERGED ENTRY.** The same fix is explained in `arithmeticLayout.ts` (the math-pill note, 22 lines
plus its `mathEligible` rider) and in `PaginationExtension.ts`'s `collectLines` header (~19 lines of
its 54). One fix, one entry.

INLINE-ATOM NODEVIEWS COLLAPSE TO ONE RECT (2026-07-17 — the mid-line break fix).

`range.selectNodeContents(block).getClientRects()` DESCENDS INTO NodeView subtrees, so an inline
atom's internal boxes each contribute their own rect. The citation NodeView's ⤵ biblink button is
`display:inline-flex` at a ~6px offset from the text line — MORE than the 3px same-line dedup
tolerance — so it survived the filter as a PHANTOM LINE. Its sample point sits MID-LINE, and a
break attributed to it opens a page gap in the middle of a rendered line: measured 6 of 55 live
breaks (~11%) on thesis-shaped citation prose → 0 (scripts/textrender-probe/midline.prove.mjs),
and this is what Peter reported as "space left on the last line" when paragraphs split. Inline
math has the identical artifact (KaTeX sub/superscript + fraction spans): per-block phantom lines
measured citations +29 / math +30 → 0 (linecount.prove.mjs — the mid-line RATE cannot see math,
which is rare enough that no break happened to land on one).

THE PRINCIPLE: an inline ATOM has no internal break opportunity — the parent line can only break
AROUND it (CitationNodeView pins white-space:nowrap; MathInlineView is an inline-grid) — so it
must contribute EXACTLY ONE rect: its own bounding box. PM decides what an atom is
(`isInline && isAtom`); never a CSS class, which would silently miss a future NodeView.
A block with NO inline atoms takes the byte-identical old path by construction — that is what
keeps plain/headings/lists breaks bit-for-bit unchanged (they were already exact).
SCOPE: inline atoms only. A TOP-LEVEL atom (refList, block math) is `atomLike` and keeps its
deliberate pseudo-block-per-line treatment — a different rule, unchanged.

The engine's own half of the story, from `LINE_STABILITY_EPS`:

An inline math pill is an ATOMIC one-line unit: whatever its formula, inline KaTeX renders in
TEXTSTYLE, so the pill is a stable box (~34px @18px base — fixed, formula-independent; even a
`\frac` or `\sum` stays compact) that simply makes ITS line taller. That's fine for the arithmetic
path (the line takes the pill's demand). The one catch was the DOM VERIFIER: collectLines reads
line tops via range.getClientRects, and KaTeX's internal sub/superscript and fraction spans emit
rects BELOW the baseline that the 3px dedup split into spurious extra lines — so the verifier
OVER-counted a math paragraph's lines (a pre-existing inaccuracy, independent of this engine).

COLLECTLINES CO-REQUISITE — ✅ LANDED 2026-07-17 (fix/collectlines-nodeview). MEASURED, not
assumed — linecount.prove.mjs counts every block's lines three ways (truth / old rect path /
collapsed path) on the REAL app: math pills over-counted 23 blocks (+30 phantom lines, e.g. a
7-line paragraph read as 9) and citations 24 blocks (+29); both go to ZERO with the collapse,
while the no-NodeView controls were exact on both paths.

STILL GATED, DELIBERATELY. The source comment as it stood read: *"`mathEligible` remains FALSE at
its call site (arithMeasure.ts). This co-requisite is satisfied, so flipping it is now unblocked —
but that hands math paragraphs to the arithmetic engine, which is a separate behaviour change and
needs its own end-to-end proof (isolate.prove.mjs has no math case yet). Do not flip it as a side
effect of something else."* ⚠ VERIFY BEFORE QUOTING THAT SENTENCE: `buildArithMeasure`'s
`mathEligible` parameter DEFAULTS false, but the three call sites in `PaginationExtension.ts` pass
`true` explicitly (they are all behind default-OFF flags — `?arithLayout`, `?arithBands`,
`?renderFill` — so nothing a writer sees is affected). The rule that survives is the imperative
one: flipping it is a separate behaviour change and needs its own end-to-end proof.

`LINE_STABILITY_EPS` still guards the MIXED-SIZE TEXT case (a genuine instability with no such fix
— differently-sized text rects reorder unfixably). The engine's CAPABILITY is unconditional: it
computes math paragraphs correctly either way; the flag only decides whether to trust the DOM
verifier over them yet.

<a id="mixed-family"></a>
### Mixed family vs the strut is DOM-only — and why we defer rather than correct

── MIXED FAMILY vs THE STRUT is DOM-ONLY too (2026-07-17) ──

A line box is not `ratio × size`. It spans from the highest inline-box top to the lowest
bottom over the STRUT (the block element's own font) AND every inline box on the line, each
centring its own (ascent + descent) content area in its own line-height. So a run in a face
whose BASELINE sits differently from the strut's makes the line TALLER — while the wrap, and
therefore every self-consistency check built from it, stays perfect.

MEASURED in the real editor (strut = EB Garamond, 18px, φ; a span per family inside the real
.ProseMirror; scripts/textrender-probe/strutrule.mjs), line gap vs the model's 29.109375:

    EB Garamond / bold / italic  29.109375  (+0)   ← the strut's own face: the known-negative
    Crimson Pro                  30.109375  (+1)
    Atkinson Hyperlegible        30.109375  (+1)   Bitter, Carlito, Cormorant: +1
    Spectral, Gelasio            30.109375  (+1)
    IM Fell DW Pica              31.109375  (+2)   ← the app's OWN identity serif is the worst

At ~44 lines/page a +1px line is ~1.5 lines of drift per page. This is what made
`mark textStyle:fontFamily` diverge Δ+76 at the FIRST break while claiming full reliability.

WHY WE DEFER RATHER THAN CORRECT IT. The correction is exactly
`max(strutTop, runTop) + max(strutBot, runBot)`, which needs each face's ascent/descent. The
ONLY metrics canvas exposes are `fontBoundingBoxAscent/Descent`, and Chromium returns them
ROUNDED TO WHOLE PIXELS: EB Garamond and JetBrains Mono BOTH report 18/5 though they are
different faces. Fed those, the formula above mispredicts 6 of 16 measured cases by exactly
0.5px per line (Crimson Pro: predicts +0.5, the DOM does +1.0) — ~22px, three quarters of a
line, over one page: enough to move a break. The real ascent/descent live in the font file and
in Blink's layout, not in any API this renderer can reach; /snapshot has no `.ProseMirror` to
harvest them from either (ROUND 14). So the height is not computable here, and a height we
cannot compute is one we do not invent — the same answer `mixed-size` and `blockStyle()` give.

THE PATH BACK TO COVERAGE, measured and left deliberately unbuilt: `(ascent − descent)` is what
decides growth (Gentium Plus has a+d = 27 vs the strut's 23 and does NOT grow — its a−d matches),
and the ROUNDED a−d agreed with the DOM on all 16 cases, over-deferring none. That is an
empirical claim over one palette on one engine, and rounding can hide a sub-pixel difference in
the UNDER-deferring direction — the one that paints wrong words. It needs a certification sweep
of every shipped family on both engines, the same way the fonts themselves were certified.

MIXED FONT-SIZE among TEXT runs is DOM-ONLY for the neighbouring reason: a taller text run's rect
top diverges >3px, and unlike a math pill there is NO single-rect fix (the size change is intrinsic
to the text run) — the verifier is unfixably order-dependent, so it defers.

<a id="shaping-gate"></a>
### The shaping gate — an empirical probe, not a capability sniff

**MERGED ENTRY.** The gate's design is in `arithmeticLayout.ts` (19 lines) and its canvas
configuration in `makeCanvasMeasure` (14); the wire-in's own probe-span trap is in
`PaginationExtension.ts` (10). One mechanism, one entry.

── ENGINE SHAPING GATE (2026-07-16 — rev 2, after the ligature-strip result) ──

The engine may only run where CANVAS SHAPES TEXT THE WAY THE EDITOR RENDERS IT. The editor
renders with ligatures OFF (.ProseMirror { font-variant-ligatures: none }); canvas applies them
by default and its only lever, ctx.textRendering, is Chromium/Firefox-only — **Safari has never
shipped it, on any version, desktop or iOS**. So an API check said "never on any iPhone".

THAT IS NO LONGER THE RIGHT QUESTION. The ligature tables in the faces we self-host are dead
weight for document text (CSS already disables them), so we strip liga/clig/dlig/hlig/calt out
of the served woff2 (scripts/fontStrip.mjs). MEASURED, all 18 families, real .ProseMirror:

    • production measure == DOM on BOTH engines: 18/18 (WebKit Δ ≤ 0.0001, controls up to Δ27.5)
    • DOM rendering unchanged by the strip: 18/18 at GLYPH level (per-char x positions) + wrap
    • cross-engine DOM↔DOM on stripped faces: all 18 identical    • byte cost: +0.7KB (+0.01%)

With no ligatures in the file, canvas has nothing to apply and matches the editor WITHOUT the API
— i.e. on every iPhone. (The ZWNJ workaround was also measured, and FAILS: WebKit's canvas does
not honour U+200C. Stripping the font is the only lever that works there.)

So the gate is now EMPIRICAL, not a capability sniff: probe whether canvas actually agrees with
the DOM for this font, once, and cache it. It is correct in every combination — API or not,
stripped or not — and it self-corrects the moment the pipeline ships stripped faces.
`canvasCanMatchEditorShaping()` (does this engine expose `ctx.textRendering`?) is NOT the gate —
`makeCanvasMeasure` uses it opportunistically and it is worth logging, but a false there no longer
means "cannot run".

### The canvas configuration — match the editor's shaping or every ligature is a wrap error

MATCH THE EDITOR'S SHAPING, or every ligature is a wrap error (2026-07-15). ProseMirror's
injected sheet sets `.ProseMirror { font-variant-ligatures: none; font-feature-settings:
"liga" 0 }` — the editor renders f+i SEPARATELY. Canvas measureText applies ligatures by
DEFAULT, so it measured "first"/"office"/"affluent" 2-5px NARROWER than the editor renders
them: the engine took a word the browser dropped, on any line with an fi/fl/ffi.
MEASURED (delta canvas − DOM-inside-.ProseMirror, EB Garamond 18px):

    default / optimizeLegibility → −2 … −5 on every ligature string (0 on ligature-free text)
    textRendering 'optimizeSpeed' + fontKerning 'normal' → 0.000 on ALL strings
    geometricPrecision → fractional drift; ZWNJ-injection also 0.000 but mangles the text

`optimizeSpeed` disables ligatures; `fontKerning:'normal'` pins KERNING ON explicitly (the editor
keeps kerning — its sheet only disables liga), so we never rely on optimizeSpeed's implied
kerning behaviour. NB this was also a GAP IN THE ROUND-7 FONT CERTIFICATION: r7/r8 measured
canvas vs a PLAIN span (ligatures on BOTH sides), so their Δ≤0.05px parity did not cover the
editor's liga-off shaping.

### The wire-in's probe span — a self-check that measured in a fiction

THE EMPIRICAL SHAPING GATE runs once per editor, cached. `canvasShapingMatchesEditor` must
measure its probe inside the REAL .ProseMirror — that is where the ligature state lives (the
injected PM sheet sets `font-variant-ligatures:none`), and a plain-div harness certifies a fiction
the editor never uses.

The probe span had BOTH halves wrong. The `font:` SHORTHAND resets font-variant-ligatures to
`normal` — so a probe span set from it renders WITH ligatures even inside .ProseMirror, whose
injected sheet sets them off. That measured the editor's own shaping context as a fiction and the
gate always failed. Re-assert the editor's real shaping longhands AFTER the shorthand (later
declarations win) so the span shapes exactly as the body text.

`content-visibility:visible` is LOAD-BEARING: the probe is a direct child of .ProseMirror, so
during the zoom-live window the `> *` rule gives it `content-visibility:auto` — and parked
off-screen it is SKIPPED, so its contents never lay out and the rect comes back a fraction of the
true width (measured: 177px vs the real 1186px). The gate then always failed and the exit fell
back.

The span is removed SYNCHRONOUSLY: PM never sees a transaction, so its observer never rebuilds.

<a id="white-space"></a>
### White-space mode — whether a line's trailing space hangs

── WHITE-SPACE MODE: whether a line's trailing space HANGS ──

This is not a detail — it decides the fit test, and it bit hard (2026-07-15). ProseMirror's own
stylesheet (prosemirror-view/style/prosemirror.css, injected by @tiptap/core) sets:

    .ProseMirror { white-space: pre-wrap; white-space: break-spaces; }

so the live editor computes `break-spaces`. Per CSS Text 3, break-spaces is pre-wrap EXCEPT that
"any preserved white space that would otherwise hang instead takes up space and can be broken
after" — i.e. THE TRAILING SPACE NEVER HANGS; it occupies width and counts toward the fit.
MEASURED (1/64px sweep, "AAA BBB CCC", EB Garamond 18px, bare=73.0 full=77.0):

    normal        → BBB first fits at w=72.98  (≈bare)  → HANGS
    pre-wrap      → BBB first fits at w=72.98  (≈bare)  → HANGS
    break-spaces  → BBB first fits at w=76.98  (≈full)  → NO HANG

Consequence: the PRODUCTION fit test is the FULL token width (space included). A `normal`-mode
harness silently takes a word the real editor drops — which is exactly how a plain-`<div>` prover
certified a wrap the editor never produces.

MIXED MODES DEFER. The editor is NOT globally break-spaces: the same injected PM sheet flips it
per SUBTREE —

    .ProseMirror [contenteditable="false"]                            { white-space: normal; }
    .ProseMirror [contenteditable="false"] [contenteditable="true"]   { white-space: pre-wrap; }

— i.e. every NodeView/atom subtree (citations, math, gap widgets) hangs while the body text around
it does not. A citation NodeView is `display:inline`, so its label text FLOWS IN THE PARENT'S LINE
in `normal` mode: a citation-bearing paragraph is genuinely MIXED-mode. The wire-in must read this
per run (getComputedStyle on the run's element); mixed ⇒ DEFER. A text run in a different mode than
the block wraps by a DIFFERENT rule (hang vs no-hang) on the SAME line — and `normal` additionally
COLLAPSES runs of spaces, which this engine does not model. Both are unmodelled.

This is the guard that keeps a future citation-eligible paragraph honest: a `normal` citation
subtree inside break-spaces body text can only go arithmetic once the atom is a proven opaque box,
never by guessing. Only the editor's own mode is proven end-to-end (break-spaces); anything else
defers rather than trust an unproven rule.

<a id="lu-grid"></a>
### The LayoutUnit grid — quantise, and floor

The browser's USED line-box height: the CSS line-height (ratio × font-size) does NOT render at its
exact float — it is laid out on the LayoutUnit grid (1/64 px), FLOORED. Empirically (prover
`_probe`): 18px φ → 1863/64 = 29.109375 (not 29.124); 24px φ → 2485/64 = 38.828125. Reproducing
this exactly is what makes the arithmetic `used`/botMargin byte-identical to the DOM measure — the
naive ratio×size drifts ~1px over a page and flips the gap-widget height. `fontSizePx` is itself
snapped to the grid first (round), matching how the browser stores the computed size.

THE FIT TEST TOO (2026-07-16). The browser lays text out on the same grid, and a line FITS the
container when its grid-quantised width does — NOT its exact float width. WHY IT MATTERS at the
RENDER font (22.5px phone, and 1.037em → 23.3325px): canvas measureText returns a raw float sum
that runs ~0.01px WIDER than the browser's grid-accumulated width over a line — negligible at the
canonical 18px (never reached a break boundary; the 18px cert was 23/23) but at the larger render
size it flips a boundary word (measured: blk11 "…substrate of linguistic " canvas 360.6984 vs box
360.6875 — floor(360.6984·64)/64 = 360.6875 = box ⇒ FITS, matching the DOM; the raw float said
overflow ⇒ arith broke one word early ⇒ the render band drifted N·renderLH). Quantising reconciles
it AND the AAA-BBB white-space case (full width ≈ grid boundary). floor, not round: the browser
truncates in LayoutUnit arithmetic (measured: width:360.7px → getBoundingClientRect 360.6875 =
floor(360.7·64)/64).

HYPHEN-MINUS (U+002D) is a soft-break opportunity AFTER the hyphen (the browser breaks
"constructed-language" → "constructed-" / "language"; the hyphen stays on the first line and
counts toward its width). End the token AFTER the hyphen when it sits between two
alphanumerics — an INTRA-WORD hyphen — so numeric ranges ("3-4") and leading/trailing dashes
don't get a spurious break. Only reachable within a run; a hyphen exactly at a run boundary
(mark change) keeps its token glued (rare — real compounds carry one mark). This is what the
RENDER font (22.5px) exposed: a hyphenated compound the browser split but the engine kept
whole wrapped as one unit → one extra line → the render band drifted by a line height.

An inline ATOM GLUES to adjacent non-space text in the same token (CSS offers no break opportunity
between an inline-block and neighbouring non-space text), so "x²" (atom) directly followed by "+1"
(text) never breaks between them.

<a id="leading"></a>
### `firstLineLeadingPx` — a constant that cancels, except across a size boundary

OPTIONAL first-line baseline LEADING (px). collectLines reads line tops via range.getClientRects,
which returns the TEXT rect (baseline-positioned) — offset below the line-box top by a
per-(size, base-strut) constant (EB Garamond @18px base: 16px→5, 18px→3, 18.666px→2, 24px→3). This
is a pure constant per block, so it cancels in INTRA-block line deltas; it only affects the
CROSS-block advance where adjacent blocks differ in size — i.e. the gap-widget botMargin at a size
change. Supplying it (from a one-time per-certified-font calibration table, measured once like the
font certification itself) makes the FULL signature byte-identical; omitting it (0) still yields
byte-identical break POSITIONS + page count, only the cosmetic botMargin drifting ≤3px at size
boundaries. Break positions — the load-bearing cross-device invariant — never depend on it.

<a id="element-box-sources"></a>
### Element box sources — the extension point, and the discipline it fixes

── Element box SOURCES: how each measurable type produces its reflow-free box ──

The wire-in obtains an element's box from its type. This registry is the extension point — a new
measurable atom becomes a one-function plug-in, never a rewrite of the wrap/pagination core.

TEXT (inline, computed) — handled inside `tokenize()`: advance = measureText, demand =
`snappedLineHeight(fontSizePx)`. No provider needed.

MATH (inline + block, CACHED ONE-TIME MEASURE) — the wire-in keeps a cache keyed by a STABLE
content key and fills a miss with ONE measure off the node's already-rendered KaTeX geometry
(no reflow of anything else; math renders synchronously and is immutable per node):

    inline: key = `${latex}|${fontSizePx}` → InlineBox {
      advanceWidth      = the pill's border-box width  (KaTeX box@0.826em + 6+4 padding + 2 border),
      lineHeightDemand  = the line-box height the pill produces when set inline with text.
    }  A miss measures the live node once (getBoundingClientRect on the pill + a one-line probe for
       the demand) and caches it; the box is invalidated only if the latex changes (⇒ a new key).
    block:  key = `${latex}|${align}` → BlockBox {
      height = the rendered .katex-display height + the block's 0.4em×2 padding (min 1.8em),
      marginTop/Bottom = 0.5em (× the block base font).
    }

The engine never re-measures on a normal pagination — it reads the cached box. This is the same
"measure once, cache by an immutable key" discipline as the font-certification table.

FIGURE / IMAGE (block, COMPUTED from attrs) — see `figureBlockBox()`. A figure's box is a PURE
function of its specified/intrinsic dimensions + its caption's wrapped height + margins — no
measure at all. Height honours a CSS `max-width:100%` shrink: a figure wider than the column scales
down, keeping aspect ratio (the common editor rule). No figure node exists in the schema yet
(StarterKit + Math + Citation + ReferenceList only) — so this is the documented extension point,
ready to wire when one lands.

THE DISCIPLINE that stays fixed for ANY new type: (1) the box must come from computation or a
one-time measure cached by an immutable key — never a per-pagination reflow; (2) an INLINE box
must clear the LINE_STABILITY_EPS fit check or the block defers (the DOM verifier would miscount
its line); (3) if a type's geometry is NOT stable (a citation label reflows on bibliography
hydration / style switch; a mixed-size text line's rects reorder), it DEFERS — the idle DOM
measure remains the verifier, and pagCheck catches any divergence within the re-verify window.

`resolveBlocks` handles three arithmetic shapes — paragraphs (wrap), block atoms (one region of
`blockBox.height`), and empty paragraphs; everything else defers. Only TEXT runs gate on fonts;
atoms carry their own already-measured box. Structural ineligibility keeps its own reason
(`block:hr`, `inline-atom`, `mixed-size`, `uncertified:…`); only an ELIGIBLE block whose faces
haven't loaded is `fonts-unloaded`. Sibling margins collapse adjacent (max, not sum).

<a id="font-loaded"></a>
### `makeFontLoaded` — `document.fonts.check()` lies, and the check lives here

REAL font-loaded check. `document.fonts.check()` returns TRUE for a family with NO @font-face (the
system fallback counts) — that trap silently measures a fallback against itself and "agrees" at
0.000. So compare the family's advance against the monospace fallback's: a family that measures
IDENTICALLY to `monospace` for a proportional probe string is not really loaded.

LIVES HERE, NOT IN A CALLER (2026-07-17). It was private to textRenderProbe.ts, and /snapshot's
break-table build needs the same check — an editor-less route cannot borrow the editor's. Copying
it would put two definitions of "is this font loaded" in the tree, and the SECOND one is always
the one that quietly stops agreeing (the pmToText/textMap lesson). One implementation, two callers.

---

## `PaginationExtension.ts` — the live editor's measure

<a id="canonical-measure"></a>
### True canonical pagination — the forced context, and why the measure is loop-free

Page-break measurement for BOTH page modes. A ProseMirror plugin that measures the document's
real line layout and places a widget at each page boundary (breaks land at line starts, so a
line is never cut):

    gapped   → a full-bleed "page gap" widget — content reflows onto separate parchment sheets,
               with the sheet panels + page numbers painted behind the text.
    ungapped → an invisible zero-size break MARKER at the SAME measured positions — the Scroll
               PageGuides draw the dashed rule + page number at it, and the print stylesheet
               breaks the page there.

One shared break model → toggling the gapped switch never moves content across pages, and screen
breaks = print/PDF breaks in both modes.

Page height comes from pageModel (physical mm through the canonical 96dpi px), NOT from
sheet.clientWidth — clientWidth's integer rounding flips with browser zoom / DPR, which made
the pagination browser-zoom-dependent (see pageModel.ts).

TRUE CANONICAL PAGINATION (2026-07): the geometry above fixed the page HEIGHT, but lines were
still measured against the LIVE layout — editor font-zoom reflowed different words onto each
page, and phones measured at their own narrow width. Now every measure runs inside a forced
CANONICAL CONTEXT (canonicalMeasure.ts): mm paper width, desktop side margins, zoom 1, base
font — so breaks are document positions identical at every zoom, on phone and desktop, and in
print. The live layout only affects rendering.

Measurement is loop-free: block positions are read as INTRINSIC (the gap-widget heights are
subtracted back out), so adding gaps never changes the measured layout. A signature guard stops
the recompute→dispatch→recompute cycle once nothing changes.

### The forced context, in full

CANONICAL MEASUREMENT CONTEXT — the breaks must be the SAME document positions at every editor
zoom and on every device (phone = desktop = print). So the measure runs in ONE forced canonical
layout: true mm paper width (overrides the phone's fluid width), desktop print side margins (phone
renders a slim 1.25rem), `--iw-editor-zoom` 1 (defeats Ctrl+wheel AND phone pinch) and the 1.125rem
base font inline (defeats the phone ×1.25 boost — see .ProseMirror in index.css). Live zoom / device
width then affect RENDERING only: the widgets ride their document positions through any reflow, so
pinch-zoom grows/shrinks pages without moving words across them. Set → measure → restore is all
synchronous inside one rAF, extending the existing no-paint window (getClientRects forces layout,
not paint); cost: 2 extra full-document reflows per measure, which is fine because measures are
debounced (150ms after edits / zoom-settle / settings) — never per-keystroke.

Fluid 'scroll' paper keeps its RENDERED width (its pages are a ratio of that width by design — no
mm identity), but the FONT context must still be canonical: skipping the force entirely there
measured the live zoomed font, so on scroll paper the words per page changed with the editor zoom
at measure time — the "different amount of text per page depending on how zoomed in you are"
regression (2026-07-09). Passing no paper/sheet keeps width + margins live; zoom/magnify/font are
still pinned.

The gap widgets are display:block, so they FORCE line breaks — which means a word can't wrap back
across a page boundary, and measuring the line layout with them present shows the forced break, not
the natural wrap (so deletions never reflowed back). Fix: clear the gaps first so the DOM reflows to
its NATURAL wrapping, measure THAT, then re-add the gaps — the cleared state never paints (same
window).

The canonical context forces `--iw-magnify` to 1 on BOTH paths (fluid included) — the transform is
scale(var(--iw-magnify)), so inside this window the DOM is genuinely unscaled and rects come back in
layout px. `scale = 1` there is therefore CORRECT; do NOT wire the live `magnify.getMagnify()` in,
which describes the DOM OUTSIDE this window. collectLines keeps its scale param for any future
out-of-window measure.

Only update the decoration set when gap positions actually changed (sig differs). When sig is the
same, restore the PREVIOUS set (not the freshly-computed one) to avoid propagating sub-pixel
rounding differences in botMargin — the main cause of page-height flicker on typing near a gap.
Both sets are semantically equivalent; using the stable cached one prevents the gap widget height
from jittering by ±1px on every keystroke.

**Decision 6 (arithmetic acquisition, flag `inkwave:arithLayout`).** When the whole doc is
arithmetic-eligible text, compute lines+blocks reflow-free and SKIP forceCanonicalContext (+ both
its full-document reflows) — the phone per-pause reflow win. Gated to `!canonicalIsLive` (phone /
zoomed): desktop-at-defaults already skips the reflow, so there's nothing to win and the DOM path
stays authoritative. ANY ineligible block ⇒ `buildArithMeasure` returns null ⇒ the DOM path runs.
The lazy full DOM re-verify + pagCheck are the safety net; meta stays null (the next scoped measure
bails to full, which is this cheap arith path again).

**Decision 1 (render-fill phone splits, flag `inkwave:renderFill`).** Peter: "abandon perfect
pagination for the better look." On the LIVE PHONE editor ONLY, compute mid-paragraph splits at the
RENDER width (via the arithmetic engine) instead of canonical A4, so the last line before a split
FILLS (kills the ~50%-empty last line). This DIVERGES from canonical — so it is gated to the live
phone editor and NEVER touches print/export/verify/snapshot (those force the canonical measure via
measure-now → forceFullOnce, which this path skips). Phone page numbers then differ from print — an
accepted consequence. Zoom-independent (read at the live content width, font base 18 — like
canonical, only the WIDTH differs). Any ineligible block ⇒ null ⇒ falls through to the canonical
paths.

DEFAULT OFF (2026-07-15): `renderFill` was reverted from default-on. The fill rides the SAME arith
greedy wrap that diverged from the browser's real wrap on eligible prose — a split 2 words off the
render would spill the "filled" last line, so the fill must wait on the wrap root-cause too. (It
also shares the whole-doc eligibility gate, so it never engaged on a citation-heavy doc anyway.)

DEFAULT OFF for `arithLayout` (2026-07-15): reverted from default-on for a deterministic wrap
divergence from the DOM canonical measure on REAL eligible prose (~1 break in 20 — arith fit ~2 more
words on a borderline line). ⚠ THAT RATIONALE IS NOW STALE: the LU-quantisation wrap fix (88ebf39)
landed the DAY AFTER this revert and addresses exactly that class. RE-MEASURED 2026-07-18
(arith.prove.mjs, the real wired whole-doc arith path, `__iwPagArith` confirmed engaged):
BYTE-IDENTICAL to the DOM canonical measure across 4k/6k/8k-word fully-eligible prose incl.
hyphenated compounds (15/23/31 breaks, 0 divergences). So the wrap root-cause appeared CLOSED on
Chromium. STILL OFF, and the remaining blocker was honest: canonical breaks are a CROSS-DEVICE
invariant and arith.prove.mjs is Chromium-only — graduation needs a WebKit pass on Peter's device
class (the same bar the font certification carries) + a scoped-arith (desktop typing) A/B. DO NOT
flip the default on the Chromium proof alone. **And see [#arith-engine](#arith-engine): those "0
divergences" are themselves stale now.**

<a id="collect-lines"></a>
### `collectLines` — intrinsic tops, lazy positions, and the per-block line cache

Collect every LINE as { intrinsic top, LAZY doc position } — so a page break can land
mid-paragraph (a gap widget at a line-start splits the paragraph in two). "Intrinsic" = the layout
AS IF no gap widgets existed: each line's top has the total height of all gap widgets ABOVE it (by
screen Y) subtracted. Subtracting by Y — not by walking top-level children — is what makes this
correct even when a gap renders NESTED inside a paragraph (a mid-paragraph break); otherwise that
gap's height is missed and the measured page heights drift/oscillate. Intrinsic tops are invariant
to the gaps, so the pagination is a stable fixpoint.

`scale` = the current transform-magnify on the parchment (hybrid zoom). getBoundingClientRect
returns VISUAL (scaled) coordinates, but pageH is derived from clientWidth which the transform
DOESN'T scale — so divide all measured distances by `scale` to bring lines into the parchment's own
(unscaled) coords. Height-only gap heights (set in unscaled px) also render scaled, so accumAbove is
scaled too → the single division keeps everything consistent. scale=1 (no magnify / reflow zone) is
a no-op.

LAZY POSITIONS (2026-07-11, the typing-lag ablation): the old collector called view.posAtCoords
for EVERY line — ~4,400 browser hit-tests on a 100-page doc, the bulk of the 2.4s (4× throttle)
measure freeze. Only ~1 line per PAGE ever needs its position (the line a break lands on), so
each line now carries the coords the old call used and resolves its pos on demand (identical
posAtCoords formula ⇒ identical break positions). Block identity/boundaries — needed per line
for orphan snapping — come from ONE view.posAtDOM per top-level block instead of per-line
doc.resolve. Everything downstream (snap rule, refList forcing, sig strings) is unchanged.

PER-BLOCK LINE CACHE (2026-07-11, the desktop "waves of lag" — merged with lazy positions):
the per-line range.getClientRects walk over EVERY block was 1.5-4s of forced-layout reads on a
20k-word doc (4×-throttled probe) at every 150ms desktop typing pause. PM docs are persistent
structures: an untouched block keeps its NODE IDENTITY across edits, and inside the forced
canonical context (fixed width/margins/font/zoom) the same node renders the same line geometry
— so each block's line geometry is cached RELATIVE to its own rect, keyed by the node object.
An edit re-measures only the block(s) whose identity changed; every other block costs one
getBoundingClientRect. Positions stay LAZY on both paths: a cache entry starts with relPos NaN
and posOf writes each resolution back BLOCK-RELATIVE, so a break line pays its one hit-test at
most once per node identity — future measures rebuild it by offset arithmetic alone.

THE CACHE'S THREE INVARIANTS. The caller owns the WeakMap and REPLACES it whenever the canonical
context itself changes (fonts ready/loadingdone, page settings, bibliography label hydration). No
cache is passed for fluid 'scroll' paper — its canonical width IS the live width. And cache entries
are only written/read on the gap-free measure (compute clears the widgets first), so gap subtraction
can never bake into a cached top.

Citation boxes are keyed by citekeys+style+bib-epoch — which covers a hydration or a style switch —
but NOT a change to the canonical CONTEXT itself (fonts finish loading, page settings/paper change):
the same label then renders at a different width under the same key. So the boxes die exactly where
the line cache does (`clearLineCache` clears both, and `incState` with them).

ATOM BLOCKS: the OLD per-line resolve gave every line inside an atom its own degenerate block
(posAtCoords at an atom returns its boundary → the {p, p+1} fallback), so the orphan baseline reset
per line. That is replicated with one pseudo-block PER LINE — the snap/orphan decisions (and hence
the sig) stay byte-identical around tall atoms.

<a id="citation-harvest"></a>
### The citation opaque-box harvest — the one place a canonical citation width exists

CITATION OPAQUE-BOX HARVEST (2026-07-16): the DOM measure is the ONE place a citation's CANONICAL
rendered width exists — we are inside the forced canonical context, the layout is already flushed
for the line collection, so each box costs one getBoundingClientRect and no reflow. The arith path
can never measure this itself (it skips the force by design), so it reads these cached boxes; an
un-harvested key defers that block back here, which harvests it. See citations/citeBox.ts.

basePx 18 = the canonical base we are forced to here (CANONICAL_FONT_SIZE 1.125rem), and the base
these boxes are keyed under. A RENDER-base measure asks for its own base, misses, and defers —
never wraps on a canonical-width citation (117px vs 143px at the phone's 22.5px).

The harvest is wrapped in try/catch: it must never break a measure.

<a id="zoom-snap"></a>
### A canonical line start is not a rendered line start at any other zoom

⚠ A CANONICAL LINE START IS NOT A RENDERED LINE START AT ANY OTHER ZOOM — and that is the whole
of Peter's "lines cutting at arbitrary points when you go over the page" (2026-08-28).

Breaks are CANONICAL by design: measured at zoom 1 in a forced context so the same words land on
page N on every device and in print. The rendered layout at another font zoom wraps SOMEWHERE
ELSE, so a break placed at a canonical line start lands in the MIDDLE of a rendered line — and
the gap widget is `display:block`, so it slices that line and leaves a fragment ("an") alone at
the bottom of the page. MEASURED, and it is not marginal:

    editor zoom 1.00 → 0/10 mid-line breaks     1.08 → 7/10     1.26 → 9/10     0.86 → 10/10

i.e. every zoom except exactly 1 cuts almost every page. midline.prove.mjs reported 0/194 clean
for a year because it runs at defaults — the fixtures were canonical, so the bug was structurally
invisible to them.

A BLOCK BOUNDARY IS A LINE START IN EVERY LAYOUT, at any zoom, by construction — no measurement
required. So when the rendering is not canonical the break snaps to the block boundary instead of
splitting mid-paragraph: the page is a little less full, and no line is ever cut. At canonical
rendering (the default desktop view, and every print/PDF path) NOTHING changes — the mid-block
split Peter chose in 2026-07-15 ("probably split") is exactly as it was, byte for byte.

The `snap` machinery this uses is the pre-2026-07-15 widow/orphan path, still present and still
correct (`brokeUsed`, `used = orphan`); only its trigger changed.

TWO CONDITIONS BEYOND "the rendering is not canonical", and both are load-bearing:

* `orphan > 0` — the block must have STARTED on this page. With orphan 0 the block begins at
  this very line, so blockStart IS the break and snapping is a no-op.
* `blockStart > lastBreakAt` — never snap back to a position we already broke at. A block TALLER
  than a page would otherwise be pushed whole, overflow again on the next page, and snap to the
  same boundary forever. It is pushed once, then split mid-block (one cut line, not a loop).

`shouldSnapToBlock` is pure and exported because the whole fix is one predicate and a browser probe
that ran once is not a guard.

⚠ `liveIsCanonical` is set by the measure BEFORE it enters the forced context — inside that window
the DOM is canonical by construction, so `canonicalIsLive` cannot be asked there and would answer
about the wrong layout.

ALWAYS SPLIT mid-block so the page fills (Decision 5, Peter 2026-07-15: "probably split"). The
widow/orphan snap is gone: a straddling paragraph is broken at the overflow line wherever it falls,
accepting the occasional lone 1-line orphan/widow (softened by the render-fill + the dotted
continuation bracket). `orphan` is still tracked for the sig/used accounting. History: flat ≤22%
pushed every straddler whole → wasted page bottoms; fa11bf0 split only when both sides kept ≥2
lines; Peter now wants the fuller look outright.

Decision 1's dotted continuation bracket is INDEPENDENT of renderFill (2026-07-15): it marks a
MID-PARAGRAPH split — semantically true at canonical breaks too (Decision 5 splits every straddler
mid-block) — and carries zero measure risk, so it renders whatever the measure path.

`ignoreSelection` on the gap widget: it is a TALL block widget, and without it ProseMirror folds its
height into cursor/selection mapping, so a click at the page-above end jumps the caret past the gap.

The reference list always starts on a fresh page (position from `findRefListPos`). It is an atom the
paginator can't split internally, so this at least guarantees a clean start (Peter's call). The test
is block-level: a line is at/after the refList exactly when its block starts at/after refListPos.

<a id="scoped-measure"></a>
### The scoped canonical measure — exact near the writer, deferred far away

── SCOPED CANONICAL MEASURE (2026-07-12, round-6 — Peter's redesign spec) ──

Round-5's measurement-host clones could not replicate NodeView-rendered content exactly (a
cloned `<math-field>` loses its shadow DOM; citation labels are React output; atom-interior DOM
positions map wrongly), and one bad lazily-baked position poisons every later measure. Peter's
verdict: EXACT behaviour near the writer is non-negotiable — approximate nothing locally, defer
distance instead. So the scoped measure runs in the REAL forced canonical context (the same
context the full measure uses — real DOM, real NodeViews, real posAtCoords), but with the
live-reflow window (.iw-zoom-live: content-visibility on off-screen blocks) so the forced
layout renders ~only the region around the edit instead of the whole document:

* unchanged blocks reuse their cached block-relative lines at the previous measure's tops
  (bit-identical above the edit; one telescoped delta below) — that data itself came from
  earlier REAL canonical measures, never from clones;
* changed blocks are measured LIVE inside the window (scrolled into the canonical viewport so
  content-visibility renders them fully);
* gap widgets inside/adjacent to the changed region are cleared by a REGION-SCOPED decoration
  dispatch (natural wrapping, exactly like the full measure's whole-set clear);
* any break line whose doc position isn't baked yet resolves via the SAME view.posAtCoords
  sample the full path uses (its block scrolled into the window first) — exact by identity.

A full measure still runs LAZILY after every scoped one (idle-scheduled, input-gated): it
re-verifies everything quietly (sig-guard = no visible change when the scoped result was right)
and refreshes the incremental base. And it runs SYNCHRONOUSLY before print (the hard floor —
the beforeprint/measure-now wiring). FALLBACK IS THE RULE: non-paragraph blocks in or beside the
changed region, refLists there, pure end-appends, unrendered blocks, failed resolutions, >24 changed
blocks — the full measure answers instead.

`canonicalIsLive`: the live layout IS the canonical layout whenever nothing canonical-relevant is
overridden — desktop (no phone width/font rules), editor zoom 1, magnify 1 (mm paper width + desktop
side margins are the live defaults, both read from the same settings the canonical force uses). Then
forceCanonicalContext would be a byte-level no-op — skip it and save BOTH full-document reflows (the
force's first read and the restore's live relayout).

⚠ NO CONTENT-VISIBILITY WINDOW IN THE SCOPED MEASURE (round-6 storms): cv-rendered blocks measure
subtly differently — ~9px advance drift even on plain paragraphs, worse around citation nodeviews.
EXACTNESS RULES: the scoped measure runs in the plain forced canonical context. The reflow cost is
skipped entirely whenever the live context already IS canonical (desktop at default zoom/magnify),
which is the common desktop case; elsewhere (phone) the reflows are the price of correctness and the
savings come from region-scoped reads + baked positions.

ROUND-7 (Peter: "paras should split over pages even if they render 0.2s late; the cursor line moves
instantly"): where the full measure is CHEAP (desktop at defaults — canonicalIsLive skips both
reflows), re-verify FAST (450ms) so any deferred mid-paragraph split lands ~0.5s after the pause,
not 2.5s. Phone keeps the long fuse (2500ms — its full measure costs real time).

`'inkwave:pagCheck=1'` runs BOTH the scoped and full paths per measure and compares signatures; the
full result is authoritative either way. The scoped path publishes `__iwPagSig` too, because it
RETURNS EARLY — without that a probe reading `__iwPagSig` sees the last FULL measure's (pre-edit)
sig and compares two different doc states.

`window.__iwPagInc.reasons` counts scoped-bail causes for on-device diagnosis.

### ARITH FIRST — and why the arith branch was unreachable

── ARITH FIRST (2026-07-16) ──

The arithmetic path is the CHEAPEST acquisition (no reflow at all), so it must be tried BEFORE the
scoped measure — not after. It used to live in the FULL path only, which meant it ran on the FIRST
measure and never again: the first DOM measure sets incState, every later measure then took the
SCOPED branch, and the arith branch was unreachable. That is fatal now that citation boxes WARM UP
(they are harvested BY a DOM measure), because the one measure arith ever got was the one before any
box existed — it deferred, and nothing ever re-tried. Trying arith first makes the warm-up
self-healing: measure 1 defers + harvests, measure 2 is arithmetic.

On success incState is cleared: the incremental base belongs to the DOM regime, and a later arith
FAILURE should re-establish it with one full measure rather than build a scoped delta on a base the
arith era never maintained.

── SCOPED ARITH — the cheapest acquisition there is ──

Only the CHANGED blocks are laid out (arithmetically, ~0.1ms each); everything else reuses its
cached entry at telescoped tops. No forced context, no reflow, no DOM read at all — which is the
whole point: the DOM scoped path's cost IS its forced canonical context (two full-document reflows
on phone, 400–1100ms). Whole-doc arith still re-lays every block each pause; this re-lays only what
the writer just touched. It runs BEFORE whole-doc arith, and unlike that path it PRESERVES incState
(it maintains the incremental base exactly as the DOM scoped path does), so consecutive typing
pauses keep hitting it instead of collapsing back to a full measure.

Decision 1's render-fill on phone always takes the FULL path (the render-width arith measure) so
breaks never flip between the canonical scoped measure and the render-width full one — the scoped
path is a canonical regime, incompatible there.

<a id="arith-bands"></a>
### Arith band geometry — the zoom-exit that never un-skips the document

── ARITH BAND GEOMETRY (Job 2, flag `inkwave:arithBands`) ──

The pinch exit un-skips the whole document (drops .iw-zoom-live) and forces ONE full-document
relayout to re-pin the anchor — O(doc), measured 240/722/2688ms at 5k/20k/40k words. With the
arithmetic engine the band geometry AND every block's render height are computable with NO layout
read, so the exit can keep the content-visibility window ON (with EXACT per-block reservations)
and lay out only what's on screen. Gated: the whole doc must be arith-eligible AND canvas shaping
must empirically match the editor — otherwise computeArithBands returns null and the caller falls
back to the un-skip, which is always correct.

Compute BandGeo REFLOW-FREE, so the zoom-exit never un-skips the whole document (the
240/722/1642ms@5k/20k/40k spike). The bands sit at the CANONICAL break positions (which don't move
with zoom) but at RENDER pixel tops (which do). Two cheap arith passes, no DOM read: (1) a CANONICAL
measure reproduces the exact break set + each gap's botMargin (byte-identical to the DOM canonical
measure — proven); (2) a RENDER-zoom measure gives each break line's render pixel top. The gap
WIDGETS are FIXED px (baked at canonical measure — botMargin+GAP+topM), so they don't scale: the
rendered top of break k is its render line top + the fixed gap heights ABOVE it. Returns null (⇒
caller falls back to the DOM readBands/un-skip) when any block defers or the faces aren't loaded.

⚠ THE LIVE RENDER WRAP CONTEXT IS THE PARAGRAPH'S OWN CONTENT BOX, NOT `clientWidth`. clientWidth is
INTEGER-rounded and disagrees with the true floored fractional content box ~6/88 times at 22.5px
(box 316.578 → clientWidth 317, +0.42px too generous → fits one word too many, one line short, and
the per-page error compounds). Floor to the 1/64px LayoutUnit grid the browser stores used lengths
on. ONE helper (`renderWrapCtx`) feeds both the arith band geometry AND the render-fill measure so
they can never drift — the bug the arith agent found in the live renderFill path.

The canonical break positions are fed back into the RENDER pass as FORCED line-ends: a mid-paragraph
page gap is a display:block widget that ends the pre-gap line partial, so the render wrap MUST break
there too — else it fills that slack and loses a render line, drifting every band below.

The zoom-exit itself: Scroll.tsx's gesture exit asks US for the geometry before it decides how to
land. If we answer, the bands are applied in THIS task (atomic with the caller's anchor re-pin) and
the caller keeps content-visibility ON using our exact per-block heights — so it never un-skips, and
the exit costs O(visible) instead of O(doc). No answer ⇒ it falls back to the un-skip + readBands,
which is always correct. Every refusal is NAMED in `d.why` (flag-off / not-gapped / other-surface /
shaping / arith-null).

<a id="step-cache"></a>
### The predictive step cache — atomicity beats freeze, and the between-notch warm

── PREDICTIVE STEP CACHE (Peter, 2026-07-09: "the pages wait until the scrolling is finished to
change") ──

Zoom levels live on the shared zoomStep lattice, and the CANONICAL breaks don't move with zoom — so
per step only the band GEOMETRY differs, and ONE hypothetical-reflow measure per step is the whole
cost. While idle, the whole lattice is precomputed nearest-first (one step per frame, aborting on
any activity); when a gesture commits a step (the 'inkwave:zoom-step' event Scroll dispatches
synchronously with the zoom var), the cached geometry is applied IMMEDIATELY as pure style writes
that batch into the same reflow as the font change — the pages track the zoom live. A cache MISS
reads the bands LIVE in the same task instead (one extra synchronous reflow that frame): leaving the
panels pinned at stale geometry while the text reflowed made the gap visually collapse and let text
paint out over the water (Peter, 2026-07-10) — bands and text must land in the SAME frame, cached or
not. The settle's verify paint still snaps everything atomically at the end (a no-op when the cache
was accurate).

TWO CACHES, AND THEY MUST NOT MIX. Band geometry read under the live-reflow window's placeholder
heights (.iw-zoom-live content-visibility) is a DIFFERENT geometry regime: it must never leak into
`stepCache` (placeholder-squashed panels replayed at rest) and stepCache's full-layout geometry must
never apply mid-gesture. Routing mid-gesture steps to `liveCache` keeps a within-gesture step
RETRACE pure style writes.

── ATOMIC TEXT+BAND through reflow zoom (round-6, Peter: "Zooming should change text and page
atomically … the gapped page arbitrarily joining up or the text flowing over the water") ──

The round-5 FREEZE (bands held while text reflowed) regressed exactly this: a page's rendered height
changes NON-uniformly with zoom (font-reflow rewraps → discrete lines-per-page jumps, which no
smooth (z/z0)² factor can track), so a frozen band no longer matched its page — the gap collapsed or
text overran the sheet onto the water. Peter's ruling: ATOMICITY BEATS FREEZE. So the bands are
re-derived in the SAME task as every reflow step — the original round-3/4 contract. Correctness
guarantee: the VISIBLE page bands are read from the live DOM, where content-visibility renders
on-screen blocks EXACTLY (only off-screen — invisible — pages sit at placeholder heights), so what
the eye sees is pixel-matched to the reflowed text every frame.

── THE BETWEEN-NOTCH WARM — what actually makes a notch cheap (2026-08-30) ──

MEASURED (`pnpm prove:zoomcost`, 13k words / 325 blocks / 55 gaps): a notch's commit is ~110ms, of
which the reflow+anchor is ~33 and the step event ~78 — and 98% of that 78 is `readBands()`, i.e.
the MISS path, on 11 of 12 notches. The idle precompute is not broken and it does not help: it fills
`stepCache`, while a live gesture reads `liveCache`, because the placeholder regime is a different
geometry regime and mixing them is forbidden. So during a gesture every step measured the bands
synchronously, on the input path.

TWO WRONG THEORIES WERE MEASURED AND DISCARDED FIRST, and they are why the fix is scheduling rather
than a cheaper read: (1) deriving the band from its gap's rect + the band's own inline top/height
matched to 0.0000px across 55 bands and was NOT faster (1.08×); (2) exempting the gap widgets from
the live window's content-visibility did nothing either. A standalone diagnostic then settled it:
repeating the identical band loop immediately after itself costs 0.2ms. The 78ms is ONE forced
layout that the anchor read did not cover — not 55 per-element unlocks — so no read is cheaper, and
the only lever left is WHEN it happens.

A zoom gesture is monotonic and a real wheel leaves 150–260ms between notches, so the next step is
nearly always ±1 in the same direction and there is idle time to measure it in. This warms exactly
that one step, in the PLACEHOLDER REGIME (so it lands in liveCache, never stepCache — the separation
is untouched), strictly BETWEEN notches:

* armed on a committed step, and CANCELLED by the next one, so a fast trackpad stream (~16ms apart)
  never fires it — at that cadence there is no idle to spend and the warm would compete with the
  gesture, which is the one thing the idle precompute exists to avoid. It also skips outright once
  the observed cadence is faster than the warm can finish in.
* a MISS stays exactly as correct as before: it measures live in the same task. This only makes the
  miss rarer, never the answer different.

The SCHEDULING RULE itself lives in `editor/zoomWarm.ts` as a pure function, because a browser probe
is not a guard: warming too eagerly puts the measure back on the input path, warming never restores
the old cost, and neither shows up as a wrong pixel. `LIVE_WARM_DELAY_MS = 45` is > a trackpad's
~16ms cadence, so a fast stream cancels it.

A live warm must also move `--iw-cis-scale` — Scroll.tsx recomputes it per commit as (z/z0)², and
the placeholder heights it drives are part of this regime's geometry. Reading the bands at the next
step's zoom WITHOUT it would cache geometry no commit will ever reproduce. And the conditions are
re-checked AT FIRE TIME, not at schedule time: 45ms is long enough for the gesture to have ended,
the live window to have come down, or another step to have landed, and a warm under any of those
caches geometry no commit will ever reproduce.

ARM THE NEXT STEP'S WARM from the PREVIOUS committed step where there is one, else from the
gesture's own start zoom (z0) — the first notch of a gesture is exactly the one a writer notices, so
it must not be the one that cannot predict. A step seen a second ago is this gesture's previous
notch (and catches a mid-gesture reversal); anything older belongs to a finished gesture and must
not be trusted as "where we came from".

THE AUDIT (probe-only, `window.__iwWarmAudit = true`): is a cached entry the same geometry a live
measure would have produced at this instant? A cache that is fast and WRONG is the regression this
whole subsystem exists to prevent, so the question has to be askable rather than argued about.

RESYNC: the zoom guard (Scroll.tsx) can detect a content-visibility relevancy wave between commits —
the layout shifted, so every placeholder-regime entry is stale. Drop them and re-derive the bands
from the CURRENT layout in the same task.

### Idle precompute, the zoom-scoped window, and the early warm

Idle precompute: one step per frame, nearest-first from the current step until the WHOLE lattice is
warm (it's only ~18 steps — a fast gesture can cross any window, and a miss now costs a synchronous
mid-gesture reflow, so warm everything). Each measure is the canonicalMeasure trick on the LIVE zoom
var: force `--iw-editor-zoom` to the step's lattice value, read the band rects + content height,
restore — all inside one task, so the hypothetical layout never paints. Strictly desktop + genuinely
idle: never during a gesture (`__iwZoomHold`), never in a typing pause (the edit debounce is the
typing signal), never on phone, never while hidden.

GENUINELY idle only (2026-07-11, "Chrome still a bit slow opening a document"): each precompute step
is a full-document hypothetical reflow (~100ms+ of layout on a long doc), and the warm-up used to
start 350ms after the mount's first measure — ~18 consecutive long frames landing exactly while the
reveal chain, the wave coast and the writer's first scrolls run (profiled: the post-open longtask
churn). Any input or load-choreography activity now pushes the warm-up back; a zoom during the cold
window stays CORRECT — onZoomStep measures a miss live in the same task.

`lastInputAt` is kept alongside `quietUntil` rather than derived from it: `quietUntil` is a POLICY (a
1500ms hold tuned for the full-lattice sweep), and the early warm needs the underlying FACT so it can
apply its own, much shorter hold.

CANCEL the zoom-scoped warm on any input (round-4, Peter: "scrolling is jittery"): each warm step is
a full-document hypothetical reflow — running them under a scroll/keystroke is exactly the jank Peter
felt. The 150ms grace exempts the settle's OWN scroll events (the atomic exit's correction fires
'scroll' right after zoomCb opens the window); anything later is a real user input.

ZOOM-SCOPED WARM WINDOW (round-3, Peter: "build/refresh the step cache only on zoom-zone entry /
first step / idle after settle — never on the typing path"): the genuine-idle gate's activity events
include 'wheel'/'scroll', so a zoom session kept pushing its own warm-up out 1.5s forever — the cache
was measured COLD through whole gestures (0 precomputed). A zoom SETTLE opens this window: inside it
the quietUntil input gate is bypassed (typing/edit debounce + the gesture hold still block) and the
warm is RADIUS-LIMITED to the steps around the current one — the next notches' exit/settle frames
hit, without the full-lattice reflow burst on every settle. The full lattice still warms at genuine
idle, exactly as before.

EARLY WARM (2026-08-20, Peter: "are we warm loading the first few levels of zoom in and out… it
feels slow coz its lagging, not the actual distance"). The full-lattice precompute is correctly gated
behind `preBusy()`'s `quietUntil` — and EVERY reveal-chain event (open-begin / reveal-imminent /
editor-revealed) bumps that gate by another 3000ms, so the FULL warm genuinely cannot start until
several seconds after the page is already visible and interactive. A writer who opens a document and
reaches for zoom immediately — an entirely ordinary thing to do — hits a stone-cold cache: the first
notch is a synchronous, full-document hypothetical reflow measured live (onZoomStep's miss path),
which is exactly what reads as "laggy" rather than "needs more finger travel" — the two are easy to
conflate from the outside, which is why TRACKPAD_ZOOM_SENSITIVITY/FIRST_STEP_BONUS alone couldn't
fully fix the feel.

This does NOT touch quietUntil or preBusy — it is a SEPARATE warm fired once, a short beat after the
editor is actually revealed, so it lands well before the full-lattice gate would even consider
starting. It still defers behind a genuine gesture/edit in progress (never the reveal-chain's own 3s
hold) — it only skips the PART of preBusy that exists to protect the reveal's OWN visual settling
from a much bigger full-lattice sweep. Its own busy check uses 250ms, deliberately much shorter than
the full-lattice precompute's 1500ms `quietUntil` bump: that gate is tuned to keep a ~20-step sweep
away from the reveal choreography entirely, whereas this warm needs to resume promptly between a
writer's interactions to be ready before their next zoom.

WHOLE LATTICE, nearest-first (2026-08-20, round 2 — Peter: "goes like three zooms then stops then
another three. so maybe we need to warm load more"). This was radius 2 (five steps: k0, k0±1, k0±2),
and that symptom is precisely what a five-step cache produces: the first few notches present
instantly off the warm cache, then the gesture walks off its edge into cold steps that each cost a
synchronous full-document hypothetical reflow (onZoomStep's miss path), stalls, and only recovers
once the post-settle zoom window (ZOOM_WARM_RADIUS, also 5) warms the next few — hence "another
three". The lattice is only ~20 steps end to end, so warming all of it removes the cliff entirely
rather than moving it a few notches further out. Cost is bounded and paced: one hypothetical reflow
per frame, each deferred by the busy check, so it yields to the writer throughout and never lands a
burst on the reveal choreography.

A hypothetical layout can be SHORTER than the live one → the browser would clamp the scroll; save
and restore it exactly (the same pattern as the canonical measure window).

### The zoom settle

Re-measure ONCE when the editor font-zoom settles (see Scroll.tsx). Breaks are now measured in the
canonical context, so this recomputes IDENTICAL document positions (the stable-set guard makes the
dispatch a no-op) — but it still drives the paint() pass that repositions the sheet panels/bands
against the REFLOWED live text, which IS zoom-dependent. Scroll.tsx re-anchors the viewport around
it (pagination-measured).

BOTH PLATFORMS defer everything heavy off the settle (round-4, Peter: "text reflow should be no
slower than before; pages painted instantly from the math"): canonical breaks cannot move with zoom
by construction, and the ATOMIC EXIT already applied full-regime band geometry in the exit task — so
the settle needs NO immediate measure and NO immediate paint. The full verify re-measure runs at
genuine idle (scheduleIdleFull — input-gated, cancelled by any activity), and the zoom-scoped
step-cache warm runs in the same quiet gaps (cancelled on input; desktop only — precompute never
runs on phone). The gesture being over also makes every placeholder-regime `liveCache` entry stale
for the next gesture.

<a id="measure-scheduling"></a>
### Scheduling — input priority, the ResizeObserver, and doc identity

INPUT PRIORITY: edit-driven re-measures are debounced OFF the keystroke. recompute forces a
full-document layout read (clientWidth + getClientRects per block) and dispatches two meta
transactions — per keystroke that was the single biggest stutter source (and worst on backspace,
where line heights shrink). The existing gap decorations are position-mapped through each edit in
apply(), so the gaps ride along correctly while we wait; the breaks re-settle 150ms after typing
pauses. Resize/fonts/settings still re-measure immediately.

PHONE (2026-07-09, "character input is priority #1 — reflow can wait"): each measure is THREE forced
full-document reflows (gap-clear → canonical-context force → measure → restore) — cheap on desktop,
~100-300ms of layout on a phone CPU with a long doc. At 150ms it landed in ordinary inter-word typing
pauses, freezing the next keystroke. So edit-driven re-measures on phone wait for a GENUINE pause:
850ms after the last transaction, stretched to 1200ms while the on-screen keyboard is up
(TiptapEditor mirrors it to `window.__iwKeyboardUp` — reflowing mid-composition is worthless).
Trailing debounce: every further keystroke pushes a queued measure back. Desktop stays 150ms, and
the FIRST measure (the pagination-ready reveal latch) is `schedule()`d directly — untouched.

THE RESIZE OBSERVER MUST FOLD INTO THE EDIT DEBOUNCE (both platforms since 2026-07-11). A keystroke
that adds/removes a LINE resizes the sheet, so this observer fired one frame after the edit and — doc
size changed ⇒ fresh inputSig — ran the full multi-reflow measure IMMEDIATELY, bypassing the edit
debounce entirely (CLAUDE.md pagination rule (b); the desktop path had crept back to immediate and
every line-wrapping keystroke paid a full canonical measure the very next frame — the ablation's
biggest desktop longtask source). A resize arriving while an edit's re-measure is pending folds into
that debounce (pushes it back); genuine resizes (rotate, keyboard, panel dock — no edit pending)
still measure straight away.

ZOOM-GESTURE HOLD (the page-boundary flicker fix): every font-zoom frame resizes the sheet, so this
observer re-ran per frame — recompute early-returns on the unchanged inputSig but still
schedulePaint()s, repositioning the gapped panels/bands 1–2 frames BEHIND the reflowing text: the
sheet edge visibly oscillated up/down at the zoom target. Scroll.tsx raises `__iwZoomHold` for the
whole gesture (cleared just before it dispatches zoom-settled), so the panels stay pinned during the
gesture and the settle re-measure repaints them once, cleanly, against the settled layout.

ONLY RE-MEASURE WHEN THE CANONICAL LAYOUT CHANGED — the `inputSig` guard (doc size, page height, top
margin). Our own setMeta dispatches don't change these, so they can't loop. Window/sheet resizes no
longer re-measure at all (canonical breaks don't depend on the rendered width) — the RO-scheduled
pass lands here and early-returns, just repositioning the gapped panels. NB: editor font-zoom is
deliberately NOT in this signature (canonical breaks don't depend on it either). Re-measuring DURING
the zoom gesture lurched the text; instead Scroll.tsx fires 'inkwave:zoom-settled' → one clean
re-measure, which confirms the same breaks and re-paints the panels against the reflowed text.

Web fonts (EB Garamond) load AFTER first paint and reflow the text, moving every line — but a font
swap changes neither the doc size nor the page width, so the inputSig guard would skip re-measuring
(the break sits wrong until an edit nudges it). Force a fresh measure once fonts are ready, and on
any later font load. The bibliography does the same thing: citation labels render "?key" until the
library loads, then rebuild asynchronously to their real widths ("Author & Author, 2004") — a
whole-document reflow that changes NOTHING in inputSig, so on a citation-heavy doc the load-time
breaks stayed measured against the placeholder layout until some unrelated trigger (zoom-settle, an
edit) re-measured — which read as "the pages move when you zoom". Debounced past the nodeviews' own
queueMicrotask/setState rebuild; the sig guards make it a no-op when breaks didn't move.

THE UPDATE HOOK FIRES FOR EVERY TRANSACTION, so both its jobs gate on DOC IDENTITY. Step-cache
invalidation (Peter, 2026-07-10: "we might as well cache the steps we've gone through so going back
is instant"): this hook fires for our own settle-time setMeta dispatches, SCAS decoration repaints,
and each React re-render's updateState — and clearing per transaction wiped the whole warmed lattice
at every settle, so a zoom-in → zoom-out retrace missed on every step it had just visited. Only a
real doc change makes per-step band geometry stale. And on PHONE only a DOC change pushes the queued
measure back: measured on-device, the word-count re-render alone stacked the phone measure to ~1.9s
after the last keystroke. Doc object identity is the cheap test (ProseMirror docs are persistent
structures — unchanged doc ⇒ same reference); a skipped reschedule loses nothing, since a no-edit
recompute early-returns on inputSig anyway. Desktop keeps the original unconditional reset.

PRINT FLOOR (round-6, Peter: "render it all properly at time of print"): canonical consumers must
NEVER see lazily-stale breaks. Before the print dialog (and on the explicit measure-now request the
export paths dispatch), run the FULL measure SYNCHRONOUSLY — with a warm line cache it is cheap;
correctness is absolute. The panels/bands must match the fresh breaks before the dialog snapshots
layout.

`lastMinH` — applyBands' full-final-page sheet extension — must be respected by recompute's
baseline: writing bare pageH there shrank the sheet the paint pass had just grown, and the RO
ping-ponged between the two writes forever. Stale-larger for one pass after an edit is fine — the
paint recomputes the true extension from the fresh geometry. The sheet also enforces a minimum
one-page scroll height so the footer (logo + number, `position:absolute; bottom:22px`) always lands
at the page bottom, never mid-content on short documents.

<a id="scroll-reassert"></a>
### Re-assert the scroll AFTER the gaps are back

⚠ RE-ASSERT THE SCROLL AFTER THE GAPS ARE BACK (2026-08-28) — Peter's "the doc keeps jumping down…
it doesn't happen straight away… it's either on a timer or when something loads", reported while he
was reading in the SOURCE PANEL with the editor idle. That is the signature of this measure: it is
idle-gated, so it fires seconds after you stop, with nobody looking at the document it moves.

THE ORDER WAS WRONG. The measure CLEARS the gap widgets first (so the DOM reflows to its natural
wrapping), which makes a paginated document dramatically SHORTER — every page gap is a tall block.
The browser then CLAMPS scrollTop to that shorter range. `savedTop` was restored inside the
`finally`, i.e. while the gaps were still gone — so the write was clamped a second time, and only
then were the gaps dispatched back. The document grew again around a scroll position that had
already been squashed.

Same shape as the PDF zoom anchor fixed earlier that day: the arithmetic was right and applied one
layout too early. Assert it again now that the document is its real height, and once more next frame
for the paint that follows.
