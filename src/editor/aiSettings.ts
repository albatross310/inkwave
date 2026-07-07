// AI privacy opt-ins — both OFF by default. Features that send content through our server to
// Anthropic (snapshot summaries; URL citation lookup + PDF page-number detection) are gated here
// so nothing leaves the device until the writer explicitly switches them on. The one-time consent
// dialog (AiConsentDialog) is shown on the first off→on transition; after a "yes" the consent is
// remembered and later toggles are silent.

const SUMMARIES_KEY = 'inkwave:aiSummaries'
const URL_LOOKUP_KEY = 'inkwave:aiUrlLookup'
const CONSENT_PREFIX = 'inkwave:aiConsent:'

export type AiFeature = 'summaries' | 'url'

function flag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function store(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new Event('inkwave:ai-settings-changed'))
}

// Snapshot / paragraph / version summaries (Anthropic via /api/summarise)
export function aiSummariesEnabled(): boolean { return flag(SUMMARIES_KEY) }
export function setAiSummaries(on: boolean): void { store(SUMMARIES_KEY, on) }

// URL citation lookup + re-verify + PDF page-offset detection (Anthropic via /api/summarise)
export function urlLookupEnabled(): boolean { return flag(URL_LOOKUP_KEY) }
export function setUrlLookup(on: boolean): void { store(URL_LOOKUP_KEY, on) }

// One-time consent memory — after the first "yes" the dialog isn't shown again.
export function aiConsentGiven(feature: AiFeature): boolean { return flag(CONSENT_PREFIX + feature) }
export function markAiConsent(feature: AiFeature): void {
  try { localStorage.setItem(CONSENT_PREFIX + feature, '1') } catch { /* private mode */ }
}
