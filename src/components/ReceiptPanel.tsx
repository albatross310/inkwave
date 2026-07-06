import { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../types/document'
import { groupByVersion, type SnapshotGroup } from '../provenance/snapshots'
import { useZoomScale } from '../editor/useZoomScale'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

// ── Bitcoin coin icon ─────────────────────────────────────────────────────────
function BitcoinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 22 22"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.18em', flexShrink: 0 }}
    >
      {/* Dark-gold coin */}
      <circle cx="11" cy="11" r="10" fill="#B8860B" />
      <circle cx="11" cy="11" r="10" fill="none" stroke="#7A5800" strokeWidth="2" />
      {/* Vertical bar of the B */}
      <rect x="6.5" y="4" width="2.8" height="14" rx="0.7" fill="white" />
      {/* Top bump (D-shape) */}
      <path d="M9 4 h3.5 a3.3 3.3 0 0 1 0 6.6 h-3.5 z" fill="white" />
      {/* Bottom bump (slightly wider) */}
      <path d="M9 10.6 h4 a3.7 3.7 0 0 1 0 7.4 h-4 z" fill="white" />
      {/* Top double-tick marks */}
      <rect x="7" y="2.2" width="1.4" height="2" rx="0.4" fill="white" />
      <rect x="9.8" y="2.2" width="1.4" height="2" rx="0.4" fill="white" />
      {/* Bottom double-tick marks */}
      <rect x="7" y="17.8" width="1.4" height="2" rx="0.4" fill="white" />
      <rect x="9.8" y="17.8" width="1.4" height="2" rx="0.4" fill="white" />
    </svg>
  )
}

