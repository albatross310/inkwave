// Keeps a <style id="iw-print-page"> tag in <head> in sync with the CURRENT paper settings, so the
// browser's print / "Save as PDF" uses the same physical page the on-screen model (pageModel)
// paginates against. index.css's @media print block carries the A4-portrait defaults; this tag
// overrides the @page size + body width for letter/landscape. exportPdf's collectCss() inlines
// every <style> tag's text, so the export tab inherits the override automatically — and a plain
// Ctrl+P / the footer "print" action on the live page picks it up too.
//
// PAGE CHROME (Peter, 2026-07-10): every printed page (incl. page 1 and browser-broken reference
// pages) carries the editor footer's chrome — the 22px logo with the page number NEXT to it,
// bottom-centre — via the @page @bottom-center margin box: `content: url(<logo>) counter(page)`.
// Margin boxes render images at INTRINSIC size and can't style them, so the logo ships as an SVG
// data-URI whose width/height attributes ARE its intrinsic 22px size (the raster inside is drawn
// at 3× for print DPI). Built once at runtime from /inkwave-logo-v7.png — no bytes in the bundle.

import { getPaperSize, getOrientation, getSideMarginPx, getTopMarginPx, MARGIN_BOTTOM } from './pageSettings'
import { paperCssSize } from './pageModel'

const STYLE_ID = 'iw-print-page'
const LOGO_PX = 22    // display size — matches the editor footer's .inkwave-sheet-num img
const LOGO_RASTER = 66 // 3× raster inside the SVG → still crisp at ~300dpi print

let logoUri: string | null = null
let logoStarted = false
function ensurePrintLogo(): void {
  if (logoStarted || typeof document === 'undefined') return
  logoStarted = true
  const img = new Image()
  img.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = LOGO_RASTER; c.height = LOGO_RASTER
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, LOGO_RASTER, LOGO_RASTER)
      const png = c.toDataURL('image/png')
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_PX}" height="${LOGO_PX}">` +
        `<image href="${png}" width="${LOGO_PX}" height="${LOGO_PX}"/></svg>`
      logoUri = `data:image/svg+xml;base64,${btoa(svg)}`
      syncPrintPageStyle() // re-emit the tag with the logo in the margin box
    } catch { /* canvas unavailable → the static number-only fallback in index.css stands */ }
  }
  img.src = '/inkwave-logo-v7.png'
}

export function syncPrintPageStyle(): void {
  if (typeof document === 'undefined') return
  ensurePrintLogo()
  const paper = getPaperSize()
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (paper === 'scroll') { el?.remove(); return } // continuous scroll: print on the A4 defaults
  const { width, height } = paperCssSize(paper, getOrientation())
  // Phone parity: breaks are measured in the canonical context with the DESKTOP side margins
  // (canonicalMeasure.ts), but the phone renders a slim inline 1.25rem padding on .scroll-paper —
  // !important here restores the canonical wrapping when printing from a phone.
  const side = getSideMarginPx()
  // The chrome box: logo + a space + the page counter, styled like the editor footer
  // (.inkwave-sheet-num — EB Garamond 0.9rem #41425b beside the 22px mark). Falls back to the
  // static number-only box in index.css until the logo data-URI is ready.
  const chrome = logoUri
    ? `@bottom-center{content:url("${logoUri}") " " counter(page);` +
      `font-family:'EB Garamond',Georgia,serif;font-size:0.9rem;color:#41425b;margin-bottom:16px;}`
    : ''
  const css =
    `@media print{` +
    `html,body,.inkwave-editor-surface{width:${width} !important;}` +
    // margin-bottom (MARGIN_BOTTOM − 8) hosts the chrome box and stays INSIDE the bottom margin the
    // canonical breaks reserve, so our forced breaks always land before any natural overflow.
    `@page{size:${width} ${height};margin:0 0 ${MARGIN_BOTTOM - 8}px 0;${chrome}}` +
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
