// pdf.js-based PDF viewer with a selectable text layer, persistent highlight overlays, and
// select-a-sentence → link-to-citation. Renders pages the way pdf.js expects
// (.pdfViewer > .page > .canvasWrapper + .textLayer) so the official pdf_viewer.css (lazy-imported)
// drives text-layer positioning/selection. Highlights are our own overlay divs (normalised rects),
// stored on the source's _iw.highlights — not baked into the PDF.

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getPdfjs } from '../citations/pdfjsSetup'
import { highlightsOf, saveHighlights, type PdfHighlight, type HighlightRect } from '../citations/pdfHighlights'
import { bibProvider } from '../citations/bibProvider'

const INK = '#5c2d8a'
const COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6', '#d0bcff']
const ZOOM_MIN = 0.4, ZOOM_MAX = 4

interface PageRef { wrapper: HTMLDivElement; hlLayer: HTMLDivElement; w: number; h: number }
interface Pending { text: string; page: number; rects: HighlightRect[]; x: number; y: number }
// Minimal shape of the bits of pdf.js we touch (avoids depending on its exported types here).
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any> } // eslint-disable-line @typescript-eslint/no-explicit-any

export function PdfViewer({ data, citekey, initialPage, initialQuote, onLinkToCitation }: {
  data: ArrayBuffer
  citekey: string
  initialPage?: number
  initialQuote?: string | null
  onLinkToCitation?: (quote: string, page: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<PageRef[]>([])
  const highlightsRef = useRef<PdfHighlight[]>([])
  const docRef = useRef<PdfDoc | null>(null)
  const fitScaleRef = useRef(1)
  const renderTokenRef = useRef(0)
  const hoverRef = useRef(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)

  const redrawOverlays = useCallback(() => {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pg = pagesRef.current[i]
      pg.hlLayer.textContent = ''
      for (const hl of highlightsRef.current) {
        if (hl.page !== i + 1) continue
        for (const r of hl.rects) {
          const div = document.createElement('div')
          div.style.cssText = `position:absolute;left:${r.x * pg.w}px;top:${r.y * pg.h}px;width:${r.w * pg.w}px;height:${r.h * pg.h}px;background:${hl.color};opacity:0.4;border-radius:2px;pointer-events:auto;cursor:pointer;mix-blend-mode:multiply;`
          div.title = hl.note || (hl.citekey ? `Linked to ${hl.citekey}` : hl.text.slice(0, 80))
          pg.hlLayer.appendChild(div)
        }
      }
    }
  }, [])

  // Render every page at `scale`. Cancellable via a token so a zoom/reopen supersedes an in-flight run.
  const renderPages = useCallback(async (scale: number) => {
    const doc = docRef.current
    const viewer = viewerRef.current
    if (!doc || !viewer) return
    const token = ++renderTokenRef.current
    const pdfjs = await getPdfjs()
    if (token !== renderTokenRef.current) return
    viewer.textContent = ''
    pagesRef.current = []
    const outputScale = window.devicePixelRatio || 1

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      if (token !== renderTokenRef.current) return
      const viewport = page.getViewport({ scale })

      const pageEl = document.createElement('div')
      pageEl.className = 'page'
      pageEl.style.cssText = `--scale-factor:${scale};--user-unit:1;position:relative;width:${Math.floor(viewport.width)}px;height:${Math.floor(viewport.height)}px;margin:0 auto 12px;box-shadow:0 1px 6px rgba(0,0,0,0.18);background:#fff;`

      const canvasWrap = document.createElement('div')
      canvasWrap.className = 'canvasWrapper'
      canvasWrap.style.cssText = 'position:absolute;inset:0;'
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.cssText = `width:${Math.floor(viewport.width)}px;height:${Math.floor(viewport.height)}px;display:block;`
      canvasWrap.appendChild(canvas)
      pageEl.appendChild(canvasWrap)

      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'
      pdfjs.setLayerDimensions(textLayer, viewport)
      pageEl.appendChild(textLayer)

      const hlLayer = document.createElement('div')
      hlLayer.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;'
      pageEl.appendChild(hlLayer)

      viewer.appendChild(pageEl)
      pagesRef.current.push({ wrapper: pageEl, hlLayer, w: viewport.width, h: viewport.height })

      const ctx = canvas.getContext('2d')!
      await page.render({
        canvas, canvasContext: ctx, viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      }).promise.catch(() => {})
      if (token !== renderTokenRef.current) return

      const tc = await page.getTextContent()
      if (token !== renderTokenRef.current) return
      await new pdfjs.TextLayer({ textContentSource: tc, container: textLayer, viewport }).render().catch(() => {})
    }
    if (token === renderTokenRef.current) redrawOverlays()
  }, [redrawOverlays])

  // ── Load document (on open) → render at fit scale → scroll to the cited sentence ──
  useEffect(() => {
    let cancelled = false
    let loadingTask: { destroy: () => Promise<void> } | null = null
    highlightsRef.current = highlightsOf(bibProvider.get(citekey))
    setZoom(1)

    void (async () => {
      setStatus('loading')
      try {
        const pdfjs = await getPdfjs()
        const task = pdfjs.getDocument({ data: data.slice(0) }) // slice: keep caller's buffer usable
        loadingTask = task
        const doc = await task.promise
        if (cancelled) return
        docRef.current = doc as PdfDoc

        const containerW = (scrollRef.current?.clientWidth ?? 800) - 24
        const baseVp = (await doc.getPage(1)).getViewport({ scale: 1 })
        fitScaleRef.current = Math.max(ZOOM_MIN, Math.min(3, containerW / baseVp.width))

        await renderPages(fitScaleRef.current)
        if (cancelled) return
        setStatus('ready')
        // One deferred, direct scroll (no scrollIntoView, which was double-firing and snapping back).
        requestAnimationFrame(() => { if (!cancelled) scrollToTarget() })
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      renderTokenRef.current++       // supersede any in-flight render
      docRef.current = null
      if (loadingTask) void loadingTask.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, citekey])

  // ── Zoom: re-render at fitScale*zoom, preserving the scroll ratio ──
  useEffect(() => {
    if (!docRef.current || status !== 'ready') return
    const el = scrollRef.current!
    const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
    void renderPages(fitScaleRef.current * zoom).then(() => {
      requestAnimationFrame(() => { el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // ── Ctrl/Cmd +/-/0 zoom (when the pointer is over the panel) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current || !(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(z => Math.min(ZOOM_MAX, z * 1.2)) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(z => Math.max(ZOOM_MIN, z / 1.2)) }
      else if (e.key === '0') { e.preventDefault(); setZoom(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ctrl/Cmd + wheel zoom (native listener so preventDefault works — React onWheel is passive).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * (e.deltaY < 0 ? 1.1 : 0.9))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function scrollToTarget() {
    const container = scrollRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const toTop = (pg: PageRef, extra = 0) =>
      container.scrollTop + (pg.wrapper.getBoundingClientRect().top - cRect.top) + extra
    let top: number | null = null
    if (initialQuote) {
      const hl = highlightsRef.current.find(h => h.text.trim() === initialQuote.trim())
        ?? highlightsRef.current.find(h => h.text.includes(initialQuote) || initialQuote.includes(h.text))
      const pg = hl ? pagesRef.current[hl.page - 1] : undefined
      if (hl && pg && hl.rects[0]) {
        top = toTop(pg, hl.rects[0].y * pg.h - container.clientHeight / 2)
        flashRect(pg, hl.rects[0])
      }
    }
    if (top == null) {
      const idx = Math.min(Math.max((initialPage ?? 1) - 1, 0), pagesRef.current.length - 1)
      const pg = pagesRef.current[idx]
      if (pg) top = toTop(pg)
    }
    if (top != null) container.scrollTop = Math.max(0, top)
  }

  function flashRect(pg: PageRef, r: HighlightRect) {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:${r.x * pg.w}px;top:${r.y * pg.h}px;width:${r.w * pg.w}px;height:${r.h * pg.h}px;outline:2px solid ${INK};border-radius:2px;pointer-events:none;`
    pg.hlLayer.appendChild(el)
    setTimeout(() => el.remove(), 1800)
  }

  function onMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setPending(null); return }
    const text = sel.toString().trim()
    if (!text || !viewerRef.current?.contains(sel.anchorNode)) { setPending(null); return }
    const clientRects = Array.from(sel.getRangeAt(0).getClientRects())
    if (!clientRects.length) { setPending(null); return }
    let page = 1
    const rects: HighlightRect[] = []
    for (const cr of clientRects) {
      for (let i = 0; i < pagesRef.current.length; i++) {
        const pr = pagesRef.current[i].wrapper.getBoundingClientRect()
        const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
        if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
          page = i + 1
          rects.push({ x: (cr.left - pr.left) / pr.width, y: (cr.top - pr.top) / pr.height, w: cr.width / pr.width, h: cr.height / pr.height })
          break
        }
      }
    }
    if (!rects.length) { setPending(null); return }
    const last = clientRects[clientRects.length - 1]
    const box = scrollRef.current!.getBoundingClientRect()
    setPending({ text, page, rects, x: last.right - box.left, y: last.bottom - box.top })
  }

  async function commitHighlight(color: string, link: boolean) {
    if (!pending) return
    const hl: PdfHighlight = {
      id: uuidv4(), page: pending.page, rects: pending.rects, color,
      text: pending.text, createdAt: new Date().toISOString(), ...(link ? { citekey } : {}),
    }
    highlightsRef.current = [...highlightsRef.current, hl]
    redrawOverlays()
    window.getSelection()?.removeAllRanges()
    const linkedText = pending.text, linkedPage = pending.page
    setPending(null)
    await saveHighlights(citekey, highlightsRef.current)
    if (link) onLinkToCitation?.(linkedText, linkedPage)
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}
      onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }}>
      <div ref={scrollRef} onMouseUp={onMouseUp}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e9e7e3', padding: 12 }}>
        <div ref={viewerRef} className="pdfViewer" style={{ '--scale-factor': 1 } as React.CSSProperties} />
        {status === 'loading' && <p style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>Loading PDF…</p>}
        {status === 'error' && <p style={{ textAlign: 'center', color: '#b45309', marginTop: 40 }}>Couldn't render this PDF.</p>}
      </div>

      {/* Zoom controls */}
      <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 15, display: 'flex', gap: 4, background: '#fff', border: `1px solid ${INK}33`, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: 2 }}>
        {([['−', () => setZoom(z => Math.max(ZOOM_MIN, z / 1.2))], [`${Math.round(zoom * 100)}%`, () => setZoom(1)], ['+', () => setZoom(z => Math.min(ZOOM_MAX, z * 1.2))]] as const).map(([label, fn], i) => (
          <button key={i} type="button" onClick={fn}
            style={{ minWidth: label.length > 2 ? 44 : 26, height: 26, border: 'none', background: 'transparent', color: INK, cursor: 'pointer', fontSize: '0.8rem', borderRadius: 5 }}
            title={label === '+' ? 'Zoom in (Ctrl +)' : label === '−' ? 'Zoom out (Ctrl −)' : 'Reset zoom (Ctrl 0)'}>
            {label}
          </button>
        ))}
      </div>

      {pending && (
        <div style={{
          position: 'absolute', left: Math.max(8, Math.min(pending.x, (scrollRef.current?.clientWidth ?? 400) - 220)),
          top: pending.y + 6, zIndex: 20, background: '#fff', border: `1px solid ${INK}44`, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {COLORS.map(c => (
            <button key={c} type="button" title="Highlight" onClick={() => void commitHighlight(c, false)}
              style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer' }} />
          ))}
          {onLinkToCitation && (
            <button type="button" onClick={() => void commitHighlight(COLORS[0], true)}
              style={{ fontSize: '0.72rem', color: '#fff', background: INK, border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ↳ Link to citation
            </button>
          )}
        </div>
      )}
    </div>
  )
}
