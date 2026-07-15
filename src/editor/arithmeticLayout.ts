// ARITHMETIC LAYOUT ENGINE (2026-07-14; generalized for equations/figures 2026-07-15 — the designed
// follow-up to the math-certified fonts work).
//
// A THIRD acquisition path for PaginationExtension.collectLines: instead of forcing a full-document
// browser reflow and reading each block's line geometry with range.getClientRects (path 1) or
// replaying a per-node block-relative cache (path 2, the round-6/7 LineCache), this path COMPUTES a
// block's line wrapping from the boxes of its MEASURABLE ELEMENTS — text via canvas advances, math
// via a cached one-time measure, figures via their dimensions — with NO per-pagination reflow. The
// output is byte-identical in shape to what collectLines produces (per-line intrinsic tops + block
// boundaries), so it feeds the SAME computeBreaks page-splitter and the SAME page-break signatures.
//
// THE MEASURABLE-ELEMENT MODEL (the generalization): every flowing element supplies a stable box —
// an INLINE advance + line-height demand, or a BLOCK height + margins — from a source needing no
// full-document reflow (computed, or a one-time measure cached by an immutable key). See the boxes
// (InlineBox/BlockBox) and the element box-SOURCE registry near figureBlockBox(). "Arithmetic-
// eligible" = "reflow-free-measurable": a block is eligible when every element in it supplies such a
// box AND the DOM verifier stays stable over it (the inline-atom fit guard, LINE_STABILITY_EPS).
//
// WHY TEXT IS SOUND (round-7 certification): canvas `measureText` reproduces the browser's advance
// widths to Δ≤0.05px and a greedy break lands on the SAME word boundaries — but ONLY for the
// certified font palette (CERTIFIED_FAMILIES); uncertified fonts diverge on integer-px advance
// quantization, fatal because canonical breaks must be CROSS-DEVICE IDENTICAL. So the engine is
// CONSERVATIVE BY CONSTRUCTION: it refuses any block it can't prove and hands it back to the DOM
// path. Correctness over cleverness — it never approximates; it defers.
//
// ELIGIBILITY (arithmetic vs DEFERRED to DOM measure):
//   ARITHMETIC-ELIGIBLE:
//     • a `paragraph` of text runs (bold/italic/underline/family), UNIFORM text size, CERTIFIED
//       fonts — mid-word mark straddles handled piece-by-piece;
//     • …the same paragraph MAY ALSO contain inline MATH atoms that carry a box AND FIT the text
//       line (LINE_STABILITY_EPS) — the common textstyle formula (x², a/b, √, sub/superscripts);
//     • a block-atom `mathBlock` (or future `figure`) that carries a reflow-free box.
//   DOM-ONLY (deferred — never guessed):
//     • a `citation` inline atom — no stable reflow-free geometry (React NodeView; reflows on
//       bibliography hydration / style switch; ~9px off even on plain paths). Documented as a
//       FUTURE measurable (cached-measure keyed by citekey+style+hydration-epoch);
//     • a TALL inline formula that exceeds the line (fraction/∑ with limits) — the getClientRects
//       verifier becomes order-unstable, so it defers;
//     • MIXED text sizes in one paragraph (same verifier instability);
//     • uncertified fonts; lists (`orderedList`/`bulletList`/`taskList`), `horizontalRule`,
//       `referenceList` — no box supplied.
//   blockEligibility returns the exact reason, so the wire-in logs a per-doc coverage map.
//
// GATE: run this path ONLY after `document.fonts.ready`, text runs in certified+loaded fonts, math
// boxes present. Else fall back to the DOM measure. A full DOM measure still runs as the idle
// VERIFIER (pagCheck compares signatures) — any divergence is caught within the re-verify window.
//
// Pure module: no DOM, no ProseMirror imports in the core (a canvas 2d context is injected as the
// measure function; element boxes are injected by the caller). Unit-tested (arithmeticLayout.test.ts)
// + browser-proven against the real DOM in scripts/arithmeticLayout.prove.mjs (text + math).

