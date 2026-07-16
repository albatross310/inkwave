// PLAINTEXT PAGE RENDERER (2026-07-16 — flag `inkwave:textRender`, default OFF).
//
// Peter's idea: a page PREVIEW is just text + highlight rectangles. It does not need ProseMirror,
// the DOM, or a reflow. We already own the hard half — arithmeticLayout computes canonical line
// breaks from canvas measureText advances, and that wrap is CERTIFIED to match the editor
// (CERTIFIED_FAMILIES + the fonttools ligature strip + luFloor quantisation). So: run the arith
// engine to get line breaks, then fillText each line onto a canvas. No DOM, no editor, no reflow.
//
// This module is a MEASUREMENT PROTOTYPE. It exists to answer "is this fast enough, and faithful
// enough, to replace the snapshot thumbnail bake?" — not to ship. Read the honest limits below.
//
// TWO PAINT MODES (the map-pane hypothesis, 2026-07-16):
//   • 'text'  — fillText each line's runs. The real preview.
//   • 'rects' — one filled rect per line (x, baseline-ish band, run length). At MINIMAP scale no
//               glyph is resolvable, so the only information that survives is WHERE lines are and
//               HOW LONG they run — which the layout already knows.
//     NB THE HONEST FRAMING: 'rects' does NOT "skip shaping". The line BREAKS come from
//     measureText, which IS shaping — that cost is identical in both modes. 'rects' skips only
//     RASTERISATION (fillText). So the mode difference measures exactly one thing: is a page's cost
//     dominated by glyph raster, or by layout? Do not claim more than that from it.
//
// HONEST LIMITS (each is a DEFER, never a guess — the same discipline as the engine's eligibility):
//   • Text blocks = `paragraph` only, in certified+loaded fonts, uniform size (blockEligibility).
//   • EVERYTHING ELSE (figure, math, embedded PDF, list, rule, refList, heading) draws a LABELLED
//     PLACEHOLDER BOX at a declared/estimated height. It does NOT pretend to render. A placeholder
//     whose height is estimated is a real fidelity gap and the coverage map reports it.
//   • `justify` alignment is NOT modelled (the browser distributes slack across spaces) — a
//     justified paragraph renders left-aligned and is reported as a gap, not silently drawn wrong.

import type { Node as PMNode } from '@tiptap/pm/model'
import {
  type ArithBlock, type InlineRun, type Measure, type SplitLine,
  blockEligibility, layoutParagraph, paginate, cssFontOf, snappedLineHeight,
  EDITOR_WHITE_SPACE, MARGIN_BOTTOM_PX,
} from './arithmeticLayout'
import { citeBox, citeFontKey } from '../citations/citeBox'
import { blockStyle, type BlockStyle } from './blockStyles'
import { pageBoxPx } from './pageModel'
import { getPaperSize, getOrientation, getTopMarginPx, getSideMarginPx, getParaSpacingEm } from './pageSettings'

// The flag lives in its own module so the editor can gate on it WITHOUT static-importing this
// paint path — see textRenderFlag.ts. Re-exported here for callers that already have the renderer.
export { textRenderEnabled, _resetTextRenderFlag } from './textRenderFlag'

// ─── Geometry ─────────────────────────────────────────────────────────────────────────────────
export interface RenderGeom {
  pageWidthPx: number
  pageHeightPx: number
  topMarginPx: number
  sideMarginPx: number
  contentWidthPx: number  // pageWidthPx − 2·sideMargin
  basePx: number          // canonical body font px (18 = 1.125rem)
  ratio: number           // --inkwave-lh (φ = 1.618 desktop)
  paraSpacingEm: number   // paragraph margin-bottom in em (0.5 canonical)
}

// ─── Render model ─────────────────────────────────────────────────────────────────────────────
export interface RenderSeg {
  text: string
  font: string   // css font shorthand (canvas + DOM agree on this string)
  x: number      // px from the content-box left edge
  w: number      // advance width
  startChar: number // block-relative char index this seg starts at (highlight mapping)
  // Set when this seg is an inline ATOM (a citation chip) rather than text. Its `w` is the MEASURED
  // box advance, so it occupies exactly the right space on the line; it carries no glyphs to draw.
  atom?: string
}

export interface RenderLine {
  top: number        // absolute px from the content top (before pagination)
  height: number     // line-box height
  blockIdx: number
  pos: number        // doc position of the line's first char
  startChar: number  // block-relative char index
  endChar: number
  segs: RenderSeg[]
  indentPx?: number  // list items sit indented; the marker hangs to the left of this
  marker?: string    // '•' / '1.' — drawn once, on the item's FIRST line only
}

export type BlockKind = 'text' | 'placeholder'

export interface RenderBlock {
  kind: BlockKind
  type: string       // PM node type name
  start: number      // doc position of the block start
  end: number
  top: number
  height: number
  label?: string     // placeholder label ('figure', 'equation', 'embedded PDF', …)
  estimated?: boolean // placeholder height is a GUESS (fidelity gap — reported, never hidden)
}

export interface RenderModel {
  lines: RenderLine[]
  blocks: RenderBlock[]
  pageOfLine: number[]    // page index (0-based) per line
  pageTop: number[]       // absolute top of each page's first line
  pages: number
  contentHeight: number
  coverage: Record<string, number> // reason → block count (the honest coverage map)
  breaks: Array<{ at: number; botMargin: number }> // the splitter's own output (for prover comparison)
  sig: string             // the page-break signature — comparable byte-for-byte with the live path
  // ── RELIABILITY IS POSITIONAL, NOT A DOCUMENT-WIDE BOOLEAN (2026-07-17) ────────────────────
  // A placeholder with a guessed height does not merely look wrong — it MOVES EVERY PAGE BREAK
  // AFTER IT, silently, and the pages then carry the wrong words while the renderer reports
  // success. But it only moves the breaks BELOW it: everything above is unaffected.
  // A whole-model boolean therefore reported EVERY thesis unreliable (they all have a
  // bibliography, which is force-broken onto its own page at the very END) and said nothing about
  // WHERE — throwing away ~57 of 58 perfectly exact pages. So:
  //   pages [0, reliablePages) are trustworthy; from reliablePages on, they are not.
  // This is the general contract for "we estimated something here" — any future estimated block
  // inherits it, not just the refList.
  breaksReliable: boolean        // convenience: reliablePages === pages (nothing estimated at all)
  reliablePages: number          // count of leading pages whose breaks are trustworthy
  firstEstimatedPos: number | null // doc position of the first estimated block (null ⇒ none)
  estimatedBlocks: number
}

// A placeholder's height when the node declares none. This IS a guess; `estimated` flags it.
const PLACEHOLDER_FALLBACK_H = 120

