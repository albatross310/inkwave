// Content script injected into open Inkwave tabs.
// Drains the citation queue from storage, hands each item to the page via window.postMessage
// (app validates origin + source, writes to OPFS library, then acks → dequeue).
// UUID-idempotent: a re-flush re-acks without double-adding.

import { QUEUE_KEY } from '../utils/constants'

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

    // Ack from app → dequeue.
    window.addEventListener('message', async (e: MessageEvent) => {
      if (e.source !== window) return
      const d = e.data as { source?: string; type?: string; uuid?: string } | null
      if (!d || d.source !== 'inkwave-app' || d.type !== 'cite/ack' || !d.uuid) return
      inflight.delete(d.uuid)
      const store = await browser.storage.local.get(QUEUE_KEY)
      const q: Array<{ uuid: string }> = (store[QUEUE_KEY] as typeof q) ?? []
      await browser.storage.local.set({ [QUEUE_KEY]: q.filter(x => x.uuid !== d.uuid) })
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
