// Page layout preferences: column width, horizontal margins, paragraph spacing, paper size.

const KEYS = {
  colWidth:    'inkwave:colWidth',
  pageMargin:  'inkwave:pageMargin',
  paraSpacing: 'inkwave:paraSpacing',
  paperSize:   'inkwave:paperSize',
}

// ─── Column width ─────────────────────────────────────────────────────────────
export type ColWidth = 'narrow' | 'normal' | 'wide'
export const COL_WIDTHS: { label: string; value: ColWidth; px: number }[] = [
  { label: 'Narrow', value: 'narrow', px: 520 },
  { label: 'Normal', value: 'normal', px: 720 },
  { label: 'Wide',   value: 'wide',   px: 920 },
]
export function getColWidth(): ColWidth {
  try { return (localStorage.getItem(KEYS.colWidth) as ColWidth) || 'normal' } catch { return 'normal' }
}
export function setColWidth(v: ColWidth) {
  try { localStorage.setItem(KEYS.colWidth, v) } catch { /* private mode */ }
}

// ─── Page margins ─────────────────────────────────────────────────────────────
export type PageMargin = 'compact' | 'normal' | 'generous'
export const PAGE_MARGINS: { label: string; value: PageMargin; px: number }[] = [
  { label: 'Compact',   value: 'compact',   px: 24 },
  { label: 'Normal',    value: 'normal',    px: 64 },
  { label: 'Generous',  value: 'generous',  px: 96 },
]
export function getPageMargin(): PageMargin {
  try { return (localStorage.getItem(KEYS.pageMargin) as PageMargin) || 'normal' } catch { return 'normal' }
}
export function setPageMargin(v: PageMargin) {
  try { localStorage.setItem(KEYS.pageMargin, v) } catch { /* private mode */ }
}

// ─── Paragraph spacing (extra bottom margin on paragraphs) ────────────────────
export type ParaSpacing = 'tight' | 'normal' | 'relaxed'
export const PARA_SPACINGS: { label: string; value: ParaSpacing; em: number }[] = [
  { label: 'Tight',   value: 'tight',   em: 0 },
  { label: 'Normal',  value: 'normal',  em: 0.5 },
  { label: 'Relaxed', value: 'relaxed', em: 1.2 },
]
export function getParaSpacing(): ParaSpacing {
  try { return (localStorage.getItem(KEYS.paraSpacing) as ParaSpacing) || 'normal' } catch { return 'normal' }
}
export function setParaSpacing(v: ParaSpacing) {
  try { localStorage.setItem(KEYS.paraSpacing, v) } catch { /* private mode */ }
}

// ─── Paper size (affects page-guide aspect ratio) ────────────────────────────
export type PaperSize = 'a4' | 'letter' | 'scroll'
export const PAPER_SIZES: { label: string; value: PaperSize }[] = [
  { label: 'A4',     value: 'a4' },
  { label: 'Letter', value: 'letter' },
  { label: 'Scroll', value: 'scroll' },
]
export function getPaperSize(): PaperSize {
  try { return (localStorage.getItem(KEYS.paperSize) as PaperSize) || 'a4' } catch { return 'a4' }
}
export function setPaperSize(v: PaperSize) {
  try { localStorage.setItem(KEYS.paperSize, v) } catch { /* private mode */ }
}
