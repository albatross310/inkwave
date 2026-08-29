import { QUEUE_KEY, HISTORY_KEY, HISTORY_TTL_MS } from '../../utils/constants'
import { REQUIRED_BY_TYPE, FIELD_LABELS, ITEM_TYPE_LABELS } from '@inkwave/citations/requiredFields'
import type { CaptureMsg } from '../background'

const btn = document.getElementById('cap') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement
const fieldsEl = document.getElementById('fields') as HTMLElement
const fieldListEl = document.getElementById('fieldList') as HTMLElement
const hintEl = document.getElementById('hint') as HTMLElement
const alreadyEl = document.getElementById('already') as HTMLElement
const alTypeEl = document.getElementById('alType') as HTMLElement
const alMissingEl = document.getElementById('alMissing') as HTMLElement
const showPanelBtn = document.getElementById('showPanel') as HTMLButtonElement

type FieldEntry = { value?: string; quote?: string | null; source?: string }
type IW = { fields?: Record<string, FieldEntry>; addedAt?: string; sourceUrl?: string; source?: string }
type CslItem = { id: string; title?: string; type?: string; author?: unknown[]; _iw?: IW; issued?: { 'date-parts'?: number[][] } }
type QueueEntry = { item: CslItem; sourceUrl?: string; fields?: Record<string, FieldEntry>; confidence?: string; missingLabels?: string[]; typeLabel?: string }

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', author: 'Author', date: 'Date',
  publisher: 'Publisher / Journal', URL: 'URL',
}

const STATUS_KEY = 'inkwave:popupStatus'

function restoreStatus() {
  try {
    const saved = sessionStorage.getItem(STATUS_KEY)
    if (!saved) return
    const { cls, text } = JSON.parse(saved) as { cls: string; text: string }
    statusEl.className = cls
    statusEl.textContent = text
  } catch { /* ignore */ }
}

function saveStatus(cls: string, text: string) {
  try { sessionStorage.setItem(STATUS_KEY, JSON.stringify({ cls, text })) } catch { /* ignore */ }
}

// currentCapture is populated if this page is already in the queue.
let currentCapture: CaptureMsg | null = null

type HistoryEntry = { id: string; sourceUrl: string; type: string; title: string; at: number; missingRequired: string[]; capture?: CaptureMsg }

async function loadCurrentCapture() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return

  const [qStore, hStore] = await Promise.all([
    browser.storage.local.get(QUEUE_KEY),
    browser.storage.local.get(HISTORY_KEY),
  ])
  const q: QueueEntry[] = (qStore[QUEUE_KEY] as QueueEntry[]) ?? []
  // Expired history entries are invisible even if a write hasn't pruned them yet.
  const hist: HistoryEntry[] = ((hStore[HISTORY_KEY] as HistoryEntry[]) ?? []).filter(e => Date.now() - e.at < HISTORY_TTL_MS)

  const match = [...q].reverse().find(e => e.sourceUrl && tab.url?.startsWith(e.sourceUrl.split('?')[0]))

  if (!match) {
    // Queue entry flushed — check history for a lightweight "already in library" indicator.
    const h = hist.find(e => tab.url?.startsWith(e.sourceUrl.split('?')[0]))
    if (!h) return
    const typeLabel = ITEM_TYPE_LABELS[h.type] ?? h.type
    alreadyEl.style.display = 'block'
    alTypeEl.textContent = typeLabel + ' · In Inkwave library'
    const missingLabels = h.missingRequired.map(f => FIELD_LABELS[f] ?? f)
    if (missingLabels.length) {
      alMissingEl.style.display = 'block'
      alMissingEl.textContent = `Still missing: ${missingLabels.join(', ')}`
    }
    hintEl.style.display = 'none'
    // Re-enable "Show on page" if the full capture was stored in history.
    if (h.capture) {
      currentCapture = h.capture
    } else {
      showPanelBtn.style.display = 'none'
    }
    return
  }

  const item = match.item
  const fields = (match.fields ?? item._iw?.fields ?? {}) as Record<string, FieldEntry>
  const type = String(item.type ?? 'webpage')
  const typeLabel = ITEM_TYPE_LABELS[type] ?? type

  // Always compute missing fields fresh from the current item + fields.
  const required = REQUIRED_BY_TYPE[type] ?? []
  const issued = (item.issued as { 'date-parts'?: number[][] } | undefined)
  const hasYear = !!(issued?.['date-parts']?.[0]?.[0] ?? fields.date?.value ?? fields.year?.value)
  const missingRequired = required.filter(f => {
    if (f === 'year') return !hasYear
    if ((item as Record<string, unknown>)[f]) return false
    if (fields[f]?.value) return false
    return true
  })
  const missingLabels = missingRequired.map(f => FIELD_LABELS[f] ?? f)

  currentCapture = {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    itemType: type,
    typeLabel,
    fields: fields as Record<string, { value?: string; quote?: string | null }>,
    missingRequired,
    missingLabels,
    confidence: match.confidence ?? 'high',
  }

  // Show "already captured" banner.
  alreadyEl.style.display = 'block'
  alTypeEl.textContent = typeLabel
  if (missingLabels.length > 0) {
    alMissingEl.style.display = 'block'
    alMissingEl.textContent = `Missing: ${missingLabels.join(', ')}`
  }
  hintEl.style.display = 'none'

  // Show field list in popup if there are AI quotes.
  const hasQuotes = Object.values(fields).some(f => (f as FieldEntry).quote)
  if (hasQuotes) renderFields(item, tab.id)
}

