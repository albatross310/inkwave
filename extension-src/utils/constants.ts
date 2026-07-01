// Single place for origin constants — centralised so a Safari port changes one file.
export const INKWAVE_ORIGINS = ['https://inkwave.me', 'http://localhost:5173'] as const
export const INKWAVE_URL_PATTERNS = INKWAVE_ORIGINS.map(o => `${o}/*`)
export const QUEUE_KEY = 'inkwave:citeQueue'
export const MAILTO = 'hello@inkwave.me'
