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
// Two ramps, one name. On a phone these are the 30/24/20/18/16 steps (the 16px floor is iOS's own:
// anything smaller auto-zooms). On a desktop the same steps resolve to the panel ramp that every
// sheet wears (index.css `:root` — 22/18/15/13/12), because a pop-up beside a 15px Settings panel
// read as a billboard at phone sizes (Peter, 2026-09-18: "prod fonts too big, music too big").
// Each step is a CSS var with the PHONE value as its fallback, so a bare render still gets a size.
export const TYPE_PX = {
  title: 30,
  heading: 24,
  body: 20,
  label: 18,
  meta: 16,
} as const

export const TYPE = {
  /** The piece title. One per screen. */
  title: `var(--iw-t-title, ${TYPE_PX.title}px)`,
  /** A screen or section heading. */
  heading: `var(--iw-t-heading, ${TYPE_PX.heading}px)`,
  /** Ordinary prose, and anything the student types INTO. */
  body: `var(--iw-t-body, ${TYPE_PX.body}px)`,
  /** Buttons, tabs, field labels, captions. */
  label: `var(--iw-t-label, ${TYPE_PX.label}px)`,
  /** The smallest thing on screen: timestamps, badges, counts. The floor. */
  meta: `var(--iw-t-meta, ${TYPE_PX.meta}px)`,
} as const

export type TypeStep = keyof typeof TYPE

export function type_(step: TypeStep, colour?: string): { fontSize: string; color?: string } {
  return colour ? { fontSize: TYPE[step], color: colour } : { fontSize: TYPE[step] }
}

/**
 * Minimum touch target, px. Here rather than in a component because it moves WITH the ramp: a
 * control sized to its text must not end up smaller than a fingertip when the text step changes.
 */
export const TOUCH_MIN = 44
