// ARITHMETIC LAYOUT ENGINE (2026-07-14 — the designed follow-up to the math-certified fonts work).
//
// A THIRD acquisition path for PaginationExtension.collectLines: instead of forcing a full-document
// browser reflow and reading each block's line geometry with range.getClientRects (path 1) or
// replaying a per-node block-relative cache (path 2, the round-6/7 LineCache), this path COMPUTES a
// paragraph's line wrapping from per-run canvas advance widths and a greedy line-breaker — no DOM
// read of that block's text layout at all. The output is byte-identical in shape to what
// collectLines produces (per-line intrinsic tops + block boundaries), so it feeds the SAME
// computeBreaks page-splitter and the SAME page-break signatures result.
//
// WHY THIS IS SOUND (the certification, round-7): canvas `measureText` reproduces the browser's
// advance widths to Δ≤0.05px, AND a greedy break at a fixed width lands on the SAME word boundaries,
// but ONLY for the certified font palette (see CERTIFIED_FAMILIES). Uncertified fonts diverge on
// integer-px advance quantization (hinting/ligature rounding) — a divergence that is fatal here
// because canonical page breaks must be CROSS-DEVICE IDENTICAL (a wrong break = the same text on a
// different page on phone/print). So this engine is CONSERVATIVE BY CONSTRUCTION: it refuses any
// block it cannot prove it can reproduce and hands it back to the DOM path. Correctness over
// cleverness — it never approximates; it defers.
//
// ELIGIBILITY (what this engine handles arithmetically vs what it DEFERS to DOM measure):
//   ARITHMETIC-ELIGIBLE:  a `paragraph` whose inline content is ONLY text runs (marks: bold,
//     italic, underline, textStyle{fontFamily,fontSize}) AND every run resolves to a CERTIFIED
//     font family. Mixed runs (bold/italic/size changes mid-line) ARE handled — the line box takes
//     the tallest run (ratio × max font-size), and a word that straddles a mark boundary is
//     measured piece-by-piece in each piece's own font.
//   DOM-ONLY (deferred — never guessed):
//     • any paragraph containing an inline ATOM NodeView — `citation` labels (React output, shadow
//       geometry; measure ~9px off even on plain paths) or inline `math` (KaTeX shadow DOM);
//     • any run in an UNCERTIFIED font (system fonts, failed-calibration families);
//     • non-paragraph blocks: `orderedList`/`bulletList`/`taskList` (marker + indent + nested-para
//       box model), `horizontalRule`, `referenceList` (atom NodeView), `mathBlock`, images, tables.
//   The eligibility test returns the exact reason, so the wire-in can log a per-doc coverage map.
//
// GATE: run this path ONLY after `document.fonts.ready` AND when every run in the block is certified
// AND loaded. Before fonts settle, or on any uncertified run, fall back to the DOM measure. A full
// DOM measure still runs as the idle VERIFIER (pagCheck compares signatures) — so any divergence
// this engine ever produced is caught and corrected within the lazy re-verify window.
//
// Pure module: no DOM, no ProseMirror imports in the core (a canvas 2d context is injected as the
// measure function). Unit/parity-testable in a browser harness without the app — see the prover
// scratchpad/r9-arith-prove.mjs.

