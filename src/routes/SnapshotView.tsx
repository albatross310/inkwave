import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '../types/document'
import { listSnapshots, groupByVersion, patchSnapshotDiffSummary, patchSnapshotVersionSummary, clearAllSnapshotSummaries, deleteSnapshot } from '../provenance/snapshots'
import { pmToText } from '../provenance/bundle'
import { loadDocument } from '../storage/opfs'
import { VerifyModal } from '../components/VerifyModal'
import type { InkwaveDocument } from '../types/document'
import { loadLibrary } from '../citations/library'
import { diffStats, type DiffOp } from '../provenance/diff'
import { opsBetween, peekOpsBetween, preloadDiffWindow, cancelDiffPreload } from '../provenance/diffCache'
import { survivingNeighbourSig } from '../provenance/anchorMap'
import { paginateStaticDoc, type StaticPaginationHandle, type StaticPageGeo } from '../editor/staticPagination'
import { pageBoxPx } from '../editor/pageModel'
import { getPaperSize, getOrientation } from '../editor/pageSettings'
import { WATER_MARGIN_PX } from '../editor/magnify'
import { summariseDiff, summariseVersionDiff } from '../provenance/summarise'
import { aiSummariesEnabled, setAiSummaries, markAiConsent } from '../editor/aiSettings'
import { AiConsentDialog } from '../components/AiConsentDialog'
import { Scroll, isTouchDevice } from '../editor/Scroll'
import { probePerf } from '../editor/perflog'
import { isWaterAtX, createZoomLatch } from '../editor/zoomZone'
import { LoadingVeil } from '../editor/LoadingVeil'
import { DocView } from '../components/DocView'
import { RichDiffView } from '../components/RichDiffView'
import { textRenderEnabled } from '../editor/textRenderFlag'
import { summariseRecord, createScrubPresenter, paneCentreSig, type ScrubPresenter } from '../editor/scrubRaster'
import { snapThumbsDebug, snapThumbsEnabled, thumbStats, thumbPaneCounts } from '../editor/snapThumbs'
// THE BREAK-TABLE SWEEP. Imported ONLY here — /snapshot has no editor, so this whole path cannot
// run while Peter types, by construction rather than by measurement (snapshotBreaks.ts header).
import { sweepBreakTables, snapBreaksEnabled, type SweepResult } from '../editor/snapshotBreaks'
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

  // Phone: a slim 15px sliver hugging the pane edge (the old 30-41px lozenge sat OVER the text —
  // Peter, 2026-07-10); desktop keeps the full-size button.
  const dim = isPhone ? '15px' : 'clamp(34px, 3.6vw, 53px)'
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

