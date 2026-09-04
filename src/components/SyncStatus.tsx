import { useEffect, useState, type ReactNode } from 'react'
import { useZoomScale } from '../editor/useZoomScale'
import { SIDE_PILL_H, SIDE_PILL_TALL_H, SIDE_PILL_FONT, sidePillBottom } from './sidePill'
import { relativeTime } from './relativeTime'

// Bottom-right sync indicator: a compact pill that, on hover/tap, opens a small panel ABOVE it (so
// it never grows leftward into the text). The pill text is decided by the caller so it reads clearly
// in every state — "Synced to folder", "OneDrive — not yet syncing", "OneDrive disconnected". When
// not synced the pill is actionable (onClick connects / retries). Works for a local folder (Chromium)
// or OneDrive (Firefox/Safari). Re-renders on a timer so the relative time stays fresh.
const INK = '#302438'

export function SyncStatus({
  label, synced, path, displayName, lastSync, tooltip, webUrl, onShowInFolder, onChangeFolder, onClick, compact, multiline,
  open: externalOpen, onOpenChange, hideTrigger,
}: {
  label: ReactNode
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
  multiline?: boolean // exceptional long status: wrap to two lines in a taller, still-centred pill
  open?: boolean    // controlled mode (toolbar trigger)
  onOpenChange?: (v: boolean) => void
  hideTrigger?: boolean // suppress the fixed-position trigger (it's in the toolbar instead)
}) {
  const [, tick] = useState(0)
  const [internalOpen, setInternalOpen] = useState(false)
  // PDF panel open → shrink to the compact cloud so the pill never overlaps the toolbar
  // (Peter, 2026-07-10: the wrapped 'Synced to OneDrive' pill collided, dead space at its left).
  const [pdfOpen, setPdfOpen] = useState(false)
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      setPdfOpen(['--iw-pdf-room', '--iw-pdf-room-left', '--iw-pdf-room-top', '--iw-pdf-room-bottom']
        .some(v => parseFloat(cs.getPropertyValue(v)) > 0))
    }
    read()
    const t = setInterval(read, 1200)
    return () => clearInterval(t)
  }, [])
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }

  const zoom = useZoomScale()
  const triggerHeight = multiline && !compact && !pdfOpen ? SIDE_PILL_TALL_H : SIDE_PILL_H

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
        // ⚠ 2026-08-20: bottom-edge matching was never the right rule — two pills of DIFFERENT
        // heights sharing a bottom edge have different midlines. Both side pills now derive this from
        // `sidePillBottom()` so their MIDLINES land on the toolbar's; see components/sidePill.ts.
        bottom: hideTrigger
          ? 'calc(env(safe-area-inset-bottom) + 80px + var(--iw-pdf-room-bottom, 0px))'
          : sidePillBottom(zoom, triggerHeight),
        padding: hideTrigger ? '0 1rem' : '0 10px',
        transform: `scale(${zoom * 1.12})`, // ×1.25 to match the 25%-bigger toolbar pill
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
              <a href={webUrl} target="_blank" rel="noreferrer" className="underline hover:text-[#302438]" style={{ color: INK }}>
                Open in folder ↗
              </a>
            )}
            {onChangeFolder && (
              <button type="button" onClick={onChangeFolder} className="underline hover:text-[#302438]" style={{ color: INK }}>
                Change folder
              </button>
            )}
            {!synced && onClick && (
              <button type="button" onClick={onClick}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white font-medium shadow-sm hover:shadow transition-all"
                style={{ background: 'linear-gradient(135deg, #41425b, #302438)' }}>
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
            // Just open the detail panel — DON'T fire the connect/sign-in action (e.g. the Microsoft
            // popup) on the pill tap. The panel's "Sync now" button is where the user opts into that.
            setOpen(!open)
          }}
          title={tooltip}
          className={`iw-nightable iw-toolbar-outline ${compact || pdfOpen
            // ⚠ STILL A PILL WITH A PANEL OPEN (Peter, 2026-08-28: "this button should be a pill
            // like the lhs pill of same height and have same midline horizontally as the main
            // pill"). It used to become a w-10 h-10 CIRCLE — 40px against the side pills' 30px, on
            // its own baseline — so opening the PDF or the source reader silently broke the pairing
            // that components/sidePill.ts exists to hold. It only ever needed to be NARROWER (so it
            // can't reach the toolbar), not a different shape: same height, same font, same
            // midline, just the ☁ glyph instead of the label.
            ? 'cursor-pointer rounded-full bg-white hover:bg-stone-50 transition-colors flex items-center justify-center px-2.5'
            // max-w narrowed 8.5rem → 7.5rem → 5.6rem (Peter, 2026-08-20: "a bit narrower", then
            // "take 25% off the left of the rh pill"). It is RIGHT-anchored, so trimming its max-width
            // takes the space off its LEFT edge, which is what was asked. The label already wraps by
            // design, so this just wraps a little sooner. flex/items-center pair with minHeight below.
            // max-w 5.6rem → 7rem: the label is one size bigger now (see fontSize below) and shed its
            // "a", and it must fit on ONE line — a second line would break the shared height the two
            // side pills now hold.
            : `cursor-pointer rounded-full bg-white hover:bg-stone-50 transition-colors flex items-center leading-tight px-2.5 py-1 max-w-[6rem] max-lg:px-2 max-lg:max-w-[6rem] ${multiline ? 'justify-center text-center whitespace-normal' : 'justify-end text-right whitespace-nowrap'}`}`}
          style={{
            // PURPLE, matching the snaps pill opposite (Peter, 2026-08-20). Both now read from the
            // same `--iw-pill-fg` token, so the pair stays matched through a night-mode switch instead
            // of one being a hard-coded amber. Reconnect is stated in words; it needs no alert glyph.
            color: 'var(--iw-pill-fg, #302438)',
            // The shared hardcoded grey outline is applied by iw-toolbar-outline.
            border: '1px solid var(--iw-nightable-border, rgb(var(--iw-ink-rgb) / 0.75))',
            // ⚠ 2026-08-20 (Peter: "align at horizontal axis, move lower") — narrowing the pill above
            // Reconnect is the one deliberate tall state: it gets a fixed two-line height rather than
            // overflowing a forced one-line box. sidePillBottom receives that same height, so the taller
            // pill remains centred on the toolbar instead of merely sharing its bottom edge.
            ...({
              height: triggerHeight,
              // ONE SIZE SHARED WITH THE SNAPS PILL (Peter: "make it same font size as on the left and
              // shrink the left pill text if you have to"). 12px is the meeting point — this pill came
              // UP from the 10px it was shrunk to, the snaps pill comes DOWN from 14px (text-sm), and
              // at 12px "Save to folder" still fits one line inside the 7rem cap above.
              fontSize: SIDE_PILL_FONT,
              lineHeight: 1.1,
            }),
          }}
        >
          {compact || pdfOpen ? '☁' : label}
        </button>
      )}
    </div>
  )
}
