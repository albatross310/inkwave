# Storage and sync — the WHY behind the files that can lose Peter's thesis

The **why** for `src/storage/` (`opfs.ts`, `tabDoc.ts`, `singleOpen.ts`, `archiveWriteback.ts`,
`onedrive.ts`, `gdrive.ts`) and `src/provenance/snapshots.ts`. Each source file carries its rules as
short imperative comments ending in a pointer to an anchor here; this file carries the incident, the
measurement, and the hypothesis that was refuted.

**Read this before deciding a new code path is not an instance.** Six data-loss incidents on Peter's
real thesis share ONE shape — *an unknown answered as if it were a known-empty* (`docs/RULES.md` R1,
and the forensics are in `docs/archive/data-loss-incidents.md`). Every rule in these files is that
sentence applied to one read, and every incident was a re-introduction of a rule someone had stopped
believing.

Convention: `docs/archive/README.md`. Rule form: `docs/RULES.md`.

---

# <a id="tabdoc"></a>`storage/tabDoc.ts` — a tab's document identity

## <a id="tabdoc-identity"></a>The shared pointer, and why sessionStorage carries the identity

THE BUG THIS MODULE EXISTS TO MAKE IMPOSSIBLE (Peter, 2026-07-17; reproduced by
`scripts/tabdoc-probe/repro.mjs` on BOTH Chromium and Firefox before this module existed):

> "separate tabs don't appear to remember that they are supposed to be working on different
> documents and as a result, if you create a new document but forget to sync it up, refreshing
> the page can bring up the opfs from the synced document on another tab and overwrite your
> progress."

`inkwave:activeDocumentId` is ONE localStorage slot for the whole ORIGIN. Every tab wrote it on
every document switch, and every tab read it on every boot. So tab B creating a document
silently re-pointed tab A, and tab A adopted B's document on its next reload — leaving A's own
work ORPHANED on disk (intact, but unreachable by any tab: that is the shape of the loss) and
two tabs blind-autosaving one file.

**WHY sessionStorage IS THE CARRIER, AND THE URL IS NOT.** The hard case Peter named is the OAuth
round-trip — "even if you leave to go to microsofts page or whatever to log in". OneDrive sign-in is
`msal.loginRedirect` with `redirectUri: window.location.origin` (storage/onedrive.ts) — a FULL-PAGE
navigation off-origin that returns to a BARE `/`. Any doc id carried in the query string is GONE on
return. sessionStorage is scoped per-tab per-origin and SURVIVES that round-trip, so it is the source
of truth. The URL is a secondary, human-visible reflection: it makes a tab self-describing and
bookmarkable, but nothing depends on it surviving. (CLAUDE.md round-8 bug 2 is the precedent for not
trusting the URL: /snapshot's local-first nav rewrites it, and a flag read from the URL died
mid-session.)

**PRECEDENCE — url ?? session ?? last-doc hint:**

1. `?doc=<id>` — an EXPLICIT request for a document (a link, a bookmark, a duplicated tab).
   Absent means "no opinion" — NOT "no document" — which is exactly the state the OAuth return
   lands in, so an absent param must never clear the tab's identity.
2. sessionStorage — THIS TAB's own document. Survives reload AND the OAuth round-trip.
3. localStorage — the last document touched by ANY tab; used ONLY to give a brand-new tab something
   to open. Never consulted once this tab has an identity of its own.

`isExplicitDocIntent` is the same distinction one level up: only an explicit open — a `?doc=`
link/bookmark ('url') or this tab's own remembered identity ('tab') — earns the "open in another
window" screen when the document is held elsewhere. A hint-only tab had no opinion about THIS file,
so it should fall through to the next document no live tab holds, never be blocked on one it didn't
choose.

## <a id="tabdoc-new-tab-blank"></a>A NEW TAB OPENS BLANK

⚠ 2026-08-28, Peter: "when I open a new tab it always keeps reverting to this one thing Honours
Proposal … what we need is for new tabs to open as blank and to make sure multiple tabs on different
docs never overlap if hard refreshed".

