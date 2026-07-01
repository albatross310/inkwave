// MV3 background service worker.
// Captures a citation from the active tab, queues it in storage for idempotent flush to the app.
// Also relays hover-to-source highlight messages to the active tab (popup → background → content script).
// Network happens here — not in a content script — because content-script fetch is CORS-bound and
// doesn't inherit host_permissions. Uses browser.* (polyfill provides this on Chrome + Firefox).

import { detectIdentifier } from '@inkwave/citations/identifiers'
import { lookupIdentifier } from '@inkwave/citations/lookup'
import { INKWAVE_URL_PATTERNS, QUEUE_KEY } from '../utils/constants'

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const m = msg as { type?: string; tabId?: number; quote?: string } | null
    if (!m) return false

    if (m.type === 'inkwave:capture') {
      captureActiveTab()
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: String((e as Error).message || e) }))
      return true // keep the channel open for the async response
    }

    if (m.type === 'inkwave:highlightOnTab' && m.tabId && m.quote) {
      void injectAndHighlight(m.tabId, m.quote)
      return false
    }

    if (m.type === 'inkwave:clearHighlightOnTab' && m.tabId) {
      browser.tabs.sendMessage(m.tabId, { type: 'inkwave:clearHighlight' }).catch(() => {})
      return false
    }

    return false
  })
})

async function injectAndHighlight(tabId: number, quote: string): Promise<void> {
  try {
    // Inject the source-page content script if it hasn't been injected yet.
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['content-source.js'],
    })
  } catch {
    // Already injected, or tab is restricted — ignore.
  }
  try {
    await browser.tabs.sendMessage(tabId, { type: 'inkwave:highlight', quote })
  } catch {
    // Content script not ready yet — ignore.
  }
}

async function enqueue(item: object, sourceUrl: string): Promise<number> {
  const store = await browser.storage.local.get(QUEUE_KEY)
  const q: object[] = (store[QUEUE_KEY] as object[]) ?? []
  q.push({ uuid: crypto.randomUUID(), item, sourceUrl, at: Date.now() })
  await browser.storage.local.set({ [QUEUE_KEY]: q })
  // Poke any open Inkwave tab to flush immediately.
  const tabs = await browser.tabs.query({})
  const inkwaveTabs = tabs.filter(t => INKWAVE_URL_PATTERNS.some(pat =>
    t.url && new RegExp('^' + pat.replace('*', '.*')).test(t.url)
  ))
  for (const t of inkwaveTabs) {
    if (t.id) {
      browser.tabs.sendMessage(t.id, { type: 'inkwave:flush' }).catch(() => {})
    }
  }
  return q.length
}

async function captureActiveTab(): Promise<{ ok: boolean; id?: string; queued?: number; error?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) throw new Error('no active tab')
  const id = detectIdentifier(tab.url)
  if (!id) throw new Error('no identifier found on this page')
  const item = await lookupIdentifier(id)
  const n = await enqueue(item, tab.url)
  return { ok: true, id: item.id, queued: n }
}
