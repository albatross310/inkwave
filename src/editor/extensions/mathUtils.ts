// Shared utilities for math input modes (used by MathInlineView + MathBlockView).

// Lowercase Greek: maps physical key (a-z) → LaTeX command (with trailing space).
// Activated when CapsLock is on without Shift.
export const GREEK_LOWER: Record<string, string> = {
  a: '\\alpha ',
  b: '\\beta ',
  c: '\\chi ',
  d: '\\delta ',
  e: '\\epsilon ',
  f: '\\phi ',
  g: '\\gamma ',
  h: '\\eta ',
  i: '\\iota ',
  j: '\\varphi ',
  k: '\\kappa ',
  l: '\\lambda ',
  m: '\\mu ',
  n: '\\nu ',
  o: 'o',
  p: '\\pi ',
  q: '\\theta ',
  r: '\\rho ',
  s: '\\sigma ',
  t: '\\tau ',
  u: '\\upsilon ',
  v: '\\varepsilon ',
  w: '\\omega ',
  x: '\\xi ',
  y: '\\psi ',
  z: '\\zeta ',
}

// Uppercase Greek: maps key → LaTeX command. Only letters with distinct uppercase glyphs.
// Activated when CapsLock is on WITH Shift (which reverses capslock → lowercase e.key).
export const GREEK_UPPER: Record<string, string> = {
  d: '\\Delta ',
  f: '\\Phi ',
  g: '\\Gamma ',
  l: '\\Lambda ',
  p: '\\Pi ',
  q: '\\Theta ',
  s: '\\Sigma ',
  u: '\\Upsilon ',
  w: '\\Omega ',
  x: '\\Xi ',
  y: '\\Psi ',
}

// Convert (x)/(y) shorthand → \frac{x}{y}. Applied on commit so typing isn't disrupted.
// Handles simple non-nested cases. Nested fractions require standard \frac{}{} syntax.
export function applyShorthands(latex: string): string {
  return latex.replace(/\(([^()]+)\)\/\(([^()]+)\)/g, '\\frac{$1}{$2}')
}

// Given a React keyboard event inside a math input, returns the LaTeX string to insert
// when CapsLock is on, or null if the key should pass through normally.
export function handleMathKey(e: React.KeyboardEvent): string | null {
  if (!e.getModifierState('CapsLock')) return null
  if (!/^Key[A-Z]$/.test(e.code)) return null
  const base = e.code.slice(3).toLowerCase() // 'KeyA' → 'a'
  // Shift+CapsLock reverses case: e.key is lowercase → user wants uppercase Greek.
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
