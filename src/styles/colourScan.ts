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

// ─── THE TOKEN CONTRACT ──────────────────────────────────────────────────────────────────────────
// Everything above counts literals. This half checks the OTHER failure, and it is the quieter one: a
// `var(--iw-x, #fallback)` that reads a token nobody ever declared is INDISTINGUISHABLE at a glance
// from one that works — it renders the fallback, in every theme, forever, with no error. The reader
// lane found `--iw-panel-bg` that way (declared nowhere, read by two live surfaces); this sweep also
// found `--iw-score-gap` and `--iw-gap-rule` in src/music/ScorePage.tsx.
//
// It is DERIVED FROM SOURCE both sides — the tokens components actually read, against the tokens
// index.css actually declares — rather than a hand-written list, which is the drift that
// `contrastWalkerContract.test.ts` exists to stop one directory over.

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
 * ⚠ TWO BUGS IN THIS ONE FUNCTION, both of which MANUFACTURED FINDINGS, and both caught only by
 * reading the list it produced rather than by trusting its count:
 *   1. The first cut stripped trailing alpha zeros with a regex that could never fire, so
 *      `rgba(…,0.10)` was reported as drift from `rgba(…,0.1)` — 2 of its 14 "findings" were the
 *      instrument's own.
 *   2. The fix then ran the numeric normaliser over HEX too: `#000000` is all digits, so it became
 *      `Number('000000')` = `#0`, and `--iw-page-num` was reported as drift from itself. A
 *      normaliser that changes what it is comparing is worse than none.
 * Hence the two branches are kept apart: hex is expanded and lowercased and NEVER arithmetic; only
 * the components inside rgb()/hsl() are compared as numbers.
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
 * The dangling check has to separate colour tokens from the layout ones (`--iw-toolbar-h`,
 * `--iw-kb-offset`, `--iw-tap-x`, `--iw-align`…), which are set imperatively from JS and are
 * correctly absent from the stylesheet. Doing that with a hand-written list of layout names is the
 * drift `contrastWalkerContract.test.ts` exists to stop, so it is derived instead: a token is a
 * colour token when a call site passes it a colour. `transparent` and `currentColor` count — they
 * are values of a colour property, and a token whose only fallback is `transparent` is still a
 * colour a palette may want to re-point.
 */
export function isColourValue(v: string): boolean {
  const t = v.trim().toLowerCase()
  return /^#[0-9a-f]{3,8}$/.test(t) || /^(?:rgba?|hsla?)\(/.test(t) ||
    t === 'transparent' || t === 'currentcolor' || /^(?:white|black)$/.test(t)
}

/**
 * Custom properties this repo WRITES AT RUNTIME, from source.
 *
 * Two spellings, because one alone is a false instrument: `el.style.setProperty('--iw-x', …)` and
 * React's inline-style key form `{ ['--iw-x' as string]: '6px' }`. Scanning only for `setProperty`
 * finds 13 properties and MISSES `--iw-tap-x`, `--iw-row-slots` and `--iw-wave-x` — which is exactly
 * enough of a gap to make a "these are all runtime channels" exemption quietly wrong.
 *
 * This is corroboration, NOT the line the dangling check draws. The line is "is it a COLOUR token",
 * derived from the fallbacks call sites pass — a runtime-written property is fine, and an undeclared
 * COLOUR token is the bug (`--iw-panel-bg`, `--iw-score-gap`, `--iw-gap-rule`). Several of these must
 * stay imperative for measured reasons: CLAUDE.md records that declaring `--iw-wave-x` as an
 * inheriting custom property invalidated the whole page subtree, p50 417ms → 50ms.
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
