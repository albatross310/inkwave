// Whether the editor shows GAPPED pages (separate A4 sheets with whitespace gaps + page numbers,
// like a word processor) vs the continuous scroll with faint page-guide lines. Opt-in, persisted.
// Read by the pagination extension and the Scroll page guides; toggled from the ⋮ menu (reloads).
const KEY = 'inkwave:gappedPages'

export function gappedPagesEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setGappedPages(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
}