// Split a change's text into [lead whitespace, visible core, trail whitespace] so the highlight (fill +
// outline) wraps ONLY the core — leading/trailing spaces and especially RETURNS never paint an empty
// highlighted line. `core` is '' when the change is pure whitespace (then it's rendered plain, unhighlighted).
function splitEdges(text: string): { lead: string; core: string; trail: string } {
  const lead = /^\s+/.exec(text)?.[0] ?? ''
  if (lead.length === text.length) return { lead: '', core: '', trail: text }
  const trail = /\s+$/.exec(text)?.[0] ?? ''
  return { lead, core: text.slice(lead.length, text.length - trail.length), trail }
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
  totalPages?: number,                 // total document pages, so pages with no diffs still show
): React.ReactNode[] {
  const n = ops.length
  if (!n) return []

  // Page-by-page BULLETED view: every document page gets a dashed rule + logo + number (in sync with the
  // minimap); the diffs on it become bullet points with a little context; empty pages say "no change".
  const CTX = 7
  const toWords = (t: string) => t.trim().split(/\s+/).filter(Boolean)
  const changes: Array<{ i: number; del: boolean; page: number; before: string; after: string }> = []
  let maxPage = 1
  for (let i = 0; i < n; i++) {
    if (ops[i].type === 'same') continue
    const page = diffPages?.[i] ?? 1
    if (page > maxPage) maxPage = page
    const before = ops[i - 1]?.type === 'same' ? toWords(ops[i - 1].text).slice(-CTX).join(' ') : ''
    const after = ops[i + 1]?.type === 'same' ? toWords(ops[i + 1].text).slice(0, CTX).join(' ') : ''
    changes.push({ i, del: ops[i].type === 'del', page, before, after })
  }
  const pages = Math.min(600, Math.max(totalPages ?? 1, maxPage))
  const out: React.ReactNode[] = []
  let k = 0
  for (let pg = 1; pg <= pages; pg++) {
    out.push(
      <div key={`pr${k++}`} aria-hidden="true" data-page={pg} style={{ display: 'block', position: 'relative', height: 0, borderTop: '1px dashed rgba(92,45,138,0.32)', margin: pg === 1 ? '2px 0 7px' : '15px 0 7px' }}>
        <span style={{ position: 'absolute', right: 0, top: 3, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.9rem', fontWeight: 700, color: 'rgba(92,45,138,0.72)', fontFamily: 'Georgia, "Times New Roman", serif' }}>
          <img src="/inkwave-logo-v7.png" alt="" style={{ width: 15, height: 15, opacity: 0.72 }} />{pg}
        </span>
      </div>,
    )
    const onPage = changes.filter(c => c.page === pg)
    if (!onPage.length) {
      out.push(<div key={`nc${k++}`} style={{ color: '#b3adbb', fontStyle: 'italic', fontSize: '0.78rem', padding: '3px 0 5px 2px' }}>no change this page</div>)
      continue
    }
    out.push(
      <ul key={`ul${k++}`} style={{ margin: '5px 0 7px', paddingLeft: '1.15em', listStyleType: 'disc' }}>
        {onPage.map((c) => {
          const cls = c.del ? 'diff-del' : 'diff-add'
          const style: React.CSSProperties = c.del
            ? { color: '#b91c1c', textDecoration: 'line-through', background: 'rgba(185,28,28,0.07)', borderRadius: 2 }
            : { background: 'rgba(22,163,74,0.16)', color: '#166534', borderRadius: 2 }
          const core = splitEdges(ops[c.i].text).core || ops[c.i].text.trim()
          return (
            <li key={c.i} style={{ marginBottom: 5, color: '#3a3a3a' }}>
              {c.before && <span style={{ color: '#9a94a4' }}>…{c.before} </span>}
              <span className={cls} data-opidx={String(c.i)} style={style}
                onClick={onChangeClick ? () => onChangeClick(c.i) : undefined}
                onMouseEnter={onHoverOp ? () => onHoverOp(c.i) : undefined}
                onMouseLeave={onHoverOp ? () => onHoverOp(null) : undefined}
                title={onChangeClick ? 'Jump to this change in the document' : undefined}
              >{core}</span>
              {c.after && <span style={{ color: '#9a94a4' }}> {c.after}…</span>}
            </li>
          )
        })}
      </ul>,
    )
  }
  return out
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
  // RICH PAGES FOR EVERY VERSION (2026-07-17, flag `inkwave:textRender`, DEFAULT OFF). Below this
  // line is the FLAT transcript: one pre-wrap span of `pmToText`, which is what 115 of 116 versions
  // have rendered. RichDiffView projects the same ops back onto the PM tree (provenance/textMap.ts)
  // so the pane shows real headings/lists/citations with the diff marks intact.
  //
  // GATED ON textRenderEnabled(), DELIBERATELY — not on a flag of its own. The canvas renderer and
  // this DOM landing must move TOGETHER: a rich canvas frame settling onto a flat pane (or the
  // reverse) is round 11's two-rules-one-pane disease, which cost 186px of drift. One flag makes
  // that combination unrepresentable rather than merely unlikely.
  if (textRenderEnabled()) {
    return (
      <div className="tiptap-editor ProseMirror">
        <RichDiffView doc={snapshot.contentJson} ops={ops} hooks={{ onOpClick, onHoverOp }} />
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

// The sweep replicas are never interactive (aria-hidden, pointer-events none) — module-level
// no-ops keep their handler identities stable so the replica's diff nodes don't re-memo per render.
const noopOp = (_opIdx: number): void => { /* offscreen replica — not interactive */ }
const noopHover = (_opIdx: number | null): void => { /* offscreen replica — not interactive */ }

/** Each diff op's real DOCUMENT page + the doc's total page count, read off a doc-pane scroller
 *  and its canonical page regions (`pageGeo`; √2 fallback until the paginator publishes). Pulled
 *  out of the active pane's effect so the sweep's offscreen diff replica can derive the SAME
 *  page-break rules from a HIDDEN layer's scroller — identical maths, one implementation. */
function computeDiffPagesFor(L: HTMLElement, pageGeo: StaticPageGeo[] | null): { map: Record<number, number>; total: number } {
  const geo = pageGeo && pageGeo.length ? pageGeo : null
  const paper = L.querySelector('.scroll-paper') as HTMLElement | null
  const pw = paper?.clientWidth || L.clientWidth || 1
  const pageH = Math.max(200, pw * Math.SQRT2) // fallback only, until the paginator publishes
  const pageOf = (y: number): number => {
    if (!geo) return Math.floor(y / pageH) + 1
    let k = 0
    while (k < geo.length - 1 && geo[k + 1].top <= y) k++
    return k + 1
  }
  const lr = L.getBoundingClientRect()
  const map: Record<number, number> = {}
  L.querySelectorAll('[data-opidx]').forEach((node) => {
    const el = node as HTMLElement
    if (!el.classList.contains('diff-add') && !el.classList.contains('diff-del')) return
    const idx = Number(el.getAttribute('data-opidx'))
    const y = el.getBoundingClientRect().top - lr.top + L.scrollTop
    map[idx] = pageOf(y)
  })
  return { map, total: geo ? geo.length : Math.max(1, Math.ceil(L.scrollHeight / pageH)) }
}

// ── InlineDiffView ────────────────────────────────────────────────────────────
// Right pane: compact hunk view of the diff.
function InlineDiffView({
  ops, prevSnap, onChangeClick, onHoverOp, scrollBodyRef, midFrac = 0.5, diffPages, totalPages,
}: {
  ops: DiffOp[] | null
  prevSnap: Snapshot | null
  onChangeClick: (opIdx: number) => void
  onHoverOp: (opIdx: number | null) => void
  scrollBodyRef?: React.RefObject<HTMLDivElement>
  midFrac?: number
  diffPages?: Record<number, number> // opIdx → document page (from the editor), for in-sync page-break rules
  totalPages?: number
}) {
  const hasChange = ops ? ops.some(o => o.type !== 'same') : false
  const nodes = useMemo(
    () => ops && hasChange ? buildDiffNodes(ops, onChangeClick, onHoverOp, diffPages, totalPages) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ops, hasChange, onChangeClick, onHoverOp, diffPages, totalPages],
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
      <div
        ref={scrollBodyRef}
        className="iw-snap-scroll"
        style={{
          flex: 1, overflowY: 'scroll', overflowX: 'auto', touchAction: 'pan-y', padding: '1rem 1.5rem',
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

/** Global char offset of the character at content-y `y`, by BINARY SEARCH over Range rects — no
 *  hit-testing, so nothing that covers the pane can defeat it. Text lays out monotonically down a
 *  block flow, so ~log2(chars) rect reads find the line. (The pane is a handful of giant
 *  [data-opidx] spans, so each locateOffset walk is a few nodes, not a tree.) */
function offsetAtContentY(el: HTMLElement, y: number): number | null {
  const full = el.textContent ?? ''
  if (!full.length) return null
  const elRect = el.getBoundingClientRect()
  const zf = elRect.width > 0 && el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1
  const range = document.createRange()
  const topAt = (i: number): number => {
    const loc = locateOffset(el, i)
    if (!loc || !loc.node.data.length) return NaN
    const off = Math.min(loc.offset, loc.node.data.length - 1)
    try {
      range.setStart(loc.node, off)
      range.setEnd(loc.node, Math.min(off + 1, loc.node.data.length))
      const r = range.getBoundingClientRect()
      if (!r.height && !r.width) return NaN
      return (r.top - elRect.top) / zf + el.scrollTop
    } catch { return NaN }
  }
  let lo = 0, hi = full.length - 1
  for (let g = 0; g < 40 && lo < hi; g++) {
    const mid = (lo + hi) >> 1
    const t = topAt(mid)
    if (Number.isNaN(t)) { lo = mid + 1; continue } // collapsed/hidden run — step past it
    if (t < y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The text signature currently sitting on the midline (or null if not over text).
 *
 *  The caret hit-test is the fast path, but it reads the TOPMOST element at the point — and at
 *  mount the LoadingVeil covers this pane, so it returned the veil (not a text node) and the
 *  anchor came back null. This effect only re-runs on a snapshot/mode change, so the anchor then
 *  stayed null for the WHOLE SESSION unless the reader happened to scroll: content anchoring was
 *  silently never engaging at load and every reposition fell back to the RATIO (probed 2026-07-17:
 *  23/23 warm layers took `ratio.nosig`). Hence the overlay-immune geometric fallback. */
function midlineSignature(el: HTMLElement): string | null {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + el.clientHeight / 2
  const caret = caretAtPoint(x, y)
  const globalOffset = caret
    ? globalOffsetOf(el, caret.node, caret.offset)
    : offsetAtContentY(el, el.scrollTop + el.clientHeight / 2)
  if (globalOffset == null) return null
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

// Pick the rows×cols to tile `n` page thumbnails into a W×H panel so each page CELL is portrait —
// height:width clamped to Peter's band 1:2 … 1:4 (2026-07-10 revision: never taller than 1:4, never
// squatter than 1:2 — the old [3,5] band rendered "longer than 1:5" on the phone's half-height
// panel). We try every row count, score how far the resulting cell ratio falls outside the band
// (heavily) plus its distance from the ideal (lightly), and take the best. Cells are 1fr so they
// then scale to fill the panel. Recomputed whenever the panel resizes.
function bestGrid(n: number, W: number, H: number): { rows: number; cols: number } {
  if (n <= 1 || W <= 0 || H <= 0) return { rows: Math.max(1, n), cols: 1 }
  const MIN = 2, MAX = 4, IDEAL = 3 // page thumbnail height:width
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
function MinimapPanel({ leftRef, ops, snapKey, midFrac = 0.5, pageGeo }: {
  leftRef: React.RefObject<HTMLDivElement | null>
  ops: DiffOp[] | null
  snapKey: string
  midFrac?: number
  pageGeo?: StaticPageGeo[] | null // REAL canonical page regions (staticPagination); null → √2 fallback
}) {
  const [pages, setPages] = useState(1)
  const [maxPages, setMaxPages] = useState(1) // largest page count seen → keep the grid structure stable
  const [marks, setMarks] = useState<Array<{ page: number; frac: number; add: boolean; opIdx: number }>>([])
  const [panelDims, setPanelDims] = useState({ w: 0, h: 0 }) // the minimap's own box, for the aspect-ratio grid
  const pageHRef = useRef(1000)
  const gridRef = useRef<HTMLDivElement>(null)
  const marksSigRef = useRef('')
  const modelRef = useRef<'fallback' | 'geo'>('fallback') // which page model produced maxPages

  // Content-y ↔ (page, frac) through the REAL canonical page regions when the static paginator
  // has run (this is what killed the old paper-width×√2 drift); √2 model as the pre-measure fallback.
  const geo = pageGeo && pageGeo.length ? pageGeo : null
  const pageAt = useCallback((y: number): { page: number; frac: number } => {
    if (geo) {
      let k = 0
      while (k < geo.length - 1 && geo[k + 1].top <= y) k++
      return { page: k, frac: Math.max(0, Math.min(1, (y - geo[k].top) / Math.max(1, geo[k].height))) }
    }
    const pageH = pageHRef.current
    const p = Math.max(0, Math.floor(y / pageH))
    return { page: p, frac: Math.max(0, Math.min(1, (y - p * pageH) / pageH)) }
  }, [geo])
  const yFor = useCallback((page: number, frac: number): number => {
    if (geo) {
      const p = geo[Math.max(0, Math.min(geo.length - 1, page))]
      return p.top + frac * p.height
    }
    return (page + frac) * pageHRef.current
  }, [geo])

  const measure = useCallback(() => {
    const el = leftRef.current
    if (!el || !el.scrollHeight) return
    const tMm = performance.now()
    const paper = el.querySelector('.scroll-paper') as HTMLElement | null
    const pw = paper?.clientWidth || el.clientWidth || 1
    const pageH = Math.max(200, pw * Math.SQRT2) // fallback A4 ratio (pre-pagination only)
    pageHRef.current = pageH
    const n = geo ? geo.length : Math.max(1, Math.round(el.scrollHeight / pageH))
    setPages(n)
    // The √2 fallback can badly over-count before the paginator publishes (phone: narrow paper →
    // small pageH) — latching maxPages on it left permanent empty grid slots. Reset the latch when
    // the real canonical model takes over; keep the max WITHIN a model (grid stability while scrubbing).
    const model = geo ? 'geo' as const : 'fallback' as const
    if (model !== modelRef.current) { modelRef.current = model; setMaxPages(n) }
    else setMaxPages(m => Math.max(m, n))
    const er = el.getBoundingClientRect()
    const m: Array<{ page: number; frac: number; add: boolean; opIdx: number }> = []
    el.querySelectorAll('[data-opidx]').forEach(o => {
      const idx = Number((o as HTMLElement).getAttribute('data-opidx'))
      const op = ops?.[idx]
      if (!op || op.type === 'same') return
      const r = (o as HTMLElement).getBoundingClientRect()
      const y = r.top - er.top + el.scrollTop
      const { page, frac } = pageAt(y)
      m.push({ page: Math.max(0, Math.min(n - 1, page)), frac, add: op.type === 'add', opIdx: idx })
    })
    // Skip the setState when the marks are identical — the observers fire on every resize tick and a fresh
    // array would re-render the whole grid for nothing (same pattern PageGuides uses).
    const sig = n + '|' + m.map(k => `${k.page}:${Math.round(k.frac * 100)}:${k.add ? 1 : 0}`).join(',')
    probePerf('minimap', performance.now() - tMm)
    if (sig === marksSigRef.current) return
    marksSigRef.current = sig
    setMarks(m)
  }, [ops, leftRef, geo, pageAt])

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
    const y = yFor(page, fracInCell)
    window.dispatchEvent(new Event('inkwave:minimap-seek')) // → diff pane follows gently, not springily
    el.scrollTo({ top: Math.max(0, y - el.clientHeight * midFrac), behavior: 'auto' })
  }, [cols, height, pages, leftRef, midFrac, yFor])

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
    const yc = el.scrollTop + el.clientHeight * midFrac
    const at = pageAt(yc)
    const p = Math.max(0, Math.min(pages - 1, at.page))
    const frac = at.frac
    const c = Math.floor(p / height), r = p % height
    const next = { top: P + r * (cellH + GAP) + frac * cellH, left: P + c * (colStride + GAP), width: colStride }
    setHere(prev => (prev && Math.abs(prev.top - next.top) < 0.4 && Math.abs(prev.left - next.left) < 0.4 && Math.abs(prev.width - next.width) < 0.4) ? prev : next)
  }, [cols, height, pages, leftRef, midFrac, pageAt])
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
      el.scrollTop += e.deltaY * unit * 2 // exactly DOUBLE the doc pane's native rate (Peter, 2026-07-10)
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
                    onClick={(e) => { e.stopPropagation(); seekToY(yFor(m.page, m.frac)) }}
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
            <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 3, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: numFont * 0.1 /* number hugs its wave-seal (Peter, 2026-07-11) */, color: 'rgba(92,45,138,0.66)', fontSize: numFont, fontWeight: 700, fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1, pointerEvents: 'none' }}>
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

// ── DocLayer — one snapshot's fully-rendered, fully-paginated doc pane, KEPT ALIVE ────────────
// The flip-to-card architecture (2026-07-11): each recently-visited snapshot keeps its whole
// rendered pane (static HTML + inserted gaps + sheet panels + its own scroll position) mounted in
// an absolutely-positioned layer; only the active one is visible. `visibility:hidden` (NEVER
// display:none) keeps the hidden layers' layout alive, so flipping to a warm layer is paint-only —
// no React remount, no re-layout of a 40-page document, no gap re-insertion. Pagination runs ONCE
// per layer: immediately when it mounts active, ~150ms deferred when it mounts as a hidden warm
// neighbour (splits the warm into two shorter tasks: subtree layout, then canonical measure).
// On activation the layer points the shared refs (leftScrollRef/pagRef/pageGeo) at itself in a
// LAYOUT effect, so every parent effect keyed on snapshot.id still reads the right scroller.
interface DocLayerHooks {
  onActivate: (scroller: HTMLDivElement, handle: StaticPaginationHandle | null, pages: StaticPageGeo[] | null) => void
  onGeo: (pages: StaticPageGeo[]) => void
  onScroll: () => void
  onOpClick: (opIdx: number) => void
  onHoverOp: (opIdx: number | null) => void
  getZoom: () => number
  // Where THIS layer's version must sit so the reader's content stays under the reading line.
  // CONTENT identity, not scroll offset: versions differ in LENGTH, so a shared scrollTop lands
  // different words in every version (measured: anchor drift 0px, centre content held 33%). The
  // scroller is passed in because the answer is a property of the TARGET version's own layout.
  getAnchorTop: (scroller: HTMLDivElement, snapId: string) => number
  // Warm (NON-ACTIVE) layer painted → scrub-bitmap capture. `pages` is THIS layer's canonical page
  // geometry (round 10): the sweep's offscreen minimap replica needs a non-active version's real
  // page regions, and this hidden layer is the only place they exist. ADDITIVE — it rides the
  // warm-only branch that already ran; the ACTIVE path (onActivate / onGeo / the shared
  // leftScrollRef+pagRef+pageGeo binding) is untouched.
  onWarmReady?: (snapId: string, scroller: HTMLDivElement, pages: StaticPageGeo[] | null) => void
}

// ── Registration trace (harness-only; zero cost unless a probe defines the array) ─────────────
// The burst RECORDER can only carry a centre signature for frames it CAPTURED this session — a
// hydrated thumbnail has none — so its `registered` rate is computed over a handful of steps
// (measured: 0-7 of a 12-step burst). Far too small to accept or reject an anchoring rule.
// This traces the real thing at FULL sample instead: for every version the sweep primes, the text
// actually sitting under that version's centre line AT THE SCROLLTOP ITS BITMAP IS CAPTURED AT.
// Read across the sweep, consecutive versions agreeing = the flip is registered. Same locator the
// recorder uses (paneCentreSig — text granularity; the pane is ~4 giant [data-opidx] spans, so
// block granularity would call every frame registered).
function traceAnchor(snapId: string, L: HTMLElement): void {
  const w = window as unknown as {
    __iwAnchorTrace?: Array<{ id: string; sig: string; want: string; mode: string; top: number; driftPx: number | null }>
    __iwAnchorLast?: { mode: string; want: string; rawWant: string | null; ratio: number }
  }
  if (!w.__iwAnchorTrace) return
  const last = w.__iwAnchorLast
  try {
    // DRIFT, in px — the measure the zoom focal anchor was proved with (99bf8a0: 0.0-0.3px), and
    // the only one that is honest here. A signature of the centre LINE cannot answer this: it is
    // the line's OPENING 60 chars, so an anchor sitting mid-line (which wrapping alone decides,
    // and wrapping differs between versions of different length) reads as a miss even though it is
    // exactly under the reading line. So ask geometry instead: where IS the anchor text now,
    // relative to the centre? `null` = the anchor has no counterpart in this version at all.
    const raw = last?.rawWant ?? null
    const would = raw ? scrollTopForSignature(L, raw, last?.ratio ?? 0.5) : null
    w.__iwAnchorTrace.push({
      id: snapId, mode: last?.mode ?? '?', top: Math.round(L.scrollTop),
      sig: paneCentreSig(L), want: (last?.want ?? '').replace(/\s+/g, ' ').trim().slice(0, 44),
      driftPx: would == null ? null : Math.round(L.scrollTop - would),
    })
  } catch { /* best-effort */ }
}

const DocLayer = memo(function DocLayer({ snap, prev, active, isPhone, hooks }: {
  snap: Snapshot; prev: Snapshot | null; active: boolean; isPhone: boolean; hooks: DocLayerHooks
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagRef = useRef<StaticPaginationHandle | null>(null)
  const runRef = useRef<(() => void) | null>(null)
  const activeRef = useRef(active); activeRef.current = active
  const ops = useMemo(() => opsBetween(prev, snap), [prev?.id, snap.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pagination — once per layer (spec cache makes revisits cheap; the layer itself makes them free).
  useLayoutEffect(() => {
    const L = scrollerRef.current
    if (!L) return
    let disposed = false
    let timer = 0
    const run = () => {
      if (disposed) return
      // Cancel the deferred warm timer: when activation forces the run first (a flip landing
      // between a warm MOUNT and its +150ms pagination), the stale timer re-paginated the same
      // layer ~150ms later — a duplicated 130-270ms longtask right after the flip (probed).
      window.clearTimeout(timer)
      const t0 = performance.now()
      pagRef.current?.destroy()
      pagRef.current = paginateStaticDoc({
        scroller: L,
        cacheKey: `${snap.id}|${ops ? 'diff' : 'doc'}`,
        // Repaints (pane resize, zoom) publish geometry only while this layer drives the view.
        onRepaint: (pages) => { if (!disposed && activeRef.current) hooks.onGeo([...pages]) },
      })
      probePerf(activeRef.current ? 'paginate' : 'paginate.warm', performance.now() - t0)
      if (activeRef.current && pagRef.current) hooks.onActivate(L, pagRef.current, [...pagRef.current.pages])
      // Warm layers pre-scroll to the anchor's position IN THEIR OWN VERSION — the same CONTENT
      // under the reading line, not the same scrollTop (see getAnchorTop). This is the whole
      // registration contract: this scrollTop is the one the layer's scrub bitmap is CAPTURED at,
      // and a warm layer never gets the active path's midline reposition, so if it is primed to a
      // raw offset its bitmap is misregistered FOREVER — every frame individually correct, the
      // sequence sliding. Once painted here the layer is ready for its capture (idle — scrubRaster).
      else if (!activeRef.current) {
        L.scrollTop = hooks.getAnchorTop(L, snap.id)
        traceAnchor(snap.id, L)
        hooks.onWarmReady?.(snap.id, L, pagRef.current ? [...pagRef.current.pages] : null)
      }
    }
    runRef.current = run
    // A hidden warm layer renders at the parent's current pane zoom so activation needs no repaint.
    const z = hooks.getZoom()
    const paper = L.querySelector('.scroll-paper')?.parentElement as HTMLElement | null
    if (paper && Math.abs(z - 1) > 0.0005) paper.style.setProperty('zoom', String(+z.toFixed(4)))
    if (activeRef.current) run()
    else timer = window.setTimeout(run, 150) // warm layers paginate a beat after their layout task
    // Web fonts reflow the text after first paint → breaks move. Re-measure once ready (the spec
    // cache keys on font status, so this measures fresh instead of reusing the pre-font entry).
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => { if (!disposed) run() }).catch(() => { /* ignore */ })
    }
    return () => { disposed = true; window.clearTimeout(timer); runRef.current = null; pagRef.current?.destroy(); pagRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.id, ops])

  // Activation: point the shared refs at THIS layer + publish its cached page regions. A layout
  // effect so it lands BEFORE the parent's per-snapshot effects read leftScrollRef. Child effects
  // flush before parent effects in the same commit, so ordering is guaranteed by React.
  useLayoutEffect(() => {
    if (!active) return
    const t0 = performance.now()
    if (!pagRef.current) runRef.current?.() // activated before its deferred warm pagination — run now
    const L = scrollerRef.current
    if (L) hooks.onActivate(L, pagRef.current, pagRef.current ? [...pagRef.current.pages] : null)
    probePerf('flip.activate', performance.now() - t0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div
      className={active ? 'iw-snap-layer iw-snap-layer-active' : 'iw-snap-layer'}
      data-snap={snap.id}
      aria-hidden={active ? undefined : true}
      style={{
        position: 'absolute', inset: 0,
        // NEAR-ZERO opacity (NOT 0 / visibility / display): a truly-hidden layer loses its
        // compositor backing store, and re-rastering a 40-page text pane stalled frames ~500ms on
        // the flip. At 0.001 the layer stays painted (imperceptible, under the active layer's
        // opaque paper) so flipping to a warm layer is a compositor-only frame.
        opacity: active ? 1 : 0.001,
        zIndex: active ? 2 : 1,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <div
        ref={scrollerRef}
        onScroll={active ? hooks.onScroll : undefined}
        className="iw-snap-scroll"
        style={{ height: '100%', overflowY: 'scroll', overflowX: 'auto', touchAction: 'pan-y' }}
      >
        {/* The layer key (snap.id) gives each snapshot a private subtree, so the static paginator's
            DOM surgery (gap insertion splits text nodes) can never desync React's reconciliation. */}
        <Scroll phone={isPhone}><div><FullDiffView ops={ops} snapshot={snap} onOpClick={ops ? hooks.onOpClick : undefined} onHoverOp={hooks.onHoverOp} /></div></Scroll>
      </div>
    </div>
  )
})

// ── ?snapThumbs=debug overlay ─────────────────────────────────────────────────────────────────
// The wave-video lesson: an on-device readout beats hours of guessing. One glance must separate
// the three failure modes: (1) the rAF flipbook never ran (legacy per-notch goTo → live renders a
// few times a second), (2) it ran but the cache was EMPTY (show() had nothing → frozen pane), or
// (3) it presented into an INVISIBLE node (the video's transparent-element bug). Read PAINTED.
function ScrubDebugOverlay({ presenter, dbg, docId, snapCount }: {
  presenter: ScrubPresenter
  dbg: React.MutableRefObject<{ engaged: boolean; events: number; legacy: number; lands: number; commanded: Set<string> }>
  docId: string | null
  snapCount: number // library size — the sweep's denominator
}) {
  const [, force] = useState(0)
  // RECORDED burst (round 10). This overlay repaints on the SAME main thread the scrub saturates,
  // so anything it draws MID-burst is a stale render of the instrument itself — Peter's mid-scrub
  // capture came back byte-identical to his idle one, which is why every number we had was really
  // an at-rest sample. So: while a burst runs, say RECORDING and show nothing; the moment it
  // settles, serialise the presenter's ring buffer and print THAT. Never trust the live counters.
  const [burst, setBurst] = useState<ReturnType<typeof summariseRecord> | null>(null)
  const wasActive = useRef(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      const act = presenter.isActive()
      if (wasActive.current && !act) setBurst(summariseRecord(presenter.record())) // settled → dump
      wasActive.current = act
      force((n) => n + 1)
    }, 200)
    return () => window.clearInterval(id)
  }, [presenter])
  const recording = presenter.isActive()
  const info = presenter.debugInfo()
  const d = dbg.current
  const st = docId ? thumbStats(docId) : { entries: 0, bytes: 0, loaded: false }
  const bake = docId ? thumbPaneCounts(docId) : { doc: 0, diff: 0, map: 0 }
  const on = snapThumbsEnabled()
  const row = (k: string, v: string, bad?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: bad ? '#ff8080' : '#c8ffc8' }}>
      <span style={{ opacity: 0.75 }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span>
    </div>
  )
  return (
    <div style={{
      position: 'fixed', top: 6, left: 6, zIndex: 99999, pointerEvents: 'none',
      background: 'rgba(0,0,0,0.86)', color: '#fff', font: '11px/1.35 ui-monospace, monospace',
      padding: '7px 9px', borderRadius: 6, minWidth: 268, border: '1px solid #444',
    }}>
      {/* THE RECORDED BURST — the only numbers on this overlay that a burst can't lie about. */}
      <div style={{ fontWeight: 800, marginBottom: 3, color: '#ffd479' }}>
        last burst — RECORDED {recording && <span style={{ color: '#ff8080' }}>● REC…</span>}
      </div>
      {!burst && row('recorded bursts', 'none yet — scrub once', true)}
      {burst && (<>
        {row('presents', String(burst.presents), burst.presents === 0)}
        {row('commanded distinct', String(burst.commandedDistinct))}
        {row('presented distinct', String(burst.presentedDistinct), burst.presentedDistinct < burst.commandedDistinct)}
        {row('rate', `${burst.perSec.toFixed(0)}/s over ${burst.spanMs.toFixed(0)}ms`)}
        {burst.panes.map((p) => row(
          `${p.kind} hit/thumb/near/none`, `${p.hit}/${p.thumb}/${p.near}/${p.none}  ${(p.exactRate * 100).toFixed(0)}% real`,
          p.exactRate < 0.5,
        ))}
        <div style={{ fontWeight: 800, margin: '4px 0 2px', color: '#ffd479' }}>registration — content held?</div>
        {burst.panes.map((p) => row(
          `${p.kind} centre held`,
          p.registered < 0 ? 'n/a' : `${(p.registered * 100).toFixed(0)}% of ${p.centreSteps}`,
          p.registered >= 0 && p.registered < 0.8,
        ))}
      </>)}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: '#ffd479' }}>live (AT REST ONLY — stale mid-burst)</div>
      {row('flipbook DRIVER', d.engaged ? 'ENGAGED (rAF)' : 'idle', !d.engaged)}
      {row('wheel events', String(d.events))}
      {row('legacy goTo (live)', String(d.legacy), d.legacy > 0)}
      {row('lands (live render)', String(d.lands), d.lands > 1)}
      {row('commanded distinct', String(d.commanded.size))}
      {row('show() calls', String(info.shows), info.shows === 0)}
      {row('presented/commanded', d.commanded.size ? `${(info.shows / d.commanded.size).toFixed(2)}×` : '—',
        d.commanded.size > 0 && info.shows < d.commanded.size)}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: '#ffd479' }}>per pane — hit/thumb/near/none</div>
      {info.panes.map((p) => (
        <div key={p.kind} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: p.visible ? '#c8ffc8' : '#ff8080' }}>
          <span style={{ opacity: 0.75 }}>{p.kind}{p.visible ? '' : ' ⚠NOT PAINTED'}</span>
          <span style={{ fontWeight: 700 }}>{p.hitCapture}/{p.hitThumb}/{p.nearest}/{p.none}</span>
        </div>
      ))}
      {info.panes.map((p) => (
        <div key={p.kind + 'v'} style={{ opacity: 0.6, fontSize: 10 }}>
          {p.kind}: disp={p.display} op={p.opacity} vis={p.visibility} z={p.zIndex} box={p.rectW}×{p.rectH} cv={p.canvasW}×{p.canvasH}
        </div>
      ))}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: '#ffd479' }}>sweep — versions baked</div>
      {(['doc', 'diff', 'map'] as const).map((k) => row(
        k, `${bake[k]}/${snapCount}`, snapCount > 0 && bake[k] < snapCount,
      ))}
      {row('bytes/version', bake.doc ? `${(st.bytes / Math.max(1, bake.doc) / 1024).toFixed(1)}KB` : '—')}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: '#ffd479' }}>store</div>
      {row('snapThumbs flag', on ? 'ON' : 'OFF', !on)}
      {row('OPFS thumbs', st.loaded ? `${st.entries} · ${(st.bytes / 1e6).toFixed(1)}MB` : 'index loading…', st.entries === 0)}
      {row('mem bitmaps', `${info.entries} · ${(info.bytes / 1e6).toFixed(1)}MB`, info.entries === 0)}
    </div>
  )
}

