// Shared visual chrome for the marketing / legal pages (About, Verify, Privacy) so the whole set can be
// re-themed from ONE place. Hard-coded hex on purpose — tweak here and every page updates together.

export const PAGE_INK = '#35283e'          // headings / primary purple
export const PAGE_LIGHT = '#484965'        // lighter purple accent
export const PAGE_PARCHMENT = '#f7f2e8'    // the content "page" surface (matches the editor page)
export const PAGE_TEXT = '#3a3a3a'
// Deep-black → aquamarine surround behind the page (no waves). ~20° declension, top-left origin.
// Emulates the Inkwave logo's gradient (its exact stops, reversed so the near-black end sits in the
// dark corner): near-black → deep indigo → royal blue → blue → teal → the page aquamarine.
// 150deg = a 60-degree declension from just right of the top-left corner (Peter, 2026-07-10);
// the black + deep blue reach much further so tall phone screens don't read lopsided.
export const PAGE_GRADIENT = 'linear-gradient(150deg, #060012 10%, #0A0065 30%, #003580 44%, #007EB9 57%, #00BFA8 72%, #9fd9c8 90%)'
export const PAGE_CARD_SHADOW = '0 8px 32px rgba(80,50,10,0.18)'
export const PAGE_CARD_RADIUS = 10
