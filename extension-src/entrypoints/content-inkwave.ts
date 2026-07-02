// Content script injected into open Inkwave tabs.
// Drains the citation queue from storage, hands each item to the page via window.postMessage
// (app validates origin + source, writes to OPFS library, then acks → dequeue).
// UUID-idempotent: a re-flush re-acks without double-adding.

import { QUEUE_KEY, HISTORY_KEY } from '../utils/constants'

type HistoryEntry = { id: string; sourceUrl: string; type: string; title: string; at: number; missingRequired: string[] }

export default defineContentScript({
  matches: ['https://inkwave.me/*', 'http://localhost:5173/*'],
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
          const he: HistoryEntry = {
            id: String(entry.item.id ?? ''),
            sourceUrl: entry.sourceUrl,
            type: String(entry.item.type ?? 'webpage'),
            title: String(entry.item.title ?? ''),
            at: Date.now(),
            missingRequired: [],
          }
          const nextHist = [he, ...hist.filter(h => h.sourceUrl !== entry.sourceUrl)].slice(0, 50)
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
