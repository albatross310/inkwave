// MV3 service worker. Captures a citation from the active tab (identifier → CrossRef), queues it in
// chrome.storage.local with a UUID for idempotency, and pokes any open Inkwave tab to flush. Doing
// the network in the background worker (not a content script) is required — content-script fetch is
// bound by page CORS and doesn't inherit host_permissions. See citations spec §13.

import { captureFromUrl } from './lib.js'

const QUEUE_KEY = 'inkwave:citeQueue'

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now() + Math.floor(Math.random() * 1e6)
}

async function enqueue(item, sourceUrl) {
  const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY)
  q.push({ uuid: uuid(), item, sourceUrl, at: Date.now() })
  await chrome.storage.local.set({ [QUEUE_KEY]: q })
  // Nudge any open Inkwave tab to flush now (it also flushes on storage.onChanged + on load).
  const tabs = await chrome.tabs.query({ url: ['https://inkwave.me/*', 'http://localhost:5173/*'] })
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'inkwave:flush' }).catch(() => {})
  return q.length
}

// Capture the current tab. Invoked from the popup.
async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) throw new Error('no active tab')
  const item = await captureFromUrl(tab.url)
  const n = await enqueue(item, tab.url)
  return { ok: true, id: item.id, queued: n }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'inkwave:capture') {
    captureActiveTab().then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e.message || e) }))
    return true // async response
  }
})