/**
 * THE DOC POSITION A BLOCK'S FIRST LINE SITS AT — and the one place a LEAF ATOM differs.
 *
 * For a normal block (paragraph, heading, listItem, bulletList…) the content starts at `offset + 1`
 * (past the opening token), which is what every line's pos is built from.
 *
 * A LEAF ATOM (`referenceList`, `mathBlock`, `horizontalRule`) has NO content and `nodeSize === 1`:
 * it occupies exactly `[offset, offset + 1)`. So `offset + 1` is not "inside" it — it is the position
 * AFTER it, which belongs to the next block (or, for a trailing atom, is the doc end). Giving an
 * atom's line `offset + 1` makes it claim a position it does not own, and leaves its OWN position
 * pointing at the previous block's page.
 *
 * MEASURED (tail.prove.mjs, thesis-shape, real app): the trailing `referenceList` at start=122267
 * end=122268 got line pos 122268 = doc.content.size, so `pageContainingPos(122267)` — the refList's
 * own position — returned page 56 while the refList rendered on page 57. That is
 * `lastPageReachableByContent: false`, and with `refList:false` the same fixture reports TRUE.
 *
 * WHY THE SELF-CONSISTENCY CHECKS COULD NOT SEE IT: `pageOfLine`, `pageTop` and the page walk are
 * all built from the SAME line list, so they agree with each other perfectly — every page has a
 * line, `maxPageOfLine === pages-1`, `pageTopLen === pages`, `pos` is monotonic. The error is in
 * what a line's pos MEANS, and nothing that derives from the line list can check that. Only a query
 * from OUTSIDE — "which page holds this doc position?" — can, which is exactly the seam
 * RichDiffView and the content anchor both use.
 *
 * THE LIVE KNOWN-NEGATIVE: `window.__iwAtomPos = 'legacy'` restores the bug (every block gets
 * `offset + 1`). A probe asserting the fix MUST reproduce the failure through this before its pass
 * means anything — the round-11 `__iwAnchorRule='scrolltop'` pattern. Reading it costs one property
 * check per placeholder block, off any input path.
 */
const blockFirstLinePos = (node: PMNode, offset: number): number => {
  if (typeof window !== 'undefined' && (window as unknown as { __iwAtomPos?: string }).__iwAtomPos === 'legacy') return offset + 1
  return node.isLeaf ? offset : offset + 1
}

// ─── Line-rect tone calibration (MEASURED 2026-07-16, not chosen) ─────────────────────────────
// A line drawn as a solid bar is far darker than the text it stands for, and at map scale tone IS
// the signal — the eye reads a page thumbnail as grey texture, so getting the density wrong makes
// the strip read as a barcode even when every line is in exactly the right place.
// Measured on the real editor's own pixels, downscaled to map scale (scripts/textrender-probe/
// mapcompare.mjs), mean ink density over the content box:
//     real thumbnail 6.71%   ·   text render 6.73%   ·   line-rects @0.42/0.72 = 22.27%
// So the bar was 3.3× too dark. Effective coverage = bandRatio × alpha; matching 6.71/22.27 of the
// old 0.42 × 0.72 = 0.3024 gives ≈0.091. Keeping the band at 0.42 (thinner bands alias away at map
// scale, where a band is only ~3 device px) puts alpha at 0.217.
// CAVEAT, stated rather than buried: this is calibrated to EB Garamond at the canonical 18px. A
// different face/size has a different ink density, so this is a per-font constant that happens to be
// hard-coded to the identity serif — re-measure before trusting it for another face.
const MAP_BAND_RATIO = 0.42
const MAP_BAND_ALPHA = 0.217

const PLACEHOLDER_LABEL: Record<string, string> = {
  figure: 'figure', image: 'image', mathBlock: 'equation', pdf: 'embedded PDF',
  horizontalRule: 'rule', bulletList: 'list', orderedList: 'list', taskList: 'list',
  referenceList: 'references', codeBlock: 'code', blockquote: 'quote', table: 'table',
  heading: 'heading',
}

const DEFAULT_STACK = "'EB Garamond', Georgia, serif"

function resolveSizePx(v: unknown, basePx: number): number {
  if (typeof v !== 'string') return basePx
  const s = v.trim()
  if (s.endsWith('em') && !s.endsWith('rem')) return basePx * parseFloat(s)
  if (s.endsWith('rem')) return 16 * parseFloat(s)
  if (s.endsWith('px')) return parseFloat(s)
  const n = parseFloat(s)
  return isNaN(n) ? basePx : n
}

// One text node → an engine run. Mirrors arithMeasure.runOf (same mark resolution) so the two
// paths can never disagree about what a run IS.
function runOf(node: PMNode, basePx: number): InlineRun {
  let family = DEFAULT_STACK, size = basePx, weight = 400, italic = false
  for (const m of node.marks || []) {
    if (m.type.name === 'bold') weight = 700
    else if (m.type.name === 'italic') italic = true
    else if (m.type.name === 'textStyle' && m.attrs) {
      if (m.attrs.fontFamily) family = m.attrs.fontFamily as string
      if (m.attrs.fontSize) size = resolveSizePx(m.attrs.fontSize, basePx)
    }
  }
  return { text: node.text || '', fontFamily: family, fontSizePx: size, fontWeight: weight, italic }
}

// One paragraph's inline content → engine runs. Mirrors arithMeasure.runsOfParagraph EXACTLY (same
// mark resolution, same citeBox lookup) so the renderer and the canonical measure can never disagree
// about what a paragraph contains.
//
// CITATIONS (wired 2026-07-16 — Peter: "can't you do a math version that includes citations? just
// calculates how long they are and includes it in the math?"). A citation IS a proven opaque box:
// CitationNodeView pins `white-space: nowrap`, so its label has no internal break opportunity and
// the parent line can only break BEFORE or AFTER it — one unbreakable advance, measurable once and
// cached by an immutable key (citations/citeBox.ts). Supplying it is what lets a citation-bearing
// paragraph render arithmetically instead of placeholdering out; without it Peter's thesis (174
// citations) would placeholder ~every paragraph.
//
// SELF-HEALING, NOT GUESSING: a key that isn't cached (new citekey, bibliography not yet hydrated,
// CSL style switch, wrong measurement base) returns null ⇒ no box ⇒ blockEligibility's `!r.box` gate
// DEFERS that block to a labelled placeholder. We never invent an advance that is about to change.
// Anything else atomic (inline math) still supplies no box and still defers, by the same rule.
function runsOfParagraph(node: PMNode, basePx: number, citationStyle: string, bibEpoch: number): InlineRun[] {
  const runs: InlineRun[] = []
  node.forEach((child) => {
    if (child.type.name === 'text') runs.push(runOf(child, basePx))
    else if (child.type.name === 'hardBreak')
      runs.push({ text: '\n', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false })
    else {
      const box = child.type.name === 'citation'
        ? citeBox((child.attrs.citekeys as string[]) ?? [], citationStyle, bibEpoch, citeFontKey(child.marks), basePx) ?? undefined
        : undefined
      runs.push({
        text: '', fontFamily: DEFAULT_STACK, fontSizePx: basePx, fontWeight: 400, italic: false,
        atomic: true, atomType: child.type.name, box,
      })
    }
  })
  return runs
}

