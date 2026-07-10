// The page-gap widget + its geometry constants — ONE builder shared by the live editor's
// pagination (PaginationExtension renders it as a ProseMirror decoration) and the snapshot
// view's static paginator (staticPagination.ts inserts it into plain DOM). Lives in its own
// lean module (no Tiptap/ProseMirror imports) so the snapshot route chunk can build identical
// gap DOM without dragging the editor graph in — same reasoning as MARGIN_BOTTOM living in
// pageSettings (shell-chunk weight).

export const GAP = 56 // px of aqua (waves) between sheets

// Phone pages are content-tall with COMPACT fixed margins: break POSITIONS are canonical (same
// text per page as A4/print), but fill-to-page-bottom margins are canonical-space values that
// don't match the phone's taller reflowed text — they rendered as huge dead bands (2026-07-09).
export const PHONE_PAGE_MARGIN = 32

export const phoneLike = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches

// The gap widget reserves the vertical space between the last line of one page and the first line of
// the next: [ bottom margin of page above | GAP (transparent) | top margin of page below ]. It hosts
// an (empty) band marker at the gap offset so the paint() pass can measure exactly where the
// transparent gap is and lay the parchment sheet panels around it. No visible parts of its own —
// the panels paint the parchment, the page number is a footer inside each panel.
export function gapEl(botMargin: number, topMargin: number, gapped: boolean): HTMLElement {
  // SPAN, not div: a page break can land mid-paragraph, and a block-level <div> is invalid as a
  // child of <p> — the browser then reparents/splits the paragraph in the rendered DOM, scrambling
  // caret placement (the caret jumps across the gap, edits land on the wrong page). A <span> is valid
  // phrasing content inside <p>; CSS gives it `display:block` so it still reserves the vertical gap.
  const el = document.createElement('span')
  el.className = 'inkwave-page-gap'
  // @media print turns every widget into the NEXT page's top margin (break-before: page +
  // height: var(--iw-print-topm)) — carry the live setting so the printed margin matches the
  // screen (it was hard-coded 72px, wrong whenever the top-margin setting differs).
  el.style.setProperty('--iw-print-topm', `${Math.round(topMargin)}px`)
  el.contentEditable = 'false'
  if (!gapped) {
    // Ungapped: an invisible zero-HEIGHT break marker (see .iw-break-marker in index.css). Still a
    // block, so the break it forces coincides with the line start it sits at (a visual no-op at
    // steady state) and its rect top IS the page boundary — PageGuides draws the dashed rule
    // there, and the print stylesheet breaks the page there. No vertical space is reserved.
    el.classList.add('iw-break-marker')
    return el
  }
  el.style.height = `${Math.round(botMargin + GAP + topMargin)}px`
  const band = document.createElement('span')
  band.className = 'inkwave-page-gap-band'
  band.style.top = `${Math.round(botMargin)}px`
  band.style.height = `${GAP}px`
  el.appendChild(band)
  return el
}
