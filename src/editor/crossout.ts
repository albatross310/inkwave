// Cross-out display for SCAS memory slots: how a substituted word's ORIGINAL is shown.
//   'stacked' (default) — struck-through just beneath the new word (uses the airy line-gap)
//   'inline'            — struck-through trailing the new word on the same line
//   'off'               — hidden (the word still keeps its purple)
// Persisted in localStorage and applied as data-crossout on the document root, so switching is pure
// CSS (no reload) — the variants live in index.css.
export type CrossoutMode = 'stacked' | 'inline' | 'off'

const KEY = 'inkwave:crossout'
export const CROSSOUT_MODES: CrossoutMode[] = ['stacked', 'inline', 'off']

export function crossoutMode(): CrossoutMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'inline' || v === 'off') return v
  } catch { /* private mode */ }
  return 'stacked'
}

export function setCrossoutMode(mode: CrossoutMode): void {
  try { localStorage.setItem(KEY, mode) } catch { /* private mode */ }
  applyCrossoutMode()
}

/** Cycle stacked → inline → off → stacked and return the new mode. */
export function cycleCrossoutMode(): CrossoutMode {
  const next = CROSSOUT_MODES[(CROSSOUT_MODES.indexOf(crossoutMode()) + 1) % CROSSOUT_MODES.length]
  setCrossoutMode(next)
  return next
}

/** Mirror the stored mode onto the document root (call on editor mount + after a change). */
export function applyCrossoutMode(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.crossout = crossoutMode()
}
