// Shared visual chrome for the marketing / legal pages (About, Verify, Privacy) so the whole set can be
// re-themed from ONE place. Hard-coded hex on purpose — tweak here and every page updates together.

export const PAGE_INK = '#5c2d8a'          // headings / primary purple
export const PAGE_LIGHT = '#9b5ccc'        // lighter purple accent
export const PAGE_PARCHMENT = '#f7f2e8'    // the content "page" surface (matches the editor page)
export const PAGE_TEXT = '#3a3a3a'
// Deep-black → aquamarine surround behind the page (no waves). ~20° declension, top-left origin.
// Emulates the Inkwave logo's gradient (its exact stops, reversed so the near-black end sits in the
// dark corner): near-black → deep indigo → royal blue → blue → teal → the page aquamarine.
export const PAGE_GRADIENT = 'linear-gradient(122deg, #060012 -4%, #0A0065 9%, #003580 17%, #007EB9 26%, #00BFA8 40%, #9fd9c8 58%)'
export const PAGE_CARD_SHADOW = '0 8px 32px rgba(80,50,10,0.18)'
export const PAGE_CARD_RADIUS = 10
