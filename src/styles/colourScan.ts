// The colour-literal scanner — the instrument behind the palette gate (`colourScan.test.ts`).
//
// ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// CLAUDE.md's THEMING section makes a promise: "Adding a new scheme later = one more
// `:root[data-theme=…]` block; components don't change." Measured against master (2026-08-30) that
// promise is false, and the number says how false: 892 colour literals sit in production TS/TSX with
// no token anywhere near them — 127 of them `#5c2d8a`, the app's own ink, which HAS a token. A
// literal in a component is invisible to every `:root` block ever written, so each one is a surface
// that a new palette cannot reach and that only a human eye reports. Peter has been reporting them
// one at a time for a week.
//
// Nothing stopped the drift, so this is the thing that stops it: a RATCHET. Every file carries the
// count it had when the gate landed; the gate fails when a file EXCEEDS its cap, and a file the
// baseline has never heard of is capped at ZERO. Removing literals never fails, so the migration —
// and the three colour lanes in flight while this was written — can only make the gate greener.
//
// ─── WHAT IS AND IS NOT A VIOLATION ──────────────────────────────────────────────────────────────
// BARE  `background: '#fff'`            — counted. It cannot theme. This is the defect.
// FALLBACK  `var(--iw-ink, #5c2d8a)`    — NOT counted. It is CLAUDE.md rule 2, the sanctioned
//           intermediate form, and it is the shape a lane fixing a night bug writes on its way from
//           bare to tokenised. Capping it would fail the gate on the fix. It is REPORTED instead
//           (`scanTree().fallback`) because it is not the destination either: a fallback only ever
//           applies when the token is undefined, so a live one means the palette has a hole.
//
// COMMENTS ARE STRIPPED BEFORE SCANNING, deliberately and not as a nicety. This repo's comments must
// name the colours they forbid in order to forbid them — this file's own header names `#5c2d8a`, and
// index.css explains `--iw-on-ink` by quoting the white-on-#cbb8f2 bug it fixes. CLAUDE.md records
// three separate lanes in one round whose guards fired on their own documentation, and the tempting
// fix each time was to delete the sentence. A guard that cannot survive its own explanation gets
// disabled.

/** One file's colour census. */
export interface ColourCensus {
  /** Literals with no token at all — the defect this gate ratchets down. */
  bare: string[]
  /** Literals sitting in a `var(--tok, HERE)` fallback slot — reported, never capped. */
  fallback: string[]
}

/**
 * Hex, rgb()/rgba(), hsl()/hsla(). Deliberately NOT matching named CSS colours (`white`, `black`):
 * `black` is also an English word and a font weight, and over-collecting prose is how a guard earns
 * the reputation that gets it deleted. Named colours are rare here and the migration catches them by
 * eye.
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
 * A plain `.replace(/\/\/.*$/gm, '')` truncates any line holding a URL in a string literal, and a
 * naive block-comment strip eats a regex or a template. So this is a small state machine over
 * code/string/line-comment/block-comment. It is not a parser and does not need to be: the only
 * question it has to answer correctly is "is this hex inside a comment".
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
