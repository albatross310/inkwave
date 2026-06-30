import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { InkwaveDocument, Snapshot } from '../types/document'
import { listSnapshots, groupByVersion } from '../provenance/snapshots'
import { loadDocument } from '../storage/opfs'
import { pmToText } from '../provenance/bundle'
import { diffWords, diffStats } from '../provenance/diff'
import { Scroll, isTouchDevice } from '../editor/Scroll'
import { DocView } from '../components/DocView'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'
const NAV_BG = 'rgba(140, 90, 200, 0.20)'
const NAV_BG_DIS = 'rgba(140, 90, 200, 0.06)'
const NAV_FG = 'rgba(92, 45, 138, 0.85)'
const NAV_FG_DIS = 'rgba(140, 90, 200, 0.25)'

interface DiffSummary { forward: string; backward: string }

async function fetchDiffSummary(before: string, after: string): Promise<DiffSummary | null> {
  try {
    const r = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ before, after }),
    })
    if (!r.ok) return null
    return await r.json() as DiffSummary
  } catch {
    return null
  }
}

// Read-only viewer for a past snapshot. Navigation:
//   ← / → buttons (+ keyboard / swipe) move between snapshots chronologically.
//   ⬆v / ⬇v buttons (desktop only, second square) jump between saved versions.
export function SnapshotView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const docId = params.get('doc')
  const snapId = params.get('snap')

  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([])
  const [current, setCurrent] = useState<InkwaveDocument | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!docId || !snapId) { setStatus('missing'); return }
    void (async () => {
      const [snaps, doc] = await Promise.all([listSnapshots(docId), loadDocument(docId)])
      if (cancelled) return
      setAllSnapshots(snaps)
      setCurrent(doc)
      setStatus(snaps.some((s) => s.id === snapId) ? 'ready' : 'missing')
    })()
    return () => { cancelled = true }
  }, [docId, snapId])

  const groups = useMemo(() => groupByVersion(allSnapshots), [allSnapshots])

  const idx = allSnapshots.findIndex((s) => s.id === snapId)
  const snapshot = idx >= 0 ? allSnapshots[idx] : null

  // Which version group is the current snapshot in?
  const groupIdx = groups.findIndex((g) => g.items.some((s) => s.id === snapId))

  const goTo = useCallback((s: Snapshot) => {
    navigate(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, { replace: true })
  }, [navigate])

  // Snapshot-level navigation (within all snapshots, chronological)
  const goBack  = useCallback(() => { if (idx > 0) goTo(allSnapshots[idx - 1]) }, [idx, allSnapshots, goTo])
  const goFwd   = useCallback(() => { if (idx < allSnapshots.length - 1) goTo(allSnapshots[idx + 1]) }, [idx, allSnapshots, goTo])

  // Version-level navigation (jump to first item of prev/next version group)
  const goVerBack = useCallback(() => {
    if (groupIdx > 0) goTo(groups[groupIdx - 1].items[0])
  }, [groupIdx, groups, goTo])
  const goVerFwd = useCallback(() => {
    if (groupIdx >= 0 && groupIdx < groups.length - 1) goTo(groups[groupIdx + 1].items[0])
  }, [groupIdx, groups, goTo])

  const canBack    = idx > 0
  const canFwd     = idx >= 0 && idx < allSnapshots.length - 1
  const canVerBack = groupIdx > 0
  const canVerFwd  = groupIdx >= 0 && groupIdx < groups.length - 1
  const hasVersions = groups.some((g) => g.versionSnap !== null)

  // ── Keyboard ← / → (snapshot) ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack() }
      if (e.key === 'ArrowRight') { e.preventDefault(); goFwd() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, goFwd])

  // ── Touch swipe (snapshot) ───────────────────────────────────────────────────
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

  const ops = useMemo(() => {
    if (!snapshot || !current) return null
    return diffWords(pmToText(snapshot.contentJson), pmToText(current.contentJson))
  }, [snapshot, current])
  const stats = ops ? diffStats(ops) : null
  const isCurrent = stats ? stats.added === 0 && stats.removed === 0 : false

  const isPhone = isTouchDevice()
  const versionLabel = groupIdx >= 0 ? groups[groupIdx].label || 'draft' : ''
  const posLabel = allSnapshots.length > 1 ? `${idx + 1} / ${allSnapshots.length}` : null

  // ── Diff summaries ────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState<DiffSummary | null>(null)
  const summaryKey = useRef('')
  useEffect(() => {
    if (idx <= 0 || !snapshot) { setSummary(null); return }
    const prev = allSnapshots[idx - 1]
    const key = `${prev.id}→${snapshot.id}`
    if (summaryKey.current === key) return
    summaryKey.current = key
    setSummary(null)
    const before = pmToText(prev.contentJson)
    const after = pmToText(snapshot.contentJson)
    if (!before.trim() && !after.trim()) return
    void fetchDiffSummary(before, after).then((s) => {
      if (summaryKey.current === key) setSummary(s)
    })
  }, [idx, snapshot, allSnapshots])

  // ── Floating nav squares ─────────────────────────────────────────────────────
  // Purple/greyish-purple background. Labels: <s / s> for snapshot, <<v / v>> for version.
  const squareBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 44, height: 44, borderRadius: 10,
    background: NAV_BG,
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    border: '1px solid rgba(140,90,200,0.25)',
    color: NAV_FG,
    cursor: 'pointer',
    transition: 'background 0.15s',
    userSelect: 'none',
  }
  const squareDisabled: React.CSSProperties = {
    ...squareBase,
    background: NAV_BG_DIS,
    color: NAV_FG_DIS,
    cursor: 'default',
    border: '1px solid rgba(140,90,200,0.10)',
  }

  // Arrow label content: angle brackets + small letter inside
  const ArrowLabel = ({ dir, type }: { dir: 'back' | 'fwd'; type: 'snap' | 'ver' }) => {
    const brackets = type === 'ver'
      ? (dir === 'back' ? '<<' : '>>')
      : (dir === 'back' ? '<' : '>')
    const letter = type === 'snap' ? 's' : 'v'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, gap: 1 }}>
        {dir === 'back' && <span style={{ fontSize: '1.05rem', letterSpacing: type === 'ver' ? '-0.12em' : undefined }}>{brackets}</span>}
        <span style={{ fontSize: '0.58rem', color: 'inherit', opacity: 0.8 }}>{letter}</span>
        {dir === 'fwd' && <span style={{ fontSize: '1.05rem', letterSpacing: type === 'ver' ? '-0.12em' : undefined }}>{brackets}</span>}
      </span>
    )
  }

  const NavSquare = ({ dir, type, onClick, disabled, title }: {
    dir: 'back' | 'fwd'; type: 'snap' | 'ver';
    onClick: () => void; disabled: boolean; title: string
  }) => (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      style={disabled ? squareDisabled : squareBase}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(140,90,200,0.35)' }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = NAV_BG }}
    >
      <ArrowLabel dir={dir} type={type} />
    </button>
  )

  const summaryBoxStyle: React.CSSProperties = {
    background: 'rgba(140, 90, 200, 0.12)',
    border: '1px solid rgba(140, 90, 200, 0.22)',
    borderRadius: 8,
    padding: '5px 8px',
    fontSize: '0.63rem',
    lineHeight: 1.45,
    color: INK,
    maxWidth: 140,
    pointerEvents: 'none',
    marginBottom: 6,
  }

  const floatSide = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'fixed',
    [side]: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 45,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: side === 'left' ? 'flex-start' : 'flex-end',
    pointerEvents: 'none', // container is pass-through; buttons below re-enable
  })

  return (
    <div
      className="min-h-screen font-serif"
      style={{ color: '#3a3a3a' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Sticky read-only banner */}
      <div
        className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-white/95 backdrop-blur text-sm"
        style={{ borderBottom: `1px solid ${INK}33` }}
      >
        <span style={{ color: INK }}>
          ◈ {snapshot
            ? `${versionLabel ? versionLabel + ' · ' : ''}${new Date(snapshot.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : 'Snapshot'} · read-only
        </span>

        {snapshot && (
          <span className="text-stone-400 text-xs">
            {snapshot.wordCount}w
            {snapshot.summary && <> · <em>{snapshot.summary}</em></>}
            {' · '}{snapshot.ots.status}
          </span>
        )}

        {posLabel && (
          <span className="text-stone-400 text-xs tabular-nums">{posLabel}</span>
        )}

        {status === 'ready' && current && (
          <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none ml-auto flex-shrink-0">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[#5c2d8a]" />
            Changes since here
          </label>
        )}
        <Link to="/" className="text-xs underline flex-shrink-0" style={{ color: LIGHT }}>← editor</Link>
      </div>

      {status === 'loading' && <p className="text-center text-stone-400 mt-20">Loading…</p>}
      {status === 'missing' && (
        <p className="text-center text-stone-500 mt-20">
          That snapshot isn't on this device. Snapshots live in the browser where they were written.
        </p>
      )}

      {status === 'ready' && snapshot && (
        <Scroll phone={isPhone}>
          {showDiff && ops ? (
            <div>
              <p className="text-xs text-stone-400 mb-3">
                {isCurrent ? 'No changes — this matches the current document.' : (
                  <>changes → now: <span style={{ color: '#246b24' }}>+{stats!.added}</span>{' '}
                  <span style={{ color: '#9b2226' }}>−{stats!.removed}</span> words</>
                )}
              </p>
              <div className="tiptap-editor ProseMirror" style={{ whiteSpace: 'pre-wrap' }}>
                {ops.map((op, i) =>
                  op.type === 'same' ? <span key={i}>{op.text}</span>
                  : op.type === 'add' ? <span key={i} style={{ background: '#dcf5dc', color: '#1f5f1f' }}>{op.text}</span>
                  : <span key={i} style={{ color: '#9b2226', textDecoration: 'line-through' }}>{op.text}</span>,
                )}
              </div>
            </div>
          ) : (
            <div className="tiptap-editor ProseMirror">
              <DocView doc={snapshot.contentJson} />
            </div>
          )}
        </Scroll>
      )}

      {/* ── Floating navigation squares ── */}
      {allSnapshots.length > 1 && status === 'ready' && (
        <>
          {/* Left side — goes backward (older) */}
          <div style={floatSide('left')}>
            {!isPhone && hasVersions && (
              <div style={{ pointerEvents: 'auto' }}>
                <NavSquare dir="back" type="ver" onClick={goVerBack} disabled={!canVerBack} title="Previous version" />
              </div>
            )}
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column' }}>
              {/* Summary for going backward (not-yet tense) — above the back arrow */}
              {summary?.backward && canBack && (
                <div style={summaryBoxStyle}>{summary.backward}</div>
              )}
              <NavSquare dir="back" type="snap" onClick={goBack} disabled={!canBack} title="Previous snapshot (←)" />
            </div>
          </div>

          {/* Right side — goes forward (newer) */}
          <div style={floatSide('right')}>
            {!isPhone && hasVersions && (
              <div style={{ pointerEvents: 'auto' }}>
                <NavSquare dir="fwd" type="ver" onClick={goVerFwd} disabled={!canVerFwd} title="Next version" />
              </div>
            )}
            <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {/* Summary for going forward (past tense) — above the forward arrow */}
              {summary?.forward && canFwd && (
                <div style={{ ...summaryBoxStyle, textAlign: 'right' }}>{summary.forward}</div>
              )}
              <NavSquare dir="fwd" type="snap" onClick={goFwd} disabled={!canFwd} title="Next snapshot (→)" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
