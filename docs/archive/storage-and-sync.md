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

---

# <a id="opfs"></a>`storage/opfs.ts` — document persistence

## <a id="opfs-failed-read"></a>⚠ THE 2026-07-15 INCIDENT — a failed read answered as an absent document

**This file used to tell this story TWICE** — once on `StorageReadError` (17 lines) and again on
`DocRead` (22 lines), same forensics, same timestamp, same conclusion. It is told once here and both
rules point at it.

THE BUG (forensics, 2026-07-15 11:19:40 — Peter's real thesis). `readJson` used to end
`catch { return null }`, which made a transient read failure INDISTINGUISHABLE FROM "no such
document". Edit.tsx answers null by falling through to `newDocument()` and REPOINTING the active-doc
pointer at the blank — so one unlucky read presented Peter with an empty page where his honours
proposal had been (doc `978e0772`, createdAt == updatedAt, 0 chars). He then opened a `.studio`
backup to recover from the blank, got the stale twin, and THAT blind-overwrote Wednesday's work.
**The read bug CAUSED the open.**

**The defect is not that the error went unlogged — it is that THE TYPE ERASED IT.** `null` is the
honest answer to "is there a document here?" and the only answer available to "did the disk just
fail?", and the caller cannot tell which it got. This file already insists that WRITES stay loud
("autosave failures must stay loud" — `saveDocument` deliberately throws). The read path was silent.
Same asymmetry as `current.json` being unguarded while snapshots are grow-only.

**AND THROWING IS ONLY HALF A FIX.** `await loadDocument(id).catch(() => null)` restores the bug in
eleven characters and still typechecks — *I wrote exactly that line while fixing this.* So the result
is a discriminated union with **no `null` member**, and the compiler forces every caller to say which
of the three it means:

* `found` — the document is here.
* `absent` — genuinely not on disk, so it is safe to create or replace.
* `error` — could not find out, so NEVER write: the writer's work may be sitting right there.

Modelled on the ledger lane's `RemoteRead` (same shape, same reasoning, arrived at independently for
cloud sync). The shared RULE is: **never write to a target you have not just read, and never treat a
failed read as an absent one.** The shared rule is deliberately NOT a shared function — a ledger is a
SET (union it, grow-only), a document body is PROSE (it cannot be unioned; it needs a staleness
check). Making them look interchangeable is how the wrong one gets called.

`readJson`'s two catch arms are both load-bearing. The second one — a corrupt file — is emphatically
NOT an absent one: answering null there would send Edit.tsx to `newDocument()` and repoint the
pointer away from a document whose bytes are still on disk and may be recoverable (see
OpfsInspector). The KNOWN-NEGATIVE seam `window.__iwReadGuard = 'off'` restores the pre-fix swallow
so the reproduction can produce the blank-document failure in the SAME build it proves fixed.

The boundary predicate lives alone and TESTED (`notFound.test.ts`): it is the single line that
separates 'absent' from 'could not find out', and a lenient edit to it makes the whole `DocRead`
union perfectly typed and perfectly wrong.

## <a id="opfs-app-json"></a>Two app-level readers with OPPOSITE contracts, and the month one destroyed

