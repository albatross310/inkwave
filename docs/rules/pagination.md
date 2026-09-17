<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Canonical pagination — the load-bearing invariant

Rounds and numbers: `docs/archive/pagination-rounds.md`.

Breaks are CANONICAL: measured in a forced context (paper mm width from `editor/pageModel.ts`,
desktop side margins, `--iw-editor-zoom:1`, `--iw-magnify:1`, font 1.125rem) inside
`PaginationExtension.recompute()`'s single-rAF no-paint window (`editor/canonicalMeasure.ts` does
capture→force→restore-exactly), applied as DOCUMENT-POSITION break widgets. Same text on page N at
every zoom, on phone, and in print.

- Live zoom/width changes only repaint panels; window resize never re-measures breaks; phone gap
  GEOMETRY is a compact fixed 32px (`PHONE_PAGE_MARGIN`).
- **A child's `useLayoutEffect` runs BEFORE the parent's ref attaches on fresh mounts** (StrictMode
  masks it in dev) — resolve elements from your OWN refs.
- **The pagination ResizeObserver must FOLD into the edit debounce**, both platforms.
- **Tiptap's `update` fires on EVERY `updateState`**, including unrelated React re-renders — gate
  reschedules on doc identity.
- **'scroll' paper must still measure font-canonically.** Citation-label hydration reflows invisibly —
  `bibProvider.subscribe` drives a debounced re-measure.
- **An inline ATOM contributes EXACTLY ONE rect, its own bounding box** (`collectLines`) — no internal
  break opportunity, so NodeView internals never become phantom lines and mid-line breaks. Atomhood
  comes from ProseMirror (`isInline && isAtom`), NEVER a CSS class; a block with no atoms takes the
  byte-identical old path; top-level atoms (refList, block math) keep `atomLike`. `mathEligible` is
  passed FALSE deliberately.
- **`staticPagination` re-runs the editor's canonical break pipeline, and THE BREAK RULE IS ONE
  MODULE — `src/editor/breakRule.ts` `pickBreaks` (2026-09-15).** It used to exist in three
  copies (`PaginationExtension.computeBreaks`, `arithmeticLayout.paginate`,
  `staticPagination.computeBreakPicks`) and a retired widow/orphan rule was once fixed in two and
  missed in the third, putting the pane +2 pages out on plain prose. The three are now CALLERS:
  each supplies geometry (page box, phone) and POLICY (`refListPos`, `posOf`, `snap: never |
  off-canonical | legacy-orphan`) and renders the picks its own way — widgets, char offsets, sig.
  Do not grow a fourth loop, and do not add a policy branch a caller could express as data.
  Guarded by `breakRuleParity.test.ts` (36 hand-derived cases pinning sig, widget keys, band
  breaks and lastUsed for every shape where the copies could have differed) — and still compare
  break POSITIONS, not page counts, whenever the rule or its callers move
  (`pnpm prove:breaks`: byte-identical first-10 + `contentWidth` before and after).
- **Never do per-line hit-tests in a measure** — `collectLines` carries sample coords and resolves
  positions LAZILY; block boundaries come from ONE `posAtDOM` per top-level block.
- **`collectLines` caches block lines by PM NODE IDENTITY** (WeakMap). Replace the WeakMap whenever
  the canonical CONTEXT changes (fonts `loadingdone`, page settings, bibliography hydration —
  `clearLineCache` sits beside `clearStepCache`); never pass it for fluid 'scroll' paper; read/write
  only on the gap-cleared measure.
- **SCOPED MEASURE: exact near the writer, deferred far away — never approximated.** `computeScoped`
  runs in the REAL forced canonical context (live DOM, live NodeViews, real `posAtCoords`) reading
  only changed blocks + the block below; unchanged blocks reuse cached block-relative lines. **NO
  content-visibility tricks in measures**, and no host clones (they cannot replicate NodeViews).
  `canonicalIsLive()` skips the force on desktop at defaults. A FULL measure re-verifies lazily after
  every scoped one and refreshes the base.
- **PRINT FLOOR:** `inkwave:measure-now` / `beforeprint` run a SYNCHRONOUS full measure + paint;
  `printDoc()` and `exportPdf()` dispatch it explicitly. Snapshot `staticPagination` runs its own
  canonical pipeline, never lazy.
- **Do NOT use CSS `zoom` on the parchment** — it inflates `clientWidth` and breaks the paginator.
- Proof: `inkwave:pagCheck=1` compares both paths per measure; `window.__iwPagInc.reasons` counts
  scoped-bail causes. Probe traps: the page-gap widget is a `display:block` span that FORCES a line
  break, so auditing the GAPPED DOM for mid-line breaks is vacuous (`gapsLeftFlow`); a verdict is
  unreadable where rendering is non-canonical (`renderingIsCanonical`); measure the artifact per
  BLOCK, not a rate a rare NodeView can hide.
- **⚠ `?arithLayout` — DO NOT GRADUATE. THE REAL BLOCKER IS `arithmeticLayout.ts`, NOT WebKit.**
  Its `paginate` selects the `never` snap policy of the one break rule (`breakRule.ts`, 2026-09-15)
  — deliberately, because textRender and `prove:breaks` compare it against CANONICAL rendering,
  where the editor never snaps either. The splitter is shared now, so the 17/17 · 25/25 · 34/34
  divergence (re-measured unchanged after the fold) must come from the LINES/BLOCKS the engine
  feeds it, not from the rule. Graduating on a WebKit pass alone would ship an engine that cuts
  lines in half at every zoom — reintroducing verbatim the bug Peter reported on 2026-08-28. The
  WebKit cross-device pass and the scoped-arith typing A/B are still required, just no longer
  first. Any "0 divergences" claim is STALE.
- **Fonts are MATH-CERTIFIED and device-independent.** 15 certified families ship; system fonts
  (Times/Cambria/Georgia/Palatino/Baskerville/system-ui) are GONE — device-dependent metrics cannot
  satisfy a cross-device canonical break. Each new css stack keeps the old system stack as its
  fallback tail. Only identity serifs preload; the rest load on demand and pagination re-measures on
  `loadingdone`. Before shipping another family: certification is CHROMIUM-ONLY, so a WebKit pass
  first; Tinos/Arimo/Caladea are metric clones of trademarked faces (ship under the clone's own name).
  Re-run `node scripts/fontCertify.fetch.mjs && node scripts/fontCertify.prove.mjs`.
  · **Canvas-vs-DOM parity MUST be measured inside a real `.ProseMirror`** (`break-spaces`, ligatures
  OFF) — a plain-div harness certifies a fiction. **Any gate of the form "measure X, compare to Y,
  disable if they differ" must be probed for its OWN correctness — assert it PASSES on a known-good
  input — before its verdict is trusted.** Such a gate does not fail loudly; it silently DISABLES the
  feature it guards, and that looks exactly like the feature being unnecessary (this killed
  `canvasShapingMatchesEditor` in production).
  · **`document.fonts.check()` returns TRUE for a family with NO @font-face** — detect real load by
  comparing against the monospace fallback.

