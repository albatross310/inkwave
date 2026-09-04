// A TAB'S DOCUMENT IDENTITY — per-tab by construction.
//
// ⚠ DOCUMENT IDENTITY IS PER TAB, CARRIED IN sessionStorage, NEVER THE URL. One origin-wide
// localStorage pointer meant tab B's new document silently re-pointed tab A, which then adopted it
// on reload and orphaned its own work. sessionStorage survives the OneDrive OAuth round-trip, which
// returns to a bare `/` with any `?doc=` gone; the URL is a reflection, never load-bearing.
//
// PRECEDENCE — `?doc=` ?? sessionStorage ?? last-doc hint (new tabs only). An ABSENT `?doc=` means
// "no opinion", never "no document", so it must never clear the tab's identity.
// → docs/archive/storage-and-sync.md#tabdoc-identity

import { flushPendingSave } from './opfs'
import type { InkwaveDocument } from '../types/document'

const TAB_KEY = 'inkwave:tabDocumentId' // sessionStorage — per tab, the source of truth
const LAST_KEY = 'inkwave:activeDocumentId' // localStorage — recency metadata, never a boot pointer
const URL_PARAM = 'doc'

export type DocIdSource = 'url' | 'tab' | 'last-hint' | 'none'

/**
 * Did the writer EXPLICITLY ask for this document, or did a brand-new tab merely inherit the
 * origin-wide last-doc hint? Only an explicit open earns the "open in another window" screen: a
 * hint-only tab had no opinion about THIS file and must fall through, never be blocked on one it
 * didn't choose. → docs/archive/storage-and-sync.md#tabdoc-identity
 */
export function isExplicitDocIntent(source: DocIdSource): boolean {
  return source === 'url' || source === 'tab'
}

/**
 * A held document for which a collision screen adds no safety: the untouched ordinary-document
 * default. A duplicate/new tab should get its own fresh id instead of asking the writer to switch,
 * copy or steal an empty page.
 *
 * Title alone is deliberately insufficient. A writer can leave a real document named Untitled;
 * once it contains anything, the one-live-writer protection applies exactly as before.
 */
export function isBlankUntitledDocument(
  doc: Pick<InkwaveDocument, 'title' | 'contentJson'>,
): boolean {
  if (doc.title.trim().toLowerCase() !== 'untitled') return false
  const content = doc.contentJson
  const children = content?.content
  if (content?.type !== 'doc' || !Array.isArray(children) || children.length !== 1) return false
  const only = children[0]
  return only?.type === 'paragraph' && (!Array.isArray(only.content) || only.content.length === 0)
}

/**
 * THE LIVE KNOWN-NEGATIVE. `window.__iwTabDocRule = 'shared'` restores the OLD behaviour — one
 * origin-wide pointer, no per-tab identity, no document claim — so the repro can re-create the data
 * loss in the SAME build it then proves fixed. Keep it reachable: a probe that only ever runs
 * against the fixed build cannot tell "the fix works" from "the probe cannot see the bug".
 * Never referenced outside the reads below; absent ⇒ the fix is on.
 * → docs/archive/storage-and-sync.md#tabdoc-known-negative
 */
function legacySharedRule(): boolean {
  try { return (window as unknown as { __iwTabDocRule?: string }).__iwTabDocRule === 'shared' } catch { return false }
}

function readSession(): string | null {
  try { return sessionStorage.getItem(TAB_KEY) } catch { return null } // private mode
}

function readUrl(): string | null {
  try { return new URL(window.location.href).searchParams.get(URL_PARAM) } catch { return null }
}

/** The document this TAB owns, if it has claimed one. */
export function tabDocId(): string | null {
  if (typeof window === 'undefined') return null
  return readSession()
}

