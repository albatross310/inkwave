<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Storage, sync and the open pipeline

`storage/onedrive.ts`, `gdrive.ts`, `folder.ts` (File System Access, Chromium-only) all write the
self-contained `.studio` and all obey the rules above. Why: `docs/archive/storage-and-sync.md`.

- **The cloud mirrors do not re-read** — `syncToOneDrive` takes the array it is handed, so
  `oneDriveWriteNow`'s local-read check is load-bearing. It lives in **`editor/useCloudSync.ts`**
  (2026-09-15 — the cloud-sync orchestration moved there VERBATIM out of TiptapEditor.tsx; the
  editor calls the hook and keeps the pill/pickers/⋮ JSX). `useCloudSync.test.tsx` drives the
  refusal for all three mirrors (folder / OneDrive / Drive) with named tests, mutant-proved.
  `useCloudSync.ts` holds the folder/OneDrive/Drive state, `mirrorIfActive` + the OneDrive throttle,
  sign-in/pickers/openers, re-link on load and the other-device heartbeat — THE DATA-LOSS FAMILY's
  mirror rules live here.
- **Cache HITS may only compare TRUSTED tags** (fresh listing / live metadata GET) in `openCache.ts`.
- **Background warm paths must NEVER call GIS `getDriveToken`** (its `requestAccessToken` opens a real
  popup even for `prompt:'none'`) — use `peekDriveToken()`.
- **The `.studio` parse runs OFF-THREAD** (`parseStudio`, `workers/parseClient.ts`); `inkwave:open-doc`
  carries the parsed doc.
- **`listSnapshots` loads EAGERLY on doc open** — scrubbing is a core moat; defer only
  not-needed-for-first-frame work (OTS).
- Snapshot restore defers its disk write behind the reveal (`_snapCache` write-through is
  authoritative in-session); library/PDF restore is fire-and-forget after. OneDrive PDF sidecars
  self-heal (`fetchMissingSidecars`, `fetchSidecarFor`) — metadata can claim a PDF with no bytes.
- **Unsynced-work notice** (`editor/unsyncedWatch.ts`): PURE rule (`shouldWarnUnsynced` + reducer),
  `UnsyncedNotice.tsx` is only its face. After 5 min of unsynced WORK; never while sync is active;
  never again once waved away. Every input is **read, not awaited**. **THE CLOCK STARTS AT A DOC
  CHANGE THE WRITER CAUSED** — `keydown`/`paste` ARM it, the next real change starts it. (A
  docChanged transaction alone starts it at PAGE LOAD; `beforeinput` never fires under ProseMirror.)
- **Snapshot React state is METADATA-ONLY** (`SnapshotMeta`) — fetch bodies via `listSnapshots` at
  action time, never hold `contentJson` in state. Autosave failures dispatch `inkwave:save-failed`.


## Tab identity, the document lock and take-over

Named in CLAUDE.md's DATA-LOSS FAMILY in short form; the full rules are here. Forensics:
`docs/archive/data-loss-incidents.md`.

- **Document identity is PER TAB** (`storage/tabDoc.ts`), carried in sessionStorage, never the URL —
  OneDrive sign-in returns to a bare `/` and any `?doc=` is gone. Precedence: `?doc=` ??
  sessionStorage ?? fresh blank; the URL is a reflection, never load-bearing.
- **ONE LIVE TAB PER DOCUMENT** via Web Locks, name from the ONE exported `DOC_LOCK_PREFIX` (the
  OpfsInspector badge queries it; a private copy of that string puts the badge silently to sleep).
  `claimDocLock` RETRIES past the reload unload-race, or a plain refresh intermittently hands the
  writer a blank page. No Web Locks ⇒ never block the writer.
- **A collided untouched `Untitled` is replaced, not warned.** A duplicated tab inherits the source
  tab's explicit identity; if that document is still exactly the canonical empty paragraph, `Edit.tsx`
  mints a different blank id silently. Title alone never bypasses the guard — an `Untitled` containing
  writing still gets the full switch/copy/take-over screen.
- **An effect that takes a lock needs a cancellation token that also RELEASES it** — React's
  StrictMode double-invoke is a real second claimant, and skipping the stale `setState` alone still
  leaks the lock.
- **A take-over is enforced at the bytes, not asserted.** The write freeze lives at the `saveDocument`
  funnel (storage/opfs.ts). Everything that REACHES that funnel from the editor — the one `commitDoc`
  path, the lazy `ensureDocFresh` rebuild the autosave beat consumes, the single snapshot queue and
  the `snapshotsForAction` read guard every publishing action shares — lives in
  **`editor/useSaveOrchestration.ts`** (2026-09-16, seam 3: moved VERBATIM out of TiptapEditor.tsx,
  which keeps the autosave beat inside `onUpdate`, the paragraph and word-nudge triggers, and
  `recoverAndPurge`). `useSaveOrchestration.test.tsx` drives the read-failure abort as a named test
  with a mutant. `useSaveOrchestration.ts` also holds the manual-snapshot funnel, the OTS sweep,
  export/save and the save-failed toast — THE DATA-LOSS FAMILY's front door. The holder flushes →
  freezes → ACKs, and the taker waits for that ack before stealing. After
  an ack TIMEOUT, steal, then wait a brief grace for a LATE `surrendered` — a live slow-flusher posts
  it once frozen; a dead holder never posts and the grace expires.
