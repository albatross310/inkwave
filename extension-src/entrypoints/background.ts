// MV3 background service worker.
// Captures a citation from the active tab, queues it in storage for idempotent flush to the app.
// Also relays hover-to-source highlight messages to the active tab (popup → background → content script).
// Network happens here — not in a content script — because content-script fetch is CORS-bound and
// doesn't inherit host_permissions. Uses browser.* (polyfill provides this on Chrome + Firefox).

import { detectIdentifier } from '@inkwave/citations/identifiers'
import { lookupIdentifier } from '@inkwave/citations/lookup'
import { extractToCsl, parseAuthor, parseDate } from '@inkwave/citations/capture'
import type { ExtractResponse } from '@inkwave/citations/capture'
import { ITEM_TYPE_LABELS, REQUIRED_BY_TYPE, FIELD_LABELS } from '@inkwave/citations/requiredFields'
import { INKWAVE_URL_PATTERNS, QUEUE_KEY, WATCH_KEY } from '../utils/constants'

// Derive the API server origin from open Inkwave tabs.
// Prefers localhost (dev) over production so the extension hits the right server
// without needing a rebuild when switching environments.
async function resolveApiOrigin(): Promise<string> {
  const tabs = await browser.tabs.query({})
  const urls = tabs.map(t => t.url ?? '')
  const DEV = 'http://localhost:5173'
  const PROD = 'https://inkwave.me'
  if (urls.some(u => u.startsWith(DEV))) return DEV
  if (urls.some(u => u.startsWith(PROD))) return PROD
  return PROD // no Inkwave tab open — fall back to production
}

type FieldEntry = { value?: string; quote?: string | null }
type QueueEntry = { uuid: string; item: Record<string, unknown>; sourceUrl?: string; at?: number; fields?: Record<string, FieldEntry>; confidence?: string }

export interface CaptureMsg {
  id: string
  title: string
  itemType: string
  typeLabel: string
  fields: Record<string, FieldEntry>
  missingRequired: string[]
  missingLabels: string[]
  confidence: string
}

function buildCaptureMsg(
  item: Record<string, unknown>,
  fields: Record<string, FieldEntry>,
  confidence = 'high',
): CaptureMsg {
  const type = String(item.type ?? 'webpage')
  const required = REQUIRED_BY_TYPE[type] ?? []
  const issued = item.issued as { 'date-parts'?: number[][] } | undefined
  const hasYear = !!(issued?.['date-parts']?.[0]?.[0] ?? fields.date?.value ?? fields.year?.value)
  const missingRequired = required.filter(f => {
    if (f === 'year') return !hasYear
    if (item[f]) return false
    if (fields[f]?.value) return false
    return true
  })
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    itemType: type,
    typeLabel: ITEM_TYPE_LABELS[type] ?? type,
    fields,
    missingRequired,
    missingLabels: missingRequired.map(f => FIELD_LABELS[f] ?? f),
    confidence,
  }
}

async function injectAndShowCapture(tabId: number, capture: CaptureMsg): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: ['content-source.js'] }).catch(() => {})
  browser.tabs.sendMessage(tabId, { type: 'inkwave:showCapture', capture }).catch(() => {})
}

