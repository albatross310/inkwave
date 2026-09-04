// SCAS suggestions are opt-in. Keep the shipped inverse key so existing explicit choices survive:
//   '0' = suggestions on, '1' = suggestions off, absent = the new default (off).
// This controls only the visible suggestions; the provenance engine continues to remember words.
export const SCAS_DISPLAY_KEY = 'inkwave:scasOff'

export function scasSuggestionsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(SCAS_DISPLAY_KEY) === '0' } catch { return false }
}

export function setScasSuggestionsEnabled(on: boolean): void {
  try { window.localStorage.setItem(SCAS_DISPLAY_KEY, on ? '0' : '1') } catch { /* private mode */ }
}