App-level JSON (recent folders, open-cache listings/index) is ALWAYS best-effort convenience state —
so `readAppJson` never rejects. In a private window `navigator.storage.getDirectory()` itself can
throw (it sits OUTSIDE `readJson`'s catch), and that must degrade to "no cache, network-only", not
break the caller (the 2026-07-10 Firefox-private picker report). Document persistence (`saveDocument`)
deliberately KEEPS throwing — autosave failures must stay loud.

That convenience collapse is the 2026-07-15 defect, accepted THERE and only there because the answer
feeds a cache or a picker list: the cost of being wrong is a re-fetch, never a lost row.

**WHY `readAppJsonStrict` EXISTS (auditor, 2026-07-17).** `loadLedger` read through `readAppJson`, so
one transient OPFS failure answered "you have no rows". Its callers are read-modify-WRITE —
`flushMonth` then wrote the buffered rows ALONE over the month (its own comment: "Union first, always
— never write `rows` alone"), and `saveReflection` wrote a 0-row ledger, so saving a reflection could
erase the month it belonged to. **No race required; a single failed read did it.** The repo had
already SEEN this and fixed the instance, not the class: `email/testOpfsShim.ts` records "the ledger
read as merely EMPTY" and repaired the shim.

The strict version has the OPPOSITE contract, and is named so the difference is visible at the call
site: null ONLY when the file genuinely does not exist, THROWS on any other failure. `getRoot()` is
inside the throw path on purpose — in a private window it rejects, and "storage is unavailable" is
emphatically not "you have no sessions this month".

## <a id="opfs-write-freeze"></a>The take-over freeze lives at the write funnel, not in the UI

THE ONE THING THIS APP MUST NEVER DO (2026-07-15, twice, on Peter's real thesis): let two writers on
ONE document race and blind-overwrite each other. `saveDocument` is the whole-file replace with no
union and no generation check — it is THE loss vector every guard in this file circles. The
single-open lock (`storage/tabDoc.ts` + `storage/singleOpen.ts`) makes at most one live tab hold a
document, and its "Take over here" handoff transfers that hold to a second tab. The handoff is only
safe if the LOSING tab genuinely stops writing BEFORE the winning tab starts — otherwise the take-over
reproduces the exact overwrite it exists to prevent.

This freeze is that stop, and it lives at the single write funnel on purpose: **a UI that goes
read-only is a promise; a `saveDocument` that refuses is a guarantee.** When a tab surrenders a
document (Web Locks stolen, or a BroadcastChannel take-over), `freezeDocWrites(id)` is called and from
that instant NOTHING can persist a new body for that id from this tab. The winning tab only begins
after it has the surrender ACK, so "loser stopped before winner started" is enforced at the bytes, not
asserted in a comment.

Consequences that look like details and are not:

* `freezeDocWrites` ALSO drops any debounced save already queued for `id`, so a beat armed a moment
  before the surrender cannot fire past it. A beat for a DIFFERENT document (none, in practice — a
  tab edits one doc — but be exact) is left alone.
* `saveDocument` THROWS rather than silently dropping, so a DIRECT caller (snapshots, cloud, music)
  reaching a surrendered body gets a stack trace. None should.
* The autosave beat catches `DocWriteFrozenError` and stays QUIET, because there the refusal is the
  intended read-only behaviour: firing `save-failed` would alarm the writer about the very thing they
  just chose ("Take over here" from the other window). Every other error stays loud — the writer must
  not keep typing into a document that stopped persisting.
* `scheduleSave` drops the beat early only when it can tell cheaply. A THUNK is not evaluated just to
  check (that is the expensive per-keystroke serialize this path exists to defer); its beat reaches
  `saveDocument` and the throw does the work.

## <a id="opfs-raw-bytes"></a>`readDocumentBytes` — the last resort

THE ONE THAT MATTERS MOST. A document whose JSON will not parse is exactly the document whose words
the writer most needs back — and it is the one case `readDocument` cannot help with, because there is
nothing to return but an error. The bytes are still sitting on disk with the prose legible inside
them. OpfsInspector offers this as "Download raw" so a corrupt document is a file the writer can
salvage by hand (or send to me), rather than a row that says "unreadable" and offers nothing.
**A recovery surface that lists the problem and gives no way out is a dead end at precisely the moment
it exists for.**

## <a id="opfs-list-direct"></a>`listOpfsDocuments` enumerates the directory, never the index

Enumerate `documents/` DIRECTLY — the ground truth of what this origin is storing.

This deliberately does NOT consult the IndexedDB meta index (`listMeta`). An ORPHANED document is
precisely one that OPFS has and the index does not surface (2026-07-17: one origin-wide
`inkwave:activeDocumentId` pointer let one tab re-point another, stranding the other tab's file
intact-but-unreachable). A recovery listing built from the index could never show it. Reading the
directory is the only way to see what is really there.

One file read per document: `size`/`lastModified` come from the same File handle as the bytes, so
this costs one pass, not three. Per-document failures degrade to `doc: null` rather than losing the
whole listing — a corrupt file is still a document the writer may want back.

## <a id="opfs-autosave-beat"></a>The autosave beat — phone delay, and the bounded zoom deferral

PHONE INPUT PRIORITY (2026-07-09): the save beat is where the editor's LAZY doc build actually runs —
full `getJSON` + `embedBibliography` + `JSON.stringify`, all main-thread and O(doc). At 200ms it fired
in ordinary inter-word typing pauses on a phone CPU; 800ms waits for a genuine pause (trailing — every
edit re-arms it), and the crash-loss window stays under a second. Desktop keeps 200ms. (Same
coarse-pointer test as `isTouchDevice` — inlined so storage doesn't import editor code.)

`flushPendingSave` exists because settings toggles reload the page and MUST flush first: a
debounced-away save was half an hour of Peter's work (2026-07-10). It THROWS on failure so a caller
about to reload can abort.

ZOOM-GESTURE DEFERRAL — BOUNDED (2026-07-10): while a zoom gesture holds (`__iwZoomHold`, cleared at
settle) the beat is pushed back, but never beyond 3s total — **a stuck flag must not become silent
data loss.**

A thunk defers building the document snapshot to SAVE time (200ms after the last edit) — the editor
passes one so serialization never runs per keystroke (see `ensureDocFresh`).

## <a id="opfs-deleted-eventlog"></a>The deleted `appendEventLog` stub

The Week-3 stub that lived at the foot of this file was deleted 2026-07-08: zero callers, and its
read-whole-file-per-append pattern was an O(n²) trap. The provenance record is snapshots + signed
receipts; if a per-event log is ever needed, design it append-friendly from the start.

---

# <a id="snapshots"></a>`provenance/snapshots.ts` — the append-only archive

A snapshot is a content-addressed record of the document at a moment: its contentHash, the
Bitcoin-anchored bundleHash, and an OTS proof slot. Stored in OPFS beside the document at
`documents/<id>/snapshots.json`.

## <a id="snap-archive-read"></a>⚠ `[]` MEANS "THIS DOCUMENT HAS NO HISTORY" AND MAY MEAN NOTHING ELSE

`readSnapshotsFromDisk` used to end `catch { return [] }` — the 2026-07-15 shape
(`catch { return null }` erasing "there is nothing there" from "I could not find out") pointed at the
provenance spine itself. Every consumer reads-then-writes the WHOLE array, so a transient OPFS fault,
a corrupt gzip or a worker failure made this happen:

    const snaps = await readSnapshotsFile(doc.id)          // ← [] on ANY failure
    await writeSnapshotsFile(doc.id, [...snaps, snapshot]) // ← ONE snapshot over the archive

Every OTS proof and signed receipt for the document — **Peter's evidence that he wrote his thesis
himself** — replaced by a single snapshot. No race: one failed read did it.
`clearAllSnapshotSummaries` was a second vector on the same lie (`[]` → writes `[]` over the archive).

So the boundary is `storage/notFound.ts`, the same predicate the document body already hangs off: a
NotFoundError is the ONE honest `[]` (a new document has no snapshots.json and must still get a blank
archive, not an error screen); everything else THROWS and the write paths refuse.

**A NON-ARRAY parse is a failure, NOT an emptiness**, for exactly the reason a corrupt JSON body is:
the bytes are still on disk and may be recoverable, and answering `[]` would invite the next snapshot
to write over them. Same for a gzip that won't inflate. **Both catch arms are load-bearing and
mutation-proved: with only the open arm, collapsing the parse arm to `return []` left the probe fully
green.**

## <a id="snap-known-negative"></a>THE LIVE KNOWN-NEGATIVE — `window.__iwArchiveGuard = 'off'`

It restores the `catch { return [] }` collapse, so a browser probe can destroy the archive in the
SAME BUILD it then proves fixed. The precedents are `__iwReadGuard` (opfs.ts) and `__iwOpenGuard`
(openDoc.ts) and the reason is theirs: "a probe that only ever runs against the fixed build cannot
tell 'the guard works' from 'the probe cannot see the bug'".

**THE PREVIOUS LANE DELIBERATELY LEFT THIS OUT, and was right to**: it had no probe, and a live
off-switch for the provenance archive with no consumer is only a way to turn provenance off. It
arrives WITH its consumer — `scripts/archguard-probe/repro.mjs`, which REQUIRES this cell to truncate
a real 4-snapshot archive in real OPFS before it will read the fixed verdict (it exits 2 if the
control fails to reproduce). **Do not keep this seam if that probe goes**: the rule the previous lane
wrote still binds, in both directions.

It is checked FIRST, before `isNotFound`, exactly like opfs.ts's — the legacy shape had no
NotFoundError branch at all, so honouring one here would make the control a partial fiction.

## <a id="snap-read-union"></a>`SnapshotRead` has no `[]` on the failure arm — and no 'absent' arm either

The archive read is an outcome a caller must branch on rather than a value it can mistake for
emptiness — the same shape as `DocRead` in storage/opfs.ts. The whole bug was that `[]` answered two
different questions.

WHY THERE IS NO 'absent' ARM, when `DocRead` has one. For a DOCUMENT, absent is a real third answer:
it is what makes `newDocument()` legal, so it must stay distinct from `found`. For an ARCHIVE the two
collapse — "no snapshots.json" and "a snapshots.json holding []" mean the identical thing to every
caller ("this document has no history"), and both are safe to append to. Splitting them would buy
nothing and cost a dead branch at every call site, which is its own kind of rot. The distinction that
DOES matter is the one this union keeps: established emptiness vs failed read.

`readSnapshotArchive` is for the callers that must tell an empty history from a failed read: the
open-time ancestry guard above all (openDoc.ts), and every action that would publish or overwrite the
record. Prefer it to try/catch around `listSnapshots` — it cannot be forgotten.

And on `listSnapshots` itself: the failure is invisible to the compiler, so an unguarded
`await listSnapshots(id)` in a click handler is a button that silently does nothing, and
`.catch(() => [])` around it walks the original bug right back in. It stays exported because it is
the honest primitive and the tests drive it directly.

## <a id="snap-cache"></a>The in-memory cache, and why a failure is never cached

One parsed copy per document per session. A single doc open used to gunzip + JSON.parse the whole
archive up to 5 times (eager list, receipt recovery ×2, folder link, cloud resume) — 100ms–1s each on
a big archive. Every mutation funnels through `writeSnapshotsFile` (and the editor serialises snapshot
work through one queue), so a write-through cache is safe. Reads hand out a shallow COPY so a caller's
in-place edits can't alias the cached array. (A second tab writing the same doc's OPFS bypasses this
cache — but concurrent same-doc tabs already race on the file itself; the grow-only merge protects
sync targets either way.)

**A FAILED READ MUST NOT BE CACHED.** When this cache held `[]` from a failed read, the lie persisted
for the whole session — every later reader was told "no history" long after the transient fault had
passed. **Caching the REJECTION instead would be the same mistake wearing the other hat**: one blip
and provenance is off until reload. So evict on failure and let the next reader retry the disk; only
a resolved read is worth keeping.

## <a id="snap-write-chain"></a>Cache-first, serialised disk writes — and the caveat that is load-bearing

The write-through cache updates SYNCHRONOUSLY (before the disk write lands) and is the in-session
authority; the gzip+stringify+write is chained per-document so writes can never land out of order.
Grow-only safety: the cache is a SUPERSET of disk *for every read that succeeded* (only intentional
deletes shrink it), and every write-back (cloud sync, folder mirror) reads through the cache — so if a
deferred disk write fails, disk merely didn't grow (never truncated) and every sync target still gets
the full union.

**THE CAVEAT IS LOAD-BEARING, and this comment used to assert the invariant flatly. It was FALSE**: a
failed read cached `[]`, so the "superset" was a lie for the rest of the session and every sync target
got that lie unioned into nothing. The read now throws instead of returning `[]` and a failure is never
cached — which is what makes the sentence above true. **A comment asserting parity is a reason nobody
checks parity; this one earns it or it goes.**

The per-doc chain also means a deferred open-time restore write and a subsequent snapshot append
serialise: disk always converges to the latest cache state. The compress stays INSIDE the chain, after
`prev`, so the write-through cache remains the synchronous in-session authority and disk writes still
land in order — the grow-only invariant depends on that ordering. `writeOpfsFile` works on iOS too
(worker sync-access).

## <a id="snap-stale-cache"></a>THE STALE-CACHE GUARD (2026-08-20) — 79 snapshots, twice, in one session

`_snapCache` is MODULE state, so it is per TAB, and everything above treats it as the in-session
authority. Across two tabs that is false: a tab that loaded when the archive held 4 snapshots keeps
`cache = 4` for its whole life, and if another tab then grows the archive to 79 this one still unions
against its own stale 4 and writes that over the top. **Peter lost 79 snapshots to exactly this,
twice, in one session** — his count fell back to 4 while he worked and /snapshot then said the history
"isn't on this device".

`mergeSnapshots` did not catch it because it guards against a SHORT read; **this read is not short, it
is STALE** — it succeeds and returns a confidently outdated answer. Same family as the 2026-07-15 and
archiveReadFail bugs, one question further along: not "could I read it" but "is what I read still
current".

The check is a SIZE comparison, not a re-read: if the file is exactly the length we last wrote, no one
else has touched it and the outgoing set is already a superset. Only a surprise triggers the gunzip,
so the single-tab path pays one metadata read. `_lastWrittenSize` is what makes that cheap — a file's
`size` comes from its metadata, so it costs no gunzip and no parse in the overwhelmingly common
single-tab case, and `archiveSizeOnDisk` answers null for absent-or-unreadable so the caller re-reads
rather than assuming.

**A genuine read failure THROWS there and the write is ABANDONED — deliberately: losing one new
snapshot is recoverable, overwriting an archive we could not read is not.** That is the same rule
`readSnapshotsFromDisk` already enforces for its own callers.

And `deleteSnapshot` must ask for `allowShrink`. It defaults false so a new write path cannot silently
acquire the power to truncate — it has to ask for it. Everything else is append/update and is merged
grow-only against disk first.

## <a id="snap-merge"></a>`mergeSnapshots` is GROW-ONLY, and the write-back merge runs once per target

Union two snapshot lists by id. Provenance history is append-only, so no write-back (OPFS restore,
folder mirror, cloud sync) may ever SHRINK it just because the local OPFS set is momentarily short — a
fresh login, cleared site data, or a sync racing ahead of a restore. The richer copy wins on an id
clash (more signed receipts = more evidence); ordering is by createdAt. On the write path the OUTGOING
set wins id clashes, so OTS and summary updates survive.

The grow-only "read the existing file and union its snapshots" pass on write-back only needs to run
ONCE per target per session — enough to fold in another device's snapshots. After that the local OPFS
set is the superset (snapshots are append-only), so a save just grows it; re-reading and parsing the
(possibly 20 MB) file on EVERY save is pure lag. Callers gate on `needsWritebackMerge()` and call
`markWritebackMerged()` only on a successful read, so a failed read retries next time.

⚠ Note the deliberate asymmetry with the productivity ledger, which takes READ-MERGE-WRITE on EVERY
write: a month of rows is tens of KB and the file's cheapness buys the stronger invariant. **Do not
copy this once-per-session gate there.**

## <a id="snap-restore-bundle"></a>Restoring from a bundle, and the deferred open-path write

`restoreSnapshotsFromBundle` restores into OPFS only when OPFS has FEWER snapshots than the bundle.
Local OPFS always wins: if the machine already has the full history, leave it untouched. Called when
opening a .studio file so provenance survives device transfers. The write is a union, so it never
drops local-only snapshots either.

`deferDiskWrite` (the OPEN path): the union lands in the write-through cache synchronously — the
editor's eager snapshot list right after open sees the FULL union — while the heavy stringify+gzip+write
runs behind the reveal (the wave-decay dead time) on the per-doc write chain. GROW-ONLY holds either
way: a failed deferred write leaves disk un-grown (never truncated), the cache stays the superset every
write-back unions from, and the bundle's copy still exists at its source.

## <a id="snap-drain-writes"></a>`_drainSnapshotWrites` — why the tests need it

The open path restores with `deferDiskWrite: true` — a fire-and-forget write on `_writeChain` that
outlives the call that queued it (`restoreSnapshotsFromBundle` → `void write.catch(...)`). A test that
swaps its in-memory OPFS root between cases (`installOpfsShim`) must first let those writes DRAIN, or
the previous case's deferred write resolves `getDirectory()` against the NEXT case's fresh root and
materialises a stray document in a disk that should have been clean. A fixed `setTimeout` cannot bound
an off-thread gzip under CPU load; this awaits the actual chain. It loops because a chain can enqueue a
successor while we await the first.

## <a id="snap-gzip"></a>Gzip: the capability floor, and why the compress runs off-thread

Snapshots JSON is highly repetitive (same contentJson structure, receipt fields) and compresses ~75%,
keeping storage manageable as the list grows. Capability floor: `CompressionStream` is iOS/Safari
16.4+. Older WebKit can't write the gzip archive, so `createSnapshotIfChanged` degrades to a no-op
(warn once) instead of throwing on the first resolved nudge — **writing keeps working, provenance is
disabled**. entry.client shows a banner.

THE COMPRESS RUNS OFF-THREAD (`gzipJsonOffThread`, workers/parseClient.ts). Every snapshot embeds the
whole document body, so the archive is N × the whole thesis and JSON.stringify + gzip of it is
O(N×doc) — it used to run on the main thread inside `queueSnapshotsWrite`, stalling keystrokes ~1s per
checkpoint on a large doc (Peter's report). The READ was already off-thread (`gunzipJsonOffThread`);
this is the missing sibling. Falls back inline where there is no Worker (node/vitest/prerender).
*"We should be able to make snapshots while continuing to type."*

Legacy uncompressed files fall through to a plain UTF-8 decode inline; gzip is detected by the magic
bytes 0x1f 0x8b.

## <a id="snap-meta-diet"></a>The metadata projection — the snapshot memory diet

React state must never hold the full snapshot array — every Snapshot embeds its whole contentJson
(+ receipts + frozen bibliography), so hundreds of snapshots would keep hundreds of MB resident just to
render a 210px list. The cache keeps the full array ONCE (unavoidable — rapid scrubbing needs it hot);
UI state holds only the cheap projection, which drops contentJson / receipts / bibliography and keeps a
receipt COUNT (all the panel ever shows).

`listSnapshotMeta` THROWS on an unreadable archive, exactly like `listSnapshots` — never `[]`. **A
caller that answers the failure by rendering an empty list has moved the lie from storage into the UI.**

## <a id="snap-bundlehash-versions"></a>The bundleHash's v:1 → v:4 forms — every existing anchor must still verify

`bundleHash` commits to content, the DISPLAYED bibliography (v:2), the EMAIL HEADERS (v:3), the
ATTACHED MUSIC (v:4), AND the live-composition receipt chain, so the OTS proof anchors the whole signed
record to Bitcoin. **Each addition is conditional for one reason: a document without that thing keeps
its older form and every anchor already on Bitcoin still verifies.**

* **Bibliography (v:2).** Freeze the DISPLAYED bibliography — the mode-resolved cited subset
  `resolve.ts` embedded — and hash it deterministically. Only when there is ≥1 displayed entry;
  otherwise `bibHash` stays undefined and the bundle keeps its v:1 form (pre-citation docs hash exactly
  as before). See citations §12.
* **Email headers (v:3).** Frozen the same way, and only on an email document. The body needs no
  special handling: it IS `contentJson`, already committed via `contentHash`. The headers are
  canonicalised before hashing so one header set has exactly one anchored hash. For an email the claim
  is exactly §B2.2's — headers + body existed by time T.
* **Attached music (v:4).** Only on a document that carries a score. The MusicXML BYTES are not frozen
  (a master lives in OPFS, like a PDF sidecar); its sha256 is, which is what actually pins the
  notation: correct the score under an anchored analysis and this stops matching. For a music essay the
  claim is §B5's — this analysis, of these bars of this notation, existed by time T.

## <a id="snap-ots-reread"></a>OTS patches re-read before writing

Each mutation re-reads the file before writing, so callers that serialise them (the editor's snapshot
queue) never lose a concurrent append.

## <a id="snap-countwords"></a>`countWords` is re-exported, not defined here

The word notion lives in `./countWords`, a leaf that imports nothing — see its header for why
`bundle.ts` could not simply import it from here. It is imported for local use AND re-exported, so the
four existing callers keep importing `countWords` from this module exactly as before.

---

# <a id="writeback"></a>`storage/archiveWriteback.ts` — "may I overwrite the remote archive, and with what?"

## <a id="wb-guarded-union"></a>⚠ A GUARDED UNION THAT IS NEVER REACHED GUARDS NOTHING

**This is the 2026-07-15 bug one directory over.** `mergeSnapshots` is the grow-only union, and it is
correct and tested (`mergeSnapshots.test.ts` pins "a short local set can never truncate a long
remote"). It was never the hole. The hole was the code that decides WHETHER TO CALL IT — all three
cloud providers wrote:

    let merged = snapshots                       // ← local only
    try {
      const res = await fetch(remote)
      if (res.ok) merged = mergeSnapshots(remote.snapshots, snapshots)
    } catch { /* no remote yet → write local as-is */ }
    await put(buildExportBundle(doc, merged))    // ← WRITES ANYWAY

So a 500, a 429 throttle, an expired token, a network blip or a corrupt download all fell into the
same branch as "the file does not exist yet" — and the next act was an UNCONDITIONAL PUT of the local
set over the remote. That is the 2026-07-15 loss exactly (`catch { return null }` made "I could not
read it" and "there is nothing there" the same answer), and the 2026-07-05 truncation exactly (a
short local set replacing a long archive) — recombined, in the live cloud sync, on Peter's thesis.

The distinction is not a nicety: **"absent" and "error" license OPPOSITE actions.** Absent ⇒ writing
creates the file, and nothing can be lost. Error ⇒ we know NOTHING about what is there, and the only
safe act is to not act. So, following `ledgerSync.ts`'s `RemoteRead` (which got this right) and
`notFound.ts`'s boundary predicate:

1. **THE UNION HAS NO `null` MEMBER.** A provider cannot accidentally answer "nothing" for "the
   network was down"; 'absent' and 'error' are different words and the compiler enforces it.
2. **ONE RULE, ONE PLACE.** OneDrive, Google Drive and the local folder all reconcile the same
   question, so they share this function. Three copies of a rule is how one silently stops matching
   the others (this repo's standing wound — see CLAUDE.md on `daySummary`).
3. **EACH PROVIDER MAPS ONLY ITS OWN FAILURE SURFACE** into the union — the thing only it knows
   (Graph: 404 ⇒ absent via `mapGraphReadStatus`; FSA: NotFoundError ⇒ absent via `isNotFound`).
   Nothing here decides anything about a provider; nothing there decides anything about safety.

F16's lesson applies and is why `planWriteback` is pure and exported: **a union guards the CONSUMER,
not the PRODUCER.** The type stops a caller forgetting the error branch; it cannot stop this function
mapping the branches wrongly. So the mapping itself is the thing under test.

`planWriteback` is PURE — no network, no OPFS, no clock — and ~10 lines so that the gate can KEEP it
true in milliseconds without a browser (CLAUDE.md: "a green gate is not a guard"; a browser probe that
ran once is archaeology). **THE ASYMMETRY IS THE POINT:** refusing to write costs one sync cycle (the
rows/text are safe locally and the next sync retries). Writing over an archive we could not read costs
the archive. When in doubt, do nothing — a sync that did not happen is a boring, recoverable Tuesday.

On the 'ok' branch the union runs **even when the remote's array is EMPTY: an empty read is a fact we
established, unlike an empty guess.**

## <a id="wb-no-merged-flag"></a>The `mergedRemote` flag that was deleted

`WritebackPlan` deliberately has no `mergedRemote` field. It was written, and it was always `true`
wherever `write` was `true` — **a field no test could ever kill, i.e. a comment that costs a branch**
(the `library.ready` mutation lesson). The equivalence is the useful fact and it is stated once:
`write: true` ⟺ we established what the remote holds, so it is exactly the condition under which a
caller may close its once-per-session merge gate. An 'error' never writes and never closes the gate,
so the next sync retries the read.

Also worth saying plainly: `write: false` is a NORMAL outcome, not a crash. Local is safe.

## <a id="wb-is-a-record"></a>`archiveSnapshotsOf` — the third half of the read, and it was a live hole

⚠ PROBED, AND IT WAS A LIVE HOLE IN ALL THREE PROVIDERS (2026-07-17). Each one ended its read with:

    const remote = await parseTraceOffThread(text)
    return { status: 'ok', snapshots: remote.snapshots ?? [] }

`parseTraceFile` is `JSON.parse` with a marker-anchored slice and NO shape check, so it happily
returns a string, a number, `true`, or an array for a body that is valid JSON and not a record.
`.snapshots` on those is `undefined` ⇒ `?? []` ⇒ **`{ status: 'ok', snapshots: [] }`** — a remote we
never established, reported as an ESTABLISHED EMPTINESS, which is the one answer that licenses
`planWriteback` to overwrite. The whole module exists to keep a failure out of an absence's clothes
and the last line of every adapter handed it a fresh set. (`cloudWriteback.test.ts` reproduced it: a
200 carrying `"just a string"` PUT the local set over a 4-snapshot archive.)

`snapshots` being a NON-array is the same hole one field down: `?? []` passes a string straight
through (it is not nullish), `mergeSnapshots` iterates its characters, every one lacks an `id`, and the
union silently comes out as local-only. **A truthiness check cannot see that; a type check can.**

THE OUTAGE DIRECTION SETS THE PREDICATE'S FLOOR, and is why this is not "reject anything odd":

* `snapshots` ABSENT is a real, healthy record — a document that has never been snapshotted, and every
  pre-snapshot-era file. It MUST read as an established emptiness or those files can never be synced
  to again.
* `snapshots: []` likewise.

So the rule is narrow and structural: an Inkwave record is a non-null, non-array OBJECT, and its
`snapshots` is an array or is not there. Nothing about a legitimate bundle can fail that, and nothing
that fails it can tell us what the remote holds.

It returns `null` for "this is not a record" — which every caller must map to `error`, never to
`absent`. **A `null` there is the ONE thing a caller could mistake for emptiness, which is why it is
not an `ArchiveRead`: the caller has to write the word.**

## <a id="wb-precondition"></a>The write PRECONDITION (auditor Finding E)

READ-MERGE-WRITE still has a gap between the read and the write. `planWriteback` decides WHETHER to
write; this decides WHAT THE WRITE ASSUMED, so the server can refuse it if that assumption went stale
in flight. Two devices interleaving:

    A reads {R} · B reads {R} · A writes {R ∪ localA} · B writes {R ∪ localB}   ← A's rows GONE

Both merges are honest and rows are still lost, because each merged against a version that moved. A
violated precondition is a FAILED WRITE — which every caller here already handles correctly: nothing
is lost, and the next sync re-reads, re-merges and writes the true union. Self-healing, which is why
no 'conflict' outcome is needed for correctness.

It lives in STORAGE, not in the ledger: "what must still be true for my write to land" is a property
of writing to a remote, and the ledger is merely its first caller.

The three members: `absent` (we read a 404 — the file must NOT exist; Graph:
`@microsoft.graph.conflictBehavior=fail`) · `unchanged` (we read this exact version; Graph:
`If-Match: <etag>`) · `any` (**the provider gave no version to pin — honest, narrow, and the
PRE-EXISTING posture, never a default**; only a read that genuinely returned no etag may produce it,
and the 'absent' case never degrades to it, which is precisely Finding E).

---

# <a id="singleopen"></a>`storage/singleOpen.ts` — the same-device take-over handshake

## <a id="so-ack-ordering"></a>THE ONE INVARIANT: the loser stops writing BEFORE the winner starts

WHAT IT IS FOR (Peter, verbatim): *"make it so that a device can't open the same document anywhere on
the same device at all if it's already opened somewhere else."* Two tabs editing one document diverge
and then one blind-overwrites the other's OPFS copy (`saveDocument` is a whole-file replace with no
union — the 2026-07-15 loss vector). `tabDoc.ts` already keeps ONE live tab per document via a Web
Lock; this module is the layer ABOVE it: when a second tab finds the lock held, it does not silently
open something else — it offers the writer a choice, and makes the "Take over here" choice SAFE.

Get the ordering wrong and the take-over reproduces the exact blind overwrite the whole mechanism
prevents. It is enforced by an ACK, not asserted in prose:

    holder receives take-over → flush pending body → FREEZE writes → post 'surrendered'
    taker posts take-over → AWAIT 'surrendered' → steal the lock → only now open + write

The freeze is set before the ack is sent, and the taker does not write until the ack arrives, so the
two writers can never overlap. See `storage/opfs.ts` `freezeDocWrites` for the byte-level stop.

**DEGRADE, NEVER DEAD-END.** BroadcastChannel is universal on shipping engines, but if it is absent
the take-over still works by STEALING the Web Lock — the loser's request promise rejects (`tabDoc.ts`
`onDocLockLost`) and it freezes. That path has no ack to order it, so it is best-effort: it is the
rescue of a possibly-dead holder, not the common case. Two live tabs on an engine with neither Web
Locks nor BroadcastChannel fall back to tabDoc's existing behaviour — never a hard block.

TESTABILITY: every side effect that touches OPFS, the lock, or the DOM is injected (see `Wiring`), so
the handshake ordering is provable at the unit level with a synchronous in-memory bus and spies — no
browser, no real Web Locks. Production binds the real primitives in `defaultWiring()`.

## <a id="so-two-surrenders"></a>Two flavours of surrender, and only one of them flushes

* **GRACEFUL** (a `take-over` message): flush the last body FIRST, while writes are still allowed,
  THEN freeze, THEN ack. The taker waits for the ack, so this preserves the holder's final keystrokes
  with zero overwrite risk. The flush routes through `saveDocument`, which the freeze refuses — hence
  the order. A failed flush is logged but never blocks the handoff: the taker then opens the
  previously saved state, which is safe (no overwrite), just missing the last unsaved edit.
* **FORCED** (the lock was stolen with no handshake — a rescue of a dead/hung tab): freeze ONLY, do
  NOT flush. The taker already owns the document and may already be writing; a late flush from us
  would be the overwrite we forbid. **Losing the last unsaved keystrokes is the correct trade when
  the alternative is corrupting the taker's copy.**

"Switch to it" is fire-and-forget: the holder may not be able to focus itself (browser policy), which
is why the blocked screen keeps its other two actions available.

## <a id="so-ack-timeout-grace"></a>THE ACK-TIMEOUT RACE, and why the post-steal GRACE closes it

Reproduced by the auditor. The ack timer can fire while a LIVE holder is still inside `await flush()`
— before it reaches its freeze. Steal-and-return-immediately then lets the caller READ the body while
the holder is still UNFROZEN with an in-flight `saveDocument` that can land AFTER the read; the
caller's later save would overwrite the holder's flushed final keystrokes — the exact overwrite this
mechanism exists to prevent.

**The steal itself cannot force an early freeze**: the holder's `onLockLost` fires `surrender(false)`,
but its `if (surrendered) return` guard is already tripped by the in-progress `surrender(true)`, so the
freeze only happens when that in-flight flush completes.

So after a timeout we STEAL, then wait a brief grace for the LATE `surrendered` a live slow-flusher
posts once it finishes flushing and freezes — guaranteeing the caller reads AFTER the freeze. A
genuinely dead holder never posts; the grace expires and the rescue proceeds exactly as before.
Degraded (no bus): steal only, as before.

ONE persistent listener covers the whole handoff: `acked` records a `surrendered` whenever it lands
and `onAck` wakes whichever phase is waiting. **Recording it even when no phase waits closes the gap
where the late ack arrives DURING the steal**, between the two waits.

`releaseFraming`-style fire-and-forget applies to `requestSwitch` too: the message is given time to
deliver before the channel is dropped.
