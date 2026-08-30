// Content script injected programmatically into the source page on popup open (via scripting API).
// Listens for highlight/clear messages from the popup (relayed through the background).
// Also shows a capture-verification panel after an AI scrape (not shown for DOI/identifier captures).
// Uses the CSS Custom Highlight API — no DOM mutation. Degrades silently on no-match or API absence.

import { highlightQuote, clearHighlight } from '../utils/textHighlight'
// Pure field helpers live in src/ so `pnpm test` can reach them (this directory is outside it).
import {
  normNode, normText, authorCandidates, relativeDateCandidates, dateSearchCandidates,
  escAttr,
} from '@inkwave/reader/sourceFields'
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

// existsOnPage: cascade through four sources to handle SPA shadow DOM, lazy content, etc.
function existsOnPage(needle: string): boolean {
  if (!needle || needle.length < 3) return false
  const normed = normText(needle)
  if (!normed) return false
  try {
    // 1. Browser's visible-text rendering (best for most sites, handles CSS display:none).
    if (normNode(document.body.innerText).includes(normed)) return true
    // 2. textContent: catches CSS-hidden elements innerText skips.
    if (normNode(document.body.textContent ?? '').includes(normed)) return true
    // 3. document.title: catches YouTube video titles even when shadow DOM hides DOM text.
    if (normNode(document.title).includes(normed)) return true
    // 4. Meta tag content: catches dates/authors that live only in meta (YouTube uploadDate, etc.).
    const metaContent = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[content]'))
      .map(m => m.content).join(' ')
    return normNode(metaContent).includes(normed)
  } catch { return false }
}

// Like existsOnPage but ONLY the truly visible, highlightable rendering: document.body.innerText
// (which includes the open-shadow-DOM flattened tree). Crucially it does NOT consult textContent
// (that leaks <script> JSON-LD — e.g. "datePublished":"2026-06-24" — so an ISO date "exists" but
// isn't visible), nor title/meta. A value that passes HERE is guaranteed findable by highlightQuote,
// so it can be safely used as the hover quote.
function existsInVisibleText(needle: string): boolean {
  if (!needle || needle.length < 3) return false
  const normed = normText(needle)
  if (!normed) return false
  try { return normNode(document.body.innerText).includes(normed) } catch { return false }
}

// Count occurrences of `needle` in the visible text (capped). Used to decide whether a value is
// DISTINCTIVE enough to highlight: a book's press ("University of Wales Press") occurs ~once and is a
// meaningful target, but a site brand ("CNET") repeats throughout the body — highlighting the first
// hit lands on a random spot (e.g. deep in an author bio), which is worse than not highlighting.
function countInVisibleText(needle: string): number {
  const normed = normText(needle)
  if (!normed || normed.length < 3) return 0
  try {
    const hay = normNode(document.body.innerText)
    let count = 0, i = 0
    while ((i = hay.indexOf(normed, i)) !== -1 && count < 4) { count++; i += normed.length }
    return count
  } catch { return 0 }
}

// THE PANEL'S DRAG LISTENERS LIVE ON `document`, SO SOMETHING HAS TO OUTLIVE THE PANEL TO CANCEL
// THEM. A WeakMap rather than a module-level slot: the panel is the key, so a stale entry cannot
// abort a NEWER panel's drag, and an entry for a panel nobody holds is collectable on its own.
const panelDrag = new WeakMap<Element, AbortController>()

/** THE ONE WAY THE CAPTURE PANEL GOES AWAY. Both callers used to `remove()` the element directly
 *  and only one of them also cancelled the drag. */
function removeCapturePanel(el: Element | null | undefined): void {
  if (!el) return
  panelDrag.get(el)?.abort()
  panelDrag.delete(el)
  el.remove()
}

