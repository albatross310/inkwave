import { useEffect, useState } from 'react'
import { useZoomScale } from '../editor/useZoomScale'

// Bottom-right sync indicator: a compact pill that, on hover/tap, opens a small panel ABOVE it (so
// it never grows leftward into the text). The pill text is decided by the caller so it reads clearly
// in every state — "Synced to folder", "OneDrive — not yet syncing", "OneDrive disconnected". When
// not synced the pill is actionable (onClick connects / retries). Works for a local folder (Chromium)
// or OneDrive (Firefox/Safari). Re-renders on a timer so the relative time stays fresh.
const INK = '#5c2d8a'

function relativeTime(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

export function SyncStatus({
  label, synced, path, displayName, lastSync, tooltip, webUrl, onShowInFolder, onChangeFolder, onClick, compact,
  open: externalOpen, onOpenChange, hideTrigger,
}: {
  label: string
  synced: boolean
  path?: string | null
  displayName?: string | null // override the filename shown in the panel (defaults to basename of path)
  lastSync?: number | null
  tooltip?: string
  webUrl?: string | null // when present, "Open in folder" opens it (the file in OneDrive)
  onShowInFolder?: () => void // local folder: reveal the file's folder (native picker startIn)
  onChangeFolder?: () => void
  onClick?: () => void // pill action when not synced (connect / sync now)
  compact?: boolean // mobile: a small cloud circle instead of the text pill
  open?: boolean    // controlled mode (toolbar trigger)
  onOpenChange?: (v: boolean) => void
  hideTrigger?: boolean // suppress the fixed-position trigger (it's in the toolbar instead)
}) {
  const [, tick] = useState(0)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }

  const zoom = useZoomScale()

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  // Nothing to render when the trigger is external and the panel is closed.
  if (hideTrigger && !open) return null

  return (
    <div
      className="fixed z-40 font-serif select-none flex flex-col items-end"
      style={{
        // Shift clear of the PDF panel (side dock → left of it; bottom dock → above it) so the pill
        // isn't covered, matching the toolbars.
        right: 'var(--iw-pdf-room, 0px)',
        // Match the footer toolbar's baseline (room-bottom + 28*zoom). Use transform:scale (NOT css
        // `zoom`) for size — css `zoom` also multiplies the bottom offset, so with a bottom-docked panel
        // open + page zoom the pill lifted by room-bottom*zoom and flew up above the toolbar.
        bottom: `calc(${hideTrigger ? 'env(safe-area-inset-bottom) + 80px' : `${Math.round(28 * zoom)}px`} + var(--iw-pdf-room-bottom, 0px))`,
        padding: hideTrigger ? '0 1rem' : '0 28px',
        transform: `scale(${zoom * 1.25})`, // ×1.25 to match the 25%-bigger toolbar pill
        transformOrigin: 'bottom right',
        transition: 'right 0.18s ease, bottom 0.18s ease',
      }}
    >
      {/* Backdrop to dismiss panel (both hover and click-opened paths) */}
      {open && (
        <div className="fixed inset-0 z-30" aria-hidden="true" onMouseDown={() => setOpen(false)} />
      )}

      {/* Detail panel — opens UPWARD, fixed width, path wraps inside it. */}
      {open && (
        <div className="iw-nightable relative z-40 mb-2 w-64 max-lg:w-[7.7rem] bg-white shadow-lg rounded-xl p-3 text-stone-600" style={{ border: `1px solid ${INK}40` }}>
          <div className="text-xs text-stone-400 mb-1.5">
            {synced && lastSync ? `synced ${relativeTime(lastSync)}` : 'not syncing yet — your work is still saved on this device'}
          </div>
          {path && (() => {
            const rawName = path.split(/[\\/]/).pop() ?? path
            // Prefer an explicit displayName prop (e.g. doc title); fallback to stripping the extension
            const shownName = displayName
              ? (displayName.replace(/\.(inkwave|studio|json)$/i, '') + '.studio')
              : (rawName.replace(/\.(inkwave|studio|json)$/i, '') + '.studio')
            const canReveal = !!(onShowInFolder || webUrl)
            return (
              <div className="mb-2">
                {canReveal ? (
                  <button type="button" title={path}
                    onClick={() => onShowInFolder ? onShowInFolder() : window.open(webUrl!, '_blank')}
                    className="text-xs text-left bg-stone-50 rounded-lg px-2 py-1.5 w-full hover:bg-stone-100 transition-colors"
                    style={{ color: INK, border: `1px solid ${INK}22`, wordBreak: 'break-word' }}>
                    {shownName}
                  </button>
                ) : (
                  <div className="text-xs text-stone-600 bg-stone-50 rounded-lg px-2 py-1.5" title={path}
                    style={{ wordBreak: 'break-word' }}>
                    {shownName}
                  </div>
                )}
              </div>
            )
          })()}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {webUrl && (
              <a href={webUrl} target="_blank" rel="noreferrer" className="underline hover:text-[#5c2d8a]" style={{ color: INK }}>
                Open in folder ↗
              </a>
            )}
            {onChangeFolder && (
              <button type="button" onClick={onChangeFolder} className="underline hover:text-[#5c2d8a]" style={{ color: INK }}>
                Change folder
              </button>
            )}
            {!synced && onClick && (
              <button type="button" onClick={onClick}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white font-medium shadow-sm hover:shadow transition-all"
                style={{ background: 'linear-gradient(135deg, #7a4fb0, #5c2d8a)' }}>
                ☁ Sync now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Right-anchored trigger. Mobile: a small cloud circle. Desktop: a pill whose label wraps to
          ~2 lines (a narrow width) so it never collides with the centred toolbar on a half-screen. */}
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => {
            if (onClick && !synced) onClick()
            setOpen(!open)
          }}
          title={tooltip}
          className={`iw-nightable ${compact
            ? 'flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-sm text-lg'
            : 'cursor-pointer rounded-full bg-white hover:bg-stone-50 transition-colors text-right leading-tight text-sm px-2.5 py-1 max-w-[8.5rem] max-lg:px-2 max-lg:max-w-[6rem]'}`}
          style={{ color: synced ? 'var(--iw-pill-fg, #6b7280)' : '#b45309', border: compact ? `1px solid ${INK}66` : undefined }}
        >
          {compact ? '☁' : label}
        </button>
      )}
    </div>
  )
}