// ─── Certified font palette ───────────────────────────────────────────────────────────────────
// The PRIMARY family name of each css stack the StyleBar can emit (CLAUDE.md math-certified list).
// Certification is by PRIMARY family: the stack '\'EB Garamond\', Georgia, serif' is eligible
// because EB Garamond loads and is certified; the Georgia/serif tail only matters if the primary
// fails to load (in which case document.fonts.check is false → gate defers).
export const CERTIFIED_FAMILIES: ReadonlySet<string> = new Set([
  // ROUND-10 (2026-07-16) — verified on BOTH Chromium and WebKit, in the editor's real context,
  // and (the load-bearing bit) their Chromium DOM wrap == their WebKit DOM wrap byte-for-byte at
  // the canonical width. Hinting was equalised for that comparison: Chromium's default Linux
  // fontconfig quantises advances to whole px while WebKit uses fractional, which manufactures
  // false divergences (--font-render-hinting=none removes it; real devices use subpixel).
  'IM Fell DW Pica',
  'EB Garamond',
  'TeX Gyre Termes',       // picker: 'Romans'
  'TeX Gyre Heros',        // picker: 'Swiss'
  'Crimson Pro',
  'Spectral',
  'Gentium Plus',
  'Libre Baskerville',
  'Caladea',
  'Cormorant Garamond',
  'Fraunces',
  'Bitter',
  'Zilla Slab',
  'Carlito',
  'Atkinson Hyperlegible',
  'JetBrains Mono',
  'Courier Prime',
  // RETIRED 2026-07-16: Lora + Gelasio — dropped from the PICKER but their faces are STILL SERVED
  // (fetch-fonts keeps them): deleting the woff2 would drop legacy marks down their own stacks to
  // Cambria/Georgia SYSTEM fonts, whose metrics vary by device — silently repaginating old docs
  // phone-vs-print. Unlisted here regardless: nobody new can select them, and they weren't put
  // through the round-10 cross-engine pass, so the engine must DEFER rather than compute their wrap.
  // EXCLUDED — Inter: it CERTIFIES on both engines (canvas↔DOM Δ0.0002 WebKit / 0.0151 Chromium)
  // yet its Chromium DOM wrap ≠ its WebKit DOM wrap — the one font of 18 that breaks the
  // cross-device invariant. Cause (measured, not guessed): Inter carries an OPTICAL SIZE (opsz)
  // axis and CSS defaults to `font-optical-sizing: auto`; Chromium resolves opsz from the
  // font-size, WebKit does not → different advances → different wrap (Δ −12.5px @18px).
  //   font-optical-sizing:auto → C 662.31 vs W 674.86   ✗
  //   font-optical-sizing:none → C 674.86 vs W 674.86   ✓ (Δ 0)
  //   font-variation-settings:"opsz" 14 → both 674.86   ✓ (Δ 0)
  // So Inter is shippable ONLY if its StyleBar css stack pins `font-optical-sizing: none` (or a
  // fixed opsz); then it can be added here. THE GENERAL RULE: any variable font with an opsz axis
  // is a cross-device hazard at CSS defaults — pin it or don't ship it.
])

