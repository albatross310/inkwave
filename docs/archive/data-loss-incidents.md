# Data-loss incidents — the forensics (2026-07-05 → 2026-08-20)

**This is the NARRATIVE. The RULES are in CLAUDE.md** under "Cloud sync + writer-held files"; that
entry points here. **The rules are the operative text — do not treat this file as the source of
truth for what the code must do.**

Six separate incidents, on Peter's real honours thesis, all of the same family. Each is written up
here because the *mechanism* matters when you are deciding whether a new code path is an instance of
it — and because two of them were re-introduced by lanes that had read a summary and not the
forensics.

The family, in one sentence: **an unknown was answered as if it were a known-empty.**

| # | Date | What was answered | What it actually was | Cost |
|---|---|---|---|---|
| 1 | 2026-07-05 | "the target has no snapshots" | a short/racing read | archive truncated |
| 2 | 2026-07-15 | "this document does not exist" (`readJson` → null) | a transient read fault | a day's annotations; a blank doc minted and the pointer moved |
| 3 | 2026-07-15 | "the incoming file is newer" | a stale file stamped `updatedAt: now` | Wednesday's work overwritten by an 07-08 export |
| 4 | 2026-07-17 | "this document has no history" | a transient OPFS fault | archive truncated to one snapshot |
| 5 | 2026-08-20 | "this chain is forged" | unverifiable *by this build with this key* | 79 anchored snapshots deleted to 4, twice |
| 6 | 2026-08-20 | "nobody else has written" | a per-tab cache that was stale, not short | a second tab's write landed over 79 |

Note #5 and #6 are the two that a summary hides: #5 was code deleting provenance **on purpose** and
working exactly as written, and #6 is a read that SUCCEEDS and returns a confidently outdated answer,
which no "short read" guard catches.

---

- **THE ARCHIVE READ IS NOW PROVED IN A REAL BROWSER (2026-07-17) — `__iwArchiveGuard` + the probe
  it was added FOR.** `readSnapshotsFromDisk`'s `catch { return [] }` answered "this document has no
  history" to a transient fault, and the next write truncated the archive to one snapshot (every OTS
  proof + signed receipt gone). Fixed earlier that day (`isNotFound ⇒ []`, everything else throws;
  write paths refuse) and pinned by unit tests on a shim OPFS. **`scripts/archguard-probe/repro.mjs`
  is the REAL-OPFS half**: it builds a real 4-snapshot history through the real UI, injects a real
  read fault, and audits the gzip off the disk OUT of the app's own code path (asking the suspect to
  certify itself is how a probe ends up structurally incapable of seeing its bug). The seam was added
  WITH it, never before — the previous lane refused to add a live off-switch for provenance with no
  consumer, and that rule still binds: **if the probe goes, the seam goes.**
  - **THREE CELLS, and the OUTAGE one runs FIRST** (a new document must still get a blank archive —
    an established emptiness is not a failed read; and every other cell needs a working first save,
    so a clamped guard otherwise dies in setup as a bare timeout that reads as flakiness).
  - **TWO FAULT MODES, and the second is not optional.** The read has TWO catch arms: the open can
    reject (transient I/O) or the PAYLOAD can be unreadable (corrupt gzip). **MUTATION-PROVED: with
    only the reject mode, collapsing the parse arm to `return []` left the probe FULLY GREEN** — a
    cell certifying a line it could not reach. The corrupt-gzip fixture is what kills that mutant.
  - **The caller guard is NOT the data guard (mutant survived, and it is a true fact not a gap).**
    Removing `snapshotsForAction`'s error branch loses nothing, because `createSnapshotIfChanged`
    re-reads and throws by itself. That guard exists to TELL THE WRITER it was cancelled. **The
    exception is the cloud mirrors** — `syncToOneDrive` takes the array it is handed and never
    re-reads, so `oneDriveWriteNow`'s local-read check (TiptapEditor.tsx) IS load-bearing and is
    the one truncation vector still unprobed (it needs a real Graph sign-in).
