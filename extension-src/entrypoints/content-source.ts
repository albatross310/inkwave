// Content script injected programmatically into the source page on popup open (via scripting API).
// Listens for highlight/clear messages from the popup (relayed through the background).
// Uses the CSS Custom Highlight API — no DOM mutation. Degrades silently on no-match or API absence.
// Injects a ::highlight(inkwave-source) CSS rule so the highlight is styled.

import { highlightQuote, clearHighlight } from '../utils/textHighlight'

export default defineContentScript({
  // Programmatically injected by the popup — no static matches.
  matches: [],
  runAt: 'document_idle',
  main() {
    injectHighlightStyle()

    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; quote?: string } | null
      if (!m) return
      if (m.type === 'inkwave:highlight' && m.quote) {
        highlightQuote(m.quote)
      } else if (m.type === 'inkwave:clearHighlight') {
        clearHighlight()
      }
    })
  },
})

function injectHighlightStyle(): void {
  if (document.getElementById('inkwave-highlight-style')) return
  const style = document.createElement('style')
  style.id = 'inkwave-highlight-style'
  style.textContent = `
    ::highlight(inkwave-source) {
      background-color: rgba(92, 45, 138, 0.25);
      color: inherit;
      border-radius: 2px;
    }
  `
  document.head?.appendChild(style)
}
