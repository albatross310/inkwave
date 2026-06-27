// Shared utilities for math input modes (used by MathInlineView + MathBlockView).

// CapsLock hold state — tracked by keydown/keyup in each math input so Greek mode
// behaves as a held modifier rather than a toggle. Module-level because only one
// math input is ever focused at a time.
let capsHeld = false
export function capsDown() { capsHeld = true }
export function capsUp()   { capsHeld = false }

// Lowercase Greek: physical key (a-z) → Unicode character.
// KaTeX accepts Unicode Greek natively, so π renders identically to \pi.
export const GREEK_LOWER: Record<string, string> = {
  a: 'α',
  b: 'β',
  c: 'χ',
  d: 'δ',
  e: 'ε',
  f: 'φ',
  g: 'γ',
  h: 'η',
  i: 'ι',
  j: 'ϕ',  // variant phi (ϕ vs φ)
  k: 'κ',
  l: 'λ',
  m: 'μ',
  n: 'ν',
  o: 'ο',
  p: 'π',
  q: 'θ',
  r: 'ρ',
  s: 'σ',
  t: 'τ',
  u: 'υ',
  v: 'ϵ',  // variant epsilon (ϵ vs ε)
  w: 'ω',
  x: 'ξ',
  y: 'ψ',
  z: 'ζ',
}

// Uppercase Greek: only letters with distinct uppercase glyphs.
// Hold CapsLock + Shift to get uppercase.
export const GREEK_UPPER: Record<string, string> = {
  d: 'Δ',
  f: 'Φ',
  g: 'Γ',
  l: 'Λ',
  p: 'Π',
  q: 'Θ',
  s: 'Σ',
  u: 'Υ',
  w: 'Ω',
  x: 'Ξ',
  y: 'Ψ',
}

// Convert x//y → \frac{x}{y}. Strips one layer of outer parens per side:
//   (x)//(y)     → \frac{x}{y}        single parens removed
//   ((x))//((y)) → \frac{(x)}{(y)}    double parens → one layer stripped, inner kept
// Applied on commit so typing is never interrupted.
const FRAC_RE = /(\(\([^()]+\)\)|\([^()]+\)|[^\s/(]+)\s*\/\/\s*(\(\([^()]+\)\)|\([^()]+\)|[^\s/)]+)/g

export function applyShorthands(latex: string): string {
  return latex.replace(
    FRAC_RE,
    (_m, a: string, b: string) =>
      `\\frac{${a.replace(/^\((.+)\)$/, '$1')}}{${b.replace(/^\((.+)\)$/, '$1')}}`,
  )
}

// Given a React keyboard event inside a math input, returns the Greek character to insert
// when CapsLock is held, or null if the key should pass through normally.
// Call capsDown()/capsUp() from onKeyDown/onKeyUp when e.code === 'CapsLock'.
export function handleMathKey(e: React.KeyboardEvent): string | null {
  if (!capsHeld) return null
  if (!/^Key[A-Z]$/.test(e.code)) return null
  const base = e.code.slice(3).toLowerCase() // 'KeyA' → 'a'
  // With CapsLock held, Shift gives uppercase Greek; no-Shift gives lowercase.
  return e.shiftKey ? (GREEK_UPPER[base] ?? null) : (GREEK_LOWER[base] ?? null)
}

// Insert `text` at the current cursor position of a controlled input/textarea.
// Returns the new full value and the new cursor position.
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): { value: string; cursor: number } {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const value = el.value.slice(0, start) + text + el.value.slice(end)
  return { value, cursor: start + text.length }
}