// The block's concatenated char stream + a parallel run index per char. charIdx here is EXACTLY the
// engine's charIdx (tokenize counts run.text.length per text run, 1 per atom, 1 per '\n'), which is
// what makes breakStartChars sliceable back into drawable segments.
function blockChars(runs: InlineRun[]): { text: string; runAt: number[] } {
  let text = ''
  const runAt: number[] = []
  runs.forEach((r, ri) => {
    const s = r.atomic ? '█' : r.text // an atom occupies exactly one position
    text += s
    for (let i = 0; i < s.length; i++) runAt.push(ri)
  })
  return { text, runAt }
}

// Slice one line [startChar, endChar) into per-run drawable segments with x offsets.
function segsOfLine(
  runs: InlineRun[], chars: { text: string; runAt: number[] },
  startChar: number, endChar: number, measure: Measure,
): RenderSeg[] {
  const segs: RenderSeg[] = []
  let x = 0
  let i = startChar
  while (i < endChar) {
    const ri = chars.runAt[i]
    if (ri === undefined) break
    let j = i
    while (j < endChar && chars.runAt[j] === ri) j++
    const run = runs[ri]
    if (run.atomic) {
      // An inline atom OCCUPIES ITS ADVANCE. Skipping it (as the first cut did) left x short by the
      // citation's whole width, so every word after a citation on that line drew in the wrong place
      // — invisible until citations were actually wired. A block whose atom has no box never gets
      // here: blockEligibility defers it.
      if (run.box) {
        segs.push({ text: '', font: '', x, w: run.box.advanceWidth, startChar: i, atom: run.atomType ?? 'atom' })
        x += run.box.advanceWidth
      }
    } else {
      const text = chars.text.slice(i, j)
      const font = cssFontOf(run)
      const w = measure(text, font)
      segs.push({ text, font, x, w, startChar: i })
      x += w
    }
    i = j
  }
  return segs
}

// ─── Build ────────────────────────────────────────────────────────────────────────────────────
/**
 * Lay the whole document out arithmetically and page it. Pure apart from the injected `measure`
 * (a canvas 2d context) — no DOM reads, no reflow.
 *
 * `fontLoaded(stack, sizePx)` MUST be real: canvas measureText silently falls back to a system face
 * for an unloaded font and would then "agree" with nothing. An unloaded run defers its block.
 */
export interface BuildOpts {
  /** CSL style id + bibliography epoch — the citeBox cache key. Must be the SAME values the DOM
   *  canonical measure harvested under (getCitationStyle() / bibProvider.getVersion()), or every
   *  lookup misses and every citation-bearing block placeholders out. */
  citationStyle?: string
  bibEpoch?: number
  // ── WINDOW MODE (2026-07-17) ─────────────────────────────────────────────────────────────────
  // PROVED first, then built: a page laid out from its own break position reproduces the full
  // model's line starts EXACTLY, with zero prefix (30/30, 31/31, 31/31 at 2k/10k/40k; mid-line
  // negatives collapse to 0/31). Because a break `at` IS a line start and greedy wrap restarts
  // deterministically there. So the prefix is needed ONLY to FIND the break — never to lay out
  // the page.
  /** Lay out starting at this doc position (must be a LINE START — a break table entry). */
  from?: number
  /** Stop once this much height is laid out. THE WHOLE POINT: cost becomes O(window), not O(doc).
   *  Without it the walk lays out the entire tail (measured 57-60ms at 40k) — which is what the
   *  crux test did, and why its timings must not be quoted as the renderer's cost. */
  maxHeight?: number
  // ── INCREMENTAL: THE PER-BLOCK LAYOUT CACHE (2026-07-17) ─────────────────────────────────────
  /** Reuse identical blocks' layout across versions. Omit ⇒ the byte-identical full path.
   *  See makeBlockLayoutCache() for the theorem this rests on and the invalidation contract. */
  blockCache?: BlockLayoutCache
}

// ─── Incremental block cache ──────────────────────────────────────────────────────────────────
// PETER'S TARGET: "if we can get it under 1s we can just load it when the snapshots screen loads
// up" — <1s for 116 versions ⇒ <8.6ms/version, from a naive 62-82ms.
//
// THE THEOREM IT RESTS ON (confirmed, not assumed): `layoutParagraph(block, contentWidthPx, ratio,
// measure, whiteSpace)` takes ONLY the block. No prefix, no preceding state, no document. Line
// wrapping never crosses a block boundary, so a block's layout is a pure function of its own runs
// and its width/font context. Everything a block's position depends on — `top`, `posBase`,
// `blockIdx` — is applied by emitTextBlock as a pure OFFSET after the layout exists. So reuse is
// the SAME ARITHMETIC, not an approximation: cache the block-relative geometry, re-emit at the new
// offsets. This is the same rule the editor's `computeScoped` already runs on (unchanged blocks
// reuse cached block-relative lines at the previous measure's tops).
//
// KEYED ON A CONTENT HASH, NEVER ON A DIFF. A diff (`opsBetween`) would be cheaper, but a wrong
// diff SILENTLY REUSES WRONG LAYOUT — it paints the right words on the wrong page and reports
// success. A content hash cannot: if the bytes differ, the key differs. The key is
// self-validating, which is the whole difference between a fast renderer and a fast renderer that
// is subtly wrong. Two independent 32-bit FNV-1a streams ⇒ an effective 64-bit key: collisions are
// the ONLY way this can under-invalidate, and under-invalidation is the direction that paints wrong
// words, so the extra stream is cheap insurance (the same asymmetry as bibSignature's whole-entry
// hash).
//
// INVALIDATION IS THE CALLER'S JOB, and it is the same contract the canonical measure's block-line
// WeakMap already carries: the key covers the block's CONTENT and its LAYOUT PARAMS, but NOT the
// font-loading state that `measure` closes over. Fonts change advances. So the caller MUST drop the
// cache whenever the canonical context moves (fonts ready/'loadingdone', page settings,
// bibliography hydration) — exactly where clearLineCache already sits. A table's `contextSig`
// covers the same ground for the persisted layer.
export interface BlockCacheStats {
  hits: number
  misses: number
  entries: number
  evicted: number
}

interface CachedBlock {
  relTops: number[]
  lineHeights: number[]
  startChars: number[]
  endChars: number[]
  segs: RenderSeg[][] // block-relative (x from the content-box left, startChar block-relative)
  height: number
}

export interface BlockLayoutCache {
  map: Map<string, CachedBlock>
  stats: BlockCacheStats
  max: number
}

/** A block-layout cache. Bounded FIFO — evictions are counted, never silent. */
export function makeBlockLayoutCache(max = 4000): BlockLayoutCache {
  return { map: new Map(), stats: { hits: 0, misses: 0, entries: 0, evicted: 0 }, max }
}

/**
 * The content+context key. Hashes EVERYTHING the wrap is a function of and nothing it isn't:
 * `top`/`posBase`/`blockIdx`/`marker` are deliberately absent — they are offsets applied at emit,
 * and including them would key every block to its position and reduce the hit rate to zero on any
 * insertion (which is exactly the case the cache exists to serve).
 */
