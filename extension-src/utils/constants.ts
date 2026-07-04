// Single place for origin constants — centralised so a Safari port changes one file.
export const INKWAVE_ORIGINS = ['https://inkwave.studio', 'http://localhost:5173'] as const
export const INKWAVE_URL_PATTERNS = INKWAVE_ORIGINS.map(o => `${o}/*`)
export const QUEUE_KEY = 'inkwave:citeQueue'
// Temporary watch list: when app opens a source URL we store the capture data here
// so tabs.onUpdated can show the panel even after the item has been flushed from the queue.
export const WATCH_KEY = 'inkwave:panelWatch'
// Persists captured URL + basic metadata even after queue flush, so the popup can
// show "Already in library" when the user revisits the source page.
export const HISTORY_KEY = 'inkwave:captureHistory'
export const MAILTO = 'hello@inkwave.studio'
