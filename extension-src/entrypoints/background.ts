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
import { INKWAVE_URL_PATTERNS, QUEUE_KEY, WATCH_KEY, HISTORY_KEY, HISTORY_TTL_MS } from '../utils/constants'
import {
  BG_FETCH_PAGE, BG_OPEN_POPUP, BG_READER_STATUS, NEEDS_PERMISSION,
  type FetchPageResult, type ReaderStatus,
} from '@inkwave/reader/extensionProtocol'
import { assertFetchable, decodeHtml, READER_ACCEPT } from '@inkwave/reader/fetchRules'

type HistoryEntry = { id: string; sourceUrl: string; type: string; title: string; at: number; missingRequired: string[]; capture?: CaptureMsg }

// Derive the API server origin from open Inkwave tabs.
// Prefers localhost (dev) over production so the extension hits the right server
// without needing a rebuild when switching environments.
async function resolveApiOrigin(): Promise<string> {
  const tabs = await browser.tabs.query({})
  const urls = tabs.map(t => t.url ?? '')
  const DEV = 'http://localhost:5173'
  const PROD = 'https://iwzero.me' // canonical app domain (inkwave.studio 301s here)
  if (urls.some(u => u.startsWith(DEV))) return DEV
  return PROD
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
  source?: string  // 'oembed' for YouTube/Vimeo — fields are pre-verified, skip DOM check
}

function buildCaptureMsg(
  item: Record<string, unknown>,
  fields: Record<string, FieldEntry>,
  confidence = 'high',
  source?: string,
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
    ...(source ? { source } : {}),
  }
}

async function injectAndShowCapture(tabId: number, capture: CaptureMsg): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: ['content-source.js'] }).catch(() => {})
  browser.tabs.sendMessage(tabId, { type: 'inkwave:showCapture', capture }).catch(() => {})
}

export default defineBackground(() => {
  // Keyboard shortcut: Alt+Shift+I → capture current page directly (no popup).
  browser.commands.onCommand.addListener((command) => {
    if (command === 'capture') void captureActiveTab().catch(() => {})
  })

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
    const m = msg as { type?: string; tabId?: number; quote?: string; capture?: CaptureMsg; url?: string; id?: string; updates?: unknown } | null
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

    // ── THE SOURCE READER'S FETCH, FROM THE WRITER'S OWN ADDRESS ────────────────────────────────
    // Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" These two
    // messages are the answer. The app asks the content script, the content script asks here, and
    // the request goes out of this browser — not out of a Vercel function that DuckDuckGo,
    // Mojeek and every public SearX instance refuse (measured against the deployed endpoint).
    // Both are async: `return true` keeps the channel open, and forgetting it is how a caller
    // waits for ever on a reply the runtime already threw away.
    if (m.type === BG_READER_STATUS) {
      readerStatus().then(sendResponse).catch(() => sendResponse({ canFetch: false } satisfies ReaderStatus))
      return true
    }

    // The reader asking, from the page, for the popup that holds the permission button. It may
    // legitimately fail — `action.openPopup()` is recent, is absent on MV2 Firefox under this name,
    // and can refuse when the window is not focused — so the answer is a boolean the reader is
    // built to handle, never a promise it waits on.
    if (m.type === BG_OPEN_POPUP) {
      openReaderPopup().then(ok => sendResponse({ ok })).catch(() => sendResponse({ ok: false }))
      return true
    }

    if (m.type === BG_FETCH_PAGE && typeof m.url === 'string') {
      fetchPageForReader(m.url)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: String((e as Error)?.message || e) } satisfies FetchPageResult))
      return true
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

// ── PAGE FETCHING FOR THE SOURCE READER ─────────────────────────────────────────────────────────
// The rules live in src/reader/fetchRules.ts (pure, and therefore covered by `pnpm test`); what is
// left here is the one thing that has to happen in an extension worker — the fetch itself, from the
// writer's own address, with the browser's own user agent.

/** `<all_urls>` is an OPTIONAL permission (see wxt.config.ts for why), so it may simply not be
 *  granted — and "not granted" must be reported as itself, never as a fetch failure. The reader
 *  can offer to fix the first and can only apologise for the second. */