function blockKey(
  runs: InlineRun[], basePx: number, ratio: number, contentWidth: number,
  marginTopPx: number, marginBottomPx: number,
): string {
  let h1 = 0x811c9dc5 >>> 0
  let h2 = 0xcbf29ce4 >>> 0
  const byte = (c: number) => {
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  // Floats quantised to 1/1024px — finer than any layout decision, and it keeps the key stable
  // against float noise that cannot move a break.
  const num = (n: number) => { const v = Math.round(n * 1024) | 0; byte(v & 255); byte((v >>> 8) & 255); byte((v >>> 16) & 255); byte((v >>> 24) & 255) }
  num(basePx); num(ratio); num(contentWidth); num(marginTopPx); num(marginBottomPx)
  for (const r of runs) {
    byte(r.atomic ? 1 : 0)
    byte(r.italic ? 1 : 0)
    num(r.fontWeight)
    num(r.fontSizePx)
    for (let i = 0; i < r.fontFamily.length; i++) byte(r.fontFamily.charCodeAt(i) & 255)
    byte(0x1f) // field separator — "ab|c" must not collide with "a|bc"
    for (let i = 0; i < r.text.length; i++) { const c = r.text.charCodeAt(i); byte(c & 255); byte(c >>> 8) }
    byte(0x1e) // run separator
  }
  return `${h1.toString(36)}:${h2.toString(36)}:${runs.length}`
}

// Slice a block's runs to start at a block-relative char offset. Only ever called with a proven
// LINE START, so the remainder wraps exactly as it does in the full layout.
function sliceRuns(runs: InlineRun[], fromChar: number): InlineRun[] {
  if (fromChar <= 0) return runs
  const out: InlineRun[] = []
  let c = 0
  for (const r of runs) {
    const len = r.atomic ? 1 : r.text.length
    const end = c + len
    if (end <= fromChar) { c = end; continue }
    if (c >= fromChar || r.atomic) out.push(r)
    else out.push({ ...r, text: r.text.slice(fromChar - c) })
    c = end
  }
  return out
}

export function buildRenderModel(
  doc: PMNode,
  geom: RenderGeom,
  measure: Measure,
  fontLoaded: (stack: string, sizePx: number) => boolean,
  opts: BuildOpts = {},
): RenderModel {
  const citationStyle = opts.citationStyle ?? ''
  const bibEpoch = opts.bibEpoch ?? -1
  const from = opts.from ?? 0
  const maxHeight = opts.maxHeight ?? Infinity
  const windowMode = from > 0 || maxHeight !== Infinity
  let done = false
  const lines: RenderLine[] = []
  const blocks: RenderBlock[] = []
  const coverage: Record<string, number> = {}
  const bump = (k: string) => { coverage[k] = (coverage[k] ?? 0) + 1 }

  let top = 0

  // Lay out one paragraph-like run set at a given font/width/indent, appending its lines. Shared by
  // paragraphs, headings and list items so the three can never drift apart in how they wrap.
  const emitTextBlock = (
    runs: InlineRun[], basePx: number, ratio: number, contentWidth: number,
    marginTopPx: number, marginBottomPx: number, blockIdx: number, posBase: number,
    indentPx = 0, marker?: string,
  ): { ok: boolean; height: number } => {
    // ── CACHE HIT: re-emit the cached block-relative geometry at THIS block's offsets ──
    // Legal because layoutParagraph took only the block: `top`/`posBase`/`blockIdx`/`marker` never
    // entered the layout, so applying them here reproduces the full build's lines exactly.
    const cache = opts.blockCache
    let key = ''
    if (cache) {
      key = blockKey(runs, basePx, ratio, contentWidth, marginTopPx, marginBottomPx)
      const hit = cache.map.get(key)
      if (hit) {
        cache.stats.hits++
        for (let k = 0; k < hit.relTops.length; k++) {
          lines.push({
            top: top + hit.relTops[k], height: hit.lineHeights[k], blockIdx,
            pos: posBase + hit.startChars[k], startChar: hit.startChars[k], endChar: hit.endChars[k],
            // Segments are block-relative and are never mutated after construction, so the array is
            // shared by reference rather than copied — copying it would reintroduce the per-line
            // allocation this cache exists to avoid.
            segs: hit.segs[k],
            indentPx, marker: k === 0 ? marker : undefined,
          })
        }
        return { ok: true, height: hit.height }
      }
      cache.stats.misses++
    }

    const arith: ArithBlock = {
      type: 'paragraph', runs, baseFontPx: basePx,
      marginTopPx, marginBottomPx, firstLineLeadingPx: 0,
    }
    if (!blockEligibility(arith, ratio).eligible) return { ok: false, height: 0 }
    if (!runs.every((r) => r.text === '\n' || r.atomic || fontLoaded(r.fontFamily, r.fontSizePx))) return { ok: false, height: 0 }
    const lay = layoutParagraph(arith, contentWidth, ratio, measure, EDITOR_WHITE_SPACE)
    const chars = blockChars(runs)
    // ONLY SUCCESSES ARE CACHED, deliberately. `ok:false` turns on eligibility AND `fontLoaded`,
    // and fontLoaded is NOT in the key — it flips to true when a face arrives. Caching a false
    // would pin a placeholder forever for a block that became renderable; recomputing a miss is
    // cheap and always correct. (A cached TRUE cannot rot the same way: faces load, never unload —
    // and a face that changes ADVANCES is a context change the caller must drop the cache for.)
    const cb: CachedBlock | null = cache ? { relTops: [], lineHeights: [], startChars: [], endChars: [], segs: [], height: lay.height } : null
    for (let k = 0; k < lay.lineCount; k++) {
      const sc = lay.breakStartChars[k]
      const ec = k + 1 < lay.lineCount ? lay.breakStartChars[k + 1] : chars.text.length
      const segs = segsOfLine(runs, chars, sc, ec, measure)
      lines.push({
        top: top + lay.relTops[k], height: lay.lineHeights[k], blockIdx,
        pos: posBase + sc, startChar: sc, endChar: ec,
        segs,
        indentPx, marker: k === 0 ? marker : undefined,
      })
      if (cb) { cb.relTops.push(lay.relTops[k]); cb.lineHeights.push(lay.lineHeights[k]); cb.startChars.push(sc); cb.endChars.push(ec); cb.segs.push(segs) }
    }
    if (cache && cb) {
      // Bounded FIFO. Distinct blocks across 116 versions of one document are ~hundreds, so this
      // should not fire — which is exactly why it is COUNTED rather than assumed.
      if (cache.map.size >= cache.max) {
        const oldest = cache.map.keys().next().value
        if (oldest !== undefined) { cache.map.delete(oldest); cache.stats.evicted++ }
      }
      cache.map.set(key, cb)
      cache.stats.entries = cache.map.size
    }
    return { ok: true, height: lay.height }
  }

  // A heading/list run inherits its font from CSS, NOT from marks — so the harvested style supplies
  // family/size/weight and the node's own marks only add bold/italic on top.
  const styledRuns = (node: PMNode, s: BlockStyle): InlineRun[] => {
    const runs = runsOfParagraph(node, s.fontSizePx, citationStyle, bibEpoch)
    for (const r of runs) {
      if (r.atomic) continue
      r.fontFamily = s.fontFamily
      r.fontSizePx = s.fontSizePx
      if (s.fontWeight > r.fontWeight) r.fontWeight = s.fontWeight
      if (s.italic) r.italic = true
    }
    return runs
  }

  doc.forEach((node, offset) => {
    if (done) return
    // WINDOW MODE: skip every block that ends before the window starts — node iteration is cheap,
    // LAYOUT is what costs, and this is where O(window) actually comes from.
    if (from > 0 && offset + node.nodeSize <= from) return
    if (top >= maxHeight) { done = true; return }
    const bi = blocks.length
    const marginBottom = geom.paraSpacingEm * geom.basePx
    // The first block of the window may start mid-block, at a line start.
    const fromChar = from > 0 && from > offset + 1 && from < offset + node.nodeSize ? from - offset - 1 : 0

    // ── HEADING: a text block in its own harvested font ──
    if (node.type.name === 'heading') {
      const lvl = (node.attrs?.level as number) ?? 1
      const s = blockStyle(`heading:${lvl}`, geom.basePx)
      if (s) {
        const runs = sliceRuns(styledRuns(node, s), fromChar)
        const r = emitTextBlock(runs, s.fontSizePx, s.lineHeightRatio, geom.contentWidthPx,
          s.marginTopPx, s.marginBottomPx, bi, offset + 1 + fromChar)
        if (r.ok) {
          blocks.push({ kind: 'text', type: 'heading', start: offset, end: offset + node.nodeSize, top, height: r.height })
          top += r.height + s.marginBottomPx
          bump(`heading:${lvl}`)
          return
        }
      }
      // Unharvested level / unloaded face ⇒ DEFER. Never guess a heading's height: it moves every
      // break below it.
      const h = snappedLineHeight(geom.basePx * 1.5, geom.ratio)
      blocks.push({ kind: 'placeholder', type: 'heading', start: offset, end: offset + node.nodeSize, top, height: h, label: `heading ${lvl}`, estimated: true })
      lines.push({ top, height: h, blockIdx: bi, pos: blockFirstLinePos(node, offset), startChar: 0, endChar: 0, segs: [] })
      top += h + marginBottom
      bump(`placeholder:heading:${lvl}`)
      return
    }

    // ── LIST: ONE block (as the live DOM's <ul>/<ol> is one top-level block), many item lines ──
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      const ls = blockStyle(node.type.name, geom.basePx)
      const ip = blockStyle('listItemPara', geom.basePx)
      if (ls && ip) {
        const startTop = top
        const startLines = lines.length
        let ok = true
        let idx = 0
        // listItem → its paragraph. Doc positions: list@offset, item@+1, para@+2, text@+3.
        node.forEach((item, itemOff) => {
          if (!ok || done) return
          const itemBase = offset + 1 + itemOff
          idx++ // ordered-list numbering must count SKIPPED items too, or a windowed list mis-numbers
          // WINDOW: an item entirely above the window contributes nothing. This is the fix for the
          // page-4 failure — the list branch used to ignore `from` and re-lay the whole list from
          // item 0, so a window opening mid-list silently rendered the WRONG lines (0/30, at every
          // doc size). Lists straddle page boundaries constantly in real prose.
          if (from > 0 && itemBase + item.nodeSize <= from) return
          item.forEach((child, childOff) => {
            if (!ok || child.type.name !== 'paragraph') return
            const paraStart = itemBase + 1 + childOff + 1
            const fc = from > paraStart && from < paraStart + child.content.size ? from - paraStart : 0
            const runs = sliceRuns(runsOfParagraph(child, ip.fontSizePx, citationStyle, bibEpoch), fc)
            const marker = node.type.name === 'orderedList' ? `${idx}.` : '•'
            const r = emitTextBlock(runs, ip.fontSizePx, ip.lineHeightRatio,
              geom.contentWidthPx - ls.indentPx, 0, ip.marginBottomPx, bi,
              paraStart + fc, ls.indentPx, fc === 0 ? marker : undefined) // a continued item has no marker
            if (!r.ok) { ok = false; return }
            top += r.height + ip.marginBottomPx
            if (top >= maxHeight) done = true
          })
        })
        if (ok) {
          blocks.push({ kind: 'text', type: node.type.name, start: offset, end: offset + node.nodeSize, top: startTop, height: top - startTop })
          top += ls.marginBottomPx
          bump(node.type.name)
          return
        }
        lines.length = startLines // roll back a partial list — never render half a block
        top = startTop
      }
      const h = PLACEHOLDER_FALLBACK_H
      blocks.push({ kind: 'placeholder', type: node.type.name, start: offset, end: offset + node.nodeSize, top, height: h, label: 'list', estimated: true })
      lines.push({ top, height: h, blockIdx: bi, pos: blockFirstLinePos(node, offset), startChar: 0, endChar: 0, segs: [] })
      top += h + marginBottom
      bump(`placeholder:${node.type.name}`)
      return
    }

    if (node.type.name === 'paragraph') {
      const runs = sliceRuns(runsOfParagraph(node, geom.basePx, citationStyle, bibEpoch), fromChar)
      const arith: ArithBlock = {
        type: 'paragraph', runs, baseFontPx: geom.basePx,
        marginTopPx: 0, marginBottomPx: marginBottom, firstLineLeadingPx: 0,
      }
      const elig = blockEligibility(arith, geom.ratio)
      const fontsOk = runs.every((r) => r.text === '\n' || r.atomic || fontLoaded(r.fontFamily, r.fontSizePx))
      if (elig.eligible && fontsOk) {
        const lay = layoutParagraph(arith, geom.contentWidthPx, geom.ratio, measure, EDITOR_WHITE_SPACE)
        const chars = blockChars(runs)
        blocks.push({ kind: 'text', type: 'paragraph', start: offset, end: offset + node.nodeSize, top, height: lay.height })
        for (let k = 0; k < lay.lineCount; k++) {
          const sc = lay.breakStartChars[k]
          const ec = k + 1 < lay.lineCount ? lay.breakStartChars[k + 1] : chars.text.length
          lines.push({
            top: top + lay.relTops[k], height: lay.lineHeights[k], blockIdx: bi,
            pos: offset + 1 + fromChar + sc, startChar: sc, endChar: ec,
            segs: segsOfLine(runs, chars, sc, ec, measure),
          })
        }
        top += lay.height + marginBottom
        bump(elig.reason)
        return
      }
      bump(fontsOk ? elig.reason : 'font-not-loaded')
      // Ineligible paragraph → placeholder (never guessed text).
      const h = snappedLineHeight(geom.basePx, geom.ratio)
      blocks.push({ kind: 'placeholder', type: 'paragraph', start: offset, end: offset + node.nodeSize, top, height: h, label: 'text (deferred)', estimated: true })
      lines.push({ top, height: h, blockIdx: bi, pos: blockFirstLinePos(node, offset), startChar: 0, endChar: 0, segs: [] })
      top += h + marginBottom
      return
    }

    // ── Non-paragraph: an honest labelled placeholder ──
    const declaredH = typeof node.attrs?.height === 'number' ? node.attrs.height as number : null
    const h = declaredH ?? PLACEHOLDER_FALLBACK_H
    const label = PLACEHOLDER_LABEL[node.type.name] ?? node.type.name
    blocks.push({
      kind: 'placeholder', type: node.type.name, start: offset, end: offset + node.nodeSize,
      top, height: h, label, estimated: declaredH === null,
    })
    lines.push({ top, height: h, blockIdx: bi, pos: blockFirstLinePos(node, offset), startChar: 0, endChar: 0, segs: [] })
    top += h + marginBottom
    bump(`placeholder:${node.type.name}`)
  })

  // A WINDOW is one page by construction: it was cut at a break and stops when the page fills, so
  // there is nothing to paginate. paintPage(model, 0) draws it unchanged.
  if (windowMode) {
    const est = blocks.filter((b) => b.estimated).length
    const firstEst = blocks.find((b) => b.estimated)
    return {
      lines, blocks, pageOfLine: new Array(lines.length).fill(0), pageTop: [lines[0]?.top ?? 0],
      pages: 1, contentHeight: top, coverage, breaks: [], sig: '',
      breaksReliable: est === 0, reliablePages: est === 0 ? 1 : 0,
      firstEstimatedPos: firstEst ? firstEst.start : null, estimatedBlocks: est,
    }
  }

  // ── Page the lines through the SAME splitter the live path uses ──
  const splitLines: SplitLine[] = lines.map((l) => ({ top: l.top, blockIdx: l.blockIdx, pos: l.pos }))
  const splitBlocks = blocks.map((b) => ({ start: b.start }))
  const refBlock = blocks.find((b) => b.type === 'referenceList')
  // paginate()'s default now MATCHES production (no orphan snap — see its ⚠ note). It used to snap,
  // which put the WRONG WORDS on every page after the first (first break 2141 vs the editor's 2403;
  // 17 pages vs 16). A preview showing different text than the editor is worse than no preview, so
  // this deliberately rides the default: if the default ever drifts from computeBreaks again,
  // breaks.prove.mjs fails against the live editor's own gap widgets rather than this file silently
  // compensating for it.
  const res = paginate(splitLines, splitBlocks, refBlock ? refBlock.start : -1, geom.pageHeightPx, geom.topMarginPx)

  // Assign each line to a page by walking the breaks the splitter produced (never re-deriving them
  // — a second copy of the break rule is a second chance to disagree with production).
  //
  // A break's `at` is one of TWO position kinds, and conflating them silently blanks the renderer:
  //   • a mid-block break → `at` = the line's own pos (= blockOffset + 1 + startChar), or
  //   • an ORPHAN-SNAP / refList break → `at` = the BLOCK START (= blockOffset), which is ONE LESS
  //     than that block's first line's pos and therefore never equals any line's pos.
  // Matching only on line.pos meant snapped breaks never fired: every line stayed on page 0,
  // pageTop[1..] was undefined, and paintPage early-returned — so pages 1+ rendered BLANK while the
  // timings still looked wonderful. Caught by the pixel diff (differing == ink exactly = "we drew
  // nothing"), which is precisely why the fidelity check is not optional.
  const pageOfLine: number[] = new Array(lines.length).fill(0)
  const pageTop: number[] = []
  let page = 0
  let bp = 0
  for (let i = 0; i < lines.length; i++) {
    const blk = blocks[lines[i].blockIdx]
    const isBlockFirstLine = i === 0 || lines[i - 1].blockIdx !== lines[i].blockIdx
    while (bp < res.breaks.length) {
      const at = res.breaks[bp].at
      if (at === lines[i].pos || (isBlockFirstLine && at === blk.start)) { page++; bp++; break }
      // A break we've already passed (never expected) must not wedge the walk.
      if (at < lines[i].pos && !(isBlockFirstLine && at === blk.start)) { bp++; continue }
      break
    }
    if (pageTop.length === page) pageTop.push(lines[i].top)
    pageOfLine[i] = page
  }

  const estimatedBlocks = blocks.filter((b) => b.estimated).length
  const firstEst = blocks.find((b) => b.estimated)
  const totalPages = Math.max(res.pages, page + 1)
  // The first page carrying (or following) an estimated block is where trust stops. Everything
  // above it was laid out from measured geometry and is exact.
  let reliablePages = totalPages
  if (firstEst) {
    const li = lines.findIndex((l) => blocks[l.blockIdx] === firstEst)
    reliablePages = li >= 0 ? pageOfLine[li] : 0
  }
  return {
    lines, blocks, pageOfLine, pageTop, pages: totalPages,
    contentHeight: top, coverage, breaks: res.breaks, sig: res.sig,
    breaksReliable: estimatedBlocks === 0, reliablePages,
    firstEstimatedPos: firstEst ? firstEst.start : null, estimatedBlocks,
  }
}

