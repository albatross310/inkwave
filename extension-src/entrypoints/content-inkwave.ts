// Content script injected into open Inkwave tabs.
// Drains the citation queue from storage, hands each item to the page via window.postMessage
// (app validates origin + source, writes to OPFS library, then acks → dequeue).
// UUID-idempotent: a re-flush re-acks without double-adding.

import { QUEUE_KEY, HISTORY_KEY, HISTORY_TTL_MS } from '../utils/constants'
import {
  BG_ALLOW_FRAME, BG_CLEAR_FRAME,
  BG_FETCH_PAGE, BG_OPEN_POPUP, BG_READER_STATUS, EXT_SOURCE, READER_FETCH, READER_FETCHED,
  READER_FRAME, READER_FRAMED, READER_UNFRAME,
  READER_GRANT, READER_GRANTED, READER_PING, READER_PONG, type FetchPageResult, type ReaderStatus,
} from '@inkwave/reader/extensionProtocol'

type HistoryEntry = { id: string; sourceUrl: string; type: string; title: string; at: number; missingRequired: string[]; capture?: unknown }

export default defineContentScript({
  matches: ['https://iwzero.me/*', 'https://inkwave.studio/*', 'http://localhost:5173/*'],
  runAt: 'document_idle',
  main() {
    const inflight = new Set<string>()

    async function flush() {
      const store = await browser.storage.local.get(QUEUE_KEY)
      const q: Array<{ uuid: string; item: object; sourceUrl?: string; at?: number }> =
        (store[QUEUE_KEY] as typeof q) ?? []

      for (const entry of q) {
        if (inflight.has(entry.uuid)) continue
        inflight.add(entry.uuid)

        const rawItem = (entry.item ?? {}) as Record<string, unknown>
        const iw = { ...(rawItem['_iw'] as object || {}) } as Record<string, unknown>
        if (entry.sourceUrl && !iw['sourceUrl']) iw['sourceUrl'] = entry.sourceUrl
        if (entry.at && !iw['addedAt']) iw['addedAt'] = new Date(entry.at).toISOString()
        const item = { ...rawItem, _iw: iw }

        window.postMessage(
          { source: 'inkwave-ext', type: 'cite/upsert', uuid: entry.uuid, items: [item] },
          window.location.origin,
        )
      }
    }

    // Messages from app → extension relay.
    window.addEventListener('message', async (e: MessageEvent) => {
      if (e.source !== window) return
      const d = e.data as { source?: string; type?: string; uuid?: string; capture?: unknown; url?: string } | null
      if (!d || d.source !== 'inkwave-app') return

      // ── THE SOURCE READER'S FETCH RELAY ──────────────────────────────────────────────────────
      // Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" — the app
      // asks here, this relays to the background worker, and the request leaves the writer's own
      // browser instead of a data centre the search engines refuse.
      //
      // ⚠ THE PING EXISTS SO THE PAGE CAN *ASK*. A page that waits to be told the extension is here
      // loses to the ordinary race — a content script injected after the app mounted has already
      // said its piece — and a promise that never settles is indistinguishable from a feature
      // nobody built. So the app asks, keyed by uuid, and silence within its deadline is an answer.
      if (d.type === READER_PING && d.uuid) {
        const st = await browser.runtime.sendMessage({ type: BG_READER_STATUS })
          .catch(() => null) as ReaderStatus | null
        window.postMessage(
          { source: EXT_SOURCE, type: READER_PONG, uuid: d.uuid, canFetch: !!st?.canFetch },
          window.location.origin,
        )
        return
      }

      if (d.type === READER_FETCH && d.uuid && d.url) {
        // A relay failure is reported as a failure, never as silence: the app falls back to the
        // server on it, and a dropped reply would instead hang until its own timeout.
        const r = await browser.runtime.sendMessage({ type: BG_FETCH_PAGE, url: d.url })
          .catch(() => ({ ok: false, error: 'extension unavailable' })) as FetchPageResult
        window.postMessage(
          { source: EXT_SOURCE, type: READER_FETCHED, uuid: d.uuid, ...r },
          window.location.origin,
        )
        return
      }

      // The reader offering the permission AT THE MOMENT IT WOULD HELP. All this can do is ask the
      // background worker to open the popup — the actual grant must happen inside an extension
      // page, and no message can move that boundary.
      if (d.type === READER_GRANT && d.uuid) {
        const r = await browser.runtime.sendMessage({ type: BG_OPEN_POPUP })
          .catch(() => ({ ok: false })) as { ok?: boolean } | null
        window.postMessage(
          { source: EXT_SOURCE, type: READER_GRANTED, uuid: d.uuid, ok: !!r?.ok },
          window.location.origin,
        )
        return
      }

      // ── LIVE VIEW ──────────────────────────────────────────────────────────────────────────────
      // The panel asking to be allowed to frame ONE page, and releasing it when it closes. The
      // rule's scoping lives in the worker (frameRuleFor) rather than here, because a content
      // script runs in the page and anything it decides is a decision the page could have made.
      if (d.type === READER_FRAME && d.uuid && d.url) {
        const r = await browser.runtime.sendMessage({ type: BG_ALLOW_FRAME, url: d.url })
          .catch(() => ({ ok: false, error: 'extension unavailable' })) as { ok?: boolean; error?: string } | null
        window.postMessage(
          { source: EXT_SOURCE, type: READER_FRAMED, uuid: d.uuid, ok: !!r?.ok, error: r?.error },
          window.location.origin,
        )
        return
      }

      // ⚠ FIRE-AND-FORGET, DELIBERATELY. The release runs from the panel's teardown — and on a tab
      // close there is no later turn in which to receive a reply. Waiting for an ack here would
      // make the common path the one that never completes. The session-rule lifetime is the
      // backstop: it cannot outlive the browser session even if this message is lost.
      if (d.type === READER_UNFRAME) {
        void browser.runtime.sendMessage({ type: BG_CLEAR_FRAME }).catch(() => {})
        return
      }

      if (d.type === 'cite/ack' && d.uuid) {
        // Ack from app → write to history then dequeue.
        inflight.delete(d.uuid)
        const [qStore, hStore] = await Promise.all([
          browser.storage.local.get(QUEUE_KEY),
          browser.storage.local.get(HISTORY_KEY),
        ])
        const q: Array<{ uuid: string; item?: Record<string, unknown>; sourceUrl?: string }> = (qStore[QUEUE_KEY] as typeof q) ?? []
        const entry = q.find(x => x.uuid === d.uuid)
        if (entry?.sourceUrl && entry.item) {
          const hist: HistoryEntry[] = (hStore[HISTORY_KEY] as HistoryEntry[]) ?? []
          const prev = hist.find(h => h.sourceUrl === entry.sourceUrl)
          const he: HistoryEntry = {
            id: String(entry.item.id ?? ''),
            sourceUrl: entry.sourceUrl,
            type: String(entry.item.type ?? 'webpage'),
            title: String(entry.item.title ?? ''),
            at: Date.now(),
            missingRequired: [],
            capture: prev?.capture, // preserve the full CaptureMsg written by background on enqueue
          }
          // Prune expired entries on every write — history is short-lived by design (privacy).
          const nextHist = [he, ...hist.filter(h => h.sourceUrl !== entry.sourceUrl && Date.now() - h.at < HISTORY_TTL_MS)].slice(0, 50)
          await browser.storage.local.set({ [HISTORY_KEY]: nextHist })
        }
        await browser.storage.local.set({ [QUEUE_KEY]: q.filter(x => x.uuid !== d.uuid) })
      }

      if (d.type === 'cite/visitSource' && d.url && d.capture) {
        // App opened a source URL — tell background to watch for that tab opening and show the panel.
        browser.runtime.sendMessage({ type: 'inkwave:watchPanel', url: d.url, capture: d.capture }).catch(() => {})
      }
    })

    browser.runtime.onMessage.addListener((msg: unknown) => {
      if ((msg as { type?: string })?.type === 'inkwave:flush') flush()
    })

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && QUEUE_KEY in changes) flush()
    })

    flush()
  },
})
