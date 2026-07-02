import { QUEUE_KEY } from '../../utils/constants'

const btn = document.getElementById('cap') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement
const fieldsEl = document.getElementById('fields') as HTMLElement
const fieldListEl = document.getElementById('fieldList') as HTMLElement
const hintEl = document.getElementById('hint') as HTMLElement

type FieldEntry = { value?: string; quote?: string | null; source?: string }
type IW = { fields?: Record<string, FieldEntry>; addedAt?: string; sourceUrl?: string; source?: string }
type CslItem = { id: string; title?: string; author?: unknown[]; _iw?: IW }

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', author: 'Author', date: 'Date',
  publisher: 'Publisher / Journal', URL: 'URL',
}

const STATUS_KEY = 'inkwave:popupStatus'

// Restore last status message so reopening the popup shows what happened.
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

// On popup open: check if the current tab has a recently-captured citation with AI quotes to show.
async function loadCurrentCapture() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  const store = await browser.storage.local.get(QUEUE_KEY)
  const q: Array<{ item: CslItem; sourceUrl?: string }> = (store[QUEUE_KEY] as typeof q) ?? []
  // Find the most recent queued citation from this tab's URL.
  const match = [...q].reverse().find(e => e.sourceUrl && tab.url?.startsWith(e.sourceUrl.split('?')[0]))
  if (!match) return
  const iw = match.item._iw
  if (!iw?.fields) return
  // Only show the fields panel when there are AI-extracted quotes to hover.
  const hasQuotes = Object.values(iw.fields).some(f => f.quote)
  if (!hasQuotes) return
  renderFields(match.item, tab.id)
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

restoreStatus()
void loadCurrentCapture()