- **⚠ THE PURGE — 2026-08-20, AND IT IS THE WORST OF THE FAMILY: CODE THAT DELETED PROVENANCE ON
  PURPOSE.** Peter's Honours Proposal went from 79 Bitcoin-anchored snapshots to 4, twice in one
  session, and `/snapshot` then said the history "isn't on this device" about work that had been
  there minutes earlier. Not a race, not a cache — `recoverAndPurge` (TiptapEditor.tsx) verified each
  signed receipt chain, marked every session whose chain FAILED as "bad", and deleted every snapshot
  whose receipts were all from bad sessions. It worked exactly as written.
  - **THE PREMISE WAS THE BUG, NOT THE LOOP.** A chain that fails `verifyChain` has not been shown to
    be FORGED — only to be unverifiable BY THIS BUILD WITH THIS KEY. And the commonest cause is
    innocent: `signingPublicKeyHex()` returns the DEV key under `import.meta.env.DEV`, so every
    PRODUCTION-signed document fails every chain the moment it is opened on localhost. Peter develops
    on localhost and opens his real thesis there. A rotated key, an older bundle or a partial receipt
    set would do the same to a real user in production.
  - **WHY IT ALWAYS LANDED ON THE SAME SMALL NUMBER**, which made it look like a mysterious floor:
    `snapReceipts.length > 0` spared snapshots with NO receipts. The survivors were exactly those.
  - **THE RULE, and it is this file's own one step along: A FAILED VERIFICATION IS NOT A FORGED
    SNAPSHOT.** A failed READ is not an empty archive (readSnapshotsFromDisk); a failed read is not an
    absent document (opfs.ts); and this. None may be answered by deleting the writer's work.
    Provenance is append-only — it is not ours to discard to make a check go green. Deletion must be
    writer-initiated (the confirm()-gated button in SnapshotView), never a background sweep.
  - KEPT by `provenance/noAutoDelete.test.ts` — an allow-list of the only modules that may reach
    `deleteSnapshot`, 15ms, no browser, mutation-proved (reintroducing the automatic call kills 2 of
    4). **Comments are STRIPPED before scanning**, deliberately: the fix's own comment NAMES
    `deleteSnapshot` to explain why it must never be called, and a guard reading raw text would fire
    on its own documentation — the corrosion this file records biting three lanes in one round.
  - The FALSE VERDICT is fixed too (`signingPublicKeys()`, provenance/receipts.ts): verification now
    accepts ANY key we ever signed with, so a production-signed document verifies on localhost.
    `bundle.ts` keeps the single-key `signingPublicKeyHex()` — what we SIGN with is not what we
    ACCEPT, and conflating those was the bug. Pinned by `multiKeyVerify.test.ts` against the REAL
    server core. NB `ed.verifyAsync` THROWS on an unparseable key rather than returning false, so
    each key attempt is guarded separately — an unguarded loop rejects a receipt a later key would
    have verified, and the single-key path hides it (throw and false both end `{ ok: false }`).
  - PROVED against the real 40MB `.studio` in a real browser: before 79 → 78 → 76 → 73 (progressive,
    seconds after load); after 79 → 79 → 79 → 79 through open, reload, a second tab, that tab
    writing, and 25 scrub steps in /snapshot.
