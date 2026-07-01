// Content script injected into an open Inkwave tab. Drains the extension's citation queue and hands
// each item to the page via window.postMessage (the app validates origin + source and writes to its
// OPFS library, then acks). On ack, the item is removed from the queue. Flushes on load, on queue
// change, and when the background pokes it. See citations spec §13.

(() => {
  const QUEUE_KEY = 'inkwave:citeQueue'
  const inflight = new Set()

  async function flush() {
    const store = await chrome.storage.local.get(QUEUE_KEY)
    const q = store[QUEUE_KEY] || []
    for (const entry of q) {
      if (inflight.has(entry.uuid)) continue
      inflight.add(entry.uuid)
      // Post to the PAGE (not the isolated world). The app checks event.origin === its origin and
      // event.source === window; a content-script postMessage satisfies both.
      window.postMessage(
        { source: 'inkwave-ext', type: 'cite/upsert', uuid: entry.uuid, items: [entry.item] },
        window.location.origin,
      )
    }
  }

  // App acks → dequeue.
  window.addEventListener('message', async (e) => {
    if (e.source !== window) return
    const d = e.data
    if (!d || d.source !== 'inkwave-app' || d.type !== 'cite/ack') return
    inflight.delete(d.uuid)
    const store = await chrome.storage.local.get(QUEUE_KEY)
    const q = (store[QUEUE_KEY] || []).filter((x) => x.uuid !== d.uuid)
    await chrome.storage.local.set({ [QUEUE_KEY]: q })
  })

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'inkwave:flush') flush() })
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[QUEUE_KEY]) flush() })

  flush() // on load — drain anything queued while no tab was open
})()
