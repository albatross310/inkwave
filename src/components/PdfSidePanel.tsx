// App-level PDF panel. Mounted once in the editor; listens for 'inkwave:open-pdf' (citations/
// pdfViewer.ts), loads the PDF bytes from OPFS, and renders them with the bundled pdf.js viewer.
//
// Docks top/bottom by default (and always on narrow/phone screens); on a wide screen a toggle switches
// it to a right-hand side-by-side dock. It publishes --iw-pdf-room (side) / --iw-pdf-room-bottom
// (bottom) so the editor surface + floating toolbars make room (see styles/index.css). Resizing drags
// a full-viewport overlay portaled above the viewer so pointer events aren't swallowed mid-drag.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getPdfData } from '../citations/pdfSource'
import { OPEN_PDF_EVENT, type OpenPdfDetail } from '../citations/pdfViewer'
import { PdfViewer } from './PdfViewer'

const INK = '#5c2d8a'
const MIN_W = 320, MIN_H = 200
const ORIENT_KEY = 'inkwave:pdfPanelOrientation'

interface Viewing {
  data: ArrayBuffer; page: number; quote: string | null; label: string; citekey: string
  instanceId?: string | null; context?: string | null; noRef?: boolean
  onLink?: (quote: string, page: number) => void
}

export function PdfSidePanel() {
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [width, setWidth] = useState(560)
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
  const orientation: 'bottom' | 'side' = isWide ? storedOrient : 'bottom'

  const open = !!(viewing || error || loading)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenPdfDetail>).detail
      if (!detail?.citekey) return
      setError(null)
      setViewing(null)
      setLoading(true)
      void (async () => {
        const data = await getPdfData(detail.citekey)
        setLoading(false)
        if (!data) { setError('Couldn’t load this source’s PDF (no embedded file, or the URL didn’t load).'); return }
        const page = detail.page && detail.page > 0 ? detail.page : 1
        setViewing({ data, page, quote: detail.quote ?? null, label: detail.label || detail.citekey, citekey: detail.citekey, instanceId: detail.instanceId ?? null, context: detail.context ?? null, noRef: detail.noRef ?? false, onLink: detail.onLink })
      })()
    }
    window.addEventListener(OPEN_PDF_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PDF_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // On a BOTTOM-docked PDF (phone / narrow / half-screen), tapping back into the editor drops the PDF
  // back down so you can read/type — like coming "back" to the page. Armed after a short delay so the
  // very tap that opened the PDF (on an in-text citation) doesn't immediately close it.
  useEffect(() => {
    if (!open || orientation !== 'bottom') return
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return
    let armed = false
    const arm = setTimeout(() => { armed = true }, 600)
    const onEditorInteract = () => { if (armed) close() }
    pm.addEventListener('pointerdown', onEditorInteract)
    pm.addEventListener('focusin', onEditorInteract)
    return () => { clearTimeout(arm); pm.removeEventListener('pointerdown', onEditorInteract); pm.removeEventListener('focusin', onEditorInteract) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orientation])

  // Make room: side → padding-right; bottom → padding-bottom (+ shift the footer toolbar up).
  useEffect(() => {
    const root = document.documentElement
    const set = (side: string, bottom: string) => {
      root.style.setProperty('--iw-pdf-room', side)
      root.style.setProperty('--iw-pdf-room-bottom', bottom)
    }
    if (!open) set('0px', '0px')
    else if (orientation === 'side') set(`${width}px`, '0px')
    else set('0px', `${height}px`)
    return () => set('0px', '0px')
  }, [open, orientation, width, height])

  function close() { setViewing(null); setError(null); setLoading(false) }
  function toggleOrient() {
    setStoredOrient(o => {
      const next = o === 'side' ? 'bottom' : 'side'
      try { localStorage.setItem(ORIENT_KEY, next) } catch { /* private mode */ }
      return next
    })
  }

  if (!open) return null

  const side = orientation === 'side'
  const panelPos: React.CSSProperties = side
    ? { top: 0, right: 0, bottom: 0, width, maxWidth: '100vw', borderLeft: `1px solid ${INK}33`, boxShadow: '-4px 0 24px rgba(0,0,0,0.18)' }
    : { left: 0, right: 0, bottom: 0, height, maxHeight: '92vh', borderTop: `1px solid ${INK}33`, boxShadow: '0 -4px 24px rgba(0,0,0,0.18)' }
  const handlePos: React.CSSProperties = side
    ? { left: 0, top: 0, bottom: 0, width: 10, cursor: 'col-resize' }
    : { left: 0, right: 0, top: 0, height: 10, cursor: 'row-resize' }

  return (
    <>
      <div style={{ position: 'fixed', zIndex: 80, background: '#fff', display: 'flex', flexDirection: 'column', ...panelPos }}>
        {/* Resize handle on the edge facing the editor */}
        <div
          onPointerDown={e => {
            e.preventDefault()
            dragStart.current = side ? { axis: 'x', start: e.clientX, size: width } : { axis: 'y', start: e.clientY, size: height }
            setDragging(true)
          }}
          title="Drag to resize"
          style={{ position: 'absolute', zIndex: 2, background: dragging ? `${INK}22` : 'transparent', ...handlePos }}
        />

        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
          padding: side ? '8px 12px 8px 16px' : '8px 12px', borderBottom: `1px solid ${INK}22`, background: '#faf8fc',
        }}>
          <span style={{ fontSize: '0.8rem', color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📄 {viewing?.label ?? 'PDF'}
          </span>
          {viewing && (
            <span style={{ fontSize: '0.68rem', color: '#9ca3af', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              select text to highlight{viewing.onLink ? ' or link' : ''}
            </span>
          )}
          {isWide && (
            <button type="button" onClick={toggleOrient}
              style={{ marginLeft: 'auto', border: `1px solid ${INK}33`, background: 'transparent', color: INK, fontSize: '0.72rem', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
              title={side ? 'Dock to bottom' : 'Dock to the side'}>
              {side ? '▭ bottom' : '▯ side'}
            </button>
          )}
          <button type="button" onClick={close}
            style={{ marginLeft: isWide ? 4 : 'auto', border: 'none', background: 'transparent', color: '#78716c', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}
            title="Close (Esc)">×</button>
        </div>

        {loading && !viewing ? (
          <div style={{ padding: '1.5rem', fontSize: '0.85rem', color: '#9ca3af' }}>Loading PDF…</div>
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
            if (d.axis === 'x') setWidth(Math.max(MIN_W, Math.min(window.innerWidth - 80, d.size + (d.start - e.clientX))))
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
