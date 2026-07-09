import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '../types/document'
import { listSnapshots, groupByVersion, patchSnapshotDiffSummary, patchSnapshotVersionSummary, clearAllSnapshotSummaries, deleteSnapshot } from '../provenance/snapshots'
import { pmToText, buildExportBundle, composeTraceFile } from '../provenance/bundle'
import { loadDocument } from '../storage/opfs'
import { loadLibrary } from '../citations/library'
import { diffWords, diffStats, splitChangesAtReturns, type DiffOp } from '../provenance/diff'
import { summariseDiff, summariseVersionDiff } from '../provenance/summarise'
import { aiSummariesEnabled, setAiSummaries, markAiConsent } from '../editor/aiSettings'
import { AiConsentDialog } from '../components/AiConsentDialog'
import { Scroll, isTouchDevice } from '../editor/Scroll'
import { DocView } from '../components/DocView'
import { Toast } from '../components/Toast'
import { CITATION_TOAST_EVENT } from '../citations/citationToast'


const INK = '#5c2d8a'
const NAV_H = 'clamp(38px, 6vh, 50px)' // shared height for BOTH nav pairs (editor + diff panel)
const NAV_BG = 'rgba(140, 90, 200, 0.35)'
const NAV_BG_DIS = 'rgba(140, 90, 200, 0.06)'
const NAV_FG = 'rgba(92, 45, 138, 0.85)'
const NAV_FG_DIS = 'rgba(140, 90, 200, 0.25)'

