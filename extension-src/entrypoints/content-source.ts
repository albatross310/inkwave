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

// Multi-author values ("Tyler Graham, Katie Collins" / "Tyler Graham and Katie Collins") rarely
// appear contiguously in the page — each author sits in its own byline card. Offer the whole value
// first, then each individual author, so hover can at least snap to the primary author.
function authorCandidates(value: string): string[] {
  const parts = value.split(/\s*(?:,|;|&|\band\b)\s*/i).map(s => s.trim()).filter(s => s.length >= 3)
  return parts.length > 1 ? [value, ...parts] : [value]
}

// YouTube shows a RELATIVE date ("13 days ago") next to the view count; the absolute date hides
// behind the "…more" dropdown. Derive the likely relative strings from the ISO date + today so hover
// can snap to what's actually on screen. ±1 on each unit absorbs YouTube's timestamp-vs-midnight
// rounding. Video-only (relative forms would false-match elsewhere on ordinary pages).
function relativeDateCandidates(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return []
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = new Date()
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return []
  const ago = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`
  if (days === 0) return ['today']
  if (days === 1) return ['yesterday', '1 day ago']
  const weeks = Math.round(days / 7), months = Math.round(days / 30), years = Math.round(days / 365)
  // Primary form first, matching YouTube's unit thresholds (days→weeks at 14, →months ~8wk, →years
  // at a year). Coarse fallbacks next; the raw "N days ago" goes LAST so a comment's day-stamp is the
  // least-preferred match (comments are full of relative dates; the video's own form is the target).
  const out: string[] = []
  if (days <= 13) out.push(ago(days, 'day'))
  else if (days < 56) out.push(ago(weeks, 'week'))
  else if (days < 365) out.push(ago(months, 'month'))
  else out.push(ago(years, 'year'))
  if (weeks >= 1) out.push(ago(weeks, 'week'))
  if (months >= 1) out.push(ago(months, 'month'))
  if (years >= 1) out.push(ago(years, 'year'))
  out.push(ago(days, 'day'))
  return [...new Set(out)]
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

// Find the publisher's logo on the page. Returns:
//   el  — the DOM element to outline on hover (img, svg, or a containing element)
//   url — a URL for the small thumbnail in the panel (img src or favicon link)
function findPublisherLogo(): { el: HTMLElement | null; url: string } {
  // Resolve favicon url first (used as thumbnail when no better img url is available).
  let faviconUrl = `${window.location.origin}/favicon.ico`
  for (const sel of ['link[rel="apple-touch-icon"]', 'link[rel="icon"][type="image/png"]', 'link[rel="icon"][sizes="32x32"]', 'link[rel="icon"]', 'link[rel="shortcut icon"]']) {
    const link = document.querySelector(sel) as HTMLLinkElement | null
    if (link?.href && !link.href.startsWith('data:')) { faviconUrl = link.href; break }
  }

  // 1. Header/banner/nav: prefer an <img> with "logo" in class/id/alt/src.
  for (const root of ['header', '[role="banner"]', 'nav', '[class*="header"]', '[id*="header"]']) {
    const c = document.querySelector(root)
    if (!c) continue
    const imgs = Array.from(c.querySelectorAll('img')) as HTMLImageElement[]
    const logo = imgs.find(img => /logo/i.test([img.className, img.id, img.alt ?? '', img.src].join(' ')))
              ?? (imgs.length === 1 && imgs[0].offsetWidth > 20 ? imgs[0] : undefined)
    if (logo?.src) return { el: logo, url: logo.src }
  }

  // 2. Any element whose id or class contains "logo" — catches YouTube's #logo SVG,
  //    site-logo divs, etc. Filter to visible elements in the top 40% of the page.
  const logoEls = Array.from(document.querySelectorAll<HTMLElement>(
    '[id*="logo"]:not(#inkwave-capture-panel), [class*="logo"]:not(#inkwave-capture-panel)'
  )).filter(el => {
    const r = el.getBoundingClientRect()
    return r.width >= 20 && r.width <= 500 && r.top < window.innerHeight * 0.4
  })
  for (const el of logoEls) {
    const img = el.tagName === 'IMG' ? el as unknown as HTMLImageElement : el.querySelector('img')
    const imgUrl = (img as HTMLImageElement | null)?.src
    // Return the container as hover target; use img src if available, else favicon.
    return { el, url: imgUrl || faviconUrl }
  }

  return { el: null, url: faviconUrl }
}

function showCapturePanel(capture: CaptureMsg) {
  document.getElementById('inkwave-capture-panel')?.remove()

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
      const oCands = key === 'date' ? [...relativeDateCandidates(f.value), f.value] : [f.value]
      verifySource.set(key, 'ai'); verifyQuote.set(key, oCands.find(existsInVisibleText) ?? '')
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

  // Find the publisher logo: real img element on the page (for hover-outline) or icon link.
  const pubLogo = findPublisherLogo()

  panel.innerHTML = `
    <div class="iwcp-header">
      <div class="iwcp-header-top">
        <span class="iwcp-logo">Inkwave <span style="opacity:0.45;font-size:9px;font-weight:400">v0.1.1</span></span>
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
                    data-value="${esc(f.value ?? '')}"
                    tabindex="${(aiVerified || autoFound) || key === 'publisher' ? '0' : '-1'}"
                    role="${(aiVerified || autoFound) || key === 'publisher' ? 'button' : 'listitem'}"
                    aria-label="${esc(label)}: ${esc(f.value ?? '')}${autoFound ? ' — click to confirm' : aiVerified ? ' — hover to verify' : key === 'publisher' ? ' — hover to see logo' : ''}">
          <span class="iwcp-check">${symbol}</span>
          <span class="iwcp-label">${esc(label)}</span>
          <span class="iwcp-value">${key === 'publisher' && pubLogo.url ? `<img src="${esc(pubLogo.url)}" style="width:13px;height:13px;border-radius:2px;object-fit:contain;vertical-align:middle;margin-right:4px" onerror="this.style.display='none'" />` : ''}${esc(f.value ?? '')}</span>
          <button class="iwcp-edit" aria-label="Edit ${esc(label)}" title="Edit"
                  style="all:unset;box-sizing:border-box;margin-left:auto;padding:0 4px;cursor:pointer;font-size:11px;opacity:0.4;line-height:1;flex-shrink:0">✎</button>
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
    ${hasVerifiable ? '<p class="iwcp-hint">Hover ✓ or ◎ to see the match · click ◎ to confirm · ✎ to edit</p>' : ''}
  `

  // Attach hover-highlight to a field row ONCE. Reads el.dataset.quote at event time (not captured),
  // so an inline edit that changes the quote takes effect without re-wiring. Publisher has its own
  // logo-outline hover, so it's excluded here.
  const wireFieldHover = (el: HTMLElement) => {
    if (el.dataset.wired || el.dataset.fieldKey === 'publisher') return
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
          const range = existsInVisibleText(value)
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

  // Publisher field: hover outlines the real logo element on the page.
  const pubLi = panel.querySelector<HTMLElement>('[data-field-key="publisher"]')
  if (pubLi && pubLogo.el) {
    const logoEl = pubLogo.el
    pubLi.style.cursor = 'pointer'
    pubLi.addEventListener('mouseenter', () => {
      logoEl.style.outline = '3px solid rgba(92,45,138,0.7)'
      logoEl.style.outlineOffset = '3px'
      logoEl.style.borderRadius = '4px'
      // Use window.scrollTo so the scroll targets the document position, not a nested
      // scroll container (scrollIntoView picks the nearest scrollable ancestor which is
      // often the header itself, not the window, so it silently does nothing).
      const rect = logoEl.getBoundingClientRect()
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - 20), behavior: 'smooth' })
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
