export const OPEN_CITATION_PANEL_EVENT = 'inkwave:open-citation-panel'

export function openCitationPanel(options: { newReference?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent(OPEN_CITATION_PANEL_EVENT, { detail: options }))
}
