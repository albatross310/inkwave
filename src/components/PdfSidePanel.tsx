// App-level side panel that shows an embedded source PDF at the page cited in-text. Mounted once in
// the editor; listens for the 'inkwave:open-pdf' event (see citations/pdfViewer.ts), loads the PDF
// bytes from OPFS, and shows them in an <iframe> using the browser's native viewer with a #page=N
// fragment. No pdf.js dependency — the built-in viewer honours #page for blob: URLs.
//
// While open it sets --iw-pdf-room so the editor surface pads its right edge and the writing slides
// left to make room (see styles/index.css). Resizing drags a full-viewport overlay (portaled above
// the iframe) — an iframe otherwise swallows the mousemove/up, leaving the drag stuck to the cursor.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadPdf } from '../citations/pdfStore'
import { OPEN_PDF_EVENT, type OpenPdfDetail } from '../citations/pdfViewer'

const INK = '#5c2d8a'
const MIN_W = 320

interface Viewing { url: string; page: number; label: string; citekey: string }

export function PdfSidePanel() {
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(480)
  const [dragging, setDragging] = useState(false)
  const urlRef = useRef<string | null>(null)
  const dragStart = useRef<{ x: number; w: number } | null>(null)

  const open = !!(viewing || error)
  const revoke = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null } }

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenPdfDetail>).detail
      if (!detail?.citekey) return
      setError(null)
      void (async () => {
        const blob = await loadPdf(detail.citekey)
        if (!blob) { setError('No PDF is embedded for this source.'); setViewing(null); return }
        revoke()
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        const page = detail.page && detail.page > 0 ? detail.page : 1
        setViewing({ url, page, label: detail.label || detail.citekey, citekey: detail.citekey })
      })()
    }
    window.addEventListener(OPEN_PDF_EVENT, onOpen)
    return () => { window.removeEventListener(OPEN_PDF_EVENT, onOpen); revoke() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Push the editor over to make room (padding-right on .inkwave-editor-surface reads this var).
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--iw-pdf-room', open ? `${width}px` : '0px')
    return () => { root.style.setProperty('--iw-pdf-room', '0px') }
  }, [open, width])

  function close() { revoke(); setViewing(null); setError(null) }

  if (!open) return null

  return (
    <>
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 80,
        width, maxWidth: '100vw', background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
        borderLeft: `1px solid ${INK}33`,
      }}>
        {/* Drag handle — a grabbable strip on the panel's left edge */}
        <div
          onPointerDown={e => { e.preventDefault(); dragStart.current = { x: e.clientX, w: width }; setDragging(true) }}
          title="Drag to resize"
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 10, zIndex: 2,
            cursor: 'col-resize', background: dragging ? `${INK}22` : 'transparent',
          }}
        />

        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px 8px 16px', borderBottom: `1px solid ${INK}22`, background: '#faf8fc',
        }}>
          <span style={{ fontSize: '0.8rem', color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📄 {viewing?.label ?? 'PDF'}
          </span>
          {viewing && <span style={{ fontSize: '0.72rem', color: '#9ca3af', flexShrink: 0 }}>page {viewing.page}</span>}
          <button type="button" onClick={close}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#78716c', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}
            title="Close (Esc)">×</button>
        </div>

        {error ? (
          <div style={{ padding: '1.5rem', fontSize: '0.85rem', color: '#b45309' }}>{error}</div>
        ) : viewing ? (
          <iframe
            key={`${viewing.citekey}#${viewing.page}`}
            title={`PDF: ${viewing.label}`}
            src={`${viewing.url}#page=${viewing.page}&view=FitH`}
            style={{ flex: 1, width: '100%', border: 'none', pointerEvents: dragging ? 'none' : 'auto' }}
          />
        ) : null}
      </div>

      {/* Drag overlay — portaled to body so it sits ABOVE the iframe; the iframe would otherwise eat
          the pointer events and leave the drag stuck to the cursor. */}
      {dragging && createPortal(
        <div
          onPointerMove={e => {
            if (!dragStart.current) return
            const next = dragStart.current.w + (dragStart.current.x - e.clientX)
            setWidth(Math.max(MIN_W, Math.min(window.innerWidth - 80, next)))
          }}
          onPointerUp={() => { dragStart.current = null; setDragging(false) }}
          onPointerCancel={() => { dragStart.current = null; setDragging(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: 'col-resize' }}
        />,
        document.body,
      )}
    </>
  )
}
