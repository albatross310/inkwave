// ARITHMETIC LAYOUT ENGINE — a reflow-free third acquisition path for
// PaginationExtension.collectLines. Computes a block's line wrapping from the boxes of its
// measurable elements (text via canvas advances, math via a cached measure) instead of forcing a
// browser reflow. Output is shape-identical to collectLines, so it feeds the same page-splitter.
//
// ⚠ PARKED, DEFAULT OFF (`?arithLayout`), AND IT MUST NOT GRADUATE AS IT STANDS: it does not
// implement `shouldSnapToBlock`, so it now disagrees with the DOM measure on EVERY break.
// → docs/archive/pagination-rounds.md#arith-engine
//
// THE RULES, each load-bearing:
//   1. CONSERVATIVE BY CONSTRUCTION — it never approximates, it DEFERS. Any block it cannot prove
//      goes back to the DOM path, and `blockEligibility` returns the exact reason.
//   2. CERTIFIED FONTS ONLY (`CERTIFIED_FAMILIES`). Uncertified faces diverge on integer-px advance
//      quantization, which is fatal: canonical breaks must be cross-device IDENTICAL.
//   3. RUN ONLY AFTER `document.fonts.ready`, with math boxes present. Else fall back.
//   4. CITATIONS ARE DOM-ONLY, DELIBERATELY — a React NodeView has no stable reflow-free geometry
//      (it reflows on bibliography hydration and measures ~9px off even on plain paths).
//   5. PURE MODULE: no DOM and no ProseMirror imports in the core. The canvas 2d context is
//      injected as a measure function; element boxes are injected by the caller.
//   6. A full DOM measure still runs as the idle VERIFIER (`pagCheck` compares signatures).
//
// The model, the round-7 certification numbers, and the full eligibility table:
// → docs/archive/pagination-rounds.md#arith-engine

