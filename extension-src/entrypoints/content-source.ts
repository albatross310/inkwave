// Content script injected programmatically into the source page on popup open (via scripting API).
// Listens for highlight/clear messages from the popup (relayed through the background).
// Also shows a capture-verification panel after an AI scrape (not shown for DOI/identifier captures).
// Uses the CSS Custom Highlight API — no DOM mutation. Degrades silently on no-match or API absence.

import { highlightQuote, clearHighlight } from '../utils/textHighlight'
import type { CaptureMsg } from './background'

type FieldEntry = { value?: string; quote?: string | null }

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', author: 'Author', date: 'Date', year: 'Year',
  publisher: 'Publisher', URL: 'URL', 'container-title': 'Source',
  volume: 'Volume', issue: 'Issue', page: 'Pages', DOI: 'DOI',
}

export default defineContentScript({
  // Programmatically injected by the popup — no static matches.
  matches: [],
  runAt: 'document_idle',
  main() {
    injectStyles()

    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; quote?: string; capture?: CaptureMsg } | null
      if (!m) return
      if (m.type === 'inkwave:highlight' && m.quote) {
        highlightQuote(m.quote)
      } else if (m.type === 'inkwave:clearHighlight') {
        clearHighlight()
      } else if (m.type === 'inkwave:showCapture' && m.capture) {
        showCapturePanel(m.capture)
      }
    })
  },
})

function showCapturePanel(capture: CaptureMsg) {
  document.getElementById('inkwave-capture-panel')?.remove()

  const panel = document.createElement('div')
  panel.id = 'inkwave-capture-panel'
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-label', 'Inkwave citation captured')

  const fields = Object.entries(capture.fields).filter(([, f]) => f.value)
  const hasQuotes = fields.some(([, f]) => f.quote)
  const missing = capture.missingLabels ?? []
  const isLowConf = capture.confidence === 'low'
  const typeLabel = capture.typeLabel ?? capture.itemType ?? 'Webpage'

  panel.innerHTML = `
    <div class="iwcp-header">
      <div class="iwcp-header-top">
        <span class="iwcp-logo">Inkwave</span>
        <button class="iwcp-close" aria-label="Dismiss">×</button>
      </div>
      <div class="iwcp-type-row">
        <span class="iwcp-type-badge">${esc(typeLabel)}</span>
        ${isLowConf ? '<span class="iwcp-conf-warn">Low confidence</span>' : ''}
      </div>
      <span class="iwcp-title">${esc(capture.title ?? 'Citation captured')}</span>
    </div>
    <ul class="iwcp-fields">
      ${fields.map(([key, f]) => {
        const label = FIELD_LABELS[key] ?? key
        const hasQuote = !!f.quote
        return `<li class="iwcp-field${hasQuote ? ' iwcp-has-quote' : ''}"
                    data-quote="${esc(f.quote ?? '')}"
                    tabindex="${hasQuote ? '0' : '-1'}"
                    role="${hasQuote ? 'button' : 'listitem'}"
                    aria-label="${esc(label)}: ${esc(f.value ?? '')}${hasQuote ? ' — hover to verify' : ''}">
          <span class="iwcp-check">${hasQuote ? '✓' : '○'}</span>
          <span class="iwcp-label">${esc(label)}</span>
          <span class="iwcp-value">${esc(f.value ?? '')}</span>
        </li>`
      }).join('')}
    </ul>
    ${missing.length > 0 ? `
    <div class="iwcp-warnings">
      <span class="iwcp-warn-icon">⚠</span>
      <span>Missing for this type: ${esc(missing.join(', '))}. Edit in Inkwave before citing.</span>
    </div>` : ''}
    ${hasQuotes ? '<p class="iwcp-hint">Hover a ✓ field to verify it on the page</p>' : ''}
  `

  panel.querySelectorAll<HTMLElement>('.iwcp-has-quote').forEach(el => {
    const quote = el.dataset.quote ?? ''
    el.addEventListener('mouseenter', () => highlightQuote(quote))
    el.addEventListener('focus',      () => highlightQuote(quote))
    el.addEventListener('mouseleave', () => clearHighlight())
    el.addEventListener('blur',       () => clearHighlight())
  })

  panel.querySelector('.iwcp-close')?.addEventListener('click', () => {
    panel.remove()
    clearHighlight()
  })

  document.body.appendChild(panel)

  // Auto-dismiss after 15 seconds.
  setTimeout(() => { panel.classList.add('iwcp-fade'); setTimeout(() => panel.remove(), 400) }, 15000)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function injectStyles(): void {
  if (document.getElementById('inkwave-styles')) return
  const style = document.createElement('style')
  style.id = 'inkwave-styles'
  style.textContent = `
    ::highlight(inkwave-source) {
      background-color: rgba(92, 45, 138, 0.25);
      color: inherit;
    }
    #inkwave-capture-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      width: 300px;
      background: #fbf5ec;
      border: 1px solid rgba(92,45,138,0.35);
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.14);
      font-family: Georgia, serif;
      font-size: 12px;
      color: #3a3a3a;
      transition: opacity 0.4s;
    }
    #inkwave-capture-panel.iwcp-fade { opacity: 0; }
    .iwcp-header {
      padding: 9px 12px 8px;
      border-bottom: 1px solid rgba(92,45,138,0.12);
    }
    .iwcp-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 5px;
    }
    .iwcp-logo {
      font-size: 10px;
      color: #9b5ccc;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .iwcp-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #9b8fa8;
      font-size: 16px;
      line-height: 1;
      padding: 0;
    }
    .iwcp-close:hover { color: #5c2d8a; }
    .iwcp-type-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .iwcp-type-badge {
      font-size: 9px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(92,45,138,0.1);
      color: #5c2d8a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .iwcp-conf-warn {
      font-size: 9px;
      color: #b45309;
      background: #fef3c7;
      padding: 1px 5px;
      border-radius: 10px;
    }
    .iwcp-title {
      display: block;
      font-size: 11px;
      color: #3a3a3a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .iwcp-fields {
      list-style: none;
      margin: 0;
      padding: 6px 0;
    }
    .iwcp-field {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 4px 12px;
      cursor: default;
      transition: background 0.15s;
      outline: none;
    }
    .iwcp-has-quote { cursor: pointer; }
    .iwcp-has-quote:hover, .iwcp-has-quote:focus {
      background: rgba(92,45,138,0.07);
      border-radius: 6px;
    }
    .iwcp-check { font-size: 10px; color: #9b5ccc; flex-shrink: 0; width: 12px; }
    .iwcp-field:not(.iwcp-has-quote) .iwcp-check { color: #c4b5d4; }
    .iwcp-label {
      font-size: 9px;
      color: #9b5ccc;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      flex-shrink: 0;
      width: 58px;
    }
    .iwcp-value {
      font-size: 11px;
      color: #3a3a3a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .iwcp-warnings {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      margin: 0 12px 8px;
      padding: 6px 8px;
      background: #fef3c7;
      border-radius: 6px;
      font-size: 10px;
      color: #92400e;
      line-height: 1.4;
    }
    .iwcp-warn-icon { flex-shrink: 0; }
    .iwcp-hint {
      margin: 0;
      padding: 5px 12px 8px;
      font-size: 9px;
      color: #9b8fa8;
      border-top: 1px solid rgba(92,45,138,0.08);
    }
  `
  document.head?.appendChild(style)
}
