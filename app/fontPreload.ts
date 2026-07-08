// Derived from scripts/fetch-fonts.mjs output, then TRIMMED to the first-paint faces only
// (2026-07-08): preloading all 10 faces (712KB) competed with the app JS for first-visit
// bandwidth and pushed the reveal later. The body face (EB Garamond 400) + the heading face
// (IM Fell 400) cover the initial paint; italics/500-weights arrive via font-display: swap a
// beat later, which is invisible on a page that opens as an empty parchment.
export const FONT_PRELOAD: string[] = [
  '/fonts/eb-garamond-400-normal-19.woff2',
  '/fonts/eb-garamond-400-normal-20.woff2',
  '/fonts/im-fell-dw-pica-400-normal-29.woff2',
]
