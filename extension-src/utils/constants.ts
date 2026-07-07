// Single place for origin constants — centralised so a Safari port changes one file.
// iwzero.me is the canonical app domain; inkwave.studio 301-redirects there but stays listed so
// the bridge keeps working if the alias ever serves directly again.
export const INKWAVE_ORIGINS = ['https://iwzero.me', 'https://inkwave.studio', 'http://localhost:5173'] as const
export const INKWAVE_URL_PATTERNS = INKWAVE_ORIGINS.map(o => `${o}/*`)
export const QUEUE_KEY = 'inkwave:citeQueue'
// Temporary watch list: when app opens a source URL we store the capture data here
// so tabs.onUpdated can show the panel even after the item has been flushed from the queue.
export const WATCH_KEY = 'inkwave:panelWatch'
// Short-lived capture history: keeps captured URL + basic metadata briefly after queue flush, so
// the popup can show "Already in library" / "Show on page" right after a capture. Privacy: entries
// EXPIRE after HISTORY_TTL_MS — the extension keeps no lasting record of pages you captured.
export const HISTORY_KEY = 'inkwave:captureHistory'
export const HISTORY_TTL_MS = 5 * 60 * 1000
export const MAILTO = 'hello@inkwave.studio'
