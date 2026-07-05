// pdf.js-based PDF viewer with a selectable text layer, persistent highlight overlays, and
// select-a-sentence → link-to-citation. Renders pages the way pdf.js expects
// (.pdfViewer > .page > .canvasWrapper + .textLayer) so the official pdf_viewer.css (lazy-imported)
// drives text-layer positioning/selection. Highlights are our own overlay divs (normalised rects),
// stored on the source's _iw.highlights — not baked into the PDF.

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getPdfjs, PDF_DOC_PARAMS } from '../citations/pdfjsSetup'
import { highlightsOf, saveHighlights, type PdfHighlight, type HighlightRect, type HighlightKind } from '../citations/pdfHighlights'
import { pageOffsetOf } from '../citations/pageOffset'
import { bibProvider } from '../citations/bibProvider'
import type { IwCitationMeta } from '../types/document'

const INK = '#5c2d8a'
const COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6', '#d0bcff']
const TOOLS: Array<{ kind: HighlightKind; label: string; title: string }> = [
  { kind: 'highlight', label: '▮', title: 'Highlight' },
  { kind: 'underline', label: 'U', title: 'Underline' },
  { kind: 'strike', label: 'S', title: 'Strikethrough' },
  { kind: 'text', label: 'T', title: 'Text note — click on the page to place' },
]
const ZOOM_MIN = 0.4, ZOOM_MAX = 4