// ─── Certified font palette ───────────────────────────────────────────────────────────────────
// The PRIMARY family name of each css stack the StyleBar can emit (CLAUDE.md math-certified list).
// ⚠ Certification is by PRIMARY family; the fallback tail only matters if the primary fails to
// load, and `document.fonts.check` then defers anyway (R9).
export const CERTIFIED_FAMILIES: ReadonlySet<string> = new Set([
  // ROUND-10 — all 18 verified on BOTH Chromium and WebKit in the editor's real context, and (the
  // load-bearing bit) their Chromium DOM wrap == their WebKit DOM wrap byte-for-byte at the
  // canonical width. → docs/archive/pagination-rounds.md#fonts-certified
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
  'Inter',
  // ⚠ A RETIRED FACE STAYS SERVED BUT UNLISTED (Lora, Gelasio). Deleting its woff2 would drop legacy
  // marks to SYSTEM fonts, whose metrics vary by device — silently repaginating old docs
  // phone-vs-print; unlisted, the engine DEFERS rather than computes their wrap (R8).
  // ⚠ NEVER SHIP AN OPTICAL-SIZE FONT. Chromium resolves opsz from font-size and WebKit does not,
  // and canvas has no such property at all — unusable by this engine from both directions. The
  // `:root { font-optical-sizing: none }` policy is the standing guard, not a live fix.
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

// ─── The MEASURABLE-ELEMENT abstraction ────────────────────────────────────────────────────────
// Every element that flows supplies a STABLE box: an INLINE advance + a line-box height demand, or
// a BLOCK height + collapsible margins. "Arithmetic-eligible" IS "reflow-free-measurable" — every
// element in the block supplies such a box AND the DOM verifier stays stable over it.
// ⚠ The box's source must be COMPUTED, or a one-time measure cached by an IMMUTABLE key — never a
// per-pagination reflow. Anything else DEFERS to the DOM measure, never guessed (R8).
// → docs/archive/pagination-rounds.md#arith-engine
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
  /** ⚠ A mark the engine neither models nor has PROVED metric-neutral (arithMeasure's
   *  MODELLED_MARKS / METRIC_NEUTRAL_MARKS). Set ⇒ blockEligibility REFUSES the block — carried as a
   *  reason, never as a metric (R8). → docs/archive/pagination-rounds.md#marks-allowlist */
  unmodelledMark?: string
  // ⚠ The run's EFFECTIVE COMPUTED white-space, read PER RUN. The editor is NOT globally
  // break-spaces: PM's injected sheet flips every NodeView/atom subtree to `normal`, and a citation
  // NodeView is `display:inline`, so its label FLOWS IN THE PARENT'S LINE — a citation-bearing
  // paragraph is genuinely MIXED-mode and must DEFER (R8).
  // → docs/archive/pagination-rounds.md#white-space
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
  // The strut's FAMILY — the block element's own computed font-family stack, i.e. what a run
  // inherits when it carries no textStyle:fontFamily mark. OPTIONAL: omit and the mixed-family
  // check below does not run, which is byte-identical to this engine's behaviour before 2026-07-17.
  // Supply it and a run whose family differs from the strut's DEFERS — see the note there.
  baseFontFamily?: string
  marginTopPx: number   // resolved margin-top (0 for paragraphs; used for adjacent-margin collapse)
  marginBottomPx: number// resolved margin-bottom (0.5em → 9px canonical for paragraphs)
  // A reflow-free-measurable BLOCK ATOM (block math, figure) supplies its box here — the block is
  // then one unbreakable region of `blockBox.height`. Present ⇒ the block is a measurable block atom
  // (paginated whole, never split); absent + type≠paragraph ⇒ defer to the DOM measure.
  blockBox?: BlockBox
  // OPTIONAL first-line baseline LEADING (px) — collectLines reads TEXT rects, which sit below the
  // line-box top by a per-(size, strut) constant. It CANCELS in intra-block deltas, so omitting it
  // leaves break POSITIONS and the page count byte-identical and only the cosmetic botMargin drifts
  // ≤3px at a size boundary. Break positions — the cross-device invariant — never depend on it.
  // → docs/archive/pagination-rounds.md#leading
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

// An inline math pill is an ATOMIC one-line unit: inline KaTeX renders in TEXTSTYLE, so its box is
// stable and formula-independent and simply makes ITS line taller. The engine has always computed
// math paragraphs correctly; what was in doubt was the DOM VERIFIER, whose per-block phantom lines
// the collectLines inline-atom collapse took to ZERO (co-requisite LANDED 2026-07-17).
// ⚠ `mathEligible` DEFAULTS FALSE and flipping it is a SEPARATE BEHAVIOUR CHANGE needing its own
// end-to-end proof — the co-requisite being satisfied unblocks it, it does not authorise it. Do not
// flip it as a side effect of something else (R8).
// ⚠ LINE_STABILITY_EPS still guards MIXED-SIZE TEXT — a genuine instability with no such fix,
// because differently-sized text rects reorder unfixably.
// → docs/archive/pagination-rounds.md#inline-atom-rect
export const LINE_STABILITY_EPS = 3

// `mathEligible` reflects whether the collectLines math-pill rect-fix is in place (the wire-in flag).
// The engine's CAPABILITY is unconditional; the flag only decides whether to trust the DOM verifier.
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
    // An unmodelled mark is exactly as unmeasurable as an uncertified font, and defers the same way.
    // Ordered BEFORE the font check only so the reason names the more specific cause.
    if (r.unmodelledMark) return { eligible: false, reason: `unmodelled-mark:${r.unmodelledMark}` }
    if (!isCertifiedStack(r.fontFamily)) return { eligible: false, reason: `uncertified:${primaryFamily(r.fontFamily)}` }
    // MIXED WHITE-SPACE: a run in a different mode wraps by a DIFFERENT rule on the SAME line, and
    // `normal` also COLLAPSES runs of spaces, which this engine does not model. Both unmodelled ⇒
    // DEFER — the guard that keeps a future citation-eligible paragraph honest.
    const rws = r.whiteSpace ?? whiteSpace
    if (rws !== whiteSpace) return { eligible: false, reason: `mixed-whitespace:${rws}` }
  }
  // Only the editor's own mode is proven end-to-end (break-spaces). Anything else defers rather than
  // trust an unproven rule — `normal` in particular needs space-collapsing the engine doesn't model.
  if (whiteSpace !== EDITOR_WHITE_SPACE) return { eligible: false, reason: `whitespace-unproven:${whiteSpace}` }
  // ⚠ MIXED FONT-SIZE among TEXT runs is DOM-ONLY: a taller run's rect top diverges >3px and, unlike
  // a math pill, has NO single-rect fix — the verifier is unfixably order-dependent, so it defers.
  const sizes = block.runs.filter((r) => !r.atomic && r.text !== '\n').map((r) => r.fontSizePx)
  if (sizes.length && sizes.some((s) => s !== sizes[0])) return { eligible: false, reason: 'mixed-size' }
  // ⚠ MIXED FAMILY vs THE STRUT IS DOM-ONLY TOO. A line box spans the strut AND every inline box on
  // it, so a run in a face whose baseline sits differently makes the line TALLER while the wrap —
  // and every self-consistency check built from it — stays perfect. Measured +1px for most certified
  // faces and +2 for IM Fell DW Pica: ~1.5 lines of drift per page.
  // ⚠ DEFER; DO NOT CORRECT IT. The correction needs per-face ascent/descent, and the only metrics
  // canvas exposes are ROUNDED TO WHOLE PIXELS — fed those, the formula mispredicts 6 of 16 cases by
  // 0.5px/line, ~22px over a page. A height we cannot compute is one we do not invent (R8).
  // → docs/archive/pagination-rounds.md#mixed-family
  if (block.baseFontFamily !== undefined) {
    const bad = block.runs.find((r) => !r.atomic && r.text !== '\n' && r.fontFamily !== block.baseFontFamily)
    if (bad) return { eligible: false, reason: `mixed-family:${primaryFamily(bad.fontFamily)}` }
  }
  return { eligible: true, reason: block.runs.some((r) => r.atomic) ? 'paragraph:text+math' : 'paragraph:text' }
}

