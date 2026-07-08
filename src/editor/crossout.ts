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
    if (v === 'inline' || v === 'stacked') return v
  } catch { /* private mode */ }
  return 'off' // default OFF (Peter, 2026-07-08); stored 'inline'/'stacked' keep their choice
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

// The tea-stain watermark (egg behind the crossed-out word) on/off — independent of the cross-out
// mode. Applied as data-egg on the document root; pure CSS.
const EGG_KEY = 'inkwave:watermark'

export function watermarkEnabled(): boolean {
  try { return localStorage.getItem(EGG_KEY) === '1' } catch { return false }  // default OFF (Peter, 2026-07-08)
}

export function setWatermark(on: boolean): void {
  try { localStorage.setItem(EGG_KEY, on ? '1' : '0') } catch { /* private mode */ }
  applyCrossoutMode()
}

/** Mirror the stored mode + watermark onto the document root (call on editor mount + after a change). */
export function applyCrossoutMode(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.crossout = crossoutMode()
  document.documentElement.dataset.egg = watermarkEnabled() ? 'on' : 'off'
}

// ── Slot-time display mode ────────────────────────────────────────────────────────
// Controls what the grey stamp above purple words shows: the time it was written ('time')
// or the date (day of month, 'date'). Toggled from settings; integrated with the Old Word panel.
const TIME_MODE_KEY = 'inkwave:slot-time-mode'

export function slotTimeMode(): 'time' | 'date' {
  try { return localStorage.getItem(TIME_MODE_KEY) === 'date' ? 'date' : 'time' } catch { return 'time' }
}

export function setSlotTimeMode(mode: 'time' | 'date'): void {
  try { localStorage.setItem(TIME_MODE_KEY, mode) } catch { /* private mode */ }
}
