// Page layout preferences — stored as raw numbers so components can display/edit them directly.

const KEYS = {
  sideMargin:  'inkwave:sideMargin',
  topMargin:   'inkwave:topMargin',
  btmMargin:   'inkwave:btmMargin',
  paraSpacing: 'inkwave:paraSpacing',
  columns:     'inkwave:columns',
  paperSize:   'inkwave:paperSize',
}

function num(key: string, def: number): number {
  try { const v = parseFloat(localStorage.getItem(key) ?? ''); return isNaN(v) ? def : v } catch { return def }
}
function store(key: string, v: number | string): void {
  try { localStorage.setItem(key, String(v)) } catch { /* private mode */ }
}

// 1 inch = 96px (96 DPI reference) = 2.54 cm. Default margins mirror Word "Normal" (1 inch all sides).
const INCH = 96

// Side margins (px) — desktop only; phone is always edge-to-edge
export function getSideMarginPx(): number { return num(KEYS.sideMargin, INCH) }
export function setSideMarginPx(v: number): void { store(KEYS.sideMargin, v) }

// Top margin (px)
export function getTopMarginPx(): number { return num(KEYS.topMargin, INCH) }
export function setTopMarginPx(v: number): void { store(KEYS.topMargin, v) }

// Bottom margin (px)
export function getBtmMarginPx(): number { return num(KEYS.btmMargin, INCH) }
export function setBtmMarginPx(v: number): void { store(KEYS.btmMargin, v) }

// Paragraph spacing (em) — extra bottom margin on each paragraph
export function getParaSpacingEm(): number { return num(KEYS.paraSpacing, 0.5) }
export function setParaSpacingEm(v: number): void { store(KEYS.paraSpacing, v) }

// Columns (1 | 2 | 3)
export function getColumns(): number { return Math.max(1, Math.min(3, Math.round(num(KEYS.columns, 1)))) }
export function setColumns(v: number): void { store(KEYS.columns, v) }

// Paper size — controls the page-guide aspect ratio
export type PaperSize = 'a4' | 'letter' | 'scroll'
export function getPaperSize(): PaperSize {
  try { return (localStorage.getItem(KEYS.paperSize) as PaperSize) || 'a4' } catch { return 'a4' }
}
export function setPaperSize(v: PaperSize): void { store(KEYS.paperSize, v) }

// Page orientation — portrait or landscape
export type Orientation = 'portrait' | 'landscape'
export function getOrientation(): Orientation {
  try { return (localStorage.getItem('inkwave:orientation') as Orientation) || 'portrait' } catch { return 'portrait' }
}
export function setOrientation(v: Orientation): void {
  try { localStorage.setItem('inkwave:orientation', v) } catch { /* private mode */ }
}
