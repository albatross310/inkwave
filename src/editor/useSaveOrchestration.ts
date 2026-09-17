// ─── Save orchestration — the path from an edit to the record on disk ───
// ⚠ THE DATA-LOSS FAMILY'S FRONT DOOR (CLAUDE.md, "⚠ THE DATA-LOSS FAMILY"; docs/archive/
// data-loss-incidents.md). Three of its rules pass through this file and none of them may be
// weakened here: a failed READ is not an empty archive (`snapshotsForAction` returns null and every
// caller ABORTS — an export, a sync, a "save version" are all re-runnable; a record written over a
// history we could not read is not); the write freeze lives at the `saveDocument` funnel in
// storage/opfs.ts, which `scheduleSave` reaches and this file never bypasses; and NOTHING here
// deletes provenance (`provenance/noAutoDelete.test.ts` walks this file).
//
// WHAT THIS FILE IS (2026-09-16, docs/REFACTOR-QUEUE.md item 3, seam 3): how the writer's edits reach
// the record — the ONE commit path every mutation takes (`commitDoc`: docRef, onDocChange,
// scheduleSave — `commitDoc.test.ts` scans this file), the lazily rebuilt document every consumer
// reads (`ensureDocFresh`, the console-snappy rule's other half: keystrokes mark it stale, the first
// consumer pays the O(doc) build), and the single snapshot queue (`snapQueueRef`) with the guarded
// archive read every publishing action shares. Moved VERBATIM out of TiptapEditor.tsx (the mechanical
// diff of the moved lines is EMPTY but for two `doc.id` → `docId` edits in the eager-load effect).
// Behaviour is pinned in `useSaveOrchestration.test.tsx`; `saveOrchestrationWiring.test.ts` pins that
// the editor still calls what this hands back.
//
// WHAT STAYS OUT, deliberately. The autosave beat itself (`scheduleSave(() => ensureDocFresh(), …)`)
// sits inside the editor's `onUpdate` handler behind the docChanged gate, and so do the two writers
// that DECIDE when to snapshot — the paragraph trigger (Enter, deferred to a quiet moment) and the
// word-nudge effect (bound to the signing session's refs). They are consumers of this queue and call
// `enqueueSnapshotWork` / `snapshotsForAction` / `setSnapshots`, which is why those are returned.
// `recoverAndPurge` stays in TiptapEditor.tsx regardless (Peter's rule). `runWhenQuiet` is a
// general scheduler, not a save concern.
//
// ⚠ THE TWO-WAY COUPLING WITH `useCloudSync`. A commit or a rebuild makes the mirror stale, so both
// clear the three "last sync" times (the setters arrive as inputs, as seam 2 exposed them for exactly
// this); `createManualSnapshot` mirrors after it stamps; `saveRecord` is the folder mirror on Chromium.
// In the other direction the cloud hook needs `ensureDocFresh` and `snapshotsForAction`. TiptapEditor
// resolves the cycle the way the unmoved code already did — by HOISTING: it calls `useCloudSync`
// first with two function DECLARATIONS that delegate here, and calls this hook after. Neither hook
// calls the other's functions during render.
//
// ⚠ EFFECT ORDER (docs/RULES.md R7). TiptapEditor calls this hook after `useCloudSync` and before
// `useEditor` (whose `onUpdate` closure reads what this returns), so its two effects — the
// save-failed listener + watchdog, and the eager snapshot-list load — run earlier in the component's
// sequence than the positions they left. Both act asynchronously: listeners, a 10s interval, and a
// promise `.then` that only ever sets state. Nothing between reads a value either sets synchronously.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { useEditor } from '@tiptap/react'
import type { InkwaveDocument, Snapshot, SnapshotMeta } from '../types/document'
import type { ScasController } from '../scas/controller'
import type { SessionRunner } from '../provenance/session'
import type { OpenNotice } from '../storage/openError'
import { scheduleSave } from '../storage/opfs'
import { markDocumentDirty, markRecognisedSave } from '../storage/docSource'
import { reportOpenError } from '../storage/openError'
import { oneDriveAccount } from '../storage/onedrive'
import { fileSaveAvailable } from '../storage/folder'
import { createSnapshotIfChanged, readSnapshotArchive, toSnapshotMeta, stampSnapshot, drainUnstamped, upgradePending, patchSnapshotDiffSummary, type ManualSnapshotResult } from '../provenance/snapshots'
import { summariseDiff } from '../provenance/summarise'
import { buildExportBundleWithPdfs, bundleFilename, downloadBundle, downloadBundleGz, pmToText } from '../provenance/bundle'
import { embedBibliography } from '../citations/resolve'
import { titleForDocument } from './docTitle'
import { getGreenAnchors } from './extensions/RedHighlightExtension'