// ── Time-of-day period label with date ────────────────────────────────────────
function getShortPeriod(createdAt: string): string {
  const d = new Date(createdAt)
  const h = d.getHours()
  const p = h >= 5 && h < 8 ? 'E. Morn.'
    : h >= 8 && h < 12 ? 'Morn.'
    : h >= 12 && h < 17 ? 'Arvo.'
    : h >= 17 && h < 20 ? 'Eve.'
    : 'Night.'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${p} ${dd}/${mm}`
}

// ── Version + snapshot-within-version label ───────────────────────────────────
function computeVersionLabel(snap: Snapshot, groups: SnapshotGroup[]): string {
  for (const group of groups) {
    const i = group.items.findIndex(s => s.id === snap.id)
    if (i >= 0) return group.label ? `${group.label}.${i + 1}` : `0.${i + 1}`
  }
  return ''
}

export function ReceiptPanel({
  snapshots,
  onCheckBitcoin,
  onSaveVersion,
  receiptCount = 0,
  chainStatus,
  onVerifyChain,
  wordCount,
  compact,
  open: externalOpen,
  onOpenChange,
  onOpened,
  hideTrigger,
}: {
  snapshots: Snapshot[]
  onCheckBitcoin?: () => void
  onSaveVersion?: () => void
  receiptCount?: number
  chainStatus?: string | null
  onVerifyChain?: () => void
  wordCount?: number
  compact?: boolean
  open?: boolean
  onOpenChange?: (v: boolean) => void
  onOpened?: () => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }
  // Fire the (throttled) OTS sweep only when the panel actually opens — keeps it off the load path.
  useEffect(() => { if (open) onOpened?.() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false)
  const [toastPhase, setToastPhase] = useState<'hidden' | 'show' | 'fade'>('hidden')
  const toastTimers = useRef<{ show?: ReturnType<typeof setTimeout>; fade?: ReturnType<typeof setTimeout> }>({})
  const prevN = useRef(snapshots.length)

  const zoom = useZoomScale()
  const n = snapshots.length
  const pending = snapshots.some((s) => s.ots.status === 'pending')

  const groups = useMemo(() => groupByVersion(snapshots), [snapshots])
  const versionCount = groups.filter(g => g.label !== '').length

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Clear saving indicator and show toast when a new manual snapshot appears
  useEffect(() => {
    const wasManualSave = saving
    if (saving && n > prevN.current) {
      setSaving(false)
      // Check if the new snapshot is a manual one (version save)
      const newest = snapshots[snapshots.length - 1]
      if (wasManualSave && newest?.trigger === 'manual') {
        clearTimeout(toastTimers.current.show)
        clearTimeout(toastTimers.current.fade)
        setToastPhase('show')
        toastTimers.current.show = setTimeout(() => setToastPhase('fade'), 700)
        toastTimers.current.fade = setTimeout(() => setToastPhase('hidden'), 1000)
      }
    }
    prevN.current = n
  }, [n, saving, snapshots])

  const panelOpen = open && (n > 0 || receiptCount > 0 || typeof wordCount === 'number')

  if (hideTrigger && !panelOpen) return null

  const handleSaveVersion = () => {
    if (!onSaveVersion) return
    setSaving(true)
    onSaveVersion()
    // Panel stays open — new entry appears in the list once async work completes
  }

  return (
    <>
      {panelOpen && <div className="fixed inset-0 z-30" aria-hidden="true" onMouseDown={() => setOpen(false)} />}

      <div
        className="fixed left-0 z-40 font-serif text-sm select-none flex flex-col-reverse items-start"
        style={{
          color: INK,
          // Lift above a BOTTOM-docked PDF panel (--iw-pdf-room-bottom) exactly like the sync pill —
          // otherwise this snapshot pill hides behind the panel when it opens.
          bottom: `calc(${hideTrigger ? 'env(safe-area-inset-bottom) + 80px' : '10px'} + var(--iw-pdf-room-bottom, 0px))`,
          padding: hideTrigger ? '0 1rem' : '0 28px',
          transition: 'bottom 0.18s ease',
          zoom: zoom !== 1 ? zoom : undefined,
        }}
      >
        {!hideTrigger && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={`iw-nightable ${compact ? 'flex items-center justify-center w-10 h-10 bg-white text-lg' : 'bg-white leading-tight text-left text-sm px-2.5 py-1 max-w-[7.25rem] max-lg:max-w-[6.75rem]'}`}
            style={{ border: `1px solid rgba(92, 45, 138, 0.75)`, borderRadius: compact ? 9999 : 12, color: 'var(--iw-pill-fg, #5c2d8a)' }}
            title="Provenance record (held by you)"
          >
            {compact ? '◈' : (
              <span className="inline-block pl-[1.2em] [text-indent:-1.2em]">
                ◈ {n} snapshot{n === 1 ? '' : 's'}{versionCount > 0 ? ` · ${versionCount} version${versionCount === 1 ? '' : 's'}` : ''}
              </span>
            )}
          </button>
        )}

        {/* "version saved" toast — 0.7s display + 0.3s fade */}
        {toastPhase !== 'hidden' && (
          <div
            style={{
              position: 'absolute',
              bottom: '2.8rem',
              left: 0,
              background: 'rgba(92, 45, 138, 0.85)',
              color: '#fff',
              fontSize: '0.75rem',
              padding: '4px 10px',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              opacity: toastPhase === 'show' ? 1 : 0,
              transition: toastPhase === 'fade' ? 'opacity 300ms ease' : 'none',
            }}
          >
            version saved
          </div>
        )}

        {panelOpen && (
          <div
            className="iw-nightable mb-1.5 bg-white overflow-auto"
            style={{ border: `1px solid rgba(92, 45, 138, 0.4)`, borderRadius: 10, maxHeight: '55vh', width: 210 }}
          >
            {/* Save version — stays open so the new entry appears in-place */}
            {onSaveVersion && (
              <button
                type="button"
                onClick={handleSaveVersion}
                disabled={saving}
                className="w-full px-2.5 py-1.5 text-left hover:bg-stone-50 font-medium disabled:opacity-50"
                style={{ borderBottom: `1px solid rgba(92, 45, 138, 0.12)`, color: INK, fontSize: '0.78rem' }}
                title="Save a named version of this document now"
              >
                {saving ? '⊕ saving…' : '⊕ save version'}
              </button>
            )}

            {typeof wordCount === 'number' && (
              <div className="px-2.5 py-1.5 text-stone-500 tabular-nums" style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)', fontSize: '0.75rem' }}>
                {wordCount} word{wordCount === 1 ? '' : 's'}
              </div>
            )}
            {onVerifyChain && (
              <button
                type="button"
                onClick={onVerifyChain}
                className="w-full px-2.5 py-1.5 text-left hover:bg-stone-50"
                style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)', fontSize: '0.75rem' }}
                title="Verify the signed receipt chain against the published key"
              >
                ✦ {chainStatus ? `chain: ${chainStatus}` : 'verify chain…'}
              </button>
            )}
            {onCheckBitcoin && pending && (
              <button
                type="button"
                onClick={onCheckBitcoin}
                className="w-full px-2.5 py-1.5 text-left hover:bg-stone-50"
                style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)', color: LIGHT, fontSize: '0.75rem' }}
              >
                ⏳ check Bitcoin…
              </button>
            )}

            {[...snapshots].reverse().map((s) => {
              const vLabel = computeVersionLabel(s, groups)
              const period = getShortPeriod(s.createdAt)
              const otsIcon = s.ots.status === 'confirmed'
                ? <BitcoinIcon size={13} />
                : s.ots.status === 'pending' ? <span>⏳</span>
                : <span style={{ opacity: 0.3 }}>·</span>

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => window.open(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, '_blank', 'noopener')}
                  className="w-full px-2.5 py-1 flex flex-col items-start text-left hover:bg-stone-50"
                  style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)' }}
                  title={s.summary ?? `bundle ${s.bundleHash}`}
                >
                  {/* Row 1: v1s3 · Arvo. 30/06 · wordcount · OTS */}
                  <div className="flex items-center gap-1.5 w-full" style={{ fontSize: '0.72rem' }}>
                    <span style={{ color: INK, fontWeight: 600 }}>{vLabel}</span>
                    <span style={{ color: LIGHT }}>{period}</span>
                    <span className="text-stone-400">{s.wordCount}w</span>
                    <span className="ml-auto flex items-center">{otsIcon}</span>
                  </div>
                  {/* Row 2: nudgeWord pair, AI summary, or trigger label */}
                  <div
                    className="text-stone-400 w-full"
                    style={{
                      fontSize: '0.68rem',
                      lineHeight: '1.3',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                      marginTop: '1px',
                      minHeight: '0.9em',
                    }}
                  >
                    {s.summary ? s.summary
                      : (s.trigger === 'word-nudge' || s.trigger === 'kick') && s.nudgeWord
                        ? <span>{s.nudgeWord.from} <span style={{ color: LIGHT }}>→</span> {s.nudgeWord.to}</span>
                        : <span style={{ opacity: 0.4 }}>
                            {(s.trigger === 'word-nudge' || s.trigger === 'kick') ? 'word nudge'
                              : s.trigger === 'paragraph' ? 'para' : 'version'}
                          </span>
                    }
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