- **A STALE PER-TAB CACHE COULD ALSO TRUNCATE (2026-08-20) — real, separate, and NOT what bit Peter.**
  `_snapCache` is module state, so it is PER TAB, and snapshots.ts treats it as "the in-session
  authority". Across two tabs that is false: a tab that loaded when the archive held 4 keeps `cache =
  4` for its whole life, and if another tab (or an open-time bundle restore) grows the archive to 79
  on disk, the first tab's next write unions against its own stale 4 and lands that over the top.
  `mergeSnapshots` did not catch it because it guards a SHORT read — this read is not short, it is
  STALE: it succeeds and returns a confidently outdated answer. Every write now unions against DISK
  inside the write chain, gated on a byte-SIZE comparison (if the file is the length this tab last
  wrote, nobody else touched it) so the single-tab path pays one metadata read and no gunzip. A
  failed re-read ABANDONS the write — losing one new snapshot is recoverable, overwriting an archive
  we could not read is not. `deleteSnapshot` must ask for `allowShrink`. Reproduction-first
  (`staleCacheTruncation.test.ts`, two module instances over one disk) and it FAILED against unfixed
  code (4 on disk became 2). **STATED, NOT PROBED: module level only — the iOS worker
  `createSyncAccessHandle` write path is untested for this, and that is the path the iPhone takes.**
- **THE DOCUMENT BODY IS NOW GUARDED TOO (2026-07-17) — the 07-15 incident, and it destroyed real
  thesis work.** The grow-only rule above protected the snapshot ARCHIVE and *nothing protected
  `current.json`*. That asymmetry ate a day of Peter's honours-proposal annotations. TWO silent
  failures in sequence, both now fixed, both with live known-negatives:
  - **The swallowed READ (11:19:40).** `opfs.ts readJson` ended `catch { return null }`, so a
    transient failure was **indistinguishable from "no such file"** — and Edit.tsx answers null by
    falling through to `newDocument()` **and repointing the active-doc pointer at the blank**
    (measured: doc `978e0772`, createdAt == updatedAt, 0 chars). **The defect was not the missing
    log — the TYPE erased the difference.** Now `readJson` returns null ONLY on `NotFoundError` and
    throws **`StorageReadError`** otherwise (a corrupt JSON parse counts as a failure, not an
    absence); `newDocument()` is **reachable only from absence, never from an error** — and if any
    read failed while walking the index, init throws rather than concluding "you have nothing".
    A failure renders **`StorageUnavailable`** (never a blank page — the blank page is what sent him
    to a backup file) with Reload + the Storage inspector inline. NB the same file already insisted
    **writes** stay loud; the read path was the silent half.
  - **The blind OVERWRITE on open (11:30:18).** `openDoc.ts` takes the id FROM THE FILE, stamps
    `updatedAt: now`, and called `saveDocument(doc)` — an unconditional whole-file replace. He
    opened a stale `.studio` (07-10 file carrying 07-08 content) to recover from the blank and it
    replaced Wednesday's work (proved: stale export and the `current.json` written that instant hash
    identically, `ce421bc5…`). **The read bug CAUSED the open that triggered the write bug.**
    Now `storage/openConflict.ts` `classifyOpen` decides by **ANCESTRY, never `updatedAt`** (this
    path stamps `updatedAt` to now, so a stale file arrives looking brand new): if the incoming
    contentHash is in the LOCAL snapshot archive the file is a PAST STATE ⇒ `incoming-stale` ⇒ keep
    the local body untouched (its snapshots still merge in — pure gain). Local in the incoming
    archive ⇒ `incoming-newer` ⇒ a legitimate sync-down, adopt. Neither, ambiguous, **or the local
    read failed** ⇒ `diverged` ⇒ open as a SEPARATE document, nothing overwritten, no cloud binding
    for the copy. **The two bugs compose**: a null-on-failure read makes `localHash` null ⇒
    `incoming-newer` ⇒ blind overwrite, so the read fix is load-bearing for this guard.
  - PROVED, both engines incl. Firefox (Peter's), control-vs-fixed in ONE build:
    `scripts/openguard-probe/repro.mjs` (`__iwOpenGuard='off'` ⇒ destroys the later work;
    on ⇒ `verdict=incoming-stale`, 1 doc, work survives) and `blankdoc.mjs`
    (`__iwReadGuard='off'` ⇒ blank doc minted + pointer moved; on ⇒ pointer untouched, nothing
    minted). Unit keepers `openConflict.test.ts` — **mutation-tested** (drop the stale clause / move
    the ambiguous clause after the directional tests ⇒ named tests fail).
- **Per-tab document identity (2026-07-17).** `storage/tabDoc.ts`. `inkwave:activeDocumentId` was
  ONE localStorage slot **for the whole origin**: every tab wrote it, every tab read it on boot, so
  one tab's document switch silently re-pointed another, which adopted it on its next reload —
  leaving the first tab's work orphaned on disk (intact, unreachable). **sessionStorage is the
  carrier, NOT the URL**: OneDrive sign-in is `msal.loginRedirect` with
  `redirectUri: window.location.origin` — it returns to a BARE `/` and any `?doc=` is gone (the
  hard case Peter named: "even if you leave to go to microsofts page"). Precedence
  `?doc=` ?? sessionStorage ?? last-doc hint (new tabs only); the URL is a reflection, never
  load-bearing (round-8 bug 2 is the precedent). **ONE LIVE TAB PER DOCUMENT** via Web Locks
  (`claimDocLock`, name = `DOC_LOCK_PREFIX + id` — **one exported constant**, because OpfsInspector
  badges "open in another tab" from `navigator.locks.query()` and a private copy of that string
  would let a rename put the badge silently to sleep): two tabs on one file blind-autosave over each
  other (`saveDocument` has no union/generation check), so a tab that finds its document held takes
  one of its own. `claimDocLock` RETRIES past the reload unload-race — without it a plain refresh
  intermittently looks like "another tab has this" and hands the writer a blank page. No Web Locks
  (older WebKit) ⇒ never block the writer. PROVED both engines, control `__iwTabDocRule='shared'`
  loses data in all 3 cells (identity / two-tab clobber / OAuth round-trip), fixed loses none:
  `scripts/tabdoc-probe/repro.mjs`. **NB this is NOT what caused the 07-15 loss** (forensics refuted
  it: an opened file, not a pointer race) — it is a separate, real, reproduced class.
- **STRICTMODE'S DOUBLE-INVOKE ORPHANED DOCUMENT LOCKS (2026-08-20).** "This document is open in
  another window" after a plain refresh, single tab, 100% reproducible in isolation. Edit.tsx's init
  effect had NO CLEANUP, so React's deliberate mount→cleanup→remount ran the whole async claim twice
  for real: on a new tab each pass minted its own document and left an orphaned lock (measured: ONE
  tab holding TWO document locks via `navigator.locks.query()`); on a reload both passes raced for
  the same lock and — Web Locks not special-casing same-page — the loser saw it held exactly as a
  genuine second tab would, and whichever `setState` landed last won the render, so the blocked
  screen could persist even though the winner had opened the document fine. Fixed with a
  cancellation token that ALSO RELEASES a lock a cancelled pass took: skipping stale setState alone
  still leaks the lock. 12/12 clean after. **A StrictMode double-invoke is not a dev-only nuisance
  when the effect takes a real lock — it is a real second claimant.**
- **Single-open lock — a proper UI in front of the Web-Locks mechanism above (2026-07-18, `6c7feea`
  + `4beee0e`).** The per-tab identity work above stops two tabs blind-autosaving over each other, but
  silently: "a tab that finds its document held takes one of its own." This adds the writer-facing
  half, keyed by document id, same-device, IN FRONT OF that existing per-tab isolation (kept as
  backstop, not replaced). Opening a document another window on this device already holds no longer
  silently opens something else — it shows "This document is open in another window" with three
  actions: **[Switch to it]** (BroadcastChannel focus), **[Open a copy]** (clone under a new id), and
  **[Take over here]** (safe handoff).
  - **The take-over is the whole mechanism, and it is enforced at the bytes, not asserted.** The
    losing tab must STOP WRITING before the winning tab starts: a write freeze at the `saveDocument`
    funnel (`storage/opfs.ts`) refuses a surrendered document, and the handshake
    (`storage/singleOpen.ts`) has the holder flush→freeze→ACK while the taker awaits that ack before
    stealing the Web Lock and writing. A Web Lock steal alone freezes the loser
    (`tabDoc.onDocLockLost`) on the no-BroadcastChannel path; a stale lock from a crashed tab
    auto-releases so a writer is never locked out of their own document; an ack-timeout rescue steal
    covers a hung holder. Cross-device is untouched (cloud merge owns that); degrades gracefully with
    no Web Locks / private windows / no BroadcastChannel — never a hard dead-end.
  - **`4beee0e` closed a real overwrite vector the auditor found and reproduced same-day**: the
    ack timer (2500ms) could fire while a LIVE holder was still inside `await flush()`, before it
    reached its freeze — the taker would then steal and the caller could read the body while the
    holder's in-flight `saveDocument` was still pending, and that write landing after the read let a
    later save overwrite the holder's flushed final keystrokes (the exact overwrite this mechanism
    exists to prevent). Fix: after an ack TIMEOUT, steal, then wait a brief grace (1500ms default) for
    a LATE `surrendered` — a live slow-flusher posts it once its flush completes and freezes, so the
    caller reads AFTER the freeze; a genuinely dead holder never posts and the grace just expires.
  - Mutation-proved (no browser): the write freeze (`opfs.freeze.test.ts`), handshake ordering +
    freeze-on-steal (`singleOpen.test.ts`), the second-tab block + steal notification via an
    in-process fake `LockManager` (`tabDoc.locks.test.ts`), the UI wiring
    (`DocumentOpenElsewhere.test.tsx`), and the ack-timeout race fix itself (a gated in-flight flush
    with `ackTimeoutMs < flush` proves the taker now reads after freeze).
