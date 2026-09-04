// The colour-literal scanner — the instrument behind the palette gate (`colourScan.test.ts`).
//
// ⚠ IT IS A RATCHET. Every file carries the count it had when the gate landed; the gate fails when
// a file EXCEEDS its cap, and a file the baseline has never heard of is capped at ZERO. Removing
// literals can never fail, so a migration can only make it greener. It exists because the theming
// promise ("components don't change") was measurably false — 892 bare literals in production
// TS/TSX, 127 of them the app's own ink, each one a surface no `:root` block can ever reach.
//
// ⚠ BARE `background: '#fff'` is COUNTED — it cannot theme, and it is the defect. A `var(--tok,
// #hex)` FALLBACK is NOT counted: it is the sanctioned intermediate form a lane writes on the way
// from bare to tokenised, so capping it would fail the gate on the fix. It is REPORTED instead,
// because a live fallback means the palette has a hole.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, and that is load-bearing, not a nicety: this repo's
// comments must NAME the colours they forbid in order to forbid them — this header names `#5c2d8a`
// — and three lanes in one round shipped guards that fired on their own documentation, where the
// tempting fix each time was to delete the sentence.
// → docs/archive/panels-and-popovers.md#colourscan-why

/** One file's colour census. */
export interface ColourCensus {
  /** Literals with no token at all — the defect this gate ratchets down. */
  bare: string[]
  /** Literals sitting in a `var(--tok, HERE)` fallback slot — reported, never capped. */
  fallback: string[]
}

/**
 * Hex, rgb()/rgba(), hsl()/hsla(). ⚠ Deliberately NOT named CSS colours: `black` is also an English
 * word and a font weight, and over-collecting prose is how a guard earns the reputation that gets
 * it deleted. Named colours are rare here and the migration catches them by eye.
 */
const COLOUR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(\s*[\d.%\s,/]+\)/g

/**
 * A `var(--token, fallback)` call, capturing the fallback slot. One nesting level of parens is
 * allowed inside so `var(--x, rgba(0,0,0,.2))` is recognised as a fallback rather than read as a
 * bare literal sitting next to a var().
 */
const VAR_FALLBACK_RE = /var\(\s*--[a-z0-9-]+\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g

/**
 * Strip `//` and block comments without destroying string contents.
 *
 * ⚠ A STATE MACHINE, NOT A REGEX: `.replace(/\/\/.*$/gm, '')` truncates any line holding a URL in
 * a string literal, and a naive block strip eats a regex or a template. It is not a parser and does
 * not need to be — the only question it must answer correctly is "is this hex inside a comment".
 */
export function stripComments(src: string): string {
  let out = ''
  let mode: 'code' | 'line' | 'block' | 'str' = 'code'
  let quote = ''
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    const c2 = src.slice(i, i + 2)
    if (mode === 'code') {
      if (c2 === '/*') { mode = 'block'; i += 2; continue }
      if (c2 === '//') { mode = 'line'; i += 2; continue }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i++; continue }
      out += c; i++; continue
    }
    if (mode === 'block') {
      if (c2 === '*/') { mode = 'code'; out += ' '; i += 2; continue }
      i++; continue
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n' }
      i++; continue
    }
    // mode === 'str'
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue }
    if (c === quote) mode = 'code'
    out += c; i++
  }
  return out
}

/** Census one file's source text. Pure — the test drives it on planted strings for its negatives. */
export function scanSource(src: string): ColourCensus {
  const code = stripComments(src)
  const fallback: string[] = []

  // Blank out every fallback slot (recording what was in it) so the leftovers are exactly the bare
  // literals. Spans are cleared back-to-front so earlier indices stay valid.
  const spans: Array<[number, number]> = []
  for (const m of code.matchAll(VAR_FALLBACK_RE)) {
    const inner = m[1]
    const hits = inner.match(COLOUR_RE)
    if (!hits) continue
    fallback.push(...hits)
    const at = (m.index ?? 0) + m[0].indexOf(inner)
    spans.push([at, at + inner.length])
  }
  let masked = code
  for (const [a, b] of spans.reverse()) masked = masked.slice(0, a) + ' '.repeat(b - a) + masked.slice(b)

  return { bare: masked.match(COLOUR_RE) ?? [], fallback }
}

/** Directories never worth walking. */
export const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '__snapshots__'])

// ─── THE TOKEN CONTRACT ──────────────────────────────────────────────────────
// ⚠ AN UNDECLARED TOKEN IS THE QUIETER FAILURE: `var(--iw-x, #hex)` reading a token nobody declared
// is indistinguishable at a glance from one that works — it renders the fallback, in every theme,
// forever, with no error (`--iw-panel-bg`, `--iw-score-gap`, `--iw-gap-rule` were all found this
// way). ⚠ DERIVED FROM SOURCE ON BOTH SIDES — what components read vs what index.css declares —
// never a hand-written list. → docs/archive/panels-and-popovers.md#colourscan-token-contract

/** One `var(--token, fallback)` call site. */
export interface VarUse { token: string; fallback: string | null }

