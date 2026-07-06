// Night mode — a dark theme for the writing surface (Peter's spec: black background, grey-on-black
// waves, charcoal paper, very-light-blue text, light purple/green highlights). Driven by a single
// data-theme attribute on <html>; all the actual colours live in the `:root[data-theme="night"]`
// block in index.css so the theme is one CSS switch, not scattered inline overrides.

const KEY = 'inkwave:theme'

export function nightModeEnabled(): boolean {
  try { return localStorage.getItem(KEY) === 'night' } catch { return false }
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = nightModeEnabled() ? 'night' : 'day'
}

export function setNightMode(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'night' : 'day') } catch { /* private mode */ }
  applyTheme()
}
