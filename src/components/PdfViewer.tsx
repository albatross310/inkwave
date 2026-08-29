// pdf.js-based PDF viewer with a selectable text layer, persistent highlight overlays, and
// select-a-sentence → link-to-citation. Renders pages the way pdf.js expects
// (.pdfViewer > .page > .canvasWrapper + .textLayer) so the official pdf_viewer.css (lazy-imported)
// drives text-layer positioning/selection. Highlights are our own overlay divs (normalised rects),
// stored on the source's _iw.highlights — not baked into the PDF.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getPdfjs, PDF_DOC_PARAMS } from '../citations/pdfjsSetup'
import { highlightsOf, saveHighlights, type PdfHighlight, type HighlightRect, type HighlightKind } from '../citations/pdfHighlights'
import { pageOffsetOf } from '../citations/pageOffset'
import { setLastPdfPage, setLastPdfScroll, getLastPdfScroll } from '../citations/pdfViewer'
import { bibProvider } from '../citations/bibProvider'
import { isTouchDevice } from '../editor/Scroll'
import { noteAnnotation, noteScroll } from '../productivity/pdfActivity'

/**
 * How many device pixels per CSS pixel to render a PDF page at.
 * FLOOR of 2× regardless of what the display reports — supersampling is what keeps glyphs crisp on
 * a 1× screen, and it is also what makes the viewer immune to browser zoom (Chrome folds zoom into
 * devicePixelRatio, so a window at 67% reports ~1.33 and used to render that soft). Ceilings are
 * unchanged: 3× desktop / 2× touch (iOS's total canvas memory is the scarce resource), and never
 * more than `maxCanvas` px on a side.
 */
export function pdfOutputScale(dpr: number, isTouch: boolean, vw: number, vh: number, maxCanvas = 4096): number {
  const want = Math.max(2, Number.isFinite(dpr) && dpr > 0 ? dpr : 1)
  const ceiling = isTouch ? 2 : 3
  const byMemory = Math.min(vw > 0 ? maxCanvas / vw : Infinity, vh > 0 ? maxCanvas / vh : Infinity)
  return Math.max(1, Math.min(want, ceiling, byMemory))
}
import { lockAxis, newAxisState } from './axisLock'
import { HOLD_MS } from './useLongPress'
import { PdfReaderView } from './PdfReaderView'
import { anchorInPage, nearestBlock, noteAnchorText } from './pdfReflow'
import { getPageReflow } from './pdfReflowStore'

/**
 * How much one ctrl/⌘-wheel event zooms the PDF.
 *
 * ⚠ IT USED TO IGNORE THE EVENT'S SIZE (Peter, 2026-08-28: "change the zoom sensitivity so that
 * it's much less quick. At the moment it's too sensitive to properly control"). The rule was a flat
 * ×1.1 / ×0.9 PER EVENT, which is right for a mouse — one notch, one step — and wrong for a
 * trackpad, which is where the complaint comes from: a pinch streams ~60 events a second with tiny
 * deltas, and each one took a full 10% bite, so the page shot from fit to maximum in a flick.
 * Now the step is PROPORTIONAL to the delta, which is the thing that actually distinguishes a
 * deliberate notch from a fingertip. The clamp keeps a mouse EXACTLY as it was: a 120px notch
 * saturates at 1.1/0.9, so nothing about the mouse path changes.
 */
const PDF_ZOOM_K = 0.0044 // +75% on the first cut (Peter: "a tad faster, maybe 75%")
export function pdfZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  return Math.min(1.1, Math.max(0.9, Math.exp(-deltaY * PDF_ZOOM_K)))
}
import type { IwCitationMeta } from '../types/document'

const INK = '#5c2d8a'
// Annotation palette (Peter, 2026-07-10): violet removed; dark red + dark blue added.
// DARK_BLUE is also the default for underlines and strikethroughs (see armTool).
const DARK_RED = '#991b1b'
const DARK_BLUE = '#1e3a8a'
const COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6', DARK_RED, DARK_BLUE]
// Peter, 2026-08-28: the palettes live UNDER the tools they belong to — "move highlight colour into
// click and hold on the highlight button", "a text colour click and hold on text that changes the
// sticky note colour". A highlight wants a wash you can read through; a sticky note can be anything.
const HIGHLIGHT_COLORS = COLORS.slice(0, 4)
// The dark pair are highlight-ink colours; a sticky note in maroon or navy is a note you cannot
// read (Peter, 2026-08-28: "get rid of these last two colours for text boxes").
const NOTE_COLORS = COLORS.slice(0, 4)
type ToolKind = HighlightKind | 'erase'
// ⚠ UNDERLINE AND STRIKETHROUGH ARE GONE FROM THE TOOL ROW (Peter, 2026-08-28: "let's get rid of
// underline and strikethrough"). The KINDS stay in the model and in the renderer on purpose: a PDF
// annotated before today may already carry them, and dropping the render would make an existing
// mark silently vanish from someone's source — the deletion-by-omission this codebase keeps
// refusing. You can no longer CREATE one; every one already made still shows, and the eraser still
// removes it.
const TOOLS: Array<{ kind: ToolKind; label: string; title: string }> = [
  { kind: 'highlight', label: '▮', title: 'Highlight' },
  { kind: 'text', label: 'T', title: 'Text note — click on the page to place' },
  { kind: 'erase', label: '⌫', title: 'Eraser — click any annotation to remove it' },
]
const ZOOM_MIN = 0.4, ZOOM_MAX = 4

/**
 * FIT THE TEXT TO THE WINDOW — the scale at which the page's TEXT BLOCK spans the panel, with a
 * safety inset so glyphs never kiss the edge. Clamped to [page-fit … 2×page-fit] so a stray text
 * bbox can neither zoom out below whole-page fit nor crop wildly; no text layer ⇒ page fit.
 * ONE definition, used by the initial load, the resize re-fit and the ⤢ button — three places that
 * must agree about what "flush" means or the button would land somewhere the resize then moved.
 */
export function computeTextFit(
  inputs: { pageW: number; ext: { x0: number; x1: number } | null } | null,
  clientWidth: number,
  fallback: number,
  /** Space reserved to the right for notes — the page must fit BESIDE it, not behind it. */
  reservedRight = 0,
): number {
  if (!inputs) return fallback
  const containerW = clientWidth - 24 - reservedRight
  const pageFit = Math.max(ZOOM_MIN, Math.min(3, containerW / inputs.pageW))
  if (!inputs.ext) return pageFit
  const w = inputs.ext.x1 - inputs.ext.x0
  if (!(w > 0)) return pageFit
  return Math.max(pageFit, Math.min(3, 2 * pageFit, (containerW - 2 * TEXT_FIT_INSET) / w))
}


// A pink pencil-eraser icon (Material "eraser" glyph) for the erase tool.
function EraserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f9a8d4" stroke="#9d174d" strokeWidth="1.1" strokeLinejoin="round"
        d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0Z" />
      <path stroke="#9d174d" strokeWidth="1.1" d="M8.5 9.9l4.95 4.95" />
    </svg>
  )
}

interface PageRef {
  wrapper: HTMLDivElement; canvasWrap: HTMLDivElement; textLayer: HTMLDivElement; hlLayer: HTMLDivElement
  w: number; h: number
  page: any; viewport: any // eslint-disable-line @typescript-eslint/no-explicit-any
  rendered: boolean; rendering: boolean
  // Two-tier canvases: `base` is the cheap low-res always-there render (never evicted — fast scroll
  // falls back to it instead of white); `sharp` is the supersampled on-demand one that covers it.
  baseCanvas: HTMLCanvasElement | null; sharpCanvas: HTMLCanvasElement | null
  // The in-flight sharp render (canvas + TEXT LAYER attached when it resolves). Lets a second caller
  // AWAIT a render the IntersectionObserver already started instead of resolving early — the
  // atomic-reveal barrier depends on this (see renderOnePage).
  renderPromise: Promise<void> | null
}
interface Pending { text: string; page: number; rects: HighlightRect[]; groups: Array<{ page: number; rects: HighlightRect[] }>; x: number; y: number }
// Minimal shape of the bits of pdf.js we touch (avoids depending on its exported types here).
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any> } // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Fit-to-text-width (Peter, 2026-07-10) ────────────────────────────────────────────────────────
// The DEFAULT zoom puts the TEXT's left/right margins at the panel edges (small safety inset), not
// the page's. Extents come from getTextContent — the same items the text layer renders from — so no
// render pass is needed before the fit is known. Pages with no text layer (scans) or an implausibly
// narrow bbox (a lone page number would explode the zoom) return null → caller falls back to
// page-width fit.
const TEXT_FIT_INSET = 10 // px of safety either side so glyphs never kiss the panel edge
async function textExtentsOf(doc: PdfDoc, pageNum: number): Promise<{ x0: number; x1: number; pageW: number } | null> {
  try {
    const page = await doc.getPage(Math.min(Math.max(pageNum, 1), doc.numPages))
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    let x0 = Infinity, x1 = -Infinity
    for (const it of tc.items as Array<{ str?: string; width?: number; transform?: number[] }>) {
      if (!it.str?.trim() || !it.transform || !((it.width ?? 0) > 0)) continue
      // convertToViewportPoint handles the page's viewBox offset + inherent rotation.
      const [ax] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
      const [bx] = vp.convertToViewportPoint(it.transform[4] + (it.width ?? 0), it.transform[5])
      x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx)
    }
    if (!Number.isFinite(x0) || x1 - x0 < vp.width * 0.3) return null // no/implausible text layer
    return { x0, x1, pageW: vp.width }
  } catch { return null }
}

// Manual-zoom override: once the user zooms by hand, that zoom (relative to the fit baseline)
// persists and future opens skip the default in favour of it.
const USER_ZOOM_KEY = 'inkwave:pdfUserZoom'
function savedUserZoom(): number | null {
  try {
    const v = parseFloat(localStorage.getItem(USER_ZOOM_KEY) || '')
    return Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX ? v : null
  } catch { return null }
}