// ─── Highlights ───────────────────────────────────────────────────────────────────────────────
export type HighlightKind = 'scas' | 'add' | 'remove'
export interface HighlightRange { from: number; to: number; kind: HighlightKind }

const HIGHLIGHT_FILL: Record<HighlightKind, string> = {
  scas: 'rgba(155, 92, 204, 0.28)',   // --iw-light purple, SCAS kicked word
  add: 'rgba(21, 128, 61, 0.22)',     // diff add
  remove: 'rgba(190, 24, 93, 0.22)',  // diff remove
}

// ─── Paint ────────────────────────────────────────────────────────────────────────────────────
export type PaintMode = 'text' | 'rects'

export interface PaintOpts {
  mode?: PaintMode
  dpr?: number
  scale?: number                   // extra scale (minimap renders the page small)
  highlights?: HighlightRange[]
  background?: string
  ink?: string
  /** Line-rect band opacity. Defaults to the measured MAP_BAND_ALPHA — override only to re-calibrate. */
  bandAlpha?: number
  // REQUIRED when `highlights` are supplied: a highlight edge lands mid-run, so its x must be
  // measured against the run's own font. Pass the SAME memoised measure the build used — it is hot
  // on these prefixes and the two must agree by construction.
  measure?: Measure
}

interface FontMetrics { ascent: number; descent: number }
const _metrics = new Map<string, FontMetrics>()

