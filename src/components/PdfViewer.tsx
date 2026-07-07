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
type ToolKind = HighlightKind | 'erase'
const TOOLS: Array<{ kind: ToolKind; label: string; title: string }> = [
  { kind: 'highlight', label: '▮', title: 'Highlight' },
  { kind: 'underline', label: 'U', title: 'Underline' },
  { kind: 'strike', label: 'S', title: 'Strikethrough' },
  { kind: 'text', label: 'T', title: 'Text note — click on the page to place' },
  { kind: 'erase', label: '⌫', title: 'Eraser — click any annotation to remove it' },
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
  const [tool, setTool] = useState<ToolKind | null>(null) // active markup mode (null = off)
  const [color, setColor] = useState(COLORS[0])
  const [noteSize, setNoteSize] = useState<number>(() => { try { return Number(localStorage.getItem('inkwave:pdfNoteSize')) || 12 } catch { return 12 } })
  const toolRef = useRef<ToolKind | null>(null); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color
  const noteSizeRef = useRef(noteSize); noteSizeRef.current = noteSize

  // Find-in-PDF (Ctrl+F) — searches the real text layer, scrolls to matches, highlights them.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchInfo, setMatchInfo] = useState<{ cur: number; total: number }>({ cur: 0, total: 0 })
  const matchesRef = useRef<number[]>([]) // page index per match occurrence
  const searchBoxRef = useRef<HTMLInputElement>(null)

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
          // A text note is an EDITABLE box on the page — type directly into it (like Edge/Firefox),
          // no popup. Live-update the model on input (so a redraw keeps what you typed), persist on blur,
          // and delete if left blank. data-hl-id lets placeTextNote focus a freshly-created one.
          const note = document.createElement('div')
          note.dataset.hlId = hl.id
          note.spellcheck = false
          note.tabIndex = 0 // focusable in SELECT mode too, so Delete/Backspace can remove it
          // Two modes: SELECT (single-click → outline; Delete/Backspace removes the whole box) and EDIT
          // (double-click / Enter → type into it). Width + initial height come from the drag; it still
          // grows downward as you type. Empty notes get a dashed "type here" border.
          const emptyNote = !(hl.note || hl.text)
          const noteBorder = emptyNote ? `1.5px dashed ${INK}` : '1px solid rgba(0,0,0,0.2)'
          const minH = (r0.h || 0) > 0.001 ? `min-height:${Math.max(20, (r0.h || 0) * ph)}px;` : ''
          note.style.cssText = `position:absolute;left:${r0.x * pw}px;top:${r0.y * ph}px;width:${Math.max(60, (r0.w || 0.3) * pw)}px;${minH}background:${hl.color};border:${noteBorder};border-radius:4px;padding:3px 6px;font-size:${hl.size ?? 12}px;line-height:1.35;color:#2a2a2a;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.22);z-index:2;font-family:system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:break-word;outline:none;`
          note.textContent = hl.note || hl.text
          note.title = 'Click to select (Delete removes) · double-click to edit'
          const removeNote = () => {
            highlightsRef.current = highlightsRef.current.filter(h => h.id !== hl.id)
            redrawOverlays(); void saveHighlights(citekey, highlightsRef.current)
          }
          const enterEdit = () => {
            note.contentEditable = 'true'; note.style.cursor = 'text'; note.style.outline = `2px solid ${INK}`
            note.focus()
            const rng = document.createRange(); rng.selectNodeContents(note); rng.collapse(false)
            const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(rng)
          }
          note.addEventListener('click', () => { if (note.contentEditable !== 'true') { note.style.outline = `2px solid ${INK}`; note.focus() } })
          note.addEventListener('dblclick', enterEdit)
          note.addEventListener('input', () => { const v = note.textContent ?? ''; hl.note = v; hl.text = v })
          note.addEventListener('keydown', (ev) => {
            if (note.contentEditable === 'true') {
              ev.stopPropagation() // keep note typing out of the page/editor shortcuts
              if (ev.key === 'Escape') { ev.preventDefault(); note.blur() }
            } else {
              if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeNote() }
              else if (ev.key === 'Enter') { ev.preventDefault(); enterEdit() }
            }
          })
          note.addEventListener('blur', () => {
            note.style.outline = 'none'
            if (note.contentEditable !== 'true') return
            // Persist the box even if empty (it stays as a coloured, dashed placeholder) — clicking away
            // must NOT delete it; removal is explicit (select + Delete). This is why a freshly dragged
            // box used to vanish: it blurred empty and self-deleted.
            const v = (note.textContent ?? '').trim()
            hl.note = v; hl.text = v
            note.contentEditable = 'false'; note.style.cursor = 'pointer'
            void saveHighlights(citekey, highlightsRef.current)
          })
          if (editNoteIdRef.current === hl.id) { editNoteIdRef.current = null; requestAnimationFrame(enterEdit) }
          pg.hlLayer.appendChild(note)
          continue
        }
        if (kind === 'highlight') {
          // Group the annotation's per-line rects under ONE 0.4-opacity multiply layer. opacity<1
          // makes the group an isolation buffer, so its rects composite at FULL opacity among
          // themselves (overlapping consecutive-line rects just UNION) and the 0.4 multiply is applied
          // once to the union — instead of each rect multiplying separately and double-darkening the
          // middle lines where consecutive line rects overlap.
          const group = document.createElement('div')
          group.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0.4;mix-blend-mode:multiply;'
          for (const r of hl.rects) {
            const div = document.createElement('div')
            div.style.cssText = `position:absolute;left:${r.x * pw}px;top:${r.y * ph}px;width:${r.w * pw}px;height:${r.h * ph}px;background:${hl.color};border-radius:2px;`
            div.title = hl.note || (hl.citekey ? `Linked to ${hl.citekey}` : hl.text.slice(0, 80))
            group.appendChild(div)
          }
          pg.hlLayer.appendChild(group)
        } else {
          for (const r of hl.rects) {
            const div = document.createElement('div')
            const left = r.x * pw, top = r.y * ph, w = r.w * pw, h = r.h * ph
            const paint = kind === 'underline'
              ? `left:${left}px;top:${top + h - 2}px;width:${w}px;height:2px;background:${hl.color};`
              : `left:${left}px;top:${top + h / 2 - 1}px;width:${w}px;height:2px;background:${hl.color};`
            // pointer-events:none so the text underneath stays selectable and a click never deletes it.
            div.style.cssText = `position:absolute;${paint}pointer-events:none;`
            div.title = hl.note || (hl.citekey ? `Linked to ${hl.citekey}` : hl.text.slice(0, 80))
            pg.hlLayer.appendChild(div)
          }
        }
        // Small delete handle at the annotation's start — the ONLY way to remove it (no accidental
        // click-to-delete). Subtle by default, solid on hover.
        const r0 = hl.rects[0]
        if (r0) {
          const x = document.createElement('button')
          x.textContent = '×'
          x.title = 'Remove annotation'
          x.style.cssText = `position:absolute;left:${r0.x * pw - 7}px;top:${r0.y * ph - 9}px;width:16px;height:16px;padding:0;line-height:14px;text-align:center;border-radius:50%;border:1px solid #7f1d1d;background:#fff;color:#7f1d1d;font-weight:bold;cursor:pointer;font-size:12px;opacity:0.7;transition:opacity 120ms;pointer-events:auto;z-index:2;`
          x.onmouseenter = () => { x.style.opacity = '1' }
          x.onmouseleave = () => { x.style.opacity = '0.7' }
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
      const viewport = page.getViewport({ scale, rotation: rotationRef.current })

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

  // Freeze the CURRENT on-screen render into a fixed overlay of cloned canvases — a pixel-perfect
  // still of what the user sees right now. Used to cover the (brief) teardown+repaint on a zoom-settle
  // re-render so the page never blanks. Returns a remover.
  function freezeViewport(): () => void {
    const scroller = scrollRef.current
    if (!scroller) return () => {}
    const sRect = scroller.getBoundingClientRect()
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:fixed;left:${sRect.left}px;top:${sRect.top}px;width:${sRect.width}px;height:${sRect.height}px;z-index:5;pointer-events:none;overflow:hidden;`
    for (const pg of pagesRef.current) {
      const c = pg.canvasWrap.querySelector('canvas')
      if (!c) continue
      const r = c.getBoundingClientRect()
      if (r.bottom < sRect.top || r.top > sRect.bottom) continue // offscreen — skip
      const clone = document.createElement('canvas')
      clone.width = c.width; clone.height = c.height
      clone.style.cssText = `position:absolute;left:${r.left - sRect.left}px;top:${r.top - sRect.top}px;width:${r.width}px;height:${r.height}px;`
      clone.getContext('2d')?.drawImage(c, 0, 0)
      overlay.appendChild(clone)
    }
    document.body.appendChild(overlay)
    return () => overlay.remove()
  }

  // Synchronously render every page currently in the scroller viewport, and await them — so a caller
  // can guarantee the visible region is painted before revealing it.
  async function renderVisibleNow(token: number) {
    const scroller = scrollRef.current
    if (!scroller) return
    const sRect = scroller.getBoundingClientRect()
    const jobs: Promise<void>[] = []
    pagesRef.current.forEach((pg, idx) => {
      const r = pg.wrapper.getBoundingClientRect()
      if (r.bottom >= sRect.top - 200 && r.top <= sRect.bottom + 200) jobs.push(renderOnePage(idx, token))
    })
    await Promise.all(jobs)
  }

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
        renderedZoomRef.current = 1 // pages are drawn at fit (zoom 1) → baseline for the CSS-zoom ratio
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

  // Keyboard over the PDF viewer: Ctrl/Cmd+F opens the in-PDF find bar; Escape leaves the active markup
  // mode (and closes the find bar) — unless a note is being edited (its own handler eats Escape first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => { searchBoxRef.current?.focus(); searchBoxRef.current?.select() })
      } else if (e.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); clearFindHits() }
        if (toolRef.current) setTool(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen])

  // Citation "→ go": when a cited quote arrives (on open OR when a different citation targets the same
  // already-open PDF — the component doesn't remount then), open the find bar with the quote and run the
  // SAME search so it's visible + navigable (not just a silent highlight).
  useEffect(() => {
    if (status !== 'ready' || !initialQuote) return
    const t = setTimeout(() => {
      setSearchOpen(true)
      setSearchQuery(initialQuote)
      void findQuote(initialQuote)
    }, 160)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuote, status])

  // ── Zoom: re-render at fitScale*zoom, keeping the point UNDER THE CURSOR fixed ──
  // The wheel handler records the pointer position; we track the content fraction under it on both
  // axes and restore it after re-render, so zooming grows/shrinks around the cursor. The −/+ buttons
  // leave no pointer, so those fall back to the viewport centre.
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const rotationRef = useRef(0)                                      // 0/90/180/270 — user PDF rotation
  const renderedZoomRef = useRef(1)                                  // the zoom the canvases are drawn at
  const zoomSettleRef = useRef<ReturnType<typeof setTimeout>>()
  const zoomBaseRef = useRef<{ left: number; top: number } | null>(null) // untransformed viewer origin
  useEffect(() => {
    if (!docRef.current || status !== 'ready') return
    const el = scrollRef.current!, viewer = viewerRef.current
    if (!viewer) return
    const a = zoomAnchorRef.current
    // INSTANT visual zoom: CSS-scale the CURRENT render around the pointer — no clear, so the page
    // never goes blank. Capture the viewer's untransformed origin once per gesture (scroll is frozen
    // during Ctrl+wheel) so transform-origin stays correct across ticks.
    if (!zoomBaseRef.current) { const vr = viewer.getBoundingClientRect(); zoomBaseRef.current = { left: vr.left, top: vr.top } }
    const base = zoomBaseRef.current
    const ratio = zoom / renderedZoomRef.current
    const cx = a ? a.x : el.getBoundingClientRect().left + el.clientWidth / 2
    const cy = a ? a.y : el.getBoundingClientRect().top + el.clientHeight / 2
    viewer.style.transformOrigin = `${cx - base.left}px ${cy - base.top}px`
    viewer.style.transform = `scale(${ratio})`
    // Once the gesture settles, re-render SHARP at the new scale, then drop the CSS transform and
    // restore the pointer anchor. (The one re-render replaces the constant per-tick clear-and-blank.)
    clearTimeout(zoomSettleRef.current)
    zoomSettleRef.current = setTimeout(() => {
      const box = el.getBoundingClientRect()
      const ax = a ? a.x - box.left : el.clientWidth / 2
      const ay = a ? a.y - box.top  : el.clientHeight / 2
      // EXACT anchor: the content pixel under the cursor is (scroll+ax); at the new scale it's
      // (scroll+ax)*ratio, so scroll so it lands back at ax. This MATCHES the CSS transform above, so
      // dropping the transform for the sharp render causes no jump (the fraction estimate did — it
      // drifted a little each time, which read as flicker).
      const ratio = zoom / renderedZoomRef.current
      const sl = el.scrollLeft, st = el.scrollTop
      // Freeze the current view so the teardown+repaint below never shows a blank (the end-of-zoom
      // flash). The frozen still stays on top until the fresh, sharp visible pages are actually painted.
      const unfreeze = freezeViewport()
      void renderPages(fitScaleRef.current * zoom).then(async () => {
        viewer.style.transform = ''
        viewer.style.transformOrigin = ''
        zoomBaseRef.current = null
        renderedZoomRef.current = zoom
        el.scrollLeft = Math.max(0, (sl + ax) * ratio - ax)
        el.scrollTop  = Math.max(0, (st + ay) * ratio - ay)
        await renderVisibleNow(renderTokenRef.current) // paint the visible pages BEFORE lifting the freeze
        requestAnimationFrame(() => requestAnimationFrame(unfreeze))
      }).catch(unfreeze)
    }, 170)
    return () => clearTimeout(zoomSettleRef.current)
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
      zoomAnchorRef.current = { x: e.clientX, y: e.clientY } // zoom around the pointer
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

  // ── Find in PDF ───────────────────────────────────────────────────────────────
  const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const searchPattern = (q: string) => new RegExp(normText(q).split(' ').filter(Boolean).map(escapeRe).join('\\s+'), 'gi')
  function clearFindHits() { document.querySelectorAll('.iw-pdf-find-hit').forEach(n => n.remove()) }

  // Search every page's text (via getTextContent — no render needed), record one entry per match,
  // then jump to the first. Same mechanism the citation "→ go" pinpoint uses.
  async function runSearch(query: string): Promise<number> {
    const nq = normText(query)
    matchesRef.current = []
    clearFindHits()
    if (!nq) { setMatchInfo({ cur: 0, total: 0 }); return 0 }
    const per: number[] = []
    for (let i = 0; i < pagesRef.current.length; i++) {
      const tc = await pagesRef.current[i].page.getTextContent()
      const text = normText((tc.items as Array<{ str?: string }>).map(it => it.str ?? '').join(' '))
      const re = searchPattern(nq)
      while (re.exec(text)) { per.push(i); if (re.lastIndex === 0) break }
    }
    matchesRef.current = per
    setMatchInfo({ cur: per.length ? 1 : 0, total: per.length })
    if (per.length) gotoMatch(0, query)
    return per.length
  }

  // Find a cited sentence: try the whole quote, then shorter leading fragments. PDF text extraction
  // drops/re-wraps words, so a long exact quote often won't match while a leading fragment reliably does.
  async function findQuote(quote: string) {
    const words = normText(quote).split(' ').filter(Boolean)
    if (!words.length) return
    const tries = [words.length, 8, 6, 4].filter((n, i, a) => n <= words.length && a.indexOf(n) === i)
    for (const n of tries) if (await runSearch(words.slice(0, n).join(' ')) > 0) return
  }

  function gotoMatch(i: number, query = searchQuery) {
    const pageIdx = matchesRef.current[i]
    if (pageIdx == null) return
    const container = scrollRef.current
    const pg = pagesRef.current[pageIdx]
    if (!container || !pg) return
    void renderOnePage(pageIdx, renderTokenRef.current).then(() => {
      // Wait a frame so the freshly-rendered text layer has laid out before we measure spans.
      requestAnimationFrame(() => {
        const firstTop = flashQueryOnPage(pg, query)
        const cRect = container.getBoundingClientRect()
        const target = firstTop != null ? firstTop : pg.wrapper.getBoundingClientRect().top
        container.scrollTop = Math.max(0, container.scrollTop + (target - cRect.top) - container.clientHeight / 3)
      })
    })
  }

  // Draw a find-style highlight rectangle over every occurrence of the query, in the hlLayer (which sits
  // ABOVE the canvas — the text-layer spans are transparent/behind it, so span backgrounds don't show).
  // Returns the first hit's viewport top (for scrolling), or null.
  function flashQueryOnPage(pg: PageRef, query: string): number | null {
    clearFindHits()
    const nq = normText(query)
    if (!nq) return null
    const spans = Array.from(pg.textLayer.querySelectorAll('span')) as HTMLElement[]
    let full = ''
    const ranges: Array<{ span: HTMLElement; start: number; end: number }> = []
    for (const s of spans) { const t = s.textContent ?? ''; ranges.push({ span: s, start: full.length, end: full.length + t.length }); full += t + ' ' }
    const re = searchPattern(nq)
    const hit = new Set<HTMLElement>()
    let m: RegExpExecArray | null
    while ((m = re.exec(full))) {
      const s = m.index, e = s + m[0].length
      for (const r of ranges) if (r.end > s && r.start < e) hit.add(r.span)
      if (re.lastIndex === m.index) re.lastIndex++
    }
    let firstTop: number | null = null
    const layer = pg.hlLayer.getBoundingClientRect()
    for (const span of hit) {
      const r = span.getBoundingClientRect()
      if (firstTop == null || r.top < firstTop) firstTop = r.top
      const div = document.createElement('div')
      div.className = 'iw-pdf-find-hit'
      div.style.cssText = `position:absolute;left:${r.left - layer.left}px;top:${r.top - layer.top}px;width:${r.width}px;height:${r.height}px;pointer-events:none;`
      pg.hlLayer.appendChild(div)
    }
    return firstTop
  }

  function stepMatch(delta: number) {
    const total = matchInfo.total
    if (!total) return
    const next = ((matchInfo.cur - 1 + delta) % total + total) % total
    setMatchInfo({ cur: next + 1, total })
    gotoMatch(next)
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
      // Skip spurious rects — a page-tall or zero rect (e.g. pdf.js's .endOfContent, which the selection
      // range picks up) is what paints the WHOLE page when you only dragged over a few words.
      if (cr.height < 1 || cr.width < 1 || cr.height > 60) continue
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

  function onMouseUp() {
    const info = selectionInfo()
    // Text-tool placement + eraser are click-driven (onPdfMouseDown) — nothing to do on mouse-up.
    if (toolRef.current === 'text' || toolRef.current === 'erase') { window.getSelection()?.removeAllRanges(); setPending(null); return }
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

  // Text tool: click-DRAG on a page to set the note box's WIDTH and HEIGHT (both axes); it still grows
  // downward if the text overflows. A plain click (tiny drag) falls back to a default size. Dotted preview.
  const textDragRef = useRef<{ pageIdx: number; startX: number; startY: number; preview: HTMLDivElement; pr: DOMRect } | null>(null)
  const editNoteIdRef = useRef<string | null>(null) // note id to auto-enter-edit after the next redraw
  // Eraser: click any annotation (highlight / underline / strike / note) to remove it.
  function eraseAt(clientX: number, clientY: number): void {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pr = pagesRef.current[i].hlLayer.getBoundingClientRect()
      if (clientX < pr.left || clientX > pr.right || clientY < pr.top || clientY > pr.bottom) continue
      const fx = (clientX - pr.left) / pr.width, fy = (clientY - pr.top) / pr.height
      // topmost-first, so the eraser removes what's visually on top
      for (let j = highlightsRef.current.length - 1; j >= 0; j--) {
        const hl = highlightsRef.current[j]
        if (hl.page !== i + 1) continue
        const hit = hl.rects.some(r => fx >= r.x - 0.005 && fx <= r.x + (r.w || 0.3) + 0.005 && fy >= r.y - 0.01 && fy <= r.y + (r.h || 0.04) + 0.01)
        if (hit) { removeHighlight(hl.id); return }
      }
      return
    }
  }

  function onPdfMouseDown(e: React.MouseEvent) {
    if (toolRef.current === 'erase') { e.preventDefault(); eraseAt(e.clientX, e.clientY); return }
    if (toolRef.current !== 'text') return
    if (!pagesRef.current.length) return
    // Pick the page under the cursor; if the cursor is in the MARGIN (outside every page), anchor to the
    // vertically-nearest page so notes can live outside the sheet (x fraction may be <0 or >1).
    let idx = pagesRef.current.findIndex(pg => {
      const r = pg.wrapper.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    })
    if (idx < 0) {
      let best = Infinity
      pagesRef.current.forEach((pg, i) => {
        const r = pg.wrapper.getBoundingClientRect()
        const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
        if (dy < best) { best = dy; idx = i }
      })
    }
    if (idx < 0) return
    e.preventDefault()
    const pr = pagesRef.current[idx].wrapper.getBoundingClientRect()
    // A clearly DOTTED preview rectangle tracks the drag so the gesture is discoverable.
    const preview = document.createElement('div')
    preview.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;height:0;width:0;border:2px dotted ${INK};background:${colorRef.current}44;z-index:30;pointer-events:none;border-radius:4px;`
    document.body.appendChild(preview)
    textDragRef.current = { pageIdx: idx, startX: e.clientX, startY: e.clientY, preview, pr }
    document.addEventListener('mousemove', onTextDragMove)
    document.addEventListener('mouseup', onTextDragUp)
  }
  function onTextDragMove(ev: MouseEvent) {
    const d = textDragRef.current
    if (!d) return
    // 2-D rubber band — both horizontal and vertical.
    d.preview.style.left = `${Math.min(ev.clientX, d.startX)}px`
    d.preview.style.top = `${Math.min(ev.clientY, d.startY)}px`
    d.preview.style.width = `${Math.abs(ev.clientX - d.startX)}px`
    d.preview.style.height = `${Math.abs(ev.clientY - d.startY)}px`
  }
  function onTextDragUp(ev: MouseEvent) {
    const d = textDragRef.current
    document.removeEventListener('mousemove', onTextDragMove)
    document.removeEventListener('mouseup', onTextDragUp)
    if (!d) return
    d.preview.remove()
    textDragRef.current = null
    const pr = d.pr
    const left = Math.min(ev.clientX, d.startX), top = Math.min(ev.clientY, d.startY)
    const widthPx = Math.abs(ev.clientX - d.startX), heightPx = Math.abs(ev.clientY - d.startY)
    const wFrac = widthPx < 24 ? 0.3 : Math.min(1.2, widthPx / pr.width)   // tiny drag = click → default
    const hFrac = heightPx < 16 ? 0 : heightPx / pr.height                 // 0 → auto-height (grows with text)
    // x/y are NOT clamped to [0,1] — a note may sit in the page margin (negative x = left of the sheet).
    const hl: PdfHighlight = {
      id: uuidv4(), page: d.pageIdx + 1, color: colorRef.current, kind: 'text', text: '', note: '', size: noteSizeRef.current,
      rects: [{ x: (left - pr.left) / pr.width, y: (top - pr.top) / pr.height, w: wFrac, h: hFrac }],
      createdAt: new Date().toISOString(),
    }
    highlightsRef.current = [...highlightsRef.current, hl]
    editNoteIdRef.current = hl.id // redraw auto-enters edit mode on it
    redrawOverlays()
    void saveHighlights(citekey, highlightsRef.current)
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
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${INK}22`, background: '#faf8fc' }}>
        {TOOLS.map(t => {
          const active = tool === t.kind
          return (
            <button key={t.kind} type="button" title={`${t.title} — click, then select text`}
              onClick={() => setTool(active ? null : t.kind)}
              style={{
                width: 30, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem',
                border: `1px solid ${active ? INK : '#d6cfe0'}`, background: active ? `${INK}14` : '#fff',
                color: INK, textDecoration: t.kind === 'strike' ? 'line-through' : t.kind === 'underline' ? 'underline' : 'none',
              }}>{t.label}</button>
          )
        })}
        {/* Text-note font size */}
        <select value={noteSize} title="Text note size"
          onChange={e => { const n = Number(e.target.value); setNoteSize(n); try { localStorage.setItem('inkwave:pdfNoteSize', String(n)) } catch { /* private */ } }}
          style={{ height: 28, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.82rem', padding: '0 4px', cursor: 'pointer' }}>
          {[8, 10, 12, 14, 16, 18, 20, 24, 28, 36].map(s => <option key={s} value={s}>{s}px</option>)}
        </select>
        <span style={{ width: 1, height: 20, background: `${INK}22`, margin: '0 2px' }} />
        {COLORS.map(c => (
          <button key={c} type="button" title="Colour" onClick={() => setColor(c)}
            style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? `2px solid ${INK}` : '1px solid rgba(0,0,0,0.15)' }} />
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#a89db8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tool === 'text' ? 'drag on a page to add a note' : tool ? `select text to ${tool}` : 'pick a tool, or select text'}
        </span>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      {/* Find-in-PDF bar (Ctrl+F) */}
      {searchOpen && (
        <div className="iw-nightable" style={{
          position: 'absolute', top: 10, right: 18, zIndex: 25,
          display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${INK}44`,
          borderRadius: 10, boxShadow: '0 3px 14px rgba(0,0,0,0.22)', padding: '8px 12px',
        }}>
          <input
            ref={searchBoxRef}
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); void runSearch(e.target.value) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1) }
              if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); clearFindHits() }
            }}
            placeholder="Find in PDF…"
            style={{ width: 240, fontSize: '15px', border: `1px solid ${INK}33`, borderRadius: 6, padding: '5px 10px', outline: 'none' }}
          />
          <span style={{ fontSize: '13px', color: 'var(--iw-pill-fg, #78716c)', minWidth: 48, textAlign: 'center' }}>
            {matchInfo.total ? `${matchInfo.cur}/${matchInfo.total}` : (searchQuery ? '0/0' : '')}
          </span>
          <button type="button" onClick={() => stepMatch(-1)} title="Previous (Shift+Enter)"
            style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--iw-pill-fg, #5c2d8a)', cursor: 'pointer', borderRadius: 5, fontSize: '1.1rem' }}>‹</button>
          <button type="button" onClick={() => stepMatch(1)} title="Next (Enter)"
            style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--iw-pill-fg, #5c2d8a)', cursor: 'pointer', borderRadius: 5, fontSize: '1.1rem' }}>›</button>
          <button type="button" onClick={() => { setSearchOpen(false); clearFindHits() }} title="Close (Esc)"
            style={{ width: 24, height: 24, border: 'none', background: 'transparent', color: '#78716c', cursor: 'pointer', borderRadius: 5, fontSize: '0.95rem' }}>×</button>
        </div>
      )}
      <div ref={scrollRef} onMouseUp={onMouseUp} onMouseDown={onPdfMouseDown}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e9e7e3', padding: 12 }}>
        <div ref={viewerRef} className="pdfViewer" style={{ '--scale-factor': 1 } as React.CSSProperties} />
        {status === 'loading' && <p style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>Loading PDF…</p>}
        {status === 'error' && <p style={{ textAlign: 'center', color: '#b45309', marginTop: 40 }}>Couldn't render this PDF.</p>}
      </div>

      {/* Zoom controls */}
      <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 15, display: 'flex', gap: 4, background: '#fff', border: `1px solid ${INK}33`, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: 2 }}>
        <button type="button" title="Rotate 90°" aria-label="Rotate 90 degrees"
          onClick={async () => {
            const next = (rotationRef.current + 90) % 360
            rotationRef.current = next
            const doc = docRef.current
            if (doc) { // re-fit for the new orientation (width/height swap at 90°/270°)
              const containerW = (scrollRef.current?.clientWidth ?? 800) - 24
              const vp = (await doc.getPage(1)).getViewport({ scale: 1, rotation: next })
              fitScaleRef.current = Math.max(ZOOM_MIN, Math.min(3, containerW / vp.width))
            }
            renderedZoomRef.current = zoom
            void renderPages(fitScaleRef.current * zoom)
          }}
          style={{ minWidth: 34, height: 34, border: 'none', background: 'transparent', color: INK, cursor: 'pointer', fontSize: '1.35rem', borderRadius: 5, lineHeight: 1 }}>
          ⟳
        </button>
        {([['−', () => { zoomAnchorRef.current = null; setZoom(z => Math.max(ZOOM_MIN, z / 1.2)) }], [`${Math.round(zoom * 100)}%`, () => { zoomAnchorRef.current = null; setZoom(1) }], ['+', () => { zoomAnchorRef.current = null; setZoom(z => Math.min(ZOOM_MAX, z * 1.2)) }]] as const).map(([label, fn], i) => (
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
