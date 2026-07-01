// App-side receiver for the browser-extension bridge. The Inkwave extension (Phase 2) captures a
// citation on any page, queues it in chrome.storage.local, and — via a content script injected into
// an open inkwave.me tab — hands it to the page with window.postMessage. This module listens for
// those messages, validates them, writes into the native library, and acks so the extension can
// dequeue. UUID-idempotent so a re-flush can't duplicate. See citations spec §13.
//
// SECURITY: the content script runs in the page context, so a genuine message has
// event.origin === this origin AND event.source === window. Both are checked. (A pairing-token /
// nonce is the M6 hardening once auth exists; pre-auth this is device-local, same trust as OPFS.)

import type { CSLItem } from '../types/document'
import { addToLibrary } from './library'

const EXT_SOURCE = 'inkwave-ext'
const APP_SOURCE = 'inkwave-app'

export interface ExtUpsertMessage {
  source: typeof EXT_SOURCE
  type: 'cite/upsert'
  uuid: string
  items: CSLItem[]
}

export function isExtUpsert(d: unknown): d is ExtUpsertMessage {
  if (!d || typeof d !== 'object') return false
  const m = d as Record<string, unknown>
  return m.source === EXT_SOURCE
    && m.type === 'cite/upsert'
    && typeof m.uuid === 'string'
    && Array.isArray(m.items)
    && (m.items as unknown[]).every(it => !!it && typeof it === 'object' && typeof (it as CSLItem).id === 'string')
}

// uuid → the citekeys stored for it, so a re-flush (extension missed the first ack) re-acks with
// the same result and dequeues, rather than being ignored into an infinite re-send loop.
const applied = new Map<string, string[]>()

function ack(uuid: string, stored: string[]): void {
  if (typeof window !== 'undefined') {
    window.postMessage({ source: APP_SOURCE, type: 'cite/ack', uuid, stored }, window.location.origin)
  }
}

/**
 * Start listening for extension citation messages. Returns an unsubscribe. Safe to call in SSR
 * (no-op). Exposed handler is also unit-testable via handleExtensionMessage.
 */
export function startExtensionChannel(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onMessage = (e: MessageEvent) => { void handleExtensionMessage(e) }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

/** Validate + apply one message. Returns the stored citekeys, or null if the message was rejected. */
export async function handleExtensionMessage(e: MessageEvent): Promise<string[] | null> {
  // Reject cross-origin or cross-window messages outright.
  if (typeof window !== 'undefined' && (e.origin !== window.location.origin || e.source !== window)) return null
  if (!isExtUpsert(e.data)) return null

  // Idempotent: a re-flush of an already-applied uuid re-acks with the same result so the
  // extension dequeues (rather than being ignored and re-sending forever).
  const prior = applied.get(e.data.uuid)
  if (prior) { ack(e.data.uuid, prior); return prior }

  const stored: string[] = []
  for (const item of e.data.items) {
    try { stored.push((await addToLibrary(item)).id) } catch { /* skip malformed */ }
  }
  applied.set(e.data.uuid, stored)
  ack(e.data.uuid, stored)
  return stored
}
