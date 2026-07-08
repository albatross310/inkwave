// Keeps a <style id="iw-print-page"> tag in <head> in sync with the CURRENT paper settings, so the
// browser's print / "Save as PDF" uses the same physical page the on-screen model (pageModel)
// paginates against. index.css's @media print block carries the A4-portrait defaults; this tag
// overrides the @page size + body width for letter/landscape. exportPdf's collectCss() inlines
// every <style> tag's text, so the export tab inherits the override automatically — and a plain
// Ctrl+P / the footer "print" action on the live page picks it up too.

import { getPaperSize, getOrientation } from './pageSettings'
import { paperCssSize } from './pageModel'

const STYLE_ID = 'iw-print-page'

export function syncPrintPageStyle(): void {
  if (typeof document === 'undefined') return
  const paper = getPaperSize()
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (paper === 'scroll') { el?.remove(); return } // continuous scroll: print on the A4 defaults
  const { width, height } = paperCssSize(paper, getOrientation())
  const css =
    `@media print{` +
    `html,body,.inkwave-editor-surface{width:${width} !important;}` +
    `@page{size:${width} ${height};margin:0;}` +
    `}`
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}
