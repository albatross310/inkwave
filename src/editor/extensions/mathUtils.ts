// Shared utilities for math input modes (used by MathInlineView + MathBlockView).

// ── CapsLock / Tab state machine ─────────────────────────────────────────────
// capsHeld:         true while CapsLock key is physically held → Greek mode.
// tabHeld:          true while Tab is held while capsHeld → normal English pass-through.
// capsStateOnEntry: OS CapsLock state recorded on the first non-CapsLock keydown.
//                   The OS always toggles CapsLock on keydown regardless of
//                   e.preventDefault(). We detect the resulting drift and normalise
//                   regular letter input so the math box behaves consistently.
// One math input focused at a time → module-level is safe.
let capsHeld         = false
let tabHeld          = false
let capsStateOnEntry: boolean | null = null

export function capsDown() { capsHeld = true }
export function capsUp()   { capsHeld = false }
export function tabDown()  { tabHeld  = true }
export function tabUp()    { tabHeld  = false }

// Record the OS CapsLock baseline on the first keydown inside the math box.
export function initCapsTracking(e: React.KeyboardEvent) {
  if (capsStateOnEntry === null && e.code !== 'CapsLock') {
    capsStateOnEntry = e.getModifierState('CapsLock')
  }
}

// Reset all tracking state when the math input is blurred or closed.
export function resetCapsTracking() {
  capsStateOnEntry = null
  capsHeld         = false
  tabHeld          = false
}

// If the OS CapsLock has drifted from the entry baseline, return the
// correctly-cased character for the physical key. Returns null when the
// CapsLock state is correct or when we're in Greek mode (handled elsewhere).
export function normalizeCapsLetter(e: React.KeyboardEvent): string | null {
  if (capsHeld) return null
  if (capsStateOnEntry === null) return null
  if (!/^Key[A-Z]$/.test(e.code)) return null
  const current = e.getModifierState('CapsLock')
  if (current === capsStateOnEntry) return null
  const base = e.code.slice(3).toLowerCase()
  return e.shiftKey ? base.toUpperCase() : base
}

// Lowercase Greek: physical key (a–z) → Unicode character.
// KaTeX accepts Unicode Greek natively (π renders like \pi).
export const GREEK_LOWER: Record<string, string> = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ',
  g: 'γ', h: 'η', i: 'ι', j: 'ϕ', k: 'κ', l: 'λ',
  m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ',
  s: 'σ', t: 'τ', u: 'υ', v: 'ϵ', w: 'ω', x: 'ξ',
  y: 'ψ', z: 'ζ',
}

// Uppercase Greek: only letters with distinct uppercase glyphs.
// Shift+CapsLock to access (same as Shift for uppercase in normal mode).
export const GREEK_UPPER: Record<string, string> = {
  d: 'Δ', f: 'Φ', g: 'Γ', l: 'Λ', p: 'Π',
  q: 'Θ', s: 'Σ', u: 'Υ', w: 'Ω', x: 'Ξ', y: 'Ψ',
}

// Returns the Greek character to insert when CapsLock is held, or null.
// Shift → uppercase Greek. Tab held → override: pass through as normal letter.
export function handleMathKey(e: React.KeyboardEvent): string | null {
  if (!capsHeld) return null
  if (tabHeld)   return null   // Tab held: normal English pass-through
  if (!/^Key[A-Z]$/.test(e.code)) return null
  const base = e.code.slice(3).toLowerCase()
  return e.shiftKey ? (GREEK_UPPER[base] ?? null) : (GREEK_LOWER[base] ?? null)
}

// Complete fraction: x//y → \frac{x}{y}.  Used on commit/save.
const FRAC_RE = /(\(\([^()]+\)\)|\([^()]+\)|[^\s/(]+)\s*\/\/\s*(\(\([^()]+\)\)|\([^()]+\)|[^\s/)]+)/g

export function applyShorthands(latex: string): string {
  return latex.replace(
    FRAC_RE,
    (_m, a: string, b: string) =>
      `\\frac{${a.replace(/^\((.+)\)$/, '$1')}}{${b.replace(/^\((.+)\)$/, '$1')}}`,
  )
}

// Live/display version: denominator is optional, so x// shows \frac{x}{} immediately.
const FRAC_RE_LIVE = /(\(\([^()]+\)\)|\([^()]+\)|[^\s/(]+)\s*\/\/(?:\s*(\(\([^()]+\)\)|\([^()]+\)|[^\s/)]+))?/g

export function applyShorthandsLive(latex: string): string {
  return latex.replace(
    FRAC_RE_LIVE,
    (_m, a: string, b?: string) => {
      const num = a.replace(/^\((.+)\)$/, '$1')
      // Use \, (thin space) as placeholder when denominator not typed yet —
      // empty {} can throw in KaTeX with throwOnError:true.
      const den = b ? b.replace(/^\((.+)\)$/, '$1') : '\\,'
      return `\\frac{${num}}{${den}}`
    },
  )
}

// Insert `text` at the current cursor position in a controlled input/textarea.
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): { value: string; cursor: number } {
  const start = el.selectionStart ?? el.value.length
  const end   = el.selectionEnd   ?? el.value.length
  const value = el.value.slice(0, start) + text + el.value.slice(end)
  return { value, cursor: start + text.length }
}
