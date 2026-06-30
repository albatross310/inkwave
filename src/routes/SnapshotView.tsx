import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '../types/document'
import { listSnapshots, groupByVersion, patchSnapshotDiffSummary, patchSnapshotVersionSummary, clearAllSnapshotSummaries } from '../provenance/snapshots'
import { pmToText } from '../provenance/bundle'
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

// ── Dual diff renderer ────────────────────────────────────────────────────────
// Snapshot-level changes (dark green/red) overlaid on version-level changes (light green).
// snapRef: the adjacent snapshot (direction-sensitive) — dark highlights
// verRef:  the previous version's base snapshot — light green highlights where text is new
function DualDiffView({
  snapshot, snapRef, verRef,
}: {
  snapshot: Snapshot
  snapRef: Snapshot | null
  verRef: Snapshot | null
}) {
  const currentText = pmToText(snapshot.contentJson)

  const snapOps = useMemo(
    () => snapRef ? diffWords(pmToText(snapRef.contentJson), currentText) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapRef?.id, snapshot.id, currentText],
  )

  const verAdded = useMemo(() => {
    if (!verRef) return null
    const ops = diffWords(pmToText(verRef.contentJson), currentText)
    const s = new Set<number>()
    let p = 0
    for (const op of ops) {
      if (op.type === 'add') {
        for (let i = 0; i < op.text.length; i++) s.add(p + i)
        p += op.text.length
      } else if (op.type === 'same') {
        p += op.text.length
      }
    }
    return s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verRef?.id, snapshot.id, currentText])

  const { added: snapAdded, removed: snapRemoved } = snapOps ? diffStats(snapOps) : { added: 0, removed: 0 }
  const noChange = snapRef && snapAdded === 0 && snapRemoved === 0

  const nodes: React.ReactNode[] = []
  const ops = snapOps ?? []
  let pos = 0

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === 'del') {
      nodes.push(<span key={k} style={{ color: '#9b2226', textDecoration: 'line-through' }}>{op.text}</span>)
    } else if (op.type === 'add') {
      nodes.push(<span key={k} style={{ background: '#b0e8b0', color: '#1a5f1a' }}>{op.text}</span>)
      pos += op.text.length
    } else {
      // 'same' at snapshot level — subdivide by version-added status
      const text = op.text
      if (!verAdded) {
        nodes.push(<span key={k}>{text}</span>)
        pos += text.length
      } else {
        let segStart = 0
        for (let j = 0; j < text.length; j++) {
          const isNew = verAdded.has(pos + j)
          const nextIsNew = j + 1 < text.length ? verAdded.has(pos + j + 1) : !isNew
          if (nextIsNew !== isNew) {
            const seg = text.slice(segStart, j + 1)
            nodes.push(
              <span key={`${k}-${segStart}`} style={isNew ? { background: '#e0f4e0', color: '#2a6a2a' } : undefined}>
                {seg}
              </span>
            )
            segStart = j + 1
          }
        }
        if (segStart < text.length) {
          const seg = text.slice(segStart)
          const isNew = segStart < text.length && verAdded.has(pos + segStart)
          nodes.push(
            <span key={`${k}-${segStart}f`} style={isNew ? { background: '#e0f4e0', color: '#2a6a2a' } : undefined}>
              {seg}
            </span>
          )
        }
        pos += text.length
      }
    }
  }

  return (
    <>
      {snapRef && (
        <p className="text-xs text-stone-400 mb-3">
          {noChange
            ? 'No changes from previous snapshot.'
            : <>vs prev: <span style={{ color: '#1a5f1a' }}>+{snapAdded}</span>{' '}
              <span style={{ color: '#9b2226' }}>−{snapRemoved}</span> words
              {verRef && <span style={{ color: '#888', marginLeft: 8 }}>· <span style={{ background: '#e0f4e0', color: '#2a6a2a', padding: '0 2px', borderRadius: 2 }}>light</span> = new this version</span>}</>
          }
        </p>
      )}
      <div className="tiptap-editor ProseMirror" style={{ whiteSpace: 'pre-wrap' }}>
        {nodes.length > 0 ? nodes : <DocView doc={snapshot.contentJson} />}
      </div>
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
  const [showDiff, setShowDiff] = useState(true)
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

  // Direction-sensitive diff reference: the snapshot we just navigated away from
  const snapRefIdx = navDir === 'back' ? idx + 1 : idx - 1
  const snapRef = snapRefIdx >= 0 && snapRefIdx < allSnapshots.length ? allSnapshots[snapRefIdx] : null

  // Version-level ref: previous version group's base snapshot
  const prevGroupIdx = groupIdx > 0 ? groupIdx - 1 : -1
  const verRef = prevGroupIdx >= 0
    ? (groups[prevGroupIdx].versionSnap ?? groups[prevGroupIdx].items[0] ?? null)
    : null

  // Snapshot diff summaries (bullet points)
  const leftSummary  = snapshot?.diffSummary?.bullets ?? null
  const rightSummary = (idx >= 0 && idx < allSnapshots.length - 1)
    ? allSnapshots[idx + 1]?.diffSummary?.bullets ?? null
    : null

  // Version summaries: each versionSnap stores what changed vs. the previous version
  const currentGroup = groupIdx >= 0 ? groups[groupIdx] : null
  const nextGroup    = groupIdx >= 0 && groupIdx < groups.length - 1 ? groups[groupIdx + 1] : null
  // Left side shows the current version's summary (what was added vs. prev version — what you'd leave behind going back)
  const leftVersionSummary  = currentGroup?.versionSnap?.versionSummary ?? null
  // Right side shows the next version's summary (what was added vs. current version — what you'd gain going forward)
  const rightVersionSummary = nextGroup?.versionSnap?.versionSummary ?? null

  return (
    <div
      className="min-h-screen font-serif"
      style={{ color: '#3a3a3a' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Fixed header — position:fixed so overscroll / rubber-band at page top doesn't move it */}
      <div
        className="z-50 flex items-center gap-x-2 px-3 py-1.5 bg-white/95 backdrop-blur"
        style={{ position: 'fixed', top: 0, left: 0, right: 0, borderBottom: `1px solid ${INK}33`, fontSize: '0.82rem' }}
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
          {status === 'ready' && (
            <label className="flex items-center gap-1 text-stone-500 cursor-pointer select-none">
              <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[#5c2d8a]" />
              Show changes
            </label>
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

      {/* Spacer to clear the fixed header */}
      <div style={{ height: 36 }} />

      {status === 'loading' && <p className="text-center text-stone-400 mt-20">Loading…</p>}
      {status === 'missing' && (
        <p className="text-center text-stone-500 mt-20">
          That snapshot isn't on this device. Snapshots live in the browser where they were written.
        </p>
      )}

      {status === 'ready' && snapshot && (
        <Scroll phone={isPhone}>
          {showDiff ? (
            <DualDiffView snapshot={snapshot} snapRef={snapRef} verRef={verRef} />
          ) : (
            <div className="tiptap-editor ProseMirror">
              <DocView doc={snapshot.contentJson} />
            </div>
          )}
        </Scroll>
      )}

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
        onClick={() => navigate('/verify')}
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
