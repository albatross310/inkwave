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
  BG_ALLOW_FRAME, BG_CLEAR_FRAME,
  BG_FETCH_FILE, BG_FETCH_PAGE, BG_OPEN_POPUP, BG_READER_STATUS, NEEDS_PERMISSION,
  type FetchFileResult, type FetchPageResult, type ReaderStatus,
} from '@inkwave/reader/extensionProtocol'
// ⚠ THE RULE SHAPE IS DEFINED IN src/, NOT HERE. Same reason the wire names are (see the header of
// extensionProtocol.ts): the extension imports from src/ and never the reverse, so one definition
// serves both — and, decisively for this one, the gate can then check the SHIPPED rule rather than
// a restatement of it. A copy of the expected shape in a test passes for ever while the real rule
// drifts underneath it; that is the pmToText/textMap trap this repo already carries a guard for.
import { frameRuleFor, frameRuleIdFor } from '@inkwave/reader/framingRule'
import { assertFetchable, bytesToBase64, checkPdfBytes, decodeHtml, READER_ACCEPT } from '@inkwave/reader/fetchRules'

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
  // ── ASK FOR PAGE FETCHING AT INSTALL, RATHER THAN LEAVING IT TO BE DISCOVERED ────────────────
  // Peter, 2026-08-30: "can we turn this on by default". The permission itself stays OPTIONAL —
  // the long argument in wxt.config.ts still holds, and a REQUIRED `<all_urls>` rewrites the
  // install prompt into "Read and change all your data on all websites" for everyone and forces
  // Chrome to disable existing installs pending re-approval. What was actually wrong is that the
  // grant was HIDDEN: the one control that turns on the reader's whole point lived in a popup
  // behind the puzzle-piece icon, which Peter had to be told twice how to find.
  //
  // An optional permission nobody is offered is a feature nobody has. So the popup is opened once,
  // at install, where the grant button already lives — same button, same gesture, no new
  // capability, and the writer can still decline. `permissions.request()` cannot be called from
  // here (Chrome honours it only from a user gesture inside an extension page), which is exactly
  // why this opens the page that CAN ask rather than trying to grant anything itself.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return          // not on every update — that would be a nag
    void (async () => {
      // Only if it is not already granted: a reinstall over an existing grant should be silent.
      if (await canFetchPages()) return
      // A TAB, not action.openPopup(): openPopup is recent, absent under this name on MV2 Firefox,
      // and refuses when the window is not focused — which an install often is not. A tab always
      // opens, and it is the same popup document either way.
      await browser.tabs.create({ url: browser.runtime.getURL('popup.html') }).catch(() => {})
    })()
  })

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

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

    // The source panel asking for the PDF it is looking at, so it can become a citable source.
    if (m.type === BG_FETCH_FILE && typeof m.url === 'string') {
      fetchFileForReader(m.url)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: String((e as Error)?.message || e) } satisfies FetchFileResult))
      return true
    }

    // ── LIVE VIEW ────────────────────────────────────────────────────────────────────────────────
    // See the note above frameRuleFor for the three restrictions and what they are each for.
    // ⚠ `ok: true` means A RULE WAS INSTALLED. It does not mean the page will render: a site can
    // still refuse in its body (facebook does), serve a CAPTCHA (google did), or render signed out
    // (anything behind a login, because Lax cookies do not survive a third-party frame). The panel
    // must not report success on the strength of this.
    if (m.type === BG_ALLOW_FRAME && typeof m.url === 'string') {
      allowFraming(m.url, sender.tab?.id)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: String((e as Error)?.message || e) }))
      return true
    }

    if (m.type === BG_CLEAR_FRAME) {
      clearFraming(sender.tab?.id).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }))
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

// ── LIVE VIEW: LETTING ONE PAGE BE FRAMED ───────────────────────────────────────────────────────
// Peter, 2026-08-30: "build the extension." The full argument, the measurements and the honest
// limits live in src/reader/extensionProtocol.ts; the short version is that `X-Frame-Options` and
// CSP `frame-ancestors` are enforced by the BROWSER, so a web page can never opt out of another
// site's refusal, and an extension can.
//
// ⚠ THREE RESTRICTIONS, AND EACH ONE IS LOAD-BEARING. Removing framing protection browser-wide
// would make every site the writer visits clickjackable — a citation tool becoming a hazard on
// pages it has nothing to do with. So:
//   1. SESSION rules (`updateSessionRules`), never a static ruleset: they die with the browser
//      session even if a crash means nothing ever calls clearFraming().
//   2. `initiatorDomains: APP_INITIATORS` — the rule applies ONLY to a frame Inkwave itself
//      created. The same page opened in the writer's own tab is untouched, because there the
//      initiator is that page, not us.
//   3. `resourceTypes: ['sub_frame']` — a top-level navigation is never rewritten.
// `frameRuleFor` is exported-by-convention for the unit guard, which asserts a rule can never be
// built without all three. A "temporary" rule that outlives the panel is the bug this shape exists
// to prevent, and it is not the kind of bug you notice by using the app.
type DnrApi = {
  updateSessionRules?: (o: { addRules?: unknown[]; removeRuleIds?: number[] }) => Promise<void>
}
const dnr = (): DnrApi | null =>
  (browser as unknown as { declarativeNetRequest?: DnrApi }).declarativeNetRequest ?? null