// The CSS half-leading rule: a line box of `height` centres the font's (ascent+descent) box, so the
// baseline sits at (height − (asc+desc))/2 + asc from the line top. This is what makes fillText land
// where the DOM paints — measured, not assumed (the probe screenshot-diffs it).
function metricsOf(ctx: CanvasRenderingContext2D, font: string): FontMetrics {
  const hit = _metrics.get(font)
  if (hit) return hit
  if (ctx.font !== font) ctx.font = font
  const m = ctx.measureText('Hxg')
  const met: FontMetrics = {
    ascent: m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 0,
    descent: m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0,
  }
  _metrics.set(font, met)
  return met
}

/** Drop the memoised font metrics (fonts changed / a new context). */
export function _resetMetrics(): void { _metrics.clear(); _mw.clear() }

// Marker widths only — a tiny memo so the paint path doesn't re-measure '•' per list item.
const _mw = new Map<string, number>()
function measureTextCached(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const k = font + ' ' + text
  const hit = _mw.get(k)
  if (hit !== undefined) return hit
  if (ctx.font !== font) ctx.font = font
  const w = ctx.measureText(text).width
  _mw.set(k, w)
  return w
}

/**
 * Paint ONE page of a built model onto a canvas. Sizes the canvas to the page at `dpr × scale`.
 * Returns the paint's own wall time (ms) — the caller still owns build time separately, because
 * the two have completely different caching stories and conflating them is how a "few ms" claim
 * gets made about a path that actually paid 300ms of layout upstream.
 */