export function PdfViewer({ data, citekey, initialPage, initialQuote, instanceId, context, noRef, restoreScroll, dockButton, sideButtons, fullscreen, fullscreenButton, onClose, onLinkToCitation }: {
  data: ArrayBuffer
  citekey: string
  initialPage?: number
  initialQuote?: string | null
  instanceId?: string | null   // the citation occurrence — new highlights are tagged with it
  context?: string | null      // the sentence before the citation, shown for context
  noRef?: boolean              // opened from the bib → annotations must not become page refs
  restoreScroll?: boolean      // open at the reader's last exact scroll position (author-year click)
  dockButton?: ReactNode       // the panel's dock-orientation toggle, rendered inside this single toolbar
  sideButtons?: ReactNode      // panel controls at the RIGHT end of the toolbar (swap dock edge), before dockButton
  fullscreen?: boolean         // panel-owned fullscreen mode — gates the wave-sway scroll feed
  fullscreenButton?: ReactNode // the panel's ⛶ toggle, rendered in the toggle group right of the ✕
  onClose?: () => void         // close the panel — rendered as a big × at the left of the toolbar
  onLinkToCitation?: (quote: string, page: number) => void
}) {
  const instanceIdRef = useRef<string | null | undefined>(instanceId); instanceIdRef.current = instanceId
  const fullscreenRef = useRef(!!fullscreen); fullscreenRef.current = !!fullscreen
  // Touch/iOS: inputs need ≥16px font (or Safari auto-zooms the page on focus) and the drag tools need
  // pointer events + touch-action:none. Device-based, so it can't change mid-session.
  const isTouch = isTouchDevice()
  // "Don't add pages to inline" — bib entry forces it; a toolbar checkbox lets the reader force it too.
  const [dontAddPages, setDontAddPages] = useState(false)
  const noRefRef = useRef(false); noRefRef.current = !!noRef || dontAddPages
  // "Scroll highlighted": step through this source's highlights in order; optionally sync the editor to
  // the document position (the citation occurrence) each highlight belongs to.
  const hlNavRef = useRef(-1)
  const [syncEditor, setSyncEditor] = useState(false)
  // When on, clicking back into the editor while the PDF is full-screen drops the viewer. Off by default.
  const [hideOnEditorClick, setHideOnEditorClick] = useState(() => {
    try { return localStorage.getItem('inkwave:pdfHideOnEditorClick') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('inkwave:pdfHideOnEditorClick', hideOnEditorClick ? '1' : '0') } catch { /* private */ }
    window.dispatchEvent(new Event('inkwave:pdf-hide-pref-changed'))
  }, [hideOnEditorClick])
  // Hovering a compact control shows its explanation down in the status line (keeps the bar squished).
  const setHint = (_?: string | null) => {} // hints now live in each control's tooltip; keep the calls no-op
  const rootRef = useRef<HTMLDivElement>(null) // whole viewer — keyboard shortcuts gate on hover OR focus-within
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<PageRef[]>([])
  const pageNowRef = useRef(1)
  const [pageNow, setPageNow] = useState(1)
  const [pageTotal, setPageTotal] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const highlightsRef = useRef<PdfHighlight[]>([])
  const docRef = useRef<PdfDoc | null>(null)
  const fitScaleRef = useRef(1)
  const textFitX0Ref = useRef<number | null>(null) // text bbox left (scale-1 px) — fit-to-text h-centering
  // The fit baseline's raw inputs (page width + text extents, scale-1 px), kept so the LIVE panel
  // resize can recompute fit-to-text per frame without re-reading the PDF.
  const fitInputsRef = useRef<{ pageW: number; ext: { x0: number; x1: number } | null } | null>(null)
  const renderTokenRef = useRef(0)
  const hoverRef = useRef(false)
  const offsetRef = useRef(0)          // printed page = sheet + offset
  const printedKnownRef = useRef(false) // true when Haiku verified the offset
  const [pending, setPending] = useState<Pending | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // ATOMIC CONTENTS REVEAL (Peter, 2026-07-09): the panel window pops instantly (PdfSidePanel) as
  // pure WHITE + the ✕ close button — nothing else. The WHOLE viewer (toolbar, context strip, find
  // bar, zoom + dock controls, pages) stays at opacity 0 (still laid out + rendering underneath —
  // same trick as the editor's settle gate) behind a white cover, and flips in ONE toggle when the
  // initial viewport is actually ready: placeholders built + the visible pages' canvas AND text-layer
  // spans attached (renderVisibleNow → renderOnePage's text-ready contract) + highlight overlays
  // re-drawn + the initial scroll applied. Capped at 1.5s like the editor's reveal gate, so a
  // slow/huge PDF can never hold the panel hostage.
  const [revealed, setRevealed] = useState(false)
  // Latch mirror + the ONE reveal decision point. The old one-shot barrier raced the newer render
  // paths (fit-to-text / live-fit re-renders supersede the load token, and a superseded
  // renderVisibleNow resolves EARLY) — the toolbar then revealed before the text layer (Peter's
  // regression). maybeReveal() is instead called after EVERY completed page render (and by the
  // load barrier): it flips only when every page actually intersecting the viewport has its
  // canvas AND text-layer spans attached (pg.rendered — the text-ready contract). Whatever render
  // path completes last is the one that opens the gate, so no path can slip past it.
  const revealedRef = useRef(false)
  function maybeReveal(): void {
    if (revealedRef.current) return
    const sc = scrollRef.current
    if (!sc || !pagesRef.current.length) return
    const sRect = sc.getBoundingClientRect()
    const visible = pagesRef.current.filter(pg => {
      const r = pg.wrapper.getBoundingClientRect()
      return r.bottom >= sRect.top + 1 && r.top <= sRect.bottom - 1
    })
    if (!visible.length || !visible.every(pg => pg.rendered)) return
    revealedRef.current = true
    redrawOverlays() // highlight overlays drawn against the final layout — part of the same barrier
    requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true))) // after the commit paints
  }
  // zoom 1 = the FIT BASELINE (fit-to-text-width when the page has a text layer, else page-width
  // fit). A manually-chosen zoom persists (USER_ZOOM_KEY) and overrides the default on open.
  const [zoom, setZoom] = useState(() => savedUserZoom() ?? 1)
  const [tool, setTool] = useState<ToolKind | null>(null) // active markup mode (null = off)
  const [color, setColor] = useState(COLORS[0])
  const [colorOpen, setColorOpen] = useState<ToolKind | null>(null)
  // The currently SELECTED text note, remembered outside the DOM node so a document-level Delete
  // can remove it however focus has drifted (see setSelected). `dragMovedRef` suppresses the click
  // that a drag would otherwise also fire.
  const selectedNoteRef = useRef<{ id: string; remove: () => void } | null>(null)
  const dragMovedRef = useRef<string | null>(null)
  // How far past the page you can scroll. Enough for a text note at the margin, and 0 at fit.
  const PDF_OVERSCROLL_PX = 180
  // ⚠ THE MARGIN HAS TO RESIZE THE PAGE (Peter, 2026-08-28: "this button doesn't appear to be
  // working"). It DID pad the scroller — but every fit calculation measures `clientWidth`, which
  // padding does not change, so the page kept its old size, overflowed into the new strip and the
  // margin was only reachable by scrolling. Reserving space that the page then covers is the same
  // as reserving nothing. Now the reserve is a NUMBER shared by the padding and the fit, so the
  // page shrinks and the margin is beside it, which is the whole point of asking for one.
  const commentMarginRef = useRef(0)
  const [commentMargin, setCommentMargin] = useState(() => {
    try { return localStorage.getItem('inkwave:pdfCommentMargin') === '1' } catch { return false }
  })
  const holdRef = useRef<Partial<Record<ToolKind, ReturnType<typeof setTimeout>>>>({})
  const heldRef = useRef(false)
  // Per-tool colour memory: underline/strike DEFAULT to dark blue (Peter, 2026-07-10); clicking a
  // swatch while a tool is armed re-colours THAT tool and is remembered for the session.
  // Sticky notes default to YELLOW (Peter, 2026-08-28: "the background should be yellow by
  // default") — the colour a sticky note is, and what the ▮ highlighter already defaults to.
  const toolColorsRef = useRef<Partial<Record<ToolKind, string>>>({ underline: DARK_BLUE, strike: DARK_BLUE, text: COLORS[0] })
  function armTool(kind: ToolKind | null) {
    setTool(kind)
    if (kind && kind !== 'erase') setColor(toolColorsRef.current[kind] ?? COLORS[0])
  }
  // MARKUP SELECTION (Peter, 2026-07-10): a bare click on a highlight/underline/strike SELECTS it
  // (outlined rects + an inline colour popup anchored at the click). While selected, the toolbar
  // swatches AND the popup dots recolour THAT annotation; Delete/Backspace removes it; Escape or a
  // click elsewhere deselects. Coordinates with the bare-click disarm: annotation click = select
  // (never disarm), bare click on nothing = deselect + disarm.
  const [selectedMk, setSelectedMk] = useState<{ id: string; x: number; y: number } | null>(null)
  const selectedMkRef = useRef<string | null>(null)
  function selectMarkup(hl: PdfHighlight | null, at?: { clientX: number; clientY: number }) {
    selectedMkRef.current = hl?.id ?? null
    if (!hl) setSelectedMk(null)
    else {
      const box = scrollRef.current?.getBoundingClientRect()
      setSelectedMk({ id: hl.id, x: at && box ? at.clientX - box.left : 40, y: at && box ? at.clientY - box.top : 40 })
    }
    redrawOverlays()
  }
  function recolorMarkup(id: string, c: string) {
    const hl = highlightsRef.current.find(h => h.id === id)
    if (!hl) return
    hl.color = c
    redrawOverlays()
    persistMarks()
  }
  const [noteSize, setNoteSize] = useState<number>(() => { try { return Number(localStorage.getItem('inkwave:pdfNoteSize')) || 12 } catch { return 12 } })
  const toolRef = useRef<ToolKind | null>(null); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color
  const noteSizeRef = useRef(noteSize); noteSizeRef.current = noteSize
  const zoomStateRef = useRef(zoom); zoomStateRef.current = zoom // live mirror for the resize tracker

  // Context-strip dismiss (Peter, 2026-07-10): the ✕ reclaims the vertical reading space for this
  // open only — the next citation click that brings a quote/context shows the strip again.
  const [contextDismissed, setContextDismissed] = useState(false)
  useEffect(() => { setContextDismissed(false) }, [context, instanceId])

  // Find-in-PDF (Ctrl+F) — searches the real text layer, scrolls to matches, highlights them.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchInfo, setMatchInfo] = useState<{ cur: number; total: number }>({ cur: 0, total: 0 })
  const matchesRef = useRef<number[]>([]) // page index per match occurrence
  const searchBoxRef = useRef<HTMLInputElement>(null)

  // ── READER VIEW (Peter, 2026-08-28: "yep build the reader view for pdfs") ─────────────────────
  // A MODE, not a replacement. The page view below is untouched and stays the default; this flips
  // the pane to `PdfReaderView`, which re-sets the SAME text in the reader's own font and line
  // spacing — the answer to his earlier "do we have a way of altering the line spacing on the pdf
  // to make it wider? Or to change the font", which a fixed PDF layout cannot give.
  const [readerMode, setReaderMode] = useState(() => {
    try { return localStorage.getItem('inkwave:pdfReaderMode') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('inkwave:pdfReaderMode', readerMode ? '1' : '0') } catch { /* private */ }
  }, [readerMode])
  // The page view owns the highlight list in a REF (it draws imperatively), so React cannot see a
  // mutation. One counter, bumped at every mutation site through `persistMarks`, is the signal the
  // reader view re-renders on. Bumping inside redrawOverlays instead would re-render on every zoom.
  const [markRev, setMarkRev] = useState(0)
  function persistMarks(): void {
    setMarkRev(v => v + 1)
    void saveHighlights(citekey, highlightsRef.current)
  }

  const removeHighlight = (id: string) => {
    if (selectedMkRef.current === id) { selectedMkRef.current = null; setSelectedMk(null) } // no dangling selection/popup
    highlightsRef.current = highlightsRef.current.filter(h => h.id !== id)
    redrawOverlays()
    persistMarks()
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
          // Two modes: SELECT (single click/tap → outline + a ✕ delete handle; Delete/Backspace also
          // removes) and EDIT (double-click / Enter — or a SECOND TAP while selected, since touch has
          // neither dblclick nor a Delete key). Width + initial height come from the drag; it still
          // grows downward as you type. Empty notes get a dashed "type here" border.
          const emptyNote = !(hl.note || hl.text)
          const noteBorder = emptyNote ? `1.5px dashed ${INK}` : '1px solid rgba(0,0,0,0.2)'
          const minH = (r0.h || 0) > 0.001 ? `min-height:${Math.max(20, (r0.h || 0) * ph)}px;` : ''
          const noteW = Math.max(60, (r0.w || 0.3) * pw)
          note.style.cssText = `position:absolute;left:${r0.x * pw}px;top:${r0.y * ph}px;width:${noteW}px;${minH}background:${hl.color};border:${noteBorder};border-radius:4px;padding:3px 6px;font-size:${hl.size ?? 12}px;line-height:1.35;color:#2a2a2a;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.22);z-index:2;font-family:system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:break-word;outline:none;`
          note.textContent = hl.note || hl.text
          note.title = 'Click/tap to select (✕ or Delete removes) · double-click or tap again to edit'
          const removeNote = () => {
            highlightsRef.current = highlightsRef.current.filter(h => h.id !== hl.id)
            redrawOverlays(); persistMarks()
          }
          // ✕ delete handle — a SIBLING, not a child (children of a contentEditable become editable and
          // would pollute textContent). Same look as the annotation × handles (the sheet is white in every
          // theme, so the hard #fff/#7f1d1d pair is correct here). Visible only while the note is
          // selected/edited; pointerdown (not click) so it wins the race against the note's blur on touch.
          const delBtn = document.createElement('button')
          delBtn.textContent = '×'
          delBtn.title = 'Remove note'
          // TOP-LEFT (Peter, 2026-08-28: "the x needs to be at top left not top right"). A note grows
          // rightward and downward from its origin, so the right edge MOVES as the box is resized or
          // its text wraps — the handle wandered. The origin does not.
          delBtn.style.cssText = `position:absolute;left:${r0.x * pw - 8}px;top:${r0.y * ph - 9}px;width:16px;height:16px;padding:0;line-height:14px;text-align:center;border-radius:50%;border:1px solid #7f1d1d;background:#fff;color:#7f1d1d;font-weight:bold;cursor:pointer;font-size:12px;pointer-events:auto;z-index:3;display:none;`
          delBtn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); removeNote() })
          let selected = false
          const setSelected = (on: boolean) => {
            selected = on
            // Remembered OUTSIDE the node so Delete works even when focus has drifted off it — the
            // note is focusable, but a tap anywhere on the page furniture takes focus away and the
            // node's own keydown then never fires. Peter: "empty textboxes/comments need to delete
            // when I hit delete and they are selected."
            selectedNoteRef.current = on ? { id: hl.id, remove: removeNote } : (selectedNoteRef.current?.id === hl.id ? null : selectedNoteRef.current)
            delBtn.style.display = on ? 'block' : 'none'
            note.style.outline = on ? `2px solid ${INK}` : 'none'
          }
          const enterEdit = () => {
            note.contentEditable = 'true'; note.style.cursor = 'text'; note.style.outline = `2px solid ${INK}`
            note.focus()
            const rng = document.createRange(); rng.selectNodeContents(note); rng.collapse(false)
            const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(rng)
          }
          // ── DRAG TO MOVE (Peter, 2026-08-28: "and need to move on click and drag") ──────────
          // Threshold-based, so a plain click still selects: nothing moves until the pointer has
          // travelled more than a few px, and only then is the click suppressed. Positions are
          // FRACTIONS of the page (like every other annotation rect), so a moved note stays put
          // through zoom, rotation and a re-render — dragging in px and storing px would pin it to
          // one scale.
          let drag: { px: number; py: number; x0: number; y0: number; moved: boolean } | null = null
          note.addEventListener('pointerdown', (ev) => {
            if (note.contentEditable === 'true') return   // editing: the pointer is placing a caret
            drag = { px: ev.clientX, py: ev.clientY, x0: r0.x, y0: r0.y, moved: false }
            note.setPointerCapture(ev.pointerId)
          })
          note.addEventListener('pointermove', (ev) => {
            if (!drag) return
            const dx = ev.clientX - drag.px, dy = ev.clientY - drag.py
            if (!drag.moved && Math.hypot(dx, dy) < 4) return
            drag.moved = true
            note.style.cursor = 'grabbing'
            // Convert screen px → page fractions through the CURRENT rendered size, so the note
            // tracks the pointer exactly at any zoom.
            const nx = Math.max(0, Math.min(1, drag.x0 + dx / pw))
            const ny = Math.max(0, Math.min(1, drag.y0 + dy / ph))
            r0.x = nx; r0.y = ny
            note.style.left = `${nx * pw}px`; note.style.top = `${ny * ph}px`
            delBtn.style.left = `${nx * pw - 8}px`; delBtn.style.top = `${ny * ph - 9}px`
          })
          const endDrag = (ev: PointerEvent) => {
            if (!drag) return
            const moved = drag.moved
            drag = null
            note.style.cursor = note.contentEditable === 'true' ? 'text' : 'pointer'
            try { note.releasePointerCapture(ev.pointerId) } catch { /* already released */ }
            if (moved) { dragMovedRef.current = hl.id; persistMarks() }
          }
          note.addEventListener('pointerup', endDrag)
          note.addEventListener('pointercancel', endDrag)

          note.addEventListener('click', (ev) => {
            // A drag is not a click. Without this, moving a note also selected (or edited) it.
            if (dragMovedRef.current === hl.id) { dragMovedRef.current = null; ev.stopPropagation(); return }
            if (note.contentEditable === 'true') return
            if (selected) { enterEdit(); return } // second tap while selected = edit (touch dblclick substitute)
            setSelected(true); note.focus()
          })
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
            setSelected(false) // clears outline + hides the ✕ (delete taps land on pointerdown, before this)
            if (note.contentEditable !== 'true') return
            // Persist the box even if empty (it stays as a coloured, dashed placeholder) — clicking away
            // must NOT delete it; removal is explicit (select + Delete). This is why a freshly dragged
            // box used to vanish: it blurred empty and self-deleted.
            const v = (note.textContent ?? '').trim()
            hl.note = v; hl.text = v
            note.contentEditable = 'false'; note.style.cursor = 'pointer'
            persistMarks()
          })
          if (editNoteIdRef.current === hl.id) { editNoteIdRef.current = null; requestAnimationFrame(enterEdit) }
          pg.hlLayer.appendChild(note)
          pg.hlLayer.appendChild(delBtn)
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
        // SELECTED markup: outline every rect so the selection is unmistakable (same INK outline
        // as a selected text note). The recolour swatches/popup and Delete both key off this.
        if (selectedMkRef.current === hl.id) {
          for (const r of hl.rects) {
            const sel = document.createElement('div')
            sel.style.cssText = `position:absolute;left:${r.x * pw - 2}px;top:${r.y * ph - 2}px;width:${r.w * pw + 4}px;height:${r.h * ph + 4}px;outline:2px solid ${INK};border-radius:3px;pointer-events:none;z-index:2;`
            pg.hlLayer.appendChild(sel)
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

  // Count of in-flight SHARP (visible-page) renders. The base-tier background sweep polls this and
  // stalls while it's non-zero, so painting what the user is actually looking at always preempts
  // background base progress.
  const sharpActiveRef = useRef(0)

  // Paint one page's canvas + text layer on demand (called by the IntersectionObserver). Placeholder
  // sizes are already correct, so this never reflows — which is also what stops the open-scroll snap.
  //
  // TEXT-READY CONTRACT (Peter, 2026-07-09 "the text takes a moment longer"): the returned promise
  // resolves only when the canvas AND the text-layer spans are actually attached to the DOM (the
  // TextLayer render task below is awaited before `rendered` flips). Crucially, a caller that asks
  // for a page whose render is already IN FLIGHT — the IntersectionObserver usually starts the
  // visible pages before renderVisibleNow asks for them — gets THAT render's promise, not an instant
  // resolve. The old `if (rendering) return` early-out is exactly what let the atomic reveal fire
  // with the canvas painted but the text layer still streaming in.
  function renderOnePage(idx: number, token: number): Promise<void> {
    const pg = pagesRef.current[idx]
    if (!pg || pg.rendered) return Promise.resolve()
    if (pg.rendering) return pg.renderPromise ?? Promise.resolve()
    pg.rendering = true
    pg.renderPromise = renderOnePageInner(pg, token)
    return pg.renderPromise
  }
  async function renderOnePageInner(pg: PageRef, token: number) {
    sharpActiveRef.current++
    try {
    const pdfjs = await getPdfjs()
    if (token !== renderTokenRef.current) { pg.rendering = false; return }
    // Supersample: render the canvas at ≥2× the CSS size and let the browser downscale, so PDF text
    // stays crisp even on 1× displays (or setups that under-report devicePixelRatio). But the viewport
    // already grows with zoom, so cap the canvas at 4096px/side to bound memory — supersampling then
    // only adds resolution where the page is still small (the default fit view, where the blur shows).
    // Supersample to ≥2× (capped 3×): exactly-dpr looked soft on low-dpr displays, and 3–4× shimmered
    // on non-integer downscales. 2–3× is the sweet spot — crisp without the aliasing. Capped for memory.
    // Touch (iOS) caps at 2×: iPhones report dpr 3, and 3× canvases are 2.25× the bytes for no visible
    // gain on those screens — iOS's TOTAL canvas memory budget is the scarce resource (see eviction).
    // ⚠ THE CODE CONTRADICTED ITS OWN COMMENT (2026-08-28, Peter: "is there a way for us to simply
    // fix the PWA to 100% — the PDFs seem to be blurry otherwise"). It said "render at ≥2× … so PDF
    // text stays crisp even on 1× displays", and then took `min(…, devicePixelRatio)`, which CAPS
    // the canvas AT the display scale — so a 1× display supersampled by exactly 1×, i.e. not at all.
    // And a browser at less than 100% zoom REPORTS A LOWER DPR (Chrome folds zoom into it): at 67%
    // on a Retina Mac, dpr ≈ 1.33, so the page rendered at 1.33× and was downscaled into a soft
    // mush. That is the blur, and it is why it appeared at "not 100%".
    // No page can set the browser's zoom, so the fix is not to demand 100% — it is to stop caring:
    // the floor is now 2× whatever the display says, keeping every existing ceiling (3× desktop /
    // 2× touch for iOS's canvas-memory budget, and 4096px per side).
    const MAX_CANVAS = 4096
    const outputScale = pdfOutputScale(window.devicePixelRatio || 1, isTouch, pg.viewport.width, pg.viewport.height, MAX_CANVAS)
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(pg.viewport.width * outputScale)
    canvas.height = Math.floor(pg.viewport.height * outputScale)
    // position:relative — a positioned in-flow element paints ABOVE the absolutely-positioned base
    // canvas that was PREPENDED before it (same stacking level, later in tree order = on top).
    canvas.style.cssText = `width:${Math.floor(pg.viewport.width)}px;height:${Math.floor(pg.viewport.height)}px;display:block;position:relative;`
    pg.canvasWrap.appendChild(canvas)
    pg.sharpCanvas = canvas
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high' // high-quality scaling of embedded images
    await pg.page.render({
      canvas, canvasContext: ctx, viewport: pg.viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    }).promise.catch(() => {})
    if (token !== renderTokenRef.current) return
    const tc = await pg.page.getTextContent()
    if (token !== renderTokenRef.current) return
    await new pdfjs.TextLayer({ textContentSource: tc, container: pg.textLayer, viewport: pg.viewport }).render().catch(() => {})
    pg.rendered = true
    pg.rendering = false // allow a re-render after eviction (evicted pages flip rendered back to false)
    maybeReveal() // every completed render re-checks the atomic-reveal gate (no path can slip past it)
    } finally {
      sharpActiveRef.current--
    }
  }

  // ── BASE TIER (never blank) ──────────────────────────────────────────────────
  // Fast scroll used to outrun the on-demand sharp renderer and land on white placeholders. So after
  // the initially visible pages have painted, a background sweep renders EVERY page once at a cheap
  // low resolution into a CSS-stretched canvas UNDER the sharp one. A fast flick then always lands on
  // a soft-but-readable page (the sharp render covers it moments later), and the touch-only eviction
  // can drop far sharp canvases and fall back to base instead of blank. Sequential, yielding between
  // pages, and stalled whenever a sharp render is in flight — it never competes with the visible view.
  const BASE_SCALE_MAX = 0.45                 // soft but readable; ~0.4 MB RGBA per US-Letter page
  const BASE_SCALE_MIN = 0.2                  // resolution floor for very long docs
  const BASE_BUDGET_BYTES = 48 * 1024 * 1024  // total base-tier cap (iOS canvas memory is the scarce resource)

  // Render one page's base canvas (detached, then prepended so the sharp canvas paints over it).
  // Returns the RGBA bytes it consumed, so the sweep can enforce the total budget.
  async function renderBaseOnePage(idx: number, baseScale: number, token: number): Promise<number> {
    const pg = pagesRef.current[idx]
    if (!pg || pg.baseCanvas) return 0
    // Desktop never evicts, so a base canvas under a finished sharp one is dead weight there; on touch
    // the sharp canvas may be evicted later, so base must exist even for currently-sharp pages.
    if (pg.rendered && !isTouch) return 0
    const vp = pg.page.getViewport({ scale: baseScale, rotation: rotationRef.current })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(vp.width))
    canvas.height = Math.max(1, Math.floor(vp.height))
    // CSS-stretched over the whole placeholder. PREPENDED (and position:absolute) so the sharp canvas
    // — position:relative, later in tree order — always paints ON TOP, whichever finished first.
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    await pg.page.render({ canvas, canvasContext: ctx, viewport: vp }).promise.catch(() => {})
    if (token !== renderTokenRef.current) { canvas.width = 0; canvas.height = 0; return 0 } // doc/zoom superseded — discard
    pg.canvasWrap.prepend(canvas)
    pg.baseCanvas = canvas
    return canvas.width * canvas.height * 4
  }

  // Kick off the background base sweep for the current render generation (token-aborted like
  // everything else). Called at the end of renderPages, so a zoom/rotation re-render restarts it.
  function startBaseSweep(token: number) {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    void (async () => {
      await sleep(400) // let the initially visible pages paint sharp (and the open-scroll settle land) first
      if (token !== renderTokenRef.current) return
      const pages = pagesRef.current
      if (!pages.length) return
      // Pick a base scale that fits the WHOLE doc in the byte budget (long docs get softer pages),
      // clamped to a readable floor. Page 1's dims stand in for all — mixed sizes only wobble the
      // estimate, and the in-loop budget check below is the hard cap anyway.
      const vp1 = pages[0].page.getViewport({ scale: 1 })
      const baseScale = Math.min(BASE_SCALE_MAX, Math.max(BASE_SCALE_MIN,
        Math.sqrt(BASE_BUDGET_BYTES / (vp1.width * vp1.height * 4 * pages.length))))
      // Nearest-first: pages closest to the current viewport are the likely flick targets.
      const sc = scrollRef.current
      let anchor = 0
      if (sc) {
        const top = sc.getBoundingClientRect().top
        let best = Infinity
        pages.forEach((pg, i) => { const d = Math.abs(pg.wrapper.getBoundingClientRect().top - top); if (d < best) { best = d; anchor = i } })
      }
      const order = pages.map((_, i) => i).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))
      let budget = BASE_BUDGET_BYTES
      for (const idx of order) {
        if (token !== renderTokenRef.current) return
        // Visible-page sharp renders always preempt the sweep.
        while (sharpActiveRef.current > 0) { await sleep(60); if (token !== renderTokenRef.current) return }
        budget -= await renderBaseOnePage(idx, baseScale, token)
        if (budget <= 0) return // hard cap (mixed page sizes, or the clamped floor on very long docs)
        await sleep(0) // yield between pages — scrolling and typing stay responsive
      }
    })()
  }

  // Evict far-away rendered pages (TOUCH ONLY). iOS caps the tab's TOTAL canvas memory; a long PDF of
  // permanent supersampled canvases blows the budget and Safari blanks pages / jetsams the tab. Keep
  // ~6 pages either side of the viewport; beyond that, free the SHARP canvas bitmap NOW (width=0
  // releases iOS's canvas accounting immediately — GC alone is too late), clear the text layer, and
  // mark the page unrendered so the IntersectionObserver repaints it when it scrolls back near.
  // The BASE canvas is deliberately left alive — evicted pages fall back to the soft base render, not
  // white. Placeholder sizes are untouched, so eviction never reflows. hlLayer (annotations) is left alone.
  const KEEP_PAGES = 6
  function evictFarPages(visible: Set<number>) {
    let lo = Infinity, hi = -Infinity
    for (const i of visible) { if (i < lo) lo = i; if (i > hi) hi = i }
    pagesRef.current.forEach((pg, i) => {
      if (i >= lo - KEEP_PAGES && i <= hi + KEEP_PAGES) return
      if (!pg.rendered || pg.rendering) return
      const canvas = pg.sharpCanvas
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove() }
      pg.sharpCanvas = null
      pg.textLayer.textContent = ''
      pg.rendered = false
      pg.renderPromise = null // stale (resolved) promise — the re-render on scroll-back makes a fresh one
    })
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
      pagesRef.current.push({ wrapper: pageEl, canvasWrap, textLayer, hlLayer, w: viewport.width, h: viewport.height, page, viewport, rendered: false, rendering: false, baseCanvas: null, sharpCanvas: null, renderPromise: null })
    }
    if (token !== renderTokenRef.current) return
    redrawOverlays()

    // `visible` tracks the indices inside the render margin so the touch-only eviction sweep knows
    // what "near the viewport" currently means (fresh per render token — pagesRef was just rebuilt).
    const visible = new Set<number>()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = Number((e.target as HTMLElement).dataset.idx)
        if (e.isIntersecting) { visible.add(idx); void renderOnePage(idx, token) }
        else visible.delete(idx)
      }
      if (isTouch && visible.size) evictFarPages(visible)
    }, { root: scrollRef.current, rootMargin: '800px 0px' })
    for (const pg of pagesRef.current) io.observe(pg.wrapper)
    observerRef.current = io
    // BASE TIER: once the visible pages have had first crack at painting sharp, sweep every page
    // into a cheap low-res base canvas so fast scroll can never land on a white placeholder.
    startBaseSweep(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remember the top visible page per source, so a citation's author-year can reopen where the reader
  // left off (getLastPdfPage). rAF-throttled; reads geometry only.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let raf = 0
    const report = () => {
      raf = 0
      const top = sc.getBoundingClientRect().top
      let best = 1, bestDist = Infinity
      for (let i = 0; i < pagesRef.current.length; i++) {
        const d = Math.abs(pagesRef.current[i].wrapper.getBoundingClientRect().top - top)
        if (d < bestDist) { bestDist = d; best = i + 1 }
      }
      setLastPdfPage(citekey, best)
      setLastPdfScroll(citekey, sc.scrollTop) // exact spot, so author-year reopens where you left off
      // THE READING SIGNAL (ledger §A3.2). Rides THIS reporter — already rAF-coalesced, already
      // computing scrollTop — rather than adding a listener to a surface CLAUDE.md documents as
      // supersampled + lazily rendered. noteScroll is one Map write and NEVER touches storage; it
      // records only THAT we scrolled, never where (no trace — see pdfActivity.ts).
      noteScroll(citekey)
      // WHICH PAGE AM I ON (Peter, 2026-08-28: "put an indicator at bottom left of both pdf and
      // webpage of which page n/x you're at"). The page whose top is nearest the pane's own top and
      // not below its middle — i.e. the one you are actually reading, not the one whose last line
      // is scrolling away. Free: this handler already has every page's rect.
      {
        const mid = sc.getBoundingClientRect().top + sc.clientHeight * 0.35
        let n = 1
        for (let i = 0; i < pagesRef.current.length; i++) {
          if (pagesRef.current[i].wrapper.getBoundingClientRect().top <= mid) n = i + 1
        }
        if (n !== pageNowRef.current) { pageNowRef.current = n; setPageNow(n) }
      }
      // FULLSCREEN WAVE SWAY (Peter, 2026-07-10): while the PDF floats over the water, its scroll
      // drives the editor's --wave-x sway + dash twinkle exactly like editor scrolling does.
      // Scroll.tsx's sway effect folds this absolute top into its base+top formula.
      if (fullscreenRef.current) window.dispatchEvent(new CustomEvent('inkwave:pdf-sway', { detail: { top: sc.scrollTop } }))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(report) }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => { sc.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [citekey])

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
      // Clone whichever canvas is topmost: the sharp one when present, else the base fallback —
      // so the freeze matches what's actually on screen even for evicted/not-yet-sharp pages.
      const c = pg.sharpCanvas ?? pg.baseCanvas
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
    const initZoom = savedUserZoom() ?? 1 // manual-zoom override survives across opens; 1 = fit default
    setZoom(initZoom)
    selectedMkRef.current = null; setSelectedMk(null) // a fresh document can't keep a stale selection
    // Fresh document → re-arm the atomic reveal (the citekey key usually remounts the component,
    // but a data change on the same key must re-gate too). Cap ~1.5s: reveal whatever is painted.
    revealedRef.current = false
    setRevealed(false)
    const revealCap = setTimeout(() => { if (!cancelled) { revealedRef.current = true; setRevealed(true) } }, 1500)

    void (async () => {
      setStatus('loading')
      try {
        const pdfjs = await getPdfjs()
        const task = pdfjs.getDocument({ data: data.slice(0), ...PDF_DOC_PARAMS }) // slice: keep caller's buffer usable
        loadingTask = task
        const doc = await task.promise
        if (cancelled) return
        docRef.current = doc as PdfDoc
        setPageTotal((doc as PdfDoc).numPages)

        const containerW = (scrollRef.current?.clientWidth ?? 800) - 24
        const baseVp = (await doc.getPage(1)).getViewport({ scale: 1 })
        const pageFit = Math.max(ZOOM_MIN, Math.min(3, containerW / baseVp.width))
        // DEFAULT ZOOM = FIT-TO-TEXT-WIDTH: scale so the first visible page's text bbox spans the
        // panel (TEXT_FIT_INSET safety either side). Clamped to [page-fit … 2×page-fit] so a weird
        // bbox can never zoom out below whole-page fit or crop wildly; no text layer → page fit.
        const ext = await textExtentsOf(doc as PdfDoc, initialPage ?? 1)
        if (cancelled) return
        fitInputsRef.current = { pageW: baseVp.width, ext: ext ? { x0: ext.x0, x1: ext.x1 } : null }
        if (ext) {
          const s = (containerW - 2 * TEXT_FIT_INSET) / (ext.x1 - ext.x0)
          fitScaleRef.current = Math.max(pageFit, Math.min(3, 2 * pageFit, s))
          textFitX0Ref.current = ext.x0 // scrollToTarget centres the text block horizontally
        } else {
          fitScaleRef.current = pageFit
          textFitX0Ref.current = null
        }

        await renderPages(fitScaleRef.current * initZoom)
        renderedZoomRef.current = initZoom // drawn at fit×override → baseline for the CSS-zoom ratio
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
        requestAnimationFrame(() => {
          settle(3) // the FIRST scrollToTarget just ran synchronously — the viewport is now the real one
          // ATOMIC REVEAL: front the initial viewport's renders (canvas + text layer — the
          // text-ready contract on renderOnePage), then check the gate. maybeReveal() is ALSO
          // called after every completed render, so even if a fit/live-fit re-render supersedes
          // this token mid-flight, whichever render completes last opens the gate — the toolbar
          // can never appear ahead of the text again.
          void renderVisibleNow(renderTokenRef.current).catch(() => {}).then(() => { if (!cancelled) maybeReveal() })
        })
      } catch {
        if (!cancelled) { setStatus('error'); revealedRef.current = true; setRevealed(true) } // error shows immediately — no gate
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(revealCap)
      renderTokenRef.current++       // supersede any in-flight render
      observerRef.current?.disconnect()
      docRef.current = null
      if (loadingTask) void loadingTask.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, citekey])

  // Keyboard over the PDF viewer (hovered or focus-within): Ctrl/Cmd+F opens the in-PDF find bar;
  // Ctrl+T / Ctrl+H / Ctrl+E toggle the text / highlight / eraser tools (Peter, 2026-07-10 —
  // preventDefault overrides the browser's tab/history/search defaults, and NEVER while typing in
  // a note's contentEditable or an input: this runs capture-phase, BEFORE the note's own
  // stopPropagation, so the typing gate must be explicit); Escape leaves the active markup mode
  // (and closes the find bar) — unless a note is being edited (its own handler eats Escape first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current && !(rootRef.current && rootRef.current.contains(document.activeElement))) return
      const ae = document.activeElement as HTMLElement | null
      const typing = !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => { searchBoxRef.current?.focus(); searchBoxRef.current?.select() })
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !typing) {
        const kind = ({ t: 'text', h: 'highlight', e: 'erase' } as Record<string, ToolKind | undefined>)[e.key.toLowerCase()]
        if (kind) { e.preventDefault(); e.stopPropagation(); armTool(toolRef.current === kind ? null : kind) }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectedMkRef.current) {
        e.preventDefault() // a selected markup annotation deletes like a selected note
        removeHighlight(selectedMkRef.current)
      } else if (e.key === 'Escape') {
        if (selectedMkRef.current) selectMarkup(null)
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
      // This effect only fires on USER zoom (the load path sets zoom before status is 'ready', and
      // the guard above drops those) → persist the override so future opens skip the fit default.
      try { localStorage.setItem(USER_ZOOM_KEY, String(zoom)) } catch { /* private mode */ }
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
        // ⚠ RE-ASSERT THE ANCHOR AFTER LAYOUT (2026-08-28, Peter: "it goes towards the cursor then
        // flashes back centrally after you finish zooming"). scrollLeft is CLAMPED BY THE BROWSER to
        // the scroll range that exists AT THE MOMENT OF THE WRITE — and immediately after
        // renderPages resolves the new, wider canvases have not necessarily been laid out, so the
        // write is silently clipped to the OLD maximum and the view lands wherever that put it. The
        // arithmetic was never wrong; it was applied one layout too early. Setting it again after
        // the visible pages have painted, and once more on the next frame, costs two assignments
        // and makes the clamp harmless.
        // STATED, NOT PROVED: this is the mechanism that fits the symptom, reasoned from the clamp
        // and the ordering — it has not been reproduced here (it needs a real PDF and a trackpad).
        const anchor = () => {
          el.scrollLeft = Math.max(0, (sl + ax) * ratio - ax)
          el.scrollTop  = Math.max(0, (st + ay) * ratio - ay)
        }
        anchor()
        await renderVisibleNow(renderTokenRef.current) // paint the visible pages BEFORE lifting the freeze
        anchor()
        requestAnimationFrame(() => { anchor(); requestAnimationFrame(unfreeze) })
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
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * pdfZoomFactor(e.deltaY))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Re-fit as soon as the margin opens or closes: it changes the width the page has to fit into,
  // which is exactly what the ResizeObserver would react to if the PANEL had changed instead.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || status !== 'ready' || zoomStateRef.current !== 1) return
    const fit = computeTextFit(fitInputsRef.current, el.clientWidth, fitScaleRef.current, commentMarginRef.current)
    if (Math.abs(fit - fitScaleRef.current) < 0.001) return
    fitScaleRef.current = fit
    void renderPages(fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentMargin, status])

  // ── DELETE REMOVES THE SELECTED NOTE (Peter, 2026-08-28) ─────────────────────────────────────
  // The note's own keydown only fires while the note has focus, and a tap on the page furniture
  // takes it away while the note still LOOKS selected. Scoped to this panel's root and skipped
  // whenever a real text field (or the note in edit mode) owns the keystroke.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const sel = selectedNoteRef.current
      if (!sel) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select')) return
      if (t?.isContentEditable) return            // editing the note: Delete means delete a character
      e.preventDefault()
      selectedNoteRef.current = null
      sel.remove()
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [])

  // ── ONE AXIS AT A TIME (Peter, 2026-08-28) ───────────────────────────────────────────────────
  // "restrict the scroll in pdf mode so that you can only go down and up or left to right at a
  // time. So the downwards scroll isn't subject to arbitrary drift left and right." A trackpad
  // reports both axes on every event and no hand is perfectly vertical, so reading down a zoomed
  // page slides it sideways until the column is off-centre. The axis is chosen ONCE per gesture
  // (components/axisLock.ts) — per event, a wobble flips it, which is the drift wearing a hat.
  // Ctrl/⌘ is left alone above: that gesture is the zoom, and it owns both axes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const st = newAxisState()
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      // preventDefault ALWAYS, including while undecided: letting an undecided event through is
      // letting the browser scroll both axes, which is the lock leaking at exactly the moment the
      // hand is least steady (see axisLock.ts).
      e.preventDefault()
      const move = lockAxis(st, e.deltaX, e.deltaY, e.timeStamp)
      if (!move) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (move.axis === 'y') el.scrollTop += move.delta * unit
      else el.scrollLeft += move.delta * unit
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── LIVE FIT ON PANEL RESIZE (Peter, 2026-07-10) ─────────────────────────────────────────────
  // While the panel is drag-resized (or the window changes width) at the DEFAULT zoom, the
  // fit-to-text baseline tracks the live width so the text margins stay snapped to the panel edges
  // through the whole drag. Per resize frame: recompute the fit from the stored inputs and
  // CSS-scale the current render (cheap — no page repaint); on settle, ONE sharp re-render at the
  // new fit (the same instant-transform + settle pattern as the wheel zoom). A manual zoom override
  // (zoom ≠ 1 — the persisted user zoom) always wins: no tracking until they're back at 100%.
  useEffect(() => {
    if (status !== 'ready') return
    const sc = scrollRef.current, viewer = viewerRef.current
    if (!sc || !viewer) return
    let baseW = sc.clientWidth
    let baseSt: number | null = null // scrollTop at gesture start — frames compose from it
    let settle: ReturnType<typeof setTimeout> | undefined
    const fitFor = (w: number): number => computeTextFit(fitInputsRef.current, w, fitScaleRef.current, commentMarginRef.current)
    const ro = new ResizeObserver(() => {
      const w = sc.clientWidth
      if (w === baseW) return
      // Manual zoom wins; rotation swaps the page dims out from under the stored inputs — skip both.
      if (zoomStateRef.current !== 1 || rotationRef.current % 360 !== 0) { baseW = w; return }
      const newFit = fitFor(w)
      const r = newFit / fitScaleRef.current // vs the RENDERED fit baseline
      if (baseSt == null) baseSt = sc.scrollTop
      viewer.style.transformOrigin = '0 0'
      viewer.style.transform = `scale(${r})`
      sc.scrollTop = baseSt * r // top-left origin ⇒ scaling scroll holds the top content line
      if (textFitX0Ref.current != null)
        sc.scrollLeft = Math.max(0, textFitX0Ref.current * fitScaleRef.current * r - TEXT_FIT_INSET)
      clearTimeout(settle)
      settle = setTimeout(() => {
        baseW = sc.clientWidth
        baseSt = null
        const fit = fitFor(sc.clientWidth)
        if (fit === fitScaleRef.current) { viewer.style.transform = ''; viewer.style.transformOrigin = ''; return }
        const st = sc.scrollTop
        const unfreeze = freezeViewport() // cover the teardown+repaint — no blank flash
        fitScaleRef.current = fit
        void renderPages(fit * zoomStateRef.current).then(async () => {
          viewer.style.transform = ''
          viewer.style.transformOrigin = ''
          sc.scrollTop = st // the per-frame math already put the right content position here
          if (textFitX0Ref.current != null) sc.scrollLeft = Math.max(0, textFitX0Ref.current * fit - TEXT_FIT_INSET)
          await renderVisibleNow(renderTokenRef.current)
          requestAnimationFrame(() => requestAnimationFrame(unfreeze))
        }).catch(unfreeze)
      }, 220)
    })
    ro.observe(sc)
    return () => { ro.disconnect(); clearTimeout(settle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // ── FULLSCREEN ENTER/EXIT REFIT (Peter, 2026-07-10: "exit leaves the text ridden off to the
  // right") ── the dock↔fullscreen jump is the one width change the live-fit RO could leave
  // half-done: with a persisted manual zoom (zoomStateRef ≠ 1) the RO deliberately skips, so the
  // old fullscreen scrollLeft survived into the much narrower dock — text jammed off-screen. Drive
  // the transition deterministically: at the fit baseline, recompute fit for the NEW width, sharp
  // re-render, and snap the text's left margin flush (same maths as the load path); under a manual
  // zoom override, clamp scrollLeft into the new range (the user's zoom is respected, never reset).
  const prevFsRef = useRef(!!fullscreen)
  useEffect(() => {
    const was = prevFsRef.current
    prevFsRef.current = !!fullscreen
    if (was === !!fullscreen || status !== 'ready') return
    const sc = scrollRef.current, viewer = viewerRef.current
    if (!sc || !viewer) return
    // Next frame: the panel's new geometry has laid out, clientWidth is the real new width.
    const raf = requestAnimationFrame(() => {
      if (zoomStateRef.current !== 1 || rotationRef.current % 360 !== 0) {
        sc.scrollLeft = Math.max(0, Math.min(sc.scrollLeft, sc.scrollWidth - sc.clientWidth))
        return
      }
      const inputs = fitInputsRef.current
      if (!inputs) return
      const containerW = sc.clientWidth - 24
      const pageFit = Math.max(ZOOM_MIN, Math.min(3, containerW / inputs.pageW))
      const fit = inputs.ext
        ? Math.max(pageFit, Math.min(3, 2 * pageFit, (containerW - 2 * TEXT_FIT_INSET) / (inputs.ext.x1 - inputs.ext.x0)))
        : pageFit
      const snapLeft = (f: number) => {
        sc.scrollLeft = textFitX0Ref.current != null ? Math.max(0, textFitX0Ref.current * f - TEXT_FIT_INSET) : 0
      }
      if (Math.abs(fit - fitScaleRef.current) < 0.001) { snapLeft(fit); return }
      const st = sc.scrollTop * (fit / fitScaleRef.current) // hold the top content line through the rescale
      const unfreeze = freezeViewport()
      fitScaleRef.current = fit
      void renderPages(fit).then(async () => {
        viewer.style.transform = ''
        viewer.style.transformOrigin = ''
        sc.scrollTop = st
        snapLeft(fit)
        await renderVisibleNow(renderTokenRef.current)
        requestAnimationFrame(() => requestAnimationFrame(unfreeze))
      }).catch(unfreeze)
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, status])

  function scrollToTarget() {
    const container = scrollRef.current
    if (!container) return
    // Fit-to-text default view: the page is deliberately wider than the panel, so start with the
    // TEXT block centred horizontally (its left margin at the safety inset). Every initial-scroll
    // path gets this; the user can then h-scroll freely.
    if (textFitX0Ref.current != null)
      container.scrollLeft = Math.max(0, textFitX0Ref.current * fitScaleRef.current * renderedZoomRef.current - TEXT_FIT_INSET)
    const cRect = container.getBoundingClientRect()
    const toTop = (pg: PageRef, extra = 0) =>
      container.scrollTop + (pg.wrapper.getBoundingClientRect().top - cRect.top) + extra
    let top: number | null = null
    // Author-year "open where you left off": restore the exact last scroll (placeholder page heights are
    // correct from the start, so scrollTop is meaningful immediately).
    if (restoreScroll) {
      const saved = getLastPdfScroll(citekey)
      if (saved != null) { container.scrollTop = Math.max(0, saved); return }
    }
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
    // Group the selection's rects BY PAGE — a selection spanning a page break must highlight BOTH pages,
    // so we make one highlight per page (a highlight carries a single page).
    const byPage = new Map<number, HighlightRect[]>()
    for (const cr of clientRects) {
      // Skip spurious rects — a page-tall or zero rect (e.g. pdf.js's .endOfContent, which the selection
      // range picks up) is what paints the WHOLE page when you only dragged over a few words.
      if (cr.height < 1 || cr.width < 1 || cr.height > 60) continue
      for (let i = 0; i < pagesRef.current.length; i++) {
        const pr = pagesRef.current[i].hlLayer.getBoundingClientRect()
        const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
        if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
          const arr = byPage.get(i + 1) ?? []
          arr.push({ x: (cr.left - pr.left) / pr.width, y: (cr.top - pr.top) / pr.height, w: cr.width / pr.width, h: cr.height / pr.height })
          byPage.set(i + 1, arr)
          break
        }
      }
    }
    if (!byPage.size) return null
    const groups = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, rects]) => ({ page, rects }))
    const last = clientRects[clientRects.length - 1]
    const box = scrollRef.current!.getBoundingClientRect()
    return { text, page: groups[0].page, rects: groups[0].rects, groups, x: last.right - box.left, y: last.bottom - box.top }
  }

  function onMouseUp(e: React.MouseEvent) {
    const d = downRef.current; downRef.current = null
    // A BARE CLICK = pressed and released on (almost) the same spot, not on an annotation's own DOM
    // (notes / ✕ handles keep their select/edit/delete behaviour untouched). Anything that moved is
    // a drag (text selection, note drawing) — never a disarm/select trigger.
    const onAnnot = !!d?.onAnnot || !!(e.target as HTMLElement).closest?.('[data-hl-id], button')
    const bareClick = !!d && !onAnnot && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5
    if (onAnnot && selectedMkRef.current) selectMarkup(null) // focus moved to a note — drop the markup selection
    const info = selectionInfo()
    // Text-tool placement + eraser are click-driven (onPdfPointerDown) — nothing to do on mouse-up.
    if (toolRef.current === 'text' || toolRef.current === 'erase') { window.getSelection()?.removeAllRanges(); setPending(null); return }
    if (!info) {
      if (bareClick) {
        // MARKUP SELECT / BARE-CLICK DISARM (Peter, 2026-07-10): a click on a highlight/underline/
        // strike selects it (outline + inline colour popup — never a disarm); a click that would
        // otherwise do NOTHING deselects whatever was selected and acts like Escape on the armed tool.
        const hl = markupAt(e.clientX, e.clientY)
        if (hl) selectMarkup(hl, e)
        else {
          if (selectedMkRef.current) selectMarkup(null)
          if (toolRef.current) setTool(null)
        }
      }
      setPending(null); return
    }
    // A markup tool is active → apply it immediately (Firefox-style); otherwise offer the toolbar.
    if (toolRef.current) {
      void createHighlight(info, toolRef.current, colorRef.current, false)
      window.getSelection()?.removeAllRanges()
      setPending(null)
    } else {
      setPending(info)
    }
  }

  // iOS text selection (long-press + drag handles) never fires mouseup on the container, so the
  // pending-annotation toolbar would never appear on touch. Mirror onMouseUp off document.selectionchange
  // instead, debounced 300ms so it settles after the handles stop moving. Touch-only: on desktop the
  // mouse path already covers it, and a >300ms pause MID-drag would misfire an armed tool.
  // Loop guards: a programmatic removeAllRanges refires selectionchange, so (a) skip one event after our
  // own clear and (b) never act on a collapsed/outside selection — in particular we never CLEAR pending
  // here, because tapping a pending-toolbar button collapses the selection an instant before its click.
  const skipSelChangeRef = useRef(false)
  useEffect(() => {
    if (!isTouchDevice()) return
    let t: ReturnType<typeof setTimeout> | undefined
    const onSelChange = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (skipSelChangeRef.current) { skipSelChangeRef.current = false; return }
        const tool = toolRef.current
        if (tool === 'text' || tool === 'erase') return // tap/drag-driven tools; not selection-driven
        const info = selectionInfo()
        if (!info) return
        if (tool) { // armed markup tool → apply immediately, exactly like onMouseUp
          skipSelChangeRef.current = true
          void createHighlight(info, tool, colorRef.current, false)
          window.getSelection()?.removeAllRanges()
          setPending(null)
        } else {
          setPending(info)
        }
      }, 300)
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => { clearTimeout(t); document.removeEventListener('selectionchange', onSelChange) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Text tool: click-DRAG on a page to set the note box's WIDTH and HEIGHT (both axes); it still grows
  // downward if the text overflows. A plain click (tiny drag) falls back to a default size. Dotted preview.
  const textDragRef = useRef<{ pageIdx: number; startX: number; startY: number; preview: HTMLDivElement; pr: DOMRect } | null>(null)
  const editNoteIdRef = useRef<string | null>(null) // note id to auto-enter-edit after the next redraw
  // Step through the source's highlights in reading order (page, then top-to-bottom). Scrolls the PDF to
  // the highlight and flashes it; if "sync editor" is on and the highlight is tied to a citation
  // occurrence (instanceId), also asks the editor to scroll to that citation.
  function stepHighlight(dir: 1 | -1): void {
    const ordered = highlightsRef.current
      .filter(h => h.page > 0 && h.rects[0])
      .sort((a, b) => a.page - b.page || (a.rects[0].y - b.rects[0].y))
    if (!ordered.length) return
    const next = (hlNavRef.current + dir + ordered.length) % ordered.length
    hlNavRef.current = next
    const hl = ordered[next]
    const pg = pagesRef.current[hl.page - 1]
    const sc = scrollRef.current
    if (pg && sc) {
      const y = pg.wrapper.offsetTop + (hl.rects[0].y * (pg.hlLayer.clientHeight || pg.h)) - 80
      sc.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
      // brief flash on the target highlight
      window.setTimeout(() => {
        const el = pg.hlLayer.querySelector(`[data-hl-id="${hl.id}"]`) as HTMLElement | null
        if (el) { el.style.transition = 'box-shadow 200ms'; el.style.boxShadow = `0 0 0 3px ${INK}`; window.setTimeout(() => { el.style.boxShadow = 'none' }, 900) }
      }, 260)
    }
    if (syncEditor && hl.instanceId) {
      window.dispatchEvent(new CustomEvent('inkwave:goto-citation-instance', { detail: { instanceId: hl.instanceId } }))
    }
  }

  // Eraser: click any annotation (highlight / underline / strike / note) to remove it.
  // Returns whether it actually erased something (the bare-click disarm keys off a whole
  // gesture that removed nothing).
  function eraseAt(clientX: number, clientY: number): boolean {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pr = pagesRef.current[i].hlLayer.getBoundingClientRect()
      if (clientX < pr.left || clientX > pr.right || clientY < pr.top || clientY > pr.bottom) continue
      const fx = (clientX - pr.left) / pr.width, fy = (clientY - pr.top) / pr.height
      // topmost-first, so the eraser removes what's visually on top
      for (let j = highlightsRef.current.length - 1; j >= 0; j--) {
        const hl = highlightsRef.current[j]
        if (hl.page !== i + 1) continue
        const hit = hl.rects.some(r => fx >= r.x - 0.005 && fx <= r.x + (r.w || 0.3) + 0.005 && fy >= r.y - 0.01 && fy <= r.y + (r.h || 0.04) + 0.01)
        if (hit) { removeHighlight(hl.id); return true }
      }
      return false
    }
    return false
  }

  // Hit-test a click against MARKUP annotations (highlight/underline/strike — text notes are real
  // DOM and select themselves). Same generous rect maths as the eraser, topmost-first.
  function markupAt(clientX: number, clientY: number): PdfHighlight | null {
    for (let i = 0; i < pagesRef.current.length; i++) {
      const pr = pagesRef.current[i].hlLayer.getBoundingClientRect()
      if (clientX < pr.left || clientX > pr.right || clientY < pr.top || clientY > pr.bottom) continue
      const fx = (clientX - pr.left) / pr.width, fy = (clientY - pr.top) / pr.height
      for (let j = highlightsRef.current.length - 1; j >= 0; j--) {
        const hl = highlightsRef.current[j]
        if (hl.page !== i + 1 || (hl.kind ?? 'highlight') === 'text') continue
        if (hl.rects.some(r => fx >= r.x - 0.005 && fx <= r.x + r.w + 0.005 && fy >= r.y - 0.01 && fy <= r.y + r.h + 0.01)) return hl
      }
      return null
    }
    return null
  }

  // ONE pointer path for mouse AND touch (pointerdown + capture): a bare tap with the note tool still
  // creates the default-size box (tiny-drag fallback below), and the eraser works with taps and drags.
  // The container gets touch-action:none only while one of these drag tools is armed, so the gesture
  // never turns into a native pan; preventDefault also suppresses the compatibility mouse events.
  // Where the gesture STARTED — onMouseUp's bare-click detection (disarm / markup-select) needs
  // the down position (click vs drag) and whether the press landed on an annotation's own DOM.
  const downRef = useRef<{ x: number; y: number; onAnnot: boolean } | null>(null)
  function onPdfPointerDown(e: React.PointerEvent) {
    downRef.current = { x: e.clientX, y: e.clientY, onAnnot: !!(e.target as HTMLElement).closest?.('[data-hl-id], button') }
    if (toolRef.current === 'erase') {
      e.preventDefault()
      // Track the whole gesture: a stationary tap that erased NOTHING acts like Escape (bare-click
      // disarm) — a tap that hit something, or any drag-erase swipe, keeps the eraser armed.
      let erased = eraseAt(e.clientX, e.clientY)
      let moved = false
      const sx = e.clientX, sy = e.clientY
      e.currentTarget.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => { // drag-erase: keep hitting along the swipe
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 5) moved = true
        if (eraseAt(ev.clientX, ev.clientY)) erased = true
      }
      const done = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', done)
        document.removeEventListener('pointercancel', done)
        if (!erased && !moved) setTool(null) // bare click on nothing = disarm (Peter, 2026-07-10)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', done)
      document.addEventListener('pointercancel', done)
      return
    }
    if (toolRef.current !== 'text') return
    if (!pagesRef.current.length) return
    // A press INSIDE an existing note (or on any annotation's ✕ handle) must select/edit/delete
    // THAT element, never draw a new box over it — bail before the preview/capture starts, so the
    // note's own click handlers (select → edit) run untouched. Inside the scroller the only
    // buttons are those handles, so `button` is a safe part of the selector.
    if ((e.target as HTMLElement).closest?.('[data-hl-id], button')) return
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
    e.currentTarget.setPointerCapture(e.pointerId)
    const pr = pagesRef.current[idx].wrapper.getBoundingClientRect()
    // A clearly DOTTED preview rectangle tracks the drag so the gesture is discoverable. min-w/h
    // make it VISIBLE from the very first frame (pointerdown, before any movement) — a 0×0 border
    // read as "nothing happened" until the drag crossed a few px (Peter, 2026-07-10).
    const preview = document.createElement('div')
    preview.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;height:0;width:0;min-width:14px;min-height:14px;border:2px dotted ${INK};background:${colorRef.current}44;z-index:30;pointer-events:none;border-radius:4px;`
    document.body.appendChild(preview)
    textDragRef.current = { pageIdx: idx, startX: e.clientX, startY: e.clientY, preview, pr }
    document.addEventListener('pointermove', onTextDragMove)
    document.addEventListener('pointerup', onTextDragUp)
    document.addEventListener('pointercancel', onTextDragCancel)
  }
  function detachTextDrag() {
    document.removeEventListener('pointermove', onTextDragMove)
    document.removeEventListener('pointerup', onTextDragUp)
    document.removeEventListener('pointercancel', onTextDragCancel)
  }
  function onTextDragMove(ev: PointerEvent) {
    const d = textDragRef.current
    if (!d) return
    // 2-D rubber band — both horizontal and vertical.
    d.preview.style.left = `${Math.min(ev.clientX, d.startX)}px`
    d.preview.style.top = `${Math.min(ev.clientY, d.startY)}px`
    d.preview.style.width = `${Math.abs(ev.clientX - d.startX)}px`
    d.preview.style.height = `${Math.abs(ev.clientY - d.startY)}px`
  }
  function onTextDragCancel() { // gesture aborted by the system — drop the preview, create nothing
    detachTextDrag()
    textDragRef.current?.preview.remove()
    textDragRef.current = null
  }
  function onTextDragUp(ev: PointerEvent) {
    const d = textDragRef.current
    detachTextDrag()
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
      ...(instanceIdRef.current && !noRefRef.current ? { instanceId: instanceIdRef.current } : {}),
      ...(noRefRef.current ? { noRef: true } : {}),
    }
    highlightsRef.current = [...highlightsRef.current, hl]
    editNoteIdRef.current = hl.id // redraw auto-enters edit mode on it
    redrawOverlays()
    noteAnnotation(citekey) // the ledger's annotating signal — see pdfActivity.ts
    persistMarks()
    void attachNoteAnchor(hl)
  }

  // ── TRANSLATION, PAGE VIEW → READER VIEW ─────────────────────────────────────────────────────
  // A mark made on the printed page gets a TEXT anchor as well as its rects, so the reader view can
  // place it. Deliberately AFTER the mark exists and is persisted: the anchor is an addition, never
  // a precondition — a page whose text cannot be read (a scan) must still get its highlight, and it
  // then simply shows in the reader view's "not placed here" list rather than being refused.
  // Returns nothing and swallows nothing silently: a page with no text answers null and the mark
  // keeps no anchor, which is the honest state.
  async function attachTextAnchors(made: PdfHighlight[], text: string): Promise<void> {
    const doc = docRef.current
    if (!doc || !made.length) return
    let changed = false
    for (const hl of made) {
      const reflow = await getPageReflow(doc, hl.page)
      if (!reflow) continue
      const a = anchorInPage(reflow.blocks, text)
      if (a) { hl.anchor = a; changed = true }
    }
    if (changed) persistMarks()
  }

  /** A text note's anchor: the paragraph NEAREST where it was dropped (Peter: "anchor text boxes at
   *  nearest text"). Its page coordinates describe a layout the reader view does not draw. */
  async function attachNoteAnchor(hl: PdfHighlight): Promise<void> {
    const doc = docRef.current
    const r0 = hl.rects[0]
    if (!doc || !r0) return
    const reflow = await getPageReflow(doc, hl.page)
    if (!reflow) return
    const bi = nearestBlock(reflow, r0.x + r0.w / 2, r0.y)
    if (bi == null) return
    const bt = reflow.blocks[bi]?.text ?? ''
    const anchorText = noteAnchorText(bt)
    if (!anchorText) return
    hl.anchor = { block: bi, start: Math.max(0, bt.indexOf(anchorText)), text: anchorText }
    persistMarks()
  }

  async function createHighlight(info: Pending, kind: HighlightKind, color: string, link: boolean) {
    // One highlight per page the selection spans (link/citekey attaches to the first page only).
    const made: PdfHighlight[] = info.groups.map((grp, g) => ({
      id: uuidv4(), page: grp.page, rects: grp.rects, color, kind,
      text: info.text, createdAt: new Date().toISOString(),
      ...(instanceIdRef.current && !noRefRef.current ? { instanceId: instanceIdRef.current } : {}),
      ...(noRefRef.current ? { noRef: true } : {}), ...(link && g === 0 ? { citekey } : {}),
    }))
    highlightsRef.current = [...highlightsRef.current, ...made]
    redrawOverlays()
    noteAnnotation(citekey) // the ledger's annotating signal — see pdfActivity.ts
    setMarkRev(v => v + 1)
    await saveHighlights(citekey, highlightsRef.current)
    void attachTextAnchors(made, info.text)
    if (link) onLinkToCitation?.(info.text, info.groups[0].page)
  }

  async function commitPending(color: string, link: boolean) {
    if (!pending) return
    const info = pending
    window.getSelection()?.removeAllRanges()
    setPending(null)
    await createHighlight(info, 'highlight', color, link)
  }

  const overscrollPx = zoom > 1.02 ? PDF_OVERSCROLL_PX : 0
  const commentMarginPx = commentMargin
    ? Math.round(Math.min(320, Math.max(120, (scrollRef.current?.clientWidth ?? 800) * 0.26)))
    : 0
  commentMarginRef.current = commentMarginPx

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }}>

      {/* Pre-reveal cover (Peter, 2026-07-09 refinement): the instant state is JUST a white window
          with the ✕ in the corner — no toolbar, no shimmer, nothing else. Everything (toolbar, pages,
          text, highlights, find bar, zoom + dock controls) arrives together when `revealed` flips.
          The cover sits ABOVE the opacity-0 contents so the in-progress layout never peeks through;
          the ✕ sits above the cover so the panel stays dismissible from the first frame. */}
      {!revealed && (
        <>
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 10, background: '#fff' }} />
          {onClose && (
            // The TOOLBAR's ✕, in its exact final position/style (BOTTOM-left — the toolbar lives
            // at the bottom now) — visual continuity: when the toolbar reveals, the ✕ doesn't move
            // or restyle (Peter, 2026-07-10: a moving loading ✕ read as a different control).
            <button type="button" onClick={onClose} title="Close (Esc)"
              style={{ position: 'absolute', bottom: 7, left: 12, zIndex: 11, width: 28, height: 28, borderRadius: 6, border: `1px solid #d6cfe0`, background: '#fff', color: '#78716c', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          )}
        </>
      )}

      {/* ONE fade for everything inside the window: toolbar, context strip, pages (canvas + text
          layer + hlLayer overlays), zoom controls. opacity (not visibility/display) so layout and
          the initial canvas/text-layer renders run at full size underneath the shimmer. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        opacity: revealed ? 1 : 0, transition: 'opacity 200ms ease',
        pointerEvents: revealed ? undefined : 'none' }}>

      {/* Single consolidated toolbar — at the BOTTOM of the panel (Peter, 2026-07-10), on both
          platforms; the quote/context strip sits directly above it and the pages above that.
          Flex `order` does the visual re-stack (pages 1 · context 2 · toolbar 3) without moving
          the JSX, so every absolute-positioned popover keeps its anchor. Secondary controls are
          compact; every control explains itself via its tooltip. */}
      {/* ONE ROW (Peter, 2026-08-28: "try to get this down to one row. Get rid of unnecessary space
          between button types"). gap 6→3 and the dividers reduced to margin-only separators; the
          colour swatches are gone entirely, folded into hold-palettes on the tools they belong to. */}
      <div style={{ order: 3, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, rowGap: 4, padding: '6px 8px', borderTop: `1px solid ${INK}22`, background: '#faf8fc', flexWrap: 'wrap' }}
        onMouseLeave={() => setHint(null)}>
        {onClose && (
          <button type="button" onClick={onClose} title="Close (Esc)" onMouseEnter={() => setHint('close the PDF')}
            style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid #d6cfe0`, background: '#fff', color: '#78716c', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        )}
        {/* ⇄ sync-editor and # don't-add-pages MOVED TO THE RIGHT END (Peter, 2026-08-28: "let's
            move these two buttons over to the rhs"). They are per-session preferences, not actions
            you reach for while reading, so they belong with the dock controls rather than beside
            the ✕. Functions unchanged — the JSX moved, nothing else. */}
        {/* Hide-on-editor-click toggle (full screen) — lights up purple when on; off by default.
            Hidden on touch: the phone top dock NEVER closes on editor taps (tapping the bottom
            half to TYPE is its whole point — Peter, 2026-07-10), so the toggle would be inert. */}
        {!isTouch && (
        <button type="button" title="In full screen, hide the PDF when you click back into the editor"
          onMouseEnter={() => setHint('in full screen, clicking back into the editor drops the PDF viewer (off by default)')}
          onClick={() => setHideOnEditorClick(v => !v)}
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', fontSize: '0.95rem',
            border: `1px solid ${hideOnEditorClick ? INK : '#d6cfe0'}`, background: hideOnEditorClick ? `${INK}1f` : '#fff', color: INK }}>◧</button>
        )}
        {fullscreenButton}
        <span style={{ width: 1, height: 18, background: `${INK}22`, margin: '0 3px', flexShrink: 0 }} />
        {TOOLS.map(t => {
          const active = tool === t.kind
          const btn = (
            <button key={t.kind} type="button" title={`${t.title} — click, then select text${t.kind === 'highlight' || t.kind === 'text' ? ' · hold for colours' : ''}`}
              onMouseEnter={() => setHint(`${t.title}`)}
              // Keep a live text selection alive through the press — mousedown on a button would
              // collapse it before onClick could read it (the pending toolbar works from stored
              // state for the same reason). Harmless for the tools that don't use selections.
              onMouseDown={ev => ev.preventDefault()}
              onClick={() => {
                // APPLY-TO-SELECTION (Peter, 2026-07-10): text already selected + an edit tool
                // pressed → apply that markup IMMEDIATELY in the tool's default colour (dark blue
                // for U/S, yellow for highlight — the armTool defaults), then clear the selection.
                // The button does NOT arm in that case; with no selection it toggles as before.
                if (t.kind === 'highlight' || t.kind === 'underline' || t.kind === 'strike') {
                  const info = selectionInfo()
                  if (info) {
                    void createHighlight(info, t.kind, toolColorsRef.current[t.kind] ?? COLORS[0], false)
                    skipSelChangeRef.current = true // our removeAllRanges refires selectionchange (touch mirror)
                    window.getSelection()?.removeAllRanges()
                    setPending(null)
                    return
                  }
                }
                armTool(active ? null : t.kind)
              }}
              style={{
                width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${active ? INK : '#d6cfe0'}`,
                // THE BUTTON WEARS ITS OWN COLOUR (Peter, 2026-08-28: "the colour of these buttons
                // needs to reflect the colour chosen"). Now that each palette lives under its tool,
                // the tool is the only place the choice is visible — a fixed yellow ▮ over a pink
                // highlighter is a control lying about what it will do. Read from the ref, which is
                // fresh on every render because setColor re-renders.
                // ⚠ A NOTE IS A COLOURED PIECE OF PAPER, SO THE BUTTON IS TOO (Peter, 2026-08-28:
                // "with the text colour, it should be the background not the T that gets coloured",
                // "the background should be yellow by default"). The highlighter's colour lives in
                // its ▮ mark, which IS the ink; a sticky note's colour is the SHEET, and a coloured
                // letter T on white said the wrong thing about what the tool would produce.
                // The `text` tool's SHEET colour wins over the armed tint: which colour the note
                // will be is the more useful fact, and the ring already shows it is armed.
                ...(t.kind === 'text'
                  ? { background: toolColorsRef.current.text ?? COLORS[0], color: '#2a2a2a' }
                  : { background: active ? `${INK}14` : '#fff',
                      color: t.kind === 'highlight' ? (toolColorsRef.current.highlight ?? COLORS[0]) : INK }),
                textDecoration: t.kind === 'strike' ? 'line-through' : t.kind === 'underline' ? 'underline' : 'none',
              }}>{t.kind === 'erase' ? <EraserIcon /> : t.label}</button>
          )
          // ⚠ THE PALETTE LIVES UNDER THE TOOL IT BELONGS TO (Peter, 2026-08-28: "move highlight
          // colour into click and hold on the highlight button. Add a text colour click and hold on
          // text that changes the sticky note colour"). Six permanently-visible swatches were six
          // tap targets for a choice made once in a while, and they were the reason the row wrapped.
          // CLICK still arms the tool — unchanged; only a HOLD opens the colours, the same gesture
          // the style bar uses (components/useLongPress.ts, one implementation).
          const palette = t.kind === 'highlight' ? HIGHLIGHT_COLORS : t.kind === 'text' ? NOTE_COLORS : null
          if (!palette) return btn
          return (
            <div key={t.kind} style={{ position: 'relative', flexShrink: 0 }}>
              <span onPointerDown={() => {
                holdRef.current[t.kind] = setTimeout(() => { heldRef.current = true; setColorOpen(t.kind) }, HOLD_MS)
              }}
                onPointerUp={() => { const h = holdRef.current[t.kind]; if (h) clearTimeout(h) }}
                onPointerLeave={() => { const h = holdRef.current[t.kind]; if (h) clearTimeout(h) }}
                onPointerCancel={() => { const h = holdRef.current[t.kind]; if (h) clearTimeout(h) }}
                onClickCapture={(ev) => { if (heldRef.current) { heldRef.current = false; ev.stopPropagation(); ev.preventDefault() } }}>
                {btn}
              </span>
              {colorOpen === t.kind && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onMouseDown={() => setColorOpen(null)} />
                  <div className="iw-nightable" style={{ position: 'absolute', bottom: 34, left: 0, zIndex: 21, display: 'flex', gap: 6, padding: '7px 8px', borderRadius: 10, background: '#fff', border: `1px solid ${INK}44`, boxShadow: '0 4px 16px rgba(0,0,0,0.16)' }}>
                    {palette.map((c) => (
                      <button key={c} type="button" title={c}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          // A SELECTED annotation takes the swatch (recolour it); otherwise it sets
                          // this TOOL's colour — which is what makes one palette per tool coherent.
                          if (selectedMkRef.current) { recolorMarkup(selectedMkRef.current, c); setColorOpen(null); return }
                          setColor(c)
                          toolColorsRef.current[t.kind] = c
                          setColorOpen(null)
                        }}
                        style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: (toolColorsRef.current[t.kind] ?? color) === c ? `2px solid ${INK}` : '1px solid rgba(0,0,0,0.15)' }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
        {/* Text-note font size */}
        <select value={noteSize} title="Text note size" onMouseEnter={() => setHint('text-note font size')}
          onChange={e => { const n = Number(e.target.value); setNoteSize(n); try { localStorage.setItem('inkwave:pdfNoteSize', String(n)) } catch { /* private */ } }}
          // Narrower (Peter, 2026-08-28: "make the font size button smaller"). The iOS 16px floor
          // is untouched on touch — shrinking a control below it makes the page auto-zoom on focus
          // and STAY zoomed, which is a far worse bug than a wide select.
          // No "px", no dropdown arrow, no reserved arrow gutter (Peter, 2026-08-28) — the row has
          // to fit on ONE line and a two-digit number needs none of that to be read as a size.
          style={{ height: 28, width: isTouch ? 44 : 34, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: isTouch ? '16px' : '0.78rem', padding: '0 2px', cursor: 'pointer', flexShrink: 0, textAlign: 'center', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none' as never }}>
          {[8, 10, 12, 14, 16, 18, 20, 24, 28, 36].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ width: 1, height: 18, background: `${INK}22`, margin: '0 3px', flexShrink: 0 }} />
        <span style={{ width: 1, height: 18, background: `${INK}22`, margin: '0 3px', flexShrink: 0 }} />
        {/* Scroll-highlighted navigator */}
        <button type="button" title="Previous highlight" onMouseEnter={() => setHint('scroll through the highlights in order')} onClick={() => stepHighlight(-1)}
          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0, fontSize: '1rem', lineHeight: 1 }}>‹</button>
        <button type="button" title="Next highlight" onMouseEnter={() => setHint('scroll through the highlights in order')} onClick={() => stepHighlight(1)}
          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0, fontSize: '1rem', lineHeight: 1 }}>›</button>
        {/* Rotate lives in the toolbar (Peter, 2026-07-10) — the floating −/%/+ zoom pill is gone;
            Ctrl/⌘+wheel (and the persisted user zoom) remain the zoom path. */}
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
          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0, fontSize: '1.1rem', lineHeight: 1 }}>⟳</button>
        {/* FIT THE TEXT TO THE WINDOW (Peter, 2026-08-28: "it needs to zoom and pan sideways so
            that the edge of the text is flush with the window on both sides, and go into a state
            such that this flushness is maintained if you make the window bigger or smaller").
            Three things, and the third is the one that needed saying: it RESETS THE ZOOM OVERRIDE.
            Fit-to-text already re-fits itself on every panel resize — but only while zoom is 1
            ("manual zoom wins", and rightly: a resize must not undo a zoom the reader chose). So
            once you had zoomed, the flushness stopped following the window, and no amount of
            panning brought it back. Setting zoom to 1 is what re-enters the self-maintaining state;
            the scale and the pan below just get you there in one frame instead of on the next
            resize. */}
        <button type="button" title="Fit the text to the window" aria-label="Fit the text to the window"
          onMouseEnter={() => setHint('fit the text width to the window, and keep it fitted as the window changes')}
          onClick={() => {
            const el = scrollRef.current
            if (!el) return
            const fit = computeTextFit(fitInputsRef.current, el.clientWidth, fitScaleRef.current, commentMarginRef.current)
            setZoom(1)
            fitScaleRef.current = fit
            renderedZoomRef.current = 1
            void renderPages(fit)
            el.scrollLeft = textFitX0Ref.current != null
              ? Math.max(0, textFitX0Ref.current * fit - TEXT_FIT_INSET)
              : Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
          }}
          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0, fontSize: '1rem', lineHeight: 1 }}>⤢</button>
        {/* COMMENT MARGIN (Peter, 2026-08-28: "another button over here that refers to viewing with
            a padding on the right for adding comments"). Reserves a strip to the right of the page
            so sticky notes have somewhere to live that is not on top of the text. It changes the
            LAYOUT, not the render: the page is untouched, so a note's position is still a position
            on the page and turning the margin off cannot move one. */}
        <button type="button" title={commentMargin ? 'Hide the comment margin' : 'Show a margin on the right for notes'}
          onMouseEnter={() => setHint('reserve a margin on the right to put notes in')}
          onClick={() => setCommentMargin(v => { const n = !v; try { localStorage.setItem('inkwave:pdfCommentMargin', n ? '1' : '0') } catch { /* private */ } ; return n })}
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', fontSize: '0.95rem',
            border: `1px solid ${commentMargin ? INK : '#d6cfe0'}`, background: commentMargin ? `${INK}1f` : '#fff', color: INK }}>◨</button>
        {/* Grey status hints removed — every control explains itself via its hover tooltip (title). */}
        <span style={{ marginLeft: 'auto' }} />
        {/* TOGGLE GROUP right of the ✕ (Peter, 2026-07-10): ⇄ sync-editor, # don't-add-pages,
            ◧ hide-on-editor-click, ⛶ fullscreen — grouped at the left end, functions unchanged. */}
        {/* Sync-editor toggle — a box that lights up purple when on. */}
        <button type="button" title="Sync editor: scroll the editor to where the highlight is cited when you click the ‹ › arrows"
          onMouseEnter={() => setHint('scroll the editor to where the highlight is cited on clicking the arrows')}
          onClick={() => setSyncEditor(v => !v)}
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', fontSize: '1rem',
            border: `1px solid ${syncEditor ? INK : '#d6cfe0'}`, background: syncEditor ? `${INK}1f` : '#fff', color: INK }}>⇄</button>
        {/* "Don't add pages to inline" toggle — lights up purple when on. */}
        <button type="button" disabled={!!noRef} title="When on, highlights won't add page numbers to inline citations, wherever you opened from"
          onClick={() => setDontAddPages(v => !v)}
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: noRef ? 'default' : 'pointer', fontSize: '1rem',
            border: `1px solid ${(!!noRef || dontAddPages) ? INK : '#d6cfe0'}`, background: (!!noRef || dontAddPages) ? `${INK}1f` : '#fff', color: '#6b5b7e' }}>
          {/* ⚠ REDRAWN (Peter, 2026-08-28: "this button is really ugly. Do you think you can do
              better"). It was a text "#" with an absolutely-positioned 1.5px bar dragged across its
              middle — two glyph-metric hacks fighting each other, and it looked it. Now one SVG: a
              page with a folded corner and a struck-through page number, which says what the toggle
              actually does (don't add page numbers to the citation) instead of spelling it. */}
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h8l4 4v14H6z" />
            <path d="M14 3v4h4" />
            <path d="m8.5 17.5 7-7" stroke="#b45309" strokeWidth="1.8" />
            <text x="12" y="17" textAnchor="middle" fontSize="7" stroke="none" fill="currentColor">7</text>
          </svg>
        </button>
        {sideButtons}
        {dockButton}
      </div>

      {/* Context: the sentence in the editor just before the citation. Clicking it jumps to that citation
          in the document (via its instanceId). */}
      {context && !contextDismissed && (
        <div
          onClick={() => { if (instanceIdRef.current) window.dispatchEvent(new CustomEvent('inkwave:goto-citation-instance', { detail: { instanceId: instanceIdRef.current } })) }}
          title={instanceIdRef.current ? 'Go to this citation in the document' : undefined}
          style={{ order: 2, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: '0.82rem', lineHeight: 1.4, color: '#6b5b7e', background: '#f6f2fb', borderTop: `1px solid ${INK}18`, cursor: instanceIdRef.current ? 'pointer' : 'default' }}>
          <span style={{ fontStyle: 'italic', flex: 1, minWidth: 0 }}>“…{context}”</span>
          {/* Per-open dismiss — reclaims the strip's height; stopPropagation so it never jumps to the citation. */}
          <button type="button" title="Hide this context strip"
            onClick={ev => { ev.stopPropagation(); setContextDismissed(true) }}
            style={{ flexShrink: 0, width: 20, height: 20, border: 'none', background: 'transparent', color: '#8d7ba3', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, borderRadius: 4 }}>×</button>
        </div>
      )}

      <div style={{ order: 1, position: 'relative', flex: 1, minHeight: 0 }}>
      {/* Find-in-PDF bar (Ctrl+F) — anchored just ABOVE the bottom toolbar, opening upward. */}
      {searchOpen && (
        <div className="iw-nightable" style={{
          position: 'absolute', bottom: 10, right: 18, zIndex: 25,
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
            style={{ width: 240, fontSize: isTouch ? '16px' : '15px' /* <16px makes iOS auto-zoom on focus */, border: `1px solid ${INK}33`, borderRadius: 6, padding: '5px 10px', outline: 'none' }}
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
      {/* touch-action:none ONLY while a drag tool (note placement / eraser) is armed — normal browsing
          keeps native pan/pinch. user-select off too, so a long-press can't start iOS text selection
          mid-gesture. */}
      <div ref={scrollRef} onMouseUp={onMouseUp} onPointerDown={onPdfPointerDown}
        // The comment margin is PADDING on the scroller, not a change to the page: a note's position
        // is a position on the page, so turning the margin on or off can never move one.
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e9e7e3',
          padding: 12, paddingRight: 12 + commentMarginPx,
          touchAction: tool === 'text' || tool === 'erase' ? 'none' : 'auto',
          WebkitUserSelect: tool === 'text' || tool === 'erase' ? 'none' : undefined,
          userSelect: tool === 'text' || tool === 'erase' ? 'none' : undefined }}>
        {/* ⚠ ROOM TO SCROLL PAST THE PAGE (Peter, 2026-08-28: "if you're too zoomed in you can't
            scroll onto the pdf background. But we should allow one to scroll horizontally a bit of a
            way — enough to accommodate for textboxes and the like one might want to put on the edge
            of the document"). The scroll range is the CONTENT's width, so at zoom the page's own
            edges are the hard limits and a note placed at the margin sits where you cannot reach it.
            A gutter on the VIEWER (not the scroller) adds that reach without touching containerW,
            which every fit calculation is measured from — padding the scroller instead would move
            fit-to-text by 2×GUTTER and quietly change what "flush" means.
            Only while zoomed: at fit the page already sits in the pane and a scrollbar that buys
            nothing is just a scrollbar. */}
        <div ref={viewerRef} className="pdfViewer"
          style={{ '--scale-factor': 1, paddingLeft: overscrollPx, paddingRight: overscrollPx } as React.CSSProperties} />
        {/* Lower and clearer (Peter, 2026-08-28) — it sat on the text and read as part of it. */}
        {status === 'ready' && pageTotal > 0 && (
          <div aria-live="off" style={{ position: 'sticky', bottom: -2, left: 0, width: 'fit-content', marginLeft: 8,
            zIndex: 6, pointerEvents: 'none', background: '#fff', color: INK,
            border: `1px solid ${INK}55`, borderRadius: 999, padding: '3px 11px', fontSize: '12px',
            fontWeight: 600, fontFamily: 'system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
            {pageNow} / {pageTotal}
          </div>
        )}
        {status === 'loading' && <p style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>Loading PDF…</p>}
        {status === 'error' && <p style={{ textAlign: 'center', color: '#b45309', marginTop: 40 }}>Couldn't render this PDF.</p>}
      </div>

      {/* (The floating rotate/−/%/+ pill is gone — rotate moved into the bottom toolbar;
          Ctrl/⌘+wheel remains the zoom. Peter, 2026-07-10.) */}

      {/* Inline menu for a SELECTED markup annotation — the same colour-dots card as the pending
          toolbar, anchored at the click: dots recolour THAT annotation (as do the top-toolbar
          swatches while it stays selected); Remove mirrors Delete/Backspace. */}
      {selectedMk && (
        <div style={{
          position: 'absolute', left: Math.max(8, Math.min(selectedMk.x, (scrollRef.current?.clientWidth ?? 400) - 220)),
          top: selectedMk.y + 6, zIndex: 20, background: '#fff', border: `1px solid ${INK}44`, borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {COLORS.map(c => (
            <button key={c} type="button" title="Recolour this annotation" onClick={() => recolorMarkup(selectedMk.id, c)}
              style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer' }} />
          ))}
          <button type="button" title="Remove annotation (Delete)" onClick={() => removeHighlight(selectedMk.id)}
            style={{ fontSize: '0.72rem', color: '#7f1d1d', background: '#fff', border: '1px solid #7f1d1d55', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✕ Remove
          </button>
        </div>
      )}
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

      </div>{/* /atomic-reveal fade wrapper */}
    </div>
  )
}