// ── Nav side ─────────────────────────────────────────────────────────────────
// Buttons always visible. Each button has a summary panel above it that collapses
// to a thin strip. Panels flash open individually based on which nav action fired.
function NavSide({
  side, snapDir,
  onSnap, snapDisabled,
  onVer, verDisabled,
  hasVersions, isPhone,
  overridePos, midPct = 50,
}: {
  side: 'left' | 'right'
  snapDir: 'back' | 'fwd'
  onSnap: () => void; snapDisabled: boolean
  onVer: () => void;  verDisabled: boolean
  hasVersions: boolean; isPhone: boolean
  overridePos?: React.CSSProperties
  midPct?: number
}) {
  const bracket    = snapDir === 'back' ? '<'  : '>'
  const bracketVer = snapDir === 'back' ? '<<' : '>>'
  const btnSize    = isPhone ? 41 : 53   // ~20% bigger
  const showVer    = hasVersions && !isPhone

  const dim = isPhone ? 'clamp(30px, 8vw, 41px)' : 'clamp(34px, 3.6vw, 53px)'
  void btnSize
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: dim, height: NAV_H, borderRadius: 9,
    background: disabled ? NAV_BG_DIS : NAV_BG,
    color: disabled ? NAV_FG_DIS : NAV_FG,
    border: `1px solid ${disabled ? 'rgba(140,90,200,0.10)' : 'rgba(140,90,200,0.28)'}`,
    cursor: disabled ? 'default' : 'pointer',
    transition: 'background 0.15s',
    userSelect: 'none' as const,
    flexShrink: 0,
    fontSize: '1rem',
    letterSpacing: '-0.04em',
  })

  // Buttons are the anchor — panels are absolutely positioned so buttons never shift.
  // Ver panel floats ABOVE the ver button; snap panel floats BELOW the snap button.
  const Btn = ({ btn, title, disabled, onBtn }: { btn: string; title: string; disabled: boolean; onBtn: () => void }) => (
    <button type="button" style={{ ...btnStyle(disabled), pointerEvents: 'auto' }}
      onClick={disabled ? undefined : onBtn} title={title}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(140,90,200,0.35)' }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = NAV_BG }}
    >{btn}</button>
  )

  return (
    <div style={{
      position: 'fixed',
      ...(overridePos ?? { [side]: 16 }),
      top: `${midPct}%`, transform: 'translateY(-50%)',   // centred on the reading line
      zIndex: 45, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {/* Snapshot nav. Summaries no longer float over the document — they live in the RHS side panel. */}
      <div style={{ position: 'relative' }}>
        <Btn btn={bracket} title={snapDir === 'back' ? 'Previous snapshot (←)' : 'Next snapshot (→)'} disabled={snapDisabled} onBtn={onSnap} />
      </div>

      {showVer && (
        <div style={{ position: 'relative' }}>
          <Btn btn={bracketVer} title={snapDir === 'back' ? 'Previous version' : 'Next version'} disabled={verDisabled} onBtn={onVer} />
        </div>
      )}
    </div>
  )
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

const CONTEXT_WORDS = 4  // words of unchanged context shown either side of each change

function wc(text: string): number { return (text.match(/\S+/g) ?? []).length }

// Split a change's text into [lead whitespace, visible core, trail whitespace] so the highlight (fill +
// outline) wraps ONLY the core — leading/trailing spaces and especially RETURNS never paint an empty
// highlighted line. `core` is '' when the change is pure whitespace (then it's rendered plain, unhighlighted).
function splitEdges(text: string): { lead: string; core: string; trail: string } {
  const lead = /^\s+/.exec(text)?.[0] ?? ''
  if (lead.length === text.length) return { lead: '', core: '', trail: text }
  const trail = /\s+$/.exec(text)?.[0] ?? ''
  return { lead, core: text.slice(lead.length, text.length - trail.length), trail }
}

/** First n words + their trailing horizontal whitespace. */
function takeFirst(text: string, n: number): string {
  if (n <= 0) return ''
  const re = /\S+/g
  let end = 0, count = 0, m: RegExpExecArray | null
  while (count < n && (m = re.exec(text)) !== null) { end = m.index + m[0].length; count++ }
  const trail = text.slice(end).match(/^[ \t]*/)?.[0] ?? ''
  return text.slice(0, end + trail.length)
}

/** Last n words, including any newline immediately before the first word (≤ 3 chars back). */
function takeLast(text: string, n: number): string {
  if (n <= 0) return ''
  const positions: number[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) positions.push(m.index)
  if (!positions.length) return ''
  const startIdx = positions[Math.max(0, positions.length - n)]
  // Only look back ≤ 3 chars so we grab an immediately-preceding \n\n but
  // never drag in an entire prior paragraph (the old lastIndexOf('\n') bug).
  const lookback = text.slice(Math.max(0, startIdx - 3), startIdx)
  const nl = lookback.lastIndexOf('\n')
  const from = nl >= 0 ? startIdx - (lookback.length - nl) : startIdx
  return text.slice(from)
}

/**
 * Build React nodes for the hunk-style diff panel.
 * – 5-word context around each change, collapsed to ··· elsewhere
 * – ¶N / p.N label at the start of a new hunk when the paragraph changes
 * – data-opidx on change spans so clicks can target the left pane
 */
function buildDiffNodes(
  ops: DiffOp[],
  onChangeClick?: (opIdx: number) => void,
  onHoverOp?: (opIdx: number | null) => void,
  diffPages?: Record<number, number>, // opIdx → 1-based DOCUMENT page (from the editor), for page-break rules
): React.ReactNode[] {
  const n = ops.length
  if (!n) return []

  // Per-op: words of 'same' until the NEXT change op
  const untilNextW = new Array<number>(n).fill(Infinity)
  let accW = 0
  for (let i = n - 1; i >= 0; i--) {
    if (ops[i].type !== 'same') { accW = 0 }
    else { untilNextW[i] = accW; accW += wc(ops[i].text) }
  }

  // Per-op: does any change exist after this op?
  const changeAfter = new Array<boolean>(n).fill(false)
  let sawC = false
  for (let i = n - 1; i >= 0; i--) { if (ops[i].type !== 'same') sawC = true; changeAfter[i] = sawC }

  // Per-op: paragraph index in the "after" text at the START of each op
  // pmToText joins paragraphs with \n\n, so count \n\n sequences
  const opPara = new Array<number>(n).fill(0)
  let para = 0
  for (let i = 0; i < n; i++) {
    opPara[i] = para
    if (ops[i].type !== 'del') para += (ops[i].text.match(/\n\n/g) ?? []).length
  }

  // Per-op: cumulative word count at START of each op (for page estimation)
  const opWords = new Array<number>(n).fill(0)
  let cw = 0
  for (let i = 0; i < n; i++) { opWords[i] = cw; if (ops[i].type !== 'del') cw += wc(ops[i].text) }

  const nodes: React.ReactNode[] = []
  let k = 0
  let wordsSinceLast = Infinity
  let gapPending = false
  let lastHunkPara = -1

  const flushGap = () => {
    if (!gapPending) return
    gapPending = false
    nodes.push(<span key={`g${k++}`} style={{
      display: 'block', textAlign: 'center', color: '#c4b5d8',
      padding: '1px 0', fontStyle: 'italic', fontSize: '0.78em', userSelect: 'none',
    }}>···</span>)
  }

  const emitLabel = (p: number, words: number) => {
    if (p === lastHunkPara) return
    lastHunkPara = p
    const page = Math.floor(words / 250) + 1
    const pageStr = page > 1 ? ` · p.${page}` : ''
    nodes.push(<span key={`lbl${k++}`} style={{
      display: 'block', fontSize: '1.05rem', fontWeight: 600,
      color: INK, userSelect: 'none',
      fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif',
      padding: '8px 0 2px', fontStyle: 'normal', letterSpacing: '0.02em',
    }}>{p + 1}{pageStr}</span>)
  }

  const emit = (text: string, style?: React.CSSProperties) => {
    if (!text) return; flushGap()
    nodes.push(<span key={`t${k++}`} style={style}>{text}</span>)
  }

  // Dashed page-break rule (with logo + number) inline before the first diff on a new DOCUMENT page — the
  // numbers come from the editor's real pagination, so they line up with the minimap.
  let lastPage = 0
  const emitPageBreak = (pg: number) => {
    flushGap()
    nodes.push(
      <div key={`pb${k++}`} aria-hidden="true" style={{ display: 'block', position: 'relative', height: 0, borderTop: '1px dashed rgba(92,45,138,0.34)', margin: '12px 0 5px' }}>
        <span style={{ position: 'absolute', right: 0, top: 3, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.9rem', fontWeight: 700, color: 'rgba(92,45,138,0.72)', fontFamily: 'Georgia, "Times New Roman", serif' }}>
          <img src="/inkwave-logo-v7.png" alt="" style={{ width: 16, height: 16, opacity: 0.72 }} />{pg}
        </span>
      </div>,
    )
  }

  const emitChange = (text: string, style: React.CSSProperties, opIdx: number, cls: string) => {
    if (!text) return; flushGap()
    const { lead, core, trail } = splitEdges(text)
    if (!core) { nodes.push(<span key={`cw${k++}`}>{text}</span>); return } // pure whitespace/returns → no highlight
    const clickable = !!onChangeClick
    if (lead) nodes.push(<span key={`cl${k++}`}>{lead}</span>)
    nodes.push(
      <span
        key={`c${k++}`}
        className={cls}
        data-opidx={String(opIdx)}
        style={style}
        onClick={clickable ? () => onChangeClick!(opIdx) : undefined}
        onMouseEnter={onHoverOp ? () => onHoverOp!(opIdx) : undefined}
        onMouseLeave={onHoverOp ? () => onHoverOp!(null) : undefined}
        title={clickable ? 'Jump to this change in document' : undefined}
      >{core}</span>
    )
    if (trail) nodes.push(<span key={`ct${k++}`}>{trail}</span>)
  }

  for (let i = 0; i < n; i++) {
    const op = ops[i]

    if (op.type !== 'same') {
      const pg = diffPages?.[i]
      if (pg && pg > lastPage) { emitPageBreak(pg); lastPage = pg }
      emitLabel(opPara[i], opWords[i])
      wordsSinceLast = 0
      if (op.type === 'del') {
        emitChange(op.text, {
          color: '#b91c1c', textDecoration: 'line-through',
          background: 'rgba(185,28,28,0.07)', borderRadius: 2,
        }, i, 'diff-del')
      } else {
        emitChange(op.text, {
          background: 'rgba(22,163,74,0.16)', color: '#166534', borderRadius: 2,
        }, i, 'diff-add')
      }
      continue
    }

    const t = op.text
    const words = wc(t)
    const headW = wordsSinceLast === Infinity ? 0 : Math.max(0, CONTEXT_WORDS - wordsSinceLast)
    const tailW = untilNextW[i] === Infinity ? 0 : Math.max(0, CONTEXT_WORDS - untilNextW[i])
    wordsSinceLast = wordsSinceLast === Infinity ? words : wordsSinceLast + words

    if (headW + tailW >= words) { emit(t); continue }

    // Context snippets carry an ellipsis on the side that abuts elided text.
    if (headW > 0)  emit(takeFirst(t, headW).trimEnd() + ' …')
    if (tailW > 0)  emit('… ' + takeLast(t, tailW).trimStart())
    else if (headW === 0 && changeAfter[i]) emit('…')
  }

  return nodes
}

// ── FullDiffView ──────────────────────────────────────────────────────────────
// Left pane: entire document with inline green/red diff marks (no collapsing).
// When ops is null (first snapshot), falls back to the rich DocView with formatting.
// When ops exists, renders plain-text diff — inline marks (bold etc.) are not
// preserved because the diff runs at the text level. A ProseMirror-aware diff
// would be needed for mark-level fidelity (future work).
// onOpClick: called with opIdx when a change span is clicked (reverse hyperlink to right pane).
function FullDiffView({
  ops, snapshot, onOpClick, onHoverOp,
}: {
  ops: DiffOp[] | null
  snapshot: Snapshot
  onOpClick?: (opIdx: number) => void
  onHoverOp?: (opIdx: number | null) => void
}) {
  if (!ops) {
    return (
      <div className="tiptap-editor ProseMirror">
        <DocView doc={snapshot.contentJson} />
      </div>
    )
  }
  const hover = onHoverOp
    ? { onMouseEnter: (i: number) => onHoverOp(i), onMouseLeave: () => onHoverOp(null) }
    : null
  const spans = ops.map((op, i) => {
    if (op.type === 'same') return <span key={i} data-opidx={String(i)}>{op.text}</span>
    const { lead, core, trail } = splitEdges(op.text)
    if (!core) return <span key={i} data-opidx={String(i)}>{op.text}</span> // whitespace/returns → plain, no highlight
    const cls = op.type === 'del' ? 'diff-del' : 'diff-add'
    const style: React.CSSProperties = op.type === 'del'
      ? { color: '#b91c1c', textDecoration: 'line-through', background: 'rgba(185,28,28,0.06)' }
      : { background: 'rgba(22,163,74,0.15)', color: '#166534' }
    // Outer span carries no highlight; the INNER core span holds the class + data-opidx so lead/trail
    // whitespace (esp. returns) never gets outlined/filled.
    return (
      <span key={i}>
        {lead}
        <span className={cls} data-opidx={String(i)} style={style}
          onClick={onOpClick ? () => onOpClick(i) : undefined}
          onMouseEnter={hover ? () => hover.onMouseEnter(i) : undefined}
          onMouseLeave={hover ? () => hover.onMouseLeave() : undefined}
          title={onOpClick ? 'Jump to this change in diff panel' : undefined}
        >{core}</span>
        {trail}
      </span>
    )
  })
  return (
    <div className="tiptap-editor ProseMirror" style={{ whiteSpace: 'pre-wrap' }}>
      {spans}
    </div>
  )
}

// ── InlineDiffView ────────────────────────────────────────────────────────────
// Right pane: compact hunk view of the diff.
function InlineDiffView({
  ops, prevSnap, onChangeClick, onHoverOp, scrollBodyRef, midFrac = 0.5, diffPages,
}: {
  ops: DiffOp[] | null
  prevSnap: Snapshot | null
  onChangeClick: (opIdx: number) => void
  onHoverOp: (opIdx: number | null) => void
  scrollBodyRef?: React.RefObject<HTMLDivElement>
  midFrac?: number
  diffPages?: Record<number, number> // opIdx → document page (from the editor), for in-sync page-break rules
}) {
  const hasChange = ops ? ops.some(o => o.type !== 'same') : false
  const nodes = useMemo(
    () => ops && hasChange ? buildDiffNodes(ops, onChangeClick, onHoverOp, diffPages) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ops, hasChange, onChangeClick, onHoverOp, diffPages],
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
      <div
        ref={scrollBodyRef}
        className="iw-snap-scroll"
        style={{
          flex: 1, overflowY: 'scroll', overflowX: 'auto', padding: '1rem 1.5rem',
          lineHeight: 1.7, fontSize: '0.88rem', whiteSpace: 'pre-wrap',
          fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif',
        }}
      >
        {!prevSnap && <p style={{ color: '#aaa', fontStyle: 'italic', fontSize: '0.9rem' }}>No previous snapshot to compare against.</p>}
        {prevSnap && !hasChange && <p style={{ color: '#aaa', fontStyle: 'italic', fontSize: '0.9rem' }}>Content is identical to the previous snapshot.</p>}
        {/* Lead/trail whitespace = just enough for the TOP diff to reach the reading line (midFrac of the
            panel) and the BOTTOM diff to reach it from below — panel-relative, so it shrinks on smaller
            windows instead of a fixed 24em that dwarfs a half-screen pane. */}
        {hasChange && <div aria-hidden="true" style={{ height: `${midFrac * 100}%`, flexShrink: 0 }} />}
        {nodes}
        {hasChange && <div aria-hidden="true" style={{ height: `${(1 - midFrac) * 100}%`, flexShrink: 0 }} />}
      </div>
    </div>
  )
}

// ── Midline content anchoring ───────────────────────────────────────────────
// The midline stays on the SAME WORDS across snapshot navigation (not the same
// scroll fraction). We capture a short text signature of whatever sits on the line,
// then after the next snapshot renders we find that text again and scroll it to the
// line — so the document "scrolls around a bit" to keep the words put. Falls back to
// fractional anchoring when the anchored text was edited away.

const SIG_LEN = 80          // chars of the on-line text used as the anchor signature
const SIG_MIN = 12          // shorter than this = too weak to anchor reliably

/** Cross-browser caret hit-test → the text node + offset at a viewport point. */
function caretAtPoint(x: number, y: number): { node: Text; offset: number } | null {
  // Firefox
  const anyDoc = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (anyDoc.caretPositionFromPoint) {
    const p = anyDoc.caretPositionFromPoint(x, y)
    if (p && p.offsetNode.nodeType === Node.TEXT_NODE) return { node: p.offsetNode as Text, offset: p.offset }
  }
  if (anyDoc.caretRangeFromPoint) {
    const r = anyDoc.caretRangeFromPoint(x, y)
    if (r && r.startContainer.nodeType === Node.TEXT_NODE) return { node: r.startContainer as Text, offset: r.startOffset }
  }
  return null
}

/** Global character offset of (node, offset) within root's textContent. */
function globalOffsetOf(root: HTMLElement, node: Text, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode() as Text | null
  while (n) {
    if (n === node) return acc + offset
    acc += n.data.length
    n = walker.nextNode() as Text | null
  }
  return acc
}

/** Locate the text node + in-node offset for a global textContent offset. */
function locateOffset(root: HTMLElement, globalOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode() as Text | null
  while (n) {
    const len = n.data.length
    if (acc + len >= globalOffset) return { node: n, offset: globalOffset - acc }
    acc += len
    n = walker.nextNode() as Text | null
  }
  return null
}

/** The text signature currently sitting on the midline (or null if not over text). */
function midlineSignature(el: HTMLElement): string | null {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + el.clientHeight / 2
  const caret = caretAtPoint(x, y)
  if (!caret) return null
  const globalOffset = globalOffsetOf(el, caret.node, caret.offset)
  const sig = (el.textContent ?? '').slice(globalOffset, globalOffset + SIG_LEN)
  return sig.trim().length >= SIG_MIN ? sig : null
}

/** scrollTop that places `sig` on the midline, preferring the occurrence nearest ratioBias. */
function scrollTopForSignature(el: HTMLElement, sig: string, ratioBias: number): number | null {
  const full = el.textContent ?? ''
  const biasChar = ratioBias * full.length
  const findBest = (needle: string): number => {
    let idx = -1, best = Infinity, from = 0
    for (;;) {
      const i = full.indexOf(needle, from)
      if (i < 0) break
      const d = Math.abs(i - biasChar)
      if (d < best) { best = d; idx = i }
      from = i + 1
    }
    return idx
  }
  // Full signature first; if the anchor text was lightly edited, retry a shorter prefix.
  let at = findBest(sig)
  if (at < 0) {
    const short = sig.slice(0, 28)
    if (short.trim().length < SIG_MIN) return null
    at = findBest(short)
    if (at < 0) return null
  }
  const loc = locateOffset(el, at)
  if (!loc) return null
  const range = document.createRange()
  const end = Math.min(loc.offset + 1, loc.node.data.length)
  range.setStart(loc.node, Math.min(loc.offset, loc.node.data.length))
  range.setEnd(loc.node, end)
  const rect = range.getBoundingClientRect()
  if (!rect.height && !rect.top) return null
  const elRect = el.getBoundingClientRect()
  const targetTopInContent = rect.top - elRect.top + el.scrollTop
  return targetTopInContent - el.clientHeight / 2
}

// ── SplitDiffView ─────────────────────────────────────────────────────────────
// Two-pane layout: left/top = full annotated document, right/bottom = compact hunk diff.
// Desktop: horizontal with draggable divider. Mobile/narrow: vertical stack.
//
// Midline: a dashed line fixed at the centre of the document pane.
// Scroll lock: navigating snapshots keeps the same TEXT on the midline (content-anchored).
// Click-to-midline: clicking any change in the hunk panel scrolls the document pane
//   so that change's text sits at the midline.
// The op (add or del) with the longest single character chain — the biggest contiguous change.
// Returns its index in the ops array (= its data-opidx in the left pane), or null if no change.
function longestChangeOpIdx(ops: DiffOp[] | null): number | null {
  if (!ops) return null
  let best: number | null = null, bestLen = 0
  ops.forEach((op, i) => {
    if (op.type === 'same') return
    const len = op.text.length
    if (len > bestLen) { bestLen = len; best = i }
  })
  return best
}

// Column stack-height for the minimap: pages stack this many high per column, then wrap into columns.
// ≤2→1, 3–6→2, 7–9→3, 10–16→4, 17+→5 (then ≈√pages). Peter's spec.
function stackHeight(pages: number): number {
  if (pages <= 2) return 1
  if (pages <= 6) return 2
  if (pages <= 9) return 3
  if (pages <= 16) return 4
  return Math.ceil(Math.sqrt(pages))
}

// Pick the rows×cols to tile `n` page thumbnails into a W×H panel so each page CELL is portrait — its
// height:width sits in [MIN,MAX] (≈ a page). We try every row count, score how far the resulting cell ratio
// falls outside the band (heavily) plus its distance from the ideal (lightly), and take the best. Cells are
// 1fr so they then scale to fill the panel. Recomputed whenever the panel resizes.
function bestGrid(n: number, W: number, H: number): { rows: number; cols: number } {
  if (n <= 1 || W <= 0 || H <= 0) return { rows: Math.max(1, n), cols: 1 }
  const MIN = 3, MAX = 5, IDEAL = 4 // page thumbnail height:width
  let best = { rows: 1, cols: n }, bestScore = Infinity
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const ratio = (H / rows) / (W / cols) // cell height : width
    const outside = ratio < MIN ? MIN - ratio : ratio > MAX ? ratio - MAX : 0
    const score = outside * 100 + Math.abs(ratio - IDEAL)
    if (score < bestScore) { bestScore = score; best = { rows, cols } }
  }
  return best
}

// A minimap of the whole document: one thin parchment-coloured bar per page, laid out in a column grid
// (stackHeight tall, with gaps), on the aquamarine background. Red/green ticks mark deletions/insertions.
// Click or drag scrolls the panes so that point sits on the midline.
function MinimapPanel({ leftRef, ops, snapKey, midFrac = 0.5 }: {
  leftRef: React.RefObject<HTMLDivElement | null>
  ops: DiffOp[] | null
  snapKey: string
  midFrac?: number
}) {
  const [pages, setPages] = useState(1)
  const [maxPages, setMaxPages] = useState(1) // largest page count seen → keep the grid structure stable
  const [marks, setMarks] = useState<Array<{ page: number; frac: number; add: boolean; opIdx: number }>>([])
  const [panelDims, setPanelDims] = useState({ w: 0, h: 0 }) // the minimap's own box, for the aspect-ratio grid
  const pageHRef = useRef(1000)
  const gridRef = useRef<HTMLDivElement>(null)
  const marksSigRef = useRef('')

  const measure = useCallback(() => {
    const el = leftRef.current
    if (!el || !el.scrollHeight) return
    const paper = el.querySelector('.scroll-paper') as HTMLElement | null
    const pw = paper?.clientWidth || el.clientWidth || 1
    const pageH = Math.max(200, pw * Math.SQRT2) // A4 portrait ratio, matching the pagination
    pageHRef.current = pageH
    const n = Math.max(1, Math.round(el.scrollHeight / pageH))
    setPages(n)
    setMaxPages(m => Math.max(m, n))
    const er = el.getBoundingClientRect()
    const m: Array<{ page: number; frac: number; add: boolean; opIdx: number }> = []
    el.querySelectorAll('[data-opidx]').forEach(o => {
      const idx = Number((o as HTMLElement).getAttribute('data-opidx'))
      const op = ops?.[idx]
      if (!op || op.type === 'same') return
      const r = (o as HTMLElement).getBoundingClientRect()
      const y = r.top - er.top + el.scrollTop
      const page = Math.max(0, Math.min(n - 1, Math.floor(y / pageH)))
      m.push({ page, frac: Math.max(0, Math.min(1, (y - page * pageH) / pageH)), add: op.type === 'add', opIdx: idx })
    })
    // Skip the setState when the marks are identical — the observers fire on every resize tick and a fresh
    // array would re-render the whole grid for nothing (same pattern PageGuides uses).
    const sig = n + '|' + m.map(k => `${k.page}:${Math.round(k.frac * 100)}:${k.add ? 1 : 0}`).join(',')
    if (sig === marksSigRef.current) return
    marksSigRef.current = sig
    setMarks(m)
  }, [ops, leftRef])

  useLayoutEffect(() => { measure(); const t = setTimeout(measure, 350); return () => clearTimeout(t) }, [measure, snapKey])
  useEffect(() => {
    const el = leftRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure()) }) // coalesce
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [measure, leftRef])

  // Watch the minimap's OWN box so the grid re-solves as the panel resizes — coalesced + guarded so identical
  // sizes don't re-render (the observer fires every frame during a drag).
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    let raf = 0
    const set = () => setPanelDims(prev => {
      const w = grid.clientWidth, h = grid.clientHeight
      return prev.w === w && prev.h === h ? prev : { w, h }
    })
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(set) }); ro.observe(grid)
    set()
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  // Grid keeps the LONGEST snapshot's structure; a shorter snapshot leaves the extra slots EMPTY rather
  // than showing pages that aren't there. Rows×cols come from the aspect-ratio solver against the live panel
  // size (falls back to the fixed f(n) before the box is measured).
  const total = Math.max(pages, maxPages)
  const { rows: height, cols } = useMemo(
    () => (panelDims.w > 0 && panelDims.h > 0)
      ? bestGrid(total, panelDims.w, panelDims.h)
      : { rows: stackHeight(total), cols: Math.ceil(total / stackHeight(total)) },
    [total, panelDims.w, panelDims.h],
  )
  const GAP = 4
  // Page-number + logo size scales with the cell height (panel resolution).
  const cellApproxH = panelDims.h > 0 ? (panelDims.h - 12 - (height - 1) * GAP) / height : 40
  const numFont = Math.max(8, Math.min(22, cellApproxH * 0.28))

  // Map a pointer position over the grid → (page, frac) → scroll the document pane there (its onScroll
  // then follows the diff pane). Column-major: down a column, then the next column.
  const seekTo = useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current, el = leftRef.current
    if (!grid || !el) return
    const gr = grid.getBoundingClientRect()
    const colW = gr.width / cols
    const cellH = (gr.height - (height - 1) * GAP) / height + GAP
    const c = Math.max(0, Math.min(cols - 1, Math.floor((clientX - gr.left) / colW)))
    const rRaw = (clientY - gr.top)
    const r = Math.max(0, Math.min(height - 1, Math.floor(rRaw / cellH)))
    const page = c * height + r
    if (page >= pages) return
    const fracInCell = Math.max(0, Math.min(1, (rRaw - r * cellH) / (cellH - GAP)))
    const y = (page + fracInCell) * pageHRef.current
    window.dispatchEvent(new Event('inkwave:minimap-seek')) // → diff pane follows gently, not springily
    el.scrollTo({ top: Math.max(0, y - el.clientHeight * midFrac), behavior: 'auto' })
  }, [cols, height, pages, leftRef, midFrac])

  // Click a diff tick → both panes fly to THAT change (editor scrolls; the diff pane follows via the sync).
  const seekToY = useCallback((y: number) => {
    const el = leftRef.current
    if (!el) return
    window.dispatchEvent(new Event('inkwave:minimap-seek'))
    el.scrollTo({ top: Math.max(0, y - el.clientHeight * midFrac), behavior: 'smooth' })
  }, [leftRef, midFrac])

  const dragging = useRef(false)
  const onDown = (e: React.PointerEvent) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seekTo(e.clientX, e.clientY) }
  const onMove = (e: React.PointerEvent) => { if (dragging.current) seekTo(e.clientX, e.clientY) }
  const onUp = () => { dragging.current = false }

  // "You are here" marker — the centre of the document viewport mapped back onto the grid cell.
  const [here, setHere] = useState<{ top: number; left: number; width: number } | null>(null)
  const updateHere = useCallback(() => {
    const grid = gridRef.current, el = leftRef.current
    if (!grid || !el || !el.scrollHeight) { setHere(null); return }
    const P = 6 // grid padding
    const w = grid.clientWidth - 2 * P, h = grid.clientHeight - 2 * P
    const colStride = (w - (cols - 1) * GAP) / cols
    const cellH = (h - (height - 1) * GAP) / height
    const pageH = pageHRef.current
    const yc = el.scrollTop + el.clientHeight * midFrac
    const p = Math.max(0, Math.min(pages - 1, Math.floor(yc / pageH)))
    const frac = Math.max(0, Math.min(1, (yc - p * pageH) / pageH))
    const c = Math.floor(p / height), r = p % height
    const next = { top: P + r * (cellH + GAP) + frac * cellH, left: P + c * (colStride + GAP), width: colStride }
    setHere(prev => (prev && Math.abs(prev.top - next.top) < 0.4 && Math.abs(prev.left - next.left) < 0.4 && Math.abs(prev.width - next.width) < 0.4) ? prev : next)
  }, [cols, height, pages, leftRef, midFrac])
  useEffect(() => {
    const el = leftRef.current, grid = gridRef.current
    if (!el) return
    updateHere()
    el.addEventListener('scroll', updateHere, { passive: true })
    // Recompute on minimap resize too — otherwise `here` keeps stale absolute px and the marker races ahead
    // of its page as the map grows/shrinks.
    let raf = 0
    const ro = grid ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateHere) }) : null
    if (grid && ro) ro.observe(grid)
    return () => { el.removeEventListener('scroll', updateHere); ro?.disconnect(); cancelAnimationFrame(raf) }
  }, [updateHere, snapKey])

  // Wheel over the minimap scrolls the WHOLE document linearly (through every page/column, no column limit) —
  // a moderate multiplier so it's quicker than the pane but not a lurch.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const onWheel = (e: WheelEvent) => {
      const el = leftRef.current
      if (!el) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1 // line/page → px
      el.scrollTop += e.deltaY * unit * 3 // moderate; the editor's own scroll handlers take it from here
    }
    grid.addEventListener('wheel', onWheel, { passive: false })
    return () => grid.removeEventListener('wheel', onWheel)
  }, [leftRef])

  return (
    <div
      ref={gridRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      title="Click or drag to scroll"
      style={{
        flex: 1, minHeight: 0, position: 'relative', background: '#9fd9c8', borderRadius: 6, padding: 6, cursor: 'pointer',
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoFlow: 'column',
        gridTemplateRows: `repeat(${height}, 1fr)`, gap: GAP, touchAction: 'none',
      }}
    >
      {here && (
        <div aria-hidden="true" style={{ position: 'absolute', top: here.top, left: here.left, width: here.width, height: 0, zIndex: 6, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 5, right: 5, top: -1.5, height: 3, background: '#5c2d8a', borderRadius: 2, boxShadow: '0 0 3px rgba(92,45,138,0.75)' }} />
          <div style={{ position: 'absolute', left: -3, top: -5, width: 11, height: 11, borderRadius: '50%', background: '#5c2d8a', color: '#fff', fontSize: 8, lineHeight: '11px', textAlign: 'center' }}>▸</div>
          <div style={{ position: 'absolute', right: -3, top: -5, width: 11, height: 11, borderRadius: '50%', background: '#5c2d8a', color: '#fff', fontSize: 8, lineHeight: '11px', textAlign: 'center' }}>◂</div>
        </div>
      )}
      {Array.from({ length: total }, (_, p) => (
        p < pages ? (
          <div key={p} style={{ position: 'relative', background: '#f7f2e8', borderRadius: 2, minHeight: 6, boxShadow: '0 1px 2px rgba(80,50,10,0.15)', overflow: 'hidden' }}>
            {/* Text block (marks) inset with page-like margins — top/left/right, and a clear bottom margin
                that leaves room for the logo + number below it (so they're never buried under a diff tick). */}
            <div style={{ position: 'absolute', top: 5, left: 4, right: 4, bottom: numFont + 9 }}>
              {marks.filter(m => m.page === p).map((m, i) => {
                const base = m.add ? '#16a34a' : '#dc2626', dark = m.add ? '#0d6b30' : '#8f1414'
                return (
                  <div key={i} title="Jump both panes to this change"
                    onClick={(e) => { e.stopPropagation(); seekToY((m.page + m.frac) * pageHRef.current) }}
                    onMouseEnter={(e) => { const b = e.currentTarget.firstElementChild as HTMLElement; b.style.height = '5px'; b.style.background = dark }}
                    onMouseLeave={(e) => { const b = e.currentTarget.firstElementChild as HTMLElement; b.style.height = '2px'; b.style.background = base }}
                    style={{ position: 'absolute', left: 0, right: 0, top: `${m.frac * 100}%`, transform: 'translateY(-50%)', height: 10, display: 'flex', alignItems: 'center', cursor: 'pointer', zIndex: 4 }}
                  >
                    <div style={{ width: '100%', height: 2, background: base, borderRadius: 1, transition: 'height 0.1s, background 0.1s' }} />
                  </div>
                )
              })}
            </div>
            {/* logo + number in the clear bottom margin */}
            <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 3, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: numFont * 0.28, color: 'rgba(92,45,138,0.66)', fontSize: numFont, fontWeight: 700, fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1, pointerEvents: 'none' }}>
              <img src="/inkwave-logo-v7.png" alt="" style={{ width: numFont * 0.85, height: numFont * 0.85, opacity: 0.66 }} />
              {p + 1}
            </div>
          </div>
        ) : (
          // A page this shorter snapshot doesn't have — an empty slot, keeping the grid stable.
          <div key={p} style={{ borderRadius: 2, minHeight: 6, border: '1px dashed rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }} />
        )
      ))}
    </div>
  )
}

