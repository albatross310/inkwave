# Pagination — the measurement rounds

The **rules** live beside the code in `src/editor/extensions/PaginationExtension.ts`,
`src/editor/arithmeticLayout.ts` and `src/editor/staticPagination.ts`. This file holds the **why**:
the incidents, the numbers, and the hypotheses that were refuted on the way.

Page breaks are CANONICAL — the same text on page N at every zoom, on phone, and in print — so
every change here is verified by `pnpm prove:breaks` printing byte-identical break positions.

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