// Parse the leading family token out of a CSS font-family stack. Handles quoted ('..'/".." ) and
// bare names; returns it unquoted and trimmed.
export function primaryFamily(stack: string): string {
  const first = (stack || '').split(',')[0].trim()
  const m = first.match(/^['"](.*)['"]$/)
  return (m ? m[1] : first).trim()
}

export function isCertifiedStack(stack: string): boolean {
  return CERTIFIED_FAMILIES.has(primaryFamily(stack))
}

// ─── The MEASURABLE-ELEMENT abstraction (2026-07-15 — generalized for equations/figures/…) ──────
// The engine's unifying idea: every element that flows in the document supplies a STABLE box from a
// source that needs NO full-document reflow at pagination time. Two shapes:
//   • an INLINE element occupies a horizontal ADVANCE on its line and DEMANDS a line-box height;
//   • a BLOCK element occupies a vertical HEIGHT plus collapsible margins.
// The box's SOURCE is what makes it reflow-free — one of:
//   (a) COMPUTED — text runs (canvas measureText advance + snapped line height); figure dims from
//       the node's specified/intrinsic width×height attributes; a horizontal rule's fixed height.
//   (b) CACHED ONE-TIME MEASURE — content that renders to a stable box per node (KaTeX math): the
//       box is measured ONCE off its rendered geometry and cached by a stable content key (latex +
//       font context); math content is immutable per node, so the cache never needs a reflow again.
//       (This is the same "measure once, cache by stable key" discipline as font certification.)
// "Arithmetic-eligible" therefore generalizes to "reflow-free-measurable": a block is eligible when
// EVERY element in it supplies such a box AND the DOM verifier stays stable over it (the inline-atom
// height guard below). Anything else DEFERS to the DOM measure — never guessed.
export interface InlineBox {
  advanceWidth: number     // px advance the element contributes to the line (unbreakable if atomic)
  lineHeightDemand: number // px line-box height this element forces on its line (its box as it sits)
}
export interface BlockBox {
  height: number           // the block element's content height (px)
  marginTopPx: number      // resolved margins (collapse with neighbours — see resolveBlocks)
  marginBottomPx: number
}

// ─── Run / block model ────────────────────────────────────────────────────────────────────────
export interface InlineRun {
  text: string        // the run's characters ('\n' is a hard break; see layoutParagraph)
  fontFamily: string  // resolved CSS font-family STACK (the value the mark applies)
  fontSizePx: number  // resolved px (em marks already resolved against the block base font)
  fontWeight: number  // 400 | 700 (synthetic-bold weights collapse to nearest; caller resolves)
  italic: boolean
  atomic?: boolean    // inline atom (math/citation/inline-image NodeView)
  // The run's EFFECTIVE COMPUTED white-space. NOT globally break-spaces inside the editor: the same
  // injected PM sheet flips it per SUBTREE —
  //     .ProseMirror [contenteditable="false"]                      { white-space: normal; }
  //     .ProseMirror [contenteditable="false"] [contenteditable="true"] { white-space: pre-wrap; }
  // — i.e. every NodeView/atom subtree (citations, math, gap widgets) hangs while the body text
  // around it does not. A citation NodeView is `display:inline`, so its label text FLOWS IN THE
  // PARENT'S LINE in `normal` mode: a citation-bearing paragraph is genuinely MIXED-mode. The wire-in
  // must read this per run (getComputedStyle on the run's element); mixed ⇒ DEFER (see eligibility).
  whiteSpace?: WhiteSpaceMode
  // A reflow-free-measurable inline ATOM (e.g. inline math) supplies its box here; the wrap then
  // treats it as an unbreakable unit of `box.advanceWidth`, contributing `box.lineHeightDemand` to
  // its line. An atomic run WITHOUT a box (a citation label — no stable reflow-free geometry) makes
  // the block DOM-only. So: atomic + box ⇒ measurable; atomic + no box ⇒ defer.
  box?: InlineBox
  atomType?: string   // 'mathInline' | 'citation' | … — diagnostics / coverage map
}

export interface ArithBlock {
  type: string          // 'paragraph' | block-atom types ('mathBlock', 'figure', …)
  runs: InlineRun[]     // ordered inline content (paragraph-like blocks)
  baseFontPx: number    // the block element's OWN computed font-size (18 at canonical) — the strut
  marginTopPx: number   // resolved margin-top (0 for paragraphs; used for adjacent-margin collapse)
  marginBottomPx: number// resolved margin-bottom (0.5em → 9px canonical for paragraphs)
  // A reflow-free-measurable BLOCK ATOM (block math, figure) supplies its box here — the block is
  // then one unbreakable region of `blockBox.height`. Present ⇒ the block is a measurable block atom
  // (paginated whole, never split); absent + type≠paragraph ⇒ defer to the DOM measure.
  blockBox?: BlockBox
  // OPTIONAL first-line baseline LEADING (px). collectLines reads line tops via range.getClientRects,
  // which returns the TEXT rect (baseline-positioned) — offset below the line-box top by a per-(size,
  // base-strut) constant (EB Garamond @18px base: 16px→5, 18px→3, 18.666px→2, 24px→3). This is a
  // pure constant per block, so it cancels in INTRA-block line deltas; it only affects the CROSS-block
  // advance where adjacent blocks differ in size — i.e. the gap-widget botMargin at a size change.
  // Supplying it (from a one-time per-certified-font calibration table, measured once like the font
  // certification itself) makes the FULL signature byte-identical; omitting it (0) still yields
  // byte-identical break POSITIONS + page count, only the cosmetic botMargin drifting ≤3px at size
  // boundaries. Break positions — the load-bearing cross-device invariant — never depend on it.
  firstLineLeadingPx?: number
}

export interface BlockLayout {
  lineCount: number
  relTops: number[]     // per-line top, relative to the block's own top (px, unrounded)
  lineHeights: number[] // per-line box height = ratio × tallest run on the line (px)
  height: number        // Σ lineHeights — the block's content height (advance = height + margin)
  breakStartChars: number[] // char index (into the block's concatenated text) each line STARTS at
}

export interface Eligibility { eligible: boolean; reason: string }

// An inline math pill is an ATOMIC one-line unit: whatever its formula, inline KaTeX renders in
// TEXTSTYLE, so the pill is a stable box (~34px @18px base — fixed, formula-independent; even a
// \frac or \sum stays compact) that simply makes ITS line taller. That's fine for the arithmetic
// path (the line takes the pill's demand). The one catch is the DOM VERIFIER: collectLines reads
// line tops via range.getClientRects, and KaTeX's internal sub/superscript and fraction spans emit
// rects BELOW the baseline that the 3px dedup splits into spurious extra lines — so the verifier
// OVER-counts a math paragraph's lines TODAY (a pre-existing inaccuracy, independent of this engine).
// COLLECTLINES CO-REQUISITE (documented; the wire-in gate): to make the verifier agree with the
// (correct) arithmetic count, collectLines must collapse each `[data-math-inline]` pill to its
// SINGLE bounding rect before the dedup (skip its internal rects). With that one-rect rule the
// verifier is stable and math paragraphs are byte-identical (proven in the prover, which applies the
// same rule to its DOM reference). Until it lands, gate inline math OFF (mathEligible=false) and it
// safely DEFERS. LINE_STABILITY_EPS still guards the MIXED-SIZE TEXT case (a genuine instability with
// no such fix — differently-sized text rects reorder unfixably).
export const LINE_STABILITY_EPS = 3

// `mathEligible` reflects whether the collectLines math-pill rect-fix is in place (the wire-in flag).
// The engine's CAPABILITY is unconditional — it computes math paragraphs correctly either way; the
// flag only decides whether to trust the DOM verifier over them yet.
export function blockEligibility(block: ArithBlock, _ratio = 1.618, mathEligible = true, whiteSpace: WhiteSpaceMode = EDITOR_WHITE_SPACE): Eligibility {
  // BLOCK ATOMS (block math, figure): eligible iff they carry a reflow-free box.
  if (block.type !== 'paragraph') {
    return block.blockBox ? { eligible: true, reason: `block-atom:${block.type}` }
                          : { eligible: false, reason: `block:${block.type}` }
  }
  if (!block.runs.length) return { eligible: true, reason: 'paragraph:empty' }
  for (const r of block.runs) {
    if (r.atomic) {
      // Inline atom: needs a reflow-free box. Math pills have one (measured); citation labels do not
      // (React NodeView, reflows on bibliography hydration/style switch) — those always defer.
      if (!r.box) return { eligible: false, reason: `inline-atom${r.atomType ? ':' + r.atomType : ''}` }
      if (!mathEligible) return { eligible: false, reason: `inline-atom-gated${r.atomType ? ':' + r.atomType : ''}` }
      continue
    }
    if (!isCertifiedStack(r.fontFamily)) return { eligible: false, reason: `uncertified:${primaryFamily(r.fontFamily)}` }
    // MIXED WHITE-SPACE: a text run in a different mode than the block wraps by a DIFFERENT rule
    // (hang vs no-hang) on the SAME line — and `normal` additionally COLLAPSES runs of spaces, which
    // this engine does not model. Both are unmodelled ⇒ DEFER. (This is the guard that keeps a
    // future citation-eligible paragraph honest: a `normal` citation subtree inside break-spaces
    // body text can only go arithmetic once the atom is a proven opaque box, never by guessing.)
    const rws = r.whiteSpace ?? whiteSpace
    if (rws !== whiteSpace) return { eligible: false, reason: `mixed-whitespace:${rws}` }
  }
  // Only the editor's own mode is proven end-to-end (break-spaces). Anything else defers rather than
  // trust an unproven rule — `normal` in particular needs space-collapsing the engine doesn't model.
  if (whiteSpace !== EDITOR_WHITE_SPACE) return { eligible: false, reason: `whitespace-unproven:${whiteSpace}` }
  // MIXED FONT-SIZE among TEXT runs is DOM-ONLY: a taller text run's rect top diverges >3px, and
  // unlike a math pill there is NO single-rect fix (the size change is intrinsic to the text run) —
  // the verifier is unfixably order-dependent, so it defers.
  const sizes = block.runs.filter((r) => !r.atomic && r.text !== '\n').map((r) => r.fontSizePx)
  if (sizes.length && sizes.some((s) => s !== sizes[0])) return { eligible: false, reason: 'mixed-size' }
  return { eligible: true, reason: block.runs.some((r) => r.atomic) ? 'paragraph:text+math' : 'paragraph:text' }
}

// The browser's USED line-box height: the CSS line-height (ratio × font-size) does NOT render at
// its exact float — it is laid out on the LayoutUnit grid (1/64 px), FLOORED. Empirically (prover
// _probe): 18px φ → 1863/64 = 29.109375 (not 29.124); 24px φ → 2485/64 = 38.828125. Reproducing
// this exactly is what makes the arithmetic `used`/botMargin byte-identical to the DOM measure —
// the naive ratio×size drifts ~1px over a page and flips the gap-widget height. `fontSizePx` is
// itself snapped to the grid first (round), matching how the browser stores the computed size.
export function snappedLineHeight(fontSizePx: number, ratio: number): number {
  return Math.floor(ratio * Math.round(fontSizePx * 64)) / 64
}

// ─── ENGINE CAPABILITY GATE (2026-07-16 — the WebKit finding) ──────────────────────────────────
// The editor renders with ligatures OFF (.ProseMirror { font-variant-ligatures: none }); canvas
// measureText applies them by DEFAULT, and the ONLY lever is ctx.textRendering = 'optimizeSpeed'.
// Chromium exposes it. Playwright's WebKit build does NOT ('textRendering' in ctx === false), and
// the obvious substitute was MEASURED AND FAILS: injecting U+200C (ZWNJ) between ligature pairs
// does not reproduce the editor's advances on any tested family. With no lever, canvas measures
// "first"/"office"/"affluent" 2-5px NARROWER than the editor renders them (measured Δ up to 41px
// across the corpus) and the engine would take words the browser drops — a wrong wrap, i.e. wrong
// words on a page. So where this returns FALSE the arithmetic path MUST NOT RUN; defer to the DOM
// measure, which is always correct.
//
// ⚠ OPEN QUESTION, do not assume either way: Playwright's WebKit is the GTK/WPE port (FreeType +
// HarfBuzz) with a spoofed "Version/26.4 Safari" UA. Apple's iOS/macOS Safari is a different build
// on CoreText and MAY expose ctx.textRendering. This gate is capability-detected, not UA-sniffed,
// so it self-corrects: on a Safari that has the API the engine simply turns on. Whether that is
// today's iOS needs a REAL-DEVICE check — and it matters, because the phone is exactly where the
// engine's win lives (it eliminates the 400-1100ms forced canonical reflow).
export function canvasCanMatchEditorShaping(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    return !!ctx && 'textRendering' in ctx
  } catch { return false }
}

// ─── Canvas measure ───────────────────────────────────────────────────────────────────────────
export type Measure = (text: string, cssFont: string) => number

// The exact css `font` shorthand canvas + the DOM use: '<style> <weight> <size>px <family-stack>'.
export function cssFontOf(run: Pick<InlineRun, 'fontFamily' | 'fontSizePx' | 'fontWeight' | 'italic'>): string {
  return `${run.italic ? 'italic ' : ''}${run.fontWeight} ${run.fontSizePx}px ${run.fontFamily}`
}

// A cached canvas 2d measure. Setting ctx.font is the only per-call cost; results are memoised per
// (font, text) — hot on the space glyph and repeated words. The browser must be at document.fonts
// .ready with the faces loaded, or measureText falls back to a system face (the gate prevents this).
export function makeCanvasMeasure(): Measure {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas ? canvas.getContext('2d') : null
  if (ctx) {
    // MATCH THE EDITOR'S SHAPING, or every ligature is a wrap error (2026-07-15). ProseMirror's
    // injected sheet sets `.ProseMirror { font-variant-ligatures: none; font-feature-settings:
    // "liga" 0 }` — the editor renders f+i SEPARATELY. Canvas measureText applies ligatures by
    // DEFAULT, so it measured "first"/"office"/"affluent" 2-5px NARROWER than the editor renders
    // them: the engine took a word the browser dropped, on any line with an fi/fl/ffi.
    // MEASURED (delta canvas − DOM-inside-.ProseMirror, EB Garamond 18px):
    //   default / optimizeLegibility → −2 … −5 on every ligature string (0 on ligature-free text)
    //   textRendering 'optimizeSpeed' + fontKerning 'normal' → 0.000 on ALL strings
    //   geometricPrecision → fractional drift; ZWNJ-injection also 0.000 but mangles the text
    // optimizeSpeed disables ligatures; fontKerning:'normal' pins KERNING ON explicitly (the editor
    // keeps kerning — its sheet only disables liga), so we never rely on optimizeSpeed's implied
    // kerning behaviour. NB this is also a GAP IN THE ROUND-7 FONT CERTIFICATION: r7/r8 measured
    // canvas vs a PLAIN span (ligatures on BOTH sides), so their Δ≤0.05px parity did not cover the
    // editor's liga-off shaping. Re-run that grid with this config.
    try { (ctx as unknown as { textRendering: string }).textRendering = 'optimizeSpeed' } catch { /* older engine */ }
    try { (ctx as unknown as { fontKerning: string }).fontKerning = 'normal' } catch { /* older engine */ }
  }
  const cache = new Map<string, number>()
  return (text: string, cssFont: string): number => {
    if (!ctx) return 0
    const key = cssFont + ' ' + text
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    if (ctx.font !== cssFont) ctx.font = cssFont
    const w = ctx.measureText(text).width
    cache.set(key, w)
    return w
  }
}

// ─── WHITE-SPACE MODE: whether a line's trailing space HANGS ────────────────────────────────────
// This is not a detail — it decides the fit test, and it bit hard (2026-07-15). ProseMirror's own
// stylesheet (prosemirror-view/style/prosemirror.css, injected by @tiptap/core) sets:
//     .ProseMirror { white-space: pre-wrap; white-space: break-spaces; }
// so the live editor computes `break-spaces`. Per CSS Text 3, break-spaces is pre-wrap EXCEPT that
// "any preserved white space that would otherwise hang instead takes up space and can be broken
// after" — i.e. THE TRAILING SPACE NEVER HANGS; it occupies width and counts toward the fit.
// MEASURED (1/64px sweep, "AAA BBB CCC", EB Garamond 18px, bare=73.0 full=77.0):
//     normal        → BBB first fits at w=72.98  (≈bare)  → HANGS
//     pre-wrap      → BBB first fits at w=72.98  (≈bare)  → HANGS
//     break-spaces  → BBB first fits at w=76.98  (≈full)  → NO HANG
// Consequence: the PRODUCTION fit test is the FULL token width (space included). A `normal`-mode
// harness silently takes a word the real editor drops — which is exactly how a plain-<div> prover
// certified a wrap the editor never produces.
export type WhiteSpaceMode = 'normal' | 'pre-wrap' | 'break-spaces'
/** The editor's real mode — ProseMirror sets break-spaces on .ProseMirror. The engine's default. */
export const EDITOR_WHITE_SPACE: WhiteSpaceMode = 'break-spaces'
/** Does a line's trailing space hang (excluded from the fit test)? Only when NOT break-spaces. */
export function hangsTrailingSpace(mode: WhiteSpaceMode): boolean { return mode !== 'break-spaces' }

// ─── The greedy line-breaker (multi-run, mixed-size) ────────────────────────────────────────────
// Reproduces CSS `white-space: normal` breaking with the TRAILING-SPACE-HANGS rule that round-7
// certified (r7/r8-font-calib.mjs): a token = a maximal non-break sequence up to and including its
// trailing whitespace (split after each whitespace char, exactly `s.split(/(?<=\s)/)`); overflow is
// tested against the BARE token (trailing space stripped) so an end-of-line space hangs past the
// edge, but the FULL token width (with its space) accumulates into the line. Extended to runs: a
// token carries its pieces (contiguous same-font substrings), width = Σ measure(piece), and the
// line box height = ratio × max(baseFontPx, tallest run placed on the line) — the mixed-run
// tallest-line-box rule (r7 test c).
const WRAP_EPS = 0.001 // r7's `> W + 0.001` — matches the browser's fractional-advance tolerance

// A piece is either TEXT (measured by canvas) or an inline ATOM (a replaced box of fixed width +
// line-height demand — math, inline image). Atoms GLUE to adjacent non-space text in the same token
// (CSS offers no break opportunity between an inline-block and neighbouring non-space text), so
// "x²" (atom) directly followed by "+1" (text) never breaks between them.
interface Piece { text: string; font: string; demand: number; atom?: InlineBox }
interface Token { pieces: Piece[]; fullW: number; bareW: number; demand: number; len: number }

// Flatten a paragraph's runs into a per-token stream (tokens split after each whitespace char),
// each token measured full + bare + line-height demand. '\n' (hard break) → a 'BR' sentinel.
function tokenize(runs: InlineRun[], measure: Measure, ratio: number): Array<Token | 'BR'> {
  const out: Array<Token | 'BR'> = []
  let cur: Piece[] = []
  let curLen = 0
  const flush = () => {
    if (!cur.length) return
    let fullW = 0
    let demand = 0
    for (const p of cur) {
      fullW += p.atom ? p.atom.advanceWidth : measure(p.text, p.font)
      if (p.demand > demand) demand = p.demand
    }
    // bare width: strip trailing whitespace off the END of the token (ws only ever sits at the end,
    // and never on an atom piece — atoms have no trailing space to hang).
    const bare = cur.map((p) => ({ ...p }))
    for (let i = bare.length - 1; i >= 0; i--) {
      if (bare[i].atom) break // an atom ends the strip — it isn't whitespace
      const stripped = bare[i].text.replace(/\s+$/, '')
      if (stripped === bare[i].text) break
      bare[i].text = stripped
      if (stripped.length > 0) break
    }
    let bareW = 0
    for (const p of bare) bareW += p.atom ? p.atom.advanceWidth : (p.text ? measure(p.text, p.font) : 0)
    out.push({ pieces: cur, fullW, bareW, demand, len: curLen })
    cur = []
    curLen = 0
  }
  for (const run of runs) {
    if (run.atomic && run.box) {
      // Inline atom: a single unbreakable piece glued into the current token; occupies 1 doc position.
      cur.push({ text: '', font: '', demand: run.box.lineHeightDemand, atom: run.box })
      curLen += 1
      continue
    }
    const font = cssFontOf(run)
    const textDemand = snappedLineHeight(run.fontSizePx, ratio)
    let buf = ''
    const pushBuf = () => { if (buf) { cur.push({ text: buf, font, demand: textDemand }); curLen += buf.length; buf = '' } }
    for (const ch of run.text) {
      if (ch === '\n') { pushBuf(); flush(); out.push('BR'); continue }
      buf += ch
      if (/\s/.test(ch)) { pushBuf(); flush() } // whitespace ends the token (split-after-ws)
    }
    pushBuf()
  }
  flush()
  return out
}

// Lay out one paragraph block into per-line geometry at a given content width. `ratio` = the
// --inkwave-lh line-height (φ = 1.618 default). Assumes the caller has already confirmed
// blockEligibility(block).eligible — a non-eligible block would produce a WRONG result (that's why
// the gate defers it). Pure arithmetic: no DOM, no layout read.
export function layoutParagraph(block: ArithBlock, contentWidthPx: number, ratio: number, measure: Measure, whiteSpace: WhiteSpaceMode = EDITOR_WHITE_SPACE): BlockLayout {
  const hang = hangsTrailingSpace(whiteSpace) // break-spaces (the editor) ⇒ false ⇒ the space counts
  const strut = snappedLineHeight(block.baseFontPx, ratio) // the paragraph's own font always occupies the line
  const leading = block.firstLineLeadingPx ?? 0 // baseline offset to match getClientRects text-rects
  const relTops: number[] = []
  const lineHeights: number[] = []
  const breakStartChars: number[] = [0]
  const tokens = tokenize(block.runs, measure, ratio)

  let top = 0
  let lineW = 0
  let lineDemand = strut        // max line-box demand over elements on the current line (strut floor)
  let charIdx = 0
  let started = false           // has any token landed on the current line yet?

  const closeLine = () => {
    relTops.push(top + leading)   // report at the text-rect position (height/advance stay leading-free)
    lineHeights.push(lineDemand)
    top += lineDemand
  }

  for (const tk of tokens) {
    if (tk === 'BR') {
      // Hard break: end the current line here; the next token starts a fresh line.
      closeLine()
      lineW = 0
      lineDemand = strut
      started = false
      charIdx += 1 // the '\n' occupies one position in the block text
      breakStartChars.push(charIdx)
      continue
    }
    if (tk.len === 0) continue
    // THE FIT TEST. hang (normal/pre-wrap): the token's trailing space hangs past the edge, so test
    // the BARE width. no-hang (break-spaces — the editor): the space occupies width and counts, so
    // test the FULL width. Measured, not assumed — see the sweep in the WhiteSpaceMode note above.
    const fitW = hang ? tk.bareW : tk.fullW
    if (started && lineW > 0 && lineW + fitW > contentWidthPx + WRAP_EPS) {
      // This token overflows → break BEFORE it. Close the line; the token opens the next one.
      closeLine()
      breakStartChars.push(charIdx)
      lineW = tk.fullW
      lineDemand = Math.max(strut, tk.demand)
    } else {
      lineW += tk.fullW
      lineDemand = Math.max(lineDemand, tk.demand)
      started = true
    }
    charIdx += tk.len
  }
  // Close the final (open) line — even an empty block emits one line at the strut height.
  closeLine()

  return {
    lineCount: relTops.length,
    relTops,
    lineHeights,
    height: top,
    breakStartChars: breakStartChars.slice(0, relTops.length),
  }
}

// ─── Composition into the collectLines shape (the third acquisition path) ───────────────────────
// A block resolver returns, per top-level block, its per-line RELATIVE tops + its advance (top-to-
// top distance to the next block). Eligible paragraphs resolve arithmetically; every other block is
// resolved by the injected `domMeasure` (the existing range.getClientRects path). Threading absolute
// tops from a single anchored first-block top yields the exact `lines`/`blocks` arrays computeBreaks
// consumes. This is the concrete shape the wire-in plugs into collectLines.
export interface ResolvedBlock {
  relTops: number[]     // per-line tops relative to this block's top
  advance: number       // distance from this block's top to the next block's top (height + margin)
  eligible: boolean     // did the arithmetic path own this block? (for diagnostics)
  atomLike: boolean     // block atom (block math / figure) — one unbreakable region; the paginator
                        // treats each of its lines as its own pseudo-block (== collectLines' atoms)
  reason: string
}

export interface DomBlockMeasure {
  (index: number): { relTops: number[]; advance: number } // the DOM fallback for a deferred block
}

// The collapsed advance below block i (adjacent-sibling margin collapse — max, not sum).
function collapsedAdvance(blocks: ArithBlock[], i: number, height: number): number {
  const next = i + 1 < blocks.length ? blocks[i + 1] : null
  const collapsed = next ? Math.max(blocks[i].marginBottomPx, next.marginTopPx) : blocks[i].marginBottomPx
  return height + collapsed
}

// Resolve every block, arithmetic where reflow-free-measurable, DOM otherwise. `fontLoaded(run)` is
// the gate check (document.fonts.check) — a text run whose face is not yet loaded forces the DOM
// path even if the family is certified (measureText would use a fallback face pre-load). Handles
// three arithmetic shapes: paragraphs (wrap), block atoms (one region of blockBox.height), and
// empty paragraphs; everything else defers.
export function resolveBlocks(
  blocks: ArithBlock[],
  contentWidthPx: number,
  ratio: number,
  measure: Measure,
  domMeasure: DomBlockMeasure,
  fontLoaded: (run: InlineRun) => boolean = () => true,
  mathEligible = true, // wire-in flag: whether the collectLines math-pill rect-fix is in place
  whiteSpace: WhiteSpaceMode = EDITOR_WHITE_SPACE, // the editor computes break-spaces (no hang)
): ResolvedBlock[] {
  const out: ResolvedBlock[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const elig = blockEligibility(b, ratio, mathEligible, whiteSpace)
    // Only TEXT runs gate on fonts; atoms carry their own (already-measured) box.
    const facesReady = elig.eligible && b.runs.every((r) => r.atomic || fontLoaded(r))
    if (elig.eligible && facesReady) {
      if (b.type !== 'paragraph' && b.blockBox) {
        // BLOCK ATOM (block math / figure): one unbreakable region.
        out.push({ relTops: [b.firstLineLeadingPx ?? 0], advance: collapsedAdvance(blocks, i, b.blockBox.height), eligible: true, atomLike: true, reason: elig.reason })
      } else {
        const lay = layoutParagraph(b, contentWidthPx, ratio, measure, whiteSpace)
        out.push({ relTops: lay.relTops, advance: collapsedAdvance(blocks, i, lay.height), eligible: true, atomLike: false, reason: elig.reason })
      }
    } else {
      const dm = domMeasure(i)
      // Structural ineligibility keeps its reason (block:hr, inline-atom, mixed-size, uncertified:…);
      // only an ELIGIBLE block whose faces haven't loaded is 'fonts-unloaded'.
      const reason = elig.eligible ? 'fonts-unloaded' : elig.reason
      out.push({ relTops: dm.relTops, advance: dm.advance, eligible: false, atomLike: false, reason })
    }
  }
  return out
}

// ─── Element box SOURCES: how each measurable type produces its reflow-free box ─────────────────
// The wire-in obtains an element's box from its type. This registry is the extension point — a new
// measurable atom becomes a one-function plug-in, never a rewrite of the wrap/pagination core.
//
// TEXT (inline, computed) — handled inside tokenize(): advance = measureText, demand =
//   snappedLineHeight(fontSizePx). No provider needed.
//
// MATH (inline + block, CACHED ONE-TIME MEASURE) — the wire-in keeps a cache keyed by a STABLE
//   content key and fills a miss with ONE measure off the node's already-rendered KaTeX geometry
//   (no reflow of anything else; math renders synchronously and is immutable per node):
//     inline: key = `${latex}|${fontSizePx}` → InlineBox {
//       advanceWidth      = the pill's border-box width  (KaTeX box@0.826em + 6+4 padding + 2 border),
//       lineHeightDemand  = the line-box height the pill produces when set inline with text.
//     }  A miss measures the live node once (getBoundingClientRect on the pill + a one-line probe for
//        the demand) and caches it; the box is invalidated only if the latex changes (⇒ a new key).
//     block:  key = `${latex}|${align}` → BlockBox {
//       height = the rendered .katex-display height + the block's 0.4em×2 padding (min 1.8em),
//       marginTop/Bottom = 0.5em (× the block base font).
//     }
//   The engine never re-measures on a normal pagination — it reads the cached box. This is the same
//   "measure once, cache by an immutable key" discipline as the font-certification table.
//
// FIGURE / IMAGE (block, COMPUTED from attrs) — see figureBlockBox() below. A figure's box is a
//   PURE function of its specified/intrinsic dimensions + its caption's wrapped height + margins —
//   no measure at all. (No figure node exists in the schema yet — StarterKit + Math + Citation +
//   ReferenceList only — so this is the documented extension point, ready to wire when one lands.)
//
// The DISCIPLINE that stays fixed for ANY new type: (1) the box must come from computation or a
// one-time measure cached by an immutable key — never a per-pagination reflow; (2) an INLINE box
// must clear the LINE_STABILITY_EPS fit check or the block defers (the DOM verifier would miscount
// its line); (3) if a type's geometry is NOT stable (a citation label reflows on bibliography
// hydration / style switch; a mixed-size text line's rects reorder), it DEFERS — the idle DOM
// measure remains the verifier, and pagCheck catches any divergence within the re-verify window.

// A figure/image BLOCK box from its specified or intrinsic dimensions + an optional caption. Pure —
// this is exactly what makes figures arithmetic-friendly the moment a figure node exists: no reflow,
// no measure, just its box model. `captionHeightPx` is the caption paragraph's wrapped height (from
// layoutParagraph on the caption, if any). Height honours a CSS `max-width:100%` shrink: a figure
// wider than the column scales down, keeping aspect ratio (the common editor rule).
export function figureBlockBox(opts: {
  intrinsicWidthPx: number
  intrinsicHeightPx: number
  contentWidthPx: number       // the column content width (figures cap at 100% of it)
  captionHeightPx?: number     // wrapped caption height (0 / omitted = no caption)
  captionGapPx?: number        // gap between image and caption (default 0)
  marginTopPx?: number
  marginBottomPx?: number
}): BlockBox {
  const scale = opts.intrinsicWidthPx > opts.contentWidthPx && opts.intrinsicWidthPx > 0
    ? opts.contentWidthPx / opts.intrinsicWidthPx : 1
  const imgH = opts.intrinsicHeightPx * scale
  const caption = opts.captionHeightPx ? (opts.captionGapPx ?? 0) + opts.captionHeightPx : 0
  return { height: imgH + caption, marginTopPx: opts.marginTopPx ?? 0, marginBottomPx: opts.marginBottomPx ?? 0 }
}

// ─── Page splitter (a faithful port of PaginationExtension.computeBreaks) ───────────────────────
// Same math as the live break loop: textArea = pageH − topMargin − bottomMargin; break BEFORE the
// line that would overflow; small orphans (≤22% of the text area) snap to the block start, else the
// page fills mid-block; the reference list is forced onto a fresh page. The signature string uses
// the same `at:round(botMargin)` | … | `pages:N` format the live path emits, so a prover can compare
// arithmetic-sourced lines against DOM-sourced lines through ONE splitter and assert byte-identity.
// (Desktop/canonical only — the phone bottom-margin branch is not modelled; canonical breaks are
// device-independent by design.)
export const MARGIN_BOTTOM_PX = 72

export interface SplitLine { top: number; blockIdx: number; pos: number } // pos = the line's own doc position (lazy posAtCoords in the live path)
export interface SplitBlock { start: number } // block-start doc position; >0 so orphan-snap is enabled

export interface SplitResult { sig: string; breaks: Array<{ at: number; botMargin: number }>; pages: number }

export function paginate(
  lines: SplitLine[],
  blocks: SplitBlock[],
  refListPos: number,      // -1 if none
  pageH: number,
  topM: number,
): SplitResult {
  const textArea = Math.max(1, pageH - topM - MARGIN_BOTTOM_PX)
  const sig: string[] = []
  const breaks: Array<{ at: number; botMargin: number }> = []
  let used = 0
  let pageNo = 1
  let curBlock = -1
  let blockStartUsed = 0
  let refBroken = false

  for (let i = 0; i < lines.length; i++) {
    const lh = i < lines.length - 1 ? Math.max(1, lines[i + 1].top - lines[i].top) : 24
    if (lines[i].blockIdx !== curBlock) { curBlock = lines[i].blockIdx; blockStartUsed = used }
    const blockStart = blocks[lines[i].blockIdx].start

    if (refListPos > 0 && !refBroken && blockStart >= refListPos && used > 4) {
      const botMargin = Math.max(MARGIN_BOTTOM_PX, pageH - topM - used)
      breaks.push({ at: refListPos, botMargin })
      sig.push(`ref:${refListPos}:${Math.round(botMargin)}`)
      pageNo++; used = 0; curBlock = -1; refBroken = true
    }

    if (i > 0 && used + lh > textArea && lines[i].pos > 0) {
      const orphan = used - blockStartUsed
      const snap = orphan <= textArea * 0.22 && blockStart > 0
      const at = snap ? blockStart : lines[i].pos
      const brokeUsed = snap ? blockStartUsed : used
      const botMargin = Math.max(MARGIN_BOTTOM_PX, pageH - topM - brokeUsed)
      if (at > 0 && !(refBroken && at === refListPos)) {
        breaks.push({ at, botMargin })
        sig.push(`${at}:${Math.round(botMargin)}`)
        pageNo++
        used = snap ? orphan : 0
        curBlock = -1
      }
    }
    used += lh
  }
  sig.push(`pages:${pageNo}`)
  return { sig: sig.join('|'), breaks, pages: pageNo }
}
