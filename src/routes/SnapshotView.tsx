import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { InkwaveDocument, Snapshot } from '../types/document'
import { listSnapshots } from '../provenance/snapshots'
import { loadDocument } from '../storage/opfs'
import { pmToText } from '../provenance/bundle'
import { diffWords, diffStats } from '../provenance/diff'
import { Scroll, isTouchDevice } from '../editor/Scroll'
import { DocView } from '../components/DocView'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

// Read-only viewer for a single past snapshot. Opens from the record panel
// (?doc=<id>&snap=<id>). Arrow keys ← / → (or swipe) move through chronological order.
// ⟨⟨ / ⟩⟩ buttons jump to the oldest / newest snapshot.
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

  const idx = allSnapshots.findIndex((s) => s.id === snapId)
  const snapshot = idx >= 0 ? allSnapshots[idx] : null

  const goTo = useCallback((s: Snapshot) => {
    navigate(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, { replace: true })
  }, [navigate])

  const goBack  = useCallback(() => { if (idx > 0) goTo(allSnapshots[idx - 1]) }, [idx, allSnapshots, goTo])
  const goFwd   = useCallback(() => { if (idx < allSnapshots.length - 1) goTo(allSnapshots[idx + 1]) }, [idx, allSnapshots, goTo])
  const goFirst = useCallback(() => { if (allSnapshots.length) goTo(allSnapshots[0]) }, [allSnapshots, goTo])
  const goLast  = useCallback(() => { if (allSnapshots.length) goTo(allSnapshots[allSnapshots.length - 1]) }, [allSnapshots, goTo])

  // ── Keyboard ← / → navigation ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack() }
      if (e.key === 'ArrowRight') { e.preventDefault(); goFwd() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, goFwd])

  // ── Touch swipe ← / → ────────────────────────────────────────────────────────
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return // too small or mostly vertical
    if (dx < 0) goFwd()  // swipe left → newer
    else goBack()         // swipe right → older
  }

  const ops = useMemo(() => {
    if (!snapshot || !current) return null
    return diffWords(pmToText(snapshot.contentJson), pmToText(current.contentJson))
  }, [snapshot, current])
  const stats = ops ? diffStats(ops) : null
  const isCurrent = stats ? stats.added === 0 && stats.removed === 0 : false

  const canBack  = idx > 0
  const canFwd   = idx >= 0 && idx < allSnapshots.length - 1
  const navLabel = allSnapshots.length > 1 ? `${idx + 1} / ${allSnapshots.length}` : null

  const navBtn = (label: string, onClick: () => void, disabled: boolean, title: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '2px 8px', borderRadius: 6, border: `1px solid ${INK}44`,
        background: disabled ? 'transparent' : 'white',
        color: disabled ? '#d4cbc8' : INK,
        fontSize: '0.8rem', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="min-h-screen font-serif"
      style={{ color: '#3a3a3a' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Read-only banner */}
      <div
        className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-white/95 backdrop-blur text-sm"
        style={{ borderBottom: `1px solid ${INK}33` }}
      >
        <span style={{ color: INK }}>
          ◈ {snapshot
            ? `Snapshot · ${new Date(snapshot.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
            : 'Snapshot'} · read-only
        </span>

        {snapshot && (
          <span className="text-stone-400 text-xs">
            {snapshot.wordCount}w
            {snapshot.summary && <> · <em>{snapshot.summary}</em></>}
            {' · '}{snapshot.ots.status}
          </span>
        )}

        {/* Navigation controls */}
        {allSnapshots.length > 1 && (
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            {navBtn('⟨⟨', goFirst, !canBack, 'Oldest snapshot')}
            {navBtn('←',  goBack,  !canBack, 'Previous snapshot (←)')}
            {navLabel && <span className="text-stone-400 text-xs tabular-nums px-1">{navLabel}</span>}
            {navBtn('→',  goFwd,   !canFwd,  'Next snapshot (→)')}
            {navBtn('⟩⟩', goLast,  !canFwd,  'Newest snapshot')}
          </div>
        )}

        {status === 'ready' && current && (
          <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none flex-shrink-0">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[#5c2d8a]" />
            Changes since this version
          </label>
        )}
        <Link to="/" className="text-xs underline flex-shrink-0" style={{ color: LIGHT }}>← editor</Link>
      </div>

      {/* Swipe hint for mobile */}
      {isTouchDevice() && allSnapshots.length > 1 && status === 'ready' && (
        <div className="text-center text-xs text-stone-400 py-1.5" style={{ borderBottom: `1px solid ${INK}11` }}>
          Swipe left / right to navigate snapshots
        </div>
      )}

      {status === 'loading' && <p className="text-center text-stone-400 mt-20">Loading…</p>}
      {status === 'missing' && (
        <p className="text-center text-stone-500 mt-20">
          That snapshot isn't on this device. Snapshots live in the browser where they were written.
        </p>
      )}

      {status === 'ready' && snapshot && (
        <Scroll phone={isTouchDevice()}>
          {showDiff && ops ? (
            <div>
              <p className="text-xs text-stone-400 mb-3">
                {isCurrent ? 'No changes — this matches the current document.' : (
                  <>changes from this snapshot → now: <span style={{ color: '#246b24' }}>+{stats!.added}</span>{' '}
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
    </div>
  )
}
