// A TAB'S DOCUMENT IDENTITY — per-tab by construction.
//
// THE BUG THIS EXISTS TO MAKE IMPOSSIBLE (Peter, 2026-07-17; reproduced by
// scripts/tabdoc-probe/repro.mjs on BOTH Chromium and Firefox before this module existed):
//
//   "separate tabs don't appear to remember that they are supposed to be working on different
//    documents and as a result, if you create a new document but forget to sync it up, refreshing
//    the page can bring up the opfs from the synced document on another tab and overwrite your
//    progress."
//
// `inkwave:activeDocumentId` is ONE localStorage slot for the whole ORIGIN. Every tab wrote it on
// every document switch, and every tab read it on every boot. So tab B creating a document
// silently re-pointed tab A, and tab A adopted B's document on its next reload — leaving A's own
// work ORPHANED on disk (intact, but unreachable by any tab: that is the shape of the loss) and
// two tabs blind-autosaving one file.
//
// WHY sessionStorage IS THE CARRIER, AND THE URL IS NOT:
// The hard case Peter named is the OAuth round-trip — "even if you leave to go to microsofts page
// or whatever to log in". OneDrive sign-in is `msal.loginRedirect` with
// `redirectUri: window.location.origin` (storage/onedrive.ts) — a FULL-PAGE navigation off-origin
// that returns to a BARE `/`. Any doc id carried in the query string is GONE on return.
// sessionStorage is scoped per-tab per-origin and SURVIVES that round-trip, so it is the source of
// truth. The URL is a secondary, human-visible reflection: it makes a tab self-describing and
// bookmarkable, but nothing depends on it surviving. (CLAUDE.md round-8 bug 2 is the precedent for
// not trusting the URL: /snapshot's local-first nav rewrites it, and a flag read from the URL died
// mid-session.)
//
// PRECEDENCE — url ?? session ?? blank:
//   1. `?doc=<id>`  an EXPLICIT request for a document (a link, a bookmark, a duplicated tab).
//                   Absent means "no opinion" — NOT "no document" — which is exactly the state the
//                   OAuth return lands in, so an absent param must never clear the tab's identity.
//   2. sessionStorage  THIS TAB's own document. Survives reload AND the OAuth round-trip.
//   3. no identity     open a fresh blank. The origin-wide last-document value remains useful to
//                      Storage/recent-document UI, but never decides what a new tab edits.

import { flushPendingSave } from './opfs'
import type { InkwaveDocument } from '../types/document'

const TAB_KEY = 'inkwave:tabDocumentId' // sessionStorage — per tab, the source of truth
const LAST_KEY = 'inkwave:activeDocumentId' // localStorage — recency metadata, never a boot pointer
const URL_PARAM = 'doc'

export type DocIdSource = 'url' | 'tab' | 'last-hint' | 'none'

