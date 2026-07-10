// App-level PDF panel. Mounted once in the editor; listens for 'inkwave:open-pdf' (citations/
// pdfViewer.ts), loads the PDF bytes from OPFS, and renders them with the bundled pdf.js viewer.
//
// Desktop: docks bottom by default; on a wide screen a toggle switches it to a side-by-side dock
// (left or right edge). PHONE (isTouchDevice): the viewer always takes the TOP half and the editor
// keeps the bottom half (Peter, 2026-07-10) — the old forced bottom dock never worked there (the
// bottom-dock tap-editor-closes listener dropped the PDF on the first touch, and the px-height
// bottom panel sat behind iOS's dynamic URL bar). It publishes --iw-pdf-room (right) /
// --iw-pdf-room-left / --iw-pdf-room-bottom / --iw-pdf-room-top so the editor surface + floating
// toolbars make room (see styles/index.css). Resizing drags a full-viewport overlay portaled above
// the viewer so pointer events aren't swallowed mid-drag.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getPdfData, hasPdf } from '../citations/pdfSource'
import { fetchSidecarFor } from '../storage/onedrive'
import { bibProvider } from '../citations/bibProvider'
import { OPEN_PDF_EVENT, type OpenPdfDetail } from '../citations/pdfViewer'
import { PdfViewer } from './PdfViewer'
import { isTouchDevice } from '../editor/Scroll'

const INK = '#5c2d8a'
const MIN_W = 320, MIN_H = 200
const ORIENT_KEY = 'inkwave:pdfPanelOrientation'
const DOCK_SIDE_KEY = 'inkwave:pdfDockSide' // side dock on the 'left' or 'right' screen edge
// Fullscreen float margins: the pane sits centred over the water like a big page — the editor
// surface's waves stay visible in the side strips (and sway with the PDF scroll; see PdfViewer's
// inkwave:pdf-sway feed into Scroll.tsx).
const FS_SIDE = 64, FS_VERT = 12
// Phone top dock height: dvh tracks iOS's dynamic URL bar (vh fallback for old WebKit).
const PHONE_TOP_H = typeof CSS !== 'undefined' && CSS.supports?.('height', '50dvh') ? '50dvh' : '50vh'

interface Viewing {
  data: ArrayBuffer; page: number; quote: string | null; label: string; citekey: string
  instanceId?: string | null; context?: string | null; noRef?: boolean; restoreScroll?: boolean
  onLink?: (quote: string, page: number) => void
}