// ⚠ THE USED LINE-BOX HEIGHT IS LAID OUT ON THE LayoutUnit GRID (1/64 px), FLOORED — not the exact
// float of ratio × font-size. Reproducing it exactly is what makes the arithmetic `used`/botMargin
// byte-identical to the DOM measure; the naive product drifts ~1px over a page and flips the
// gap-widget height. → docs/archive/pagination-rounds.md#lu-grid
export function snappedLineHeight(fontSizePx: number, ratio: number): number {
  return Math.floor(ratio * Math.round(fontSizePx * 64)) / 64
}

// ─── ENGINE SHAPING GATE ───────────────────────────────────────────────────────────────────────
// ⚠ THE GATE IS EMPIRICAL, NOT A CAPABILITY SNIFF. The editor renders with ligatures OFF and canvas
// applies them by default; its only lever (`ctx.textRendering`) is Chromium/Firefox-only, so an API
// check answered "never on any iPhone" — the wrong question once the served faces are ligature-
// STRIPPED. Probe whether canvas actually AGREES with the DOM for this font, once, and cache it: it
// is right in every combination and self-corrects when the pipeline ships stripped faces (R3).
// → docs/archive/pagination-rounds.md#shaping-gate
export const SHAPING_PROBE = 'office affluent finds difficult waffles fi fl ffi ffl AV To Wa'
const SHAPING_EPS = 0.05 // the same tolerance the font certification uses

/**
 * THE GATE. True ⇔ canvas measures this font exactly as the editor renders it; false ⇒ the
 * arithmetic path MUST NOT RUN for that font.
 * ⚠ `domWidth` MUST measure inside the REAL editor context (a span in .ProseMirror) — that is where
 * the ligature state lives, and a plain-div harness certifies a fiction (R5). Call once per font.
 */
export function canvasShapingMatchesEditor(
  cssFont: string,
  domWidth: (text: string, cssFont: string) => number,
  measure: Measure,
): boolean {
  try { return Math.abs(measure(SHAPING_PROBE, cssFont) - domWidth(SHAPING_PROBE, cssFont)) <= SHAPING_EPS }
  catch { return false }
}

/**
 * Whether this engine exposes ctx.textRendering (Chromium/Firefox yes; Safari never). NOT the gate
 * — makeCanvasMeasure uses it opportunistically, and it is worth logging, but a false here no
 * longer means "cannot run": with stripped faces canvas matches the editor without it.
 */
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
    // ⚠ MATCH THE EDITOR'S SHAPING, or every ligature is a wrap error. PM's injected sheet renders
    // f+i SEPARATELY; canvas applies ligatures by DEFAULT and measured "first"/"office"/"affluent"
    // 2-5px NARROWER — so the engine took a word the browser dropped. `optimizeSpeed` disables
    // ligatures; `fontKerning:'normal'` pins kerning ON explicitly, so we never rely on
    // optimizeSpeed's implied kerning. → docs/archive/pagination-rounds.md#shaping-gate
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

