import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx, paperCssSize } from './pageModel'
import { syncPrintPageStyle } from './printPageStyle'

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
    const onChanged = () => { syncPrintPageStyle(); rerender(n => n + 1) }
    syncPrintPageStyle() // keep the print @page size in sync with the paper settings (see printPageStyle)
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
      el.style.setProperty('--wave-x', `${(y * 0.06).toFixed(1)}px`) // 2/3 of the old 0.09 sway speed
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    apply()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [phone])

  // Loading wave drift — CSS/compositor does the moving (`.iw-wave-anim`, in the prerendered HTML,
  // so it starts at FIRST PAINT and never stutters however busy the main thread is). JS only manages
  // the phases: sync the live surface to the shell's animation phase at mount, and at reveal freeze
  // the current offset then ease it to the nearest 140px tile boundary (pattern-identity) over ~1s —
  // an exponential coast to rest with a zero-jump handoff back to the scroll sway.
  const startedHiddenRef = useRef(!revealed) // instances that mount revealed (SnapshotView) never drift
  const [waveMode, setWaveMode] = useState<'anim' | 'coast' | 'off'>(startedHiddenRef.current ? 'anim' : 'off')
  useEffect(() => {
    // Pick up mid-loop where the (unmounted) shell's animation was: negative delay = elapsed % loop.
    const el = surfaceRef.current
    if (!el || !startedHiddenRef.current) return
    // The drift loop starts after the 0.5s S-ramp; sync both to where the shell's animation is now.
    const elapsed = performance.now() / 1000
    if (elapsed < 0.5) {
      el.style.setProperty('--wave-ramp-delay', `-${elapsed.toFixed(3)}s`)
      el.style.setProperty('--wave-phase', `${(0.5 - elapsed).toFixed(3)}s`)
    } else {
      el.style.setProperty('--wave-ramp-delay', '-1s') // ramp long done — fill holds it at -9px
      el.style.setProperty('--wave-phase', `-${(((elapsed - 0.5) % 1.944)).toFixed(3)}s`)
    }
  }, [])
  // Two effects, deliberately: the freeze (read the animated transform, switch class) must not share
  // an effect with the decay loop — setWaveMode('coast') inside a [waveMode]-dep effect re-ran the
  // effect and its CLEANUP cancelled the just-started rAF, leaving .iw-wave-coast stuck forever
  // (frozen waves + background-position pinned at 0 → the scroll sway looked "broken").
  useLayoutEffect(() => {
    if (!revealed || waveMode !== 'anim') return
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    // Freeze the compositor animation's current offset BEFORE the class swap paints.
    let tx = 0
    try {
      const m = getComputedStyle(el, '::before').transform
      if (m && m !== 'none') tx = new DOMMatrixReadOnly(m).m41
    } catch { /* transform unreadable → coast from 0 */ }
    el.style.setProperty('--wave-t', `${tx.toFixed(2)}px`)
    setWaveMode('coast')
  }, [revealed, waveMode])
  useEffect(() => {
    if (waveMode !== 'coast') return
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    let raf = 0
    let last = performance.now()
    let tx = parseFloat(el.style.getPropertyValue('--wave-t')) || 0
    let v = -72 // px/s leftward — the speed the CSS drift was running at
    const TAU = 0.28 // s — exponential decay; visually still in ~1s
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      v *= Math.exp(-dt / TAU)
      tx += v * dt
      if (Math.abs(v) < 3) {
        // Nearly at rest: glide to the nearest tile boundary, where transform ≡ none.
        const target = Math.round(tx / 140) * 140
        tx += (target - tx) * Math.min(1, dt * 8)
        if (Math.abs(target - tx) < 0.4) {
          el.style.removeProperty('--wave-t')
          setWaveMode('off')
          raf = 0
          return
        }
      }
      el.style.setProperty('--wave-t', `${tx.toFixed(2)}px`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [waveMode])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}${waveMode === 'anim' ? ' iw-wave-anim' : waveMode === 'coast' ? ' iw-wave-coast' : ''}`}
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
            // The SAME physical mm the break model (pageModel) and the print @page size use —
            // one source of truth, so screen wrapping = print wrapping.
            return paperCssSize(ps, getOrientation()).width
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
          <PageGuides sheetRef={sheetRef} phone={phone} />
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

// Page guides (ungapped mode): a faint dashed rule + page number at each page BREAK. The break
// positions come from the pagination extension's zero-size break markers (.inkwave-page-gap
// .iw-break-marker) — the SAME line-measured breaks gapped mode uses, derived from the canonical
// physical page height in pageModel — so toggling the gapped switch never moves content across
// pages, and the on-screen breaks are the print/PDF breaks. Falls back to the uniform canonical
// model (topMargin + n×textArea) where no markers exist (loading shell, SnapshotView, multi-column).
// Purely visual overlay (no content reflow).
function PageGuides({ sheetRef, phone = false }: { sheetRef: RefObject<HTMLDivElement>; phone?: boolean }) {
  const [breaks, setBreaks] = useState<number[]>([]) // sheet-local y of each page boundary
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
    if (gapped || paperSize === 'scroll') { setBreaks([]); lastSigRef.current = ''; return }
    const el = sheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const recompute = () => {
      const total = el.scrollHeight
      if (!total) { lastSigRef.current = ''; return setBreaks([]) }
      // Prefer the REAL break markers the pagination extension measured — same breaks as gapped
      // mode. gBCR returns VISUAL (transform-scaled) coords; the overlay lives INSIDE the scaled
      // paper, so divide by the magnify scale to get paper-local px (scale=1 on master).
      const surface = el.closest('.inkwave-editor-surface') as HTMLElement | null
      const scale = parseFloat(surface?.style.getPropertyValue('--iw-magnify') || '') || 1
      const markers = Array.from(el.querySelectorAll('.inkwave-page-gap')) as HTMLElement[]
      let next: number[]
      if (markers.length) {
        const sheetTop = el.getBoundingClientRect().top
        next = markers
          .map((m) => (m.getBoundingClientRect().top - sheetTop) / scale)
          .sort((a, b) => a - b)
      } else {
        // No markers yet (loading shell / SnapshotView / multi-column): uniform canonical model —
        // each page holds one text area, exactly where the measured breaks would land if every
        // page filled perfectly. Fluid width on phone (no fixed mm parchment there).
        const { textAreaPx } = pageBoxPx({
          paperSize, orientation,
          topMarginPx: getTopMarginPx(), bottomMarginPx: MARGIN_BOTTOM,
          fluidWidthPx: phone ? el.clientWidth : undefined,
        })
        next = []
        for (let y = getTopMarginPx() + textAreaPx; y < total - 4 && next.length < 500; y += textAreaPx) next.push(y)
      }
      // Bail before setState when nothing changed — the ResizeObserver fires on every font-zoom tick
      // and re-rendering ~2 imgs + a div per page for identical marks is pure churn on long docs.
      const sig = next.map((y) => Math.round(y)).join(',')
      if (sig === lastSigRef.current) return
      lastSigRef.current = sig
      setBreaks(next)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    // Marker positions settle/move on every pagination measure (typing is debounced 150ms there);
    // the sheet height usually changes too (RO catches it), but not always — listen directly.
    window.addEventListener('inkwave:pagination-measured', recompute)
    recompute()
    return () => { ro.disconnect(); window.removeEventListener('inkwave:pagination-measured', recompute) }
  }, [sheetRef, paperSize, orientation, gapped, phone])

  const logoSize = gapped ? 76 : 32           // bigger mark in the discrete-sheet (gapped) view
  const pageNumSize = gapped ? '2.6rem' : '1.1rem'
  const active = !gapped && paperSize !== 'scroll' // gapped paints its own sheets; scroll has no pages

  return (
    <div className="iw-page-guides absolute inset-0 pointer-events-none select-none" style={{ zIndex: 0 }} aria-hidden="true">
      {/* Logo at top-right of every page (page 1: top=0, page n: top=break n−1) */}
      {active && Array.from({ length: breaks.length + 1 }, (_, i) => {
        const n = i + 1
        const pageTop = i === 0 ? 0 : breaks[i - 1]
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
      {active && (
        <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>1</div>
      )}
      {/* A dashed rule at every measured break, page n+1's number just below it */}
      {active && breaks.map((y, i) => (
        <div key={`break-${i}`} style={{ position: 'absolute', top: y, left: 0, right: 0 }}>
          <div style={{ borderTop: '1px dashed rgba(92,45,138,0.45)' }} />
          <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>
            {i + 2}
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
