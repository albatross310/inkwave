import React from 'react'
import { CYCLE_SIZE, DELETE_SENTINEL, CARD_PAD_X } from './popoverConstants'
import { measureTextWidth } from '../textMetrics'

// Renders ⌫ in system-ui (IM Fell DW Pica doesn't have this glyph), otherwise returns s.
export function displayFor(s: string, mobileScale = 1): React.ReactNode {
  if (s !== DELETE_SENTINEL) return s
  const fontSize = mobileScale > 1 ? `${mobileScale}em` : '0.82em'
  const style: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', fontSize }
  if (mobileScale > 1) style.lineHeight = '1'
  return <span style={style}>⌫</span>
}

// Fills CYCLE_SIZE-1 synonym slots + DELETE_SENTINEL, cycling through candidates if short.
// Returns the slot array and the card min-width (widest synonym + horizontal padding).
export function buildSynonyms(
  displayWord: string, candidates: string[], font: string, wordWidth: number,
): { synonyms: string[]; minWidth: number } {
  const pool     = [displayWord, ...candidates]
  const synonyms = [
    ...Array.from({ length: CYCLE_SIZE - 1 }, (_, i) => pool[i % pool.length]),
    DELETE_SENTINEL,
  ]
  const minWidth = Math.max(
    wordWidth,
    ...synonyms.filter(s => s !== DELETE_SENTINEL).map(s => measureTextWidth(s, font)),
  ) + CARD_PAD_X * 2
  return { synonyms, minWidth }
}