interface PageRef {
  wrapper: HTMLDivElement; canvasWrap: HTMLDivElement; textLayer: HTMLDivElement; hlLayer: HTMLDivElement
  w: number; h: number
  page: any; viewport: any // eslint-disable-line @typescript-eslint/no-explicit-any
  rendered: boolean; rendering: boolean
}
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
  const observerRef = useRef<IntersectionObserver | null>(null)
  const highlightsRef = useRef<PdfHighlight[]>([])
  const docRef = useRef<PdfDoc | null>(null)
  const fitScaleRef = useRef(1)
  const renderTokenRef = useRef(0)
  const hoverRef = useRef(false)
  const offsetRef = useRef(0)          // printed page = sheet + offset
  const printedKnownRef = useRef(false) // true when Haiku verified the offset
  const [pending, setPending] = useState<Pending | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<HighlightKind | null>(null) // active markup mode (null = off)
  const [color, setColor] = useState(COLORS[0])
  const toolRef = useRef<HighlightKind | null>(null); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color

  const removeHighlight = (id: string) => {
    highlightsRef.current = highlightsRef.current.filter(h => h.id !== id)
    redrawOverlays()
    void saveHighlights(citekey, highlightsRef.current)
  }

  function redrawOverlays() {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pg = pagesRef.current[i]
      pg.hlLayer.textContent = ''
      // Measure the overlay layer itself — the SAME box selections are normalised against — so nothing
      // (a page border, padding, sub-pixel rounding) can offset highlights from the text.
      const pw = pg.hlLayer.clientWidth || pg.w, ph = pg.hlLayer.clientHeight || pg.h
      for (const hl of highlightsRef.current) {
        if (hl.page !== i + 1) continue
        const kind = hl.kind ?? 'highlight'
        if (kind === 'text') {
          const r0 = hl.rects[0]
          if (!r0) continue
          const note = document.createElement('div')
          note.style.cssText = `position:absolute;left:${r0.x * pw}px;top:${r0.y * ph}px;max-width:42%;background:${hl.color};border:1px solid rgba(0,0,0,0.2);border-radius:4px;padding:3px 6px;font-size:12px;line-height:1.35;color:#2a2a2a;pointer-events:auto;cursor:text;box-shadow:0 1px 4px rgba(0,0,0,0.22);z-index:2;font-family:system-ui,sans-serif;white-space:pre-wrap;`
          note.textContent = hl.note || hl.text
          note.title = 'Click to edit (blank to delete)'
          note.onclick = () => {
            const v = window.prompt('Edit note (leave blank to delete):', hl.note || hl.text)
            if (v === null) return
            if (!v.trim()) { removeHighlight(hl.id); return }
            hl.note = v.trim(); hl.text = v.trim()
            redrawOverlays()
            void saveHighlights(citekey, highlightsRef.current)
          }
          pg.hlLayer.appendChild(note)
          continue
        }
        for (const r of hl.rects) {
          const div = document.createElement('div')
          const left = r.x * pw, top = r.y * ph, w = r.w * pw, h = r.h * ph
          let paint: string
          if (kind === 'underline') paint = `left:${left}px;top:${top + h - 2}px;width:${w}px;height:2px;background:${hl.color};`
          else if (kind === 'strike') paint = `left:${left}px;top:${top + h / 2 - 1}px;width:${w}px;height:2px;background:${hl.color};`
          else paint = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;background:${hl.color};opacity:0.4;border-radius:2px;mix-blend-mode:multiply;`
          // pointer-events:none so the text underneath stays selectable and a click never deletes it.
          div.style.cssText = `position:absolute;${paint}pointer-events:none;`
          div.title = hl.note || (hl.citekey ? `Linked to ${hl.citekey}` : hl.text.slice(0, 80))
          pg.hlLayer.appendChild(div)
        }
        // Small delete handle at the annotation's start — the ONLY way to remove it (no accidental
        // click-to-delete). Subtle by default, solid on hover.
        const r0 = hl.rects[0]
        if (r0) {
          const x = document.createElement('button')
          x.textContent = '×'
          x.title = 'Remove annotation'
          x.style.cssText = `position:absolute;left:${r0.x * pw - 7}px;top:${r0.y * ph - 9}px;width:16px;height:16px;padding:0;line-height:14px;text-align:center;border-radius:50%;border:1px solid ${INK}66;background:#fff;color:${INK};cursor:pointer;font-size:12px;opacity:0.35;transition:opacity 120ms;pointer-events:auto;z-index:2;`
          x.onmouseenter = () => { x.style.opacity = '1' }
          x.onmouseleave = () => { x.style.opacity = '0.35' }
          x.onclick = e => { e.stopPropagation(); removeHighlight(hl.id) }
          pg.hlLayer.appendChild(x)
        }
      }
    }
  }

  // Paint one page's canvas + text layer on demand (called by the IntersectionObserver). Placeholder
  // sizes are already correct, so this never reflows — which is also what stops the open-scroll snap.
  async function renderOnePage(idx: number, token: number) {
    const pg = pagesRef.current[idx]
    if (!pg || pg.rendered || pg.rendering) return
    pg.rendering = true
    const pdfjs = await getPdfjs()
    if (token !== renderTokenRef.current) { pg.rendering = false; return }
    // Supersample: render the canvas at ≥2× the CSS size and let the browser downscale, so PDF text
    // stays crisp even on 1× displays (or setups that under-report devicePixelRatio). But the viewport
    // already grows with zoom, so cap the canvas at 4096px/side to bound memory — supersampling then
    // only adds resolution where the page is still small (the default fit view, where the blur shows).
    const MAX_CANVAS = 4096
    const outputScale = Math.max(1, Math.min(
      3, Math.max(2, window.devicePixelRatio || 1),
      MAX_CANVAS / pg.viewport.width, MAX_CANVAS / pg.viewport.height,
    ))
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(pg.viewport.width * outputScale)
    canvas.height = Math.floor(pg.viewport.height * outputScale)
    canvas.style.cssText = `width:${Math.floor(pg.viewport.width)}px;height:${Math.floor(pg.viewport.height)}px;display:block;`
    pg.canvasWrap.appendChild(canvas)
    await pg.page.render({
      canvas, canvasContext: canvas.getContext('2d')!, viewport: pg.viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    }).promise.catch(() => {})
    if (token !== renderTokenRef.current) return
    const tc = await pg.page.getTextContent()
    if (token !== renderTokenRef.current) return
    await new pdfjs.TextLayer({ textContentSource: tc, container: pg.textLayer, viewport: pg.viewport }).render().catch(() => {})
    pg.rendered = true
  }

  // Build placeholders (correct sizes, cheap) for every page, then let an IntersectionObserver paint
  // pages only as they scroll near the viewport. This keeps a big PDF from blocking the main thread.
  const renderPages = useCallback(async (scale: number) => {
    const doc = docRef.current
    const viewer = viewerRef.current
    if (!doc || !viewer) return
    const token = ++renderTokenRef.current
    const pdfjs = await getPdfjs()
    if (token !== renderTokenRef.current) return
    observerRef.current?.disconnect()
    viewer.textContent = ''
    pagesRef.current = []

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      if (token !== renderTokenRef.current) return
      const viewport = page.getViewport({ scale })

      const pageEl = document.createElement('div')
      pageEl.className = 'page'
      pageEl.dataset.idx = String(n - 1)
      // border:0 / padding:0 override pdf.js's default .page border — otherwise the page's border box
      // (what selection rects are normalised against) and the inset:0 overlay layers disagree by the
      // border width, so highlights land down-and-right of the text.
      pageEl.style.cssText = `--scale-factor:${scale};--user-unit:1;position:relative;border:0;padding:0;width:${Math.floor(viewport.width)}px;height:${Math.floor(viewport.height)}px;margin:0 auto 12px;box-shadow:0 1px 6px rgba(0,0,0,0.18);background:#fff;`

      const canvasWrap = document.createElement('div')
      canvasWrap.className = 'canvasWrapper'
      canvasWrap.style.cssText = 'position:absolute;inset:0;'
      pageEl.appendChild(canvasWrap)

      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'
      pdfjs.setLayerDimensions(textLayer, viewport)
      pageEl.appendChild(textLayer)

      const hlLayer = document.createElement('div')
      hlLayer.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;'
      pageEl.appendChild(hlLayer)

      // Page label: the printed page (Haiku-detected) plus the native PDF sheet number.
      const label = document.createElement('div')
      label.style.cssText = 'position:absolute;bottom:4px;right:6px;z-index:3;font-size:10px;color:#78716c;background:rgba(255,255,255,0.78);border-radius:3px;padding:0 5px;pointer-events:none;font-family:system-ui,sans-serif;'
      label.textContent = printedKnownRef.current ? `p. ${n + offsetRef.current} · sheet ${n}` : `sheet ${n}`
      pageEl.appendChild(label)

      viewer.appendChild(pageEl)
      pagesRef.current.push({ wrapper: pageEl, canvasWrap, textLayer, hlLayer, w: viewport.width, h: viewport.height, page, viewport, rendered: false, rendering: false })
    }
    if (token !== renderTokenRef.current) return
    redrawOverlays()

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) void renderOnePage(Number((e.target as HTMLElement).dataset.idx), token)
      }
    }, { root: scrollRef.current, rootMargin: '800px 0px' })
    for (const pg of pagesRef.current) io.observe(pg.wrapper)
    observerRef.current = io
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load document (on open) → render at fit scale → scroll to the cited sentence ──
  useEffect(() => {
    let cancelled = false
    let loadingTask: { destroy: () => Promise<void> } | null = null
    const item0 = bibProvider.get(citekey)
    highlightsRef.current = highlightsOf(item0)
    offsetRef.current = pageOffsetOf(item0)
    printedKnownRef.current = (item0 as { _iw?: IwCitationMeta } | undefined)?._iw?.pageOffsetFlag === 'verified'
    setZoom(1)

    void (async () => {
      setStatus('loading')
      try {
        const pdfjs = await getPdfjs()
        const task = pdfjs.getDocument({ data: data.slice(0), ...PDF_DOC_PARAMS }) // slice: keep caller's buffer usable
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
        // Direct scroll (placeholder sizes are final, so no reflow to fight). Re-apply a couple of
        // times in case a late layout pass nudges it — but only while the user hasn't scrolled yet.
        let last = -1
        const settle = (n: number) => {
          if (cancelled) return
          if (last >= 0 && Math.abs((scrollRef.current?.scrollTop ?? 0) - last) > 4) return // user scrolled
          scrollToTarget()
          last = scrollRef.current?.scrollTop ?? 0
          if (n > 0) setTimeout(() => requestAnimationFrame(() => settle(n - 1)), 120)
        }
        requestAnimationFrame(() => settle(3))
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      renderTokenRef.current++       // supersede any in-flight render
      observerRef.current?.disconnect()
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

  // NB: no Ctrl+= keyboard zoom — the browser's own zoom can't be reliably blocked from a keydown, so
  // it would double-zoom (scale the PDF AND browser-zoom the page). Ctrl+wheel (below) + the on-screen
  // − / + buttons are the isolated zoom; Ctrl+= stays as normal browser zoom.

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
        top = toTop(pg, hl.rects[0].y * (pg.hlLayer.clientHeight || pg.h) - container.clientHeight / 2)
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
    const pw = pg.hlLayer.clientWidth || pg.w, ph = pg.hlLayer.clientHeight || pg.h
    el.style.cssText = `position:absolute;left:${r.x * pw}px;top:${r.y * ph}px;width:${r.w * pw}px;height:${r.h * ph}px;outline:2px solid ${INK};border-radius:2px;pointer-events:none;`
    pg.hlLayer.appendChild(el)
    setTimeout(() => el.remove(), 1800)
  }

  // Read the current selection into normalised, page-grouped rects (or null if none in the viewer).
  function selectionInfo(): Pending | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const text = sel.toString().trim()
    if (!text || !viewerRef.current?.contains(sel.anchorNode)) return null
    const clientRects = Array.from(sel.getRangeAt(0).getClientRects())
    if (!clientRects.length) return null
    let page = 1
    const rects: HighlightRect[] = []
    for (const cr of clientRects) {
      for (let i = 0; i < pagesRef.current.length; i++) {
        const pr = pagesRef.current[i].hlLayer.getBoundingClientRect()
        const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
        if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
          page = i + 1
          rects.push({ x: (cr.left - pr.left) / pr.width, y: (cr.top - pr.top) / pr.height, w: cr.width / pr.width, h: cr.height / pr.height })
          break
        }
      }
    }
    if (!rects.length) return null
    const last = clientRects[clientRects.length - 1]
    const box = scrollRef.current!.getBoundingClientRect()
    return { text, page, rects, x: last.right - box.left, y: last.bottom - box.top }
  }

  function onMouseUp(e: React.MouseEvent) {
    const info = selectionInfo()
    // Text tool: a click (no selection) drops a note where you clicked.
    if (toolRef.current === 'text') {
      if (!info) placeTextNote(e.clientX, e.clientY)
      setPending(null)
      return
    }
    if (!info) { setPending(null); return }
    // A markup tool is active → apply it immediately (Firefox-style); otherwise offer the toolbar.
    if (toolRef.current) {
      void createHighlight(info, toolRef.current, colorRef.current, false)
      window.getSelection()?.removeAllRanges()
      setPending(null)
    } else {
      setPending(info)
    }
  }

  function placeTextNote(clientX: number, clientY: number) {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pr = pagesRef.current[i].wrapper.getBoundingClientRect()
      if (clientX < pr.left || clientX > pr.right || clientY < pr.top || clientY > pr.bottom) continue
      const text = window.prompt('Note:')?.trim()
      if (!text) return
      const hl: PdfHighlight = {
        id: uuidv4(), page: i + 1, color: colorRef.current, kind: 'text', text, note: text,
        rects: [{ x: (clientX - pr.left) / pr.width, y: (clientY - pr.top) / pr.height, w: 0.22, h: 0.05 }],
        createdAt: new Date().toISOString(),
      }
      highlightsRef.current = [...highlightsRef.current, hl]
      redrawOverlays()
      void saveHighlights(citekey, highlightsRef.current)
      return
    }
  }

  async function createHighlight(info: Pending, kind: HighlightKind, color: string, link: boolean) {
    const hl: PdfHighlight = {
      id: uuidv4(), page: info.page, rects: info.rects, color, kind,
      text: info.text, createdAt: new Date().toISOString(), ...(link ? { citekey } : {}),
    }
    highlightsRef.current = [...highlightsRef.current, hl]
    redrawOverlays()
    await saveHighlights(citekey, highlightsRef.current)
    if (link) onLinkToCitation?.(info.text, info.page)
  }

  async function commitPending(color: string, link: boolean) {
    if (!pending) return
    const info = pending
    window.getSelection()?.removeAllRanges()
    setPending(null)
    await createHighlight(info, 'highlight', color, link)
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }}>

      {/* Persistent markup toolbar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: `1px solid ${INK}22`, background: '#faf8fc' }}>
        {TOOLS.map(t => {
          const active = tool === t.kind
          return (
            <button key={t.kind} type="button" title={`${t.title} — click, then select text`}
              onClick={() => setTool(active ? null : t.kind)}
              style={{
                width: 24, height: 22, borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
                border: `1px solid ${active ? INK : '#d6cfe0'}`, background: active ? `${INK}14` : '#fff',
                color: INK, textDecoration: t.kind === 'strike' ? 'line-through' : t.kind === 'underline' ? 'underline' : 'none',
              }}>{t.label}</button>
          )
        })}
        <span style={{ width: 1, height: 16, background: `${INK}22`, margin: '0 2px' }} />
        {COLORS.map(c => (
          <button key={c} type="button" title="Colour" onClick={() => setColor(c)}
            style={{ width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? `2px solid ${INK}` : '1px solid rgba(0,0,0,0.15)' }} />
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: '#a89db8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tool === 'text' ? 'click a page to add a note' : tool ? `select text to ${tool}` : 'pick a tool, or select text'}
        </span>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
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
            <button key={c} type="button" title="Highlight" onClick={() => void commitPending(c, false)}
              style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer' }} />
          ))}
          {onLinkToCitation && (
            <button type="button" onClick={() => void commitPending(colorRef.current, true)}
              style={{ fontSize: '0.72rem', color: '#fff', background: INK, border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ↳ Link to citation
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
