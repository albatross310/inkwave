import { useEffect, useMemo, useState } from 'react'
import type { Snapshot } from '../types/document'
import { groupByVersion, type SnapshotGroup } from '../provenance/snapshots'
import { useZoomScale } from '../editor/useZoomScale'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

// ── Time-of-day period label (short) ─────────────────────────────────────────
function getShortPeriod(createdAt: string): string {
  const h = new Date(createdAt).getHours()
  if (h >= 5  && h < 8)  return 'E. Morn'
  if (h >= 8  && h < 12) return 'Morn'
  if (h >= 12 && h < 17) return 'Arvo'
  if (h >= 17 && h < 20) return 'Eve'
  return 'Night'
}

// ── Version + snapshot-within-version label ───────────────────────────────────
// Format: "v1s3" (version 1, 3rd snapshot in that version) or "s2" (pre-version draft).
function computeVersionLabel(snap: Snapshot, groups: SnapshotGroup[]): string {
  for (const group of groups) {
    const i = group.items.findIndex(s => s.id === snap.id)
    if (i >= 0) return group.label ? `${group.label}s${i + 1}` : `s${i + 1}`
  }
  return ''
}

// The growing record of tamper-evident snapshots + the live-composition receipt chain.
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
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }

  const zoom = useZoomScale()
  const n = snapshots.length
  const pending = snapshots.some((s) => s.ots.status === 'pending')

  const groups = useMemo(() => groupByVersion(snapshots), [snapshots])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const panelOpen = open && (n > 0 || receiptCount > 0 || typeof wordCount === 'number')

  if (hideTrigger && !panelOpen) return null

  return (
    <>
      {panelOpen && <div className="fixed inset-0 z-30" aria-hidden="true" onMouseDown={() => setOpen(false)} />}

      <div
        className="fixed left-0 z-40 font-serif text-sm select-none flex flex-col-reverse items-start"
        style={{
          color: INK,
          bottom: hideTrigger ? 'calc(env(safe-area-inset-bottom) + 80px)' : '38px',
          padding: hideTrigger ? '0 1rem' : '0 28px',
          zoom: zoom !== 1 ? zoom : undefined,
        }}
      >
        {!hideTrigger && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={compact ? 'flex items-center justify-center w-10 h-10 bg-white text-lg' : 'bg-white leading-tight text-left text-sm px-2.5 py-1 max-w-[8.5rem] max-lg:max-w-[8rem]'}
            style={{ border: `1px solid rgba(92, 45, 138, 0.75)`, borderRadius: compact ? 9999 : 12 }}
            title="Provenance record (held by you)"
          >
            {compact ? '◈' : (
              <span className="inline-block pl-[1.2em] [text-indent:-1.2em]">
                ◈ {n} snapshot{n === 1 ? '' : 's'}{receiptCount > 0 ? ` · ${receiptCount} receipt${receiptCount === 1 ? '' : 's'}` : ''}
              </span>
            )}
          </button>
        )}

        {panelOpen && (
          <div
            className="mb-1.5 bg-white overflow-auto"
            style={{ border: `1px solid rgba(92, 45, 138, 0.4)`, borderRadius: 10, maxHeight: '40vh', width: 200 }}
          >
            {/* Manual "Save version" — always at top */}
            {onSaveVersion && (
              <button
                type="button"
                onClick={() => { onSaveVersion(); setOpen(false) }}
                className="w-full px-2.5 py-1.5 text-left hover:bg-stone-50 font-medium"
                style={{ borderBottom: `1px solid rgba(92, 45, 138, 0.12)`, color: INK, fontSize: '0.78rem' }}
                title="Save a named version of this document now"
              >
                ⊕ save version
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
              const otsIcon = s.ots.status === 'confirmed' ? 'Ⓑ' : s.ots.status === 'pending' ? '⏳' : '·'
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => window.open(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, '_blank', 'noopener')}
                  className="w-full px-2.5 py-1 flex flex-col items-start text-left hover:bg-stone-50"
                  style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)' }}
                  title={s.summary ?? `bundle ${s.bundleHash}`}
                >
                  {/* Row 1: v1s3 · Arvo · wordcount · OTS */}
                  <div className="flex items-baseline gap-1.5 w-full" style={{ fontSize: '0.72rem' }}>
                    <span style={{ color: INK, fontWeight: 500 }}>{vLabel}</span>
                    <span style={{ color: LIGHT }}>{period}</span>
                    <span className="text-stone-500">{s.wordCount}w</span>
                    <span className="ml-auto text-stone-400" title={`bundle ${s.bundleHash}`}>{otsIcon}</span>
                  </div>
                  {/* Row 2: AI summary or trigger type */}
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
                    {s.summary
                      ? s.summary
                      : <span style={{ opacity: 0.4 }}>{s.trigger === 'kick' ? 'kick' : s.trigger === 'paragraph' ? 'para' : 'version'}</span>
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