function showCapturePanel(capture: CaptureMsg) {
  removeCapturePanel(document.getElementById('inkwave-capture-panel'))

  const panel = document.createElement('div')
  panel.id = 'inkwave-capture-panel'
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-label', 'Inkwave citation captured')

  // Determine verifiability for each field.
  // oEmbed captures (YouTube/Vimeo) are pre-verified by the platform — skip DOM search.
  // AI quotes are validated against visible DOM — AI often "quotes" from JSON-LD/meta tags.
  // Unquoted or invalidated fields fall back to auto-search; dates try multiple formats.
  const isOembed = (capture as CaptureMsg & { source?: string }).source === 'oembed'
  const verifySource = new Map<string, 'ai' | 'auto'>()
  const verifyQuote  = new Map<string, string>()
  for (const [key, f] of Object.entries(capture.fields)) {
    if (!f.value) continue
    // The stored verifyQuote drives hover-highlight. Prefer a form present in VISIBLE text (so hover
    // definitely works). If a value only verifies via meta/title/JSON-LD at build time, still store
    // the VALUE (not '') so hover RE-ATTEMPTS against the live DOM — CNET/YouTube bylines often
    // hydrate after this snapshot; highlightQuote no-ops gracefully if the text truly isn't there.
    const cands = (key === 'date' || key === 'accessed') ? dateSearchCandidates(f.value)
      : key === 'author' ? authorCandidates(f.value)
      : [f.value]
    if (isOembed) {
      // Platform-authoritative. YouTube renders title + channel into the light DOM (highlightable);
      // the date shows only as a RELATIVE string ("13 days ago"), the absolute form hides in a
      // dropdown — so for the date, snap to the relative form if it's on screen.
      if (key === 'date') {
        // The relative date ("2 weeks ago") repeats on every recommended-video card, so highlighting
        // the first hit jumps to a random recommendation. Only snap when a form is DISTINCTIVE
        // (occurs ~once = the main video's metadata); otherwise show the verified date with no jump.
        const found = [...relativeDateCandidates(f.value), f.value].find(c => {
          const n = countInVisibleText(c); return n >= 1 && n <= 2
        })
        verifySource.set(key, 'ai'); verifyQuote.set(key, found ?? '')
      } else if (key === 'publisher') {
        // Publisher is the platform brand ("YouTube"), which appears all over the page (header,
        // footer, every recommendation) → never a useful target. Snap only if it's distinctive.
        const n = countInVisibleText(f.value)
        verifySource.set(key, 'ai'); verifyQuote.set(key, (n >= 1 && n <= 2) ? f.value : '')
      } else {
        // title + channel render distinctively in the light DOM → highlightable.
        verifySource.set(key, 'ai'); verifyQuote.set(key, existsInVisibleText(f.value) ? f.value : '')
      }
    } else if (key === 'publisher') {
      // Publisher: highlight the AI quote if it's on the page, else the value only when it's
      // DISTINCTIVE (occurs ~once — a book's press). A repeated site brand ("CNET") gets a verified
      // badge but no hover target, so it never snaps to a random body-text occurrence.
      const n = countInVisibleText(f.value)
      if (f.quote && existsInVisibleText(f.quote)) { verifySource.set(key, 'ai'); verifyQuote.set(key, f.quote) }
      else if (n >= 1 && n <= 2) { verifySource.set(key, 'auto'); verifyQuote.set(key, f.value) }
      else if (n > 0 || existsOnPage(f.value)) { verifySource.set(key, 'auto'); verifyQuote.set(key, '') }
    } else if (f.quote && existsInVisibleText(f.quote)) {
      verifySource.set(key, 'ai');  verifyQuote.set(key, f.quote)          // ✓ highlightable
    } else {
      const inText = cands.find(existsInVisibleText)
      if (inText) {
        verifySource.set(key, 'auto'); verifyQuote.set(key, inText)        // ◎ highlightable
      } else if (f.quote && existsOnPage(f.quote)) {
        verifySource.set(key, 'ai'); verifyQuote.set(key, f.value)        // ✓ verified; hover re-tries the value
      } else if (cands.some(existsOnPage)) {
        verifySource.set(key, 'auto'); verifyQuote.set(key, f.value)      // ◎ verified; hover re-tries the value
      }
    }
  }

  const fields = Object.entries(capture.fields).filter(([, f]) => f.value)
  const hasVerifiable = fields.some(([key]) => verifySource.has(key))
  const missing = capture.missingLabels ?? []
  const isLowConf = capture.confidence === 'low'
  const typeLabel = capture.typeLabel ?? capture.itemType ?? 'Webpage'

  panel.innerHTML = `
    <div class="iwcp-header">
      <div class="iwcp-header-top">
        <span class="iwcp-logo">Inkwave <span style="opacity:0.45;font-size:9px;font-weight:400">v0.1.4</span></span>
        <button class="iwcp-close" aria-label="Dismiss">×</button>
      </div>
      <div class="iwcp-type-row">
        <span class="iwcp-type-badge">${escAttr(typeLabel)}</span>
        ${isLowConf ? '<span class="iwcp-conf-warn">Low confidence</span>' : ''}
      </div>
      <span class="iwcp-title">${escAttr(capture.title ?? 'Citation captured')}</span>
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
                    data-quote="${escAttr(quoteAttr)}"
                    data-field-key="${escAttr(key)}"
                    data-value="${escAttr(f.value ?? '')}"
                    tabindex="${(aiVerified || autoFound) ? '0' : '-1'}"
                    role="${(aiVerified || autoFound) ? 'button' : 'listitem'}"
                    aria-label="${escAttr(label)}: ${escAttr(f.value ?? '')}${autoFound ? ' — click to confirm' : aiVerified ? ' — hover to verify' : ''}">
          <span class="iwcp-check">${symbol}</span>
          <span class="iwcp-label">${escAttr(label)}</span>
          <span class="iwcp-value">${escAttr(f.value ?? '')}</span>
          <button class="iwcp-edit" aria-label="Edit ${escAttr(label)}" title="Edit"
                  style="all:unset;box-sizing:border-box;margin-left:auto;padding:0 4px;cursor:pointer;font-size:11px;opacity:0.4;line-height:1;flex-shrink:0">✎</button>
        </li>`
      }).join('')}
    </ul>
    ${missing.length > 0 ? `
    <div class="iwcp-warnings">
      <span class="iwcp-warn-icon">⚠</span>
      <span>Missing for this type: ${escAttr(missing.join(', '))}</span>
    </div>
    <form class="iwcp-fill" id="iwcp-fill">
      ${(capture.missingRequired ?? []).map(key => `
        <label class="iwcp-fill-row">
          <span class="iwcp-fill-label">${escAttr(FIELD_LABELS[key] ?? key)}</span>
          <input class="iwcp-fill-input" name="${escAttr(key)}" placeholder="${escAttr(FIELD_PLACEHOLDERS[key] ?? '')}" autocomplete="off"
            style="all:unset;box-sizing:border-box;display:block;width:100%;font-size:11px;font-family:Georgia,serif;border:1px solid rgba(92,45,138,0.25);border-radius:5px;padding:3px 7px;background:#fff;color:#3a3a3a" />
        </label>`).join('')}
      <div class="iwcp-fill-footer">
        <button type="submit" class="iwcp-fill-save"
          style="all:unset;box-sizing:border-box;display:inline-block;margin:0;padding:3px 10px;background:#5c2d8a;color:#fff;border-radius:5px;font-size:10px;font-family:Georgia,serif;cursor:pointer;line-height:1.5;white-space:nowrap">Save to library</button>
        <span class="iwcp-fill-status" id="iwcp-fill-status"></span>
      </div>
    </form>` : ''}
    ${hasVerifiable ? '<p class="iwcp-hint">Hover ✓ or ◎ to see the match · click ◎ to confirm · ✎ to edit</p>' : ''}
  `

  // Attach hover-highlight to a field row ONCE. Reads el.dataset.quote at event time (not captured),
  // so an inline edit that changes the quote takes effect without re-wiring. Publisher has its own
  // logo-outline hover, so it's excluded here.
  const wireFieldHover = (el: HTMLElement) => {
    if (el.dataset.wired) return
    el.dataset.wired = '1'
    el.addEventListener('mouseenter', () => highlightQuote(el.dataset.quote ?? ''))
    el.addEventListener('focus',      () => highlightQuote(el.dataset.quote ?? ''))
    el.addEventListener('mouseleave', () => clearHighlight())
    el.addEventListener('blur',       () => clearHighlight())
  }

  // Replace a field's displayed value with an input; persist on Enter/blur, cancel on Esc.
  // Works for verified fields too — the writer always gets the last word over the AI/auto guess.
  const beginEdit = (li: HTMLElement, key: string) => {
    const valueSpan = li.querySelector<HTMLElement>('.iwcp-value')
    if (!valueSpan || li.querySelector('.iwcp-edit-input')) return
    const current = (li.dataset.value ?? valueSpan.textContent ?? '').trim()
    const input = document.createElement('input')
    input.className = 'iwcp-edit-input'
    input.value = current
    input.style.cssText = 'all:unset;box-sizing:border-box;display:block;flex:1;min-width:0;font-size:11px;font-family:Georgia,serif;border:1px solid rgba(92,45,138,0.45);border-radius:5px;padding:2px 6px;background:#fff;color:#3a3a3a'
    valueSpan.style.display = 'none'
    valueSpan.after(input)
    input.focus(); input.select()
    let done = false
    const finish = (commit: boolean) => {
      if (done) return; done = true
      const newVal = input.value.trim()
      input.remove(); valueSpan.style.display = ''
      if (!commit || !newVal || newVal === current) return
      valueSpan.textContent = newVal
      li.dataset.value = newVal
      li.setAttribute('aria-label', `${li.querySelector('.iwcp-label')?.textContent ?? key}: ${newVal}`)
      // Persist to the queued citation (same path as the missing-field fill form).
      browser.runtime.sendMessage({ type: 'inkwave:updateCaptureFields', id: capture.id, updates: { [key]: newVal } }).catch(() => {})
      // Re-derive highlightability against the page; keep an explicit ✓ if the writer already confirmed.
      const range = key === 'publisher' ? null : existsInVisibleText(newVal)
      li.dataset.quote = range ? newVal : ''
      wireFieldHover(li)
      li.setAttribute('tabindex', '0'); li.setAttribute('role', 'button')
      const check = li.querySelector<HTMLElement>('.iwcp-check')
      if (!li.classList.contains('iwcp-has-quote')) {
        if (range) { li.classList.add('iwcp-auto-found'); if (check) check.textContent = '◎' }
        else { li.classList.remove('iwcp-auto-found'); if (check) check.textContent = '○' }
      }
    }
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); finish(true) }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
    })
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('click', e => e.stopPropagation())
  }

  // Verified rows (✓ / ◎): hover to highlight.
  panel.querySelectorAll<HTMLElement>('.iwcp-has-quote, .iwcp-auto-found').forEach(wireFieldHover)

  // Auto-found (◎): click the row confirms → upgrades to ✓ (but not when clicking the edit button).
  panel.querySelectorAll<HTMLElement>('.iwcp-auto-found').forEach(el => {
    el.addEventListener('click', ev => {
      if ((ev.target as HTMLElement).closest('.iwcp-edit, .iwcp-edit-input')) return
      el.classList.remove('iwcp-auto-found')
      el.classList.add('iwcp-has-quote')
      const check = el.querySelector('.iwcp-check')
      if (check) check.textContent = '✓'
      el.setAttribute('aria-label', (el.getAttribute('aria-label') ?? '').replace('click to confirm match', 'hover to verify'))
    })
  })

  // Edit (✎) on every field row — even verified ones.
  panel.querySelectorAll<HTMLElement>('.iwcp-edit').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85' })
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.4' })
    btn.addEventListener('click', ev => {
      ev.stopPropagation()
      const li = btn.closest<HTMLElement>('.iwcp-field')
      if (li) beginEdit(li, li.dataset.fieldKey ?? '')
    })
  })

  panel.querySelector('.iwcp-close')?.addEventListener('click', () => {
    removeCapturePanel(panel)
    clearHighlight()
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
          const range = existsInVisibleText(value)
          const cls = range ? ' iwcp-auto-found' : ''
          const symbol = range ? '◎' : '○'
          const li = document.createElement('li')
          li.className = `iwcp-field${cls}`
          li.setAttribute('data-quote', range ? value : '')
          li.setAttribute('tabindex', range ? '0' : '-1')
          li.setAttribute('role', range ? 'button' : 'listitem')
          li.innerHTML = `<span class="iwcp-check">${symbol}</span><span class="iwcp-label">${escAttr(label)}</span><span class="iwcp-value">${escAttr(value)}</span>`
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
          p.textContent = 'Hover ✓ or ◎ to see the match · click ◎ to confirm · ✎ to edit'
          panel.appendChild(p)
        }
        setTimeout(() => { if (statusEl) statusEl.textContent = '' }, 2000)
      }
    } catch {
      if (statusEl) { statusEl.textContent = '✗ Error'; statusEl.style.color = '#b91c1c' }
      if (saveBtn) saveBtn.disabled = false
    }
  })

  // Publisher is now a plain field (logo feature removed): it highlights its name only when
  // distinctive (handled in the verify loop above), so no special wiring here.

  // Draggable panel: mousedown on header drags by top/left.
  //
  // ⚠ THE DRAG'S LISTENERS ARE ON `document`, SO THEIR LIFETIME IS THE PANEL'S — AND IT WAS NOT.
  // They were removed only by a `{ once: true }` handler on the close button, which is ONE of the
  // ways this panel goes away. The other is the `remove()` at the top of showCapturePanel: every
  // re-show (a second capture, or the tabs.onUpdated re-injection on reload) dropped the old panel
  // without ever clicking its close button, leaking a mousemove and a mouseup that hold the whole
  // detached panel alive. A content script runs on `<all_urls>` and lives as long as the tab, so
  // the leak accumulates for the rest of the writer's session on that page.
  //
  // Removal is a funnel now (`removeCapturePanel`), which is the fix; the `isConnected` re-check in
  // `onMove` is the backstop for any future path that bypasses it, because a convention two call
  // sites have to remember is exactly what failed here.
  const panelHeader = panel.querySelector<HTMLElement>('.iwcp-header')
  if (panelHeader) {
    panelHeader.style.cursor = 'move'
    const drag = new AbortController()
    panelDrag.set(panel, drag)
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0
    const onMove = (e: MouseEvent) => {
      if (!panel.isConnected) { drag.abort(); return }
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
    document.addEventListener('mousemove', onMove, { signal: drag.signal })
    document.addEventListener('mouseup', onUp, { signal: drag.signal })
  }

  document.body.appendChild(panel)
}

function injectStyles(): void {
  if (document.getElementById('inkwave-styles')) return
  const style = document.createElement('style')
  style.id = 'inkwave-styles'
  style.textContent = `
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