/**
 * Did the writer EXPLICITLY ask for this document, or did a brand-new tab merely inherit the
 * origin-wide last-doc hint? Only an explicit open — a `?doc=` link/bookmark ('url') or this tab's
 * own remembered identity ('tab') — earns the "open in another window" screen when the document is
 * held elsewhere. A hint-only tab had no opinion about THIS file, so it should fall through to the
 * next document no live tab holds, never be blocked on one it didn't choose.
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
 * origin-wide pointer, no per-tab identity, no document claim.
 *
 * It exists because of round 11's lesson and round 12's: a probe that only ever runs against the
 * FIXED build cannot tell "the fix works" from "the probe cannot see the bug". This lets the
 * reproduction re-create the data loss in the SAME build it then proves fixed, so the negative is
 * one flag away from firing forever — not a green line whose failure mode is untested. The probe
 * (scripts/tabdoc-probe/repro.mjs, cell N) REQUIRES this to lose data before it reads any verdict.
 *
 * Never referenced by product code paths other than the two reads below; absent ⇒ the fix is on.
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
  // ⚠ A NEW TAB OPENS BLANK (2026-08-28, Peter: "when I open a new tab it always keeps reverting to
  // this one thing Honours Proposal … what we need is for new tabs to open as blank and to make
  // sure multiple tabs on different docs never overlap if hard refreshed").
  //
  // The last-document hint used to answer here, and it was the wrong shape of helpful: it made
  // EVERY new tab an attempt to reopen the same document, which then collided with the tab that
  // already had it — the one-live-tab lock fired, the second tab was told to switch or copy, and
  // the writer had to fight their way to a blank page. A hint that guesses right once and wrong
  // every time after that is a worse default than no guess.
  //
  // The two behaviours he asked for are exactly sessionStorage's own semantics, so the rule is now
  // just "read the tab's identity, and nothing else":
  //   • HARD REFRESH → sessionStorage survives ⇒ the same document, every time.
  //   • NEW TAB      → sessionStorage is empty ⇒ blank, and it can collide with nothing.
  // `lastDocHint()` is kept: it still records where the writer was, and the Storage panel lists
  // every document — but nothing BOOTS from it any more.
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
 * document, and reflects it in the URL.
 *
 * The localStorage record is still written — it is a useful "where was I", and the Storage panel
 * and the recent list read it — but NOTHING BOOTS FROM IT any more (see resolveTabDocId). A new tab
 * opens blank; only this tab's own sessionStorage, or an explicit ?doc=, decides what it shows.
 */
export function claimTabDoc(id: string): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(TAB_KEY, id) } catch { /* private mode */ }
  try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  syncUrl(id)
  void adoptDocLock(id) // this tab owns `id` now — and owns nothing else (see below)
}