// ── Editor snap (experimental) ────────────────────────────────────────────────
// Two ways to make the editor "grab" diffs, chosen by a 3-way toggle. Both read the diff CENTRES in the
// editor's own content coordinates.
export type SnapMode = 'off' | 'warp'
export type BijMode = 'both' | 'reverse' | 'off' // cross-pane sync: both directions / diff→editor only / none

type Centre = { c: number; half: number; add: boolean; len: number }
function diffCentres(el: HTMLElement): Centre[] {
  const rect = el.getBoundingClientRect()
  const byIdx = new Map<string, { top: number; bot: number; add: boolean; len: number }>()
  el.querySelectorAll('[data-opidx]').forEach((node) => {
    const e = node as HTMLElement
    const add = e.classList.contains('diff-add'), del = e.classList.contains('diff-del')
    if (!add && !del) return
    const idx = e.getAttribute('data-opidx')!
    const r = e.getBoundingClientRect()
    const top = r.top - rect.top + el.scrollTop, bot = r.bottom - rect.top + el.scrollTop
    const len = (e.textContent || '').length
    const prev = byIdx.get(idx)
    if (prev) { prev.top = Math.min(prev.top, top); prev.bot = Math.max(prev.bot, bot); prev.len += len }
    else byIdx.set(idx, { top, bot, add, len })
  })
  return [...byIdx.values()].map(({ top, bot, add, len }) => ({ c: (top + bot) / 2, half: (bot - top) / 2, add, len }))
}

// Potential-well model (Peter's): each diff is a well; the scroll is a particle with a VELOCITY-DEPENDENT
// resistance — LOW when fast (coasts far, no wading through dense sections) rising HIGH as it slows (settles
// onto the nearest diff). Only the NEAREST well pulls, so concentrated diffs don't accumulate a huge
// potential. No critical-damping-per-well coupling (that stalled it mid-nowhere and over-damped clusters).
const WARP_RESIST_MIN = 0.04  // resistance at high speed (coast)
const WARP_RESIST_MAX = 0.34  // resistance as it stops (clean settle)
const WARP_V0 = 8             // velocity scale for the resistance ramp (px/frame)
const WARP_WELL = 0.3         // well pull strength (how hard the nearest diff grabs)
const WARP_WELL_PAD = 20      // well half-width beyond each diff's own half-height
const WARP_IMPULSE = 0.14     // wheel delta → velocity impulse (≈ resistance scale, so scroll is ~1:1 with input, not 5-6×)

