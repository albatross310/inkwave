// Shared math-mode utilities for MathLive views.
// Greek mode is a component-local toggle (CapsLock tap-to-toggle) — not module-level,
// so the OS CapsLock state is never affected. handleMathKey takes greekMode as param.

interface KBEvent {
  code: string
  key: string
  shiftKey: boolean
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

// Returns the Greek character to insert, or null.
// greekMode is passed by the component (component-local ref, not module state).
export function handleMathKey(e: KBEvent, greekMode: boolean): string | null {
  if (!greekMode) return null
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
