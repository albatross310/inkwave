// The place label (Peter, 2026-07-17) — "library", "home", "cafe".
//
// THIS IS NOT GEOLOCATION. There is no `navigator.geolocation` call, no coordinates, no reverse
// geocoding, no permission prompt and no auto-capture anywhere in this layer, by decision. It is a
// word the writer types, in the same class as their diary note. Do not "upgrade" it to real
// location: spec §A3.2 argues against collecting whereabouts by name, and a typed label is what
// serves the actual feature ("where do I work best") anyway — it is what a report quotes back.
//
// A free-text field that reads "library" / "the library" / "Library" serves nothing, so the writer
// gets their recent labels back for one-tap reuse; that — not normalisation-by-force — is what
// keeps the strings consistent enough to group. We store the label as TYPED (trimmed): it's theirs.

import { cleanText } from './sessionLogic'

const CURRENT_KEY = 'inkwave:ledgerPlace'
const RECENTS_KEY = 'inkwave:ledgerPlaces'
const MAX_RECENTS = 8

/** The sticky current place, applied to sessions as they close. Empty = no place recorded at all. */
export function currentPlace(): string | undefined {
  try {
    return cleanText(localStorage.getItem(CURRENT_KEY) ?? undefined, 120)
  } catch {
    return undefined
  }
}

/** Recently-used labels, most recent first — the one-tap reuse list. */
export function recentPlaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENTS) : []
  } catch {
    return []
  }
}

/**
 * Set (or clear, with '') the current place, and remember it for reuse.
 * Recents dedupe case-insensitively so "Library" and "library" don't both accumulate — the writer
 * taps the one they already used and the strings stay groupable.
 */
export function setCurrentPlace(label: string | undefined): void {
  const clean = cleanText(label, 120)
  try {
    if (!clean) {
      localStorage.removeItem(CURRENT_KEY)
      return
    }
    localStorage.setItem(CURRENT_KEY, clean)
    const rest = recentPlaces().filter((p) => p.toLowerCase() !== clean.toLowerCase())
    localStorage.setItem(RECENTS_KEY, JSON.stringify([clean, ...rest].slice(0, MAX_RECENTS)))
  } catch { /* private mode — the label stays session-only */ }
}

/** Drop a label from the reuse list. */
export function forgetPlace(label: string): void {
  try {
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(recentPlaces().filter((p) => p.toLowerCase() !== label.toLowerCase())),
    )
  } catch { /* private mode */ }
}
