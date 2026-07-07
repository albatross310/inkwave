// Whether the editor shows GAPPED pages (separate A4 sheets with whitespace gaps + page numbers,
// like a word processor) vs the continuous scroll with faint page-guide lines. Opt-in, persisted.
// Read by the pagination extension and the Scroll page guides; toggled from the ⋮ menu (reloads).
const KEY = 'inkwave:gappedPages'

export function gappedPagesEnabled(): boolean {
  // Default ON for new users (no stored preference); an explicit '0' keeps it off.
  try { const v = localStorage.getItem(KEY); return v === null ? true : v === '1' } catch { return true }
}

export function setGappedPages(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
}