/** Install the framing rule for ONE host. Replaces any previous one — the panel shows a single
 *  page at a time, so a second call means the writer navigated, not that they want both. */
async function allowFraming(rawUrl: string, tabId: number | undefined): Promise<void> {
  const api = dnr()
  if (!api?.updateSessionRules) throw new Error('declarativeNetRequest unavailable')
  // The url is still PARSED even though the rule no longer narrows by host: a caller that hands us
  // something unparseable is a caller whose request we do not understand, and installing a
  // framing rule on the strength of it is exactly the kind of thing that should fail loudly.
  // (See framingRule.ts for why the host is no longer part of the condition — clicking through to
  // a sibling subdomain broke, and initiatorDomains is what actually bounds this.)
  if (!new URL(rawUrl).hostname) throw new Error('no host')
  // ⚠ THE TAB IS THE SCOPE, so no tab means no rule — never a wider one. A message with no sender
  // tab is not a reader asking politely; it is a request we cannot account for, and the failure
  // mode of guessing here is a framing rule with no owner.
  if (typeof tabId !== 'number') throw new Error('no tab')
  // Replaces only THIS tab's slot, so a second Inkwave window keeps its own live view.
  await api.updateSessionRules({ removeRuleIds: [frameRuleIdFor(tabId)], addRules: [frameRuleFor(tabId)] })
}

/** Drop it. Called when the panel closes, when it navigates away from live view, and on unload. */
async function clearFraming(tabId: number | undefined): Promise<void> {
  const api = dnr()
  if (!api?.updateSessionRules) return
  // ⚠ ONLY THIS TAB'S RULE. A bare remove-all here is the bug Peter named before it bit him:
  // closing the panel in one window would drop live view in every other, silently, with the
  // refusal card as the only symptom. No tab id ⇒ remove NOTHING, because a release we cannot
  // attribute must not be allowed to cancel someone else's.
  if (typeof tabId !== 'number') return
  await api.updateSessionRules({ removeRuleIds: [frameRuleIdFor(tabId)] })
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

// A file is slower than a page and the writer pressed a button for it, so it gets its own, longer
// deadline. Not unlimited: a request that will never answer must still stop and say so.
const READER_FILE_TIMEOUT_MS = 60_000

/**
 * Fetch a PDF on the writer's behalf, for the source panel's "save this to my sources".
 *
 * ⚠ THE WHOLE REASON THIS IS HERE AND NOT IN THE PAGE. A publisher's PDF is cross-origin and almost
 * never sends `Access-Control-Allow-Origin`, so `fetch` from Inkwave's own origin is refused by the
 * browser before the response is readable. The worker holds `<all_urls>`, so it is not — and it is
 * the writer's own address and the writer's own browser doing it, which is the same posture the
 * page fetch already documents.
 *
 * Every refusal is a SHORT CODE the panel maps to a sentence, exactly as `fetchPageForReader` does.
 * Nothing is logged: a console line in a service worker is a record of what was read.
 */
async function fetchFileForReader(rawUrl: string): Promise<FetchFileResult> {
  let url: URL
  try { url = assertFetchable(rawUrl) } catch (e) { return { ok: false, error: String((e as Error).message) } }
  if (!await canFetchPages()) return { ok: false, error: NEEDS_PERMISSION }

  try {
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(READER_FILE_TIMEOUT_MS),
      headers: { accept: 'application/pdf,*/*;q=0.8' },
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    const buf = await res.arrayBuffer()
    // Throws `too large` / `not a pdf` — the two refusals that can only be made once the body is
    // in hand, and both decided by the BYTES rather than by a header a server may lie about.
    const bytes = checkPdfBytes(buf)
    return {
      ok: true,
      finalUrl: res.url || url.toString(),
      mime: res.headers.get('content-type') || 'application/pdf',
      size: bytes.byteLength,
      b64: bytesToBase64(bytes),
    }
  } catch (e) {
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