export function paintPage(
  model: RenderModel,
  pageIdx: number,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  geom: RenderGeom,
  opts: PaintOpts = {},
): number {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const mode = opts.mode ?? 'text'
  const dpr = opts.dpr ?? 1
  const scale = opts.scale ?? 1
  const k = dpr * scale

  const w = Math.max(1, Math.round(geom.pageWidthPx * k))
  const h = Math.max(1, Math.round(geom.pageHeightPx * k))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return 0
  // Shape text the way the EDITOR renders it, or every ligature is a wrap error. Identical config
  // to makeCanvasMeasure — the measure and the paint must agree with each other AND the editor.
  try { (ctx as unknown as { textRendering: string }).textRendering = 'optimizeSpeed' } catch { /* older engine */ }
  try { (ctx as unknown as { fontKerning: string }).fontKerning = 'normal' } catch { /* older engine */ }

  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.fillStyle = opts.background ?? '#fdfcf7' // parchment
  ctx.fillRect(0, 0, geom.pageWidthPx, geom.pageHeightPx)

  const originTop = model.pageTop[pageIdx]
  if (originTop === undefined) return (typeof performance !== 'undefined' ? performance.now() : 0) - t0

  const ink = opts.ink ?? '#1a1a1a'
  const hl = opts.highlights ?? []
  ctx.textBaseline = 'alphabetic'

  for (let i = 0; i < model.lines.length; i++) {
    if (model.pageOfLine[i] !== pageIdx) continue
    const line = model.lines[i]
    const y = geom.topMarginPx + (line.top - originTop)
    if (y > geom.pageHeightPx) break
    const block = model.blocks[line.blockIdx]

    // ── Placeholder box: labelled, never a fake render ──
    if (block.kind === 'placeholder' && block.type !== 'paragraph') {
      ctx.save()
      ctx.strokeStyle = 'rgba(92,45,138,0.45)'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.strokeRect(geom.sideMarginPx + 0.5, y + 0.5, geom.contentWidthPx - 1, block.height - 1)
      ctx.setLineDash([])
      if (mode === 'text') {
        ctx.fillStyle = 'rgba(92,45,138,0.7)'
        ctx.font = `italic 400 ${Math.min(14, geom.basePx)}px ${DEFAULT_STACK}`
        ctx.fillText(`[${block.label ?? block.type}${block.estimated ? ' — height estimated' : ''}]`,
          geom.sideMarginPx + 8, y + Math.min(block.height - 6, 18))
      }
      ctx.restore()
      continue
    }

    // ── Highlight rects, painted BEHIND the text ──
    if (hl.length && line.segs.length && opts.measure) {
      const lineFrom = line.pos
      const lineTo = line.pos + (line.endChar - line.startChar)
      for (const r of hl) {
        if (r.to <= lineFrom || r.from >= lineTo) continue
        const a = Math.max(r.from, lineFrom) - lineFrom + line.startChar
        const b = Math.min(r.to, lineTo) - lineFrom + line.startChar
        const x0 = xOfChar(line, a, opts.measure)
        const x1 = xOfChar(line, b, opts.measure)
        if (x1 <= x0) continue
        ctx.fillStyle = HIGHLIGHT_FILL[r.kind]
        ctx.fillRect(geom.sideMarginPx + x0, y, x1 - x0, line.height)
      }
    }

    // ── The line itself ──
    if (mode === 'rects') {
      // MAP MODE: one filled band per line. No glyph is resolvable at map scale, so all that
      // survives is where the line sits and how far it runs. (The BREAKS still cost measureText —
      // this saves raster, not layout.)
      const last = line.segs[line.segs.length - 1]
      if (!last) continue
      const runW = last.x + last.w
      if (runW <= 0) continue
      const bandH = Math.max(1, line.height * MAP_BAND_RATIO)
      ctx.fillStyle = ink
      ctx.globalAlpha = opts.bandAlpha ?? MAP_BAND_ALPHA
      ctx.fillRect(geom.sideMarginPx, y + (line.height - bandH) / 2, runW, bandH)
      ctx.globalAlpha = 1
      continue
    }

    const originX = geom.sideMarginPx + (line.indentPx ?? 0)

    // List marker, on the item's first line only, hanging left of the indent (as list-style does).
    if (line.marker && line.segs.length) {
      const mFont = line.segs.find((s) => s.font)?.font
      if (mFont) {
        ctx.fillStyle = ink
        if (ctx.font !== mFont) ctx.font = mFont
        const met = metricsOf(ctx, mFont)
        const baseline = y + (line.height - (met.ascent + met.descent)) / 2 + met.ascent
        ctx.fillText(line.marker, originX - measureTextCached(ctx, line.marker, mFont) - 6, baseline)
      }
    }

    for (const seg of line.segs) {
      // CITATION CHIP: we measured its box, we did not measure its glyphs — so draw the box, in the
      // citation colour, at exactly its advance. That is what a citation looks like at preview scale
      // (a purple hook) and it is honest: the space is right because it was measured, and no text is
      // invented. Rendering its label would mean re-deriving CSL output the NodeView owns.
      if (seg.atom) {
        if (seg.w <= 0) continue
        ctx.fillStyle = seg.atom === 'citation' ? 'rgba(92,45,138,0.55)' : 'rgba(92,45,138,0.30)'
        const chipH = Math.max(1, line.height * 0.44)
        ctx.fillRect(originX + seg.x + 1, y + (line.height - chipH) / 2, Math.max(1, seg.w - 2), chipH)
        continue
      }
      if (!seg.text.trim()) continue
      ctx.fillStyle = ink
      if (ctx.font !== seg.font) ctx.font = seg.font
      const met = metricsOf(ctx, seg.font)
      const baseline = y + (line.height - (met.ascent + met.descent)) / 2 + met.ascent
      ctx.fillText(seg.text, originX + seg.x, baseline)
    }
  }

  return (typeof performance !== 'undefined' ? performance.now() : 0) - t0
}

// ─── CONTENT ANCHORING (2026-07-16 — the frame-registration requirement) ──────────────────────
// Versions differ in LENGTH, so "page 7 of v3" and "page 7 of v4" are not the same content: a scrub
// that preserves page number (or scroll offset) does not preserve what you're LOOKING AT, and the
// sequence reads as noise even when every frame is correct and fast. So the renderer must be able to
// answer "the page containing content X", not only "page N". Both directions are a lookup over the
// model the build already produced — no extra layout.

/** The page index containing a doc position (clamped to the document's range). */
export function pageContainingPos(model: RenderModel, pos: number): number {
  let lo = 0, hi = model.lines.length - 1, best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (model.lines[mid].pos <= pos) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return model.pageOfLine[best] ?? 0
}

