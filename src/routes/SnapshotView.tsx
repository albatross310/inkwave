import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '../types/document'
import { listSnapshots, groupByVersion, patchSnapshotDiffSummary, patchSnapshotVersionSummary, clearAllSnapshotSummaries } from '../provenance/snapshots'
import { pmToText, buildExportBundle, composeTraceFile } from '../provenance/bundle'
import { loadDocument } from '../storage/opfs'
import { diffWords, diffStats } from '../provenance/diff'
import { summariseDiff, summariseVersionDiff } from '../provenance/summarise'
import { Scroll, isTouchDevice } from '../editor/Scroll'
import { DocView } from '../components/DocView'

const INK = '#5c2d8a'
const NAV_BG = 'rgba(140, 90, 200, 0.20)'
const NAV_BG_DIS = 'rgba(140, 90, 200, 0.06)'
const NAV_FG = 'rgba(92, 45, 138, 0.85)'
const NAV_FG_DIS = 'rgba(140, 90, 200, 0.25)'

// ── Summary panel ─────────────────────────────────────────────────────────────
// Collapses to a 6px-wide vertical strip (width-collapse). On wide screens always
// open. On narrow/phone flashes open for 1s when flashKey changes (not on mount).
function SummaryPanel({ text, isWide, isPhone, flashKey }: {
  text: string; isWide: boolean; isPhone: boolean; flashKey: string
}) {
  const [hovered, setHovered] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const isFirstRender = useRef(true)

  useEffect(() => {
    // Skip the initial mount — only flash when flashKey actually increments
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (isWide) return
    setFlashing(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlashing(false), 1000)
    return () => clearTimeout(timer.current)
  }, [flashKey, isWide])
  useEffect(() => () => clearTimeout(timer.current), [])

  const expanded = isWide || hovered || flashing
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: expanded ? '195px' : '10px',
        minHeight: 36,
        overflow: 'hidden',
        background: expanded
          ? (isPhone ? 'rgba(237,229,247,0.82)' : '#ede5f7')
          : '#5c2d8a',
        border: expanded ? '1px solid rgba(92,45,138,0.22)' : 'none',
        borderRadius: 8,
        padding: expanded ? '5px 7px' : 0,
        fontSize: '1rem',
        lineHeight: 1.45,
        color: INK,
        cursor: expanded ? 'default' : 'pointer',
        userSelect: 'none',
        pointerEvents: 'auto',
        transition: 'width 220ms ease, padding 220ms ease, background 220ms ease',
        flexShrink: 0,
        textAlign: 'left',
      }}
    >
      {expanded && (
        <div style={{ width: 178 }}>
          {lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}

// ── Nav side ─────────────────────────────────────────────────────────────────
// Buttons always visible. Each button has a summary panel above it that collapses
// to a thin strip. Panels flash open individually based on which nav action fired.
function NavSide({
  side, snapDir,
  onSnap, snapDisabled,
  onVer, verDisabled,
  hasVersions, isPhone, isWide,
  summary, versionSummary,
  snapFlashKey, verFlashKey,
}: {
  side: 'left' | 'right'
  snapDir: 'back' | 'fwd'
  onSnap: () => void; snapDisabled: boolean
  onVer: () => void;  verDisabled: boolean
  hasVersions: boolean; isPhone: boolean; isWide: boolean
  summary: string | null
  versionSummary: string | null
  snapFlashKey: string
  verFlashKey: string
}) {
  const bracket    = snapDir === 'back' ? '<'  : '>'
  const bracketVer = snapDir === 'back' ? '<<' : '>>'
  const btnSize    = isPhone ? 34 : 44
  const showVer    = hasVersions && !isPhone

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: btnSize, height: btnSize, borderRadius: 9,
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
    // 16px inset keeps the collapsed 6px bar visible and away from the very edge
    <div style={{
      position: 'fixed', [side]: 16, top: '50%', transform: 'translateY(-50%)',
      zIndex: 45, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {/* Snapshot section: snap panel ABOVE the < button */}
      <div style={{ position: 'relative' }}>
        {summary && (
          <div style={{
            position: 'absolute', bottom: '100%', marginBottom: 5,
            [side]: 0, zIndex: 1, pointerEvents: 'none',
          }}>
            <SummaryPanel text={summary} isWide={isWide} isPhone={isPhone} flashKey={snapFlashKey} />
          </div>
        )}
        <Btn btn={bracket} title={snapDir === 'back' ? 'Previous snapshot (←)' : 'Next snapshot (→)'} disabled={snapDisabled} onBtn={onSnap} />
      </div>

      {/* Version section: << button, ver panel BELOW */}
      {showVer && (
        <div style={{ position: 'relative' }}>
          <Btn btn={bracketVer} title={snapDir === 'back' ? 'Previous version' : 'Next version'} disabled={verDisabled} onBtn={onVer} />
          {versionSummary && (
            <div style={{
              position: 'absolute', top: '100%', marginTop: 5,
              [side]: 0, zIndex: 1, pointerEvents: 'none',
            }}>
              <SummaryPanel text={versionSummary} isWide={isWide} isPhone={isPhone} flashKey={verFlashKey} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Git-style diff helpers ───────────────────────────────────────────────────
// Render a word-level diff as an inline annotated stream with collapsed context.
// Unchanged regions more than CONTEXT chars from a change collapse to a ··· separator.
// Context windows are trimmed to sentence boundaries where possible.
const DIFF_CONTEXT = 240  // characters of unchanged text to show around each change

function buildDiffNodes(ops: DiffOp[]): React.ReactNode[] {
  const n = ops.length
  if (!n) return []

  // Precompute: for each op, how many chars of 'same' text lie between it and the NEXT change
  const untilNext = new Array<number>(n).fill(Infinity)
  let acc = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (ops[i].type !== 'same') { acc = 0 }
    else { untilNext[i] = acc; acc = acc === Infinity ? ops[i].text.length : acc + ops[i].text.length }
  }

  // Whether any change lies after op i
  const anyChangeAfter = (() => {
    const a = new Array<boolean>(n).fill(false)
    let seen = false
    for (let i = n - 1; i >= 0; i--) { if (ops[i].type !== 'same') seen = true; a[i] = seen }
    return a
  })()

  const nodes: React.ReactNode[] = []
  let k = 0
  let charsSinceLast = Infinity  // chars of same since last change (Infinity = no change yet)
  let gapPending = false         // a ··· separator is queued but not yet flushed

  const flushGap = () => {
    if (!gapPending) return
    nodes.push(<span key={`g${k++}`} style={{
      display: 'block', textAlign: 'center', color: '#c4b5d8',
      padding: '2px 0', fontStyle: 'italic', fontSize: '0.8em', userSelect: 'none',
    }}>···</span>)
    gapPending = false
  }
  const emit = (text: string, style?: React.CSSProperties) => {
    if (!text) return
    flushGap()
    nodes.push(<span key={`t${k++}`} style={style}>{text}</span>)
  }

  for (let i = 0; i < n; i++) {
    const op = ops[i]
    if (op.type !== 'same') {
      charsSinceLast = 0
      if (op.type === 'del') {
        emit(op.text, {
          color: '#b91c1c', textDecoration: 'line-through',
          background: 'rgba(185,28,28,0.07)', borderRadius: 2,
        })
      } else {
        emit(op.text, {
          background: 'rgba(22,163,74,0.16)', color: '#166534', borderRadius: 2,
        })
      }
      continue
    }

    const t = op.text
    const len = t.length
    // How many chars to show from the head (proximity to previous change)
    const headLen = charsSinceLast === Infinity ? 0 : Math.max(0, DIFF_CONTEXT - charsSinceLast)
    // How many chars to show from the tail (proximity to next change)
    const tailLen = untilNext[i] === Infinity ? 0 : Math.max(0, DIFF_CONTEXT - untilNext[i])

    charsSinceLast = charsSinceLast === Infinity ? len : charsSinceLast + len

    if (headLen + tailLen >= len) {
      // Window covers the whole op — show entirely
      emit(t)
      continue
    }

    // Trim head: end at last sentence boundary within the head slice
    if (headLen > 0) {
      let head = t.slice(0, headLen)
      const sentEnd = head.search(/[.!?]\s*$/) // trim to last sentence end if near edge
      if (headLen < len && sentEnd > headLen * 0.4) head = head.slice(0, sentEnd + 1)
      emit(head.trimEnd())
    }

    // Trim tail: start at first sentence boundary within the tail slice
    if (tailLen > 0) {
      gapPending = true  // separator before tail
      let tail = t.slice(len - tailLen)
      const sentStart = tail.search(/(?<=[.!?]\s{1,3})[A-ZÀ-ž]/)
      if (sentStart > 0 && sentStart < tailLen * 0.6) tail = tail.slice(sentStart)
      else tail = tail.trimStart()
      emit(tail)
    } else if (anyChangeAfter[i]) {
      // Head only, more changes coming — add pending gap
      gapPending = true
    }
    // Trailing-only gap (no more changes) — intentionally omitted
  }

  return nodes
}

// ── InlineDiffView ────────────────────────────────────────────────────────────
// Right pane: git-style inline diff vs the immediately preceding snapshot.
function InlineDiffView({ snapshot, prevSnap }: { snapshot: Snapshot; prevSnap: Snapshot | null }) {
  const afterText  = useMemo(() => pmToText(snapshot.contentJson), [snapshot.id])
  const beforeText = useMemo(() => prevSnap ? pmToText(prevSnap.contentJson) : '', [prevSnap?.id])

  const ops = useMemo(
    () => prevSnap ? diffWords(beforeText, afterText) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prevSnap?.id, snapshot.id],
  )

  const { added, removed } = ops ? diffStats(ops) : { added: 0, removed: 0 }
  const hasChange = added > 0 || removed > 0
  const nodes = useMemo(() => ops && hasChange ? buildDiffNodes(ops) : [], [ops, hasChange])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
      {/* Diff header bar */}
      <div style={{
        flexShrink: 0,
        fontSize: '0.75rem', color: '#888',
        padding: '6px 16px',
        borderBottom: '1px solid rgba(92,45,138,0.08)',
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        background: 'rgba(249,247,244,0.98)',
      }}>
        {!prevSnap && <span style={{ fontStyle: 'italic' }}>Initial snapshot</span>}
        {prevSnap && !hasChange && <span style={{ fontStyle: 'italic' }}>No changes from previous snapshot</span>}
        {prevSnap && hasChange && (
          <>
            <span style={{ color: '#15803d', fontWeight: 500 }}>+{added}</span>
            <span style={{ color: '#b91c1c', fontWeight: 500 }}>−{removed}</span>
            <span>words vs previous</span>
          </>
        )}
      </div>

      {/* Diff body */}
      <div style={{
        flex: 1, overflow: 'auto',
        padding: '1.25rem 1.75rem',
        lineHeight: 1.8, fontSize: '1rem',
        whiteSpace: 'pre-wrap',
        fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif',
      }}>
        {!prevSnap && (
          <p style={{ color: '#aaa', fontStyle: 'italic', fontSize: '0.9rem' }}>
            No previous snapshot to compare against.
          </p>
        )}
        {prevSnap && !hasChange && (
          <p style={{ color: '#aaa', fontStyle: 'italic', fontSize: '0.9rem' }}>
            Content is identical to the previous snapshot.
          </p>
        )}
        {nodes}
      </div>
    </div>
  )
}

// ── SplitDiffView ─────────────────────────────────────────────────────────────
// Two-pane layout: left/top = clean snapshot, right/bottom = inline diff.
// Desktop: horizontal with draggable divider. Mobile/narrow: vertical stack.
function SplitDiffView({
  snapshot, prevSnap, isPhone, isNarrow,
}: {
  snapshot: Snapshot; prevSnap: Snapshot | null; isPhone: boolean; isNarrow: boolean
}) {
  const vertical = isPhone || isNarrow
  const [splitPct, setSplitPct] = useState(50)
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Unified pointer/touch drag handler
  const startDrag = useCallback((startX: number, startY: number) => {
    dragging.current = true
    const onMove = (x: number, y: number) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const raw = vertical
        ? ((y - rect.top) / rect.height) * 100
        : ((x - rect.left) / rect.width) * 100
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
    void startX; void startY  // unused but keep signature symmetric
  }, [vertical])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Left / top pane — clean document */}
      <div style={{
        [vertical ? 'height' : 'width']: `${splitPct}%`,
        overflow: 'auto',
        flexShrink: 0,
      }}>
        <Scroll phone={isPhone}>
          <div className="tiptap-editor ProseMirror">
            <DocView doc={snapshot.contentJson} />
          </div>
        </Scroll>
      </div>

      {/* Drag divider */}
      <div
        style={{
          [vertical ? 'height' : 'width']: 7,
          background: 'rgba(92,45,138,0.10)',
          cursor: vertical ? 'row-resize' : 'col-resize',
          flexShrink: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.12s',
          userSelect: 'none',
        }}
        onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY) }}
        onTouchStart={(e) => { e.preventDefault(); startDrag(e.touches[0].clientX, e.touches[0].clientY) }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,45,138,0.28)')}
        onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.background = 'rgba(92,45,138,0.10)' }}
        title="Drag to resize"
      >
        {/* Grip dots */}
        <div style={{
          display: 'flex',
          flexDirection: vertical ? 'row' : 'column',
          gap: 3,
          pointerEvents: 'none',
        }}>
          {[0,1,2].map(n => (
            <div key={n} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(92,45,138,0.4)' }} />
          ))}
        </div>
      </div>

      {/* Right / bottom pane — diff view */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        background: '#f9f7f4',
        borderLeft: vertical ? 'none' : '1px solid rgba(92,45,138,0.09)',
        borderTop: vertical ? '1px solid rgba(92,45,138,0.09)' : 'none',
      }}>
        <InlineDiffView snapshot={snapshot} prevSnap={prevSnap} />
      </div>
    </div>
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
  const [navDir, setNavDir] = useState<'back' | 'fwd'>('fwd')
  const [genSeed, setGenSeed] = useState(0)   // increment to force-regenerate all summaries
  const [isRegenerating, setIsRegenerating] = useState(false)
  // Flash counters: each increments only when that specific panel should pop open (1s)
  const [leftSnapFlash,  setLeftSnapFlash]  = useState(0)
  const [rightSnapFlash, setRightSnapFlash] = useState(0)
  const [leftVerFlash,   setLeftVerFlash]   = useState(0)
  const [rightVerFlash,  setRightVerFlash]  = useState(0)

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
  }, [docId, genSeed])

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

  // ── Touch swipe ──────────────────────────────────────────────────────────────
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) goFwd(); else goBack()
  }

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

  // AI summary side panels
  const currentGroup = groupIdx >= 0 ? groups[groupIdx] : null
  const currentDiff    = snapshot?.diffSummary?.bullets ?? null
  const currentVerDiff = currentGroup?.versionSnap?.versionSummary ?? null
  const leftSummary         = navDir === 'back' ? currentDiff    : null
  const rightSummary        = navDir === 'fwd'  ? currentDiff    : null
  const leftVersionSummary  = navDir === 'back' ? currentVerDiff : null
  const rightVersionSummary = navDir === 'fwd'  ? currentVerDiff : null

  return (
    // height:100dvh so the split pane fills the screen without page scroll
    <div
      className="font-serif"
      style={{ height: '100dvh', overflow: 'hidden', color: '#3a3a3a', display: 'flex', flexDirection: 'column' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Fixed header */}
      <div
        className="z-50 flex items-center gap-x-2 px-3 py-1.5 bg-white/95 backdrop-blur"
        style={{ position: 'fixed', top: 0, left: 0, right: 0, borderBottom: `1px solid ${INK}33`, fontSize: '0.82rem', height: 36 }}
      >
        <span style={{ color: INK, fontWeight: 500 }}>
          ◈ {snapshot
            ? `${versionLabel ? versionLabel + ' · ' : ''}${new Date(snapshot.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : 'Snapshot'} · read-only
        </span>

        {snapshot && (
          <span className="text-stone-400">
            {snapshot.wordCount}w
          </span>
        )}

        {allSnapshots.length > 1 && (
          <span className="text-stone-400 tabular-nums">
            {`v${groupIdx + 1}.${snapInGroup}/v${groups.length}.${lastGroup?.items.length ?? 1}`}
          </span>
        )}

        <span className="flex items-center gap-2 ml-auto flex-shrink-0">
          {allSnapshots.length > 1 && (
            <span className="text-stone-400 tabular-nums">
              {`s${idx + 1}/${allSnapshots.length}`}
            </span>
          )}
        </span>
        {docId && (
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
            className="flex-shrink-0 px-3 py-1 rounded-lg font-serif transition-colors"
            style={{
              fontSize: '0.85rem',
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
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex-shrink-0 px-3 py-1 rounded-lg font-serif transition-colors"
          style={{
            fontSize: '0.85rem',
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

      {/* Spacer for fixed header */}
      <div style={{ height: 36, flexShrink: 0 }} />

      {/* Split pane fills remaining viewport */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {status === 'loading' && <p className="text-center text-stone-400 mt-20">Loading…</p>}
        {status === 'missing' && (
          <p className="text-center text-stone-500 mt-20">
            That snapshot isn't on this device. Snapshots live in the browser where they were written.
          </p>
        )}
        {status === 'ready' && snapshot && (
          <SplitDiffView
            snapshot={snapshot}
            prevSnap={prevSnap}
            isPhone={isPhone}
            isNarrow={!isWide}
          />
        )}
      </div>

      {/* ── Side navigation ── */}
      {allSnapshots.length > 1 && status === 'ready' && (
        <>
          <NavSide
            side="left" snapDir="back"
            onSnap={goBack} snapDisabled={!canBack}
            onVer={goVerBack} verDisabled={!canVerBack}
            hasVersions={hasVersions} isPhone={isPhone} isWide={isWide}
            summary={leftSummary} versionSummary={leftVersionSummary}
            snapFlashKey={String(leftSnapFlash)} verFlashKey={String(leftVerFlash)}
          />
          <NavSide
            side="right" snapDir="fwd"
            onSnap={goFwd} snapDisabled={!canFwd}
            onVer={goVerFwd} verDisabled={!canVerFwd}
            hasVersions={hasVersions} isPhone={isPhone} isWide={isWide}
            summary={rightSummary} versionSummary={rightVersionSummary}
            snapFlashKey={String(rightSnapFlash)} verFlashKey={String(rightVerFlash)}
          />
        </>
      )}

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