export interface SaveOrchestrationInput {
  /** The component's live document mirror — `commitDoc` and `ensureDocFresh` are its only writers here. */
  docRef: MutableRefObject<InkwaveDocument>
  /** The open document's id — the eager snapshot-list load re-runs on a switch. */
  docId: string
  /** The shell's notify — the second leg of the commit triple. */
  onDocChange: (updated: InkwaveDocument) => void
  /** The live editor handle the lazy rebuild reads (`getJSON`, the first block's title, anchors). */
  editorRef: MutableRefObject<ReturnType<typeof useEditor>>
  /** The SCAS controller — its live state is mirrored onto the rebuilt document for persistence. */
  scasRef: MutableRefObject<ScasController | undefined>
  /** The signing session — a manual snapshot carries the current session's receipts. */
  sessionRef: MutableRefObject<SessionRunner | null>
  /** The notice surface the save-failed toast writes (shared with open and paste errors). */
  setFileOpenError: Dispatch<SetStateAction<OpenNotice | null>>
  /** From `useCloudSync`: a commit or rebuild makes every mirror stale. */
  setLastFileSave: Dispatch<SetStateAction<number | null>>
  setLastSync: Dispatch<SetStateAction<number | null>>
  setLastGdriveSync: Dispatch<SetStateAction<number | null>>
  /** From `useCloudSync`: mirror after a manual snapshot is stamped. */
  mirrorIfActive: () => void
  /** From `useCloudSync`: the Chromium folder mirror `saveRecord` prefers. */
  saveToFile: () => Promise<void>
}

export interface SaveOrchestration {
  commitDoc: (updated: InkwaveDocument) => void
  ensureDocFresh: () => InkwaveDocument
  /** Written by the editor's `onUpdate` on every docChanged transaction; read by `ensureDocFresh`. */
  docStaleRef: MutableRefObject<boolean>
  snapshots: SnapshotMeta[]
  setSnapshots: Dispatch<SetStateAction<SnapshotMeta[]>>
  enqueueSnapshotWork: (work: () => Promise<void>) => void
  createManualSnapshot: (source?: InkwaveDocument) => Promise<ManualSnapshotResult>
  saveVersion: () => void
  checkBitcoin: () => void
  runOtsSweep: () => void
  snapshotsForAction: (action: string) => Promise<Snapshot[] | null>
  exportBundle: (stripPdfs?: 'all' | 'public', gzip?: boolean) => Promise<void>
  saveRecord: () => void
}

