// Keeps a <style id="iw-print-page"> tag in <head> in sync with the CURRENT paper settings, so the
// browser's print / "Save as PDF" uses the same physical page the on-screen model (pageModel)
// paginates against. index.css's @media print block carries the A4-portrait defaults; this tag
// overrides the @page size + body width for letter/landscape. exportPdf's collectCss() inlines
// every <style> tag's text, so the export tab inherits the override automatically — and a plain
// Ctrl+P / the footer "print" action on the live page picks it up too.

import { getPaperSize, getOrientation, getSideMarginPx, getTopMarginPx, MARGIN_BOTTOM } from './pageSettings'
import { paperCssSize } from './pageModel'

const STYLE_ID = 'iw-print-page'

export function syncPrintPageStyle(): void {
  if (typeof document === 'undefined') return
  const paper = getPaperSize()
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (paper === 'scroll') { el?.remove(); return } // continuous scroll: print on the A4 defaults
  const { width, height } = paperCssSize(paper, getOrientation())
  // Phone parity: breaks are measured in the canonical context with the DESKTOP side margins
  // (canonicalMeasure.ts), but the phone renders a slim inline 1.25rem padding on .scroll-paper —
  // !important here restores the canonical wrapping when printing from a phone.
  const side = getSideMarginPx()
  const css =
    `@media print{` +
    `html,body,.inkwave-editor-surface{width:${width} !important;}` +
    `@page{size:${width} ${height};margin:0 0 ${MARGIN_BOTTOM - 8}px 0;}` +
    // Refs pages (named page — see index.css): REAL top/bottom margins from the live settings, so
    // browser-natural breaks inside the reference list respect the same margins as everywhere.
    `@page iw-refs{margin-top:${getTopMarginPx()}px;margin-bottom:${MARGIN_BOTTOM - 8}px;}` +
    `.inkwave-editor-surface.is-phone .scroll-paper{padding-left:${side}px !important;padding-right:${side}px !important;}` +
    `}`
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}