export function PdfSidePanel() {
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [noAttachment, setNoAttachment] = useState<string | null>(null) // label when the source has no PDF
  // The popout fills HALF the screen by default in either orientation (Peter, 2026-07-10):
  // side dock = half the width, bottom dock = half the height. The drag handle still resizes.
  const [width, setWidth] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.5))
  const [height, setHeight] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5))
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ axis: 'x' | 'y'; start: number; size: number } | null>(null)

  // Stored preference (wide screens only); narrow/phone is always bottom.
  const [storedOrient, setStoredOrient] = useState<'bottom' | 'side'>(() => {
    try { return localStorage.getItem(ORIENT_KEY) === 'side' ? 'side' : 'bottom' } catch { return 'bottom' }
  })
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  // PHONE = TOP dock, always (the panel above, the editor in the bottom half). Non-touch narrow
  // windows keep the bottom dock; wide screens keep the stored bottom/side preference.
  const isPhone = isTouchDevice()
  const orientation: 'bottom' | 'side' | 'top' = isPhone ? 'top' : isWide ? storedOrient : 'bottom'

  // Which screen edge the SIDE dock lives on (Peter, 2026-07-10) — persisted; bottom dock ignores it.
  const [dockSide, setDockSide] = useState<'left' | 'right'>(() => {
    try { return localStorage.getItem(DOCK_SIDE_KEY) === 'left' ? 'left' : 'right' } catch { return 'right' }
  })
  function toggleDockSide() {
    setDockSide(s => {
      const next = s === 'left' ? 'right' : 'left'
      try { localStorage.setItem(DOCK_SIDE_KEY, next) } catch { /* private mode */ }
      return next
    })
  }
  // FULLSCREEN (Peter, 2026-07-10): the viewer floats over the whole app window (water visible at
  // the sides). Per-session only — every open starts docked; Escape (or the ⛶ toggle) exits.
  const [fullscreen, setFullscreen] = useState(false)

  const open = !!(viewing || error || loading || noAttachment)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenPdfDetail>).detail
      if (!detail?.citekey) return
      setError(null)
      setViewing(null)
      setNoAttachment(null)
      setFullscreen(false) // fullscreen is per-session/per-open — every open starts docked
      // The panel still pops up for a source with no PDF — it just says "No attachment".
      if (!hasPdf(bibProvider.get(detail.citekey))) { setLoading(false); setNoAttachment(detail.label || detail.citekey); return }
      setLoading(true)
      void (async () => {
        let data = await getPdfData(detail.citekey)
        let fetchReason: string | null = null
        if (!data) {
          // On-demand sidecar recovery: metadata says a PDF exists but the bytes aren't local —
          // the historical iOS savePdf failure left docs in exactly this state. One targeted
          // OneDrive fetch heals it right here; on failure the reason drives an ACTIONABLE error.
          try {
            const docId = localStorage.getItem('inkwave:activeDocumentId')
            const item = bibProvider.get(detail.citekey)
            if (docId && item) {
              const r = await fetchSidecarFor(docId, item)
              if (r.ok) data = await getPdfData(detail.citekey)
              else fetchReason = r.reason
            }
          } catch { /* fall through to the error */ }
        }
        setLoading(false)
        if (!data) {
          setError(fetchReason === 'no-auth'
            ? 'This source’s PDF isn’t on this device yet. Sign in to OneDrive (⋮ → Save → Sync to OneDrive) and it will be fetched automatically.'
            : fetchReason === 'not-found'
              ? 'This source’s PDF isn’t on this device, and no sidecar copy was found in the doc’s OneDrive folder. Re-attach the PDF on the device that has it and sync once.'
              : 'Couldn’t load this source’s PDF — no embedded file on this device.')
          return
        }
        const page = detail.page && detail.page > 0 ? detail.page : 1
        setViewing({ data, page, quote: detail.quote ?? null, label: detail.label || detail.citekey, citekey: detail.citekey, instanceId: detail.instanceId ?? null, context: detail.context ?? null, noRef: detail.noRef ?? false, restoreScroll: detail.restoreScroll ?? false, onLink: detail.onLink })
      })()
    }
    window.addEventListener(OPEN_PDF_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PDF_EVENT, onOpen)
  }, [])

  useEffect(() => {
    // Escape steps DOWN one level: fullscreen → back to the dock; docked → close the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !open) return
      if (fullscreen) setFullscreen(false)
      else close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fullscreen])

  // The "hide the PDF when you click back into the editor" toggle (◧ in the viewer toolbar), read live.
  const [hideOnEditorClick, setHideOnEditorClick] = useState(() => {
    try { return localStorage.getItem('inkwave:pdfHideOnEditorClick') === '1' } catch { return false }
  })
  useEffect(() => {
    const on = () => { try { setHideOnEditorClick(localStorage.getItem('inkwave:pdfHideOnEditorClick') === '1') } catch { /* private */ } }
    window.addEventListener('inkwave:pdf-hide-pref-changed', on)
    return () => window.removeEventListener('inkwave:pdf-hide-pref-changed', on)
  }, [])

  // Tapping back into the editor drops the PDF — always when BOTTOM-docked, and (in any orientation)
  // when the ◧ toggle is on. Armed after a short delay so the very tap that opened the PDF doesn't close
  // it. Clicks INSIDE the viewer (selecting text, using the toolbar) never count.
  useEffect(() => {
    if (!open || fullscreen) return // fullscreen covers the editor — a stray focusin must not close it
    if (orientation !== 'bottom' && !hideOnEditorClick) return
    // ANYWHERE in the editor region counts — water, margins, right of the text (Peter, 2026-07-10:
    // it only worked on the text body). Listen on the SURFACE; clicks inside the viewer/panel or on
    // floating chrome (footer, pills, menus — outside the surface or [data-iw-chrome]) never count.
    const surface = document.querySelector('.inkwave-editor-surface.iw-fill')
    const pm = document.querySelector('.ProseMirror')
    if (!surface && !pm) return
    let armed = false
    const arm = setTimeout(() => { armed = true }, 600)
    const onEditorInteract = (e: Event) => {
      if (!armed) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('[data-iw-chrome]') || t.closest('.iw-nightable'))) return // chrome/panels
      close()
    }
    surface?.addEventListener('pointerdown', onEditorInteract)
    pm?.addEventListener('focusin', onEditorInteract)
    return () => {
      clearTimeout(arm)
      surface?.removeEventListener('pointerdown', onEditorInteract)
      pm?.removeEventListener('focusin', onEditorInteract)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orientation, hideOnEditorClick, fullscreen])

  // Make room: side dock → inset the editor from that edge (right OR left — Peter, 2026-07-10);
  // bottom → padding-bottom (+ shift the footer toolbar up). FULLSCREEN never squeezes: the pane
  // COVERS the editor, so its layout (and the reading line the scroll anchor holds) is untouched —
  // entering/exiting fullscreen from a side dock releases/re-binds the fit cap and Scroll.tsx's
  // computeFit anchor keeps the same content line in place through both transitions.
  useEffect(() => {
    const root = document.documentElement
    const set = (right: string, left: string, bottom: string, top = '0px') => {
      root.style.setProperty('--iw-pdf-room', right)
      root.style.setProperty('--iw-pdf-room-left', left)
      root.style.setProperty('--iw-pdf-room-bottom', bottom)
      root.style.setProperty('--iw-pdf-room-top', top)
    }
    if (!open || fullscreen) set('0px', '0px', '0px')
    else if (orientation === 'top') set('0px', '0px', '0px', PHONE_TOP_H) // phone: editor keeps the bottom half
    else if (orientation === 'side') {
      if (dockSide === 'left') set('0px', `${width}px`, '0px')
      else set(`${width}px`, '0px', '0px')
    } else set('0px', '0px', `${height}px`)
    return () => set('0px', '0px', '0px')
  }, [open, orientation, width, height, fullscreen, dockSide])

  function close() { setViewing(null); setError(null); setLoading(false); setNoAttachment(null); setFullscreen(false) }
  function toggleOrient() {
    setStoredOrient(o => {
      const next = o === 'side' ? 'bottom' : 'side'
      try { localStorage.setItem(ORIENT_KEY, next) } catch { /* private mode */ }
      return next
    })
  }

  if (!open) return null

  const side = orientation === 'side'
  const panelPos: React.CSSProperties = fullscreen
    // Fullscreen float: the pane is centred over the water with the wave strips visible either
    // side (a big page floating on the water — not chrome-less edge-to-edge). Phone gets slim margins.
    ? { top: FS_VERT, bottom: FS_VERT, left: isPhone ? 10 : FS_SIDE, right: isPhone ? 10 : FS_SIDE, borderRadius: 12, border: `1px solid ${INK}33`, boxShadow: '0 14px 52px rgba(0,0,0,0.35)', overflow: 'hidden' }
    : orientation === 'top'
      // PHONE: the viewer pops up ABOVE, full width, top half — the editor keeps the bottom half.
      ? { top: 0, left: 0, right: 0, height: PHONE_TOP_H, paddingTop: 'env(safe-area-inset-top)' /* notch, standalone PWA */, borderBottom: `1px solid ${INK}33`, boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }
      : side
      ? (dockSide === 'left'
        ? { top: 0, left: 0, bottom: 0, width, maxWidth: '100vw', borderRight: `1px solid ${INK}33`, boxShadow: '4px 0 24px rgba(0,0,0,0.18)' }
        : { top: 0, right: 0, bottom: 0, width, maxWidth: '100vw', borderLeft: `1px solid ${INK}33`, boxShadow: '-4px 0 24px rgba(0,0,0,0.18)' })
      : { left: 0, right: 0, bottom: 0, height, maxHeight: '92vh', borderTop: `1px solid ${INK}33`, boxShadow: '0 -4px 24px rgba(0,0,0,0.18)' }
  // Resize handle rides the panel's INNER edge (the one facing the editor) — flips with the dock side.
  const handlePos: React.CSSProperties = side
    ? { ...(dockSide === 'left' ? { right: 0 } : { left: 0 }), top: 0, bottom: 0, width: 10, cursor: 'col-resize' }
    : { left: 0, right: 0, top: 0, height: 10, cursor: 'row-resize' }

  return (
    <>
      <div style={{ position: 'fixed', zIndex: 80, background: '#fff', display: 'flex', flexDirection: 'column', ...panelPos }}>
        {/* Resize handle on the edge facing the editor (hidden in fullscreen, and on the phone's
            fixed 50dvh top dock — a touch drag there fights scrolling). */}
        {!fullscreen && orientation !== 'top' && (
        <div
          onPointerDown={e => {
            e.preventDefault()
            dragStart.current = side ? { axis: 'x', start: e.clientX, size: width } : { axis: 'y', start: e.clientY, size: height }
            setDragging(true)
          }}
          title="Drag to resize"
          style={{ position: 'absolute', zIndex: 2, background: dragging ? `${INK}22` : 'transparent', ...handlePos }}
        />
        )}

        {/* The header bar is gone — the viewer renders its close in the toolbar; the transient states
            below get a floating × so they stay dismissible. */}
        {!viewing && (
          <button type="button" onClick={close} title="Close (Esc)"
            style={{ position: 'absolute', top: 8, right: 12, zIndex: 3, border: 'none', background: 'transparent', color: '#78716c', fontSize: '1.7rem', lineHeight: 1, cursor: 'pointer' }}>×</button>
        )}

        {loading && !viewing ? (
          // Instant state = pure white + the floating ✕ above (Peter, 2026-07-09) — same interior the
          // viewer's pre-reveal cover shows, so the window is ONE white surface until the atomic
          // contents reveal. No text, no shimmer.
          <div aria-hidden="true" style={{ flex: 1, minHeight: 0, background: '#fff' }} />
        ) : noAttachment ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '1rem', fontStyle: 'italic' }}>No attachment</div>
        ) : error ? (
          <div style={{ padding: '1.5rem', fontSize: '0.85rem', color: '#b45309' }}>{error}</div>
        ) : viewing ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', pointerEvents: dragging ? 'none' : 'auto' }}>
            <PdfViewer
              key={viewing.citekey}
              data={viewing.data}
              citekey={viewing.citekey}
              initialPage={viewing.page}
              initialQuote={viewing.quote}
              instanceId={viewing.instanceId}
              context={viewing.context}
              noRef={viewing.noRef}
              restoreScroll={viewing.restoreScroll}
              onClose={close}
              fullscreen={fullscreen}
              fullscreenButton={
                <button type="button" onClick={() => setFullscreen(f => !f)}
                  title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen — float the PDF over the water'}
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', fontSize: '0.95rem', borderRadius: 6, lineHeight: 1,
                    border: `1px solid ${fullscreen ? INK : '#d6cfe0'}`, background: fullscreen ? `${INK}1f` : '#fff', color: INK }}>⛶</button>
              }
              sideButtons={!fullscreen && side ? (
                // Swap which screen edge the side dock hugs (persisted) — distinct from the
                // ▭/▯ dock-ORIENTATION toggle next to it and the ⇄ sync-editor toggle at the left.
                <button type="button" onClick={toggleDockSide}
                  title={dockSide === 'right' ? 'Move the panel to the LEFT edge of the screen' : 'Move the panel to the RIGHT edge of the screen'}
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.95rem', borderRadius: 6, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>
                  {dockSide === 'right' ? '⇤' : '⇥'}
                </button>
              ) : null}
              dockButton={isWide && !fullscreen && !isPhone ? (
                <button type="button" onClick={toggleOrient} title={side ? 'Dock to the bottom (panel under the editor)' : 'Dock to the side (side-by-side with the editor)'}
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.95rem', borderRadius: 6, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>
                  {side ? '▭' : '▯'}
                </button>
              ) : null}
              onLinkToCitation={viewing.onLink}
            />
          </div>
        ) : null}
      </div>

      {/* Drag overlay — portaled to body so it sits above the viewer (pointer events aren't swallowed). */}
      {dragging && createPortal(
        <div
          onPointerMove={e => {
            const d = dragStart.current
            if (!d) return
            // Drag direction depends on which edge the side dock hugs (grow toward the editor).
            if (d.axis === 'x') setWidth(Math.max(MIN_W, Math.min(window.innerWidth - 80, d.size + (dockSide === 'left' ? e.clientX - d.start : d.start - e.clientX))))
            else setHeight(Math.max(MIN_H, Math.min(window.innerHeight - 80, d.size + (d.start - e.clientY))))
          }}
          onPointerUp={() => { dragStart.current = null; setDragging(false) }}
          onPointerCancel={() => { dragStart.current = null; setDragging(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: side ? 'col-resize' : 'row-resize' }}
        />,
        document.body,
      )}
    </>
  )
}
