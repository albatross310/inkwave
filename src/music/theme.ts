// Theming the rendered notation (CLAUDE.md: THEMING IS MANDATORY for every new panel — and SVG
// must theme too).
//
// ─── Why this file exists at all ─────────────────────────────────────────────────────────────
// The charts lane (`productivity/charts/`) themes its SVG the easy way: every `fill`/`stroke` is
// literally `var(--iw-ink, #5c2d8a)`, so the night block remaps it for free. We CANNOT do that here.
// OSMD generates the notation SVG itself and writes CONCRETE colour values into it (its engraving
// rules take `#rrggbb` strings, not CSS functions). A `var(...)` handed to OSMD is not a colour it
// understands — it would be written into the SVG verbatim and the notation would render black, or
// not at all.
//
// So the rule is honoured one level up: the colours still live ONLY as theme tokens in the night
// block of `styles/index.css` — nothing here invents a colour — and this module RESOLVES those
// tokens against the live DOM at render time, handing OSMD the value the theme currently says. On a
// theme change the score re-renders (see ScoreView), which is the same "one switch, no per-component
// overrides" contract, just resolved late because the engine forces it.
//
// The day values below are FALLBACKS, in the exact sense of `var(--iw-ink, #5c2d8a)`: what to use
// when the token is missing. They are not a second source of truth, and `theme.test.ts` asserts that
// every token here is actually defined in BOTH themes in index.css — a token this file resolves but
// the stylesheet never defines would silently render every score in its day colour, in both themes,
// and look exactly like theming that "just didn't need to change anything".

// ─── The container MUST carry `iw-nightable` ─────────────────────────────────────────────────
// The night palette in index.css is declared as `:root[data-theme="night"] .iw-nightable { … }` —
// SCOPED to that class, not on :root. So `resolveScoreColors` only sees night values for an element
// INSIDE an `iw-nightable` container. Without the class every token misses, every fallback applies,
// and the score renders day-black on a charcoal page — no error, nothing in the console, and it
// looks exactly like notation that "doesn't theme". ScoreView puts the class on its outer container
// and `ScoreView.test.tsx` asserts it stays there.

/** One themed colour: the token that owns it, and the day value to fall back to. */
export interface ScoreToken { token: string; day: string }

/**
 * Every colour the notation uses. ONE entry per colour, token-first.
 *
 * `theme.test.ts` asserts structurally that no entry carries a bare hex outside `day` — the same
 * guard `judged.test.ts` puts on the charts' SERIES_STYLE, for the same reason: a hex inlined at a
 * call site is invisible to the night block and simply never themes.
 */
export const SCORE_STYLE = {
  /** Staves, noteheads, stems, clefs — the engraving itself. */
  music: { token: '--iw-score-ink', day: '#1c1917' },
  /** The playback cursor (§B3). */
  cursor: { token: '--iw-score-cursor', day: '#5c2d8a' },
  /** The page the notation sits on. */
  paper: { token: '--iw-score-paper', day: '#ffffff' },
  /** A bar highlighted because an annotation or a citation points at it (§B4). */
  highlight: { token: '--iw-score-highlight', day: '#9b5ccc' },
  /** Title/composer text above the score. */
  title: { token: '--iw-score-title', day: '#44403c' },
} as const satisfies Record<string, ScoreToken>

export type ScoreColors = { [K in keyof typeof SCORE_STYLE]: string }

/**
 * Resolve every score token against the live DOM.
 *
 * `getComputedStyle(el).getPropertyValue('--x')` returns '' when the property is not defined, which
 * is exactly when the fallback should apply — the same semantics as `var(--x, fallback)`.
 */
export function resolveScoreColors(el: Element): ScoreColors {
  const cs = getComputedStyle(el)
  const out = {} as Record<string, string>
  for (const [name, spec] of Object.entries(SCORE_STYLE)) {
    out[name] = cs.getPropertyValue(spec.token).trim() || spec.day
  }
  return out as ScoreColors
}

/** The token names, for the stylesheet check in theme.test.ts. */
export const scoreTokenNames = (): string[] => Object.values(SCORE_STYLE).map(s => s.token)
