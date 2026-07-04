// pdf.js-based PDF viewer with a selectable text layer, persistent highlight overlays, and
// select-a-sentence → link-to-citation. Renders pages the way pdf.js expects
// (.pdfViewer > .page > .canvasWrapper + .textLayer) so the official pdf_viewer.css (lazy-imported)
// drives text-layer positioning/selection. Highlights are our own overlay divs (normalised rects),
// stored on the source's _iw.highlights — not baked into the PDF.

import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getPdfjs } from '../citations/pdfjsSetup'
import { highlightsOf, saveHighlights, type PdfHighlight, type HighlightRect } from '../citations/pdfHighlights'
import { bibProvider } from '../citations/bibProvider'

const INK = '#5c2d8a'
const COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6', '#d0bcff']

interface PageRef { wrapper: HTMLDivElement; hlLayer: HTMLDivElement; w: number; h: number }
interface Pending { text: string; page: number; rects: HighlightRect[]; x: number; y: number }

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
  const [pending, setPending] = useState<Pending | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // ── Draw saved highlight overlays into each page's highlight layer ──
  const redrawOverlays = () => {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pg = pagesRef.current[i]
      pg.hlLayer.textContent = ''
      for (const hl of highlightsRef.current) {
        if (hl.page !== i + 1) continue
        for (const r of hl.rects) {
          const div = document.createElement('div')
          div.style.cssText = `position:absolute;left:${r.x * pg.w}px;top:${r.y * pg.h}px;width:${r.w * pg.w}px;height:${r.h * pg.h}px;background:${hl.color};opacity:0.4;border-radius:2px;pointer-events:auto;cursor:pointer;mix-blend-mode:multiply;`
          div.title = hl.note ? hl.note : (hl.citekey ? `Linked to ${hl.citekey}` : hl.text.slice(0, 80))
          div.dataset.hlId = hl.id
          pg.hlLayer.appendChild(div)
        }
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    const renderTasks: Array<{ cancel: () => void }> = []
    let loadingTask: { destroy: () => Promise<void> } | null = null
    highlightsRef.current = highlightsOf(bibProvider.get(citekey))

    void (async () => {
      setStatus('loading')
      try {
        const pdfjs = await getPdfjs()
        // pdf.js transfers the buffer to the worker; clone so the caller's ArrayBuffer stays usable.
        const task = pdfjs.getDocument({ data: data.slice(0) })
        loadingTask = task
        const doc = await task.promise
        if (cancelled) return

        const viewer = viewerRef.current!
        viewer.textContent = ''
        pagesRef.current = []

        const containerW = (scrollRef.current?.clientWidth ?? 800) - 24
        const first = await doc.getPage(1)
        const baseVp = first.getViewport({ scale: 1 })
        const scale = Math.max(0.4, Math.min(3, containerW / baseVp.width))
        const outputScale = window.devicePixelRatio || 1

        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return
          const page = await doc.getPage(n)
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
          const renderTask = page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          })
          renderTasks.push(renderTask)
          await renderTask.promise.catch(() => {})
          if (cancelled) return

          const tc = await page.getTextContent()
          if (cancelled) return
          const tl = new pdfjs.TextLayer({ textContentSource: tc, container: textLayer, viewport })
          await tl.render().catch(() => {})
        }

        if (cancelled) return
        redrawOverlays()
        setStatus('ready')

        // Jump to the cited page and flash the linked quote if we have one saved.
        requestAnimationFrame(() => {
          if (cancelled) return
          const pageIdx = Math.min(Math.max((initialPage ?? 1) - 1, 0), pagesRef.current.length - 1)
          pagesRef.current[pageIdx]?.wrapper.scrollIntoView({ block: 'start' })
          if (initialQuote) flashQuote(initialQuote)
        })
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      for (const t of renderTasks) { try { t.cancel() } catch { /* ignore */ } }
      if (loadingTask) { void loadingTask.destroy().catch(() => {}) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, citekey])

  // Scroll to + flash the highlight (or first text match) for a quote.
  function flashQuote(quote: string) {
    const hl = highlightsRef.current.find(h => h.text.trim() === quote.trim())
      ?? highlightsRef.current.find(h => h.text.includes(quote) || quote.includes(h.text))
    if (hl) {
      const pg = pagesRef.current[hl.page - 1]
      const r = hl.rects[0]
      if (pg && r) {
        const el = document.createElement('div')
        el.style.cssText = `position:absolute;left:${r.x * pg.w}px;top:${r.y * pg.h}px;width:${r.w * pg.w}px;height:${r.h * pg.h}px;outline:2px solid ${INK};border-radius:2px;pointer-events:none;`
        pg.hlLayer.appendChild(el)
        pg.wrapper.scrollIntoView({ block: 'center' })
        setTimeout(() => el.remove(), 1800)
      }
    }
  }

  // ── Selection → pending toolbar ──
  function onMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setPending(null); return }
    const text = sel.toString().trim()
    if (!text || !viewerRef.current?.contains(sel.anchorNode)) { setPending(null); return }
    const range = sel.getRangeAt(0)
    const clientRects = Array.from(range.getClientRects())
    if (!clientRects.length) { setPending(null); return }

    // Group rects by page and normalise to that page's box.
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
    const scrollBox = scrollRef.current!.getBoundingClientRect()
    setPending({ text, page, rects, x: last.right - scrollBox.left, y: last.bottom - scrollBox.top })
  }

  async function commitHighlight(color: string, link: boolean) {
    if (!pending) return
    const hl: PdfHighlight = {
      id: uuidv4(), page: pending.page, rects: pending.rects, color,
      text: pending.text, createdAt: new Date().toISOString(),
      ...(link ? { citekey } : {}),
    }
    highlightsRef.current = [...highlightsRef.current, hl]
    redrawOverlays()
    window.getSelection()?.removeAllRanges()
    setPending(null)
    await saveHighlights(citekey, highlightsRef.current)
    if (link) onLinkToCitation?.(pending.text, pending.page)
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={scrollRef}
        onMouseUp={onMouseUp}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e9e7e3', padding: 12 }}
      >
        <div ref={viewerRef} className="pdfViewer" style={{ '--scale-factor': 1 } as React.CSSProperties} />
        {status === 'loading' && <p style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>Loading PDF…</p>}
        {status === 'error' && <p style={{ textAlign: 'center', color: '#b45309', marginTop: 40 }}>Couldn't render this PDF.</p>}
      </div>

      {pending && (
        <div style={{
          position: 'absolute', left: Math.max(8, Math.min(pending.x, (scrollRef.current?.clientWidth ?? 400) - 220)),
          top: pending.y + 6, zIndex: 20,
          background: '#fff', border: `1px solid ${INK}44`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6,
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
