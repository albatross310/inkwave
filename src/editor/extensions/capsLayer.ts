// CapsLock symbol layer — hold CapsLock + letter to insert a math operator.
// Lower slot (a-z) = Caps + key. Upper slot (A-Z) = Caps + Shift + key.
// Custom mappings stored in localStorage override the built-in table.
// Syntax to define: type "\logm2d" in a math box to map \log → Caps+d.
//                   type "\logm2D" to map → Caps+Shift+D.

const BUILTIN: Record<string, string> = {
  // Quantifiers
  a: '\\forall',        A: '\\exists',
  // Perpendicular / top
  b: '\\perp',          B: '\\top',
  // Subset / superset
  c: '\\subset',        C: '\\supset',
  // Partial derivative / nabla
  d: '\\partial',       D: '\\nabla',
  // Element / not element
  e: '\\in',            E: '\\notin',
  // Empty set / power set
  f: '\\emptyset',      F: '\\mathcal{P}',
  // h-bar (physics)
  h: '\\hbar',
  // Infinity / aleph
  i: '\\infty',         I: '\\aleph_0',
  // Down arrows
  j: '\\downarrow',     J: '\\Downarrow',
  // Approx / equiv
  k: '\\approx',        K: '\\equiv',
  // Left arrows
  l: '\\leftarrow',     L: '\\Leftarrow',
  // Minus-plus / plus-minus
  m: '\\mp',            M: '\\pm',
  // Intersection / naturals
  n: '\\cap',           N: '\\mathbb{N}',
  // Contour integral / direct sum
  o: '\\oint',          O: '\\oplus',
  // Product / primes-or-probability
  p: '\\prod',          P: '\\mathbb{P}',
  // Logical and / proves
  q: '\\wedge',         Q: '\\vdash',
  // Right arrows
  r: '\\rightarrow',    R: '\\Rightarrow',
  // Sum / integral
  s: '\\sum',           S: '\\int',
  // Therefore / because
  t: '\\therefore',     T: '\\because',
  // Union
  u: '\\cup',
  // Logical or / models
  v: '\\vee',           V: '\\models',
  // Biconditional arrows
  w: '\\leftrightarrow', W: '\\Leftrightarrow',
  // Cross product / tensor product
  x: '\\times',         X: '\\otimes',
  // Up arrows
  y: '\\uparrow',       Y: '\\Uparrow',
  // Integers / complex
  z: '\\mathbb{Z}',     Z: '\\mathbb{C}',
}

const STORAGE_KEY = 'inkwave.caps'

function loadCustom(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}

export function getCapsSymbol(letter: string, shift: boolean): string | null {
  const k = shift ? letter.toUpperCase() : letter.toLowerCase()
  const custom = loadCustom()
  return custom[k] ?? BUILTIN[k] ?? null
}

// Parses "\logm2d" → { key:'d', shift:false, latex:'\\log' }
// Non-greedy: splits at the FIRST "m2" boundary. For \lim, use "\limm2d" (→ latex:'\\lim', key:'d').
// "\limmm2d" would give latex:'\\limm', because the first m2 appears after "limm".
export function parseCapsMapping(src: string): { key: string; shift: boolean; latex: string } | null {
  const m = src.trim().match(/^(\\[a-zA-Z]+?)m2([a-zA-Z])$/)
  if (!m) return null
  const keyChar = m[2]
  return {
    latex: m[1],
    key: keyChar.toLowerCase(),
    shift: keyChar !== keyChar.toLowerCase(),
  }
}

export function setCapsMapping(key: string, shift: boolean, latex: string) {
  const k = shift ? key.toUpperCase() : key
  const custom = loadCustom()
  custom[k] = latex
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)) } catch { /* private mode */ }
}

// Returns a merged view of built-in + custom for display in the info panel
export function allCapsMappings(): { key: string; latex: string }[] {
  const custom = loadCustom()
  const merged = { ...BUILTIN, ...custom }
  return Object.entries(merged)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b))
    .map(([key, latex]) => ({ key, latex }))
}
