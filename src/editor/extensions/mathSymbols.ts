// Custom math symbol definitions: user-defined shorthand keys → LaTeX strings.
// Stored in localStorage; applied before KaTeX rendering so "pi" → \pi etc.

export interface MathSymbol { key: string; latex: string }

const STORAGE_KEY = 'inkwave_math_symbols'

export const PRESETS: MathSymbol[] = [
  { key: 'inf',   latex: '\\infty' },
  { key: 'deg',   latex: '\\degree' },
  { key: 'pm',    latex: '\\pm' },
  { key: 'ne',    latex: '\\neq' },
  { key: 'le',    latex: '\\leq' },
  { key: 'ge',    latex: '\\geq' },
  { key: 'approx',latex: '\\approx' },
  { key: 'sum',   latex: '\\sum' },
  { key: 'prod',  latex: '\\prod' },
  { key: 'int',   latex: '\\int' },
]

export function getSymbols(): MathSymbol[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

export function setSymbol(key: string, latex: string): void {
  const syms = getSymbols().filter(s => s.key !== key)
  syms.unshift({ key, latex })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(syms))
  window.dispatchEvent(new CustomEvent('inkwave-symbols-changed'))
}

export function deleteSymbol(key: string): void {
  const syms = getSymbols().filter(s => s.key !== key)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(syms))
  window.dispatchEvent(new CustomEvent('inkwave-symbols-changed'))
}

// Apply custom symbol substitutions to a LaTeX string.
// Keys are replaced only when they appear as standalone tokens (not inside \commands).
export function applyCustomSymbols(latex: string, symbols: MathSymbol[]): string {
  let result = latex
  for (const { key, latex: replacement } of symbols) {
    // Don't replace if preceded by \ or an alphanumeric (part of a command/word).
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re  = new RegExp(`(?<![\\\\a-zA-Z0-9])${esc}(?![a-zA-Z0-9])`, 'g')
    result = result.replace(re, replacement)
  }
  return result
}

// Parse a definition line: "key = latex
// Returns { key, latex } or null if not a valid definition.
export function parseDefinition(raw: string): { key: string; latex: string } | null {
  const m = raw.match(/^"(\w[\w\d]*)\s*=\s*(.+)$/)
  if (!m) return null
  return { key: m[1], latex: m[2].trim() }
}