/**
 * Point THIS TAB at `id` and reload, so the editor's loader opens it cleanly.
 *
 * THE FLUSH IS A DATA-LOSS GUARD (2026-07-10), not a nicety: reloading with a debounced save still
 * pending throws that save away — it cost Peter half an hour of real work. So flush FIRST and, on
 * failure, ABORT the switch and say so. Never weaken this to fire-and-forget: a switch that
 * silently eats the OUTGOING document would create exactly the loss the inspector exists to undo.
 *
 * Shared by OptionsMenu (New / Open Recent) and OpfsInspector's "Open" so there is ONE switch path.
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
// THE SECOND DATA-LOSS BUG, and it needs no pointer bug at all (reproduced in cell B of
// scripts/tabdoc-probe/repro.mjs, on Chromium AND Firefox): `saveDocument` writes the WHOLE
// document file with no union, no generation check and no lock. Two tabs on one document therefore
// autosave over each other, last writer wins, and one tab's words are simply destroyed. A brand-new
// tab reaches that state by doing nothing at all — it inherits the last-doc hint.
//
// The snapshot ARCHIVE is protected against exactly this ("snapshot history is grow-only: every
// write-back MUST union ... a save racing ahead of restore can never TRUNCATE the archive" — the
// 2026-07-05 incident). The document BODY has no equivalent guard. This is that guard, and it
// PREVENTS the race rather than reacting to it: a document is claimed by at most one live tab, so
// two tabs can never hold the same file open to save over.
//
// Web Locks is the right primitive: a lock is held for as long as the holding PAGE lives and is
// released automatically when the tab closes or crashes — there is no stale-lock state to garbage
// collect, and no heartbeat to get wrong. Where it is unavailable the writer is never blocked; we
// degrade to the old behaviour rather than refuse to open someone's document.
//
// AND THAT FALLBACK IS DEAD CODE ON EVERY ENGINE WE SHIP TO — PROBED, 2026-07-17, not assumed
// (scripts/tabdoc-probe/_locks.mjs, run against all three Playwright engines):
//   webkit (≈Safari/iOS)  locks=true  refusesSecondTab=true  query()=true
//   chromium              locks=true  refusesSecondTab=true  query()=true
//   firefox               locks=true  refusesSecondTab=true  query()=true
// `refusesSecondTab` is the property this module actually depends on — a second `request(...,
// {ifAvailable:true})` for a held name resolves with a null lock — and `query()` is what
// OpfsInspector's "open in another tab" badge reads. This was carried as STATED ("older WebKit may
// lack Web Locks") until it was measured; it is now PROBED, and the honest conclusion is that the
// no-locks branch protects nothing real and costs nothing. KEEP IT ANYWAY: it is the difference
// between an unknown engine degrading to today's behaviour and it locking a writer out of their own
// document. NB Playwright's Linux WebKit reports OPFS=false — that is a known harness gap
// (CLAUDE.md), NOT a Safari one, so the full two-tab repro still cannot run on WebKit here.

/**
 * The Web Lock name that means "a live tab is holding this document".
 *
 * EXPORTED ON PURPOSE, and it must stay the one definition. OpfsInspector reads the lock registry
 * via `navigator.locks.query()` to badge rows as "open in another tab", which means the name is a
 * CONTRACT between two files. Matched as a private string on each side, a rename here would not
 * break the inspector loudly — its badge would simply never light again, and a badge that has
 * silently stopped firing looks exactly like "no other tab has it open". That is the house disease
 * (a gate that always returned false and disabled a feature for months); one constant forecloses it.
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

// STOLEN-LOCK NOTIFICATION. When another tab performs "Take over here", it STEALS this document's Web
// Lock (stealDocLock below). The Web Locks spec resolves that by REJECTING the outgoing holder's
// request promise with an AbortError — so a steal is observable HERE, with no polling. singleOpen.ts
// registers a handler that freezes this tab's writes on that signal, which is the belt-and-braces
// backstop to the BroadcastChannel take-over handshake (and the ONLY signal on the degraded path
// where BroadcastChannel is unavailable). One callback, set once; never product-critical if unset.
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
        // The callback's promise IS the lock's lifetime, so keep it pending: the claim lasts until
        // releaseDocLock() resolves it, or until this page goes away and the browser drops it.
        granted = true
        return new Promise<void>((release) => {
          held.set(id, () => { held.delete(id); release() })
          done(true)
        })
      })
      // A rejection AFTER we were granted the lock is a STEAL (another tab took over): drop our
      // bookkeeping and notify. A rejection BEFORE we were granted is a LockManager failure, and that
      // must never stand between the writer and their document — resolve as "yours" and carry on.
      .catch(() => {
        if (granted) { held.delete(id); lostLockCb?.(id) }
        done(true)
      })
  })
}

/**
 * STEAL `id`'s lock for THIS tab — the mechanism behind "Take over here". Resolves true once this
 * tab holds it. The steal forcibly preempts the current holder, whose own request promise then
 * rejects (see tryClaimOnce) — so the loser learns it lost even with no BroadcastChannel.
 *
 * CORRECTNESS NOTE: a steal alone does NOT order the handoff — this tab holds the lock the instant it
 * resolves, while the loser's rejection is delivered a task later. singleOpen.ts therefore waits for
 * the loser's surrender ACK (BroadcastChannel) BEFORE it lets the editor write, and only steals to
 * take physical ownership of the lock. On the degraded (no-BroadcastChannel) path there is no ACK to
 * wait on and the rejection-driven freeze is the whole handoff; that path is a rescue from a possibly
 * dead tab, not the common case.
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
 * WHY THE RETRY: a RELOAD is the common case and it is a race — the outgoing page releases its
 * lock as it unloads, which can land AFTER the incoming page asks for it. Without the retry a
 * plain refresh would intermittently look like "another tab has this document" and the writer
 * would be handed a blank page instead of their thesis — a far worse bug than the one being
 * fixed. Retrying briefly costs nothing when uncontended (the first attempt succeeds) and only a
 * genuinely live second tab still holds the lock past the deadline.
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