// ─── WHITE-SPACE MODE: whether a line's trailing space HANGS ───────────────────────────────────
// ⚠ NOT A DETAIL — IT DECIDES THE FIT TEST. The live editor computes `break-spaces` (PM's own
// injected sheet), where the trailing space NEVER hangs: it occupies width and counts toward the
// fit, so the PRODUCTION test is the FULL token width. A `normal`-mode harness silently takes a
// word the real editor drops — which is how a plain-<div> prover certified a wrap that cannot
// happen (R5). → docs/archive/pagination-rounds.md#white-space
export type WhiteSpaceMode = 'normal' | 'pre-wrap' | 'break-spaces'
/** The editor's real mode — ProseMirror sets break-spaces on .ProseMirror. The engine's default. */
export const EDITOR_WHITE_SPACE: WhiteSpaceMode = 'break-spaces'
/** Does a line's trailing space hang (excluded from the fit test)? Only when NOT break-spaces. */
export function hangsTrailingSpace(mode: WhiteSpaceMode): boolean { return mode !== 'break-spaces' }

// ─── The greedy line-breaker (multi-run, mixed-size) ───────────────────────────────────────────
// A token = a maximal non-break sequence up to and INCLUDING its trailing whitespace; a token
// carries its pieces (contiguous same-font substrings), width = Σ measure(piece); the line box
// height = ratio × max(baseFontPx, tallest run placed on the line).
const WRAP_EPS = 0.001 // r7's `> W + 0.001` — matches the browser's fractional-advance tolerance

// ⚠ QUANTISE THE FIT TEST TO THE LayoutUnit GRID (1/64 px), AND FLOOR — a line FITS when its
// grid-quantised width does, not its exact float. Canvas runs ~0.01px WIDER than the browser's
// grid-accumulated width over a line: invisible at canonical 18px, but at the render size it flips a
// boundary word and drifts the band by a whole line height.
// → docs/archive/pagination-rounds.md#lu-grid
const LU = 64 // LayoutUnits per CSS px
function luFloor(px: number): number { return Math.floor(px * LU + 1e-6) / LU } // +1e-6: float-safe ×64

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
    // Array.from → code points (surrogate-safe) + index, so we can look at the neighbours of a hyphen.
    const chars = Array.from(run.text)
    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci]
      if (ch === '\n') { pushBuf(); flush(); out.push('BR'); continue }
      buf += ch
      if (/\s/.test(ch)) { pushBuf(); flush(); continue } // whitespace ends the token (split-after-ws)
      // ⚠ HYPHEN-MINUS is a soft-break opportunity AFTER the hyphen, but ONLY between two
      // alphanumerics — an INTRA-WORD hyphen — so "3-4" and leading/trailing dashes get no spurious
      // break (R9). Without it a compound the browser splits wrapped whole: one extra line, and the
      // render band drifted a line height. → docs/archive/pagination-rounds.md#lu-grid
      if (ch === '-' && ci > 0 && ci + 1 < chars.length
        && /[\p{L}\p{N}]/u.test(chars[ci - 1]) && /[\p{L}\p{N}]/u.test(chars[ci + 1])) {
        pushBuf(); flush()
      }
    }
    pushBuf()
  }
  flush()
  return out
}