/** The last document touched by any tab — ONLY for giving a brand-new tab a starting point. */
export function lastDocHint(): string | null {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

/** Which document should THIS tab open on boot, and why. See the precedence note above. */
export function resolveTabDocId(): { id: string | null; source: DocIdSource } {
  if (typeof window === 'undefined') return { id: null, source: 'none' }
  // KNOWN-NEGATIVE: the pre-fix rule — every tab reads the one shared pointer.
  if (legacySharedRule()) {
    const hint = lastDocHint()
    return hint ? { id: hint, source: 'last-hint' } : { id: null, source: 'none' }
  }
  const fromUrl = readUrl()
  if (fromUrl) return { id: fromUrl, source: 'url' }
  const fromTab = readSession()
  if (fromTab) return { id: fromTab, source: 'tab' }
  // ⚠ A NEW TAB OPENS BLANK — never from `lastDocHint()`, which made every new tab an attempt to
  // reopen the one document another tab already held. Reading the tab's identity and nothing else
  // IS both behaviours Peter asked for: a hard refresh keeps its document (sessionStorage survives),
  // a new tab is blank and can collide with nothing.
  // → docs/archive/storage-and-sync.md#tabdoc-new-tab-blank
  return { id: null, source: 'none' }
}

/** Reflect the tab's document in the URL — self-describing + bookmarkable. Never load-bearing. */
function syncUrl(id: string): void {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get(URL_PARAM) === id) return
    url.searchParams.set(URL_PARAM, id)
    // replaceState: this is a re-description of where we already are, not a navigation — it must
    // not create a history entry the writer has to press Back through.
    window.history.replaceState(window.history.state, '', url.toString())
  } catch { /* history/URL unavailable — the tab identity does not depend on this */ }
}

/**
 * THIS TAB now owns `id`. Writes the per-tab identity (authoritative), records the most-recent
 * document, and reflects it in the URL. The localStorage record is a "where was I" for the Storage
 * panel and the recent list; NOTHING BOOTS FROM IT (see resolveTabDocId).
 */
export function claimTabDoc(id: string): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(TAB_KEY, id) } catch { /* private mode */ }
  try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  syncUrl(id)
  void adoptDocLock(id) // this tab owns `id` now — and owns nothing else (see below)
}

/**
 * Point THIS TAB at `id` and reload, so the editor's loader opens it cleanly. ONE switch path,
 * shared by OptionsMenu (New / Open Recent) and OpfsInspector's "Open".
 *
 * ⚠ THE FLUSH IS A DATA-LOSS GUARD, not a nicety — reloading with a debounced save still pending
 * throws that save away. Flush FIRST and, on failure, ABORT the switch and say so; never weaken it
 * to fire-and-forget. → docs/archive/storage-and-sync.md#tabdoc-switch-flush
 */
export function switchTabToDocument(id: string): void {
  claimTabDoc(id) // claim before the reload — the reloaded page reads the per-tab identity
  void (async () => {
    try { await flushPendingSave() } catch (err) {
      alert(`Your latest changes could not be saved, so the switch was cancelled.\n\n${String(err)}`)
      return
    }
    window.location.reload()
  })()
}

// ─── ONE LIVE TAB PER DOCUMENT ────────────────────────────────────────────────
//
// ⚠ `saveDocument` writes the WHOLE document file with no union, no generation check and no lock,
// so two tabs on one document autosave over each other and one tab's words are destroyed. This
// PREVENTS that race rather than reacting to it: a document is claimed by at most one live tab.
// (The snapshot ARCHIVE has its own guard — grow-only. The document BODY has only this one.)
//
// ⚠ NO WEB LOCKS ⇒ NEVER BLOCK THE WRITER. Every engine we ship to has them (probed, all three
// refuse a second tab), so the fallback is dead code — keep it anyway: it is the difference between
// an unknown engine degrading to today's behaviour and it locking a writer out of their own file.
// → docs/archive/storage-and-sync.md#tabdoc-one-live-tab

/**
 * The Web Lock name that means "a live tab is holding this document".
 *
 * ⚠ EXPORTED ON PURPOSE — it must stay the ONE definition. OpfsInspector reads the lock registry via
 * `navigator.locks.query()` to badge "open in another tab", so a private copy of this string would
 * not break loudly: the badge would simply never light again, which looks exactly like "no other tab
 * has it open". → docs/archive/storage-and-sync.md#tabdoc-lock-name
 */
export const DOC_LOCK_PREFIX = 'inkwave:doc:'

/** The lock name for a document id. */
export const docLockName = (id: string): string => `${DOC_LOCK_PREFIX}${id}`

type LockManagerLike = {
  request: (
    name: string,
    opts: { ifAvailable?: boolean; steal?: boolean },
    fn: (lock: unknown) => Promise<void> | void,
  ) => Promise<unknown>
}

