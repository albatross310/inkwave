// View settings that travel WITH the document (persisted in the .studio bundle, not just localStorage),
// so opening a doc restores how it was set up: theme, gapped pages, paper/margins, zoom, etc. These are
// portability extras — NOT part of any provenance hash (added to the bundle like `bibliography`).

import { applyTheme } from './theme'

// Whitelist of document-display settings to carry in the file. Deliberately excludes UI-only prefs
// (dismissed banners, sort order, auth, debug flags) which shouldn't override the reader's environment.
const KEYS = [
  'inkwave:theme',
  'inkwave:gappedPages',
  'inkwave:orientation',
  'inkwave:paperSize',
  'inkwave:topMargin',
  'inkwave:btmMargin',
  'inkwave:sideMargin',
  'inkwave:columns',
  'inkwave:paraSpacing',
  'inkwave:crossout',
  'inkwave:watermark',
  'inkwave:slot-time-mode',
  'inkwave:editorZoom',
  'inkwave:pdfNoteSize',
  'inkwave:snapLineMode',
  // Dismissed info bars travel with the doc too (Peter, 2026-07-10).
  'inkwave:citeExtDismissed',
  'inkwave:citeHelpDismissed',
]

export type ViewSettings = Record<string, string>

/** Snapshot the current view settings (for writing into the bundle on save). */
export function collectViewSettings(): ViewSettings {
  const out: ViewSettings = {}
  try {
    for (const k of KEYS) { const v = localStorage.getItem(k); if (v != null) out[k] = v }
  } catch { /* private mode */ }
  return out
}

/** Restore view settings from a bundle on open, then re-apply them live (theme + page layout). */
export function applyViewSettings(s?: ViewSettings | null): void {
  if (!s || typeof s !== 'object') return
  try {
    for (const k of KEYS) { if (typeof s[k] === 'string') localStorage.setItem(k, s[k]) }
  } catch { /* private mode */ }
  applyTheme() // <html data-theme>
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('inkwave:page-settings-changed')) // paper / margins / gapped / columns
    window.dispatchEvent(new Event('inkwave:scas-display-changed'))
  }
}