The last-document hint used to answer at the end of `resolveTabDocId`, and it was the wrong shape of
helpful: it made EVERY new tab an attempt to reopen the same document, which then collided with the
tab that already had it — the one-live-tab lock fired, the second tab was told to switch or copy, and
the writer had to fight their way to a blank page. **A hint that guesses right once and wrong every
time after that is a worse default than no guess.**

The two behaviours he asked for are exactly sessionStorage's own semantics, so the rule is now just
"read the tab's identity, and nothing else":

* HARD REFRESH → sessionStorage survives ⇒ the same document, every time.
* NEW TAB → sessionStorage is empty ⇒ blank, and it can collide with nothing.

`lastDocHint()` is kept: it still records where the writer was, and the Storage panel lists every
document — but nothing BOOTS from it any more. `claimTabDoc` still writes the localStorage record
for the same reason.

## <a id="tabdoc-known-negative"></a>THE LIVE KNOWN-NEGATIVE — `window.__iwTabDocRule = 'shared'`

It restores the OLD behaviour: one origin-wide pointer, no per-tab identity, no document claim.

It exists because of round 11's lesson and round 12's — **a probe that only ever runs against the
FIXED build cannot tell "the fix works" from "the probe cannot see the bug"** (`docs/RULES.md` R3/R6).
This lets the reproduction re-create the data loss in the SAME build it then proves fixed, so the
negative is one flag away from firing forever, not a green line whose failure mode is untested. The
probe (`scripts/tabdoc-probe/repro.mjs`, cell N) REQUIRES this to lose data before it reads any
verdict.

Never referenced by product code paths other than the reads in `resolveTabDocId`, `stealDocLock` and
`claimDocLock`; absent ⇒ the fix is on.

## <a id="tabdoc-switch-flush"></a>The flush before a switch is a data-loss guard

`switchTabToDocument` points THIS TAB at `id` and reloads, so the editor's loader opens it cleanly.

THE FLUSH IS A DATA-LOSS GUARD (2026-07-10), not a nicety: reloading with a debounced save still
pending throws that save away — it cost Peter half an hour of real work. So flush FIRST and, on
failure, ABORT the switch and say so. Never weaken this to fire-and-forget: a switch that silently
eats the OUTGOING document would create exactly the loss the inspector exists to undo.

Shared by OptionsMenu (New / Open Recent) and OpfsInspector's "Open" so there is ONE switch path.

## <a id="tabdoc-one-live-tab"></a>ONE LIVE TAB PER DOCUMENT — the second data-loss bug

THE SECOND DATA-LOSS BUG, and it needs no pointer bug at all (reproduced in cell B of
`scripts/tabdoc-probe/repro.mjs`, on Chromium AND Firefox): `saveDocument` writes the WHOLE
document file with no union, no generation check and no lock. Two tabs on one document therefore
autosave over each other, last writer wins, and one tab's words are simply destroyed. A brand-new
tab reaches that state by doing nothing at all — it inherits the last-doc hint.

The snapshot ARCHIVE is protected against exactly this ("snapshot history is grow-only: every
write-back MUST union ... a save racing ahead of restore can never TRUNCATE the archive" — the
2026-07-05 incident). The document BODY has no equivalent guard. This is that guard, and it
PREVENTS the race rather than reacting to it: a document is claimed by at most one live tab, so
two tabs can never hold the same file open to save over.

Web Locks is the right primitive: a lock is held for as long as the holding PAGE lives and is
released automatically when the tab closes or crashes — there is no stale-lock state to garbage
collect, and no heartbeat to get wrong. Where it is unavailable the writer is never blocked; we
degrade to the old behaviour rather than refuse to open someone's document.

**AND THAT FALLBACK IS DEAD CODE ON EVERY ENGINE WE SHIP TO — PROBED, 2026-07-17, not assumed**
(`scripts/tabdoc-probe/_locks.mjs`, run against all three Playwright engines):

    webkit (≈Safari/iOS)  locks=true  refusesSecondTab=true  query()=true
    chromium              locks=true  refusesSecondTab=true  query()=true
    firefox               locks=true  refusesSecondTab=true  query()=true