// Lay out one paragraph block into per-line geometry at a given content width. Pure arithmetic: no
// DOM, no layout read. ⚠ Assumes `blockEligibility(block).eligible` — a non-eligible block produces
// a WRONG result, which is exactly why the gate defers it.
// ⚠ `forcedBreakChars` are char offsets at which a line MUST START, so the RENDER pass honours the
// page gaps (a gap widget is `display:block` and ends the pre-gap line PARTIAL). EXACT, not "+1
// line": each offset ends its line partial and the tail RE-WRAPS from there, which cascades
// correctly. Empty/absent ⇒ byte-identical to the gap-free layout.
// → docs/archive/pagination-rounds.md#forced-breaks
export function layoutParagraph(block: ArithBlock, contentWidthPx: number, ratio: number, measure: Measure, whiteSpace: WhiteSpaceMode = EDITOR_WHITE_SPACE, forcedBreakChars: number[] = []): BlockLayout {
  const hang = hangsTrailingSpace(whiteSpace) // break-spaces (the editor) ⇒ false ⇒ the space counts
  const strut = snappedLineHeight(block.baseFontPx, ratio) // the paragraph's own font always occupies the line
  const leading = block.firstLineLeadingPx ?? 0 // baseline offset to match getClientRects text-rects
  const relTops: number[] = []
  const lineHeights: number[] = []
  const breakStartChars: number[] = [0]
  const tokens = tokenize(block.runs, measure, ratio)
  const forced = forcedBreakChars.length ? [...forcedBreakChars].sort((a, b) => a - b) : forcedBreakChars
  let fb = 0 // pointer into `forced`

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
    // FORCED BREAK (page gap): a line MUST start at this offset. Honour any forced offset landing
    // exactly at the current position BEFORE this token contributes — the pre-gap line ends here,
    // partial, and the token opens a fresh line. A forced offset at a natural line start (started
    // === false) is a no-op; one at charIdx 0 / the block start never fires. Runs before the fit
    // test so it can't double-break with a natural overflow at the same token.
    while (fb < forced.length && forced[fb] <= charIdx) {
      if (forced[fb] === charIdx && started) {
        closeLine()
        breakStartChars.push(charIdx)
        lineW = 0
        lineDemand = strut
        started = false
      }
      fb++
    }
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
    if (started && lineW > 0 && luFloor(lineW + fitW) > contentWidthPx + WRAP_EPS) {
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

// ─── Element box SOURCES: how each measurable type produces its reflow-free box ────────────────
// The extension point — a new measurable atom is a one-function plug-in, never a rewrite of the
// wrap/pagination core. ⚠ THE DISCIPLINE, FIXED FOR ANY NEW TYPE:
//   1. the box comes from COMPUTATION or a one-time measure cached by an IMMUTABLE key — never a
//      per-pagination reflow;
//   2. an INLINE box must clear the LINE_STABILITY_EPS fit check or the block DEFERS (the DOM
//      verifier would miscount its line);
//   3. geometry that is NOT stable (a citation label; a mixed-size line's rects) DEFERS (R8) — the
//      idle DOM measure stays the verifier and pagCheck catches any divergence.
// → docs/archive/pagination-rounds.md#element-box-sources

// A figure/image BLOCK box from its specified or intrinsic dimensions + an optional caption. Pure —
// no reflow, no measure, just its box model, honouring the `max-width:100%` shrink. No figure node
// exists in the schema yet: this is the documented extension point, ready to wire when one lands.
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

// ─── Page splitter (a port of PaginationExtension.computeBreaks) ───────────────────────────────
// Same math as the live break loop, emitting the same `at:round(botMargin)|…|pages:N` signature so a
// prover can compare arithmetic-sourced lines against DOM-sourced lines through ONE splitter.
// Desktop/canonical only — the phone bottom-margin branch is not modelled.
// ⚠ THIS IS ONE OF THREE COPIES OF THE BREAK RULE, and its orphan snap HAD DRIFTED from production.
// `snapOrphans` now DEFAULTS to production's `false`; the retired rule must be opted IN (R2).
// ⚠ A PROVER RUNNING BOTH SIDES THROUGH THIS FUNCTION CANNOT SEE THAT DRIFT — a shared constant
// cancels on both sides, and a unit test can only see a rule it VARIES (R6). Only the live editor's
// own gap widgets can (breaks.prove.mjs). → docs/archive/pagination-rounds.md#three-copies
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
  snapOrphans = false,      // matches production (computeBreaks `snap = false`). Opt IN for legacy.
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
      const snap = snapOrphans && orphan <= textArea * 0.22 && blockStart > 0
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

// ⚠ `document.fonts.check()` RETURNS TRUE FOR A FAMILY WITH NO @font-face — the system fallback
// counts, so the check silently measures a fallback against itself and "agrees" at 0.000. Compare
// the family's advance against MONOSPACE's instead (R6).
// ⚠ It lives HERE, not in a caller: /snapshot's break-table build needs the same check and an
// editor-less route cannot borrow the editor's. One implementation, two callers (R2).
// → docs/archive/pagination-rounds.md#font-loaded
export function makeFontLoaded(measure: Measure): (stack: string, sizePx: number) => boolean {
  const cache = new Map<string, boolean>()
  const PROBE = 'iiiiiiiiiiWWWWWWWWWW'
  return (stack: string, sizePx: number): boolean => {
    const key = `${stack}|${sizePx}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let ok = false
    try {
      ok = document.fonts.check(`${sizePx}px ${stack}`)
      if (ok) {
        const w = measure(PROBE, `400 ${sizePx}px ${stack}`)
        const mono = measure(PROBE, `400 ${sizePx}px monospace`)
        // A proportional face cannot have the same advance as monospace for this probe. Equal ⇒ we
        // are measuring the fallback, i.e. the face never loaded.
        if (Math.abs(w - mono) < 0.01) ok = false
      }
    } catch { ok = false }
    cache.set(key, ok)
    return ok
  }
}
