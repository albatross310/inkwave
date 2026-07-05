import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation } from './pageSettings'
import { MARGIN_BOTTOM } from './extensions/PaginationExtension'

// True on touch phones/tablets (coarse pointer, no hover). Device-based — does NOT change with
// browser zoom — so it's the right signal for "phone vs desktop" layout (margins, background).
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches === true
}

// The scroll "paper" chrome — the white page surface and the parchment column with its drop
// shadow. Shared by BOTH the live editor (TiptapEditor) and the prerendered/loading shell
// (EditorShell) so the static landing page is a direct visual function of the same components
// + CSS. Style changes here flow to both.
//
// Both wooden rollers are now removed and the page is pulled up near the top of the viewport
// (see the `.inkwave-editor-surface` rule in styles/index.css). Long-term the parchment grows a
// vectorised torn-paper edge; keeping the chrome in one shared component makes that a one-place change.
export function Scroll({
  children,
  paperRef,
  containerRef,
  phone = false,
  fill = false,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
  phone?: boolean // touch device: paper fills the screen, no background (see isTouchDevice())
  fill?: boolean  // the live editor: make the surface a fixed, full-region scroll container (desktop).
                  // Off for the snapshot view, where the surface must stay in-flow inside its split pane.
}) {
  // The (fixed) background waves don't scroll with the page. As you scroll we only sway them
  // HORIZONTALLY — alternating rows opposite ways (see the opposite --wave-x in styles/index.css) —
  // with no vertical movement. rAF-throttled.
  const surfaceRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Gapped mode draws a separate-sheet drop shadow at EACH page break (the rounded caps in
  // PaginationExtension); the single tall outer shadow would otherwise bleed continuously down the
  // left/right edges and through the gaps, so we drop it here and let the per-gap caps do the work.
  const gapped = gappedPagesEnabled()
  const [, rerender] = useState(0)
  useEffect(() => {
    const onChanged = () => rerender(n => n + 1)
    window.addEventListener('inkwave:page-settings-changed', onChanged)
    return () => window.removeEventListener('inkwave:page-settings-changed', onChanged)
  }, [])

  // ── In-app HYBRID zoom (one wheel axis, three phases) ────────────────────────────────────────────
  // Ctrl/⌘+wheel (or pinch) over the editor. A single level `zoomU` moves continuously through:
  //   Phase 1 (u 0→1): the whole PAGE zooms — width AND font grow together, so the reflow is constant
  //                    (the "font stays at the selected size") and the page just scales up to fill the
  //                    window width at u=1.
  //   Phase 2 (u 1→2): the page holds at full width; the FONT outruns it (grows 1×→2×) so text REFLOWS.
  //   Phase 3 (u >2):  the font KEEPS growing and the left/right margins narrow together for more column.
  // Implemented with REAL layout — the parchment's px width scales and the font scales via
  // --iw-editor-zoom; NO CSS `zoom`/transform. That's the whole point: clientWidth stays honest, so
  // PageGuides + the gapped-page PaginationExtension keep measuring page breaks correctly at every zoom
  // (CSS `zoom` inflated clientWidth → very long pages + wrong gapped breaks + guides that didn't track
  // the text). The hybrid only runs in the live editor on desktop; elsewhere it's plain font zoom.
  const hybrid = fill && !phone
  const [zoomU, setZoomU] = useState(() => {
    try { return Number(localStorage.getItem(hybrid ? 'inkwave:zoomU' : 'inkwave:editorZoom')) || 1 } catch { return 1 }
  })
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoomU(u => {
        // Hybrid moves ADDITIVELY through phase-space (0→~3.2); font-only mode keeps the old
        // MULTIPLICATIVE feel (0.6×–2.5×) so the snapshot view etc. behave exactly as before.
        const next = hybrid
          ? Math.max(0, Math.min(3.2, +(u + (e.deltaY < 0 ? 0.05 : -0.05)).toFixed(3)))
          : Math.max(0.6, Math.min(2.5, +(u * (e.deltaY < 0 ? 1.08 : 0.926)).toFixed(3)))
        try { localStorage.setItem(hybrid ? 'inkwave:zoomU' : 'inkwave:editorZoom', String(next)) } catch { /* private mode */ }
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hybrid])

  // fit = how much the true-A4 parchment must scale to fill the available width (>1 on wide screens,
  // <1 on narrow). Measured from the surface width so it tracks resizes AND the PDF panel opening.
  const [fit, setFit] = useState(1)
  useEffect(() => {
    if (!hybrid) return
    const el = surfaceRef.current
    if (!el) return
    const compute = () => {
      const landscape = getOrientation() === 'landscape'
      const ps = getPaperSize()
      const mm = ps === 'letter' ? (landscape ? 279 : 216) : (landscape ? 297 : 210)
      const paperPx = (mm * 96) / 25.4                 // true parchment width in CSS px (unzoomed)
      const avail = Math.max(120, el.clientWidth - 32)  // leave a small breathing gutter
      setFit(Math.max(0.2, +(avail / paperPx).toFixed(4)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    window.addEventListener('inkwave:page-settings-changed', compute)
    return () => { ro.disconnect(); window.removeEventListener('inkwave:page-settings-changed', compute) }
  }, [hybrid])

  // The parchment's true (100%) width in CSS px for the current paper size — what widthScale multiplies.
  const basePaperPx = (() => {
    const landscape = getOrientation() === 'landscape'
    const ps = getPaperSize()
    const mm = ps === 'letter' ? (landscape ? 279 : 216) : (landscape ? 297 : 210)
    return (mm * 96) / 25.4
  })()

  // Derive the knobs from (zoomU, fit). widthScale scales the parchment WIDTH; editorZoom scales the
  // FONT (--iw-editor-zoom). Phase 1: they move together (page zoom, constant reflow). Phase 2–3: the
  // font outruns the width (reflow), and past u=2 the side margins narrow too. Because fit multiplies
  // BOTH width and font, words-per-line depends only on how far past u=1 you are — never on screen size.
  const MIN_PAGE = 0.45 // most zoomed-out = 45% of the fill-to-width size
  let widthScale = 1, editorZoom = 1, marginScale = 1
  if (hybrid) {
    if (zoomU <= 1) { widthScale = (MIN_PAGE + (1 - MIN_PAGE) * Math.max(0, zoomU)) * fit; editorZoom = widthScale }
    else            { widthScale = fit; editorZoom = fit * zoomU }           // font outruns width past the fit point
    if (zoomU > 2)  marginScale = Math.max(0.12, 1 - (zoomU - 2) * 0.55)      // …and the side margins narrow
  } else {
    editorZoom = zoomU // font-only (snapshot view, phone): unchanged behaviour
  }
  const sideMarginPx  = getSideMarginPx()
  const topMarginPx   = getTopMarginPx()
  const btmMarginPx   = getBtmMarginPx()
  const paraSpacingEm = getParaSpacingEm()
  const columns       = getColumns()
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    // Desktop scrolls the surface itself (it's the scroll container); phone scrolls the window/body.
    const target: HTMLElement | Window = phone ? window : el
    let raf = 0
    const apply = () => {
      raf = 0
      const y = phone ? window.scrollY : el.scrollTop
      el.style.setProperty('--wave-x', `${(y * 0.09).toFixed(1)}px`) // horizontal sway
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    apply()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [phone])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}`}
      style={{ '--iw-editor-zoom': editorZoom } as React.CSSProperties}>
      {/* Parchment column. Desktop: a floating page (max-width + shadow + background gap). Phone:
          fills the screen edge-to-edge, no shadow. */}
      <div
        ref={paperRef}
        // FIXED page width (not max-width + w-full) so the text always reflows at true A4/Letter width.
        // That keeps words-per-line — and therefore words-per-page — constant regardless of screen
        // width, so the page-break guides + gapped pages fall at the SAME content on any screen (they
        // used to move because pageH scaled with the rendered width). Narrower containers scroll
        // horizontally instead of reflowing. Phone + 'scroll' paper keep the fluid full-width layout.
        className={(() => {
          if (phone || getPaperSize() === 'scroll') return 'mx-auto w-full'
          return 'mx-auto'
        })()}
        style={{
          width: (() => {
            if (phone) return undefined
            const ps = getPaperSize()
            if (ps === 'scroll') return undefined
            // Hybrid zoom scales the true width in px (real layout — keeps clientWidth honest).
            if (hybrid) return `${Math.round(basePaperPx * widthScale)}px`
            const landscape = getOrientation() === 'landscape'
            if (ps === 'letter') return landscape ? '279mm' : '216mm'
            return landscape ? '297mm' : '210mm' // a4
          })(),
          // box-shadow (not filter: drop-shadow) so the absolutely-positioned cycle card
          // rendered inside doesn't feed its pixels into the shadow — drop-shadow re-rasterises
          // the whole parchment on every reel frame.
          borderRadius: phone ? 0 : '8px',
          boxShadow: phone || gapped ? 'none' : '0 8px 32px rgba(80,50,10,0.22), 0 2px 6px rgba(80,50,10,0.18)',
        }}
      >
        {/* Paper body. The side padding is the text margin: a roomy fixed margin on DESKTOP (driven
            by device type, not the viewport breakpoint, so browser zoom never collapses it); a slim
            one on phones where screen real estate is tight. */}
        <div
          ref={sheetRef}
          className="scroll-paper relative pt-8 pb-24"
          style={{
            borderRadius: phone ? 0 : '8px',
            // Margins scale WITH the page (widthScale) so phase-1 page zoom is truly proportional —
            // otherwise fixed-px margins look huge when zoomed out and thin when zoomed in. The gapped
            // paginator derives the same scale from clientWidth/basePaperPx (see PaginationExtension),
            // so gapped breaks stay consistent. Phase 3 additionally narrows the sides (marginScale).
            paddingLeft:  phone ? '1.25rem' : `${sideMarginPx * (hybrid ? widthScale : 1) * marginScale}px`,
            paddingRight: phone ? '1.25rem' : `${sideMarginPx * (hybrid ? widthScale : 1) * marginScale}px`,
            paddingTop:   `${topMarginPx * (hybrid ? widthScale : 1)}px`,
            paddingBottom:`${btmMarginPx * (hybrid ? widthScale : 1)}px`,
            '--para-spacing': `${paraSpacingEm}em`,
          } as React.CSSProperties}
        >
          <PageGuides sheetRef={sheetRef} />
          <div
            className="mx-auto w-full relative"
            style={{
              zIndex: 1,
              columnCount: columns > 1 && !gapped ? columns : undefined,
              columnGap: columns > 1 && !gapped ? '2em' : undefined,
            }}
            ref={containerRef}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Page guides: a faint divider + centred page number at each A4-proportioned interval down the
// sheet. The page height is the sheet WIDTH × √2 (A4's 1:√2 ratio), measured in the same units the
// text uses — so zooming reflows naturally (pages grow/shrink, the SAME words stay on each page).
// Recomputed on any size change (typing, resize, zoom). Purely visual overlay (no content reflow).
function PageGuides({ sheetRef }: { sheetRef: RefObject<HTMLDivElement> }) {
  const [marks, setMarks] = useState<Array<{ y: number; n: number; rule: boolean }>>([])
  const gapped = gappedPagesEnabled()
  const [paperSize, setPaperSizeState] = useState(getPaperSize)
  const [orientation, setOrientationState] = useState(getOrientation)

  // Re-read paper size and orientation whenever page settings change
  useEffect(() => {
    const handler = () => { setPaperSizeState(getPaperSize()); setOrientationState(getOrientation()) }
    window.addEventListener('inkwave:page-settings-changed', handler)
    return () => window.removeEventListener('inkwave:page-settings-changed', handler)
  }, [])

  useEffect(() => {
    if (gapped || paperSize === 'scroll') { setMarks([]); return }
    const el = sheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const recompute = () => {
      const w = el.clientWidth
      const total = el.scrollHeight
      if (!w || !total) return setMarks([])
      // Portrait A4: h/w = √2. Portrait Letter: h/w = 11/8.5. Landscape inverts the ratio.
      const landscape = orientation === 'landscape'
      const pageH = w * (paperSize === 'letter'
        ? (landscape ? 8.5 / 11 : 11 / 8.5)
        : (landscape ? 1 / Math.SQRT2 : Math.SQRT2))
      // Page-zoom scale (parchment width vs its true 100% size; 1 when not hybrid-zoomed) so the dashed
      // rule offset scales with the page — matching the gapped paginator (see PaginationExtension).
      const basePaperPx = ((paperSize === 'letter' ? (landscape ? 279 : 216) : (landscape ? 297 : 210)) * 96) / 25.4
      const marginBottom = MARGIN_BOTTOM * (basePaperPx > 0 ? w / basePaperPx : 1)
      const count = Math.max(1, Math.ceil(total / pageH))
      const next: Array<{ y: number; n: number; rule: boolean }> = []
      for (let i = 1; i <= count; i++) {
        // Align with gapped-page-mode break: content ends at pageH - marginBottom, not pageH
        const bottom = i * pageH - marginBottom
        next.push({ y: Math.min(bottom, total - 2), n: i, rule: bottom < total })
      }
      setMarks(next)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    recompute()
    return () => ro.disconnect()
  }, [sheetRef, paperSize, orientation, gapped])

  const logoSize = 32

  return (
    <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 0 }} aria-hidden="true">
      {/* Logo at top-right of every page (n=1: top=0, n>1: top=bottom of prev page) */}
      {marks.map(({ n }) => {
        const pageTop = n === 1 ? 0 : (marks[n - 2]?.y ?? 0)
        return (
          <img
            key={`logo-${n}`}
            src="/inkwave-logo-v7.png"
            width={logoSize}
            height={logoSize}
            alt=""
            style={{ position: 'absolute', right: 47, top: pageTop + 12, width: logoSize, height: logoSize, opacity: 0.82 }}
          />
        )
      })}
      {/* Page 1 label — right of the logo, vertically aligned with it */}
      {marks.length > 0 && (
        <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: '1.1rem', fontWeight: 'bold', color: '#000000' }}>1</div>
      )}
      {marks.map(({ y, n, rule }) => (
        <div key={n} style={{ position: 'absolute', top: y, left: 0, right: 0 }}>
          {rule && <div style={{ borderTop: '1px dashed rgba(92,45,138,0.45)' }} />}
          <div className="font-serif" style={{ position: 'absolute', right: 24, top: rule ? 14 : -16, fontSize: '1.1rem', fontWeight: 'bold', color: '#000000' }}>
            {n + 1}
          </div>
        </div>
      ))}
    </div>
  )
}

// A static facsimile of the EMPTY ProseMirror surface — same classes as the live editor, so it
// paints identically. Used in the prerendered shell and while the document loads; the real
// editor mounts in its place client-side with no visual jump.
export function EmptyEditorSurface() {
  return (
    <div className="tiptap-editor ProseMirror" aria-hidden="true">
      <p>
        <br />
      </p>
    </div>
  )
}
