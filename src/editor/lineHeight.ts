// Document line-height preference. Stored as a raw number string so CSS can use it directly.
const KEY = 'inkwave:lineHeight'

export const LINE_HEIGHTS = [
  { label: '1.2', value: 1.2 },
  { label: 'φ', value: 1.618 },   // golden ratio
  { label: '2', value: 2 },
  { label: 'e', value: 2.718 },   // natural log base
]

const DEFAULT = LINE_HEIGHTS[1].value  // φ as default

export function getLineHeight(): number {
  try { return parseFloat(localStorage.getItem(KEY) ?? '') || DEFAULT } catch { return DEFAULT }
}

export function setLineHeight(v: number): void {
  try { localStorage.setItem(KEY, String(v)) } catch { /* private mode */ }
}