function SplitDiffView({
  snapshot, prevSnap, nextSnap, isPhone, isNarrow, lineMode, summary, counter, counterRef, summariesOn, onOptInSummaries, nav, allSnaps,
  snapMode, bijMode, onCycleSnap, onCycleBijection, presenter,
}: {
  snapshot: Snapshot; prevSnap: Snapshot | null; nextSnap: Snapshot | null; allSnaps: Snapshot[]
  isPhone: boolean; isNarrow: boolean
  lineMode: 'center' | 'longest'; summary?: string | null; counter?: string
  counterRef?: React.RefObject<HTMLDivElement> // shift-wheel flipbook writes the live version text here
  summariesOn?: boolean; onOptInSummaries?: () => void
  snapMode: SnapMode; bijMode: BijMode // lifted to SnapshotView (phone hosts the toggles in the bottom bar)
  onCycleSnap: () => void; onCycleBijection: () => void
  presenter: ScrubPresenter // scrub bitmap overlays (round 3 — see editor/scrubRaster.ts)
  nav?: {
    show: boolean
    onBack: () => void; canBack: boolean
    onFwd: () => void; canFwd: boolean
    onScrub: (steps: number, inputAt?: number, mode?: 'flick' | 'scrub') => void
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
  const [splitPct, setSplitPct] = useState(28) // WIDE: diff pane % (narrower by default); editor takes the rest
  // VERTICAL (phone/narrow): editor row % — GOLDEN RATIO editor:panels = φ:1 (Peter, 2026-07-10).
  const [vSplitPct, setVSplitPct] = useState(61.8)
  const [sidePanelPx, setSidePanelPx] = useState(240)
  // snapMode/bijMode are lifted props (see SnapshotView). A ref mirrors the bijection so the
  // scroll handlers read the live value without re-subscribing.
  const bijectionRef = useRef<BijMode>(bijMode)
  bijectionRef.current = bijMode
  const cycleSnap = onCycleSnap
  const cycleBijection = onCycleBijection
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
  const leftScrollRef  = useRef<HTMLDivElement>(null)   // the ACTIVE layer's scroller (set on activation)
  const layerHostRef   = useRef<HTMLDivElement>(null)   // stable wrapper around the layer stack
  const rightScrollRef = useRef<HTMLDivElement>(null)   // right pane scroll container
  // Scrub bitmap overlay hosts (one per pane) + the minimap capture wrapper — see scrubRaster.ts.
  const docOverlayRef  = useRef<HTMLDivElement>(null)
  const diffOverlayRef = useRef<HTMLDivElement>(null)
  const mapOverlayRef  = useRef<HTMLDivElement>(null)
  const mapHostRef     = useRef<HTMLDivElement>(null)
  const anchorRatioRef  = useRef(0.5)
  const anchorSigRef    = useRef<string | null>(null)  // words currently on the midline
  const sigTickRef      = useRef(false)                // throttle signature recompute to 1/frame
  const syncTickRef     = useRef(false)                // throttle right-pane follow to 1/frame

  // Own Ctrl+wheel zoom for the diff view (like the PDF viewer): scales the diff text and — crucially —
  // preventDefaults so it never triggers the browser's whole-page zoom. Cursor-anchored per pane.
  const [diffZoom, setDiffZoom] = useState(() => { try { return Number(localStorage.getItem('inkwave:diffZoom')) || 1 } catch { return 1 } })
  const diffZoomRef = useRef(diffZoom); diffZoomRef.current = diffZoom
  // Displacement-based zoom anchor (2026-07-10 — the old fraction-of-scrollHeight anchor drifted:
  // the pane has unzoomed chrome above/around the zoomed paper, so a pure ratio skews). LEFT pane:
  // the paper alone zooms → the content point at rel px into the paper lands at paperTop + rel·(z1/z0).
  // RIGHT pane: the whole pane content zooms → pure ratio is exact.
  const dzAnchor = useRef<{ el: HTMLDivElement; offY: number; mode: 'left' | 'right'; z0: number; rel: number; paperTop: number } | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Zone/latch/cursor parity with the live editor (Peter, 2026-07-10 — zoomZone.ts): the doc
    // pane's 'water' = cursor x outside its paper's text-column lines (the same x-line rule).
    // The snapshot has no magnify pipeline — BOTH modes drive diffZoom — but the mode is latched
    // per gesture (+0.5s cooldown) and drives the zoom cursor, matching the editor's feel.
    const latch = createZoomLatch(() => containerRef.current)
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const pane = leftScrollRef.current?.contains(e.target as Node) ? leftScrollRef.current
        : rightScrollRef.current?.contains(e.target as Node) ? rightScrollRef.current : null
      latch.resolve(
        () => (pane && pane === leftScrollRef.current && isWaterAtX(pane, e.clientX) ? 'water' : 'text'),
        e.deltaY > 0,
      )
      if (pane) {
        const offY = e.clientY - pane.getBoundingClientRect().top
        if (pane === leftScrollRef.current) {
          const paper = pane.querySelector('.scroll-paper')?.parentElement as HTMLElement | null
          const paperTop = paper ? paper.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop : 0
          dzAnchor.current = { el: pane, offY, mode: 'left', z0: effZoomRef.current, paperTop, rel: pane.scrollTop + offY - paperTop }
        } else {
          dzAnchor.current = { el: pane, offY, mode: 'right', z0: diffZoomRef.current, paperTop: 0, rel: pane.scrollTop + offY }
        }
      } else dzAnchor.current = null
      setDiffZoom(z => { const n = Math.max(0.6, Math.min(2.5, +(z * (e.deltaY < 0 ? 1.08 : 0.926)).toFixed(3))); try { localStorage.setItem('inkwave:diffZoom', String(n)) } catch { /* private */ }; return n })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel); latch.dispose() }
  }, [])
  const lastHoveredRef  = useRef<number | null>(null)
  const activeOpIdxRef  = useRef<number | null>(null)

  // pageGeo: the REAL canonical page regions from the static paginator (effect below, after ops).
  const [pageGeo, setPageGeo] = useState<StaticPageGeo[] | null>(null)
  const pagRef = useRef<StaticPaginationHandle | null>(null)

  // Each diff's real DOCUMENT page — now read off the canonical page regions (pageGeo), so the
  // diff panel's page-break rules carry the SAME numbers as the minimap AND the true breaks.
  const [diffPages, setDiffPages] = useState<Record<number, number>>({})
  const [totalPages, setTotalPages] = useState(1)
  useEffect(() => {
    const L = leftScrollRef.current
    if (!L) return
    const compute = () => {
      const tDp = performance.now()
      const { map, total } = computeDiffPagesFor(L, pageGeo ?? null)
      setTotalPages(total)
      setDiffPages((prev) => {
        const mk = Object.keys(map)
        return (mk.length === Object.keys(prev).length && mk.every(k => prev[+k] === map[+k])) ? prev : map
      })
      probePerf('diffPages', performance.now() - tDp)
    }
    const id = requestAnimationFrame(compute)
    const t = setTimeout(compute, 400) // after fonts/pagination settle
    const ro = new ResizeObserver(() => compute()); ro.observe(L)
    return () => { cancelAnimationFrame(id); clearTimeout(t); ro.disconnect() }
  }, [snapshot.id, pageGeo])

  // Publish split position as a CSS variable so the parent can position the right nav.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--snap-split-pct', vertical ? '50%' : `${splitPct}%`)
    return () => { root.style.removeProperty('--snap-split-pct') }
  }, [splitPct, vertical])

  // Compute ops once; shared between both panes. resolveCitations:true → the diff shows the reader's
  // "(Author, Year)" form, not the raw citekeys (the library is loaded on this route). Cache-through
  // (diffCache): the scrub read-ahead precomputes these in idle time, so navigation is a cache hit.
  const ops = useMemo(() => {
    const t0 = performance.now()
    const r = opsBetween(prevSnap, snapshot)
    probePerf('ops', performance.now() - t0)
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevSnap?.id, snapshot.id])

  // Keep a ref so imperative highlight helpers can read ops without stale closure
  const opsRef = useRef<DiffOp[] | null>(null)
  opsRef.current = ops

  // ── Keep-alive doc-pane layer window (2026-07-11 — the flip-to-card fix) ────────────────────
  // Pagination + rendering moved INTO DocLayer (one per snapshot, kept alive). Here we manage the
  // LRU window: the active id joins at render time (a flip to an unwarmed snapshot must mount this
  // commit); the ±1 neighbours warm AFTER the flip has painted, staggered so each warm (a hidden
  // full render + canonical measure) is its own task; old layers beyond MAX_LAYERS evict LRU,
  // never evicting current/prev/next.
  const MAX_LAYERS = 5
  const [layerIds, setLayerIds] = useState<string[]>([])
  // BACKGROUND SWEEP (2026-07-16 — Peter "yes add the sweep"): bake a thumbnail for EVERY version
  // while /snapshot sits open, Photos-style library pre-generation. A thumbnail can only be
  // rasterised from a MOUNTED pane, so the sweep drives one extra hidden warm DocLayer at a time
  // (opacity 0.001 — same keep-alive machinery): mount → onWarmReady → queueCapture → bake → next.
  // Idle-only, pauses on ANY input or active scrub, resumable, bakes OUTWARD from the current
  // position. Without this the flipbook has nothing to flip on a first-pass cold scroll.
  const [sweepId, setSweepId] = useState<string | null>(null)
  const renderLayerIds = (() => {
    const base = layerIds.includes(snapshot.id) ? layerIds : [...layerIds, snapshot.id]
    return sweepId && !base.includes(sweepId) ? [...base, sweepId] : base
  })()
  useEffect(() => {
    // LRU-touch the active id (array order = recency, most recent last). No-op when it's already
    // most-recent — the extra setState re-rendered the whole split view after every flip.
    setLayerIds((prev) => {
      if (prev[prev.length - 1] === snapshot.id) return prev
      const rest = prev.filter((i) => i !== snapshot.id)
      return [...rest, snapshot.id]
    })
    const keep = new Set([snapshot.id, prevSnap?.id, nextSnap?.id].filter(Boolean) as string[])
    const prune = (list: string[]): string[] => {
      const out = [...list]
      for (let i = 0; i < out.length && out.length > MAX_LAYERS; ) {
        if (!keep.has(out[i])) out.splice(i, 1)
        else i++
      }
      return out
    }
    const timers: number[] = []
    const warm = (id: string | undefined, delay: number) => {
      if (!id) return
      timers.push(window.setTimeout(() => {
        setLayerIds((prev) => prev.includes(id) ? prev : prune([...prev, id]))
      }, delay))
    }
    warm(nextSnap?.id, 300)
    warm(prevSnap?.id, 900)
    setLayerIds((prev) => prune(prev))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [snapshot.id, prevSnap?.id, nextSnap?.id])

  // ── Sweep PANES (round 10, 2026-07-16) — the diff panel + minimap for an UNVISITED version ──
  // The sweep bakes from a hidden warm DocLayer, which only ever gave us the DOC pane; the diff
  // panel and the minimap render off the ACTIVE snapshot's state, so two of the three panes had no
  // thumbnail for an unvisited version and a cold fling fell back to a stale nearest for both
  // (the asymmetry Peter saw: one pane flickering, two lagging).
  //
  // Neither needs the version ACTIVATED, and neither touches the visible panes:
  //  · DIFF — `opsBetween(prev, target)` is a PURE, diffCache-backed function of two snapshots and
  //    InlineDiffView is a pure render of those ops. So we render a second InlineDiffView into an
  //    OFFSCREEN host sized to the real diff pane's box and capture THAT.
  //  · MAP  — MinimapPanel is already parameterised by (leftRef, ops, pageGeo); it never reads the
  //    active snapshot. Point it at the SWEEP LAYER's own scroller + that layer's page geometry.
  // The contract change is exactly one line in DocLayer: the warm-only branch now hands its pages
  // to onWarmReady. The ACTIVE layer's activation path is byte-unchanged.
  const warmGeoRef = useRef(new Map<string, { scroller: HTMLDivElement; pages: StaticPageGeo[] | null }>())
  const [sweepReady, setSweepReady] = useState<{ id: string; pages: StaticPageGeo[] | null } | null>(null)
  const sweepScrollerRef = useRef<HTMLDivElement | null>(null)
  const sweepDiffScrollRef = useRef<HTMLDivElement>(null)
  const sweepMapHostRef = useRef<HTMLDivElement>(null)
  // The replicas must land in the SAME cache bucket as the real panes (rasterKey = kind|id|WxH|
  // zoom|dpr), so they're sized from the live panes' own boxes — local px, unaffected by the diff
  // pane's CSS zoom, which the replica re-applies identically.
  const [sweepBox, setSweepBox] = useState<{ dw: number; dh: number; mw: number; mh: number } | null>(null)
  const [sweepDiffPages, setSweepDiffPages] = useState<{ map: Record<number, number>; total: number }>({ map: {}, total: 1 })

  // ── The sweep driver ────────────────────────────────────────────────────────────────────────
  const sweepIdRef = useRef<string | null>(null)
  const sweepInputRef = useRef(0)
  useEffect(() => {
    const mark = () => { sweepInputRef.current = performance.now() }
    const evs = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const
    for (const e of evs) window.addEventListener(e, mark, { passive: true })
    return () => { for (const e of evs) window.removeEventListener(e, mark) }
  }, [])
  useEffect(() => {
    if (!snapThumbsEnabled() || allSnaps.length < 2) return
    let stopped = false, timer = 0, waited = 0
    // Ids whose bake never completed within the wait budget (a pane that can't rasterise in this
    // layout, a WebKit foreignObject failure). Without this the outward scan re-picks the same
    // stalled id forever and the rest of the library never bakes. Reset on every nav (deps below).
    const gaveUp = new Set<string>()
    const later = (ms: number) => { timer = window.setTimeout(tick, ms) }
    // Round 10: a version is DONE only when every REGISTERED pane (doc + diff + map) has a
    // thumbnail — a doc-only bake left two of the three panes falling back to a stale nearest.
    const done = (id: string) => presenter.pendingThumbs(id).length === 0
    // Outward from the current position — the versions you'd reach first get bitmaps first.
    const nextUnbaked = (): string | null => {
      const ci = Math.max(0, allSnaps.findIndex((s) => s.id === snapshot.id))
      for (let d = 0; d < allSnaps.length; d++) {
        for (const dir of d === 0 ? [0] : [1, -1]) {
          const i = ci + d * dir
          if (i < 0 || i >= allSnaps.length) continue
          const id = allSnaps[i].id
          if (!gaveUp.has(id) && !done(id)) return id
        }
      }
      return null
    }
    function tick() {
      if (stopped) return
      // IDLE-ONLY: pause on any input or while a scrub is presenting (same gate as captures).
      if (presenter.isActive() || performance.now() - sweepInputRef.current < 900) return later(700)
      const cur = sweepIdRef.current
      if (cur && !done(cur)) {
        // Three panes now, each an idle-pumped SVG-foreignObject render → a longer budget than
        // the doc-only 7s. Past it, park this id and move on rather than spin.
        if (waited++ < 40) return later(500)
        gaveUp.add(cur)
      }
      waited = 0
      const next = nextUnbaked()
      if (!next) { sweepIdRef.current = null; setSweepId(null); return later(5000) } // library complete
      sweepIdRef.current = next
      setSweepId(next) // mounts a hidden warm DocLayer → onWarmReady → queueCapture → bake
      later(500)
    }
    later(2500) // let the open settle before any background rendering
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [presenter, allSnaps, snapshot.id])

  // Bind the replicas to the sweep layer once it has painted + paginated. POLLED rather than
  // driven straight off onWarmReady because the sweep can pick an id that is ALREADY mounted (a
  // warm ±1 neighbour whose onWarmReady fired before it was the sweep target) — that layer's geo
  // is in warmGeoRef but no fresh event will arrive for it.
  useEffect(() => {
    if (!sweepId || !snapThumbsEnabled()) { setSweepReady(null); return }
    let tries = 0, timer = 0
    const look = () => {
      const g = warmGeoRef.current.get(sweepId)
      if (g && g.scroller.isConnected) {
        sweepScrollerRef.current = g.scroller
        setSweepReady({ id: sweepId, pages: g.pages })
        return
      }
      if (tries++ < 40) timer = window.setTimeout(look, 250) // ~10s: mount + the warm 150ms + fonts
    }
    look()
    return () => window.clearTimeout(timer)
  }, [sweepId])

  // Measure the replica boxes off the LIVE panes + derive the sweep version's page-break rules
  // from its own hidden scroller (same maths as the active pane — computeDiffPagesFor).
  useLayoutEffect(() => {
    if (!sweepReady) return
    const R = rightScrollRef.current, M = mapHostRef.current, L = sweepScrollerRef.current
    if (!R || !M || !L) return
    setSweepBox((prev) => {
      const next = { dw: R.offsetWidth, dh: R.offsetHeight, mw: M.clientWidth, mh: M.clientHeight }
      return prev && prev.dw === next.dw && prev.dh === next.dh && prev.mw === next.mw && prev.mh === next.mh ? prev : next
    })
    setSweepDiffPages(computeDiffPagesFor(L, sweepReady.pages))
  }, [sweepReady])

  // Replicas mounted → queue their captures. Same idle pump, same quiet gate, same LRU budget as
  // every other capture; the bake rides queueCapture's existing path (see scrubRaster.bakeThumb).
  useEffect(() => {
    if (!sweepReady || !sweepBox || !snapThumbsEnabled()) return
    const id = sweepReady.id
    // 450ms: the replica's own layout + MinimapPanel's deferred 350ms re-measure (its diff ticks
    // land on the second pass). Capturing earlier baked a half-drawn minimap.
    const t = window.setTimeout(() => {
      if (sweepDiffScrollRef.current) presenter.queueCapture('diff', id, () => sweepDiffScrollRef.current)
      if (sweepMapHostRef.current) presenter.queueCapture('map', id, () => sweepMapHostRef.current)
    }, 450)
    return () => window.clearTimeout(t)
  }, [presenter, sweepReady, sweepBox])

  // Layer activation: the active DocLayer points the shared refs here in ITS layout effect (which
  // flushes before this component's own per-snapshot effects — React guarantees child-first).
  const handleLayerActivate = useCallback((scroller: HTMLDivElement, handle: StaticPaginationHandle | null, pages: StaticPageGeo[] | null) => {
    ;(leftScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = scroller
    pagRef.current = handle
    setPageGeo(pages)
  }, [])
  const handleLayerGeo = useCallback((pages: StaticPageGeo[]) => setPageGeo(pages), [])
  // ── Fit cap + effective pane zoom (Peter, 2026-07-10 — the main editor's fit-to-width floor) ──
  // The doc pane's zoom lives as CSS `zoom` on the PAPER (applied imperatively below), so scaling
  // shrinks the whole page — sheet, panels, gaps, text — and a narrow pane always shows the FULL
  // page, never a horizontally-cut one. fit = (paneWidth − water margins) / canonical page width,
  // recomputed on every pane resize (split drag, window resize, side panel). Manual zoom below the
  // cap works; zooming past fit is capped, exactly like magnify.ts's fitScale. PHONE: the pane
  // defaults to the phone view — fluid full-width paper + PHONE_PAGE_MARGIN (staticPagination), so
  // effective zoom is pinned to 1 and the page spans edge-to-edge with no side water.
  const [paneFit, setPaneFit] = useState(1)
  useLayoutEffect(() => {
    const L = layerHostRef.current // stable across layer flips (same box as every layer's scroller)
    if (!L || isPhone || getPaperSize() === 'scroll') return // phone/fluid: paper is already pane-width
    const { pageWidthPx } = pageBoxPx({
      paperSize: getPaperSize() === 'letter' ? 'letter' : 'a4',
      orientation: getOrientation(), topMarginPx: 0, bottomMarginPx: 0,
    })
    let raf = 0
    const compute = () => setPaneFit((prev) => {
      const next = Math.max(0.2, (L.clientWidth - 2 * WATER_MARGIN_PX) / pageWidthPx)
      return Math.abs(next - prev) < 0.002 ? prev : next
    })
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute) })
    ro.observe(L)
    compute()
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [isPhone])
  // Phone pane zoom (pinch-driven, below) — the fluid paper has no fit identity, so it's clamped
  // rather than fit-capped; defaults to 1 = the edge-to-edge phone view.
  const [phoneZoom, setPhoneZoom] = useState(1)
  const phoneZoomRef = useRef(1)
  const effZoom = isPhone ? phoneZoom : getPaperSize() === 'scroll' ? 1 : Math.min(diffZoom, paneFit)
  const effZoomRef = useRef(effZoom); effZoomRef.current = effZoom
  // Apply the effective zoom to the paper + reposition the band panels in the SAME commit — the
  // breaks are DOM positions and never move, only the rendered geometry does. staticPagination
  // forces this zoom to 1 inside its canonical measure window and converts visual→local px in its
  // band paint, so the CSS-`zoom`-breaks-the-paginator rule (CLAUDE.md) doesn't apply here.
  useLayoutEffect(() => {
    const paper = leftScrollRef.current?.querySelector('.scroll-paper')?.parentElement as HTMLElement | null
    if (!paper) return
    // Skip when the layer is already rendered at this zoom (the common case on a flip — warm
    // layers pre-render at the current zoom): repaint() re-reads band geometry with several
    // forced layouts, ~100-200ms of pure waste when nothing changed.
    const cur = parseFloat(paper.style.getPropertyValue('zoom') || '1') || 1
    if (Math.abs(cur - effZoom) < 0.0005) return
    if (effZoom === 1) paper.style.removeProperty('zoom')
    else paper.style.setProperty('zoom', String(+effZoom.toFixed(4)))
    pagRef.current?.repaint()
  }, [effZoom, snapshot.id])
  // Cursor-anchored zoom correction — displacement math (see dzAnchor above); a fit-capped left
  // pane (z1 == z0) resolves to the original position, so a capped wheel never nudges the scroll.
  useEffect(() => {
    const a = dzAnchor.current
    if (!a) return
    const id = requestAnimationFrame(() => {
      const z1 = a.mode === 'left' ? effZoomRef.current : diffZoomRef.current
      const k = z1 / (a.z0 || 1)
      a.el.scrollTop = Math.max(0, a.mode === 'left' ? a.paperTop + a.rel * k - a.offY : a.rel * k - a.offY)
    })
    return () => cancelAnimationFrame(id)
  }, [diffZoom, effZoom])


  // ── Phone PINCH → pane zoom (Peter, 2026-07-10: "two-finger zoom doesn't work at all") ───────
  // Two fingers on the doc pane drive the SAME CSS-zoom effZoom pipeline, live: the zoom writes
  // are imperative + rAF-coalesced during the gesture (CSS zoom on the static pane is one cheap
  // uniform rescale — the sheet panels/gaps live INSIDE the zoomed paper, so nothing needs
  // repositioning mid-gesture), and the gesture end commits to phoneZoom state → one repaint
  // refreshes pageGeo. The pinch midpoint's content point is held stationary via scroll
  // correction. CAPTURE-phase listeners + stopPropagation own the two-finger gesture on this
  // pane: Scroll.tsx's surface pinch (the font-reflow pipeline) must never double-zoom, and the
  // swipe scrub's multi-touch bail hands off here. Per the phone input invariant, touchstart is
  // passive and the non-passive touchmove is armed only while two fingers are down.
  useEffect(() => {
    if (!isPhone) return
    // Listeners live on the STABLE layer host (the active scroller changes identity per flip);
    // the handlers resolve the live scroller/paper through leftScrollRef at gesture time.
    const host = layerHostRef.current
    if (!host) return
    const scrollerOf = () => leftScrollRef.current
    const paperOf = () => scrollerOf()?.querySelector('.scroll-paper')?.parentElement as HTMLElement | null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    let d0 = 0, z0 = 1, midX = 0, midY = 0, pendingZ = 0, raf = 0, armed = false
    const apply = () => {
      raf = 0
      const L = scrollerOf()
      const p = paperOf()
      if (!L || !p || !pendingZ) return
      const zPrev = parseFloat(p.style.getPropertyValue('zoom') || '1') || 1
      if (Math.abs(pendingZ - zPrev) < 0.002) return
      const lr = L.getBoundingClientRect()
      const ox = midX - lr.left, oy = midY - lr.top
      p.style.setProperty('zoom', String(+pendingZ.toFixed(4)))
      // hold the content point under the pinch midpoint still (content scales about 0,0)
      L.scrollTop = Math.max(0, (L.scrollTop + oy) * (pendingZ / zPrev) - oy)
      L.scrollLeft = Math.max(0, (L.scrollLeft + ox) * (pendingZ / zPrev) - ox)
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return
      e.stopPropagation()
      e.preventDefault() // our zoom replaces the browser's — no native pinch
      const d = dist(e.touches)
      if (d < 8) return // fingers (nearly) touching — degenerate ratio
      pendingZ = Math.max(0.5, Math.min(2.5, z0 * (d / d0)))
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const arm = () => { if (!armed) { armed = true; host.addEventListener('touchmove', onMove, { capture: true, passive: false }) } }
    const disarm = () => { if (armed) { armed = false; host.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions) } }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.stopPropagation() // this pane's pinch is OURS — keep Scroll's font pipeline dormant
      d0 = dist(e.touches)
      z0 = phoneZoomRef.current
      midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      pendingZ = 0
      arm()
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2 || !d0) return
      d0 = 0
      disarm()
      if (raf) { cancelAnimationFrame(raf); raf = 0; apply() } // land the final frame
      // Commit → refresh band panels + pageGeo. The zoom-apply effect now SKIPS when the paper is
      // already at effZoom (which it is — apply() set it live), so repaint explicitly here.
      if (pendingZ) { phoneZoomRef.current = pendingZ; setPhoneZoom(pendingZ); pagRef.current?.repaint() }
    }
    host.addEventListener('touchstart', onStart, { capture: true, passive: true })
    host.addEventListener('touchend', onEnd, { capture: true, passive: true })
    host.addEventListener('touchcancel', onEnd, { capture: true, passive: true })
    return () => {
      disarm()
      if (raf) cancelAnimationFrame(raf)
      host.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions)
      host.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions)
      host.removeEventListener('touchcancel', onEnd, { capture: true } as EventListenerOptions)
    }
  }, [isPhone])

  // ── Midline PAGE SYNC (Peter, 2026-07-10) ────────────────────────────────────────────────────
  // When the DRIVER pane's midline crosses a page boundary, the FOLLOWER flies to that page — the
  // editor's boundaries are the real canonical page regions (pageGeo); the diff panel's are its
  // page rules ([data-page], wired to the same breaks). Fires ONLY where the continuous bijection
  // isn't already driving that direction (it would fight the spring / the per-frame inverse map):
  // editor→diff jumps unless bijMode 'both'; diff→editor jumps only in 'off'. Hysteresis: pages
  // are latched per pane — one jump per boundary CROSSING (a further crossing mid-flight simply
  // RETARGETS the follower); snapshot navigation re-latches without jumping (nav-settle window).
  const pageGeoRef = useRef<StaticPageGeo[] | null>(null)
  pageGeoRef.current = pageGeo
  const rulesRef = useRef<Array<{ page: number; top: number }>>([]) // diff-pane page rules, content coords
  const lastLeftPageRef = useRef(0)   // 0 = unlatched (fresh snapshot)
  const lastRightPageRef = useRef(0)
  const pageFlightUntilRef = useRef(0) // nav-settle window: crossings latch silently until it lapses

  // ── Cross-pane highlight (injected CSS + data-attrs — zero React re-renders) ──
  // Inject once; CSS targets .diff-del / .diff-add spans that carry data-hover / data-active.
  useEffect(() => {
    const uid = `dv${Math.random().toString(36).slice(2, 8)}`
    const el = containerRef.current
    if (el) el.setAttribute('data-dv', uid)
    const style = document.createElement('style')
    style.textContent = [
      // hover: NO gold. Just the same green/red ring, THICKENED — from 1× (unlit) up to 2× when the diff
      // is fully lit (--iw-align=1), proportionally in between. Full-alpha so the hover reads on any diff.
      // PER-FRAGMENT (Peter, 2026-07-10): `outline` paints ONE rect around the union of an inline's
      // fragments, and a diff span straddling a page break hosts a BLOCK gap/marker child (block-in-
      // inline split) — the union rect became a giant empty box spanning the water / the whole page
      // (gapped AND marker mode). An inset ring shadow + box-decoration-break:clone paints per LINE
      // FRAGMENT instead — each wrapped line gets its own ring, gaps get nothing, and the browser
      // recomputes fragments on any reflow (zoom included) for free. Ring listed before the fill so
      // it stays on top.
      `[data-dv="${uid}"] span.diff-del[data-hover] { box-shadow: inset 0 0 0 calc(2px * (1 + var(--iw-align, 0))) rgba(185,28,28,0.95), inset 0 0 0 100vmax rgba(200,30,30,0.30) !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; border-radius: 2px !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-hover] { box-shadow: inset 0 0 0 calc(2px * (1 + var(--iw-align, 0))) rgba(21,128,61,0.95), inset 0 0 0 100vmax rgba(22,163,74,0.32) !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; border-radius: 2px !important; }`,
      // active (clicked): darker + ring, both panes — same per-fragment treatment
      `[data-dv="${uid}"] span.diff-del[data-active] { background: rgba(185,28,28,0.22) !important; box-shadow: inset 0 0 0 2px #991b1b !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; border-radius: 3px !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-active] { background: rgba(22,163,74,0.32)  !important; box-shadow: inset 0 0 0 2px #15803d !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; border-radius: 3px !important; }`,
      // hover + active simultaneously: both are box-shadow now, so the combined rule must restate
      // ring + fill (higher specificity wins over either single-attr rule)
      `[data-dv="${uid}"] span.diff-del[data-hover][data-active] { background: rgba(185,28,28,0.28) !important; box-shadow: inset 0 0 0 2px #991b1b, inset 0 0 0 100vmax rgba(200,30,30,0.30) !important; }`,
      `[data-dv="${uid}"] span.diff-add[data-hover][data-active] { background: rgba(22,163,74,0.38)  !important; box-shadow: inset 0 0 0 2px #15803d, inset 0 0 0 100vmax rgba(22,163,74,0.32) !important; }`,
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
    // NO --wave-x scroll sway here (2026-07-12 "snapshots lagging massively"): the pane-scoped
    // water pseudo is CONTENT-tall (>60,000px on a thesis), so every sway write invalidated its
    // whole paint and re-rastered the visible water tiles per scroll event — the same class of
    // bug as the editor's --wave-x subtree invalidation (see the typing-invariants block). The
    // absolute pseudo already scrolls WITH the content; the waves in the page gaps move naturally.
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
      const tKn = performance.now()
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
        // Diff-pane page-rule positions (content coords) — the midline page sync reads these to
        // track which page section the diff midline is on without per-frame layout reads.
        const rules: Array<{ page: number; top: number }> = []
        R.querySelectorAll('[data-page]').forEach((el) => {
          rules.push({
            page: Number((el as HTMLElement).getAttribute('data-page')),
            top: (el as HTMLElement).getBoundingClientRect().top - rRect.top + R.scrollTop,
          })
        })
        rules.sort((a, b) => a.top - b.top)
        rulesRef.current = rules
      }
      probePerf('knots', performance.now() - tKn)
    }
    // rAF-coalesce: a window resize fires many events per drag; run the heavy layout-read sweep at most once
    // per frame on the settled size instead of synchronously per event.
    let rafId = requestAnimationFrame(recompute)
    const onResize = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(recompute) }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize) }
  // pageGeo: the static paginator's gaps shift every diff's content-y — re-cache centres/knots after they land.
  // totalPages/diffPages: the diff panel re-renders its page rules off these → re-read rule positions.
  // effZoom: the fit-capped paper zoom reflows the editor pane the same way diffZoom reflows the diff pane.
  }, [snapshot.id, diffZoom, effZoom, vertical, splitPct, sidePanelPx, pageGeo, totalPages, diffPages])

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

  // ── Midline page-crossing detector (see the refs/comment at pageGeoRef above) ────────────────
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    if (!L || !R) return
    // Fresh snapshot: suppress jumps through the nav-settle window (the midline-anchor / 'longest'
    // reposition is not a user crossing), and EAGER-latch both panes' pages once layout lands so
    // the very first genuine crossing after open isn't eaten by an unlatched ref.
    lastLeftPageRef.current = 0
    lastRightPageRef.current = 0
    pageFlightUntilRef.current = performance.now() + 450
    let latchRaf = requestAnimationFrame(() => {
      latchRaf = requestAnimationFrame(() => {
        if (lastLeftPageRef.current === 0) lastLeftPageRef.current = pageOfLeft()
        if (lastRightPageRef.current === 0) lastRightPageRef.current = pageOfRight()
      })
    })
    const pageOfLeft = (): number => {
      const geo = pageGeoRef.current
      if (!geo || !geo.length) return 0
      const yc = L.scrollTop + L.clientHeight * midFracRef.current
      let k = 0
      while (k < geo.length - 1 && geo[k + 1].top <= yc) k++
      return k + 1
    }
    const pageOfRight = (): number => {
      const rules = rulesRef.current
      if (!rules.length) return 0
      const yc = R.scrollTop + R.clientHeight * midFracRef.current
      let pg = rules[0].page
      for (const r of rules) { if (r.top <= yc) pg = r.page; else break }
      return pg
    }
    // The jump = the same smooth fly the diff-click bijection uses. Targets land the page's start
    // AT the midline (its rule / its sheet top), mirroring how a page begins under the reading line.
    const flyRightToPage = (pg: number) => {
      const rule = R.querySelector(`[data-page="${pg}"]`) as HTMLElement | null
      if (!rule) return
      const top = rule.getBoundingClientRect().top - R.getBoundingClientRect().top + R.scrollTop
      diffFlightRef.current = true // diffs light off the diff midline while it flies (same as a click flight)
      window.setTimeout(() => { diffFlightRef.current = false }, 900)
      R.scrollTo({ top: Math.max(0, top - R.clientHeight * midFracRef.current + 6), behavior: 'smooth' })
    }
    const flyLeftToPage = (pg: number) => {
      const geo = pageGeoRef.current
      const region = geo?.[pg - 1]
      if (!region) return
      const target = Math.max(0, region.top - L.clientHeight * midFracRef.current + 6)
      L.scrollTo({ top: target, behavior: 'smooth' })
      anchorRatioRef.current = (target + L.clientHeight * midFracRef.current) / Math.max(1, L.scrollHeight)
    }
    // Crossings on the DRIVER pane RETARGET any in-flight jump (a new smooth scrollTo on the same
    // follower simply supersedes — a fast multi-page scroll lands on the final page instead of a
    // stale one). Loops can't happen: the follower's own flight-induced crossings fail the driver
    // gate. Suppression covers only the nav-settle window and minimap drags (gentleFollow).
    let tick = false
    const step = () => {
      tick = false
      const suppressed = performance.now() < pageFlightUntilRef.current || gentleFollowRef.current
      const lp = pageOfLeft()
      if (lp && lp !== lastLeftPageRef.current) {
        const crossed = lastLeftPageRef.current !== 0
        lastLeftPageRef.current = lp
        // editor→diff: only while the editor drives, and only where the forward spring ISN'T
        // already syncing continuously (bijMode 'both' owns that direction).
        if (crossed && !suppressed && driverRef.current === 'left' && bijectionRef.current !== 'both') flyRightToPage(lp)
      }
      const rp = pageOfRight()
      if (rp && rp !== lastRightPageRef.current) {
        const crossed = lastRightPageRef.current !== 0
        lastRightPageRef.current = rp
        // diff→editor: only while the diff drives, and only in 'off' — 'both'/'reverse' already
        // drive the editor per-frame via the inverse bijection (a jump would fight it).
        if (crossed && !suppressed && driverRef.current === 'right' && bijectionRef.current === 'off') flyLeftToPage(rp)
      }
    }
    const onScroll = () => { if (!tick) { tick = true; requestAnimationFrame(step) } }
    L.addEventListener('scroll', onScroll, { passive: true })
    R.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(latchRaf)
      L.removeEventListener('scroll', onScroll)
      R.removeEventListener('scroll', onScroll)
    }
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
        let F = 0, inWell = false
        if (nk) {
          const w = nk.half + WARP_WELL_PAD, u = (x - nk.c) / w
          // FINITE well: zero at the centre AND at ±w, nothing beyond — no long gaussian tail creeping the
          // scroll toward a distant diff (the "phantom well / stuck in the middle of nowhere").
          if (Math.abs(u) < 1) { F = -u * (1 - u * u) * WARP_WELL; inWell = true }
        }
        const resistance = WARP_RESIST_MIN + (WARP_RESIST_MAX - WARP_RESIST_MIN) * Math.exp(-Math.abs(v) / WARP_V0)
        v = v + F - resistance * v
        x = Math.max(0, Math.min(maxScroll(), x + v))
        el.scrollTop = x
        // Settle ONLY when basically on a diff (snapped) or in free space — never mid-pull, which was the creep.
        const snapped = !!nk && nd <= nk.half + 2
        if (Math.abs(v) < 0.05 && (!inWell || snapped)) { v = 0; raf = 0; return }
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
  // GESTURE STATE LIVES IN REFS (round 3): this effect re-subscribes on every step (per-render `nav`
  // identity + the per-landing scroller swap), and effect-local accum/started reset the detent
  // mid-gesture — every step cost ~5 more events (probed: a 22-step scrub degenerated to ~3 hops).
  const hAccumRef = useRef(0)
  const hStartedRef = useRef(false)
  const onScrub = nav?.onScrub
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    let idle: ReturnType<typeof setTimeout> | undefined
    const FIRST = 34, REST = 7
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.3) return // not a horizontal swipe
      e.preventDefault()
      clearTimeout(idle)
      idle = setTimeout(() => { hStartedRef.current = false; hAccumRef.current = 0 }, 140) // pause → re-arm the detent
      hAccumRef.current += e.deltaX
      let net = 0
      if (!hStartedRef.current && Math.abs(hAccumRef.current) >= FIRST) { hStartedRef.current = true; const s = hAccumRef.current > 0 ? 1 : -1; hAccumRef.current -= s * FIRST; net += -s } // reversed: right → previous
      if (hStartedRef.current) while (Math.abs(hAccumRef.current) >= REST) { const s = hAccumRef.current > 0 ? 1 : -1; hAccumRef.current -= s * REST; net += -s }
      if (net) onScrub?.(net, e.timeStamp, 'scrub') // position scrubber = bitmap scrub from step 1
    }
    L?.addEventListener('wheel', onWheel, { passive: false })
    R?.addEventListener('wheel', onWheel, { passive: false })
    return () => { clearTimeout(idle); L?.removeEventListener('wheel', onWheel); R?.removeEventListener('wheel', onWheel) }
  }, [onScrub, snapshot.id])

  // On snapshot change: reposition the new content under the midline. Two modes:
  //  • 'center'  — keep the SAME words on the midline (content-anchored; the default).
  //  • 'longest' — snap so the biggest change sits just BELOW the midline, i.e. the dotted line
  //                lands just above whichever diff has the longest character chain.
  useEffect(() => {
    const el = leftScrollRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      const tMid = performance.now()
      try {
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
      // Observable: a null here means the pane has NO anchor, so every warm layer falls back to the
      // ratio and the flipbook slides. This was silently the case at load for the veil's whole life.
      probePerf(`scrub.sig.${s ? 'ok' : 'null'}`, 0)
      if (s) anchorSigRef.current = s
      } finally { probePerf('midline', performance.now() - tMid) }
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
      if (vertical) setVSplitPct(Math.max(20, Math.min(80, Math.round(raw))))
      else setSplitPct(Math.max(20, Math.min(80, Math.round(raw))))
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

  // ── THE REGISTRATION ANCHOR (the doc pane's "same words at the centre" contract) ─────────────
  // Same shape as the zoom focal anchor (99bf8a0): hold a CONTENT identity, re-find it after the
  // thing changed, land on it. Here the "change" is the version itself, so the counterpart is
  // found through the provenance word-diff rather than re-read from the same DOM.
  //
  // THE RULE, in order — every branch lands SOMEWHERE sensible, never the top:
  //   1. EXACT      — the anchor text exists in this version → put it under the reading line.
  //   2. NEIGHBOUR  — the anchor text was inserted/deleted between the versions, so it HAS no
  //                   counterpart. Fall back to the nearest text that provenance says survives
  //                   into this version (`same` ops) and land THAT under the line. The reader
  //                   drifts by the length of the edit, which is the smallest honest error
  //                   available: there is nothing else to be at the centre.
  //   3. RATIO      — no anchor at all (never scrolled / no surviving text). Proportional
  //                   position, the pre-existing behaviour.
  // Runs on the WARM layer's deferred pagination task (idle, beside a 130-270ms paginate and a
  // 300ms+ raster), never on the input path. Observable: probes below tally each branch, so a
  // fallback storm is visible instead of silently reading as "registered".
  const snapForAnchorRef = useRef(snapshot); snapForAnchorRef.current = snapshot
  const allSnapsRef = useRef(allSnaps); allSnapsRef.current = allSnaps
  const anchorScrollTopFor = useCallback((scroller: HTMLDivElement, snapId: string): number => {
    const t0 = performance.now()
    let mode = 'ratio.nosig'
    try {
      // KNOWN-NEGATIVE A/B (harness-only): the OLD rule — prime every version to the active pane's
      // raw scrollTop. A probe must prove it can SEE this misregistration before its verdict on the
      // fix means anything (this codebase has trusted instruments that measured a fiction).
      if ((window as unknown as { __iwAnchorRule?: string }).__iwAnchorRule === 'scrolltop') {
        mode = 'scrolltop'
        return leftScrollRef.current?.scrollTop ?? 0
      }
      // NB the scrub is ALWAYS content-registered — including under lineMode 'longest' (the
      // default), which deliberately abandons the anchor to snap each version to ITS OWN biggest
      // change. That rule is right for a deliberate single step ("show me what changed") and ruin
      // for a burst: measured, it flings the reading position a median 50,455px per version, which
      // is the mush Peter is describing. So 'longest' stays exactly as it is on the LIVE landing
      // render (this changes no navigation semantics), while the flipbook frames the sweep bakes
      // hold the reader's place. Landing in 'longest' then snaps to the change — as it already did
      // before this commit, since the live render always re-anchored itself on landing regardless.
      const sig = anchorSigRef.current
      if (sig) {
        mode = 'ratio.miss'
        const exact = scrollTopForSignature(scroller, sig, anchorRatioRef.current)
        if (exact != null) { mode = 'exact'; return Math.max(0, exact) }
        const active = snapForAnchorRef.current
        const target = allSnapsRef.current.find((s) => s.id === snapId)
        if (active && target && active.id !== target.id) {
          const near = survivingNeighbourSig(active, target, sig, anchorRatioRef.current)
          if (!near) mode = 'ratio.nosurvivor'
          const t = near ? scrollTopForSignature(scroller, near, anchorRatioRef.current) : null
          if (t != null) { mode = 'neighbour'; return Math.max(0, t) }
        }
      }
      return Math.max(0, anchorRatioRef.current * scroller.scrollHeight - scroller.clientHeight * midFracRef.current)
    } finally {
      probePerf(`scrub.anchor.${mode}`, performance.now() - t0)
      const w = window as unknown as {
        __iwAnchorTrace?: unknown
        __iwAnchorLast?: { mode: string; want: string; rawWant: string | null; ratio: number }
      }
      if (w.__iwAnchorTrace) { // harness-only
        w.__iwAnchorLast = { mode, want: anchorSigRef.current ?? '', rawWant: anchorSigRef.current, ratio: anchorRatioRef.current }
      }
    }
  }, [])

  // Stable hooks bundle for the keep-alive layers (identity-stable so memoised layers only
  // re-render when their own snap/active props change).
  const layerHooks = useMemo<DocLayerHooks>(() => ({
    onActivate: handleLayerActivate,
    onGeo: handleLayerGeo,
    onScroll: onLeftScroll,
    onOpClick: handleLeftPaneClick,
    onHoverOp: handleHoverOp,
    getZoom: () => effZoomRef.current,
    getAnchorTop: anchorScrollTopFor,
    // A warm layer that just painted is capturable while hidden (opacity 0.001 keeps it laid
    // out + painted) — pre-rasters the ±1 neighbours before they're ever flipped to. Round 10:
    // also PARK this hidden layer's scroller + page geometry, the only source of a non-active
    // version's real geometry (the sweep's offscreen minimap replica binds to it). Recording
    // only — nothing here touches the shared active refs.
    onWarmReady: (id, scroller, pages) => {
      warmGeoRef.current.set(id, { scroller, pages })
      presenter.queueCapture('doc', id, () => scroller)
    },
  }), [handleLayerActivate, handleLayerGeo, onLeftScroll, handleLeftPaneClick, handleHoverOp, presenter, anchorScrollTopFor])

  // ── Scrub bitmap wiring (round 3 — editor/scrubRaster.ts) ────────────────────────────────────
  // Surfaces: each pane gets an overlay host (absolute, inset 0, hidden at rest) the presenter
  // swaps cached <canvas> bitmaps into during rapid stepping. getZoom feeds the cache KEY (a
  // zoom change re-buckets); the diff pane's CSS zoom additionally scales its raster (the zoom
  // wraps that whole pane, so its scroller measures in local px).
  useEffect(() => {
    presenter.registerSurface('doc', docOverlayRef.current, () => leftScrollRef.current, () => effZoomRef.current)
    presenter.registerSurface('diff', diffOverlayRef.current, () => rightScrollRef.current, () => diffZoomRef.current)
    presenter.registerSurface('map', mapOverlayRef.current, () => mapHostRef.current, () => 1)
    return () => {
      presenter.registerSurface('doc', null, () => null, () => 1)
      presenter.registerSurface('diff', null, () => null, () => 1)
      presenter.registerSurface('map', null, () => null, () => 1)
    }
  }, [presenter])
  // Capture the ACTIVE panes once they settle (fonts/pagination/midline reposition land well
  // inside the delay) — re-keyed on zoom / pane geometry changes. Idle-pumped off the input path.
  useEffect(() => {
    const t = window.setTimeout(() => {
      presenter.queueCapture('doc', snapshot.id)
      presenter.queueCapture('diff', snapshot.id)
      presenter.queueCapture('map', snapshot.id)
    }, 700)
    return () => window.clearTimeout(t)
  }, [presenter, snapshot.id, effZoom, diffZoom, pageGeo, vertical, splitPct, sidePanelPx])
  // A scroll moves what's on screen → the stored bitmaps go stale; recapture on scroll settle
  // (the minimap too — its "you are here" marker tracks the doc pane).
  useEffect(() => {
    const L = leftScrollRef.current, R = rightScrollRef.current
    if (!L && !R) return
    let t = 0
    const onScroll = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        presenter.queueCapture('doc', snapshot.id)
        presenter.queueCapture('diff', snapshot.id)
        presenter.queueCapture('map', snapshot.id)
      }, 700)
    }
    L?.addEventListener('scroll', onScroll, { passive: true })
    R?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(t)
      L?.removeEventListener('scroll', onScroll)
      R?.removeEventListener('scroll', onScroll)
    }
  }, [presenter, snapshot.id])
  // The overlay hosts: hidden at rest, pointer-transparent, UNDER the midline/nav chrome (z 4 <
  // midline 5) so the reading line + counters stay visible over the bitmaps.
  const scrubOverlayStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, zIndex: 4, display: 'none', overflow: 'hidden', pointerEvents: 'none',
  }

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
      {/* Control stack (version pill / snap / bijection) — placements (Peter, round 2 2026-07-11):
          PHONE: nothing here — the toggles live IN the bottom bar (SnapshotView) and the version
          pill floats over the side/diff boundary (see the grid render below), freeing the old
          floating row so the minimap + summaries can use the space. WIDE DESKTOP: fixed,
          right-edge anchored a hair past the divider (left = --snap-split-pct, the split var
          published above) so even the widest pill ends LEFT of the editor's text column — the
          stack floats OVER the diff panel + its scrollbar on a higher layer, still fully
          clickable; position:fixed also escapes the pane's overflow:hidden, which would clip any
          in-pane leftward overhang. NARROW (non-phone) keeps the in-pane top-left column — the
          diff panel is below the editor there, so there is nothing to overhang. */}
      {!isPhone && (
      <div style={vertical
        ? { position: 'absolute', top: 'clamp(6px, 1.4vh, 12px)', left: 0, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 1vh, 10px)', alignItems: 'flex-start' }
        : { position: 'fixed', left: 'var(--snap-split-pct, 28%)', top: 'calc(clamp(38px, 7vh, 48px) + 10px)', transform: 'translateX(calc(-100% + 5px))', zIndex: 46, display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 1vh, 10px)', alignItems: 'flex-end' }}>
        {counter && (<div ref={counterRef} style={{ background: '#fff', border: `2px solid ${INK}`, color: INK, fontWeight: 700, borderRadius: 8, padding: 'clamp(2px,0.5vh,4px) clamp(7px,1vw,12px)', fontSize: 'clamp(0.72rem, 1.6vw, 1.1rem)', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(80,50,10,0.15)', pointerEvents: 'none' }}>{counter}</div>)}
        <button type="button" onClick={cycleSnap} title="Editor snap to diffs (wheel physics) — on/off" style={toggleBtn(snapMode !== 'off')}>{snapMode === 'off' ? 'Off' : 'On'}</button>
        <button type="button" onClick={cycleBijection} title="Cross-pane sync — Both ways · diff drives editor only · Off" style={toggleBtn(bijMode !== 'off')}>{bijMode === 'both' ? 'Both' : bijMode === 'reverse' ? 'L ← R' : 'Off'}</button>
      </div>
      )}
      {/* Keep-alive layer stack (see DocLayer): recently-visited snapshots stay mounted +
          laid out (visibility:hidden), so flipping between them is paint-only. Pane zoom lives
          on each layer's PAPER (fit-capped effZoom, imperative — see the fit-cap effect). */}
      <div ref={layerHostRef} style={{ position: 'relative', height: '100%' }}>
        {renderLayerIds.map((id) => {
          const li = allSnaps.findIndex((s) => s.id === id)
          if (li < 0) return null
          return (
            <DocLayer
              key={id}
              snap={allSnaps[li]}
              prev={li > 0 ? allSnaps[li - 1] : null}
              active={id === snapshot.id}
              isPhone={isPhone}
              hooks={layerHooks}
            />
          )
        })}
      </div>
      {/* Scrub bitmap overlay — the presenter flips cached pane rasters here during rapid steps. */}
      <div ref={docOverlayRef} className="iw-scrub-overlay" aria-hidden="true" style={scrubOverlayStyle} />
      {nav?.show && (<>
        <NavSide side="left" snapDir="back" onSnap={nav.onBack} snapDisabled={!nav.canBack} onVer={nav.onVerBack} verDisabled={!nav.canVerBack} hasVersions={nav.hasVersions} isPhone={isPhone} midPct={vertical ? 84 : midFrac * 100} overridePos={{ position: 'absolute', left: isPhone ? 2 : 8 }} />
        <NavSide side="right" snapDir="fwd" onSnap={nav.onFwd} snapDisabled={!nav.canFwd} onVer={nav.onVerFwd} verDisabled={!nav.canVerFwd} hasVersions={nav.hasVersions} isPhone={isPhone} midPct={vertical ? 84 : midFrac * 100} overridePos={{ position: 'absolute', right: isPhone ? 2 : 8 }} />
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
      <InlineDiffView ops={ops} prevSnap={prevSnap} onChangeClick={handleClickOp} onHoverOp={handleHoverOp} scrollBodyRef={rightScrollRef} midFrac={midFrac} diffPages={diffPages} totalPages={totalPages} />
      {/* Scrub bitmap overlay — inside the zoomed pane, so its local-px canvas scales with the content. */}
      <div ref={diffOverlayRef} className="iw-scrub-overlay" aria-hidden="true" style={scrubOverlayStyle} />
      {nav?.show && (<>
        {thinNav('left', nav.onBack, !nav.canBack, '‹', 'Previous snapshot (←)')}
        {thinNav('right', nav.onFwd, !nav.canFwd, '›', 'Next snapshot (→)')}
      </>)}
    </div>
  )
  const sidePaneEl = (sz: React.CSSProperties) => (
    // Phone: the old floating control row + Verify button are gone (round 2), so the minimap and
    // summaries get the full pane height — plain padding all round.
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
      {/* mapHost wraps the minimap so the scrub capture (and its overlay) covers exactly its box. */}
      <div ref={mapHostRef} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <MinimapPanel leftRef={leftScrollRef} ops={ops} snapKey={snapshot.id} midFrac={midFrac} pageGeo={pageGeo} />
        <div ref={mapOverlayRef} className="iw-scrub-overlay" aria-hidden="true" style={scrubOverlayStyle} />
      </div>
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
  // ── Sweep replica panes (round 10) — the offscreen diff panel + minimap for the sweep version.
  // opacity 0.001 (the DocLayer keep-alive rule, NOT display:none/visibility): a truly-hidden
  // subtree has no boxes to measure and nothing to rasterise. Fixed at the viewport origin behind
  // the panes (z 0, pointer-events none); everything on top of it is opaque.
  const sweepReplicas = (() => {
    if (!snapThumbsEnabled() || !sweepReady || !sweepBox || sweepReady.id !== sweepId) return null
    const si = allSnaps.findIndex((s) => s.id === sweepReady.id)
    if (si < 0) return null
    const sSnap = allSnaps[si], sPrev = si > 0 ? allSnaps[si - 1] : null
    const sOps = opsBetween(sPrev, sSnap) // pure + diffCache-backed — no active state involved
    // LAY THE REPLICAS OUT IN FLOW (flex row), NEVER with position:absolute + a left/top offset.
    // A captured element's OWN inline position rides into the clone, and captureRegion drops the
    // clone at the foreignObject's origin — so an offset host rasters OUTSIDE the crop, comes back
    // blank, gets silently dropped by blank-detect, and stalls the sweep on that version forever
    // (probed: scrub.capture.fail.map, map baked 1/36). Each host also mirrors its real
    // counterpart's `position` exactly (mapHost is relative).
    return (
      <div key={sweepReady.id} aria-hidden="true" style={{
        position: 'fixed', left: 0, top: 0, zIndex: 0, opacity: 0.001, pointerEvents: 'none',
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        {/* Mirrors diffPaneEl's wrapper exactly (box + CSS zoom + background) so the capture lands
            in the real diff surface's cache bucket and rasters at the same scale. */}
        <div style={{
          position: 'relative', flexShrink: 0, width: sweepBox.dw, height: sweepBox.dh,
          background: '#f9f7f4', overflow: 'hidden', zoom: diffZoom,
        } as React.CSSProperties}>
          <InlineDiffView
            ops={sOps} prevSnap={sPrev} onChangeClick={noopOp} onHoverOp={noopHover}
            scrollBodyRef={sweepDiffScrollRef} midFrac={midFrac}
            diffPages={sweepDiffPages.map} totalPages={sweepDiffPages.total}
          />
        </div>
        {/* Mirrors the mapHost box; MinimapPanel is already parameterised by (leftRef, ops,
            pageGeo) — pointing it at the SWEEP LAYER's scroller needs no change to it at all. */}
        <div ref={sweepMapHostRef} style={{
          position: 'relative', flexShrink: 0, width: sweepBox.mw, height: sweepBox.mh,
          display: 'flex', flexDirection: 'column',
        }}>
          <MinimapPanel leftRef={sweepScrollerRef} ops={sOps} snapKey={sweepReady.id} midFrac={midFrac} pageGeo={sweepReady.pages} />
        </div>
      </div>
    )
  })()

  const grid: React.CSSProperties = vertical
    ? { gridTemplateColumns: '1fr 3px 1fr', gridTemplateRows: `${vSplitPct}% 7px 1fr`,
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
        {/* PHONE version pill — floats over the side↔diff boundary (shares the d2 grid track,
            overflowing it; Peter, round 2 2026-07-11). Pointer-events off: it's a readout. */}
        {isPhone && counter && (
          <div style={{ gridArea: 'd2', position: 'relative', zIndex: 30, pointerEvents: 'none', minWidth: 0, minHeight: 0 }}>
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: '#fff', border: `2px solid ${INK}`, color: INK, fontWeight: 700, borderRadius: 8,
              padding: '2px 8px', fontSize: '0.72rem', fontFamily: 'inherit', whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(80,50,10,0.15)', letterSpacing: '-0.02em',
            }}>{counter}</div>
          </div>
        )}
      </div>
      {sweepReplicas}
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
  const docIdRef = useRef(docId); docIdRef.current = docId // stable read for the scrub-thumbnail store
  const urlSnapId = params.get('snap')
  // In-view navigation is LOCAL-FIRST (2026-07-11): goTo flips this state immediately (one cheap
  // render) and syncs the URL 200ms after the last input — react-router's per-navigation work was
  // ~50-100ms per scrub step on a phone. External URL changes (back/forward, fresh open) still
  // flow through urlSnapId whenever no local navigation is pending.
  const [liveSnapId, setLiveSnapId] = useState<string | null>(null)
  const pendingUrlSyncRef = useRef<string | null>(null) // id our own deferred navigate() will write
  const snapId = liveSnapId ?? urlSnapId
  // Hand authority back to the URL only AFTER it catches up. navigate() lands as a TRANSITION
  // (lower priority), so clearing liveSnapId alongside it rendered an intermediate frame with the
  // OLD url — the view ping-ponged A→B→A→B on every step. An external URL change (back/forward)
  // while local nav is pending also clears — the URL wins.
  useEffect(() => {
    if (liveSnapId == null) return
    if (urlSnapId === liveSnapId) { setLiveSnapId(null); pendingUrlSyncRef.current = null }
    else if (urlSnapId !== null && pendingUrlSyncRef.current !== null && urlSnapId !== pendingUrlSyncRef.current) {
      pendingUrlSyncRef.current = null
      setLiveSnapId(null)
    }
  }, [urlSnapId, liveSnapId])

  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([])
  const allSnapshotsRef = useRef(allSnapshots); allSnapshotsRef.current = allSnapshots
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [libReady, setLibReady] = useState(false)
  const [, setNavDir] = useState<'back' | 'fwd'>('fwd')
  const [genSeed, setGenSeed] = useState(0)   // increment to force-regenerate all summaries
  const [isRegenerating, setIsRegenerating] = useState(false)
  // AI summaries are opt-in (off by default). Enabling — here via the panel CTA, or from the
  // editor's Settings — bumps genSeed so the backfill effect fills every missing summary.
  const [aiOn, setAiOn] = useState(aiSummariesEnabled)
  const [consentOpen, setConsentOpen] = useState(false)
  const [verifyDoc, setVerifyDoc] = useState<InkwaveDocument | null>(null) // Verify → the editor's auto-verify modal
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
  // Editor-snap (warp physics) + cross-pane bijection modes — lifted from SplitDiffView (round 2,
  // 2026-07-11) so the PHONE bottom bar can host the toggles; desktop's control stack gets them
  // as props. Both persisted.
  const [snapMode, setSnapMode] = useState<SnapMode>(() => {
    try { return localStorage.getItem('inkwave:editorSnap') === 'warp' ? 'warp' : 'off' } catch { return 'off' }
  })
  const cycleSnap = useCallback(() => setSnapMode((m) => {
    const next: SnapMode = m === 'off' ? 'warp' : 'off'
    try { localStorage.setItem('inkwave:editorSnap', next) } catch { /* private */ }
    return next
  }), [])
  const [bijMode, setBijMode] = useState<BijMode>(() => {
    try { const s = localStorage.getItem('inkwave:bijection'); return s === 'both' || s === 'reverse' || s === 'off' ? s : 'reverse' } catch { return 'reverse' }
  })
  const cycleBijection = useCallback(() => setBijMode((m) => {
    const next: BijMode = m === 'both' ? 'reverse' : m === 'reverse' ? 'off' : 'both'
    try { localStorage.setItem('inkwave:bijection', next) } catch { /* private */ }
    return next
  }), [])

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
  // PERF (2026-07-11): a pure snapId change (every scrub step) must NOT re-read the archive —
  // the list is already in state and a fresh `.slice()` per step invalidated every downstream
  // memo. Only a doc change (or an unknown snap) goes back to the store.
  const loadedDocRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!docId || !snapId) { setStatus('missing'); return }
    const cur = allSnapshotsRef.current
    if (loadedDocRef.current === docId && cur.some((s) => s.id === snapId)) { setStatus('ready'); return }
    void (async () => {
      const snaps = await listSnapshots(docId)
      if (cancelled) return
      loadedDocRef.current = docId
      setAllSnapshots(snaps)
      setStatus(snaps.some((s) => s.id === snapId) ? 'ready' : 'missing')
    })()
    return () => { cancelled = true }
  }, [docId, snapId])

  // ── BREAK TABLES FOR EVERY VERSION (flag `inkwave:snapBreaks`, default OFF) ──────────────────
  // The whole-document index the plaintext page renderer opens from: per version, the doc position
  // each page starts at (~656B on disk vs the 62.9MB bitmap pool). Built here — on the route that
  // OWNS the versions — because /snapshot has no editor, which is exactly why the tables could not
  // be built at all until `editorSchema.ts` made a version's contentJson parseable outside one.
  //
  // Keyed on [docId, allSnapshots.length] — NOT on snapId. A scrub step must never restart the
  // sweep (the perf note above this block is the same lesson: a pure snapId change must not re-read
  // the archive). Hydration makes a re-run nearly free anyway, but "nearly free × every scrub step"
  // is how a background task becomes the thing you are debugging at 2am.
  //
  // This does NOT paint. It fills the index and stops; wiring the renderer's show() path is the
  // paint lane's, and a table is useless-but-harmless until then. Nothing here can touch typing:
  // there is no editor on this route (see snapshotBreaks.ts's header).
  useEffect(() => {
    if (!docId || !snapBreaksEnabled() || allSnapshots.length === 0) return
    const signal = { aborted: false }
    // Let the open settle before any background work — the same 2.5s courtesy the thumbnail sweep
    // takes. /snapshot's first frame is the product; the index can wait.
    const t = window.setTimeout(() => {
      void (async () => {
        const r = await sweepBreakTables(docId, allSnapshotsRef.current, signal)
        if (signal.aborted) return
        // The sweep's honest picture, published for the prover. NOT a gate and NOT a UI: it reports
        // what the sweep actually did (built vs hydrated, unparseable COUNTED, and how many pages
        // are genuinely reliable) so the wired cost can be read from the real route rather than
        // projected from a synthetic.
        ;(window as unknown as { __iwSnapBreakSweep?: SweepResult }).__iwSnapBreakSweep = r
        window.dispatchEvent(new Event('inkwave:snapbreaks-done'))
        probePerf('snapbreaks-sweep', r.ms)
      })()
    }, 2500)
    return () => { signal.aborted = true; window.clearTimeout(t) }
  }, [docId, allSnapshots.length])

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

  // Freeze machinery (used by goTo below; derivation lives with prevSnap further down).
  const heavySnapIdRef = useRef<string | null>(null)
  const [frozenSnapId, setFrozenSnapId] = useState<string | null>(null)
  const lastNavInputAtRef = useRef(0)
  const unfreezeTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(unfreezeTimerRef.current), [])
  // INPUT-TIME rapid detection (round 3): goTo runs AFTER the previous step's synchronous React
  // render, so goTo-to-goTo spacing ≈ render time — a heavy cold flip (300-500ms) kept every
  // pair >250ms and rapid mode never engaged EXACTLY when it was needed (probed). Events carry
  // hardware timestamps (e.timeStamp, performance.now() clock): each input source stamps ONCE
  // per user input; goTo checks the last INPUT pair. The old goTo-spacing check stays as an OR.
  const inputTimesRef = useRef({ prev: -1e9, last: -1e9 })
  const stampInput = useCallback((t?: number) => {
    const r = inputTimesRef.current
    r.prev = r.last
    r.last = typeof t === 'number' && t > 0 ? t : performance.now()
  }, [])
  const scrubArmedRef = useRef(false) // set by armed-scrub inputs; consumed by the next goTo (see scrubBy)

  // ── Scrub bitmap presenter (round 3 — editor/scrubRaster.ts) ─────────────────────────────────
  // During rapid stepping the panes flip through pre-rasterised bitmaps (ms-speed, zero layout);
  // the live DOM swaps back in at rest. Created once; getLiveId lets it hold the overlay until
  // the landing snapshot's real render has painted underneath it.
  const presenterRef = useRef<ScrubPresenter | null>(null)
  if (presenterRef.current === null || presenterRef.current.disposed) {
    presenterRef.current = createScrubPresenter({ touch: isTouchDevice(), getLiveId: () => heavySnapIdRef.current, getDocId: () => docIdRef.current })
  }
  const presenter = presenterRef.current
  useEffect(() => () => presenterRef.current?.dispose(), [])
  useEffect(() => { presenter.setOrder(allSnapshots.map((s) => s.id)) }, [presenter, allSnapshots])

  const urlSyncTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(urlSyncTimerRef.current), [])
  const goTo = useCallback((s: Snapshot) => {
    probePerf('nav.goTo', 0)
    const now = performance.now()
    const inp = inputTimesRef.current
    if (now - lastNavInputAtRef.current < 250 || inp.last - inp.prev < 250 || scrubArmedRef.current) {
      // Second-plus step of a rapid stream → freeze the heavy view until inputs go quiet, and
      // flip the pane overlays to the target's cached bitmaps (nearest on a miss) — the ms-speed
      // scrub Peter asked for; the real render catches up at rest (presenter holds the overlay
      // until the landing frame has painted). An isolated flick never enters bitmap mode.
      setFrozenSnapId((p) => p ?? heavySnapIdRef.current)
      window.clearTimeout(unfreezeTimerRef.current)
      unfreezeTimerRef.current = window.setTimeout(() => setFrozenSnapId(null), 180)
      presenter.show(s.id)
      // This path FLIPS THE BITMAP TOO, so it owes the badges the same update the rAF driver gives
      // them — otherwise the header keeps the old version's number while a new version is on
      // screen. That is the exact lie this whole change removes, and it was measurable: a burst's
      // first notch is not yet `rapid` (lastNavInputAt is 0 on a fresh page), so it lands HERE, and
      // the probe saw 14 versions presented against 13 badge paints — one stale frame at the start
      // of every gesture. Same cache-only read; an uncached pair still blanks rather than lying.
      if ((window as unknown as { __iwBadgeLive?: boolean }).__iwBadgeLive !== false) {
        const si = allRef.current.findIndex((x) => x.id === s.id) // not the 60fps path — once per notch
        if (si >= 0) paintHeaderDiffRef.current(deltaForIndexRef.current(si), si)
      }
    }
    presenter.noteInput()
    lastNavInputAtRef.current = now
    // Local-first: flip the view now, sync the URL once inputs go quiet (see liveSnapId).
    setLiveSnapId(s.id)
    window.clearTimeout(urlSyncTimerRef.current)
    urlSyncTimerRef.current = window.setTimeout(() => {
      pendingUrlSyncRef.current = s.id
      navigate(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, { replace: true })
      // liveSnapId clears in the catch-up effect above once the URL reflects s.id.
    }, 200)
    probePerf('nav.returned', 0)
  }, [navigate, presenter])
  const goToRef = useRef(goTo); goToRef.current = goTo

  // Nav actions stamp ONE input each. They double as onClick handlers (React passes the event) —
  // only a real numeric timestamp (the keyboard path) is used; anything else falls back to now().
  const goBack    = useCallback((t?: unknown) => { if (idx > 0) { stampInput(typeof t === 'number' ? t : undefined); setNavDir('back'); setLeftSnapFlash(n => n + 1); goTo(allSnapshots[idx - 1]) } }, [idx, allSnapshots, goTo, stampInput])
  const goFwd     = useCallback((t?: unknown) => { if (idx < allSnapshots.length - 1) { stampInput(typeof t === 'number' ? t : undefined); setNavDir('fwd'); setRightSnapFlash(n => n + 1); goTo(allSnapshots[idx + 1]) } }, [idx, allSnapshots, goTo, stampInput])
  const goVerBack = useCallback(() => { if (groupIdx > 0) { stampInput(); setNavDir('back'); setLeftVerFlash(n => n + 1); goTo(groups[groupIdx - 1].items[0]) } }, [groupIdx, groups, goTo, stampInput])
  const goVerFwd  = useCallback(() => { if (groupIdx >= 0 && groupIdx < groups.length - 1) { stampInput(); setNavDir('fwd'); setRightVerFlash(n => n + 1); goTo(groups[groupIdx + 1].items[0]) } }, [groupIdx, groups, goTo, stampInput])

  const canBack    = idx > 0
  const canFwd     = idx >= 0 && idx < allSnapshots.length - 1
  const canVerBack = groupIdx > 0
  const canVerFwd  = groupIdx >= 0 && groupIdx < groups.length - 1
  const hasVersions = groups.some((g) => g.versionSnap !== null)

  // ── Keyboard ← / → ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack(e.timeStamp) }
      if (e.key === 'ArrowRight') { e.preventDefault(); goFwd(e.timeStamp) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, goFwd])

  // ── Shift+wheel: scrub through snapshots ONE at a time ────────────────────────
  // Each wheel notch advances exactly ONE snapshot (never a jump of several) — rapid physical
  // scrolling still flies because the OS streams many notches, but each is a single, legible step.
  const idxRef = useRef(idx); idxRef.current = idx
  const allRef = useRef(allSnapshots); allRef.current = allSnapshots
  // Per-snapshot-index counter strings ("v2.4/3.12") — the flipbook writes these into the counter
  // DOM imperatively per presented step (no React commit per intermediate — the Photos trick).
  const counterStrings = useMemo(() => {
    if (allSnapshots.length <= 1) return []
    const gi = new Map<string, number>()
    groups.forEach((g, i) => g.items.forEach((s) => gi.set(s.id, i)))
    const lastLen = groups[groups.length - 1]?.items.length ?? 1
    return allSnapshots.map((s) => {
      const g = gi.get(s.id) ?? 0
      const pos = (groups[g]?.items.findIndex((x) => x.id === s.id) ?? 0) + 1
      return `v${g + 1}.${pos}/${groups.length}.${lastLen}`
    })
  }, [allSnapshots, groups])
  const counterStringsRef = useRef(counterStrings); counterStringsRef.current = counterStrings
  const counterElRef = useRef<HTMLDivElement>(null)

  // ── Header words-diff badges (+N / −N) — live per step, like the counter ──────────────────────
  // These used to be pinned to the HEAVY (frozen) pair, on the stated reasoning that an LCS per
  // intermediate would jank the gesture "for a number nobody reads mid-fling". Peter reads it
  // mid-fling: the premise was wrong, not the implementation. The counter already shows the shape
  // — precomputed per index, written imperatively by the driver, no React commit per step — which
  // is exactly why the version number keeps up while these crawled.
  //
  // NEVER an LCS on the input path (that concern was legitimate): peekOpsBetween is cache-only.
  // `preloadDiffWindow` keeps ±20 resident, so a scrub is reading numbers already paid for.
  // Memoised per PAIR (not per index — indices shift when a snapshot arrives; ids don't).
  const hdWrapRef = useRef<HTMLSpanElement>(null)
  const hdAddedRef = useRef<HTMLSpanElement>(null)
  const hdRemovedRef = useRef<HTMLSpanElement>(null)
  const hdNoChangeRef = useRef<HTMLSpanElement>(null)
  const hdMemoRef = useRef(new Map<string, { added: number; removed: number }>())
  /** The delta for snapshot index `i` vs its predecessor. null = UNKNOWN (uncached / no previous)
   *  — the caller must show that honestly, never the last good number. */
  const deltaForIndex = useCallback((i: number): { added: number; removed: number } | null => {
    const all = allRef.current
    if (i <= 0 || !all[i] || !all[i - 1]) return null
    const key = `${all[i - 1].id}→${all[i].id}`
    const hit = hdMemoRef.current.get(key)
    if (hit) return hit
    const ops = peekOpsBetween(all[i - 1], all[i]) // CACHE-ONLY — no LCS on the input path
    if (!ops) return null
    const d = diffStats(ops)
    hdMemoRef.current.set(key, d)
    return d
  }, [])
  /** The ONLY writer of the badges' content. React owns the structure; this owns the text, so a
   *  driver write can never be silently reverted-or-not by the vdom (it holds no value to diff). */
  const paintHeaderDiff = useCallback((d: { added: number; removed: number } | null, traceIdx = -1) => {
    const wrap = hdWrapRef.current, nc = hdNoChangeRef.current
    if (!wrap) return
    // The trace carries the INDEX it painted for: pairing paints to presents BY ORDER assumes a
    // 1:1 this code does not guarantee (it isn't — a show() can land without a paint), and that
    // assumption alone invented an off-by-one and 8 phantom "stale" steps.
    const trace = (window as unknown as { __iwBadgeTrace?: Array<{ idx: number; state: string; added: number; removed: number }> }).__iwBadgeTrace
    if (!d) {
      // UNKNOWN. A stale number that looks live is the same lie as a wrong-sized bitmap under a
      // right-looking key — this pane's whole complaint is "it shows me something that isn't where
      // I am". So: blank, but keep the BOX (visibility, not display) so the header cannot reflow
      // mid-fling. Nothing is claimed rather than something false.
      wrap.style.display = ''
      wrap.style.visibility = 'hidden'
      if (nc) nc.style.display = 'none'
      if (trace) trace.push({ idx: traceIdx, state: 'blank', added: -1, removed: -1 }) // traced too — a trace that
      // only records SUCCESSES silently drops the failure class it exists to expose (and it did:
      // one unrecorded blank shifted the pairing and invented 8 "stale" steps).
      return
    }
    const zero = d.added === 0 && d.removed === 0
    wrap.style.display = zero ? 'none' : ''
    wrap.style.visibility = 'visible'
    if (!zero) {
      if (hdAddedRef.current) hdAddedRef.current.textContent = `+${d.added}`
      if (hdRemovedRef.current) hdRemovedRef.current.textContent = `−${d.removed}`
    }
    if (nc) nc.style.display = zero ? '' : 'none' // the zero branch flips too — never sticks
    if (trace) trace.push({ idx: traceIdx, state: zero ? 'nochange' : 'shown', added: d.added, removed: d.removed })
  }, [])
  const paintHeaderDiffRef = useRef(paintHeaderDiff); paintHeaderDiffRef.current = paintHeaderDiff
  const deltaForIndexRef = useRef(deltaForIndex); deltaForIndexRef.current = deltaForIndex
  // Scrub by a NET number of snapshots at once (positive = forward). rAF-COALESCED (2026-07-11):
  // a fast drag streams several touchmoves per frame and each used to navigate — now the steps
  // accumulate and ONE navigation per frame moves by the net. virtualIdx tracks the last COMMANDED
  // index so flushes landing before React re-renders don't re-base off a stale idx.
  const virtualIdxRef = useRef(-1)
  useEffect(() => { virtualIdxRef.current = idx }, [idx]) // reality catch-up (buttons/keys too)
  const pendingStepsRef = useRef(0)
  const scrubRafRef = useRef(0)
  // ARMED-SCRUB inputs (the hold-armed touch drag, the trackpad position scrubber) are bitmap
  // mode from their FIRST step (Peter's spec: "armed multi-scrub AND rapid single flips") — the
  // first step of a burst otherwise takes the live path, and its 300-1100ms cold render bunches
  // the queued inputs into fling jumps (probed: 21 steps collapsed into ~3 goTos). Flicks stay
  // 'flick' → the isolated single-step live flip is untouched.
  const scrubBy = useCallback((steps: number, inputAt?: number, mode: 'flick' | 'scrub' = 'flick') => {
    if (!steps) return
    stampInput(inputAt) // one stamp per scrub input (touch/trackpad event time — see inputTimesRef)
    if (mode === 'scrub') scrubArmedRef.current = true
    pendingStepsRef.current += steps
    if (scrubRafRef.current) return
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = 0
      const n = pendingStepsRef.current
      pendingStepsRef.current = 0
      const all = allRef.current
      const cur = virtualIdxRef.current >= 0 ? virtualIdxRef.current : idxRef.current
      try {
        if (!n || cur < 0 || !all.length) return
        const target = Math.max(0, Math.min(all.length - 1, cur + n))
        if (target === cur) return
        virtualIdxRef.current = target
        setNavDir(n > 0 ? 'fwd' : 'back')
        goTo(all[target])
      } finally { scrubArmedRef.current = false } // consumed by this flush's goTo
    })
  }, [goTo, stampInput])
  useEffect(() => () => cancelAnimationFrame(scrubRafRef.current), [])
  const wheelAccum = useRef(0)
  // Shift-wheel FLIPBOOK (2026-07-16 — Peter: "if Apple Photos can flicker frame-by-frame on
  // scroll, so should we"). Root cause of the old "stays put until you stop": the handler computed
  // target off the COMMITTED idxRef and called goTo per event, so it advanced at most ±1 per React
  // commit — a fast shift-wheel commanded only 1-3 distinct versions of 30 (probed). Photos swaps
  // among ALREADY-RESIDENT textures decoupled from app state; so does this: a COMMANDED index runs
  // ahead of React per event, an rAF driver presents EVERY intermediate from the resident bitmap
  // cache (compositor swap, no React commit), the counter updates imperatively, and ONE React
  // commit lands the live full render on settle. DPR1 cap keeps the resident pool affordable.
  // Live diagnostics for ?snapThumbs=debug — separates "driver never ran" from "driver ran but had
  // nothing to show" from "showed into an invisible node" (the wave-video bug class).
  const swDbgRef = useRef({ engaged: false, events: 0, legacy: 0, lands: 0, commanded: new Set<string>() })
  const swCmdRef = useRef(-1)       // commanded index — runs AHEAD of React commits
  const swPresentedRef = useRef(-1) // last index shown via the bitmap flipbook
  const swRafRef = useRef(0)
  useEffect(() => () => cancelAnimationFrame(swRafRef.current), [])
  useEffect(() => {
    // LAND_QUIET_MS must be LONGER than a real mouse-wheel notch gap. At 120ms it landed BETWEEN
    // notches (a hand-rolled wheel fires every ~150-250ms): the driver caught up, saw "quiet", and
    // committed a full live render per notch — which is exactly Peter's "the minimap goes a few
    // times a second but no flashing". Land only once the stream is no longer RAPID (same 250ms
    // window goTo uses), and hold the freeze past that so the panes don't re-render mid-scrub.
    // MAX_PER_FRAME=1 — EVERY commanded version gets its own frame (the Photos bar). At 2 the
    // driver jumped two versions when behind and only show()ed the landing one, silently DROPPING
    // the intermediate: a 12-notch fling commanded 11 but presented 7. One-per-frame at 60fps =
    // 60 versions/s, far above any wheel cadence, so it keeps up AND flickers every version; an
    // extreme fling just trails by a few frames and catches up (Photos does exactly this).
    const SW_STEP = 40, MAX_PER_FRAME = 1, LAND_QUIET_MS = 260, FREEZE_HOLD_MS = 400
    const flipEnabled = !isTouchDevice() && (window as unknown as { __iwSwFlipbook?: boolean }).__iwSwFlipbook !== false

    const land = () => {
      swRafRef.current = 0
      swDbgRef.current.lands++; swDbgRef.current.engaged = false
      const all = allRef.current, cmd = swCmdRef.current
      swCmdRef.current = -1; swPresentedRef.current = -1
      if (cmd >= 0 && all[cmd]) goToRef.current(all[cmd]) // one React commit → live render + URL sync
    }
    const tick = () => {
      swRafRef.current = 0
      swDbgRef.current.engaged = true
      const all = allRef.current, cmd = swCmdRef.current
      let pres = swPresentedRef.current
      if (cmd < 0 || !all.length) { swDbgRef.current.engaged = false; return }
      if (pres === cmd) { // caught up — land when inputs go quiet, else idle a frame
        if (performance.now() - lastNavInputAtRef.current >= LAND_QUIET_MS) return land()
        swRafRef.current = requestAnimationFrame(tick); return
      }
      const dir = Math.sign(cmd - pres)
      pres += dir * Math.min(Math.abs(cmd - pres), MAX_PER_FRAME) // one version per frame — no drops
      swPresentedRef.current = pres
      if (all[pres]) {
        presenter.show(all[pres].id) // resident bitmap flip — no React re-render per step
        const cs = counterStringsRef.current[pres]
        if (cs && counterElRef.current) counterElRef.current.textContent = cs // live counter, imperative
        // The badges ride the SAME imperative path as the counter — per PRESENTED version, no
        // React commit. Cache-only; an uncached pair blanks rather than lying with a stale number.
        if ((window as unknown as { __iwBadgeLive?: boolean }).__iwBadgeLive !== false) {
          paintHeaderDiffRef.current(deltaForIndexRef.current(pres), pres)
        }
      }
      swRafRef.current = requestAnimationFrame(tick)
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      // Shift+wheel arrives as horizontal delta on many setups → take whichever axis is larger.
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      // ── DEBT ON REVERSAL (Peter's oldest complaint: "lags behind which version you're actually
      // up to. When you stop it catches up.") ────────────────────────────────────────────────────
      // A step consumes only SW_STEP(40) of the event's delta, but a mouse notch delivers 120 — so
      // 80 of undischarged intent survives EVERY notch and compounds. After 12 backward notches the
      // accumulator sits at ~-960, and a forward notch then reads -840: still negative, so it steps
      // BACKWARD. Probed: 12 back then 12 forward = 5 fwd / 5 back, starts at 8, ends at 8 — the
      // reversal nets nothing until the debt is paid off. Everyone (me included) read that as
      // presentation latency for weeks; presenting was measured at 49-51/s the whole time.
      // So: a direction change cancels the debt. NOT a full discharge — one notch stays one version
      // (Peter's call: it removes the bug and changes nothing he likes).
      // The `>= SW_STEP` test is what makes this safe for a TRACKPAD: a fine-delta stream never
      // leaves debt (its accumulator always lands back inside [0, SW_STEP) after a step), so its
      // jittery sign flips can never wipe legitimate in-progress accumulation. Only a coarse-delta
      // device — the one that actually leaks — can hold a debt worth cancelling.
      const debtFixOn = (window as unknown as { __iwWheelDebtFix?: boolean }).__iwWheelDebtFix !== false
      if (debtFixOn && d !== 0 && wheelAccum.current !== 0
        && Math.sign(d) !== Math.sign(wheelAccum.current) && Math.abs(wheelAccum.current) >= SW_STEP) {
        wheelAccum.current = 0
      }
      wheelAccum.current += d
      let n = 0
      if (Math.abs(wheelAccum.current) >= SW_STEP) { n = wheelAccum.current > 0 ? 1 : -1; wheelAccum.current -= n * SW_STEP }
      if (!n) return
      const all = allRef.current
      if (!all.length) return
      stampInput(e.timeStamp)
      const nowT = performance.now()
      const inp = inputTimesRef.current
      const rapid = (nowT - lastNavInputAtRef.current < 250) || (inp.last - inp.prev < 250)
      lastNavInputAtRef.current = nowT
      const D = swDbgRef.current
      D.events++
      if (!rapid) { D.events = 1; D.legacy = 0; D.lands = 0; D.commanded = new Set(); presenter.resetBurst() } // new burst
      if (!flipEnabled || !rapid) { // isolated notch (or flag off) → the legible single live step
        D.legacy++
        const cur = idxRef.current
        const target = Math.max(0, Math.min(all.length - 1, cur + n))
        if (target === cur) return
        setNavDir(n > 0 ? 'fwd' : 'back'); goToRef.current(all[target]); return
      }
      // FLIPBOOK: advance the commanded index AHEAD of React; the driver flips through every step.
      const base = swCmdRef.current >= 0 ? swCmdRef.current : idxRef.current
      const target = Math.max(0, Math.min(all.length - 1, base + n))
      if (target === base) return
      if (swPresentedRef.current < 0) swPresentedRef.current = idxRef.current
      swCmdRef.current = target
      if (all[target]) D.commanded.add(all[target].id)
      setNavDir(n > 0 ? 'fwd' : 'back')
      setFrozenSnapId((p) => p ?? heavySnapIdRef.current) // freeze the heavy panes for the scrub
      window.clearTimeout(unfreezeTimerRef.current)
      unfreezeTimerRef.current = window.setTimeout(() => setFrozenSnapId(null), FREEZE_HOLD_MS)
      presenter.noteInput()
      if (!swRafRef.current) swRafRef.current = requestAnimationFrame(tick)
    }
    // Capture phase + preventDefault so the scrub owns the wheel BEFORE the pane scrolls it (no tiny
    // pre-scroll before the snap kicks in).
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [stampInput, presenter])

  // ── Touch swipe → snapshot scrub (phone) ──────────────────────────────────────
  // TWO modes, split by a PRESS-AND-HOLD (Peter, round 2: "a single flick goes over lots of
  // snapshots — we need a short click-and-hold before the many-snaps-at-once kicks in"):
  //  • FLICK (default): a plain horizontal swipe steps EXACTLY ONE version — slide LEFT = next,
  //    slide RIGHT = previous — no matter how far or fast the finger travels.
  //  • SCRUB (armed): hold the finger ~280ms mostly still FIRST, then drag — the position-based
  //    scrubber (FIRST detent + REST px per step, like Apple Photos) with the fling coalescing.
  // Vertical stays native scroll. Works starting on either pane. The swipe OWNS horizontal on
  // this view: `touch-action: pan-y` on the root + panes keeps the browser's native x-pan from
  // racing it, and the horizontal branch preventDefaults. EXCEPTION: a pinch-zoomed doc pane
  // (zoom > 1) pans the page horizontally instead of scrubbing.
  const swipeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = swipeRef.current
    if (!el) return
    let dir: '?' | 'h' | 'v' | 'pan' = '?', startX = 0, startY = 0, lastX = 0, accum = 0, started = false
    let panEl: HTMLElement | null = null
    let downAt = 0        // touchstart time — decisive-move delay ≥ HOLD arms the scrub
    let armed = false     // true = many-snaps scrub; false = single-step flick
    let flicked = false   // the flick's one step has fired — ignore the rest of the gesture
    const HOLD = 280      // press-and-hold before moving to arm the multi-snap scrub
    const FIRST = 38, REST = 9 // scrub detents: first snap, then heaps
    const onStart = (e: TouchEvent) => {
      // Multi-touch = a PINCH (the doc pane's pane-zoom pinch, or Scroll's on other surfaces) —
      // never a scrub. Without this guard, finger-0's drift during a pinch scrubbed snapshots
      // mid-gesture (merge fix, 2026-07-10).
      if (e.touches.length > 1) { dir = 'v'; return }
      dir = '?'; accum = 0; started = false; flicked = false; armed = false
      downAt = performance.now()
      startX = lastX = e.touches[0].clientX; startY = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length > 1) { dir = 'v'; return } // a second finger landed mid-gesture → hand off to the pinch
      const x = e.touches[0].clientX, y = e.touches[0].clientY
      if (dir === '?') {
        const dx = x - startX, dy = y - startY
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return          // wait for a decisive move
        dir = Math.abs(dx) > Math.abs(dy) * 1.7 ? 'h' : 'v'         // must be pretty horizontal
        // The finger sat (nearly) still for the hold period before this decisive move → armed.
        armed = performance.now() - downAt >= HOLD
        if (dir === 'h') {
          // PINCH-ZOOMED doc pane → this horizontal drag pans the page (touch-action pan-y killed
          // the native x-pan, so we do it manually); otherwise it scrubs. Gate on the pane's zoom,
          // NOT scrollWidth — the full-bleed 100vw gap bands give the unzoomed phone pane a few px
          // of intrinsic x-overflow that made every drag pan instead of scrub.
          // Keep-alive layers: hidden panes also host a .tiptap-editor — gate on the ACTIVE one.
          const doc = (el.querySelector('.iw-snap-layer-active .iw-snap-scroll')
            ?? Array.from(el.querySelectorAll<HTMLElement>('.iw-snap-scroll')).find((p) => p.querySelector('.tiptap-editor'))) as HTMLElement | null
          const paper = doc?.querySelector('.scroll-paper')?.parentElement as HTMLElement | null
          const z = paper ? parseFloat(paper.style.getPropertyValue('zoom') || '1') || 1 : 1
          if (doc && z > 1.01) { dir = 'pan'; panEl = doc }
        }
      }
      if (dir === 'v') return                                        // vertical → let the pane scroll natively
      e.preventDefault()
      if (dir === 'pan') { if (panEl) panEl.scrollLeft -= x - lastX; lastX = x; return }
      accum += x - lastX; lastX = x
      // Slide LEFT = NEXT version, slide RIGHT = previous — the natural page-turn feel.
      if (!armed) {
        // FLICK: exactly one step per gesture, however long the swipe.
        if (!flicked && Math.abs(accum) >= FIRST) { flicked = true; scrubBy(accum > 0 ? -1 : 1, e.timeStamp) }
        return
      }
      let net = 0
      if (!started && Math.abs(accum) >= FIRST) { started = true; const s = accum > 0 ? 1 : -1; accum -= s * FIRST; net -= s }
      if (started) while (Math.abs(accum) >= REST) { const s = accum > 0 ? 1 : -1; accum -= s * REST; net -= s }
      if (net) scrubBy(net, e.timeStamp, 'scrub') // hold-armed drag = bitmap scrub from step 1
    }
    const onEnd = () => { dir = '?'; panEl = null; flicked = false; armed = false }
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

  // ── Fling coalescing (2026-07-11) ────────────────────────────────────────────
  // Rapid navigation streams (fling / held key / shift-wheel storm) FREEZE the heavy split view on
  // the snapshot it's already showing and render only the LANDING version once inputs go quiet.
  // Detection lives in goTo (the chokepoint for every navigation) and keys off INPUT spacing —
  // detecting off render spacing failed: when each step renders slowly the steps land >160ms
  // apart and nothing froze, which was the whole case that needed freezing. An isolated step
  // (a normal swipe) never freezes, so single flips stay immediate. The header counter/word-diff
  // stay live off the real idx, so the user still sees the position fly during a fling.
  // (State/refs declared above goTo, which owns the rapid-stream detection.)
  const frozenIdx = frozenSnapId ? allSnapshots.findIndex((s) => s.id === frozenSnapId) : -1
  const heavyIdx = frozenIdx >= 0 ? frozenIdx : idx
  const heavySnap = heavyIdx >= 0 ? allSnapshots[heavyIdx] : null
  const heavyPrev = heavyIdx > 0 ? allSnapshots[heavyIdx - 1] : null
  heavySnapIdRef.current = heavySnap?.id ?? null

  // ── Scrub read-ahead ──────────────────────────────────────────────────────────
  // Precompute the ±20 window of adjacent-pair diffs around the current position in idle time
  // (topped up every ~5 steps consumed — see diffCache), so a fast hard scrub hits only cache
  // and every step paints instantly. One diff max per idle slot → never blocks the scrub input.
  useEffect(() => {
    preloadDiffWindow(allSnapshots, idx)
  }, [allSnapshots, idx])
  useEffect(() => () => cancelDiffPreload(), [])

  // Words added/removed vs the previous snapshot — now shown in the top header (not a bar over the diff).
  // Reads the SAME cached ops the panes render (diffCache) — the diff used to be computed twice per step.
  // Pinned to the HEAVY (possibly frozen) pair: during a fling the live adjacent pairs may be
  // uncached, and an LCS per intermediate step would jank the gesture for a number nobody reads
  // mid-fling. It lands with the landing snapshot.
  const headerDiff = useMemo(() => {
    if (!heavySnap || !heavyPrev) return null
    return diffStats(opsBetween(heavyPrev, heavySnap) ?? [])
  }, [heavySnap?.id, heavyPrev?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // LANDING: React re-asserts the true value post-commit, exactly as it does for the counter. The
  // driver only writes during a burst, so this always wins the last word. It runs on mount too —
  // React renders the badge spans EMPTY and this fills them, which is what keeps a single writer
  // for the content (the vdom holds no text to silently diff against a driver write).
  useEffect(() => { paintHeaderDiff(headerDiff) }, [headerDiff, paintHeaderDiff])

  // The landing snapshot's live render committed → the presenter can lift the bitmap overlay off
  // the (now identical) painted frame. Runs post-commit; the presenter double-rAFs past paint.
  useEffect(() => { presenter.notifyLanded(heavySnap?.id ?? null) }, [presenter, heavySnap?.id])

  // AI summary — now shown in the RHS side panel (no longer floating over the document).
  const currentDiff = snapshot?.diffSummary?.bullets ?? null

  return (
    // height:100dvh so the split pane fills the screen without page scroll
    <div
      ref={swipeRef}
      className="font-serif"
      // touchAction pan-y: the swipe scrub owns horizontal on this view (native x-pan raced it);
      // touch-action doesn't inherit, so the scrollable panes repeat it below.
      style={{ height: '100dvh', overflow: 'hidden', color: '#3a3a3a', display: 'flex', flexDirection: 'column', touchAction: 'pan-y' }}
    >
      {/* Wave loading choreography (Peter, 2026-07-09): the same drifting-waves veil as the
          editor's load covers the snapshot view until its content is genuinely ready (snapshots
          read + citation library loaded → the panes render + lay out beneath), then coasts and
          fades so diff + doc appear together over the decaying waves. One-shot: scrubbing /
          in-view navigation never re-triggers it (status never returns to 'loading'). */}
      <LoadingVeil ready={status !== 'loading' && libReady} />
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
      {/* Fixed bar — TOP on desktop; BOTTOM on phone ("easier for the thumb to reach", Peter
          2026-07-10 — the whole top bar + controls + Verify gather into a two-row bottom region
          there, and the top of the view becomes pure content). */}
      <div
        className="z-50 flex items-center bg-white/95 backdrop-blur"
        style={{
          position: 'fixed', left: 0, right: 0,
          ...(isPhone ? { bottom: 0, borderTop: `1px solid ${INK}33` } : { top: 0, borderBottom: `1px solid ${INK}33` }),
          fontSize: 'clamp(0.72rem, 1.5vw, 1.02rem)', height: 'clamp(38px, 7vh, 48px)', gap: 'clamp(4px, 0.8vw, 10px)', padding: '0 clamp(6px, 1vw, 12px)',
        }}
      >
        {/* Phone: tighter tracking, no "read-only", and NO version label next to the ◈ icon
            (Peter, round 2 2026-07-11 — the "draft"/vN word is gone; the date suffices). */}
        <span style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0, letterSpacing: isPhone ? '-0.04em' : undefined }}>
          ◈ {snapshot
            ? `${!isPhone && versionLabel ? versionLabel + ' · ' : ''}${new Date(snapshot.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : 'Snapshot'}{isPhone ? '' : ' · read-only'}
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

        {/* PHONE: the snap/bijection toggles live IN the bar (narrowed) — the freed floating row
            gives the minimap + summaries their space (Peter, round 2 2026-07-11). */}
        {isPhone && (<>
          <button type="button" onClick={cycleSnap} title="Editor snap to diffs — on/off" style={{
            height: 22, padding: '0 6px', borderRadius: 6, flexShrink: 0,
            background: snapMode !== 'off' ? INK : '#fff', color: snapMode !== 'off' ? '#fff' : INK,
            border: `1.5px solid ${INK}`, fontSize: '0.6rem', fontFamily: 'inherit', fontWeight: 600, letterSpacing: '-0.02em',
          }}>{snapMode === 'off' ? 'Off' : 'On'}</button>
          <button type="button" onClick={cycleBijection} title="Cross-pane sync — Both · L ← R · Off" style={{
            height: 22, padding: '0 6px', borderRadius: 6, flexShrink: 0,
            background: bijMode !== 'off' ? INK : '#fff', color: bijMode !== 'off' ? '#fff' : INK,
            border: `1.5px solid ${INK}`, fontSize: '0.6rem', fontFamily: 'inherit', fontWeight: 600, letterSpacing: '-0.02em',
          }}>{bijMode === 'both' ? 'Both' : bijMode === 'reverse' ? 'L←R' : 'Off'}</button>
        </>)}

        {/* Action buttons — centred on desktop; pushed to the RIGHT end on phone (Peter, round 2).
            The words-diff sits just left of the first (biggest-change) toggle. */}
        <div className={`flex-1 flex items-center ${isPhone ? 'justify-end' : 'justify-center'}`} style={{ gap: 'clamp(3px, 0.7vw, 10px)', minWidth: 0, overflow: 'hidden' }}>
        {/* Words vs previous — bigger, immediately left of the biggest-change toggle */}
        {/* Structure only — `paintHeaderDiff` owns the CONTENT (see the badge block above), so the
            flipbook driver can write these per presented version without a React commit, the way
            the counter already does. Both branches stay MOUNTED (an unmounted node cannot be
            written to mid-fling, and remounting per step is the commit we are avoiding); the
            paint toggles them. Rendered empty on purpose: React holds no text here, so there is
            exactly one writer and no vdom/imperative desync. */}
        <span ref={hdWrapRef} className="flex items-baseline tabular-nums" style={{ fontSize: isPhone ? '0.72rem' : 'clamp(0.8rem, 1.8vw, 1.2rem)', flexShrink: 0, marginRight: isPhone ? 2 : 'clamp(6px, 1.4vw, 16px)', columnGap: isPhone ? 3 : 8, letterSpacing: isPhone ? '-0.03em' : undefined, visibility: 'hidden' }} title="words added / removed vs the previous snapshot">
          <span ref={hdAddedRef} style={{ color: '#15803d', fontWeight: 800 }} />
          <span ref={hdRemovedRef} style={{ color: '#b91c1c', fontWeight: 800 }} />
        </span>
        <span ref={hdNoChangeRef} className="text-stone-500 italic" style={{ display: 'none' }}>no change</span>
        <button
          type="button"
          onClick={toggleLineMode}
          className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm transition-colors"
          style={{
            fontSize: isPhone ? '0.62rem' : 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: isPhone ? '2px 5px' : 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap', letterSpacing: isPhone ? '-0.02em' : undefined,
            order: isPhone ? 8 : undefined, // phone: bgst Δ + ← edit hold the right end (Peter, round 2)
            background: lineMode === 'longest' ? 'rgba(92,45,138,0.16)' : 'rgba(92,45,138,0.08)',
            border: '1px solid rgba(92, 45, 138, 0.35)',
            color: INK,
          }}
          title={lineMode === 'longest'
            ? 'Dotted line snaps just above the biggest change in each snapshot — click to keep it centred on the same words'
            : 'Dotted line stays centred on the same words — click to snap it above the biggest change'}
        >
          {isPhone ? (lineMode === 'longest' ? '⇥ bgst Δ' : '↔ centred') : (lineMode === 'longest' ? '⇥ biggest change' : '↔ centred line')}
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
              fontSize: isPhone ? '0.62rem' : 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: isPhone ? '2px 5px' : 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap', letterSpacing: isPhone ? '-0.02em' : undefined,
              background: isRegenerating ? 'rgba(92,45,138,0.04)' : 'rgba(92,45,138,0.08)',
              border: '1px solid rgba(92, 45, 138, 0.35)',
              color: isRegenerating ? 'rgba(92,45,138,0.4)' : INK,
              cursor: isRegenerating ? 'default' : 'pointer',
            }}
            title="Clear and regenerate all AI summaries"
          >
            {isRegenerating ? (isPhone ? '…' : 'regenerating…') : (isPhone ? '↺ sums' : '↺ summaries')}
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
              window.clearTimeout(urlSyncTimerRef.current) // direct navigation supersedes any pending local sync
              setLiveSnapId(null)
              navigate(`/snapshot?${p.toString()}`)
              setAllSnapshots(remaining)
            }}
            className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm"
            style={{
              fontSize: isPhone ? '0.62rem' : 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: isPhone ? '2px 5px' : 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap', letterSpacing: isPhone ? '-0.02em' : undefined,
              background: 'rgba(185,28,28,0.07)',
              border: '1px solid rgba(185,28,28,0.25)',
              color: '#b91c1c',
              cursor: 'pointer',
            }}
            title="Permanently delete this snapshot"
          >
            {isPhone ? '✕ snap' : '✕ snapshot'}
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex-shrink-0 px-4 py-1.5 rounded-full font-serif shadow-sm transition-colors"
          style={{
            fontSize: isPhone ? '0.62rem' : 'clamp(0.6rem, 1.35vw, 0.92rem)', fontWeight: 500, padding: isPhone ? '2px 5px' : 'clamp(2px,0.5vh,6px) clamp(6px,1.2vw,16px)', whiteSpace: 'nowrap', letterSpacing: isPhone ? '-0.02em' : undefined,
            order: isPhone ? 9 : undefined, // phone: rightmost
            background: 'rgba(92, 45, 138, 0.08)',
            border: '1px solid rgba(92, 45, 138, 0.35)',
            color: INK,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(92,45,138,0.16)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(92,45,138,0.08)')}
        >
          {isPhone ? '← edit' : '← editor'}
        </button>
        </div>
      </div>

      {/* Spacer for the fixed bar — above the panes on desktop (top bar)… */}
      {!isPhone && <div style={{ height: 'clamp(38px, 7vh, 48px)', flexShrink: 0 }} />}

      {/* Split pane fills remaining viewport */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {(status === 'loading' || (status === 'ready' && !libReady)) && <p className="text-center text-stone-400 mt-20">Loading…</p>}
        {status === 'missing' && (
          <p className="text-center text-stone-500 mt-20">
            That snapshot isn't on this device. Snapshots live in the browser where they were written.
          </p>
        )}
        {snapThumbsDebug() && <ScrubDebugOverlay presenter={presenter} dbg={swDbgRef} docId={docId} snapCount={allSnapshots.length} />}
        {status === 'ready' && libReady && snapshot && heavySnap && (
          <SplitDiffView
            snapshot={heavySnap}
            prevSnap={heavyPrev}
            nextSnap={heavyIdx >= 0 && heavyIdx < allSnapshots.length - 1 ? allSnapshots[heavyIdx + 1] : null}
            allSnaps={allSnapshots}
            snapMode={snapMode}
            bijMode={bijMode}
            onCycleSnap={cycleSnap}
            onCycleBijection={cycleBijection}
            presenter={presenter}
            isPhone={isPhone}
            isNarrow={!isWide}
            lineMode={lineMode}
            summary={currentDiff}
            counter={allSnapshots.length > 1 ? `v${groupIdx + 1}.${snapInGroup}/${groups.length}.${lastGroup?.items.length ?? 1}` : undefined}
            counterRef={counterElRef}
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

      {/* …and below them on phone (bottom bar). */}
      {isPhone && <div style={{ height: 'clamp(38px, 7vh, 48px)', flexShrink: 0 }} />}

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

      {/* Fixed purple Verify button — opens the SAME auto-verify countdown modal as the editor's
          toolbar (VerifyModal: builds the bundle from the live doc + snapshots and verifies it);
          /verify is only the no-doc fallback. DESKTOP ONLY — removed from phone entirely
          (Peter, round 2 2026-07-11; verify from the editor there). */}
      {!isPhone && (
      <button
        type="button"
        onClick={async () => {
          if (!docId) { navigate('/verify'); return }
          try {
            const doc = await loadDocument(docId)
            if (!doc) { navigate('/verify'); return }
            setVerifyDoc(doc)
          } catch {
            navigate('/verify')
          }
        }}
        style={{
          position: 'fixed', zIndex: 56,
          bottom: 16, right: 16, padding: '8px 18px',
          background: '#5c2d8a', color: '#fff',
          border: 'none', borderRadius: 8,
          fontSize: '0.9rem', fontWeight: 600,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(92,45,138,0.35)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#7a3fb5')}
        onMouseLeave={e => (e.currentTarget.style.background = '#5c2d8a')}
        title="Verify this document — the same auto-verify flow as the editor"
      >
        Verify
      </button>
      )}

      {verifyDoc && <VerifyModal doc={verifyDoc} onClose={() => setVerifyDoc(null)} />}
    </div>
  )
}