export default defineBackground(() => {
  // When a tab finishes loading, show the verification panel if we have capture data for that URL.
  // Checks: (1) the citation queue (item not yet flushed to app), (2) the watch list (app-triggered).
  browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (info.status !== 'complete' || !tab.url) return
    if (INKWAVE_URL_PATTERNS.some(pat => tab.url && new RegExp('^' + pat.replace('*', '.*')).test(tab.url!))) return

    const [qStore, wStore] = await Promise.all([
      browser.storage.local.get(QUEUE_KEY),
      browser.storage.local.get(WATCH_KEY),
    ])
    const q = (qStore[QUEUE_KEY] as QueueEntry[]) ?? []
    const watches = (wStore[WATCH_KEY] as Array<{ url: string; capture: CaptureMsg; at: number }>) ?? []

    // Watch list takes priority (most recently added via app ↗ click).
    const watchMatch = watches.find(w => tab.url?.startsWith(w.url.split('?')[0]))
    if (watchMatch) {
      await injectAndShowCapture(tabId, watchMatch.capture)
      // Remove from watch list after showing so it doesn't reappear on every reload.
      await browser.storage.local.set({ [WATCH_KEY]: watches.filter(w => w !== watchMatch) })
      return
    }

    // Queue fallback (item still pending flush).
    const qMatch = q.find(e => e.sourceUrl && tab.url?.startsWith(e.sourceUrl.split('?')[0]))
    if (!qMatch?.fields || Object.keys(qMatch.fields).length === 0) return
    const capture = buildCaptureMsg(qMatch.item, qMatch.fields, qMatch.confidence)
    await injectAndShowCapture(tabId, capture)
  })

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const m = msg as { type?: string; tabId?: number; quote?: string; capture?: CaptureMsg } | null
    if (!m) return false

    if (m.type === 'inkwave:capture') {
      captureActiveTab()
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: String((e as Error).message || e) }))
      return true // keep the channel open for the async response
    }

    if (m.type === 'inkwave:showCapturePanel' && m.tabId && m.capture) {
      void injectAndShowCapture(m.tabId, m.capture)
      return false
    }

    if (m.type === 'inkwave:updateCaptureFields' && m.id && m.updates) {
      void updateCaptureFields(String(m.id), m.updates as Record<string, string>)
        .then(sendResponse)
      return true
    }

    if (m.type === 'inkwave:watchPanel' && m.url && m.capture) {
      void (async () => {
        const store = await browser.storage.local.get(WATCH_KEY)
        const watches = (store[WATCH_KEY] as Array<{ url: string; capture: CaptureMsg; at: number }>) ?? []
        const next = watches.filter(w => w.url !== m.url)
        next.push({ url: String(m.url), capture: m.capture as CaptureMsg, at: Date.now() })
        await browser.storage.local.set({ [WATCH_KEY]: next.slice(-30) })
      })()
      return false
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

async function updateCaptureFields(id: string, updates: Record<string, string>): Promise<{ ok: boolean }> {
  const store = await browser.storage.local.get(QUEUE_KEY)
  const q = ((store[QUEUE_KEY] as QueueEntry[]) ?? [])
  const entry = q.find(e => e.item.id === id)
  if (!entry) return { ok: false }
  if (!entry.fields) entry.fields = {}
  for (const [key, raw] of Object.entries(updates)) {
    if (!raw.trim()) continue
    // Parse complex CSL types; store everything else as a flat string on item.
    if (key === 'author' || key === 'editor') {
      entry.item[key] = parseAuthor(raw)
    } else if (key === 'year') {
      entry.item.issued = parseDate(raw)
    } else if (key === 'accessed') {
      entry.item.accessed = parseDate(raw)
    } else {
      entry.item[key] = raw
    }
    entry.fields[key] = { value: raw, quote: null }
  }
  await browser.storage.local.set({ [QUEUE_KEY]: q })
  // Poke Inkwave to re-flush with the updated item.
  const tabs = await browser.tabs.query({})
  for (const t of tabs.filter(t => INKWAVE_URL_PATTERNS.some(pat =>
    t.url && new RegExp('^' + pat.replace('*', '.*')).test(t.url!)))) {
    if (!t.id) continue
    await browser.scripting.executeScript({ target: { tabId: t.id }, files: ['content-inkwave.js'] }).catch(() => {})
    browser.tabs.sendMessage(t.id, { type: 'inkwave:flush' }).catch(() => {})
  }
  return { ok: true }
}

async function injectAndHighlight(tabId: number, quote: string): Promise<void> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['content-source.js'] })
  } catch { /* already injected or restricted */ }
  try {
    await browser.tabs.sendMessage(tabId, { type: 'inkwave:highlight', quote })
  } catch { /* not ready */ }
}

async function enqueue(item: object, sourceUrl: string, fields?: Record<string, unknown>, confidence?: string): Promise<number> {
  const store = await browser.storage.local.get(QUEUE_KEY)
  const q: object[] = (store[QUEUE_KEY] as object[]) ?? []
  q.push({ uuid: crypto.randomUUID(), item, sourceUrl, at: Date.now(), fields, confidence })
  await browser.storage.local.set({ [QUEUE_KEY]: q })
  // Poke any open Inkwave tab to flush immediately.
  const tabs = await browser.tabs.query({})
  const inkwaveTabs = tabs.filter(t => INKWAVE_URL_PATTERNS.some(pat =>
    t.url && new RegExp('^' + pat.replace('*', '.*')).test(t.url)
  ))
  for (const t of inkwaveTabs) {
    if (!t.id) continue
    await browser.scripting.executeScript({
      target: { tabId: t.id },
      files: ['content-inkwave.js'],
    }).catch(() => {})
    browser.tabs.sendMessage(t.id, { type: 'inkwave:flush' }).catch(() => {})
  }
  return q.length
}

async function captureActiveTab(): Promise<{ ok: boolean; id?: string; queued?: number; error?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) throw new Error('no active tab')

  // Identifier path (DOI/arXiv/ISBN/PMID) — instant, no AI.
  const id = detectIdentifier(tab.url)
  if (id) {
    const item = await lookupIdentifier(id)
    const n = await enqueue(item, tab.url)
    return { ok: true, id: item.id, queued: n }
  }

  // LLM-scrape fallback for blogs and websites.
  return captureWithLLM(tab.url, tab.id)
}

async function captureWithLLM(url: string, tabId: number | undefined): Promise<{ ok: boolean; id?: string; queued?: number; error?: string }> {
  let html = ''
  if (tabId) {
    try {
      const [{ result }] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML.slice(0, 400_000),
      })
      html = (result as string | null) ?? ''
    } catch { /* restricted page */ }
  }

  const apiOrigin = await resolveApiOrigin()
  const res = await fetch(`${apiOrigin}/api/summarise`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ extract: { url, html: html || undefined } }),
  })
  const data = await res.json() as ExtractResponse & { error?: string }
  if (!res.ok) throw new Error(data.error || `extraction server ${res.status}`)
  if (data.error) throw new Error(data.error)
  if (!data.fields || Object.keys(data.fields).length === 0) {
    throw new Error('no citable metadata found on this page')
  }

  const { item, fields } = extractToCsl(data, url)
  const capture = buildCaptureMsg(item as Record<string, unknown>, fields as Record<string, FieldEntry>, data.confidence)
  await enqueue(item, url, fields as Record<string, unknown>, data.confidence)

  // Show the in-page verification panel on the source tab (AI captures only).
  if (tabId) await injectAndShowCapture(tabId, capture)

  return { ok: true, id: item.id, queued: 0 }
}
