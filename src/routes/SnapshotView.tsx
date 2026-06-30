import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '../types/document'
import { listSnapshots, groupByVersion, patchSnapshotDiffSummary, patchSnapshotVersionSummary } from '../provenance/snapshots'
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

// ── Summary box ──────────────────────────────────────────────────────────────
// Opaque purple background. Collapses to a thin strip on narrow screens; hover expands.
// Renders lines starting with • as a proper bullet list.
function SummaryBox({ text, align, isWide }: { text: string; align: 'left' | 'right'; isWide: boolean }) {
  const [hovered, setHovered] = useState(false)
  const expanded = isWide || hovered
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#ede5f7',
        border: '1px solid rgba(92, 45, 138, 0.25)',
        borderRadius: 8,
        padding: expanded ? '7px 10px' : '0 10px',
        fontSize: '0.8rem',
        lineHeight: 1.5,
        color: INK,
        maxWidth: 170,
        maxHeight: expanded ? '240px' : '6px',
        overflow: 'hidden',
        cursor: expanded ? 'default' : 'pointer',
        transition: 'max-height 200ms ease, padding 200ms ease',
        marginBottom: 6,
        userSelect: 'none',
        textAlign: align,
        zIndex: 46,
        position: 'relative',
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          {line.startsWith('•') ? (
            <><span style={{ flexShrink: 0 }}>•</span><span>{line.slice(1).trim()}</span></>
          ) : <span>{line}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Nav side: thin bar (narrow/phone) or floating squares (wide) ─────────────
// Wide (≥1024px): floating squares at a fixed offset, summary boxes above each button.
// Narrow/phone: a tall thin purple strip flush at the edge; hover (desktop) or tap (phone)
// expands it to reveal the buttons. No s/v labels anywhere.
function NavSide({
  side, snapDir,
  onSnap, snapDisabled,
  onVer, verDisabled,
  hasVersions, isPhone, isWide,
  summary, versionSummary,
}: {
  side: 'left' | 'right'
  snapDir: 'back' | 'fwd'
  onSnap: () => void; snapDisabled: boolean
  onVer: () => void;  verDisabled: boolean
  hasVersions: boolean; isPhone: boolean; isWide: boolean
  summary: string | null
  versionSummary: string | null
}) {
  const [open, setOpen] = useState(false)

  const bracket      = snapDir === 'back' ? '<'  : '>'
  const bracketVer   = snapDir === 'back' ? '<<' : '>>'
  const btnSize      = isPhone ? 34 : 44
  const showVer      = hasVersions && !isPhone

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

  // ── Wide: floating squares with summary boxes above each button ──────────
  if (isWide) {
    const align = side
    return (
      <div style={{
        position: 'fixed', [side]: 10, top: '50%', transform: 'translateY(-50%)',
        zIndex: 45, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
        alignItems: side === 'left' ? 'flex-start' : 'flex-end',
      }}>
        {showVer && (
          <div style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
            alignItems: side === 'right' ? 'flex-end' : 'flex-start' }}>
            {versionSummary && !verDisabled && (
              <SummaryBox text={versionSummary} align={align} isWide={isWide} />
            )}
            <button type="button" style={btnStyle(verDisabled)}
              onClick={verDisabled ? undefined : onVer}
              onMouseEnter={e => { if (!verDisabled) (e.currentTarget as HTMLElement).style.background = 'rgba(140,90,200,0.35)' }}
              onMouseLeave={e => { if (!verDisabled) (e.currentTarget as HTMLElement).style.background = NAV_BG }}
              title={snapDir === 'back' ? 'Previous version' : 'Next version'}
            >{bracketVer}</button>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
          alignItems: side === 'right' ? 'flex-end' : 'flex-start' }}>
          {summary && !snapDisabled && <SummaryBox text={summary} align={align} isWide={isWide} />}
          <button type="button" style={btnStyle(snapDisabled)}
            onClick={snapDisabled ? undefined : onSnap}
            onMouseEnter={e => { if (!snapDisabled) (e.currentTarget as HTMLElement).style.background = 'rgba(140,90,200,0.35)' }}
            onMouseLeave={e => { if (!snapDisabled) (e.currentTarget as HTMLElement).style.background = NAV_BG }}
            title={snapDir === 'back' ? 'Previous snapshot (←)' : 'Next snapshot (→)'}
          >{bracket}</button>
        </div>
      </div>
    )
  }

  // ── Narrow / phone: thin bar that expands on hover/tap ───────────────────
  const STRIP = 6
  const expandedW = btnSize + 14
  const numButtons = (showVer ? 2 : 1)
  const stripH = numButtons * (btnSize + 8) + 20
  const radius = side === 'left' ? '0 10px 10px 0' : '10px 0 0 10px'

  return (
    <div
      style={{ position: 'fixed', [side]: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 45 }}
      onMouseEnter={() => !isPhone && setOpen(true)}
      onMouseLeave={() => !isPhone && setOpen(false)}
    >
      <div style={{
        width: open ? expandedW : STRIP,
        minHeight: stripH,
        overflow: 'hidden',
        transition: 'width 220ms ease',
        background: 'rgba(140, 90, 200, 0.22)',
        borderRadius: radius,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: open ? '7px' : 0,
        cursor: open ? 'default' : 'pointer',
        pointerEvents: 'auto',
      }}
        onClick={() => isPhone && !open && setOpen(true)}
      >
        {showVer && (
          <button type="button"
            style={{ ...btnStyle(verDisabled), opacity: open ? 1 : 0, transition: 'opacity 150ms ease' }}
            onClick={(e) => { e.stopPropagation(); if (!verDisabled) { onVer(); if (isPhone) setOpen(false) } }}
            title={snapDir === 'back' ? 'Previous version' : 'Next version'}
          >{bracketVer}</button>
        )}
        <button type="button"
          style={{ ...btnStyle(snapDisabled), opacity: open ? 1 : 0, transition: 'opacity 150ms ease' }}
          onClick={(e) => { e.stopPropagation(); if (!snapDisabled) { onSnap(); if (isPhone) setOpen(false) } }}
          title={snapDir === 'back' ? 'Previous snapshot (←)' : 'Next snapshot (→)'}
        >{bracket}</button>
      </div>
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
  // Track which direction the user navigated last — determines which adjacent snapshot is the diff ref.
  const [navDir, setNavDir] = useState<'back' | 'fwd'>('fwd')

  useEffect(() => {
    let cancelled = false
    if (!docId || !snapId) { setStatus('missing'); return }
    void (async () => {
      const snaps = await listSnapshots(docId)
      if (cancelled) return
      setAllSnapshots(snaps)
      setStatus(snaps.some((s) => s.id === snapId) ? 'ready' : 'missing')

      // Background: prerender all adjacent-pair diff summaries (bullets)
      if (!cancelled && snaps.length > 1) {
        void (async () => {
          for (let i = 1; i < snaps.length; i++) {
            if (cancelled) break
            if (snaps[i].diffSummary) continue
            const before = pmToText(snaps[i - 1].contentJson)
            const after  = pmToText(snaps[i].contentJson)
            if (!before.trim() && !after.trim()) continue
            const ds = await summariseDiff(before, after)
            if (ds && !cancelled) {
              await patchSnapshotDiffSummary(docId!, snaps[i].id, ds)
              setAllSnapshots((prev) => prev.map((s, j) => j === i ? { ...s, diffSummary: ds } : s))
            }
          }
        })()
      }

      // Background: prerender version summaries (compare versionSnap to prev versionSnap)
      if (!cancelled && snaps.length > 1) {
        void (async () => {
          const grps = groupByVersion(snaps)
          const verSnaps = grps.map((g) => g.versionSnap).filter(Boolean) as Snapshot[]
          for (let i = 1; i < verSnaps.length; i++) {
            if (cancelled) break
            const vs = verSnaps[i]
            if (vs.versionSummary) continue
            const vs2 = await summariseVersionDiff(
              pmToText(verSnaps[i - 1].contentJson),
              pmToText(vs.contentJson),
            )
            if (vs2 && !cancelled) {
              await patchSnapshotVersionSummary(docId!, vs.id, vs2)
              setAllSnapshots((prev) => prev.map((s) => s.id === vs.id ? { ...s, versionSummary: vs2 } : s))
            }
          }
        })()
      }
    })()
    return () => { cancelled = true }
  }, [docId, snapId])

  const groups = useMemo(() => groupByVersion(allSnapshots), [allSnapshots])

  const idx      = allSnapshots.findIndex((s) => s.id === snapId)
  const snapshot = idx >= 0 ? allSnapshots[idx] : null
  const groupIdx = groups.findIndex((g) => g.items.some((s) => s.id === snapId))

  const goTo = useCallback((s: Snapshot) => {
    navigate(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, { replace: true })
  }, [navigate])

  const goBack  = useCallback(() => { if (idx > 0) { setNavDir('back'); goTo(allSnapshots[idx - 1]) } }, [idx, allSnapshots, goTo])
  const goFwd   = useCallback(() => { if (idx < allSnapshots.length - 1) { setNavDir('fwd'); goTo(allSnapshots[idx + 1]) } }, [idx, allSnapshots, goTo])
  const goVerBack = useCallback(() => { if (groupIdx > 0) { setNavDir('back'); goTo(groups[groupIdx - 1].items[0]) } }, [groupIdx, groups, goTo])
  const goVerFwd  = useCallback(() => { if (groupIdx >= 0 && groupIdx < groups.length - 1) { setNavDir('fwd'); goTo(groups[groupIdx + 1].items[0]) } }, [groupIdx, groups, goTo])

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

  // "2.3/4.7 (6/19)" = version 2, snapshot 3 within it / version 4 total, last has 7 snaps (6 of 19 overall)
  const snapInGroup = groupIdx >= 0
    ? groups[groupIdx].items.findIndex((s) => s.id === snapId) + 1
    : 0
  const lastGroup = groups[groups.length - 1]
  const posLabel = allSnapshots.length > 1
    ? `${groupIdx + 1}.${snapInGroup} / ${groups.length}.${lastGroup?.items.length ?? 1} (${idx + 1}/${allSnapshots.length})`
    : null

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
      {/* Sticky header */}
      <div
        className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-white/95 backdrop-blur"
        style={{ borderBottom: `1px solid ${INK}33`, fontSize: '0.95rem' }}
      >
        <span style={{ color: INK, fontWeight: 500 }}>
          ◈ {snapshot
            ? `${versionLabel ? versionLabel + ' · ' : ''}${new Date(snapshot.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : 'Snapshot'} · read-only
        </span>

        {snapshot && (
          <span className="text-stone-400" style={{ fontSize: '0.85rem' }}>
            {snapshot.wordCount}w
            {snapshot.summary && <> · <em>{snapshot.summary}</em></>}
            {' · '}{snapshot.ots.status}
          </span>
        )}

        {posLabel && (
          <span className="text-stone-400 tabular-nums" style={{ fontSize: '0.85rem' }}>{posLabel}</span>
        )}

        {status === 'ready' && (
          <label className="flex items-center gap-1.5 text-stone-500 cursor-pointer select-none ml-auto flex-shrink-0" style={{ fontSize: '0.85rem' }}>
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} className="accent-[#5c2d8a]" />
            Show changes
          </label>
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
          />
          <NavSide
            side="right" snapDir="fwd"
            onSnap={goFwd} snapDisabled={!canFwd}
            onVer={goVerFwd} verDisabled={!canVerFwd}
            hasVersions={hasVersions} isPhone={isPhone} isWide={isWide}
            summary={rightSummary} versionSummary={rightVersionSummary}
          />
        </>
      )}
    </div>
  )
}