const held = new Map<string, () => void>() // docId → release this tab's claim

// STOLEN-LOCK NOTIFICATION. A steal REJECTS the outgoing holder's request promise, so it is
// observable here with no polling; singleOpen.ts freezes this tab's writes on it. Belt-and-braces
// behind the BroadcastChannel handshake, and the ONLY signal on the degraded path.
// → docs/archive/storage-and-sync.md#tabdoc-lock-lost
let lostLockCb: ((id: string) => void) | null = null
export function onDocLockLost(cb: (id: string) => void): void { lostLockCb = cb }

function lockManager(): LockManagerLike | null {
  try {
    const l = (navigator as unknown as { locks?: LockManagerLike }).locks
    return l && typeof l.request === 'function' ? l : null
  } catch { return null }
}

function tryClaimOnce(locks: LockManagerLike, id: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let granted = false // did WE ever hold this lock? (distinguishes a steal from a request failure)
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    void locks
      .request(docLockName(id), { ifAvailable: true }, (lock) => {
        if (!lock) { done(false); return } // another LIVE tab holds this document
        // The callback's promise IS the lock's lifetime, so keep it pending until releaseDocLock().
        granted = true
        return new Promise<void>((release) => {
          held.set(id, () => { held.delete(id); release() })
          done(true)
        })
      })
      // A rejection AFTER we held the lock is a STEAL: drop the bookkeeping and notify. A rejection
      // BEFORE is a LockManager failure, which must never stand between the writer and their
      // document — resolve as "yours" and carry on.
      .catch(() => {
        if (granted) { held.delete(id); lostLockCb?.(id) }
        done(true)
      })
  })
}

/**
 * STEAL `id`'s lock for THIS tab — the mechanism behind "Take over here". The preempted holder's own
 * request promise rejects (see tryClaimOnce), so the loser learns it lost with no BroadcastChannel.
 *
 * ⚠ A STEAL DOES NOT ORDER THE HANDOFF — it takes the lock now, while the loser's rejection lands a
 * task later. singleOpen.ts waits for the surrender ACK before it lets the editor write.
 * → docs/archive/storage-and-sync.md#tabdoc-steal
 */
export async function stealDocLock(id: string): Promise<boolean> {
  if (typeof window === 'undefined') return true
  if (legacySharedRule()) return true
  const locks = lockManager()
  if (!locks) return true // no Web Locks — nothing to steal; the caller proceeds (degraded)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    void locks
      .request(docLockName(id), { steal: true }, () =>
        new Promise<void>((release) => {
          held.set(id, () => { held.delete(id); release() })
          done(true)
        }),
      )
      // Even a failed steal must not block the writer — the take-over screen has no better fallback
      // than to let them proceed, and a document they cannot open is its own disaster.
      .catch(() => done(true))
  })
}

/**
 * Claim `id` for THIS tab. Resolves false only when another LIVE tab is holding it.
 *
 * ⚠ IT MUST RETRY. A reload releases the outgoing page's lock as it unloads, which can land AFTER
 * the incoming page asks — without the retry a plain refresh intermittently reads as "another tab
 * has this document" and hands the writer a blank page instead of their thesis.
 * → docs/archive/storage-and-sync.md#tabdoc-claim-retry
 */
export async function claimDocLock(id: string, waitMs = 1500): Promise<boolean> {
  if (typeof window === 'undefined') return true
  if (legacySharedRule()) return true // KNOWN-NEGATIVE: pre-fix, nothing claimed anything
  if (held.has(id)) return true
  const locks = lockManager()
  if (!locks) return true // no Web Locks (older WebKit) — cannot detect; never block the writer
  const deadline = Date.now() + waitMs
  for (;;) {
    if (await tryClaimOnce(locks, id)) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Drop this tab's claim on `id` (switching documents in place). */
export function releaseDocLock(id: string): void {
  held.get(id)?.()
}

/** This tab owns `id` and nothing else — used by the in-place document switch (openDoc.ts). */
async function adoptDocLock(id: string): Promise<void> {
  for (const other of [...held.keys()]) if (other !== id) releaseDocLock(other)
  await claimDocLock(id)
}

/** Test seam: which documents this tab currently holds. */
export function heldDocIds(): string[] {
  return [...held.keys()]
}