async function canFetchPages(): Promise<boolean> {
  try { return await browser.permissions.contains({ origins: ['<all_urls>'] }) }
  catch { return false }   // Firefox MV2 spells it differently in the manifest; a throw means no.
}

async function readerStatus(): Promise<ReaderStatus> {
  return { canFetch: await canFetchPages() }
}

/** Open the popup so the writer can grant page fetching without hunting for the toolbar icon.
 *  Chrome 127+ has `action.openPopup`; Firefox MV2 spells it `browserAction`; either may refuse.
 *  Returning false is a normal outcome and the reader shows the manual instruction regardless. */
async function openReaderPopup(): Promise<boolean> {
  const api = (browser as unknown as {
    action?: { openPopup?: () => Promise<void> }
    browserAction?: { openPopup?: () => Promise<void> }
  })
  const open = api.action?.openPopup ?? api.browserAction?.openPopup
  if (!open) return false
  try { await open.call(api.action ?? api.browserAction); return true } catch { return false }
}

const READER_FETCH_TIMEOUT_MS = 20_000

async function fetchPageForReader(rawUrl: string): Promise<FetchPageResult> {
  let url: URL
  try { url = assertFetchable(rawUrl) } catch (e) { return { ok: false, error: String((e as Error).message) } }
  if (!await canFetchPages()) return { ok: false, error: NEEDS_PERMISSION }

  try {
    // redirect: 'follow' — unlike the server core there is no per-hop check to make here, because
    // there is no privileged network to protect; `res.url` is then the address the page really came
    // from, which is what relative links in the extracted blocks must resolve against.
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(READER_FETCH_TIMEOUT_MS),
      // Accept only. No user-agent, no referer: the browser's own headers are the entire point.
      headers: { accept: READER_ACCEPT },
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    const ctype = res.headers.get('content-type')
    const html = decodeHtml(await res.arrayBuffer(), ctype)
    return { ok: true, finalUrl: res.url || url.toString(), html }
  } catch (e) {
    // A DOMException from AbortSignal.timeout has a name and an unhelpful message; everything else
    // reports its own. Nothing here is logged — the reader's posture is that no record is kept of
    // what was read, and a console line in a service worker is a record.
    const err = e as { name?: string; message?: string }
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timed out' : String(err?.message || 'fetch failed') }
  }
}

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

async function enqueue(item: object, sourceUrl: string, fields?: Record<string, unknown>, confidence?: string, capture?: CaptureMsg): Promise<number> {
  const store = await browser.storage.local.get(QUEUE_KEY)
  const q: object[] = (store[QUEUE_KEY] as object[]) ?? []
  q.push({ uuid: crypto.randomUUID(), item, sourceUrl, at: Date.now(), fields, confidence })
  await browser.storage.local.set({ [QUEUE_KEY]: q })
  // Write to history (with full capture) so popup can show "Already in library" + "Show on page" after flush.
  const hStore = await browser.storage.local.get(HISTORY_KEY)
  const hist: HistoryEntry[] = (hStore[HISTORY_KEY] as HistoryEntry[]) ?? []
  const r = item as Record<string, unknown>
  const type = String(r.type ?? 'webpage')
  const required = REQUIRED_BY_TYPE[type] ?? []
  const missingRequired = required.filter(f => {
    if (f === 'year') return !(r.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0]
    return !(fields as Record<string, { value?: string }>)?.[f]?.value && !r[f]
  })
  const entry: HistoryEntry = { id: String(r.id ?? ''), sourceUrl, type, title: String(r.title ?? ''), at: Date.now(), missingRequired, capture }
  // Prune expired entries on every write — history is short-lived by design (privacy).
  const next = [entry, ...hist.filter(h => h.sourceUrl !== sourceUrl && Date.now() - h.at < HISTORY_TTL_MS)].slice(0, 50)
  await browser.storage.local.set({ [HISTORY_KEY]: next })
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
  const capture = buildCaptureMsg(item as Record<string, unknown>, fields as Record<string, FieldEntry>, data.confidence, data.source)
  await enqueue(item, url, fields as Record<string, unknown>, data.confidence, capture)

  // Show the in-page verification panel on the source tab (AI captures only).
  if (tabId) await injectAndShowCapture(tabId, capture)

  return { ok: true, id: item.id, queued: 0 }
}