/** The doc position a page STARTS at — the anchor a content-anchored scrub carries across versions. */
export function anchorPosOfPage(model: RenderModel, pageIdx: number): number {
  for (let i = 0; i < model.lines.length; i++) if (model.pageOfLine[i] === pageIdx) return model.lines[i].pos
  return 0
}

// ─── MAP STRIP (the whole document at minimap scale, one pass) ────────────────────────────────
// The minimap renders EVERY page simultaneously, so "render on demand" doesn't apply to it — this
// paints the whole doc as a vertical strip of pages in ONE canvas. Mode 'rects' is the hypothesis
// under test: at this scale no glyph resolves, so line geometry may carry all the surviving
// information. Returns paint ms.
export function paintMapStrip(
  model: RenderModel,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  geom: RenderGeom,
  opts: PaintOpts & { gapPx?: number; columns?: number } = {},
): number {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const scale = opts.scale ?? 0.12
  const dpr = opts.dpr ?? 1
  const k = scale * dpr
  const gap = opts.gapPx ?? 4

  const pw = geom.pageWidthPx, ph = geom.pageHeightPx
  const w = Math.max(1, Math.round(pw * k))
  const h = Math.max(1, Math.round((ph * model.pages + gap * Math.max(0, model.pages - 1)) * k))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return 0
  try { (ctx as unknown as { textRendering: string }).textRendering = 'optimizeSpeed' } catch { /* older */ }
  try { (ctx as unknown as { fontKerning: string }).fontKerning = 'normal' } catch { /* older */ }

  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.clearRect(0, 0, pw, ph * model.pages + gap * model.pages)

  const mode = opts.mode ?? 'rects'
  const ink = opts.ink ?? '#1a1a1a'
  const hl = opts.highlights ?? []

  for (let p = 0; p < model.pages; p++) {
    const pageY = p * (ph + gap)
    ctx.fillStyle = opts.background ?? '#fdfcf7'
    ctx.fillRect(0, pageY, pw, ph)
    const originTop = model.pageTop[p]
    if (originTop === undefined) continue

    for (let i = 0; i < model.lines.length; i++) {
      if (model.pageOfLine[i] !== p) continue
      const line = model.lines[i]
      const y = pageY + geom.topMarginPx + (line.top - originTop)
      const block = model.blocks[line.blockIdx]

      if (block.kind === 'placeholder' && block.type !== 'paragraph') {
        // A figure/equation reads at map scale as a BLOCK of ink — that's information the strip
        // must carry, so draw its footprint rather than nothing.
        ctx.fillStyle = 'rgba(92,45,138,0.18)'
        ctx.fillRect(geom.sideMarginPx, y, geom.contentWidthPx, block.height)
        continue
      }
      if (!line.segs.length) continue

      if (hl.length && opts.measure) {
        const lineFrom = line.pos, lineTo = line.pos + (line.endChar - line.startChar)
        for (const r of hl) {
          if (r.to <= lineFrom || r.from >= lineTo) continue
          const a = Math.max(r.from, lineFrom) - lineFrom + line.startChar
          const b = Math.min(r.to, lineTo) - lineFrom + line.startChar
          const x0 = xOfChar(line, a, opts.measure), x1 = xOfChar(line, b, opts.measure)
          if (x1 <= x0) continue
          ctx.fillStyle = HIGHLIGHT_FILL[r.kind]
          ctx.fillRect(geom.sideMarginPx + x0, y, x1 - x0, line.height)
        }
      }

      const last = line.segs[line.segs.length - 1]
      const runW = last.x + last.w
      if (runW <= 0) continue
      const originX = geom.sideMarginPx + (line.indentPx ?? 0)
      if (mode === 'rects') {
        const bandH = Math.max(1 / k, line.height * MAP_BAND_RATIO)
        ctx.fillStyle = ink
        ctx.globalAlpha = opts.bandAlpha ?? MAP_BAND_ALPHA
        ctx.fillRect(originX, y + (line.height - bandH) / 2, runW, bandH)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = ink
        for (const seg of line.segs) {
          if (!seg.text.trim()) continue
          if (ctx.font !== seg.font) ctx.font = seg.font
          const met = metricsOf(ctx, seg.font)
          ctx.fillText(seg.text, originX + seg.x, y + (line.height - (met.ascent + met.descent)) / 2 + met.ascent)
        }
      }
    }
  }
  return (typeof performance !== 'undefined' ? performance.now() : 0) - t0
}

// x offset (px from the content left edge) of a block-relative char index on this line.
// The prefix inside a run is MEASURED, not interpolated: a highlight is a per-WORD rect landing
// mid-run, and proportional-width interpolation would put its edges visibly off the word (the whole
// point of the rect is that it sits on the word the writer is looking at).
function xOfChar(line: RenderLine, charIdx: number, measure: Measure): number {
  for (const seg of line.segs) {
    const end = seg.startChar + seg.text.length
    if (charIdx <= seg.startChar) return seg.x
    if (charIdx < end) return seg.x + measure(seg.text.slice(0, charIdx - seg.startChar), seg.font)
  }
  const last = line.segs[line.segs.length - 1]
  return last ? last.x + last.w : 0
}

/** Is this page's break position trustworthy? Positional — see RenderModel.reliablePages. */
export function pageReliable(model: RenderModel, pageIdx: number): boolean {
  return pageIdx < model.reliablePages
}

/** Canonical geometry for the desktop/canonical context (the one canonical breaks are defined in). */
export function canonicalGeom(pageWidthPx: number, pageHeightPx: number, sideMarginPx: number, topMarginPx: number): RenderGeom {
  return {
    pageWidthPx, pageHeightPx, topMarginPx, sideMarginPx,
    contentWidthPx: pageWidthPx - 2 * sideMarginPx,
    basePx: 18, ratio: 1.618, paraSpacingEm: 0.5,
  }
}

export { MARGIN_BOTTOM_PX }

// THE CANONICAL GEOMETRY, FROM SETTINGS ALONE (2026-07-17 — the /snapshot seam).
//
// Note what this does NOT touch: the DOM. The canonical geometry is a pure function of the page
// SETTINGS — paper, orientation, margins, paragraph spacing — with a pinned 18px base and 1.618
// ratio. That is precisely why /snapshot, which has no editor and no .ProseMirror, can compute the
// SAME geometry the editor paginates under rather than a lookalike.
//
// It lived privately inside textRenderProbe.ts as `liveGeom`. /snapshot needs the identical rule,
// and a second copy of "what is the canonical geometry" is how one route silently starts paginating
// to a different page size. One implementation; the probe now calls this too.
export function canonicalGeomFromSettings(): RenderGeom {
  const paper = getPaperSize()
  const { pageWidthPx, pageHeightPx } = pageBoxPx({
    paperSize: paper === 'scroll' ? 'a4' : paper,
    orientation: getOrientation(),
    topMarginPx: getTopMarginPx(),
    bottomMarginPx: 72,
  })
  const g = canonicalGeom(pageWidthPx, pageHeightPx, getSideMarginPx(), getTopMarginPx())
  g.paraSpacingEm = getParaSpacingEm()
  return g
}
