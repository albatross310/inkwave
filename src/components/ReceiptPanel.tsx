import { useEffect, useState } from 'react'
import type { Snapshot } from '../types/document'
import { useZoomScale } from '../editor/useZoomScale'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

// The growing record of tamper-evident snapshots + the live-composition receipt chain the writer
// holds. Saving/syncing lives in the ⋮ menu (not duplicated here); this panel is the record viewer:
// verify the chain, nudge Bitcoin confirmation, and list the dated snapshots.
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
  compact?: boolean // mobile: a small ◈ circle instead of the text pill
  open?: boolean   // controlled mode (toolbar trigger)
  onOpenChange?: (v: boolean) => void
  hideTrigger?: boolean // suppress the fixed-position trigger (it's in the toolbar instead)
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }

  const zoom = useZoomScale()
  const n = snapshots.length
  const pending = snapshots.some((s) => s.ots.status === 'pending')

  // Close on Escape (outside-click is handled by the backdrop below).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const panelOpen = open && (n > 0 || receiptCount > 0 || typeof wordCount === 'number')

  // When the trigger lives in the toolbar, skip rendering entirely while closed.
  if (hideTrigger && !panelOpen) return null

  return (
    <>
      {/* Invisible backdrop catches any outside click reliably (a document listener was missing
          clicks on the page background). Below the panel (z-30 < z-40), above the rest. */}
      {panelOpen && <div className="fixed inset-0 z-30" aria-hidden="true" onMouseDown={() => setOpen(false)} />}

      <div
        className="fixed left-0 z-40 font-serif text-sm select-none flex flex-col-reverse items-start"
        style={{
          color: INK,
          // When the trigger is in the toolbar, anchor the panel above the toolbar instead of at
          // the screen bottom — otherwise the panel slides under the toolbar.
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
            {/* Manual "Save version" — appears first so it's always reachable */}
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
            {[...snapshots].reverse().map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => window.open(`/snapshot?doc=${encodeURIComponent(s.documentId)}&snap=${encodeURIComponent(s.id)}`, '_blank', 'noopener')}
                className="w-full px-2.5 py-1 flex flex-col items-start text-left hover:bg-stone-50"
                style={{ borderBottom: '1px solid rgba(92, 45, 138, 0.12)' }}
                title={s.summary ?? `bundle ${s.bundleHash}`}
              >
                {/* Row 1: time · wordcount · OTS status */}
                <div className="flex items-baseline gap-1.5 w-full" style={{ fontSize: '0.72rem' }}>
                  <span className="tabular-nums" style={{ color: LIGHT }}>
                    {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-stone-500">{s.wordCount}w</span>
                  <span className="ml-auto text-stone-400" title={`bundle ${s.bundleHash}`}>
                    {s.ots.status === 'confirmed' ? '⛓' : s.ots.status === 'pending' ? '⏳' : '·'} ↗
                  </span>
                </div>
                {/* Row 2: AI summary (truncated single line; full text on hover via title above) */}
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
                    : <span style={{ opacity: 0.4 }}>{s.trigger === 'kick' ? 'kick' : s.trigger === 'paragraph' ? 'para' : 'manual'}</span>
                  }
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
