// ─── The music module's type scale — ONE ramp, five steps ────────────────────
//
// PETER, 2026-07-17: "Music likewise needs all the fonts increased" — "likewise" being the
// productivity panel, where he said: "the entire text font of the panel needs to be increased.
// **It's okay if users have to scroll.** ... **Every font proportionally up.**"
//
// So: scrolling is not a cost to be minimised here. Do not shrink a step to make something fit.
//
// ─── WHY A MODULE AND NOT JUST BIGGER NUMBERS ────────────────────────────────
//
// Before this, the music module used NINE nearly-identical sizes — 10, 12, 13, 14, 15, 16, 17, 20,
// 22 — across two different vocabularies (inline `fontSize` here, Tailwind `text-xs/sm/xl` in
// `MusicPanel`/`ScoreView`). Nobody chose nine; they accumulated, one component at a time, each
// picking a number that looked right next to the last one. Scaling nine sizes by hand would have
// produced nine new ones and the same problem a size larger — and two lanes doing it independently
// (this one and the MusicXML lane got the same instruction) is how a UI ends up with fifteen.
//
// The steps are SEMANTIC, not sizes: a caller asks for `TYPE.label` because the thing IS a label.
// That is what stops the ramp regrowing — "which number is closest to what I want" has no answer,
// but "what is this text for" does.
//
// ─── THE 16px FLOOR IS THE BOTTOM OF THE RAMP, DELIBERATELY ──────────────────
//
// iOS auto-zooms — and STAYS zoomed — when a control under 16px takes focus (CLAUDE.md, iOS
// invariants). That rule only binds INPUTS, but the floor is applied to the whole ramp anyway:
// a two-tier rule ("16 for inputs, smaller elsewhere") is one someone forgets the day they add an
// input, and Peter is asking for bigger text regardless. Every step here is ≥16, so the iOS trap is
// unreachable by construction rather than by remembering.
//
// The old ramp's bottom (10px badges) rises 1.6× while the top rises 1.36×, so the ramp is FLATTER
// than it was. That is a real consequence of the floor and it is the right trade: at these sizes the
// hierarchy is carried by weight and colour, and a 10px timestamp was not legible on an iPad held at
// music-stand distance — which is the actual reading distance for this module.

/** The ramp. px. Every step ≥16 (the iOS floor). */
export const TYPE = {
  /** The piece title. One per screen. */
  title: 30,
  /** A screen or section heading. */
  heading: 24,
  /** Ordinary prose, and anything the student types INTO. */
  body: 20,
  /** Buttons, tabs, field labels, captions. */
  label: 18,
  /** The smallest thing on screen: timestamps, badges, counts. The floor. */
  meta: 16,
} as const

export type TypeStep = keyof typeof TYPE

/** `style={{ fontSize: TYPE.label }}` is fine; this is for the common label+colour pair. */
export function type_(step: TypeStep, colour?: string): { fontSize: number; color?: string } {
  return colour ? { fontSize: TYPE[step], color: colour } : { fontSize: TYPE[step] }
}

/**
 * Minimum touch target, px. Apple's HIG floor, and the size a Pencil sweep needs to be grabbable.
 *
 * Here rather than in a component because it moves WITH the ramp: a control sized to its text must
 * not end up smaller than a fingertip when the text step changes.
 */
export const TOUCH_MIN = 44
