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
  'event-title': 'Conference', genre: 'Degree type', edition: 'Edition',
  accessed: 'Date accessed', number: 'Report no.',
}

const FIELD_PLACEHOLDERS: Record<string, string> = {
  author: 'Given Family; Given2 Family2',
  year: 'YYYY',
  volume: 'e.g. 12',
  page: 'e.g. 123–145',
  'container-title': 'Journal / publication name',
  publisher: 'Publisher / institution',
  'event-title': 'Conference name',
  genre: 'PhD thesis, Masters dissertation…',
  accessed: 'YYYY-MM-DD',
  DOI: '10.xxxx/…',
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

// normNode: normalises a single text node without trimming — preserving the trailing
// space in "Tyler " so cross-element names like "Tyler Graham" are found when the
// first name and surname are in separate inline elements.
function normNode(s: string): string {
  return s.normalize('NFC')
    .replace(/[   ]/g, ' ')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
  // no .trim() here: trimming strips trailing spaces from nodes, breaking cross-element name matching
}

// Walk visible text nodes and return true if `needle` is found (normalised).
// normText: needle normalizer — same as normNode but trims outer whitespace.
function normText(s: string): string { return normNode(s).trim() }

// Walk visible text nodes. Uses normNode (no trim) per-node so cross-element
// author names don't lose the space between them.
function existsOnPage(needle: string): boolean {
  if (!needle || needle.length < 3) return false
  const normed = normText(needle)
  if (!normed) return false
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let flat = ''
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement
    if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue
    flat += normNode(node.textContent ?? '')
    if (flat.includes(normed)) return true
  }
  return false
}

// For date values the AI returns ISO format (2017-08-28) but pages show
// "August 28, 2017" etc. Try several common renderings before giving up.
function dateSearchCandidates(value: string): string[] {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return [value]
  const [, y, mo, d] = m
  try {
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    return [
      value,
      dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long',  day: 'numeric' }), // August 28, 2017
      dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), // Aug 28, 2017
      `${Number(d)} ${dt.toLocaleDateString('en-US', { month: 'long' })} ${Number(y)}`,    // 28 August 2017
      `${Number(d)} ${dt.toLocaleDateString('en-US', { month: 'short' })} ${Number(y)}`,   // 28 Aug 2017
      `${dt.toLocaleDateString('en-US', { month: 'long' })} ${Number(d)}`,                 // August 28
      y,                                                                                    // 2017 (year alone)
    ]
  } catch { return [value] }
}

// Find the publisher's logo element on the page: prefers a real img in the header/nav
// (so hover can outline it), falls back to link[rel="icon"] tags.
function findPublisherLogo(): { el: HTMLImageElement | null; url: string } {
  const containers = [
    document.querySelector('header'),
    document.querySelector('[role="banner"]'),
    document.querySelector('nav'),
    document.querySelector('[class*="header"]'),
    document.querySelector('[id*="header"]'),
  ].filter(Boolean) as Element[]
  for (const c of containers) {
    const imgs = Array.from(c.querySelectorAll('img')) as HTMLImageElement[]
    const logo: HTMLImageElement | undefined =
      imgs.find(img => /logo/i.test([img.className, img.id, img.alt ?? '', img.src].join(' ')))
      ?? (imgs.length === 1 && imgs[0].width > 20 ? imgs[0] : undefined)
    if (logo?.src) return { el: logo, url: logo.src }
  }
  for (const sel of ['link[rel="apple-touch-icon"]', 'link[rel="icon"][type="image/png"]', 'link[rel="icon"][sizes="32x32"]', 'link[rel="icon"]', 'link[rel="shortcut icon"]']) {
    const el = document.querySelector(sel) as HTMLLinkElement | null
    if (el?.href && !el.href.startsWith('data:')) return { el: null, url: el.href }
  }
  return { el: null, url: `${window.location.origin}/favicon.ico` }
}