/** Every `var(--iw-…)` read in a source file, with whatever fallback it passes. */
export function varUses(src: string): VarUse[] {
  const out: VarUse[] = []
  for (const m of stripComments(src).matchAll(/var\(\s*(--iw-[a-z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g)) {
    out.push({ token: m[1], fallback: m[2]?.trim() || null })
  }
  return out
}

/**
 * Custom properties DECLARED in a stylesheet, split by theme. Comments are stripped first: index.css
 * explains `--iw-on-ink` by quoting the white-on-#cbb8f2 bug it fixes, and a raw-text scan would
 * read that sentence as a declaration.
 */
export function declaredTokens(css: string): { day: Map<string, string>; night: Map<string, string> } {
  const day = new Map<string, string>()
  const night = new Map<string, string>()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const isNight = /data-theme="night"/.test(rule[1])
    for (const d of rule[2].matchAll(/(--iw-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      ;(isNight ? night : day).set(d[1], d[2].trim())
    }
  }
  return { day, night }
}

/**
 * Colours that are equal but spelled differently. `#fff` and `#ffffff` are the same paint, and a
 * guard that called them a mismatch would force a cosmetic rewrite of every call site to say
 * nothing. Whitespace inside rgb()/rgba() is normalised for the same reason.
 */
export function sameColour(a: string, b: string): boolean {
  return normaliseColour(a) === normaliseColour(b)
}

/**
 * One colour, one spelling — so the drift check reports real disagreements and not typography.
 *
 * ⚠ THE TWO BRANCHES MUST STAY APART: hex is expanded and lowercased and NEVER arithmetic; only the
 * components inside rgb()/hsl() are compared as numbers. Running the numeric normaliser over hex
 * turned `#000000` into `Number('000000')` = `#0`, so a token was reported as drifting from itself
 * — a normaliser that changes what it is comparing is worse than none. Both of this function's bugs
 * MANUFACTURED findings. → docs/archive/panels-and-popovers.md#colourscan-normalise
 */
export function normaliseColour(s: string): string {
  const t = s.trim().toLowerCase().replace(/\s+/g, '')
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(t)
  if (short) {
    const d = (c: string) => c + c
    return `#${d(short[1])}${d(short[2])}${d(short[3])}${short[4] ? d(short[4]) : ''}`
  }
  if (t.startsWith('#')) return t
  return t.replace(/[\d.]+/g, (n) => String(Number(n)))
}

/**
 * Is this fallback a COLOUR?
 *
 * ⚠ DERIVED, NEVER A HAND-WRITTEN LIST of layout token names (`--iw-toolbar-h`, `--iw-tap-x`…):
 * a token is a colour token when a call site passes it a colour. That is the drift
 * `contrastWalkerContract.test.ts` exists to stop one directory over. `transparent` and
 * `currentColor` count — a token whose only fallback is `transparent` is still a colour a palette
 * may want to re-point.
 */
export function isColourValue(v: string): boolean {
  const t = v.trim().toLowerCase()
  return /^#[0-9a-f]{3,8}$/.test(t) || /^(?:rgba?|hsla?)\(/.test(t) ||
    t === 'transparent' || t === 'currentcolor' || /^(?:white|black)$/.test(t)
}

/**
 * Custom properties this repo WRITES AT RUNTIME, from source.
 *
 * ⚠ BOTH SPELLINGS, because one alone is a false instrument: `setProperty('--iw-x', …)` and React's
 * inline-style key form. `setProperty` alone finds 13 and MISSES `--iw-tap-x`, `--iw-row-slots` and
 * `--iw-wave-x` — enough of a gap to make a "these are all runtime channels" exemption quietly
 * wrong. ⚠ CORROBORATION ONLY: the dangling check's line is "is it a COLOUR token". Some of these
 * must stay imperative — declaring `--iw-wave-x` invalidated the whole page subtree (p50 417→50ms).
 * → docs/archive/panels-and-popovers.md#colourscan-runtime-written
 */
export function runtimeWritten(src: string): Set<string> {
  const clean = stripComments(src)
  const out = new Set<string>()
  for (const m of clean.matchAll(/setProperty\(\s*['"`](--iw-[a-z0-9-]+)/g)) out.add(m[1])
  for (const m of clean.matchAll(/\[\s*['"`](--iw-[a-z0-9-]+)['"`]\s*(?:as\s+\w+\s*)?\]\s*:/g)) out.add(m[1])
  return out
}

/**
 * Tokens whose day value is deliberately NOT declared, each because declaring one would repaint
 * something real. Reported in colourScan.test.ts so the list cannot quietly grow; the argument for
 * each is in index.css beside the day palette.
 */
export const UNDECLARED_BY_DESIGN = new Set(['--iw-paper', '--iw-newbtn-fg'])

/**
 * Files exempt from the BARE cap, each for a reason that is asserted in the test rather than
 * trusted. An exemption nobody re-proves is how a real hole opens (claims.test.ts's fixture-carrier
 * check exists because that exact narrowing went unproven once).
 */
export const EXEMPT = [
  // The palette itself. Every colour in the product is supposed to end up here.
  'src/styles/index.css',
  // The scanner's own patterns. It carries hex-shaped regexes as DATA, the way claimMatchers.ts
  // carries knownBad strings — sweeping it would flag the instrument for being an instrument.
  'src/styles/colourScan.ts',
] as const

/** A test/probe file: excluded like claims.test.ts excludes them — fixtures are planted there. */
export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(path) || path.endsWith('.prove.mjs') || /(^|\/)audit\//.test(path)
}

/** Should this path be scanned for BARE literals at all? */
export function isScannable(path: string): boolean {
  if (isTestFile(path)) return false
  if ((EXEMPT as readonly string[]).includes(path)) return false
  return /\.(ts|tsx)$/.test(path)
}