function SplitDiffView({
  snapshot, prevSnap, isPhone, isNarrow, lineMode, summary, counter, summariesOn, onOptInSummaries, nav,
}: {
  snapshot: Snapshot; prevSnap: Snapshot | null; isPhone: boolean; isNarrow: boolean
  lineMode: 'center' | 'longest'; summary?: string | null; counter?: string
  summariesOn?: boolean; onOptInSummaries?: () => void
  nav?: {
    show: boolean
    onBack: () => void; canBack: boolean
    onFwd: () => void; canFwd: boolean
    onScrub: (steps: number) => void
    onVerBack: () => void; canVerBack: boolean
    onVerFwd: () => void; canVerFwd: boolean
    hasVersions: boolean
  }
}) {
  const vertical = isPhone || isNarrow
  // The reading line + alignment reference sits at the GOLDEN RATIO from the top (0.382) in the wide view
  // — aligned content lands in the upper third with more context below — and at the centre (0.5) in narrow.
  // A ref so the sync effects (which don't re-subscribe on the flip) always read the current value.
  const midFrac = vertical ? 0.5 : 0.382
  const midFracRef = useRef(midFrac); midFracRef.current = midFrac
  const [splitPct, setSplitPct] = useState(28) // diff pane % (narrower by default); editor takes the rest
  const [sidePanelPx, setSidePanelPx] = useState(240)
  const [snapMode, setSnapMode] = useState<SnapMode>(() => {
    try { return localStorage.getItem('inkwave:editorSnap') === 'warp' ? 'warp' : 'off' } catch { return 'off' }
  })
  const cycleSnap = () => setSnapMode((m) => {
    const next: SnapMode = m === 'off' ? 'warp' : 'off'
    try { localStorage.setItem('inkwave:editorSnap', next) } catch { /* private */ }
    return next
  })
  // 3-way cross-pane bijection: 'both' (each drives the other), 'reverse' (diff→editor only, right-to-left),
  // or 'off'. A ref mirrors it so the scroll handlers read the live value without re-subscribing.
  const [bijMode, setBijMode] = useState<BijMode>(() => {
    try { const s = localStorage.getItem('inkwave:bijection'); return s === 'both' || s === 'reverse' || s === 'off' ? s : 'reverse' } catch { return 'reverse' }
  })
  const bijectionRef = useRef<BijMode>(bijMode)
  bijectionRef.current = bijMode
  const cycleBijection = () => setBijMode((m) => {
    const next: BijMode = m === 'both' ? 'reverse' : m === 'reverse' ? 'off' : 'both'
    try { localStorage.setItem('inkwave:bijection', next) } catch { /* private */ }
    return next
  })
  // Diff centres cached in CONTENT coords (they never move while scrolling — only on layout change), so
  // the snap physics does ZERO getBoundingClientRect per frame. Recomputed only when the layout changes.
  const centresRef = useRef<Centre[]>([])   // editor-pane diff centres (for the editor warp)
  const rCentresRef = useRef<Centre[]>([])  // diff-pane diff centres (for the diff-pane warp)
  // Knots for the bijection, cached the same way: each diff's centre in BOTH panes (ly ↔ ry), sorted by
  // ly. Used forward (editor→diff, onLeftScroll) and inverse (diff→editor, the reverse sync).
  const knotsRef = useRef<Array<{ ly: number; ry: number; lHalf: number; rHalf: number; idx: number }>>([])
  // Which pane the user is actively scrolling ('left' = editor, 'right' = diff) — set by wheel over each,
  // cleared after idle. The follower is moved programmatically, which must NOT flip the driver.
  const driverRef = useRef<'left' | 'right'>('left') // whichever pane the cursor is over (default editor)
  const panningRef = useRef(false) // true while a right-click pan is in progress (suppresses the hover glow)
  const scrollingRef = useRef(false) // true for ~140ms after any pane scroll (suppresses the hover glow)
  const scrollStopTimer = useRef<number | undefined>(undefined)
  const dragging   = useRef(false)
  // FAST exponential follow: the diff pane tracks its bijection target within ~1 frame, so it doesn't
  // trail the editor (the old soft critically-damped spring lagged ~300ms during continuous scroll). This
  // can be stiff without feeling jumpy because the LOCAL easing is baked into the target (the magnetic
  // snap in the map) — and a pure lerp toward the target never overshoots. Minimap uses a gentler factor.
  const rightTargetRef = useRef<number | null>(null)
  const springRafRef = useRef(0)
  const gentleFollowRef = useRef(false) // minimap scrolling → gentler follow
  const runSpring = useCallback(() => {
    if (springRafRef.current) return
    const step = () => {
      const R = rightScrollRef.current, target = rightTargetRef.current
      // Bail if the DIFF pane has become the driver (reverse sync) — otherwise this lingering forward-drive
      // spring keeps yanking the diff pane toward a stale target, fighting the user (the "stuck / rolls back").
      if (!R || target == null || driverRef.current === 'right') { springRafRef.current = 0; return }
      const dx = target - R.scrollTop
      const k = gentleFollowRef.current ? 0.4 : 0.85 // fraction of the gap closed each frame
      if (Math.abs(dx) < 0.4) { R.scrollTop = target; springRafRef.current = 0; return }
      R.scrollTop = R.scrollTop + dx * k
      springRafRef.current = requestAnimationFrame(step)
    }
    springRafRef.current = requestAnimationFrame(step)
  }, [])
  // While a click-to-diff smooth-scroll is in flight, the diff pane GLIDES (tracks the target directly, at
  // the editor's pace) instead of springing — no fridge bounce on a click.
  const directFollowRef = useRef(false)
  // Minimap scrolling → gentle critically-damped follow (see runSpring); the minimap dispatches this event.
  const gentleTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const on = () => {
      gentleFollowRef.current = true
      window.clearTimeout(gentleTimerRef.current)
      gentleTimerRef.current = window.setTimeout(() => { gentleFollowRef.current = false }, 340)
    }
    window.addEventListener('inkwave:minimap-seek', on)
    return () => window.removeEventListener('inkwave:minimap-seek', on)
  }, [])
  // Synchronised alignment glow: set --iw-align (0..1) on a diff's spans in BOTH panes so they light up
  // together, continuously, as it nears alignment (no cap — EVERY diff glows in turn). See the sync step.
  const glowSetRef = useRef<Set<number>>(new Set())
  const setAlignGlow = useCallback((idx: number, v: number) => {
    const val = v <= 0.001 ? '0' : v.toFixed(3)
    for (const root of [leftScrollRef.current, rightScrollRef.current]) {
      root?.querySelectorAll(`[data-opidx="${idx}"]`).forEach(el => (el as HTMLElement).style.setProperty('--iw-align', val))
    }
  }, [])
  const diffFlightRef = useRef(false) // true while a click flies the DIFF pane (editor static) → glow off its midline
  // Plateau glow driven by ANY pane's midline (from the cached knots): fully lit while the midline is inside
  // a diff, smootherstep dropoff over 40px. Used when the diff pane scrolls on its own (a click flight),
  // where the editor's onLeftScroll glow can't fire.
  const setGlowFromDiffMid = useCallback((mid: number) => {
    const still = new Set<number>()
    for (const k of knotsRef.current) {
      const d = Math.abs(k.ry - mid)
      let I: number
      if (d <= k.rHalf) I = 1
      else if (d >= k.rHalf + 40) I = 0
      else { const t = 1 - (d - k.rHalf) / 40; I = t * t * t * (t * (t * 6 - 15) + 10) }
      if (I > 0.001) { setAlignGlow(k.idx, I); still.add(k.idx) }
    }
    for (const idx of glowSetRef.current) if (!still.has(idx)) setAlignGlow(idx, 0)
    glowSetRef.current = still
  }, [setAlignGlow])
  const sideDragging = useRef(false)
  const containerRef   = useRef<HTMLDivElement>(null)
  const leftScrollRef  = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)   // right pane scroll container
  const anchorRatioRef  = useRef(0.5)
  const anchorSigRef    = useRef<string | null>(null)  // words currently on the midline
  const sigTickRef      = useRef(false)                // throttle signature recompute to 1/frame
  const syncTickRef     = useRef(false)                // throttle right-pane follow to 1/frame

  // Own Ctrl+wheel zoom for the diff view (like the PDF viewer): scales the diff text and — crucially —
  // preventDefaults so it never triggers the browser's whole-page zoom. Cursor-anchored per pane.
  const [diffZoom, setDiffZoom] = useState(() => { try { return Number(localStorage.getItem('inkwave:diffZoom')) || 1 } catch { return 1 } })
  const dzAnchor = useRef<{ el: HTMLDivElement; offY: number; fracY: number } | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const pane = leftScrollRef.current?.contains(e.target as Node) ? leftScrollRef.current
        : rightScrollRef.current?.contains(e.target as Node) ? rightScrollRef.current : null
      if (pane) { const offY = e.clientY - pane.getBoundingClientRect().top; dzAnchor.current = { el: pane, offY, fracY: pane.scrollHeight ? (pane.scrollTop + offY) / pane.scrollHeight : 0 } }
      else dzAnchor.current = null
      setDiffZoom(z => { const n = Math.max(0.6, Math.min(2.5, +(z * (e.deltaY < 0 ? 1.08 : 0.926)).toFixed(3))); try { localStorage.setItem('inkwave:diffZoom', String(n)) } catch { /* private */ }; return n })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const a = dzAnchor.current
    if (!a) return
    const id = requestAnimationFrame(() => { a.el.scrollTop = Math.max(0, a.fracY * a.el.scrollHeight - a.offY) })
    return () => cancelAnimationFrame(id)
  }, [diffZoom])
  const lastHoveredRef  = useRef<number | null>(null)
  const activeOpIdxRef  = useRef<number | null>(null)

  // Each diff's real DOCUMENT page, measured from the EDITOR's pagination (same pageH the minimap uses), so
  // the diff panel's page-break rules carry the SAME numbers as the minimap.
  const [diffPages, setDiffPages] = useState<Record<number, number>>({})
  useEffect(() => {
    const L = leftScrollRef.current
    if (!L) return
    const compute = () => {
      const paper = L.querySelector('.scroll-paper') as HTMLElement | null
      const pw = paper?.clientWidth || L.clientWidth || 1
      const pageH = Math.max(200, pw * Math.SQRT2)
      const lr = L.getBoundingClientRect()
      const map: Record<number, number> = {}
      L.querySelectorAll('[data-opidx]').forEach((node) => {
        const el = node as HTMLElement
        if (!el.classList.contains('diff-add') && !el.classList.contains('diff-del')) return
        const idx = Number(el.getAttribute('data-opidx'))
        const y = el.getBoundingClientRect().top - lr.top + L.scrollTop
        map[idx] = Math.floor(y / pageH) + 1
      })
      setDiffPages((prev) => {
        const mk = Object.keys(map)
        return (mk.length === Object.keys(prev).length && mk.every(k => prev[+k] === map[+k])) ? prev : map
      })
    }
    const id = requestAnimationFrame(compute)
    const t = setTimeout(compute, 400) // after fonts/pagination settle
    const ro = new ResizeObserver(() => compute()); ro.observe(L)
    return () => { cancelAnimationFrame(id); clearTimeout(t); ro.disconnect() }
  }, [snapshot.id, diffZoom])

  // Publish split position as a CSS variable so the parent can position the right nav.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--snap-split-pct', vertical ? '50%' : `${splitPct}%`)
    return () => { root.style.removeProperty('--snap-split-pct') }
  }, [splitPct, vertical])

  // Compute ops once; shared between both panes. resolveCitations:true → the diff shows the reader's
  // "(Author, Year)" form, not the raw citekeys (the library is loaded on this route).
  const ops = useMemo(() => {
    if (!prevSnap) return null
    const before = pmToText(prevSnap.contentJson, true)
    const after  = pmToText(snapshot.contentJson, true)
    // Split multi-paragraph changes at their returns → more, tighter bijection lock points.
    return splitChangesAtReturns(diffWords(before, after))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevSnap?.id, snapshot.id])

  // Keep a ref so imperative highlight helpers can read ops without stale closure
  const opsRef = useRef<DiffOp[] | null>(null)
  opsRef.current = ops

  // ── Cross-pane highlight (injected CSS + data-attrs — zero React re-renders) ──
  // Inject once; CSS targets .diff-del / .diff-add spans that carry data-hover / data-active.
  useEffect(() => {
    const uid = `dv${Math.random().toString(36).slice(2, 8)}`
    const el = containerRef.current
    if (el) el.setAttribute('data-dv', uid)
    const style = document.createElement('style')
    style.textContent = [
      // hover: NO gold. Just the same green/red outline, THICKENED — from 1× (unlit) up to 2× when the diff
      // is fully lit (--iw-align=1), proportionally in between. Full-alpha so the hover reads on any diff.
      `[data-dv="${uid}"] span.diff-del[data-hover] { box-shadow: inset 0 0 0 100vmax rgba(200,30,30,0.30) !important; outline: calc(2px * (1 + var(--iw-align, 0))) solid rgba(185,28,28,0.95) !important; outline-offset: 1px !important; border-radius: 2px !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-hover] { box-shadow: inset 0 0 0 100vmax rgba(22,163,74,0.32) !important; outline: calc(2px * (1 + var(--iw-align, 0))) solid rgba(21,128,61,0.95) !important; outline-offset: 1px !important; border-radius: 2px !important; }`,
      // active (clicked): darker + outline, both panes
      `[data-dv="${uid}"] span.diff-del[data-active] { background: rgba(185,28,28,0.22) !important; outline: 2px solid #991b1b !important; outline-offset: 2px !important; border-radius: 3px !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-active] { background: rgba(22,163,74,0.32)  !important; outline: 2px solid #15803d !important; outline-offset: 2px !important; border-radius: 3px !important; }`,
      // hover + active simultaneously: combine outline with hover shade
      `[data-dv="${uid}"] span.diff-del[data-hover][data-active] { background: rgba(185,28,28,0.28) !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-hover][data-active] { background: rgba(22,163,74,0.38)  !important; }`,
      // text selection: a darker, opaque-ish shade that OVERWRITES the diff tint on the chars you highlight.
      `[data-dv="${uid}"] ::selection { background: rgba(70,50,110,0.85) !important; color: #fff !important; }`,
      `[data-dv="${uid}"] ::-moz-selection { background: rgba(70,50,110,0.85) !important; color: #fff !important; }`,
    ].join('\n')
    document.head.appendChild(style)
    return () => { style.remove(); el?.removeAttribute('data-dv') }
  }, [])

  // Auto-copy the selection to the clipboard (with a toast) when you finish highlighting text in the diff.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let last = ''
    const onUp = () => {
      const sel = window.getSelection()
      const text = sel?.toString() ?? ''
      if (!text.trim() || !sel || !el.contains(sel.anchorNode) || text === last) return
      last = text
      navigator.clipboard?.writeText(text)
        .then(() => window.dispatchEvent(new CustomEvent(CITATION_TOAST_EVENT, { detail: { text: 'Copied to clipboard' } })))
        .catch(() => { /* clipboard blocked — no toast */ })
    }
    el.addEventListener('mouseup', onUp)
    return () => el.removeEventListener('mouseup', onUp)
  }, [])

  const setAttr = useCallback((opIdx: number | null, attr: string, add: boolean) => {
    if (opIdx === null) return
    containerRef.current?.querySelectorAll(`[data-opidx="${opIdx}"]`).forEach(el => {
      if (add) el.setAttribute(attr, '') ; else el.removeAttribute(attr)
    })
  }, [])

  // Hover glow lights whenever the cursor is over a diff — EXCEPT while panning or scrolling (scrolling the
  // content under a still cursor was the case that spuriously lit it; see the scroll-suppress effect).
  // A multi-line diff is ONE wrapped span, so the leading between its lines isn't over the span and fires a
  // mouseleave. Treat the diff as a BLOCK: on leave, keep it lit if the cursor is still inside its bounding
  // box (a span's getBoundingClientRect spans all its line-boxes, gaps included). Applies to both panes.
  const mousePosRef = useRef({ x: 0, y: 0 })
  const cursorInDiff = useCallback((idx: number) => {
    const c = containerRef.current
    if (!c) return false
    const { x, y } = mousePosRef.current
    let hit = false
    c.querySelectorAll(`[data-opidx="${idx}"]`).forEach((el) => {
      // Per-LINE rects — a tetris shape that wraps the actual text, NOT the bounding box (which would add
      // the empty notch regions past the end of one line / before the start of the next). Each rect is
      // padded vertically so the leading BETWEEN wrapped lines still counts as inside the block.
      for (const r of (el as HTMLElement).getClientRects()) {
        const pad = 3 // line-boxes are contiguous; a hair of pad only bridges sub-pixel seams
        if (x >= r.left && x <= r.right && y >= r.top - pad && y <= r.bottom + pad) hit = true
      }
    })
    return hit
  }, [])
  const handleHoverOp = useCallback((opIdx: number | null) => {
    if (opIdx == null) { // mouseleave — keep lit if we're still inside the diff's block (a gap between its lines)
      const cur = lastHoveredRef.current
      if (cur != null && cursorInDiff(cur)) return
      setAttr(cur, 'data-hover', false)
      lastHoveredRef.current = null
      return
    }
    setAttr(lastHoveredRef.current, 'data-hover', false) // clear the previous
    lastHoveredRef.current = opIdx
    if (panningRef.current || scrollingRef.current) return // no glow while panning or scrolling
    setAttr(opIdx, 'data-hover', true)
  }, [setAttr, cursorInDiff])

  // Track the cursor position (for the block-hover test) AND set the cross-pane DRIVER by which pane the
  // cursor is over — a live hit-test each mousemove, robust where mouseenter gets dropped.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      mousePosRef.current.x = e.clientX; mousePosRef.current.y = e.clientY
      const t = e.target as Node, R = rightScrollRef.current, L = leftScrollRef.current
      if (R && R.contains(t)) driverRef.current = 'right'
      else if (L && L.contains(t)) driverRef.current = 'left'
      // Drop the glow the instant the cursor leaves the diff's block — mouseleave can lag on a fast move.
      const cur = lastHoveredRef.current
      if (cur != null && !panningRef.current && !scrollingRef.current && !cursorInDiff(cur)) {
        setAttr(cur, 'data-hover', false); lastHoveredRef.current = null
      }
    }
    el.addEventListener('mousemove', onMove, { passive: true })
    return () => el.removeEventListener('mousemove', onMove)
  }, [cursorInDiff, setAttr])

  // Suppress the hover glow WHILE either pane is scrolling; re-light the hovered diff once it settles. This
  // replaces the old "must have moved onto it" velocity gate — scrolling is the case that spuriously lit it.
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    const onAnyScroll = () => {
      scrollingRef.current = true
      setAttr(lastHoveredRef.current, 'data-hover', false)
      window.clearTimeout(scrollStopTimer.current)
      scrollStopTimer.current = window.setTimeout(() => {
        scrollingRef.current = false
        if (!panningRef.current && lastHoveredRef.current != null) setAttr(lastHoveredRef.current, 'data-hover', true)
      }, 140)
    }
    L?.addEventListener('scroll', onAnyScroll, { passive: true })
    R?.addEventListener('scroll', onAnyScroll, { passive: true })
    return () => {
      L?.removeEventListener('scroll', onAnyScroll); R?.removeEventListener('scroll', onAnyScroll)
      window.clearTimeout(scrollStopTimer.current)
    }
  }, [snapshot.id, setAttr])

  // Click from right pane: toggle active op, scroll LEFT pane so midline hits the change.
  const handleClickOp = useCallback((opIdx: number) => {
    const prev = activeOpIdxRef.current
    const next = prev === opIdx ? null : opIdx
    setAttr(prev, 'data-active', false)
    activeOpIdxRef.current = next
    setAttr(next, 'data-active', true)
    if (next !== null) {
      // Clicked in the DIFF pane → scroll only the EDITOR so that same change lands at the SAME viewport-y
      // it's at in the diff pane (they line up). Driver pinned to the diff pane so it stays put.
      driverRef.current = 'right'
      const R = rightScrollRef.current, L = leftScrollRef.current
      if (!R || !L) return
      const rEl = R.querySelector(`[data-opidx="${next}"]`) as HTMLElement | null
      const lEl = L.querySelector(`[data-opidx="${next}"]`) as HTMLElement | null
      if (!rEl || !lEl) return
      const yr = rEl.getBoundingClientRect().top - R.getBoundingClientRect().top
      const lTop = lEl.getBoundingClientRect().top - L.getBoundingClientRect().top + L.scrollTop
      const newScrollTop = Math.max(0, lTop - yr)
      L.scrollTo({ top: newScrollTop, behavior: 'smooth' })
      anchorRatioRef.current = (newScrollTop + L.clientHeight * midFracRef.current) / L.scrollHeight
    }
  }, [setAttr])

  // Click from left (EDITOR) pane: toggle active op, scroll only the RIGHT (diff) pane to the change.
  const handleLeftPaneClick = useCallback((opIdx: number) => {
    const prev = activeOpIdxRef.current
    const next = prev === opIdx ? null : opIdx
    setAttr(prev, 'data-active', false)
    activeOpIdxRef.current = next
    setAttr(next, 'data-active', true)
    if (next !== null) {
      // Clicked in the EDITOR → scroll only the DIFF pane so that change lands at the SAME viewport-y it's
      // at in the editor. Driver pinned to the editor so it stays put. Flag the flight so the diffs light
      // as the diff pane passes them (its own scroll handler drives the glow — see onRightScroll).
      driverRef.current = 'left'
      diffFlightRef.current = true
      window.setTimeout(() => { diffFlightRef.current = false }, 900)
      const L = leftScrollRef.current, R = rightScrollRef.current
      if (!L || !R) return
      const lEl = L.querySelector(`[data-opidx="${next}"]`) as HTMLElement | null
      const rEl = R.querySelector(`[data-opidx="${next}"]`) as HTMLElement | null
      if (!lEl || !rEl) return
      const yl = lEl.getBoundingClientRect().top - L.getBoundingClientRect().top
      const rTop = rEl.getBoundingClientRect().top - R.getBoundingClientRect().top + R.scrollTop
      R.scrollTo({ top: Math.max(0, rTop - yl), behavior: 'smooth' })
    }
  }, [setAttr])

  // ── Scroll anchor ──────────────────────────────────────────────────────────
  // Track both the fractional position (fallback) and the text on the midline (primary).
  const onLeftScroll = useCallback(() => {
    const el = leftScrollRef.current
    if (!el || !el.scrollHeight) return
    anchorRatioRef.current = (el.scrollTop + el.clientHeight * midFracRef.current) / el.scrollHeight
    // Sway the parchment waves on scroll here too — in diff mode the scroll happens on THIS wrapper, not
    // the Scroll surface, so its own scroll handler never fires.
    const surf = el.querySelector('.inkwave-editor-surface') as HTMLElement | null
    if (surf) surf.style.setProperty('--wave-x', `${(el.scrollTop * 0.06).toFixed(1)}px`)
    // caret hit-testing is comparatively costly — recompute the signature at most once per frame
    if (!sigTickRef.current) {
      sigTickRef.current = true
      requestAnimationFrame(() => {
        sigTickRef.current = false
        const cur = leftScrollRef.current
        if (cur) { const s = midlineSignature(cur); if (s) anchorSigRef.current = s }
      })
    }
    // Follow the right (hunk) pane via a BIJECTION whose lock points are the diffs ("traffic lights"):
    // each change's CENTRE in the document pane maps to that change's CENTRE in the diff pane, so both are
    // in exact sync as a change passes the midline, interpolating smoothly between locks (with a local
    // slope-1 magnetic snap right at each lock — see below).
    if (!syncTickRef.current) {
      syncTickRef.current = true
      requestAnimationFrame(() => {
        syncTickRef.current = false
        const L = leftScrollRef.current, R = rightScrollRef.current
        if (!L || !R) return
        const lRect = L.getBoundingClientRect(), rRect = R.getBoundingClientRect()
        const knots: Array<{ ly: number; ry: number; idx?: number; lHalf?: number }> = []
        L.querySelectorAll('[data-opidx]').forEach(le => {
          const idx = (le as HTMLElement).getAttribute('data-opidx')
          const re = R.querySelector(`[data-opidx="${idx}"]`) as HTMLElement | null
          if (!re) return
          // Lock MIDLINE-to-MIDLINE: each diff's vertical centre in the editor maps to that same diff's
          // vertical centre in the diff pane. So the scroll position where a diff's centre sits on the
          // editor midline is exactly where that diff's centre sits on the diff pane's midline.
          const lr = (le as HTMLElement).getBoundingClientRect()
          const rr = re.getBoundingClientRect()
          knots.push({
            ly: (lr.top + lr.height / 2) - lRect.top + L.scrollTop,
            ry: (rr.top + rr.height / 2) - rRect.top + R.scrollTop,
            idx: Number(idx),
            lHalf: lr.height / 2, // editor-pane half-height → the glow's reach is this + 40px past each edge
          })
        })
        if (!knots.length) return
        // NO boundary knots: pinning the doc extremes to the diff-pane extremes overrode the topmost /
        // bottommost diffs' own alignment, so they drifted apart at the ends. Instead the map is 1:1 above
        // the first diff and below the last (see below), which keeps the extreme diffs travelling together
        // right to the top/bottom (algebra: their screen position matches in both panes under a 1:1 map).
        knots.sort((a, b) => a.ly - b.ly)
        const lMid = L.scrollTop + L.clientHeight * midFracRef.current
        // When the editor is pinned at an extreme, the extreme diff can't reach the midline — keep it fully
        // lit there anyway (its glow distance is clamped to 0 below).
        const atTop = L.scrollTop <= 1
        const atBottom = L.scrollTop >= L.scrollHeight - L.clientHeight - 1
        const topIdx = knots[0]?.idx, botIdx = knots[knots.length - 1]?.idx
        let ry: number
        if (lMid <= knots[0].ly) ry = knots[0].ry - (knots[0].ly - lMid)                       // before first lock point: 1:1
        else if (lMid >= knots[knots.length - 1].ly) ry = knots[knots.length - 1].ry + (lMid - knots[knots.length - 1].ly)
        else {
          let i = 0
          while (i < knots.length - 1 && knots[i + 1].ly <= lMid) i++
          const a = knots[i], b = knots[i + 1]
          const t = (lMid - a.ly) / Math.max(1, b.ly - a.ly)
          ry = a.ry + t * (b.ry - a.ry)
        }
        // Local magnetic snap: within ±W of a diff LOCK POINT, blend the linear map toward a slope-1 line
        // through the lock, so both midlines move in lockstep AT the lock (dry/dlMid = 1, d²ry/dlMid² = 0 —
        // Taylor-matched to 2nd order), easing back to linear by the window edge. smootherstep gives zero
        // 1st AND 2nd derivative at both ends → no kink where it hands back to the linear segments. The
        // window is capped to half the gap to the nearest neighbouring lock so adjacent windows never
        // overlap (they meet at u=0, staying continuous). This is what makes passing a change feel like it
        // "clicks in" without the whole follow being snappy.
        {
          const MAXW = 40
          let nk: { ly: number; ry: number; idx?: number } | null = null, nd = Infinity
          for (const k of knots) { if (k.idx == null) continue; const d = Math.abs(k.ly - lMid); if (d < nd) { nd = d; nk = k } }
          if (nk && nd < MAXW) {
            let gapPrev = Infinity, gapNext = Infinity
            for (const k of knots) {
              if (k === nk || k.idx == null) continue
              const dd = k.ly - nk.ly
              if (dd < 0) gapPrev = Math.min(gapPrev, -dd)
              else if (dd > 0) gapNext = Math.min(gapNext, dd)
            }
            const W = Math.min(MAXW, gapPrev / 2, gapNext / 2)
            if (nd < W) {
              const p = 1 - nd / W                             // 1 at the lock, 0 at the window edge
              const u = p * p * p * (p * (p * 6 - 15) + 10)     // smootherstep → u' = u'' = 0 at both ends
              const mag = nk.ry + (lMid - nk.ly)               // slope-1 line through the lock
              ry = u * mag + (1 - u) * ry
            }
          }
        }
        if (driverRef.current === 'left' && bijectionRef.current === 'both') { // editor drives diff (forward) only
          rightTargetRef.current = Math.max(0, ry - R.clientHeight * midFracRef.current)
          if (directFollowRef.current) { R.scrollTop = rightTargetRef.current } // glide, no bounce
          else runSpring()
        }

        // Synchronised alignment glow: a CONTINUOUS Gaussian per diff — intensity 1 when its centre is on
        // the midline, tapering to ~0 about 40px past its top/bottom edges (reach = half-height + 40). No
        // cap: every diff glows in turn as it passes. Both panes get the same --iw-align, so they light up
        // together. Clear diffs that scrolled out of reach.
        // PLATEAU glow: fully lit (1) the whole time the midline is inside the diff body (|d| ≤ half) — so
        // every diff is reliably, fully lit once as it passes — with a smootherstep dropoff over the next
        // GLOW_DROP px (curved shoulders, zero slope at both ends → no visible edge).
        const GLOW_DROP = 40
        const still = new Set<number>()
        for (const k of knots) {
          if (k.idx == null) continue
          const half = k.lHalf ?? 0
          // Pinned extreme diff → clamp to 0 (fully lit) so it stays glowing at the top/bottom.
          const pinned = (atTop && k.idx === topIdx) || (atBottom && k.idx === botIdx)
          const d = pinned ? 0 : Math.abs(k.ly - lMid)
          let I: number
          if (d <= half) I = 1
          else if (d >= half + GLOW_DROP) I = 0
          else { const t = 1 - (d - half) / GLOW_DROP; I = t * t * t * (t * (t * 6 - 15) + 10) }
          if (I > 0.001) { setAlignGlow(k.idx, I); still.add(k.idx) }
        }
        for (const idx of glowSetRef.current) if (!still.has(idx)) setAlignGlow(idx, 0)
        glowSetRef.current = still
      })
    }
  }, [runSpring, setAlignGlow])

  // Cache the diff centres — recomputed ONLY on layout change (snapshot / zoom / orientation / pane sizes
  // / resize), never during scroll. So the snap physics reads centresRef.current with zero per-frame
  // getBoundingClientRect. rAF so it reads AFTER the new layout has painted.
  useEffect(() => {
    const el = leftScrollRef.current
    if (!el) return
    const recompute = () => {
      const L = leftScrollRef.current, R = rightScrollRef.current
      if (!L) return
      centresRef.current = diffCentres(L)
      if (R) rCentresRef.current = diffCentres(R)
      if (R) {
        const lRect = L.getBoundingClientRect(), rRect = R.getBoundingClientRect()
        const ks: Array<{ ly: number; ry: number; lHalf: number; rHalf: number; idx: number }> = []
        L.querySelectorAll('[data-opidx]').forEach((le) => {
          const el = le as HTMLElement
          if (!el.classList.contains('diff-add') && !el.classList.contains('diff-del')) return
          const idx = el.getAttribute('data-opidx')
          const re = R.querySelector(`[data-opidx="${idx}"]`) as HTMLElement | null
          if (!re || idx == null) return
          const lr = el.getBoundingClientRect(), rr = re.getBoundingClientRect()
          ks.push({
            ly: (lr.top + lr.height / 2) - lRect.top + L.scrollTop, lHalf: lr.height / 2,
            ry: (rr.top + rr.height / 2) - rRect.top + R.scrollTop, rHalf: rr.height / 2,
            idx: Number(idx),
          })
        })
        ks.sort((a, b) => a.ly - b.ly)
        knotsRef.current = ks
        // (No resting clamp here — it repositioned the diff pane independently of the editor on every layout
        //  recompute, breaking the top/bottom lock. The wheel/pan clamp in onRightScroll handles end-at-lock.)
      }
    }
    // rAF-coalesce: a window resize fires many events per drag; run the heavy layout-read sweep at most once
    // per frame on the settled size instead of synchronously per event.
    let rafId = requestAnimationFrame(recompute)
    const onResize = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(recompute) }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize) }
  }, [snapshot.id, diffZoom, vertical, splitPct, sidePanelPx])

  // REVERSE SYNC (bijection): scrolling the DIFF panel maps the EDITOR to the inverse-bijection position
  // INSTANTLY — a true 1:1 bijection, no trailing. The DRIVER is simply whichever pane the CURSOR is over
  // (mouseenter), so switching panes flips the direction immediately. The follower moves programmatically;
  // its own scroll handler sees the driver is the OTHER pane and doesn't drive back.
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    if (!L || !R) return
    // (driver is set by the mousemove hit-test above — robust vs mouseenter being dropped.)
    const inverse = (ry: number): number => { // diff-pane position → editor position
      const ks = knotsRef.current
      if (!ks.length) return ry
      if (ry <= ks[0].ry) return ks[0].ly - (ks[0].ry - ry)
      const last = ks[ks.length - 1]
      if (ry >= last.ry) return last.ly + (ry - last.ry)
      let i = 0
      while (i < ks.length - 1 && ks[i + 1].ry <= ry) i++
      const a = ks[i], b = ks[i + 1]
      return a.ly + ((ry - a.ry) / Math.max(1, b.ry - a.ry)) * (b.ly - a.ly)
    }
    let rTick = false
    const onRightScroll = () => {
      // While a click flies the diff pane (editor static), light diffs off the DIFF pane's own midline —
      // onLeftScroll's glow can't fire because the editor isn't moving.
      if (diffFlightRef.current) setGlowFromDiffMid(R.scrollTop + R.clientHeight * midFracRef.current)
      // Clamp the USER's diff-panel scroll so it ENDS at the first/last diff lock — no over-scroll into the
      // lead/trail whitespace (keeps the extremes consistent with the editor). Only while the diff drives,
      // so it never fights the forward-drive spring.
      const ks = knotsRef.current
      if (ks.length && driverRef.current === 'right' && !panningRef.current) { // never clamp mid right-drag (it stuck on the first move)
        const minS = Math.max(0, ks[0].ry - R.clientHeight * midFracRef.current)
        const maxS = ks[ks.length - 1].ry - R.clientHeight * midFracRef.current
        if (R.scrollTop < minS) { R.scrollTop = minS; return }
        if (maxS > minS && R.scrollTop > maxS) { R.scrollTop = maxS; return }
      }
      if (bijectionRef.current === 'off') return   // no cross-pane sync
      if (driverRef.current !== 'right') return     // cursor isn't over the diff → the diff is just following
      if (rTick) return
      rTick = true
      requestAnimationFrame(() => {
        rTick = false
        L.scrollTop = Math.max(0, inverse(R.scrollTop + R.clientHeight * midFracRef.current) - L.clientHeight * midFracRef.current)
      })
    }
    R.addEventListener('scroll', onRightScroll, { passive: true })
    return () => { R.removeEventListener('scroll', onRightScroll) }
  }, [snapshot.id])

  // Right-click-DRAG the diff pane to scroll it (for mouse users with no wheel/trackpad) — the editor flies
  // to the matching change via the bijection. Context menu is suppressed on the pane so the drag owns it.
  useEffect(() => {
    const cleanups: Array<() => void> = []
    let dragging: HTMLDivElement | null = null, lastY = 0
    const onUp = () => { if (dragging) { dragging = null; panningRef.current = false; document.body.style.cursor = '' } }
    const onMove = (e: MouseEvent) => { if (!dragging) return; dragging.scrollTop -= (e.clientY - lastY); lastY = e.clientY }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    cleanups.push(() => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = '' })
    // Right-drag on EITHER pane pans it (and pins the driver to it, so the other pane follows via the bijection).
    // While panning: hand cursor everywhere + no hover glow (panningRef).
    const installDrag = (el: HTMLDivElement | null, drive: 'left' | 'right') => {
      if (!el) return
      const onDown = (e: MouseEvent) => {
        if (e.button !== 2) return
        dragging = el; lastY = e.clientY; driverRef.current = drive
        panningRef.current = true; document.body.style.cursor = 'grabbing'
        setAttr(lastHoveredRef.current, 'data-hover', false) // drop any hover glow
        e.preventDefault()
      }
      const onCtx = (e: Event) => e.preventDefault()
      el.addEventListener('mousedown', onDown)
      el.addEventListener('contextmenu', onCtx)
      cleanups.push(() => { el.removeEventListener('mousedown', onDown); el.removeEventListener('contextmenu', onCtx) })
    }
    installDrag(leftScrollRef.current, 'left')
    installDrag(rightScrollRef.current, 'right')
    return () => cleanups.forEach((fn) => fn())
  }, [snapshot.id])

  // One-time right-drag hint toast, sequenced just AFTER the Shift+scroll hint (which runs ~6s).
  useEffect(() => {
    try { if (localStorage.getItem('inkwave:snapDragHintSeen') === '1') return; localStorage.setItem('inkwave:snapDragHintSeen', '1') } catch { return }
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent(CITATION_TOAST_EVENT, { detail: { text: 'On a mouse? Right-click-drag EITHER panel to pan it — the other flies to match.' } })), 6800)
    return () => clearTimeout(t)
  }, [])

  // Editor snap mode A — WHEEL-TAKEOVER PHYSICS: we take the wheel and integrate a particle (the scroll
  // position) moving with LINEAR RESISTANCE through a landscape of POTENTIAL WELLS at the diffs. A wheel
  // delta is an impulse to velocity; each frame: v += wellForce − resist·v (exponential-decay fling that
  // the wells bend), then x += v · speedWarp (the Mexican-hat slow-through/fast-before layered on). Result:
  // a fast flick coasts and decays Apple-style; a slow one is captured and settles onto the nearest diff.
  // Ctrl/⌘+wheel is left alone (that's the diff zoom). Centres come from the cache → zero layout per frame.
  useEffect(() => {
    if (snapMode !== 'warp') return
    const cleanups: Array<() => void> = []
    // Install the SAME wheel-takeover physics on a pane: nearest-well pull, velocity-based resistance,
    // fencepost on mousewheel. Runs only while THIS pane is the driver (cursor over it) — the other pane
    // follows via the bijection. Editor and diff panel each get their own instance + own diff centres.
    const install = (el: HTMLDivElement | null, getCentres: () => Centre[], drive: 'left' | 'right') => {
      if (!el) return
      let v = 0, x = el.scrollTop, raf = 0
      const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight)
      const tick = () => {
        if (driverRef.current !== drive) { raf = 0; return } // not the driver → the follow owns this pane
        const centres = getCentres()
        let nk: Centre | null = null, nd = Infinity
        for (const c of centres) { const d = Math.abs(x - c.c); if (d < nd) { nd = d; nk = c } }
        let F = 0
        if (nk) {
          const w = nk.half + WARP_WELL_PAD, dx = x - nk.c
          if (Math.abs(dx) < w * 3) F = -(dx / w) * Math.exp(-(dx * dx) / (2 * w * w)) * WARP_WELL
        }
        const resistance = WARP_RESIST_MIN + (WARP_RESIST_MAX - WARP_RESIST_MIN) * Math.exp(-Math.abs(v) / WARP_V0)
        v = v + F - resistance * v
        x = Math.max(0, Math.min(maxScroll(), x + v))
        el.scrollTop = x
        if (Math.abs(v) < 0.05 && Math.abs(F) < 0.05) { v = 0; raf = 0; return } // settled
        raf = requestAnimationFrame(tick)
      }
      let fenceRaf = 0, natTarget = el.scrollTop, dispTarget = el.scrollTop
      const easeFence = () => {
        if (driverRef.current !== drive) { fenceRaf = 0; return }
        const dx = dispTarget - el.scrollTop
        if (Math.abs(dx) < 0.5) { el.scrollTop = dispTarget; x = dispTarget; fenceRaf = 0; return }
        el.scrollTop = el.scrollTop + dx * 0.3
        x = el.scrollTop
        fenceRaf = requestAnimationFrame(easeFence)
      }
      const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return // ⌘/ctrl = zoom; shift = snapshot scrub (window handler)
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // horizontal two-finger swipe = snapshot scrub (below)
        e.preventDefault()
        x = el.scrollTop
        const isMouseWheel = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 100
        if (isMouseWheel) { // FENCEPOST — hop to the next diff within ±delta/2 of the natural landing
          if (raf) { cancelAnimationFrame(raf); raf = 0; v = 0 }
          if (fenceRaf === 0) natTarget = el.scrollTop
          const delta = e.deltaMode !== 0 ? e.deltaY * 40 : e.deltaY
          natTarget = Math.max(0, Math.min(maxScroll(), natTarget + delta))
          const mid = natTarget + el.clientHeight * midFracRef.current, hw = Math.abs(delta) / 2
          let pick: Centre | null = null
          for (const c of getCentres()) {
            if (Math.abs(c.c - mid) > hw) continue
            if (!pick || (c.add !== pick.add ? c.add : c.len > pick.len)) pick = c // green first, then longest
          }
          dispTarget = pick ? Math.max(0, Math.min(maxScroll(), pick.c - el.clientHeight * midFracRef.current)) : natTarget
          if (!fenceRaf) fenceRaf = requestAnimationFrame(easeFence)
          return
        }
        if (fenceRaf) { cancelAnimationFrame(fenceRaf); fenceRaf = 0 } // a trackpad flick interrupts a fence glide
        v = Math.max(-40, Math.min(40, v + e.deltaY * WARP_IMPULSE)) // cap max scroll speed (continuous trackpad was flying at ±90)
        if (!raf) raf = requestAnimationFrame(tick)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      cleanups.push(() => { el.removeEventListener('wheel', onWheel); if (raf) cancelAnimationFrame(raf); if (fenceRaf) cancelAnimationFrame(fenceRaf) })
    }
    install(leftScrollRef.current, () => centresRef.current, 'left')    // editor pane
    install(rightScrollRef.current, () => rCentresRef.current, 'right') // diff pane
    return () => cleanups.forEach((fn) => fn())
  }, [snapMode, snapshot.id])

  // Trackpad TWO-FINGER HORIZONTAL swipe over the editor or diff pane → snapshot scrub — a pure position
  // scrubber (Apple-Photos style): NO flick/momentum. A small detent (FIRST) commits the first snap, then
  // every REST px is another, applied as a NET hop per event so a light swipe flies through 10-30. A pause
  // resets the gesture so the next swipe re-arms the detent. Vertical wheels are untouched.
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    let accum = 0, started = false, idle: ReturnType<typeof setTimeout> | undefined
    const FIRST = 34, REST = 7
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.3) return // not a horizontal swipe
      e.preventDefault()
      clearTimeout(idle)
      idle = setTimeout(() => { started = false; accum = 0 }, 140) // pause → re-arm the detent
      accum += e.deltaX
      let net = 0
      if (!started && Math.abs(accum) >= FIRST) { started = true; const s = accum > 0 ? 1 : -1; accum -= s * FIRST; net += -s } // reversed: right → previous
      if (started) while (Math.abs(accum) >= REST) { const s = accum > 0 ? 1 : -1; accum -= s * REST; net += -s }
      if (net) nav?.onScrub(net)
    }
    L?.addEventListener('wheel', onWheel, { passive: false })
    R?.addEventListener('wheel', onWheel, { passive: false })
    return () => { clearTimeout(idle); L?.removeEventListener('wheel', onWheel); R?.removeEventListener('wheel', onWheel) }
  }, [nav, snapshot.id])

  // On snapshot change: reposition the new content under the midline. Two modes:
  //  • 'center'  — keep the SAME words on the midline (content-anchored; the default).
  //  • 'longest' — snap so the biggest change sits just BELOW the midline, i.e. the dotted line
  //                lands just above whichever diff has the longest character chain.
  useEffect(() => {
    const el = leftScrollRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      if (lineMode === 'longest') {
        const li = longestChangeOpIdx(opsRef.current)
        const target = li != null ? (el.querySelector(`[data-opidx="${li}"]`) as HTMLElement | null) : null
        if (target) {
          const elRect = el.getBoundingClientRect()
          const tRect  = target.getBoundingClientRect()
          const topInContent = tRect.top - elRect.top + el.scrollTop
          el.scrollTop = Math.max(0, topInContent - el.clientHeight * midFracRef.current - 8) // diff sits just below the line
          const s = midlineSignature(el); if (s) anchorSigRef.current = s
          return
        }
        // no change to snap to → fall through to keep-words-put
      }
      const sig = anchorSigRef.current
      let target: number | null = null
      if (sig) target = scrollTopForSignature(el, sig, anchorRatioRef.current)
      if (target == null) target = anchorRatioRef.current * el.scrollHeight - el.clientHeight * midFracRef.current
      el.scrollTop = Math.max(0, target)
      // Refresh the anchor from the new midline so the next navigation stays locked to
      // these same words even if the user never manually scrolls.
      const s = midlineSignature(el)
      if (s) anchorSigRef.current = s
    })
    return () => cancelAnimationFrame(id)
  }, [snapshot.id, lineMode])

  // ── Divider drag ──────────────────────────────────────────────────────────
  const startDrag = useCallback((startX: number, startY: number) => {
    dragging.current = true
    const onMove = (x: number, y: number) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const raw = vertical
        ? ((y - rect.top)  / rect.height) * 100
        : ((x - rect.left) / rect.width)  * 100
      setSplitPct(Math.max(20, Math.min(80, Math.round(raw))))
    }
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY)
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY) }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)
    void startX; void startY
  }, [vertical])

  // Side-panel resize (its own divider). Width in wide mode, height in vertical mode.
  const startSideDrag = useCallback(() => {
    sideDragging.current = true
    const onMove = (x: number, y: number) => {
      if (!sideDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const px = vertical ? (rect.bottom - y) : (rect.right - x)
      setSidePanelPx(Math.max(150, Math.min(vertical ? rect.height - 120 : rect.width - 200, Math.round(px))))
    }
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY)
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY) }
    const onUp = () => {
      sideDragging.current = false
      window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove); window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }, [vertical])

  // A dotted reading-line at the pane centre (both panes share it).
  const midline = (
    <div aria-hidden="true" style={{
      position: 'absolute', top: `${midFrac * 100}%`, left: 0, right: 0, zIndex: 5,
      borderTop: '1px dashed rgba(92,45,138,0.38)', pointerEvents: 'none', transform: 'translateY(-0.5px)',
    }} />
  )

  // ── The three panes as size-parameterised elements, so desktop (diff | editor | side) and narrow
  //    (editor on top; side + diff below) can arrange the SAME panes differently. ──
  const toggleBtn = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 'clamp(20px, 3.4vh, 30px)', width: 'clamp(52px, 9vw, 78px)', padding: '0 clamp(5px, 0.8vw, 10px)',
    background: on ? INK : '#fff', color: on ? '#fff' : INK, border: `1.5px solid ${INK}`, borderRadius: 8,
    fontSize: 'clamp(0.62rem, 1.3vw, 0.8rem)', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 1px 5px rgba(80,50,10,0.12)', flexShrink: 0,
  })
  const editorPaneEl = (sz: React.CSSProperties) => (
    <div style={{ ...sz, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' } as React.CSSProperties}>
      {midline}
      <div style={{ position: 'absolute', top: 'clamp(6px, 1.4vh, 12px)', left: 'clamp(2px, 0.4vw, 6px)', zIndex: 6, display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 1vh, 10px)', alignItems: 'center' }}>
        {counter && (<div style={{ background: '#fff', border: `2px solid ${INK}`, color: INK, fontWeight: 700, borderRadius: 8, padding: 'clamp(2px,0.5vh,4px) clamp(7px,1vw,12px)', fontSize: 'clamp(0.72rem, 1.6vw, 1.1rem)', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(80,50,10,0.15)', pointerEvents: 'none' }}>{counter}</div>)}
        <button type="button" onClick={cycleSnap} title="Editor snap to diffs (wheel physics) — on/off" style={toggleBtn(snapMode !== 'off')}>{snapMode === 'off' ? 'Off' : 'On'}</button>
        <button type="button" onClick={cycleBijection} title="Cross-pane sync — Both ways · diff drives editor only · Off" style={toggleBtn(bijMode !== 'off')}>{bijMode === 'both' ? 'Both' : bijMode === 'reverse' ? 'L ← R' : 'Off'}</button>
      </div>
      <div ref={leftScrollRef} onScroll={onLeftScroll} className="iw-snap-scroll" style={{ height: '100%', overflowY: 'scroll', overflowX: 'auto' }}>
        <Scroll phone={isPhone}><div style={{ zoom: diffZoom } as React.CSSProperties}><FullDiffView ops={ops} snapshot={snapshot} onOpClick={ops ? handleLeftPaneClick : undefined} onHoverOp={handleHoverOp} /></div></Scroll>
      </div>
      {nav?.show && (<>
        <NavSide side="left" snapDir="back" onSnap={nav.onBack} snapDisabled={!nav.canBack} onVer={nav.onVerBack} verDisabled={!nav.canVerBack} hasVersions={nav.hasVersions} isPhone={isPhone} midPct={vertical ? 84 : midFrac * 100} overridePos={{ position: 'absolute', left: 8 }} />
        <NavSide side="right" snapDir="fwd" onSnap={nav.onFwd} snapDisabled={!nav.canFwd} onVer={nav.onVerFwd} verDisabled={!nav.canVerFwd} hasVersions={nav.hasVersions} isPhone={isPhone} midPct={vertical ? 84 : midFrac * 100} overridePos={{ position: 'absolute', right: 8 }} />
      </>)}
    </div>
  )
  // Thin snapshot-nav bar (‹ / ›) — a slim pair flanking the DIFF panel, mirroring the big editor nav.
  const thinNav = (side: 'left' | 'right', onClick: () => void, disabled: boolean, label: string, title: string) => (
    <button type="button" title={title} disabled={disabled} onClick={disabled ? undefined : onClick}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(140,90,200,0.35)' }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = NAV_BG }}
      style={{
        position: 'absolute', [side]: 6, top: `${midFrac * 100}%`, transform: 'translateY(-50%)', zIndex: 8,
        width: 15, height: NAV_H, borderRadius: 5, border: `1px solid rgba(140,90,200,${disabled ? 0.1 : 0.28})`,
        background: disabled ? NAV_BG_DIS : NAV_BG, color: disabled ? NAV_FG_DIS : NAV_FG,
        cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem', fontFamily: 'inherit', letterSpacing: '-0.04em', boxShadow: '0 1px 4px rgba(80,50,10,0.14)',
      }}
    >{label}</button>
  )
  const diffPaneEl = (sz: React.CSSProperties) => (
    <div style={{ ...sz, flexShrink: 0, position: 'relative', zIndex: 1, overflow: 'hidden', background: '#f9f7f4', zoom: diffZoom } as React.CSSProperties}>
      {midline}
      <InlineDiffView ops={ops} prevSnap={prevSnap} onChangeClick={handleClickOp} onHoverOp={handleHoverOp} scrollBodyRef={rightScrollRef} midFrac={midFrac} diffPages={diffPages} />
      {nav?.show && (<>
        {thinNav('left', nav.onBack, !nav.canBack, '‹', 'Previous snapshot (←)')}
        {thinNav('right', nav.onFwd, !nav.canFwd, '›', 'Next snapshot (→)')}
      </>)}
    </div>
  )
  const sidePaneEl = (sz: React.CSSProperties) => (
    <div style={{ ...sz, flexShrink: 0, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', background: '#fbfaf6', padding: 10, gap: 10, overflow: 'hidden' } as React.CSSProperties}>
      <div className="iw-snap-scroll" style={{ flex: '0 0 44%', minHeight: 0, overflowY: 'scroll', overflowX: 'hidden', fontSize: '1rem', lineHeight: 1.5, color: '#3a3a3a', border: `1.5px solid ${INK}66`, borderRadius: 8, background: '#fff', padding: '9px 11px' }}>
        {!summariesOn ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%' }}>
            <div style={{ fontSize: '0.92rem', color: INK, fontWeight: 600, textAlign: 'center', maxWidth: '14ch' }}>Plain-language recaps</div>
            <button type="button" aria-label="About snapshot recaps — turn them on" onClick={onOptInSummaries} className="transition-transform hover:scale-105" style={{ width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: INK, border: `3px solid ${INK}`, cursor: 'pointer', fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700, fontSize: '1.7rem', lineHeight: 1, boxShadow: '0 1px 6px rgba(80,50,10,0.14)', paddingBottom: 2 }}>i</button>
          </div>
        ) : summary && summary.trim()
          ? <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{summary.split('\n').filter(Boolean).map((b, i) => <li key={i} style={{ marginBottom: 7 }}>{b.replace(/^[-•*]\s*/, '')}</li>)}</ul>
          : <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>No summary for this snapshot.</span>}
      </div>
      <MinimapPanel leftRef={leftScrollRef} ops={ops} snapKey={snapshot.id} midFrac={midFrac} />
    </div>
  )
  // Grid divider filling its template track. Same DOM element whether draggable (resize) or a fixed thin
  // separator, so it never remounts across the wide/narrow flip. orient picks the resize axis + grip.
  const gridDivider = (
    area: string, orient: 'row' | 'col', onDown: (x: number, y: number) => void,
    isDrag: React.MutableRefObject<boolean>, draggable: boolean, title: string,
  ) => (
    <div style={{
      gridArea: area, width: '100%', height: '100%', minWidth: 0, minHeight: 0, zIndex: 10,
      background: draggable ? 'rgba(92,45,138,0.10)' : 'rgba(92,45,138,0.14)',
      cursor: draggable ? (orient === 'row' ? 'row-resize' : 'col-resize') : 'default',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s', userSelect: 'none',
    }}
      onMouseDown={draggable ? (e) => { e.preventDefault(); onDown(e.clientX, e.clientY) } : undefined}
      onTouchStart={draggable ? (e) => { e.preventDefault(); onDown(e.touches[0].clientX, e.touches[0].clientY) } : undefined}
      onMouseEnter={draggable ? (e) => (e.currentTarget.style.background = 'rgba(92,45,138,0.28)') : undefined}
      onMouseLeave={draggable ? (e) => { if (!isDrag.current) e.currentTarget.style.background = 'rgba(92,45,138,0.10)' } : undefined}
      title={draggable ? title : undefined}>
      {draggable && (
        <div style={{ display: 'flex', flexDirection: orient === 'row' ? 'row' : 'column', gap: 3, pointerEvents: 'none' }}>
          {[0, 1, 2].map(n => <div key={n} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(92,45,138,0.4)' }} />)}
        </div>
      )}
    </div>
  )

  // ONE stable DOM structure — the same 5 items in a constant order — placed by CSS-grid areas that differ
  // for wide vs narrow. Because the panes keep their position/identity, the wide↔narrow flip re-lays-out via
  // CSS instead of tearing down and rebuilding every pane (the remount storm that caused the switch jank).
  //   wide:  [ diff | d1 | editor | d2 | side ]           (one row)
  //   narrow: editor on top; d1 splits it from a bottom row of [ side | d2 | diff ]
  const grid: React.CSSProperties = vertical
    ? { gridTemplateColumns: '1fr 3px 1fr', gridTemplateRows: `${splitPct}% 7px 1fr`,
        gridTemplateAreas: '"editor editor editor" "d1 d1 d1" "side d2 diff"' }
    : { gridTemplateColumns: `${splitPct}% 7px 1fr 7px ${sidePanelPx}px`, gridTemplateRows: '1fr',
        gridTemplateAreas: '"diff d1 editor d2 side"' }
  return (
    <>
      <div ref={containerRef} style={{ display: 'grid', height: '100%', overflow: 'hidden', ...grid }}>
        {diffPaneEl({ gridArea: 'diff', minWidth: 0, minHeight: 0 })}
        {gridDivider('d1', vertical ? 'row' : 'col', startDrag, dragging, true, 'Drag to resize')}
        {editorPaneEl({ gridArea: 'editor', minWidth: 0, minHeight: 0 })}
        {gridDivider('d2', 'col', () => startSideDrag(), sideDragging, !vertical, 'Drag to resize the side panel')}
        {sidePaneEl({ gridArea: 'side', minWidth: 0, minHeight: 0 })}
      </div>
      <Toast />
    </>
  )
}

// ── SnapshotView ─────────────────────────────────────────────────────────────
// Read-only viewer for a past snapshot. Navigation:
//   ← / → buttons (+ keyboard / swipe) move between snapshots chronologically.
//   << / >> buttons (desktop only) jump between saved versions.
export function SnapshotView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const docId = params.get('doc')
  const snapId = params.get('snap')

  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [libReady, setLibReady] = useState(false)
  const [, setNavDir] = useState<'back' | 'fwd'>('fwd')
  const [genSeed, setGenSeed] = useState(0)   // increment to force-regenerate all summaries
  const [isRegenerating, setIsRegenerating] = useState(false)
  // AI summaries are opt-in (off by default). Enabling — here via the panel CTA, or from the
  // editor's Settings — bumps genSeed so the backfill effect fills every missing summary.
  const [aiOn, setAiOn] = useState(aiSummariesEnabled)
  const [consentOpen, setConsentOpen] = useState(false)
  useEffect(() => {
    const onChange = () => {
      const on = aiSummariesEnabled()
      setAiOn(prev => {
        if (!prev && on) setGenSeed(n => n + 1)
        return on
      })
    }
    window.addEventListener('inkwave:ai-settings-changed', onChange)
    return () => window.removeEventListener('inkwave:ai-settings-changed', onChange)
  }, [])
  // Nav flash setters kept (no-op now the floating summary panels are gone; harmless, may return).
  const [, setLeftSnapFlash]  = useState(0)
  const [, setRightSnapFlash] = useState(0)
  const [, setLeftVerFlash]   = useState(0)
  const [, setRightVerFlash]  = useState(0)
  // Dotted-line mode: 'center' keeps the same words on the midline; 'longest' snaps the line just
  // above the biggest change in each snapshot. Persisted.
  const [lineMode, setLineMode] = useState<'center' | 'longest'>(() => {
    // Default to 'longest' (snap to the biggest change) — only an explicit opt-out sticks to 'center'.
    try { return localStorage.getItem('inkwave:snapLineMode') === 'center' ? 'center' : 'longest' } catch { return 'longest' }
  })
  const toggleLineMode = useCallback(() => {
    setLineMode(m => {
      const next = m === 'longest' ? 'center' : 'longest'
      try { localStorage.setItem('inkwave:snapLineMode', next) } catch { /* private mode */ }
      return next
    })
  }, [])

  // First-ever snapshot open: a big one-time toast teaching the killer gesture (Shift+scroll to fly
  // through snapshots). Shown once (persisted), auto-dismisses, dismissable by click.
  const [showScrubHint, setShowScrubHint] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem('inkwave:snapScrubHintSeen') === '1') return
      localStorage.setItem('inkwave:snapScrubHintSeen', '1')
    } catch { return }
    setShowScrubHint(true)
    const t = setTimeout(() => setShowScrubHint(false), 6000)
    return () => clearTimeout(t)
  }, [])

  // Populate bibProvider once so citations resolve in DocView + pmToText (the snapshot route has no
  // editor to load the library). Gates the split-view render below to avoid a red "missing" flash.
  useEffect(() => {
    let cancelled = false
    void loadLibrary().finally(() => { if (!cancelled) setLibReady(true) })
    return () => { cancelled = true }
  }, [])

  // Load snapshots + set status on every navigation. Stays lean so it doesn't cancel
  // the background generation (which lives in its own effect below).
  useEffect(() => {
    let cancelled = false
    if (!docId || !snapId) { setStatus('missing'); return }
    void (async () => {
      const snaps = await listSnapshots(docId)
      if (cancelled) return
      setAllSnapshots(snaps)
      setStatus(snaps.some((s) => s.id === snapId) ? 'ready' : 'missing')
    })()
    return () => { cancelled = true }
  }, [docId, snapId])

  // Background-generate any missing diff + version summaries. Keyed on [docId, genSeed] so
  // snapshot navigation never cancels a run; genSeed increment forces full regeneration.
  useEffect(() => {
    if (!docId) return
    if (!aiOn) { setIsRegenerating(false); return } // opt-in gate: no text leaves the device
    let cancelled = false
    void (async () => {
      const snaps = await listSnapshots(docId)
      if (cancelled || snaps.length < 2) return

      // Fill missing diff summaries. Check .bullets to regenerate old-format records.
      for (let i = 1; i < snaps.length; i++) {
        if (snaps[i].diffSummary?.bullets) continue
        const before = pmToText(snaps[i - 1].contentJson)
        const after  = pmToText(snaps[i].contentJson)
        if (!before.trim() && !after.trim()) continue
        const ds = await summariseDiff(before, after)
        if (ds && !cancelled) {
          await patchSnapshotDiffSummary(docId, snaps[i].id, ds)
          setAllSnapshots((prev) => prev.map((s, j) => j === i ? { ...s, diffSummary: ds } : s))
        }
      }

      // Fill missing version summaries
      const grps = groupByVersion(snaps)
      const verSnaps = grps.map((g) => g.versionSnap).filter(Boolean) as Snapshot[]
      for (let i = 1; i < verSnaps.length; i++) {
        const vs = verSnaps[i]
        if (vs.versionSummary) continue
        const vs2 = await summariseVersionDiff(
          pmToText(verSnaps[i - 1].contentJson),
          pmToText(vs.contentJson),
        )
        if (vs2 && !cancelled) {
          await patchSnapshotVersionSummary(docId, vs.id, vs2)
          setAllSnapshots((prev) => prev.map((s) => s.id === vs.id ? { ...s, versionSummary: vs2 } : s))
        }
      }
      setIsRegenerating(false)
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, genSeed, aiOn])

  const groups = useMemo(() => groupByVersion(allSnapshots), [allSnapshots])

  const idx      = allSnapshots.findIndex((s) => s.id === snapId)
  const snapshot = idx >= 0 ? allSnapshots[idx] : null
  const groupIdx = groups.findIndex((g) => g.items.some((s) => s.id === snapId))

  const goTo = useCallback((s: Snapshot) => {
    navigate(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, { replace: true })
  }, [navigate])

  const goBack    = useCallback(() => { if (idx > 0) { setNavDir('back'); setLeftSnapFlash(n => n + 1); goTo(allSnapshots[idx - 1]) } }, [idx, allSnapshots, goTo])
  const goFwd     = useCallback(() => { if (idx < allSnapshots.length - 1) { setNavDir('fwd'); setRightSnapFlash(n => n + 1); goTo(allSnapshots[idx + 1]) } }, [idx, allSnapshots, goTo])
  const goVerBack = useCallback(() => { if (groupIdx > 0) { setNavDir('back'); setLeftVerFlash(n => n + 1); goTo(groups[groupIdx - 1].items[0]) } }, [groupIdx, groups, goTo])
  const goVerFwd  = useCallback(() => { if (groupIdx >= 0 && groupIdx < groups.length - 1) { setNavDir('fwd'); setRightVerFlash(n => n + 1); goTo(groups[groupIdx + 1].items[0]) } }, [groupIdx, groups, goTo])

  const canBack    = idx > 0
  const canFwd     = idx >= 0 && idx < allSnapshots.length - 1
  const canVerBack = groupIdx > 0
  const canVerFwd  = groupIdx >= 0 && groupIdx < groups.length - 1
  const hasVersions = groups.some((g) => g.versionSnap !== null)

  // ── Keyboard ← / → ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack() }
      if (e.key === 'ArrowRight') { e.preventDefault(); goFwd() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, goFwd])

  // ── Shift+wheel: scrub through snapshots ONE at a time ────────────────────────
  // Each wheel notch advances exactly ONE snapshot (never a jump of several) — rapid physical
  // scrolling still flies because the OS streams many notches, but each is a single, legible step.
  const idxRef = useRef(idx); idxRef.current = idx
  const allRef = useRef(allSnapshots); allRef.current = allSnapshots
  // Scrub by a NET number of snapshots at once (positive = forward). idxRef is stale within a frame, so the
  // swipe handlers accumulate a net delta and apply it in one hop.
  const scrubBy = useCallback((steps: number) => {
    const cur = idxRef.current, all = allRef.current
    if (!steps || cur < 0 || !all.length) return
    const target = Math.max(0, Math.min(all.length - 1, cur + steps))
    if (target === cur) return
    setNavDir(steps > 0 ? 'fwd' : 'back')
    goTo(all[target])
  }, [goTo])
  const wheelAccum = useRef(0)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      // Shift+wheel arrives as horizontal delta on many setups → take whichever axis is larger.
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      wheelAccum.current += d
      const STEP = 40 // wheel px to cross before stepping
      let n = 0
      // Move at most ±1 per event (then reset), so one notch = one snapshot regardless of its size.
      if (Math.abs(wheelAccum.current) >= STEP) {
        n = wheelAccum.current > 0 ? 1 : -1
        wheelAccum.current = 0
      }
      if (!n) return
      const cur = idxRef.current, all = allRef.current
      if (cur < 0 || !all.length) return
      const target = Math.max(0, Math.min(all.length - 1, cur + n))
      if (target === cur) return
      setNavDir(n > 0 ? 'fwd' : 'back')
      goTo(all[target])
    }
    // Capture phase + preventDefault so the scrub owns the wheel BEFORE the pane scrolls it (no tiny
    // pre-scroll before the snap kicks in).
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [goTo])

  // ── Touch swipe → snapshot scrub (phone) ──────────────────────────────────────
  // A roughly-HORIZONTAL drag scrubs snapshots — a PURE position-based scrubber (like Apple Photos): NO
  // flick/momentum. A small detent (FIRST) to commit the first snap, then every REST px is another — so a
  // normal drag sweeps through 10-30. Vertical stays native scroll. Works starting on either pane.
  const swipeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = swipeRef.current
    if (!el) return
    let dir: '?' | 'h' | 'v' = '?', startX = 0, startY = 0, lastX = 0, accum = 0, started = false
    const FIRST = 38, REST = 9 // detent for the first snap, then heaps
    const onStart = (e: TouchEvent) => { dir = '?'; accum = 0; started = false; startX = lastX = e.touches[0].clientX; startY = e.touches[0].clientY }
    const onMove = (e: TouchEvent) => {
      const x = e.touches[0].clientX, y = e.touches[0].clientY
      if (dir === '?') {
        const dx = x - startX, dy = y - startY
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return          // wait for a decisive move
        dir = Math.abs(dx) > Math.abs(dy) * 1.7 ? 'h' : 'v'         // must be pretty horizontal
      }
      if (dir !== 'h') return                                        // vertical → let the pane scroll natively
      e.preventDefault()
      accum += x - lastX; lastX = x
      let net = 0
      if (!started && Math.abs(accum) >= FIRST) { started = true; const s = accum > 0 ? 1 : -1; accum -= s * FIRST; net += -s } // slide right → previous
      if (started) while (Math.abs(accum) >= REST) { const s = accum > 0 ? 1 : -1; accum -= s * REST; net += -s }
      if (net) scrubBy(net)
    }
    const onEnd = () => { dir = '?' }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd) }
  }, [scrubBy])

  const isPhone = isTouchDevice()
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  const versionLabel = groupIdx >= 0 ? groups[groupIdx].label || 'draft' : ''

  const snapInGroup = groupIdx >= 0
    ? groups[groupIdx].items.findIndex((s) => s.id === snapId) + 1
    : 0
  const lastGroup = groups[groups.length - 1]

  // Always diff against the immediately preceding snapshot (not direction-sensitive)
  const prevSnap = idx > 0 ? allSnapshots[idx - 1] : null

  // Words added/removed vs the previous snapshot — now shown in the top header (not a bar over the diff).
  const headerDiff = useMemo(() => {
    if (!snapshot || !prevSnap) return null
    const before = pmToText(prevSnap.contentJson, true)
    const after = pmToText(snapshot.contentJson, true)
    return diffStats(diffWords(before, after))
  }, [snapshot?.id, prevSnap?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // AI summary — now shown in the RHS side panel (no longer floating over the document).
  const currentDiff = snapshot?.diffSummary?.bullets ?? null

  return (
    // height:100dvh so the split pane fills the screen without page scroll
    <div
      ref={swipeRef}
      className="font-serif"
      style={{ height: '100dvh', overflow: 'hidden', color: '#3a3a3a', display: 'flex', flexDirection: 'column' }}
    >
      {/* First-open gesture hint — centred, one-time, with an explicit close. */}
      {showScrubHint && (
        <div
          style={{
            position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 200,
            padding: '11px 44px 11px 18px', borderRadius: 10,
            background: 'rgba(35,25,50,0.94)', color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
            fontSize: 'clamp(0.8rem, 1.8vw, 1.15rem)', fontWeight: 500, textAlign: 'center', lineHeight: 1.35,
            maxWidth: '90vw',
          }}
        >
          Press <span style={{ color: '#c9a9ff' }}>Shift&nbsp;+&nbsp;Scroll</span> to fly through snapshots
          <button
            onClick={() => setShowScrubHint(false)} title="Dismiss" aria-label="Dismiss"
            style={{ position: 'absolute', top: 4, right: 8, background: 'transparent', border: 'none', color: '#fff', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
          >×</button>
        </div>
      )}
      {/* Fixed header */}
      <div
        className="z-50 flex items-center bg-white/95 backdrop-blur"
        style={{ position: 'fixed', top: 0, left: 0, right: 0, borderBottom: `1px solid ${INK}33`, fontSize: 'clamp(0.72rem, 1.5vw, 1.02rem)', height: 'clamp(38px, 7vh, 48px)', gap: 'clamp(4px, 0.8vw, 10px)', padding: '0 clamp(6px, 1vw, 12px)' }}
      >
        <span style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>
          ◈ {snapshot
            ? `${versionLabel ? versionLabel + ' · ' : ''}${new Date(snapshot.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : 'Snapshot'} · read-only
        </span>

        {snapshot && (
          <span className="text-stone-600">
            {snapshot.wordCount}w
          </span>
        )}

        {allSnapshots.length > 1 && (
          <span className="text-stone-600 tabular-nums">
            {`v${groupIdx + 1}/${groups.length}`}
          </span>
        )}

        {/* Centred, jazzed action buttons — the words-diff sits just left of the first (biggest-change) toggle */}
        <div className="flex-1 flex items-center justify-center" style={{ gap: 'clamp(3px, 0.7vw, 10px)', minWidth: 0, overflow: 'hidden' }}>
        {/* Words vs previous — bigger, immediately left of the biggest-change toggle */}
        {headerDiff && (headerDiff.added > 0 || headerDiff.removed > 0) && (
          <span className="flex items-baseline gap-x-2 tabular-nums" style={{ fontSize: 'clamp(0.8rem, 1.8vw, 1.2rem)', flexShrink: 0, marginRight: 'clamp(6px, 1.4vw, 16px)' }} title="words added / removed vs the previous snapshot">
            <span style={{ color: '#15803d', fontWeight: 800 }}>+{headerDiff.added}</span>
            <span style={{ color: '#b91c1c', fontWeight: 800 }}>−{headerDiff.removed}</span>
          </span>
        )}
        {prevSnap && headerDiff && headerDiff.added === 0 && headerDiff.removed === 0 && (
          <span className="text-stone-500 italic">no change</span>
        )}
        <button
          type="button"
          onClick={toggleLineMode}
          className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm transition-colors"
          style={{
            fontSize: 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap',
            background: lineMode === 'longest' ? 'rgba(92,45,138,0.16)' : 'rgba(92,45,138,0.08)',
            border: '1px solid rgba(92, 45, 138, 0.35)',
            color: INK,
          }}
          title={lineMode === 'longest'
            ? 'Dotted line snaps just above the biggest change in each snapshot — click to keep it centred on the same words'
            : 'Dotted line stays centred on the same words — click to snap it above the biggest change'}
        >
          {lineMode === 'longest' ? '⇥ biggest change' : '↔ centred line'}
        </button>
        {docId && aiOn && (
          <button
            type="button"
            disabled={isRegenerating}
            onClick={async () => {
              if (!docId) return
              setIsRegenerating(true)
              setAllSnapshots((prev) => prev.map((s) => {
                const { diffSummary: _d, versionSummary: _v, ...rest } = s
                return rest as typeof s
              }))
              await clearAllSnapshotSummaries(docId)
              setGenSeed((n) => n + 1)
            }}
            className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm transition-colors"
            style={{
              fontSize: 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap',
              background: isRegenerating ? 'rgba(92,45,138,0.04)' : 'rgba(92,45,138,0.08)',
              border: '1px solid rgba(92, 45, 138, 0.35)',
              color: isRegenerating ? 'rgba(92,45,138,0.4)' : INK,
              cursor: isRegenerating ? 'default' : 'pointer',
            }}
            title="Clear and regenerate all AI summaries"
          >
            {isRegenerating ? 'regenerating…' : '↺ summaries'}
          </button>
        )}
        {docId && snapshot && (
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Delete this snapshot (${new Date(snapshot.createdAt).toLocaleString()})? This cannot be undone.`)) return
              await deleteSnapshot(docId, snapshot.id)
              // Navigate to an adjacent snapshot, or back to the editor if none left
              const remaining = allSnapshots.filter((s) => s.id !== snapshot.id)
              if (!remaining.length) { navigate('/'); return }
              const newIdx = Math.min(idx, remaining.length - 1)
              const p = new URLSearchParams()
              p.set('doc', docId)
              p.set('snap', remaining[newIdx].id)
              navigate(`/snapshot?${p.toString()}`)
              setAllSnapshots(remaining)
            }}
            className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm"
            style={{
              fontSize: 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap',
              background: 'rgba(185,28,28,0.07)',
              border: '1px solid rgba(185,28,28,0.25)',
              color: '#b91c1c',
              cursor: 'pointer',
            }}
            title="Permanently delete this snapshot"
          >
            ✕ snapshot
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm transition-colors"
          style={{
            fontSize: 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap',
            background: 'rgba(92, 45, 138, 0.08)',
            border: '1px solid rgba(92, 45, 138, 0.35)',
            color: INK,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(92,45,138,0.16)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(92,45,138,0.08)')}
        >
          ← editor
        </button>
        </div>
      </div>

      {/* Spacer for fixed header */}
      <div style={{ height: 'clamp(38px, 7vh, 48px)', flexShrink: 0 }} />

      {/* Split pane fills remaining viewport */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {(status === 'loading' || (status === 'ready' && !libReady)) && <p className="text-center text-stone-400 mt-20">Loading…</p>}
        {status === 'missing' && (
          <p className="text-center text-stone-500 mt-20">
            That snapshot isn't on this device. Snapshots live in the browser where they were written.
          </p>
        )}
        {status === 'ready' && libReady && snapshot && (
          <SplitDiffView
            snapshot={snapshot}
            prevSnap={prevSnap}
            isPhone={isPhone}
            isNarrow={!isWide}
            lineMode={lineMode}
            summary={currentDiff}
            counter={allSnapshots.length > 1 ? `v${groupIdx + 1}.${snapInGroup}/${groups.length}.${lastGroup?.items.length ?? 1}` : undefined}
            summariesOn={aiOn}
            onOptInSummaries={() => setConsentOpen(true)}
            nav={{
              show: allSnapshots.length > 1 && status === 'ready',
              onBack: goBack, canBack, onFwd: goFwd, canFwd, onScrub: scrubBy,
              onVerBack: goVerBack, canVerBack, onVerFwd: goVerFwd, canVerFwd,
              hasVersions,
            }}
          />
        )}
      </div>

      {consentOpen && (
        <AiConsentDialog
          feature="summaries"
          onYes={() => {
            markAiConsent('summaries')
            setConsentOpen(false)
            setAiSummaries(true) // fires ai-settings-changed → aiOn flips + genSeed bump → backfill
          }}
          onNo={() => setConsentOpen(false)}
        />
      )}

      {/* Side navigation now renders INSIDE the central editor pane (flanking it) — see above. */}

      {/* Fixed purple Verify button — bottom right, opens the verifier for this document */}
      <button
        type="button"
        onClick={async () => {
          if (!docId) { navigate('/verify'); return }
          try {
            const doc = await loadDocument(docId)
            if (!doc) { navigate('/verify'); return }
            const bundle = buildExportBundle(doc, allSnapshots)
            const bundleText = composeTraceFile(bundle)
            navigate('/verify', { state: { bundleText } })
          } catch {
            navigate('/verify')
          }
        }}
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 55,
          background: '#5c2d8a', color: '#fff',
          border: 'none', borderRadius: 8,
          padding: '8px 18px', fontSize: '0.9rem', fontWeight: 600,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(92,45,138,0.35)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#7a3fb5')}
        onMouseLeave={e => (e.currentTarget.style.background = '#5c2d8a')}
        title="Open the verifier for this document"
      >
        Verify
      </button>
    </div>
  )
}