function showCapturePanel(capture: CaptureMsg) {
  document.getElementById('inkwave-capture-panel')?.remove()

  const panel = document.createElement('div')
  panel.id = 'inkwave-capture-panel'
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-label', 'Inkwave citation captured')

  // Determine verifiability for each field.
  // AI quotes are validated against visible DOM — AI often "quotes" from JSON-LD/meta tags.
  // Unquoted or invalidated fields fall back to auto-search; dates try multiple formats.
  const verifySource = new Map<string, 'ai' | 'auto'>()
  const verifyQuote  = new Map<string, string>()
  for (const [key, f] of Object.entries(capture.fields)) {
    if (!f.value) continue
    if (f.quote && existsOnPage(f.quote)) {
      verifySource.set(key, 'ai');  verifyQuote.set(key, f.quote)
    } else {
      const candidates = (key === 'date' || key === 'accessed')
        ? dateSearchCandidates(f.value) : [f.value]
      const found = candidates.find(existsOnPage)
      if (found) { verifySource.set(key, 'auto');  verifyQuote.set(key, found) }
    }
  }

  const fields = Object.entries(capture.fields).filter(([, f]) => f.value)
  const hasVerifiable = fields.some(([key]) => verifySource.has(key))
  const missing = capture.missingLabels ?? []
  const isLowConf = capture.confidence === 'low'
  const typeLabel = capture.typeLabel ?? capture.itemType ?? 'Webpage'

  // Find the publisher logo: real img element on the page (for hover-outline) or icon link.
  const pubLogo = findPublisherLogo()

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
        const label     = FIELD_LABELS[key] ?? key
        const src       = verifySource.get(key)
        const aiVerified = src === 'ai'
        const autoFound  = src === 'auto'
        const quoteAttr  = verifyQuote.get(key) ?? ''
        const cls    = aiVerified ? ' iwcp-has-quote' : autoFound ? ' iwcp-auto-found' : ''
        const symbol = aiVerified ? '✓' : autoFound ? '◎' : '○'
        const role   = (aiVerified || autoFound) ? 'button' : 'listitem'
        return `<li class="iwcp-field${cls}"
                    data-quote="${esc(quoteAttr)}"
                    data-field-key="${esc(key)}"
                    tabindex="${(aiVerified || autoFound) || key === 'publisher' ? '0' : '-1'}"
                    role="${(aiVerified || autoFound) || key === 'publisher' ? 'button' : 'listitem'}"
                    aria-label="${esc(label)}: ${esc(f.value ?? '')}${autoFound ? ' — click to confirm' : aiVerified ? ' — hover to verify' : key === 'publisher' ? ' — hover to see logo' : ''}">
          <span class="iwcp-check">${symbol}</span>
          <span class="iwcp-label">${esc(label)}</span>
          <span class="iwcp-value">${key === 'publisher' && pubLogo.url ? `<img src="${esc(pubLogo.url)}" style="width:13px;height:13px;border-radius:2px;object-fit:contain;vertical-align:middle;margin-right:4px" onerror="this.style.display='none'" />` : ''}${esc(f.value ?? '')}</span>
        </li>`
      }).join('')}
    </ul>
    ${missing.length > 0 ? `
    <div class="iwcp-warnings">
      <span class="iwcp-warn-icon">⚠</span>
      <span>Missing for this type: ${esc(missing.join(', '))}</span>
    </div>
    <form class="iwcp-fill" id="iwcp-fill">
      ${(capture.missingRequired ?? []).map(key => `
        <label class="iwcp-fill-row">
          <span class="iwcp-fill-label">${esc(FIELD_LABELS[key] ?? key)}</span>
          <input class="iwcp-fill-input" name="${esc(key)}" placeholder="${esc(FIELD_PLACEHOLDERS[key] ?? '')}" autocomplete="off"
            style="all:unset;box-sizing:border-box;display:block;width:100%;font-size:11px;font-family:Georgia,serif;border:1px solid rgba(92,45,138,0.25);border-radius:5px;padding:3px 7px;background:#fff;color:#3a3a3a" />
        </label>`).join('')}
      <div class="iwcp-fill-footer">
        <button type="submit" class="iwcp-fill-save"
          style="all:unset;box-sizing:border-box;display:inline-block;margin:0;padding:3px 10px;background:#5c2d8a;color:#fff;border-radius:5px;font-size:10px;font-family:Georgia,serif;cursor:pointer;line-height:1.5;white-space:nowrap">Save to library</button>
        <span class="iwcp-fill-status" id="iwcp-fill-status"></span>
      </div>
    </form>` : ''}
    ${hasVerifiable ? '<p class="iwcp-hint">Hover ✓ or ◎ to see the match · click ◎ to confirm</p>' : ''}
  `

  panel.querySelectorAll<HTMLElement>('.iwcp-has-quote').forEach(el => {
    const quote = el.dataset.quote ?? ''
    el.addEventListener('mouseenter', () => highlightQuote(quote))
    el.addEventListener('focus',      () => highlightQuote(quote))
    el.addEventListener('mouseleave', () => clearHighlight())
    el.addEventListener('blur',       () => clearHighlight())
  })

  // Auto-found (◎): hover highlights, click confirms → upgrades to ✓.
  panel.querySelectorAll<HTMLElement>('.iwcp-auto-found').forEach(el => {
    const quote = el.dataset.quote ?? ''
    el.addEventListener('mouseenter', () => highlightQuote(quote))
    el.addEventListener('focus',      () => highlightQuote(quote))
    el.addEventListener('mouseleave', () => clearHighlight())
    el.addEventListener('blur',       () => clearHighlight())
    el.addEventListener('click', () => {
      el.classList.remove('iwcp-auto-found')
      el.classList.add('iwcp-has-quote')
      const check = el.querySelector('.iwcp-check')
      if (check) check.textContent = '✓'
      el.setAttribute('aria-label', (el.getAttribute('aria-label') ?? '').replace('click to confirm match', 'hover to verify'))
    })
  })

  panel.querySelector('.iwcp-close')?.addEventListener('click', () => {
    panel.remove()
    clearHighlight()
    if (pubLogo.el) { pubLogo.el.style.outline = ''; pubLogo.el.style.outlineOffset = ''; pubLogo.el.style.borderRadius = '' }
  })

  // Fill-in form submit.
  panel.querySelector<HTMLFormElement>('#iwcp-fill')?.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const data = new FormData(form)
    const updates: Record<string, string> = {}
    data.forEach((val, key) => { if (String(val).trim()) updates[key] = String(val).trim() })
    if (!Object.keys(updates).length) return
    const statusEl = panel.querySelector<HTMLElement>('#iwcp-fill-status')
    const saveBtn = form.querySelector<HTMLButtonElement>('.iwcp-fill-save')
    if (saveBtn) saveBtn.disabled = true
    try {
      const result = await browser.runtime.sendMessage({
        type: 'inkwave:updateCaptureFields',
        id: capture.id,
        updates,
      }) as { ok?: boolean }
      if (statusEl) {
        statusEl.textContent = result?.ok ? '✓ Saved' : '✗ Not found in queue'
        statusEl.style.color = result?.ok ? '#15803d' : '#b91c1c'
      }
      if (saveBtn) saveBtn.disabled = false
      if (result?.ok) {
        // Move each saved field from the form into the ✓/◎/○ field list.
        const fieldsList = panel.querySelector<HTMLElement>('.iwcp-fields')
        for (const [key, value] of Object.entries(updates)) {
          // Remove the input row.
          form.querySelector<HTMLElement>(`[name="${CSS.escape(key)}"]`)?.closest<HTMLElement>('.iwcp-fill-row')?.remove()
          if (!fieldsList) continue
          const label = FIELD_LABELS[key] ?? key
          const range = findTextInPage(value)
          const cls = range ? ' iwcp-auto-found' : ''
          const symbol = range ? '◎' : '○'
          const li = document.createElement('li')
          li.className = `iwcp-field${cls}`
          li.setAttribute('data-quote', range ? value : '')
          li.setAttribute('tabindex', range ? '0' : '-1')
          li.setAttribute('role', range ? 'button' : 'listitem')
          li.innerHTML = `<span class="iwcp-check">${symbol}</span><span class="iwcp-label">${esc(label)}</span><span class="iwcp-value">${esc(value)}</span>`
          if (range) {
            li.addEventListener('mouseenter', () => highlightQuote(value))
            li.addEventListener('focus',      () => highlightQuote(value))
            li.addEventListener('mouseleave', clearHighlight)
            li.addEventListener('blur',       clearHighlight)
            li.addEventListener('click', () => {
              li.classList.remove('iwcp-auto-found')
              li.classList.add('iwcp-has-quote')
              li.querySelector('.iwcp-check')!.textContent = '✓'
            })
          }
          fieldsList.appendChild(li)
        }
        // If all inputs are gone hide the warnings + form.
        if (!form.querySelector('.iwcp-fill-row')) {
          panel.querySelector('.iwcp-warnings')?.remove()
          form.style.display = 'none'
        }
        // Show the hint if there are now hoverable fields.
        const hintEl = panel.querySelector('.iwcp-hint')
        const hasHoverable = !!panel.querySelector('.iwcp-has-quote, .iwcp-auto-found')
        if (hintEl) hintEl.style.display = hasHoverable ? '' : 'none'
        else if (hasHoverable) {
          const p = document.createElement('p')
          p.className = 'iwcp-hint'
          p.textContent = 'Hover ✓ or ◎ to see the match · click ◎ to confirm'
          panel.appendChild(p)
        }
        setTimeout(() => { if (statusEl) statusEl.textContent = '' }, 2000)
      }
    } catch {
      if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.style.color = '#b91c1c' }
      if (saveBtn) saveBtn.disabled = false
    }
  })

  // Publisher field: hover outlines the real logo element on the page.
  const pubLi = panel.querySelector<HTMLElement>('[data-field-key="publisher"]')
  if (pubLi && pubLogo.el) {
    const logoEl = pubLogo.el
    pubLi.style.cursor = 'pointer'
    pubLi.addEventListener('mouseenter', () => {
      logoEl.style.outline = '3px solid rgba(92,45,138,0.7)'
      logoEl.style.outlineOffset = '3px'
      logoEl.style.borderRadius = '4px'
      logoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    pubLi.addEventListener('mouseleave', () => {
      logoEl.style.outline = ''
      logoEl.style.outlineOffset = ''
      logoEl.style.borderRadius = ''
    })
    pubLi.addEventListener('focus', () => {
      logoEl.style.outline = '3px solid rgba(92,45,138,0.7)'
      logoEl.style.outlineOffset = '3px'
    })
    pubLi.addEventListener('blur', () => {
      logoEl.style.outline = ''
      logoEl.style.outlineOffset = ''
    })
  }

  // Draggable panel: mousedown on header drags by top/left.
  const panelHeader = panel.querySelector<HTMLElement>('.iwcp-header')
  if (panelHeader) {
    panelHeader.style.cursor = 'move'
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      panel.style.left = `${origLeft + e.clientX - startX}px`
      panel.style.top  = `${origTop  + e.clientY - startY}px`
    }
    const onUp = () => { dragging = false }
    panelHeader.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.iwcp-close')) return
      const r = panel.getBoundingClientRect()
      panel.style.bottom = 'auto'; panel.style.right = 'auto'
      panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`
      origLeft = r.left; origTop = r.top
      startX = e.clientX; startY = e.clientY
      dragging = true
      e.preventDefault()
    })
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    panel.querySelector('.iwcp-close')?.addEventListener('click', () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }, { once: true })
  }

  document.body.appendChild(panel)
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
    .iwcp-auto-found { cursor: pointer; }
    .iwcp-auto-found:hover, .iwcp-auto-found:focus {
      background: rgba(180,83,9,0.06);
      border-radius: 6px;
    }
    .iwcp-check { font-size: 10px; color: #9b5ccc; flex-shrink: 0; width: 12px; }
    .iwcp-field:not(.iwcp-has-quote):not(.iwcp-auto-found) .iwcp-check { color: #c4b5d4; }
    .iwcp-auto-found .iwcp-check { color: #b45309; }
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
    .iwcp-fill {
      padding: 6px 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      border-top: 1px solid rgba(92,45,138,0.08);
    }
    .iwcp-fill-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .iwcp-fill-label {
      font-size: 9px;
      color: #9b5ccc;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .iwcp-fill-input {
      font-size: 11px;
      font-family: Georgia, serif;
      border: 1px solid rgba(92,45,138,0.25);
      border-radius: 5px;
      padding: 3px 7px;
      background: #fff;
      color: #3a3a3a;
      outline: none;
      width: 100%;
    }
    .iwcp-fill-input:focus { border-color: #5c2d8a; }
    .iwcp-fill-footer {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 3px 0 0 0;
      padding: 0;
    }
    .iwcp-fill-save {
      display: inline-block;
      margin: 0;
      padding: 3px 9px;
      background: #5c2d8a;
      color: #fff;
      border: none;
      border-radius: 5px;
      font-size: 10px;
      font-family: Georgia, serif;
      cursor: pointer;
      line-height: 1.4;
    }
    .iwcp-fill-save:disabled { opacity: 0.5; cursor: default; }
    .iwcp-fill-save:hover:not(:disabled) { background: #4a2270; }
    .iwcp-fill-status { font-size: 10px; margin: 0; }
  `
  document.head?.appendChild(style)
}
