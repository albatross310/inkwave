// Shared math-mode utilities. Uses a KBEvent interface so functions accept
// both React.KeyboardEvent and native DOM KeyboardEvent (needed for MathLive).

interface KBEvent {
  code: string
  key: string
  shiftKey: boolean
  getModifierState(key: string): boolean
}

// ── CapsLock state machine ────────────────────────────────────────────────────
// Module-level — safe because only one math input is active at a time.
let capsHeld         = false
let capsStateOnEntry: boolean | null = null

export function capsDown() { capsHeld = true }
export function capsUp()   { capsHeld = false }

export function initCapsTracking(e: KBEvent) {
  if (capsStateOnEntry === null && e.code !== 'CapsLock') {
    capsStateOnEntry = e.getModifierState('CapsLock')
  }
}

export function resetCapsTracking() {
  capsStateOnEntry = null
  capsHeld = false
}

// ── Greek maps ────────────────────────────────────────────────────────────────

export const GREEK_LOWER: Record<string, string> = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ',
  g: 'γ', h: 'η', i: 'ι', j: 'ϕ', k: 'κ', l: 'λ',
  m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ',
  s: 'σ', t: 'τ', u: 'υ', v: 'ϵ', w: 'ω', x: 'ξ',
  y: 'ψ', z: 'ζ',
}

export const GREEK_UPPER: Record<string, string> = {
  d: 'Δ', f: 'Φ', g: 'Γ', l: 'Λ', p: 'Π',
  q: 'Θ', s: 'Σ', u: 'Υ', w: 'Ω', x: 'Ξ', y: 'Ψ',
}

export function handleMathKey(e: KBEvent): string | null {
  if (!capsHeld) return null
  if (!/^Key[A-Z]$/.test(e.code)) return null
  const base = e.code.slice(3).toLowerCase()
  return e.shiftKey ? (GREEK_UPPER[base] ?? null) : (GREEK_LOWER[base] ?? null)
}

// ── LaTeX shorthands ──────────────────────────────────────────────────────────

const FRAC_RE = /(\(\([^()]+\)\)|\([^()]+\)|[^\s/(]+)\s*\/\/\s*(\(\([^()]+\)\)|\([^()]+\)|[^\s/)]+)/g
const FRAC_RE_LIVE = /(\(\([^()]+\)\)|\([^()]+\)|[^\s/(]+)\s*\/\/(?:\s*(\(\([^()]+\)\)|\([^()]+\)|[^\s/)]+))?/g

export function applyShorthands(latex: string): string {
  return latex.replace(FRAC_RE, (_m, a: string, b: string) =>
    `\\frac{${a.replace(/^\((.+)\)$/, '$1')}}{${b.replace(/^\((.+)\)$/, '$1')}}`,
  )
}

export function applyShorthandsLive(latex: string): string {
  return latex.replace(FRAC_RE_LIVE, (_m, a: string, b?: string) => {
    const num = a.replace(/^\((.+)\)$/, '$1')
    const den = b ? b.replace(/^\((.+)\)$/, '$1') : '\\,'
    return `\\frac{${num}}{${den}}`
  })
}