// ─── Certified font palette ───────────────────────────────────────────────────────────────────
// The PRIMARY family name of each css stack the StyleBar can emit (CLAUDE.md math-certified list).
// Certification is by PRIMARY family: the stack '\'EB Garamond\', Georgia, serif' is eligible
// because EB Garamond loads and is certified; the Georgia/serif tail only matters if the primary
// fails to load (in which case document.fonts.check is false → gate defers).
export const CERTIFIED_FAMILIES: ReadonlySet<string> = new Set([
  'IM Fell DW Pica',
  'EB Garamond',
  'TeX Gyre Termes',
  'TeX Gyre Heros',
  'Crimson Pro',
  'Spectral',
  'Lora',
  'Gelasio',
  'Gentium Plus',
  'Cormorant Garamond',
  'Fraunces',
  'Bitter',
  'Carlito',
  'Atkinson Hyperlegible',
  'JetBrains Mono',
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

// ─── Run / block model ────────────────────────────────────────────────────────────────────────
export interface InlineRun {
  text: string        // the run's characters ('\n' is a hard break; see layoutParagraph)
  fontFamily: string  // resolved CSS font-family STACK (the value the mark applies)
  fontSizePx: number  // resolved px (em marks already resolved against the block base font)
  fontWeight: number  // 400 | 700 (synthetic-bold weights collapse to nearest; caller resolves)
  italic: boolean
  atomic?: boolean    // inline atom (citation/math NodeView) — makes the whole block DOM-only
}

export interface ArithBlock {
  type: string          // 'paragraph' is the only arithmetic-eligible type
  runs: InlineRun[]     // ordered inline content
  baseFontPx: number    // the block element's OWN computed font-size (18 at canonical) — the strut
  marginTopPx: number   // resolved margin-top (0 for paragraphs; used for adjacent-margin collapse)
  marginBottomPx: number// resolved margin-bottom (0.5em → 9px canonical for paragraphs)
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

// The reason strings double as the coverage-map keys in the prover/wire-in diagnostics.
export function blockEligibility(block: ArithBlock): Eligibility {
  if (block.type !== 'paragraph') return { eligible: false, reason: `block:${block.type}` }
  if (!block.runs.length) return { eligible: true, reason: 'paragraph:empty' }
  for (const r of block.runs) {
    if (r.atomic) return { eligible: false, reason: 'inline-atom' }
    if (!isCertifiedStack(r.fontFamily)) return { eligible: false, reason: `uncertified:${primaryFamily(r.fontFamily)}` }
  }
  // MIXED FONT-SIZE within a paragraph is DOM-ONLY. Not because the wrap can't be computed — it
  // can — but because a mixed-size line's per-line geometry is read via range.getClientRects, and
  // the browser returns a SEPARATE rect per differently-sized inline box at a DIFFERENT top (shared
  // baseline ⇒ different box tops). collectLines' rect-dedup (skip `r.top - lastTop <= 3`) then
  // counts a line beginning with a TALL run followed by a short run as TWO lines — an artifact that
  // depends on run order, so the DOM measure ITSELF is not a stable reference for these paragraphs.
  // The arithmetic engine cannot prove parity against an unstable reference, so it defers (the whole
  // system paginates these via that same heuristic — deferring keeps the arith path == the DOM path
  // by construction). Uniform size (all runs equal, incl. all-base bold/italic/family runs) is fine.
  const sizes = block.runs.filter((r) => r.text !== '\n').map((r) => r.fontSizePx)
  if (sizes.length && sizes.some((s) => s !== sizes[0])) return { eligible: false, reason: 'mixed-size' }
  return { eligible: true, reason: 'paragraph:text' }
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

interface Piece { text: string; font: string; sizePx: number }
interface Token { pieces: Piece[]; fullW: number; bareW: number; maxSizePx: number; len: number }

// Flatten a paragraph's runs into a per-token stream (tokens split after each whitespace char),
// each token measured full + bare. '\n' (hard break) is emitted as a sentinel token (len counts it).
function tokenize(runs: InlineRun[], measure: Measure): Array<Token | 'BR'> {
  const out: Array<Token | 'BR'> = []
  let cur: Piece[] = []
  let curLen = 0
  const flush = () => {
    if (!cur.length) return
    // full width
    let fullW = 0
    let maxSizePx = 0
    for (const p of cur) { fullW += measure(p.text, p.font); if (p.sizePx > maxSizePx) maxSizePx = p.sizePx }
    // bare width: strip trailing whitespace off the END of the token (ws only ever sits at the end)
    const bare = cur.map((p) => ({ ...p }))
    for (let i = bare.length - 1; i >= 0; i--) {
      const stripped = bare[i].text.replace(/\s+$/, '')
      if (stripped === bare[i].text) break // no trailing ws in this piece → done
      bare[i].text = stripped
      if (stripped.length > 0) break // stripped some ws but content remains → done
      // piece became empty (was all trailing ws) → continue stripping the previous piece
    }
    let bareW = 0
    for (const p of bare) if (p.text) bareW += measure(p.text, p.font)
    out.push({ pieces: cur, fullW, bareW, maxSizePx, len: curLen })
    cur = []
    curLen = 0
  }
  for (const run of runs) {
    const font = cssFontOf(run)
    let buf = ''
    const pushBuf = () => { if (buf) { cur.push({ text: buf, font, sizePx: run.fontSizePx }); curLen += buf.length; buf = '' } }
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
export function layoutParagraph(block: ArithBlock, contentWidthPx: number, ratio: number, measure: Measure): BlockLayout {
  const base = block.baseFontPx
  const leading = block.firstLineLeadingPx ?? 0 // baseline offset to match getClientRects text-rects
  const relTops: number[] = []
  const lineHeights: number[] = []
  const breakStartChars: number[] = [0]
  const tokens = tokenize(block.runs, measure)

  let top = 0
  let lineW = 0
  let lineMax = base            // strut floor: the paragraph's own font always occupies the line box
  let charIdx = 0
  let started = false           // has any token landed on the current line yet?

  const closeLine = () => {
    const lh = snappedLineHeight(lineMax, ratio) // LayoutUnit-floored — byte-matches the DOM measure
    relTops.push(top + leading)   // report at the text-rect position (height/advance stay leading-free)
    lineHeights.push(lh)
    top += lh
  }

  for (const tk of tokens) {
    if (tk === 'BR') {
      // Hard break: end the current line here; the next token starts a fresh line.
      closeLine()
      lineW = 0
      lineMax = base
      started = false
      charIdx += 1 // the '\n' occupies one position in the block text
      breakStartChars.push(charIdx)
      continue
    }
    if (tk.len === 0) continue
    if (started && lineW > 0 && lineW + tk.bareW > contentWidthPx + WRAP_EPS) {
      // This token overflows → break BEFORE it. Close the line; the token opens the next one.
      closeLine()
      breakStartChars.push(charIdx)
      lineW = tk.fullW
      lineMax = Math.max(base, tk.maxSizePx)
    } else {
      lineW += tk.fullW
      lineMax = Math.max(lineMax, tk.maxSizePx)
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
  reason: string
}

export interface DomBlockMeasure {
  (index: number): { relTops: number[]; advance: number } // the DOM fallback for a deferred block
}

// Resolve every block, arithmetic where eligible + certified, DOM otherwise. `fontLoaded(run)` is
// the gate check (document.fonts.check) — a run whose face is not yet loaded forces the DOM path
// even if the family is certified (measureText would use a fallback face pre-load).
export function resolveBlocks(
  blocks: ArithBlock[],
  contentWidthPx: number,
  ratio: number,
  measure: Measure,
  domMeasure: DomBlockMeasure,
  fontLoaded: (run: InlineRun) => boolean = () => true,
): ResolvedBlock[] {
  const out: ResolvedBlock[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const elig = blockEligibility(b)
    const facesReady = elig.eligible && b.runs.every((r) => fontLoaded(r))
    if (elig.eligible && facesReady) {
      const lay = layoutParagraph(b, contentWidthPx, ratio, measure)
      // ADJACENT-SIBLING MARGIN COLLAPSE: the top-to-top advance below this block is its content
      // height plus the COLLAPSED margin with the next block — max(this.marginBottom,
      // next.marginTop), not their sum. Paragraph→paragraph is max(9,0)=9 (why plain-para docs
      // never showed this), but paragraph→hr / →list / →refList collapses to the larger leading
      // margin (e.g. max(9,12)=12). The last block's advance is unused (never breaks below it).
      const next = i + 1 < blocks.length ? blocks[i + 1] : null
      const collapsed = next ? Math.max(b.marginBottomPx, next.marginTopPx) : b.marginBottomPx
      out.push({ relTops: lay.relTops, advance: lay.height + collapsed, eligible: true, reason: elig.reason })
    } else {
      const dm = domMeasure(i)
      // Structural ineligibility keeps its reason (block:hr, inline-atom, mixed-size, uncertified:…);
      // only an ELIGIBLE block whose faces haven't loaded is 'fonts-unloaded'.
      const reason = elig.eligible ? 'fonts-unloaded' : elig.reason
      out.push({ relTops: dm.relTops, advance: dm.advance, eligible: false, reason })
    }
  }
  return out
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
