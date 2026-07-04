// App-level side panel that shows an embedded source PDF at the page cited in-text. Mounted once in
// the editor; listens for the 'inkwave:open-pdf' event (see citations/pdfViewer.ts), loads the PDF
// bytes from OPFS, and shows them in an <iframe> using the browser's native viewer with a #page=N
// fragment. No pdf.js dependency — the built-in viewer honours #page for blob: URLs.

import { useEffect, useRef, useState } from 'react'
import { loadPdf } from '../citations/pdfStore'
import { OPEN_PDF_EVENT, type OpenPdfDetail } from '../citations/pdfViewer'

const INK = '#5c2d8a'

interface Viewing { url: string; page: number; label: string; citekey: string }

export function PdfSidePanel() {
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(480)
  const urlRef = useRef<string | null>(null)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && viewing) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing])

  function close() { revoke(); setViewing(null); setError(null) }

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      // Panel is anchored right; dragging left (smaller clientX) widens it.
      const next = dragRef.current.startW + (dragRef.current.startX - ev.clientX)
      setWidth(Math.max(320, Math.min(window.innerWidth - 120, next)))
    }
    const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!viewing && !error) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 80,
      width, maxWidth: '100vw', background: '#fff',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
      borderLeft: `1px solid ${INK}33`,
    }}>
      {/* Drag handle on the left edge */}
      <div onMouseDown={startDrag} title="Drag to resize"
        style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 }} />

      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: `1px solid ${INK}22`, background: '#faf8fc',
      }}>
        <span style={{ fontSize: '0.8rem', color: INK, fontWeight: 600 }}>📄 {viewing?.label ?? 'PDF'}</span>
        {viewing && <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>page {viewing.page}</span>}
        <button type="button" onClick={close}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#78716c', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer' }}
          title="Close (Esc)">×</button>
      </div>

      {error ? (
        <div style={{ padding: '1.5rem', fontSize: '0.85rem', color: '#b45309' }}>{error}</div>
      ) : viewing ? (
        <iframe
          key={`${viewing.citekey}#${viewing.page}`}
          title={`PDF: ${viewing.label}`}
          src={`${viewing.url}#page=${viewing.page}&view=FitH`}
          style={{ flex: 1, width: '100%', border: 'none' }}
        />
      ) : null}
    </div>
  )
}