function renderFields(item: CslItem, tabId: number | undefined) {
  fieldsEl.style.display = 'block'
  hintEl.style.display = 'none'
  fieldListEl.innerHTML = ''
  const fields = item._iw?.fields ?? {}
  for (const [key, entry] of Object.entries(fields)) {
    if (!entry.value) continue
    const label = FIELD_LABELS[key] ?? key
    const hasQuote = !!entry.quote
    const div = document.createElement('div')
    div.className = 'field'
    div.setAttribute('tabindex', '0')
    div.setAttribute('role', 'button')
    div.setAttribute('aria-label', `${label}: ${entry.value}${hasQuote ? ' — hover to verify on page' : ''}`)
    div.innerHTML = `
      <span class="field-label">${label}</span>
      <span class="field-value">${entry.value}</span>
      ${entry.source ? `<span class="field-badge ${entry.source === 'crossref' ? 'badge-crossref' : entry.source === 'ai' ? 'badge-ai' : ''}">${entry.source === 'crossref' ? 'verified via CrossRef' : entry.source === 'ai' ? 'AI-extracted (hover to check)' : entry.source}</span>` : ''}
    `
    if (hasQuote && tabId) {
      const highlight = () => {
        browser.runtime.sendMessage({ type: 'inkwave:highlightOnTab', tabId, quote: entry.quote })
      }
      const clear = () => {
        browser.runtime.sendMessage({ type: 'inkwave:clearHighlightOnTab', tabId })
      }
      div.addEventListener('mouseenter', highlight)
      div.addEventListener('mouseleave', clear)
      div.addEventListener('focus', highlight)
      div.addEventListener('blur', clear)
    }
    fieldListEl.appendChild(div)
  }
}

showPanelBtn.addEventListener('click', async () => {
  if (!currentCapture) return
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  browser.runtime.sendMessage({ type: 'inkwave:showCapturePanel', tabId: tab.id, capture: currentCapture })
  window.close()
})

btn.addEventListener('click', () => {
  btn.disabled = true
  statusEl.className = 's'
  statusEl.textContent = 'Fetching citation info…'
  saveStatus('s', 'Fetching citation info…')

  browser.runtime.sendMessage({ type: 'inkwave:capture' }).then((res: unknown) => {
    btn.disabled = false
    const r = res as { ok: boolean; id?: string; queued?: number; error?: string } | null
    if (r?.ok) {
      const msg = `Captured — open Inkwave to use it.`
      statusEl.className = 's ok'
      statusEl.textContent = msg
      saveStatus('s ok', msg)
      void loadCurrentCapture()
    } else {
      const msg = r?.error || 'Nothing citable found on this page.'
      statusEl.className = 's err'
      statusEl.textContent = msg
      saveStatus('s err', msg)
    }
  }).catch((e: Error) => {
    btn.disabled = false
    const msg = e.message || 'Extension error.'
    statusEl.className = 's err'
    statusEl.textContent = msg
    saveStatus('s err', msg)
  })
})

// ── PAGE FETCHING FOR INKWAVE'S SOURCE READER ───────────────────────────────────────────────────
// `<all_urls>` is an OPTIONAL permission (wxt.config.ts explains the choice), so it is granted HERE:
// Chrome honours permissions.request() only from a user gesture inside an extension page, and the
// popup is the only extension page this add-on has. The app cannot ask for it, and neither can the
// background worker.
//
// ⚠ IT SAYS WHICH STATE IT IS IN. A toggle whose two states look the same is how a writer ends up
// believing a feature is on while every page quietly goes back through the server.
const fetchStateEl = document.getElementById('fetchState') as HTMLElement
const grantBtn = document.getElementById('grantFetch') as HTMLButtonElement
const ALL_URLS = { origins: ['<all_urls>'] }

async function renderFetchState() {
  let on = false
  try { on = await browser.permissions.contains(ALL_URLS) } catch { on = false }
  fetchStateEl.className = on ? 'fr-state on' : 'fr-state'
  fetchStateEl.textContent = on
    ? 'On — pages load from your own connection.'
    : 'Off — Inkwave’s server fetches them, and search engines refuse it.'
  grantBtn.hidden = on
}

grantBtn.addEventListener('click', () => {
  // Must be called synchronously from the click, or the gesture is gone by the time it runs.
  browser.permissions.request(ALL_URLS)
    .then(() => renderFetchState())
    .catch(() => {
      fetchStateEl.className = 'fr-state'
      fetchStateEl.textContent = 'Couldn’t turn it on — your browser refused the request.'
    })
})

restoreStatus()
void loadCurrentCapture()
void renderFetchState()