`refusesSecondTab` is the property this module actually depends on — a second `request(...,
{ifAvailable:true})` for a held name resolves with a null lock — and `query()` is what
OpfsInspector's "open in another tab" badge reads. This was carried as STATED ("older WebKit may
lack Web Locks") until it was measured; it is now PROBED, and the honest conclusion is that the
no-locks branch protects nothing real and costs nothing. KEEP IT ANYWAY: it is the difference
between an unknown engine degrading to today's behaviour and it locking a writer out of their own
document. NB Playwright's Linux WebKit reports OPFS=false — that is a known harness gap
(CLAUDE.md), NOT a Safari one, so the full two-tab repro still cannot run on WebKit here.

## <a id="tabdoc-lock-name"></a>`DOC_LOCK_PREFIX` is EXPORTED on purpose

The Web Lock name means "a live tab is holding this document", and it must stay the one definition
(`docs/RULES.md` R2). OpfsInspector reads the lock registry via `navigator.locks.query()` to badge
rows as "open in another tab", which makes the name a CONTRACT between two files. Matched as a
private string on each side, a rename here would not break the inspector loudly — **its badge would
simply never light again, and a badge that has silently stopped firing looks exactly like "no other
tab has it open"**. That is the house disease (a gate that always returned false and disabled a
feature for months); one constant forecloses it.

## <a id="tabdoc-claim-retry"></a>`claimDocLock` RETRIES past the reload unload-race

WHY THE RETRY: a RELOAD is the common case and it is a race — the outgoing page releases its lock as
it unloads, which can land AFTER the incoming page asks for it. Without the retry a plain refresh
would intermittently look like "another tab has this document" and the writer would be handed a
blank page instead of their thesis — a far worse bug than the one being fixed. Retrying briefly
costs nothing when uncontended (the first attempt succeeds) and only a genuinely live second tab
still holds the lock past the deadline.

Inside `tryClaimOnce`, the callback's promise IS the lock's lifetime, so it is kept pending: the
claim lasts until `releaseDocLock()` resolves it, or until this page goes away and the browser drops
it. The `granted` flag is what separates the two kinds of rejection — a rejection AFTER we were
granted the lock is a STEAL (another tab took over), so drop our bookkeeping and notify; a rejection
BEFORE is a LockManager failure, and that must never stand between the writer and their document.

## <a id="tabdoc-steal"></a>A steal takes the lock; it does not order the handoff

`stealDocLock` is the mechanism behind "Take over here". It resolves true once this tab holds the
lock. The steal forcibly preempts the current holder, whose own request promise then rejects (see
`tryClaimOnce`) — so the loser learns it lost even with no BroadcastChannel.

CORRECTNESS NOTE: a steal alone does NOT order the handoff — this tab holds the lock the instant it
resolves, while the loser's rejection is delivered a task later. `singleOpen.ts` therefore waits for
the loser's surrender ACK (BroadcastChannel) BEFORE it lets the editor write, and only steals to take
physical ownership of the lock. On the degraded (no-BroadcastChannel) path there is no ACK to wait on
and the rejection-driven freeze is the whole handoff; that path is a rescue from a possibly dead tab,
not the common case.

Even a failed steal must not block the writer — the take-over screen has no better fallback than to
let them proceed, and a document they cannot open is its own disaster.

## <a id="tabdoc-lock-lost"></a>The stolen-lock notification

When another tab performs "Take over here", it STEALS this document's Web Lock. The Web Locks spec
resolves that by REJECTING the outgoing holder's request promise with an AbortError — so a steal is
observable HERE, with no polling. `singleOpen.ts` registers a handler that freezes this tab's writes
on that signal, which is the belt-and-braces backstop to the BroadcastChannel take-over handshake
(and the ONLY signal on the degraded path where BroadcastChannel is unavailable). One callback, set
once; never product-critical if unset.