export function useSaveOrchestration({
  docRef, docId, onDocChange, editorRef, scasRef, sessionRef, setFileOpenError,
  setLastFileSave, setLastSync, setLastGdriveSync, mirrorIfActive, saveToFile,
}: SaveOrchestrationInput): SaveOrchestration {
  // ── ⚠ ONE COMMIT PATH FOR A DOCUMENT MUTATION (R2) ────────────────────────────────────────────
  // Every mutation does the same three things in the same order: docRef, onDocChange, scheduleSave.
  // Written longhand at ten call sites, omitting the third is SILENT — the edit appears on screen
  // and only the DISK is stale, so the work is lost at the next reload rather than at the mistake.
  // NB `ensureDocFresh` deliberately does NOT use this: it CACHES a lazily-built document and is not
  // a mutation. → docs/archive/editor-surface.md#editor-commit-doc
  const commitDoc = (updated: InkwaveDocument) => {
    markDocumentDirty(updated.id)
    setLastFileSave(null)
    setLastSync(null)
    setLastGdriveSync(null)
    docRef.current = updated
    onDocChange(updated)
    scheduleSave(updated)
  }

  // Snapshots (the provenance record). Loaded per document; appended when a resolved kick changes
  // the content. createSnapshotIfChanged is serialised through a promise chain so rapid kicks can't
  // race the OPFS read-modify-write. MEMORY DIET: React state holds SnapshotMeta ONLY — a full
  // Snapshot embeds its whole contentJson (+ receipts), so hundreds of snapshots on a thesis-scale
  // doc would keep hundreds of MB resident here. Heavy consumers (export, verify, mirrors, diff
  // summaries) fetch full snapshots via listSnapshots() at action time (cached, cheap).
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const snapshotsRef = useRef<SnapshotMeta[]>([])
  // Keep ref in sync so async snapshot-queue closures can read the latest list without stale closure.
  snapshotsRef.current = snapshots
  const snapQueueRef = useRef<Promise<void>>(Promise.resolve())

  const docStaleRef = useRef(false)           // docRef.contentJson lags the editor until ensureDocFresh

  // SILENT-SAVE-FAILURE GUARD (2026-07-10: two hours of edits died silently — the save-failed
  // event had NO listeners). Any autosave failure now shows the visible error toast, and a
  // watchdog flags a save gap: edits pending + no successful save for 60s = something is stuck
  // (e.g. a latched __iwZoomHold) — surface it loudly instead of losing work.
  useEffect(() => {
    let privateNoticeShown = false
    const onFail = (e: Event) => {
      const msg = String((e as CustomEvent).detail?.error ?? 'unknown error')
      // OPFS refused at the door (SecurityError from getDirectory) = this WINDOW can't store
      // files at all — Firefox private browsing, not a stuck save. A reload won't help and the
      // red re-arming banner is just noise (Peter, 2026-07-11): calmer copy, once per session,
      // dismiss is final.
      if (/security ?error|getDirectory/i.test(msg)) {
        if (privateNoticeShown) return
        privateNoticeShown = true
        // With OneDrive signed in the work IS being stored (cloud, from memory) — no banner at
        // all then; the notice is only for a private window with nowhere to put the writing.
        void oneDriveAccount().then((acct) => {
          if (acct) { console.info('inkwave: local storage unavailable (private window) — cloud sync is carrying saves'); return }
          setFileOpenError({ message: 'This window can’t store files on this device (private browsing?). Your work lives in memory only — keep cloud sync on, or export before closing the tab.', kind: 'error' })
        }).catch(() => {
          setFileOpenError({ message: 'This window can’t store files on this device (private browsing?). Your work lives in memory only — keep cloud sync on, or export before closing the tab.', kind: 'error' })
        })
        return
      }
      setFileOpenError({ message: `SAVING IS FAILING — your changes are NOT being stored on this device (${msg}). Copy recent work somewhere safe, then reload.`, kind: 'error' })
    }
    window.addEventListener('inkwave:save-failed', onFail)
    let lastSaved = performance.now()
    const onSaved = () => { lastSaved = performance.now() }
    window.addEventListener('inkwave:doc-saved', onSaved)
    const watchdog = setInterval(() => {
      const hold = (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold
      if (hold) {
        // a zoom gesture can't plausibly last 60s — clear the stuck flag so deferrals resume
        const w = window as unknown as { __iwZoomHoldSince?: number; __iwZoomHold?: boolean }
        if (!w.__iwZoomHoldSince) w.__iwZoomHoldSince = performance.now()
        else if (performance.now() - w.__iwZoomHoldSince > 60_000) { w.__iwZoomHold = false; w.__iwZoomHoldSince = 0 }
      } else {
        (window as unknown as { __iwZoomHoldSince?: number }).__iwZoomHoldSince = 0
      }
      void lastSaved // (gap detection rides onSaved; the toast on failure is the primary signal)
    }, 10_000)
    return () => { window.removeEventListener('inkwave:save-failed', onFail); window.removeEventListener('inkwave:doc-saved', onSaved); clearInterval(watchdog) }
  }, [])

  // Rebuild docRef from the live editor if a keystroke left it stale (the lazy half of the
  // console-snappy rule). Called at every point that consumes the document: the autosave beat,
  // ALL snapshot work (via enqueueSnapshotWork), period signing, and mirrors — so provenance
  // always hashes the exact current content; between those points docRef may lag by ≤200ms.
  function ensureDocFresh(): InkwaveDocument {
    if (!docStaleRef.current) return docRef.current
    const e = editorRef.current
    if (!e || e.isDestroyed) return docRef.current
    docStaleRef.current = false
    const base: InkwaveDocument = {
      ...docRef.current,
      contentJson: e.getJSON(),
      updatedAt: new Date().toISOString(),
      // First block only — reading the title from e.getText() walked the ENTIRE doc for one line.
      // The email-vs-body precedence lives in docTitle.ts, with the reasoning and its tests.
      title: titleForDocument(docRef.current, e.state.doc.firstChild?.textContent ?? ''),
      scasState: scasRef.current?.state ?? docRef.current.scasState,
      scasGreenAnchors: getGreenAnchors(e.state),
    }
    const { doc: updated } = embedBibliography(base)
    markDocumentDirty(updated.id)
    setLastFileSave(null)
    setLastSync(null)
    setLastGdriveSync(null)
    docRef.current = updated
    return updated
  }

  // Serialise all snapshot-file mutations through one promise chain (avoids OPFS read-modify-write
  // races between snapshot creation, OTS stamping, and upgrades). Freshness guard: every snapshot
  // consumes docRef, so the queue itself guarantees the lazy doc build has run first.
  function enqueueSnapshotWork(work: () => Promise<void>) {
    snapQueueRef.current = snapQueueRef.current
      .then(async () => { ensureDocFresh(); await work() })
      .catch((err) => { console.warn('[inkwave] snapshot work failed:', err) })
  }

  // ⚠ R1: a failed read must never REPLACE a good list with an empty one — the panel would then
  // assert, in the UI, the exact lie the storage layer no longer tells.
  const refreshSnapshots = async (docId: string) => {
    const r = await readSnapshotArchive(docId)
    if (r.kind === 'error') { console.warn('[inkwave] snapshot list refresh skipped — archive unreadable:', r.error); return }
    setSnapshots(r.snapshots.map(toSnapshotMeta))
  }

  // ⚠ THE SNAPSHOT LIST LOADS EAGERLY — rapid scrubbing is a core feature, so the reviewer never
  // waits — while the OTS Bitcoin re-check MUST NOT run here (per-snapshot rewrites + serial
  // calendar round-trips, ~10s of startup lag); it runs throttled when the receipts panel opens.
  // ⚠ R1: a failed read here would render "no snapshots yet" over a full archive — the storage
  // bug's own claim, made by the UI, as the writer opens his thesis. Say it plainly instead.
  // → docs/archive/editor-surface.md#editor-archive-reads
  useEffect(() => {
    let cancelled = false
    void readSnapshotArchive(docId).then((r) => {
      if (cancelled) return
      if (r.kind === 'error') {
        console.error('[inkwave] could not load the snapshot list:', r.error)
        reportOpenError(
          "Inkwave couldn't read this document's history just now, so the snapshot list is " +
          'incomplete. Your history is still on this device and nothing has been changed — reload ' +
          'to try again.',
        )
        return
      }
      setSnapshots(r.snapshots.map(toSnapshotMeta))
    })
    return () => { cancelled = true }
  }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ONE global manual-snapshot funnel. The ordinary "save version" control and an email's
  // "Snapshot this draft" both come here, so the archive, live counter, OTS state, mirrors and diff
  // summary can never drift into application-specific implementations. When `source` is supplied it
  // is the exact frozen message also sent to Gmail; later typing stays live and is never overwritten.
  function createManualSnapshot(source?: InkwaveDocument): Promise<ManualSnapshotResult> {
    const action = snapQueueRef.current.then(async (): Promise<ManualSnapshotResult> => {
      const snapshotDoc = source ?? ensureDocFresh()
      if (snapshotDoc.id !== docRef.current.id) {
        return { snapshot: null, stamped: false, reason: 'The active document changed before it could be snapshotted' }
      }
      // Guarded for the same reason as the word-nudge path: a "Save version" that silently did
      // nothing is the worst possible answer at the moment the writer is deliberately marking work.
      const before = await snapshotsForAction('this version')
      if (!before) return { snapshot: null, stamped: false, reason: 'Snapshot history is temporarily unavailable' }
      const prevSnap = before[before.length - 1] ?? null
      const snap = await createSnapshotIfChanged(snapshotDoc, 'manual', sessionRef.current?.receipts ?? [], undefined, true)
      if (!snap) return { snapshot: null, stamped: false, reason: 'Provenance snapshots are unavailable on this browser' }
      setSnapshots((prev) => [...prev, toSnapshotMeta(snap)])
      const stamped = await stampSnapshot(snap.documentId, snap.id)
      if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? toSnapshotMeta(stamped) : s)))
      mirrorIfActive()
      // Background diff summary (Haiku, fire-and-forget)
      if (prevSnap) void summariseDiff(pmToText(prevSnap.contentJson), pmToText(snap.contentJson)).then(async (ds) => {
        if (!ds) return
        await patchSnapshotDiffSummary(snap.documentId, snap.id, ds)
        setSnapshots((prev) => prev.map((s) => s.id === snap.id ? { ...s, diffSummary: ds } : s))
      })
      const final = stamped ?? snap
      return {
        snapshot: final,
        stamped: final.ots.status === 'pending' || final.ots.status === 'confirmed',
        reason: stamped ? undefined : 'Snapshot created locally; timestamping will retry later',
      }
    })
    snapQueueRef.current = action
      .then(() => undefined)
      .catch((error) => { console.warn('[inkwave] snapshot work failed:', error) })
    return action.catch((error) => ({
      snapshot: null,
      stamped: false,
      reason: error instanceof Error ? error.message : 'Could not create the snapshot',
    }))
  }

  function saveVersion() {
    void createManualSnapshot()
  }

  // Manual "check Bitcoin" — upgrade pending proofs toward confirmation (also runs on load).
  function checkBitcoin() {
    const docId = docRef.current.id
    enqueueSnapshotWork(async () => { await upgradePending(docId); await refreshSnapshots(docId) })
  }

  // Background OTS sweep — stamp any unstamped backlog + upgrade pending proofs toward Bitcoin
  // confirmation. Runs when the receipts panel OPENS (not on load — that was the startup lag), and
  // only when there's actually something to do, at most once per 15 min per doc (confirmations take
  // hours). The panel's "check Bitcoin" button still forces an immediate upgrade any time.
  function runOtsSweep() {
    const docId = docRef.current.id
    const needsOts = snapshotsRef.current.some((sn) => sn.ots?.status === 'unstamped' || sn.ots?.status === 'pending')
    if (!needsOts) return
    const OTS_KEY = `inkwave:otsCheckedAt:${docId}`
    let lastOts = 0
    try { lastOts = Number(localStorage.getItem(OTS_KEY)) || 0 } catch { /* private mode */ }
    if (Date.now() - lastOts < 15 * 60 * 1000) return
    enqueueSnapshotWork(async () => {
      await drainUnstamped(docId)
      await upgradePending(docId)
      await refreshSnapshots(docId)
      try { localStorage.setItem(OTS_KEY, String(Date.now())) } catch { /* private mode */ }
    })
  }

  // ⚠ THE ARCHIVE READ FOR ANY ACTION THAT PUBLISHES OR OVERWRITES THE RECORD (R1). `listSnapshots`
  // THROWS rather than answering `[]`, because `[]` meant "no history" and every one of these
  // actions would then export or write an empty history over the real one — but a throw reaching a
  // click handler is just a button that does nothing. So each action reads through here and is
  // CANCELLED with a message. Cancelling is the safe direction: an export, a sync and a mirror are
  // all re-runnable; a .studio the writer believes holds his proof is not. An established
  // emptiness is NOT a failed read, so a genuinely new document still gets `[]`.
  // → docs/archive/editor-surface.md#editor-archive-reads
  async function snapshotsForAction(action: string): Promise<Snapshot[] | null> {
    const r = await readSnapshotArchive(docRef.current.id)
    if (r.kind === 'error') {
      console.error(`[inkwave] ${action}: could not read the snapshot archive — cancelled:`, r.error)
      reportOpenError(
        `Inkwave couldn't read this document's history just now, so ${action} was cancelled rather ` +
        `than risk writing an incomplete record over it. Your writing and your history are safe on ` +
        `this device — try again in a moment.`,
      )
      return null
    }
    return r.snapshots
  }

  // Export the self-verifying bundle (content + snapshots + receipts + key ref) for /verify (M4).
  // Uses the async variant so embedded source PDFs travel inside the .studio file.
  async function exportBundle(stripPdfs?: 'all' | 'public', gzip?: boolean) {
    // Full snapshots fetched AT ACTION TIME (cached read) — state holds metadata only.
    const snaps = await snapshotsForAction('the export')
    if (!snaps) return // a bundle exported from a failed read is a FALSE receipt — never ship one
    const bundle = await buildExportBundleWithPdfs(docRef.current, snaps, stripPdfs)
    const base = bundleFilename(docRef.current)
    const name = stripPdfs === 'all' ? base.replace(/\.studio$/, '.no-pdfs.studio') : base
    if (gzip) await downloadBundleGz(bundle, name + '.gz')
    else downloadBundle(bundle, name)
    markRecognisedSave(docRef.current.id, 'download')
  }

  // Primary "Save" — works on every browser. Chromium (Chrome/Edge/Brave) mirrors to a granted
  // folder via File System Access; Firefox/Safari (no folder API) download the record instead.
  function saveRecord() {
    if (fileSaveAvailable()) void saveToFile()
    else exportBundle()
  }

  return {
    commitDoc, ensureDocFresh, docStaleRef, snapshots, setSnapshots, enqueueSnapshotWork,
    createManualSnapshot, saveVersion, checkBitcoin, runOtsSweep, snapshotsForAction, exportBundle, saveRecord,
  }
}
