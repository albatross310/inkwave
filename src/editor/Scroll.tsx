import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
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
  revealed = true,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
  phone?: boolean // touch device: paper fills the screen, no background (see isTouchDevice())
  fill?: boolean  // the live editor: make the surface a fixed, full-region scroll container (desktop).
                  // Off for the snapshot view, where the surface must stay in-flow inside its split pane.
  revealed?: boolean // one-paint load: false hides the whole PARCHMENT (waves only) while fonts/
                     // pagination settle — visibility, not display, so layout + measurement still run.
                     // The editor flips it once; the loading shell passes false so page + text appear
                     // together, atomically, instead of paper-then-text.
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

  // In-app editor zoom: Ctrl/⌘+wheel (or pinch) over the editor scales the font (so text REFLOWS,
  // like a webpage) — isolated from the PDF panel because we preventDefault the browser zoom. Persisted.
  const [editorZoom, setEditorZoom] = useState(() => {
    try { return Number(localStorage.getItem('inkwave:editorZoom')) || 1 } catch { return 1 }
  })
  const editorZoomRef = useRef(editorZoom); editorZoomRef.current = editorZoom
  // Anchor the font zoom to the pointer, SYNCHRONOUSLY (no flicker): set the zoom var, force layout by
  // reading the anchored element's new position, then correct scrollTop in the SAME frame — all before
  // the browser paints. The anchor is the actual element under the cursor (exact — a fraction estimate
  // drifts badly further down the page since reflow doesn't grow uniformly). scrollLeft is held so it
  // never jumps to the left edge. React state is updated after, to the same value (no re-paint).
  useEffect(() => {
    const el = surfaceRef.current
    if (!el || phone) return // desktop surface-scroll only; phone is body-scroll + touch (no pointer)
    // FRAME COALESCING (the zoom-flicker fix): trackpads/pinch emit several wheel events per frame,
    // and each zoom step forces a FULL-document reflow (the font-size is calc'd from the zoom var).
    // 2–3 reflows per 16ms blows the frame budget on a long doc → visible stutter. So wheel events
    // only accumulate ±1 steps; ONE rAF applies the net step count — one reflow per painted frame,
    // and rAF runs before paint so the synchronous anchor logic below stays single-frame/flicker-free.
    // React state + localStorage persist are deferred to a settle timer: neither changes pixels
    // (the var is already on the DOM), and the per-tick setState re-rendered PageGuides for nothing.
    let steps = 0
    let raf = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    // One STABLE anchor element per gesture. Re-picking under the viewport centre every frame made
    // the anchor flip between elements at block boundaries, and the old correction pinned the picked
    // element's TOP to the centre line (scrollTop += topAfter - anchorY) — with multi-step coalesced
    // frames that per-frame snap compounded into a fast drift toward the doc top in BOTH directions.
    // Instead: keep the element picked at gesture start and correct by its ACTUAL displacement
    // (topAfter - topBefore), which holds the anchored text visually fixed for any zoom step size.
    let anchorEl: HTMLElement | null = null
    const applyFrame = () => {
      raf = 0
      const net = steps
      steps = 0
      if (!net) return
      // Pick (or re-pick, if the node was destroyed) a TEXT block near the VIEWPORT CENTRE. Reject:
      // the big containers (.ProseMirror / .scroll-paper — they span the whole doc, so their top
      // reflows toward the doc top and a correction against them lurches — the old "jump to top"
      // bug) and the PAGE-GAP widgets/sheet chrome (their heights are pinned px that do NOT reflow
      // with the font, so anchoring against one warps the correction — the "funky near page gaps"
      // bug). When the centre line falls inside a gap, probe outward until real text is found, so
      // the anchor is effectively the nearest text above/below the gap.
      const vr = el.getBoundingClientRect()
      const anchorX = vr.left + vr.width / 2, anchorY = vr.top + vr.height / 2
      const pickAt = (y: number): HTMLElement | null => {
        const t = document.elementFromPoint(anchorX, y) as HTMLElement | null
        if (!t || !el.contains(t)) return null
        if (t.classList.contains('ProseMirror') || t.classList.contains('scroll-paper')) return null
        if (t.closest('.ProseMirror') == null) return null // outside the text (sheet chrome, layer divs)
        if (t.closest('.inkwave-page-gap') || t.classList.contains('inkwave-page-gap-band')) return null
        return t
      }
      if (!anchorEl || !anchorEl.isConnected) {
        // Probe the centre first, then alternate above/below in growing steps — finds the nearest
        // text block when the midline sits in a page gap.
        anchorEl = pickAt(anchorY)
        for (const dy of [40, -40, 90, -90, 150, -150, 220, -220]) {
          if (anchorEl) break
          anchorEl = pickAt(anchorY + dy)
        }
      }
      const keepLeft = el.scrollLeft
      const denomBefore = Math.max(1, el.scrollHeight - el.clientHeight)
      const ratio = el.scrollTop / denomBefore
      const topBefore = anchorEl ? anchorEl.getBoundingClientRect().top : 0 // at the CURRENT size
      const factor = net > 0 ? Math.pow(1.08, net) : Math.pow(0.926, -net) // same per-step feel as before
      const next = Math.max(0.6, Math.min(2.5, +(editorZoomRef.current * factor).toFixed(3)))
      el.style.setProperty('--iw-editor-zoom', String(next)) // apply now → text reflows
      if (anchorEl && anchorEl.isConnected) {
        const topAfter = anchorEl.getBoundingClientRect().top // forces synchronous layout at the new size
        el.scrollTop = Math.max(0, el.scrollTop + (topAfter - topBefore)) // hold the anchored text still
        el.scrollLeft = keepLeft
      } else {
        el.scrollTop = ratio * Math.max(1, el.scrollHeight - el.clientHeight) // no anchor → keep relative position
        el.scrollLeft = keepLeft
      }
      editorZoomRef.current = next
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        setEditorZoom(editorZoomRef.current) // same var value → no visual change, just React catch-up
        try { localStorage.setItem('inkwave:editorZoom', String(editorZoomRef.current)) } catch { /* private mode */ }
        // ZOOM-SETTLE RE-MEASURE: page breaks stay pinned DURING the gesture (re-measuring live made
        // the text lurch), but the gaps + sheet panels were measured at the OLD font size and sit
        // misaligned with the reflowed text. One clean re-measure now — and we re-anchor the viewport
        // around it (same held-anchor logic) so the adjustment doesn't move the text you're reading.
        const held = anchorEl && anchorEl.isConnected ? anchorEl : null
        anchorEl = null // gesture over → next gesture picks a fresh anchor under the centre
        const topBeforeMeasure = held ? held.getBoundingClientRect().top : 0
        const onMeasured = () => {
          window.removeEventListener('inkwave:pagination-measured', onMeasured)
          requestAnimationFrame(() => {
            if (held && held.isConnected) {
              const topAfterMeasure = held.getBoundingClientRect().top
              el.scrollTop = Math.max(0, el.scrollTop + (topAfterMeasure - topBeforeMeasure))
            }
          })
        }
        window.addEventListener('inkwave:pagination-measured', onMeasured)
        window.dispatchEvent(new Event('inkwave:zoom-settled'))
        // Non-gapped mode: no pagination plugin listening → drop the one-shot listener shortly.
        setTimeout(() => window.removeEventListener('inkwave:pagination-measured', onMeasured), 1000)
      }, 200)
    }
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (e.deltaY === 0) return
      steps += e.deltaY < 0 ? 1 : -1
      if (!raf) raf = requestAnimationFrame(applyFrame)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
      if (settle) clearTimeout(settle)
    }
  }, [phone])
  const sideMarginPx  = getSideMarginPx()
  const topMarginPx   = getTopMarginPx()
  const btmMarginPx   = getBtmMarginPx()
  const paraSpacingEm = getParaSpacingEm()
  const columns       = getColumns()
  // Waves sway horizontally as you scroll up/down (the "nice motion"), but must NOT jump when you ZOOM
  // (zoom re-anchors scrollTop, which would lurch the waves). So skip the frame where the editor-zoom
  // level changed and only sway on genuine scrolling.
  const waveBaseRef = useRef(0) // loading-drift offset — scroll sway ADDS to it, so no snap at reveal
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const target: HTMLElement | Window = phone ? window : el
    let raf = 0
    let lastZoom = el.style.getPropertyValue('--iw-editor-zoom')
    const apply = () => {
      raf = 0
      const z = el.style.getPropertyValue('--iw-editor-zoom')
      if (z !== lastZoom) { lastZoom = z; return } // a zoom caused this scroll change → don't move waves
      const y = phone ? window.scrollY : el.scrollTop
      el.style.setProperty('--wave-x', `${(waveBaseRef.current + y * 0.06).toFixed(1)}px`) // 2/3 of the old 0.09 sway speed
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    apply()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [phone])

  // While the parchment is hidden (loading), sway the waves as if scrolling down at a steady linear
  // rate — the page feels alive instead of frozen. At reveal the sway doesn't stop dead: velocity
  // decays exponentially (~1s to visually still), like a scroll coasting to rest. The drift
  // accumulates into waveBaseRef, which the scroll handler above ADDS to — no jump at handover.
  const revealedRef = useRef(revealed); revealedRef.current = revealed
  const startedHiddenRef = useRef(!revealed) // instances that mount revealed (SnapshotView) never drift
  useEffect(() => {
    if (!startedHiddenRef.current) return
    const el = surfaceRef.current
    if (!el) return
    let raf = 0
    let last = performance.now()
    let v = 36 // px/s in wave space ≙ scrolling ~600px/s (600 × the 0.06 sway factor)
    const TAU = 0.28 // s — exp decay constant; ~1s from reveal to visually still
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1) // clamp tab-suspend gaps
      last = now
      if (revealedRef.current) v *= Math.exp(-dt / TAU)
      if (v < 0.2) { raf = 0; return } // at rest — the scroll handler owns the waves from here
      waveBaseRef.current += dt * v
      el.style.setProperty('--wave-x', `${waveBaseRef.current.toFixed(1)}px`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [])

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
            const landscape = getOrientation() === 'landscape'
            if (ps === 'letter') return landscape ? '279mm' : '216mm'
            return landscape ? '297mm' : '210mm' // a4
          })(),
          // box-shadow (not filter: drop-shadow) so the absolutely-positioned cycle card
          // rendered inside doesn't feed its pixels into the shadow — drop-shadow re-rasterises
          // the whole parchment on every reel frame.
          borderRadius: phone ? 0 : '8px',
          boxShadow: phone || gapped ? 'none' : '0 8px 32px rgba(80,50,10,0.22), 0 2px 6px rgba(80,50,10,0.18)',
          // One-paint load: hide the entire parchment (waves only) until the editor settles, then
          // fade page + text in together. visibility (not display) keeps layout + font/pagination
          // measurement running underneath.
          visibility: revealed ? 'visible' : 'hidden',
          opacity: revealed ? 1 : 0,
          transition: 'opacity 180ms ease',
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
            paddingLeft:  phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingRight: phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingTop:   `${topMarginPx}px`,
            paddingBottom:`${btmMarginPx}px`,
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

  // Pre-decode both logo variants once, so a new page appearing during zoom-out paints its logo in
  // the same frame instead of popping in a beat late (image decode is async even from cache).
  useEffect(() => {
    for (const src of ['/inkwave-logo-v7.png', '/inkwave-logo-night.svg']) {
      const img = new Image()
      img.src = src
      void img.decode?.().catch(() => { /* decode hint only */ })
    }
  }, [])

  const lastSigRef = useRef('')
  // useLayoutEffect (not useEffect): compute the first set of marks BEFORE the browser paints the
  // newly-mounted editor, so page guides + logos appear in the SAME frame as the text instead of
  // popping in a beat later (one visible stage of the staged-load "shakiness").
  useLayoutEffect(() => {
    if (gapped || paperSize === 'scroll') { setMarks([]); lastSigRef.current = ''; return }
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
      const count = Math.max(1, Math.ceil(total / pageH))
      // Bail before setState when nothing changed — the ResizeObserver fires on every font-zoom tick
      // and re-rendering ~2 imgs + a div per page for identical marks is pure churn on long docs.
      const sig = `${count}:${pageH.toFixed(2)}:${total}`
      if (sig === lastSigRef.current) return
      lastSigRef.current = sig
      const next: Array<{ y: number; n: number; rule: boolean }> = []
      for (let i = 1; i <= count; i++) {
        // Align with gapped-page-mode break: content ends at pageH - MARGIN_BOTTOM, not pageH
        const bottom = i * pageH - MARGIN_BOTTOM
        next.push({ y: Math.min(bottom, total - 2), n: i, rule: bottom < total })
      }
      setMarks(next)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    recompute()
    return () => ro.disconnect()
  }, [sheetRef, paperSize, orientation, gapped])

  const logoSize = gapped ? 76 : 32           // bigger mark in the discrete-sheet (gapped) view
  const pageNumSize = gapped ? '2.6rem' : '1.1rem'

  return (
    <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 0 }} aria-hidden="true">
      {/* Logo at top-right of every page (n=1: top=0, n>1: top=bottom of prev page) */}
      {marks.map(({ n }) => {
        const pageTop = n === 1 ? 0 : (marks[n - 2]?.y ?? 0)
        const logoStyle = { position: 'absolute' as const, right: 47, top: pageTop + 12, width: logoSize, height: logoSize, opacity: 0.82 }
        // Two variants toggled by CSS: the day PNG and a night SVG with a light ring (so the mark's dark
        // bottom reads on the black night surface). See index.css .iw-day-logo / .iw-night-logo.
        return (
          <span key={`logo-${n}`}>
            <img className="iw-day-logo" src="/inkwave-logo-v7.png" width={logoSize} height={logoSize} alt="" style={logoStyle} />
            <img className="iw-night-logo" src="/inkwave-logo-night.svg" width={logoSize} height={logoSize} alt="" style={logoStyle} />
          </span>
        )
      })}
      {/* Page 1 label — right of the logo, vertically aligned with it */}
      {marks.length > 0 && (
        <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>1</div>
      )}
      {marks.map(({ y, n, rule }) => (
        <div key={n} style={{ position: 'absolute', top: y, left: 0, right: 0 }}>
          {rule && <div style={{ borderTop: '1px dashed rgba(92,45,138,0.45)' }} />}
          <div className="font-serif" style={{ position: 'absolute', right: 24, top: rule ? 14 : -16, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>
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
