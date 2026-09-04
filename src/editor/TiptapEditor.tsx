import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useZoomScale } from './useZoomScale'
import { TOOLBAR_BOTTOM_PX } from '../components/sidePill'
import { useEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { buildEditorExtensions } from './extensions/editorExtensions'
import type { InkwaveDocument } from '../types/document'
import { scheduleSave } from '../storage/opfs'
import { upsertMeta } from '../storage/indexeddb'
import { SCAS_HINT_META, getGreenAnchors } from './extensions/RedHighlightExtension'
import { applyCrossoutMode } from './crossout'
import { exportPdfToNewTab } from './exportPdf'
import { exportLatexDownload, exportEquationsDownload } from './exportLatex'
import type { HintState } from './extensions/RedHighlightExtension'
import { REFLOW_OPEN_MS, type LineRange } from './suggestions/ThesaurusPopover/popoverConstants'
import { syncReviewVisibilityStyles, clearLegacySuggestFlag, setSuggestOn } from './review/reviewState'
import { rememberReturn } from '../citations/citationNav'
import { readScrollMemory, writeScrollMemory, restoreOffset } from './scrollMemory'
import { CommentNotes } from '../components/CommentNotes'
import { ReviewBar } from '../components/ReviewBar'
import { Scroll, isTouchDevice } from './Scroll'
import { createDock } from './toolbarDock'
import { moveSlot, nearestSlot, neighborShift, brokeHoldSlop } from './toolbarSlots'
import {
  SlotId, BarLayerId, BAR_HANDOFF_MS,
  overflowSlots, planBarToggle, readStoredRow, saveStoredRow,
  slotIndexForDigit, hotkeyHintFor,
  readToolbarConfig, resolveToolbarRow, mayPersistConfig, mergeRowIntoConfig,
} from './toolbarContract'
import { subscribe as subscribeMagnify } from './magnify'
import { ThesaurusPopover } from './suggestions/ThesaurusPopover'
import { CaretGutter } from './CaretGutter'
import { prefetchSynonyms } from './suggestions/thesaurus'
import { OptionsMenu } from '../components/OptionsMenu'
import { MathMenuButton } from '../components/MathMenu'
import { StyleBar } from '../components/StyleBar'
import { GuideMenu } from '../components/GuideMenu'
import { ComplianceContext, useComplianceProvider } from '../scas/compliance'
import { ScasController } from '../scas/controller'
import { normalizeScasState, DEFAULT_SET_SIZE } from '../scas/state'
import { createSnapshotIfChanged, readSnapshotArchive, toSnapshotMeta, stampSnapshot, drainUnstamped, upgradePending, patchSnapshotSummary, patchSnapshotDiffSummary } from '../provenance/snapshots'
import { summariseParagraph, summariseBullets, summariseDiff } from '../provenance/summarise'
import { ReceiptPanel } from '../components/ReceiptPanel'
import { EmailComposePanel } from '../components/EmailComposePanel'
import type { ApplicationSurfaceMode } from '../components/ApplicationSurface'
import { readApplicationSurfaceMode, writeApplicationSurfaceMode } from '../components/applicationSurfaceMode'
import { emailEnabled } from '../email/flag'
import { titleForDocument } from './docTitle'
import { SessionRunner } from '../provenance/session'
import { CadenceTap } from '../provenance/cadence'
import { cadenceTierActive, getClerkToken } from '../auth/entitlement'
import { prodLedgerEnabled } from '../productivity/ledgerFlag'
import { getCapture } from '../productivity/capture'
import { buildExportBundleWithPdfs, bundleFilename, downloadBundle, downloadBundleGz, pmToText } from '../provenance/bundle'
import { fileSaveAvailable, pickSaveFile, getSaveFileHandle, getSaveFileName, writeBundleToFile, readLocalHeartbeat, preMergeSaveFile } from '../storage/folder'
import { oneDriveConfigured, oneDriveAccount, syncToOneDrive, startOneDriveSignIn, oneDriveSyncPending, clearOneDriveSyncPending, oneDrivePath, setChosenFolder, addRecentFolder, renameOneDriveFile, oneDriveFilename, downloadOneDriveFile, getOneDriveItemTag, readRemoteHeartbeat, getRemoteFileInfo, preMergeRemote, fetchMissingSidecars, type OneDriveFolder } from '../storage/onedrive'
import { googleDriveConfigured, startGoogleDriveSignIn, syncToGoogleDrive, clearGoogleDriveFile, setChosenGDriveFolder, gDriveFilename, renameGoogleDriveFile, downloadGoogleDriveFileBlob, getGDriveFileTag, googleDriveFileId, addRecentGDriveFolder, getGDriveFileInfo, preMergeGDrive } from '../storage/gdrive'
import { isOtherDeviceActive } from '../sync/presence'
import { SyncStatus } from '../components/SyncStatus'
import { UnsyncedNotice } from '../components/UnsyncedNotice'
import { shouldWarnUnsynced, unsyncedReducer, initialUnsyncedState } from './unsyncedWatch'
import { VerifyModal } from '../components/VerifyModal'
// ⚠ LAZY, AND IT MUST STAY LAZY. A static import puts the whole report lane in THIS chunk, which
// every writer loads, flag or no flag: a render guard and a runtime guard are both invisible to
// the bundler. VERIFY IN `react-router build` OUTPUT, never in the source — a separate chunk file
// is NOT evidence of laziness. → docs/archive/editor-surface.md#editor-lazy-chunks
const ProductivityReportModal = lazy(() =>
  import('../components/ProductivityReportModal').then(m => ({ default: m.ProductivityReportModal })),
)
// The measured writing-charts panel (P1a-viz), lazy for the same reason and kept honest by
// `scripts/prodLoadPath.prove.mjs`. Its trigger in the clock drop-up is eager, but that button only
// calls a callback, so no chart code reaches this chunk.
const ProductivityGraphsPanel = lazy(() =>
  import('../components/ProductivityGraphsPanel').then(m => ({ default: m.ProductivityGraphsPanel })),
)
import { prodGraphsEnabled, prodReportDemo, prodReportEnabled } from '../productivity/flag'
import { SettingsMenu } from '../components/SettingsMenu'
import { MediaMenu } from '../components/MediaMenu'
import { ClockSlotButton, LedgerDropUp } from '../components/ClockMenu'
import { CountdownOverlay } from '../components/CountdownOverlay'
import { MusicBar } from '../components/MusicBar'
import { musicEnabled } from '../music/flag'
import { ReflectionAutoOpen } from '../components/ReflectionAutoOpen'
import { WorkSummaryAutoOpen } from '../components/WorkSummaryAutoOpen'
import { PageMenu } from '../components/PageMenu'
import { gappedPagesEnabled } from './pageView'
import { setPaginationGappedMode } from './extensions/PaginationExtension'
import { getLineHeight } from './lineHeight'
import { notePerf, perflogEnabled } from './perflog'
import { CiteAutocomplete } from '../components/CiteAutocomplete'
import { CitationPanel } from '../components/CitationPanel'
import { PdfSidePanel } from '../components/PdfSidePanel'
import { Toast } from '../components/Toast'
import { loadLibrary, persistLibrary } from '../citations/library'
import { bibProvider } from '../citations/bibProvider'
import { startExtensionChannel } from '../citations/extensionChannel'
import { setCitationStyle as setCitationStyleBus } from '../citations/citationsBus'
import { embedBibliography } from '../citations/resolve'
import { OneDriveFolderPicker } from '../components/OneDriveFolderPicker'
import { GoogleDriveFolderPicker } from '../components/GoogleDriveFolderPicker'
import { InstallPromptBanner } from '../components/InstallPromptBanner'
import { OneDriveFileOpener } from '../components/OneDriveFileOpener'
import { GoogleDriveFileOpener } from '../components/GoogleDriveFileOpener'
import { setDocSource, getDocSource } from '../storage/docSource'
import { openInkwaveFile } from '../storage/openDoc'
import { getCachedOpen, putCachedOpen, warmCloudOpen, type OpenCacheProvider } from '../storage/openCache'
import { openPerfStart, openPerfStep, openPerfAbort } from '../storage/openPerf'
import { reportOpenError, takeOpenError } from '../storage/openError'
import { contentHash } from '../provenance/hash'
import { verifyChain, signingPublicKeys } from '../provenance/receipts'
import type { Snapshot, SnapshotMeta, SignedReceipt, WordNudgeEvent } from '../types/document'

// No wall-clock resample timer — S_v rotation and receipt signing happen on word nudge only.
// This keeps the green/red word set stable between nudges and avoids spurious receipts.

// ─── Toolbar slot customisation ───
// ⚠ The population, the row size, the migration and the bar-layer exclusion live ONLY in
// `editor/toolbarContract.ts` and are never re-declared here. Register a button by adding a member
// to `SlotId` + `ALL_SLOTS` there and the row, the ▲ overflow, drag-to-swap and migration follow.

/**
 * ⚠ Visual px reserved on EACH SIDE of the centred footer toolbar for the edge-anchored pills that
 * share its band. All three are independently `position: fixed` with no awareness of each other,
 * so without this the centred toolbar grows into the sync pill below ~650px of viewport width. It
 * must stay ONE number shared with the per-circle shrink clamp in index.css.
 * → docs/archive/editor-surface.md#editor-side-reserve
 */
const TOOLBAR_SIDE_RESERVE_PX = 140

interface TiptapEditorProps {
  doc: InkwaveDocument
  onDocChange: (updated: InkwaveDocument) => void
}

export function TiptapEditor({ doc, onDocChange }: TiptapEditorProps) {
  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  // ── ⚠ ONE COMMIT PATH FOR A DOCUMENT MUTATION (R2) ────────────────────────────────────────────
  // Every mutation does the same three things in the same order: docRef, onDocChange, scheduleSave.
  // Written longhand at ten call sites, omitting the third is SILENT — the edit appears on screen
  // and only the DISK is stale, so the work is lost at the next reload rather than at the mistake.
  // NB `ensureDocFresh` deliberately does NOT use this: it CACHES a lazily-built document and is not
  // a mutation. → docs/archive/editor-surface.md#editor-commit-doc
  const commitDoc = (updated: InkwaveDocument) => {
    docRef.current = updated
    onDocChange(updated)
    scheduleSave(updated)
  }


  // ── WHERE YOU WERE, ACROSS A HARD REFRESH ─────────────────────────────────────────────────────
  // ⚠ Restore only once the document has its REAL height — after the reveal and the first
  // pagination — because a paginated document is dramatically shorter until the gap widgets land
  // and restoring against that shorter range clamps the offset to nothing. The rule itself is pure
  // (editor/scrollMemory.ts). → docs/archive/editor-surface.md#editor-scroll-memory
  useEffect(() => {
    const el = document.querySelector('.inkwave-editor-surface.iw-fill:not(.is-phone)') as HTMLElement | null
    if (!el) return
    const id = docRef.current?.id
    if (!id) return
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => writeScrollMemory(id, el.scrollTop, el.scrollHeight), 400)
    }
    const mem = readScrollMemory(id)
    let restored = false
    const tryRestore = () => {
      if (restored) return
      const range = Math.max(0, el.scrollHeight - el.clientHeight)
      const want = restoreOffset(mem, el.scrollHeight, range)
      if (want == null) { restored = true; el.addEventListener('scroll', onScroll, { passive: true }); return }
      el.scrollTop = want
      // Only call it restored once it actually took — the height keeps growing while pages measure.
      if (Math.abs(el.scrollTop - want) <= 2) {
        restored = true
        el.addEventListener('scroll', onScroll, { passive: true })
      }
    }
    // Try across the settling window rather than once: fonts, pagination and the reveal each change
    // the height, so a single attempt lands before the document is its real size.
    const timers = [900, 1600, 2600, 4000].map((t) => setTimeout(tryRestore, t))
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(saveTimer)
      el.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  // Mirror the saved cross-out mode onto the document root so the memory cross-out CSS applies.
  useEffect(() => { applyCrossoutMode() }, [])

  // Realise the persisted review-visibility state (global show/hide + hidden layers) on boot —
  // a hidden layer must stay hidden across reloads even before the review bar is ever opened.
  // Also drop any legacy PERSISTED suggest flag: track-changes mode is session-only now (see
  // review/reviewState.ts for why), and a writer already stuck in it must not carry it over.
  useEffect(() => { syncReviewVisibilityStyles(); clearLegacySuggestFlag() }, [])

  // The SCAS engine controller (live state mirrored to doc.scasState for persistence). Created
  // lazily so it survives re-renders; reseated when the active document changes (see effect below).
  const scasRef = useRef<ScasController>()
  if (!scasRef.current) {
    scasRef.current = new ScasController(
      normalizeScasState(doc.scasState),
      doc.scasSeedRef ?? doc.scasSessionSeed,
      doc.id,
      doc.scasSetSize ?? DEFAULT_SET_SIZE,
    )
  }
  // Document content size last seen by onTransaction — a drop means content was deleted, which
  // gates the ban-credit lock detection (so a not-yet-committed word isn't mistaken for a delete).
  const prevDocSizeRef = useRef(-1)

  // Paragraph snapshot tracking: count of top-level paragraphs seen last transaction; buffer of
  // short-para (<70 word) texts waiting to group into a single snapshot.
  const prevParaCountRef = useRef(0)
  const shortParaBufferRef = useRef<string[]>([])

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

  // Live-composition signing session (M3). The runner holds the server-issued S_v + the receipt
  // chain; null while opening or when the service is unreachable (then the controller falls back to
  // locally-derived S_v — composition degrades visibly rather than blocking writing).
  const sessionRef = useRef<SessionRunner | null>(null)
  const priorReceiptsRef = useRef<SignedReceipt[]>([]) // receipts from previous sessions; preserved across session resets
  const periodKicksRef = useRef<WordNudgeEvent[]>([]) // word nudges resolved during the current signing period
  // Insignia (paid) keystroke-cadence tap — accumulates per-0.5s insert/delete COUNTS (never chars).
  // Created lazily only for active subscribers; stays null (inert) for the free tier.
  const cadenceTapRef = useRef<CadenceTap | null>(null)
  const [receipts, setReceipts] = useState<SignedReceipt[]>([])
  const [chainStatus, setChainStatus] = useState<string | null>(null)
  // Writer-held folder mirror (M4, Chromium only). Tracked in a ref read by the (non-React)
  // snapshot/period callbacks (saving/sync UI lives in the ⋮ menu, not the snapshots panel).
  const folderActiveRef = useRef(false)
  // OneDrive sync (Microsoft Graph) — cross-browser cloud storage for non-Chromium writers.
  const [oneDriveAcct, setOneDriveAcct] = useState<string | null>(null)
  const oneDriveActiveRef = useRef(false)
  // OneDrive write throttle: rapid PUTs to the same file race the OneDrive DESKTOP client (which
  // then makes "<name>-MACHINE.json" conflict copies). Local folder writes are instant; OneDrive is
  // throttled to one write per interval with a trailing flush.
  const oneDriveLastWriteRef = useRef(0)
  const oneDriveTrailingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastSync, setLastSync] = useState<number | null>(null) // ms epoch of last successful OneDrive sync
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [gdrivePickerOpen, setGdrivePickerOpen] = useState(false)
  const [odOpenerOpen, setOdOpenerOpen] = useState(false)
  const [gdriveOpenerOpen, setGdriveOpenerOpen] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null) // linked local save file name (Chromium)

  // Keep the browser tab title in sync with the file name (not the content-derived title).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const local = fileName?.replace(/\.(inkwave|studio|json)$/i, '')
    const cloud = oneDriveFilename(doc.id)?.replace(/\.(inkwave|studio|json)$/i, '')
    const tabName = local || cloud || (doc.title ? doc.title.slice(0, 40) : 'Untitled')
    document.title = `Inkwave Zero: ${tabName}`
  }, [doc.title, doc.id, fileName])

  // NO dynamic favicon swap (2026-07-10). This used to flip the first link[rel~=icon] to an inline
  // "document-style" SVG glyph once the editor mounted — but the editor IS the landing page, so
  // EVERY load showed the wave logo for ~1s and then a tiny grey-purple page glyph that reads
  // exactly like Firefox's default page icon. That was the long-hunted "favicon reverting in
  // Firefox" (proven in a headed FF run: tab shows the seal at 2.5s, the doc glyph from ~5s on) —
  // the head links were never the culprit. Tabs stay distinguishable via document.title above.
  // Don't reintroduce an icon swap; if per-doc icons ever return, they must NOT run on '/' load.

  const [lastFileSave, setLastFileSave] = useState<number | null>(null)
  const [oneDriveUrl, setOneDriveUrl] = useState<string | null>(null) // synced file's webUrl (open in folder)
  // Google Drive sync (Firefox/Safari alternative to OneDrive).
  const gdriveActiveRef = useRef(false)
  const [gdriveActive, setGdriveActive] = useState(false)
  const [lastGdriveSync, setLastGdriveSync] = useState<number | null>(null)
  const [gdriveUrl, setGdriveUrl] = useState<string | null>(null)
  const zoom = useZoomScale() // counter page zoom so the toolbar stays a constant size (CSS `zoom`)
  const [otherDevice, setOtherDevice] = useState(false) // another device looks active on this doc
  const [conflictDismissed, setConflictDismissed] = useState(false)
  const [wordCount, setWordCount] = useState(0) // live document word count (shown in the record panel)
  // ONE-PAINT REVEAL: hold the text invisible (visibility, so layout/measure still run) until fonts
  // are ready and (gapped mode) the first pagination measure has landed — then fade it in ONCE.
  // Kills the staged "text → font swap → gaps arrive" shakiness on load and on open-document; the
  // parchment + background paint instantly from the prerendered shell either way. Hard 1.2s cap so
  // a slow font can never hold the writing hostage.
  const [settled, setSettled] = useState(false)
  // PHONE (2026-07-10): the editor's water stays covered until the waves REST — not until the
  // reveal. Uncovering mid-coast made iOS composite/rasterize the just-shown copy late = the
  // freeze-frame + gradient shift Peter saw. At rest the phone editor has no waves at all
  // (parchment), so the uncover is inert; the flag exists to hold `covered` through the coast.
  const [waveRest, setWaveRest] = useState(false)
  // wave-rest ALWAYS arrives on a live page (the rest handoff is a resolved-clock timer over
  // compositor-only playback); the 30s load watchdog (Scroll.tsx, 'inkwave:load-watchdog') is
  // the one backstop — it force-lifts `covered` too.
  useEffect(() => {
    if (!isTouchDevice()) return
    const onRest = () => setWaveRest(true)
    window.addEventListener('inkwave:wave-rest', onRest)
    window.addEventListener('inkwave:load-watchdog', onRest)
    return () => {
      window.removeEventListener('inkwave:wave-rest', onRest)
      window.removeEventListener('inkwave:load-watchdog', onRest)
    }
  }, [])
  // PHONE REVEAL CHROME (Peter, 2026-07-09): the floating chrome (toolbar/pills — z-indexed ABOVE
  // the z:auto loading shell) is held invisible while the shell covers, then fades IN over 0.5s at
  // reveal, over the editor's own still-coasting waves (see .iw-chrome-hold/.iw-chrome-in in
  // index.css). 'hold' → 'in' swap in the SAME commit settled flips (no bare frame between), and
  // 'in' is one-shot — removed after the animation so later-mounted panels never replay the fade.
  // Desktop keeps the shell cross-fade; no hold there (the chrome lands under the fading shell).
  const [chromeDone, setChromeDone] = useState(false)
  useEffect(() => {
    if (!settled) return
    const t = setTimeout(() => setChromeDone(true), 650)
    return () => clearTimeout(t)
  }, [settled])
  // Console-snappy typing (see onTransaction): keystrokes do no O(doc) work. These carry the
  // deferred-tick + lazy-doc-build machinery.
  const docStaleRef = useRef(false)           // docRef.contentJson lags the editor until ensureDocFresh
  const scasTickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // ENGINE kill-switch (diagnostic/benchmark), DISTINCT from the user's display toggle. `inkwave:
  // scasOff` (Settings "SCAS suggestions") only hides the red words — the engine keeps running so the
  // flagged words are STILL REMEMBERED (Peter's intent). Disabling the whole tick is a separate
  // opt-out, `inkwave:scasEngineOff`, so "hide the highlights" can never stop the provenance memory.
  const scasEngineOffRef = useRef(false)
  useEffect(() => { try { scasEngineOffRef.current = localStorage.getItem('inkwave:scasEngineOff') === '1' } catch { /* private */ } }, [])
  const scasHadDeletionRef = useRef(false)    // deletions accumulate across the tick debounce window
  // Phone windowed SCAS tick: the debounce window's accumulated edit range (current-doc coords,
  // remapped through each transaction) + the caret position at the LAST tick (a word commits when
  // the caret leaves it, so the previous caret's paragraph must be rescanned too).
  const scasWinRef = useRef<{ from: number; to: number } | null>(null)
  const scasLastCaretRef = useRef(1)
  const lastNotifiedTitleRef = useRef('')     // shell re-renders only when the title actually changes
  // QUIET SCHEDULER: heavy background work (archive pre-merge, receipt verification) runs only after
  // the writer has been genuinely idle for a stretch. requestIdleCallback alone still fires
  // mid-interaction (its timeout forces it), and a 20MB JSON.parse can't be interrupted — that was
  // the "scroll just stops for a while" right after load. Nothing is dropped: attempts re-arm until
  // a quiet window arrives, so everything still loads eventually.
  const lastActivityRef = useRef(Date.now())
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now() }
    const evs = ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll'] as const
    evs.forEach((ev) => window.addEventListener(ev, bump, { passive: true, capture: true }))
    return () => evs.forEach((ev) => window.removeEventListener(ev, bump, { capture: true } as EventListenerOptions))
  }, [])
  function runWhenQuiet(fn: () => void, quietMs = 4000) {
    const attempt = () => {
      if (Date.now() - lastActivityRef.current >= quietMs) fn()
      else setTimeout(attempt, quietMs)
    }
    setTimeout(attempt, quietMs)
  }
  const [needsReconnect, setNeedsReconnect] = useState(false) // linked file exists but write permission lapsed

  // ── UNSYNCED-WORK NOTICE (Peter, 2026-07-17: "a warning that comes up if working for more than
  //    5 minutes without syncing activated"). The rule is pure + unit-pinned in editor/
  //    unsyncedWatch.ts; this is just its wiring. Every input is STATE WE ALREADY HOLD — read, not
  //    awaited — so the answer is correct from cold and there is no one-shot event to miss.
  const syncActive = (!!fileName && !needsReconnect) || !!oneDriveAcct || gdriveActive
  // The editor's onUpdate closure is long-lived; read sync state through a ref so the first
  // unsynced edit is judged against the CURRENT destination, not whatever was live at mount.
  const sawUserInputRef = useRef(false) // the writer has typed/pasted into THIS editor instance
  const syncActiveRef = useRef(syncActive)
  useEffect(() => { syncActiveRef.current = syncActive }, [syncActive])
  const [unsynced, dispatchUnsynced] = useReducer(unsyncedReducer, initialUnsyncedState)
  const [unsyncedNow, setUnsyncedNow] = useState(() => Date.now())
  useEffect(() => { if (syncActive) dispatchUnsynced({ type: 'sync-active' }) }, [syncActive])
  useEffect(() => { dispatchUnsynced({ type: 'doc-switch' }) }, [doc.id])
  // A slow tick, and ONLY while a warning is actually pending — the reducer returns its input
  // unchanged on a no-op edit, so typing never re-renders the shell (the console-snappy rule).
  // PROBE SEAM (the `__iwRasterDprCap` pattern): shorten the threshold so the wiring can be DRIVEN
  // in a live browser rather than waited out for five real minutes (R3).
  // → docs/archive/editor-surface.md#editor-unsynced-notice
  const warnAfterMs = (window as unknown as { __iwUnsyncedWarnMs?: number }).__iwUnsyncedWarnMs
  useEffect(() => {
    if (syncActive || unsynced.dismissed || unsynced.firstUnsyncedEditAt === null) return
    const t = setInterval(() => setUnsyncedNow(Date.now()), Math.min(20_000, (warnAfterMs ?? 20_000) / 3))
    return () => clearInterval(t)
  }, [syncActive, unsynced.dismissed, unsynced.firstUnsyncedEditAt, warnAfterMs])
  const warnUnsynced = shouldWarnUnsynced({
    syncActive,
    firstUnsyncedEditAt: unsynced.firstUnsyncedEditAt,
    dismissed: unsynced.dismissed,
    now: unsyncedNow,
    warnAfterMs,
  })

  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0)
  const [paperRight, setPaperRight] = useState(0)
  // Mobile toolbar: controlled open state for the ◈ and ☁ triggers embedded in the toolbar.
  const [receiptOpen, setReceiptOpen] = useState(false)
  // THE SECOND TOOLBAR LAYER — ONE variable, holding ONE id (see toolbarContract.ts). Peter's word
  // is "mutually exclusive": R and the music bar cannot both own the bar. This was two booleans =
  // four states, one of them illegal ("both open") and prevented only by the discipline of a
  // hand-written function; a third layer would have made that four illegal states out of eight.
  // Now two-at-once is not prevented — it is unrepresentable. A lane owns the bar by adding a
  // member to BarLayerId and rendering on `activeBar === 'x'`.
  const [activeBar, setActiveBar] = useState<BarLayerId | null>(null)
  const reviewOpen = activeBar === 'review'   // review layer: sticky-note comments + track changes
  const [syncOpen, setSyncOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  // The free paste-back work report (§A7.1, Path 1) — now DEFAULT ON (`?prodReport=off` to disable).
  const [reportOpen, setReportOpen] = useState(false)
  const reportFlag = prodReportEnabled()
  // Dynamic: demo.ts statically pulls fixtures.ts (2.8KB gzip of synthetic prose that ONLY
  // `?prodReport=demo` ever reads). Gated on DEMO MODE, not on `reportFlag` — with the report now
  // on by default, gating on the flag would fetch the demo/fixtures chunk for EVERY writer even
  // though installProdReportDemo() no-ops unless demo mode. Demo implies the flag, so this loses
  // nothing.
  const reportDemo = prodReportDemo()
  useEffect(() => {
    if (!reportDemo) return
    void import('../productivity/demo').then(m => m.installProdReportDemo())
  }, [reportDemo])
  const [lineHeight, setLineHeight_] = useState(getLineHeight)
  // PageMenu sets line height; listen for the settings-changed event to sync the CSS var.
  useEffect(() => {
    const upd = () => setLineHeight_(getLineHeight())
    window.addEventListener('inkwave:page-settings-changed', upd)
    return () => window.removeEventListener('inkwave:page-settings-changed', upd)
  }, [])
  // On a phone the toolbar hides while the keyboard is up to free the screen for writing,
  // and returns when the keyboard is dismissed. We detect the keyboard via the visual
  // viewport (its visible height shrinks when the keyboard shows) — far more reliable than
  // editor focus, whose blur doesn't fire on iOS when the keyboard is dismissed (which left
  // the toolbar stuck hidden) and whose churn on a control tap made the bar "run away".
  const [keyboardUp, setKeyboardUp] = useState(false)
  // PWA install prompt — captured here so both OptionsMenu and InstallPromptBanner can use it.
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [fileOpenError, setFileOpenError] = useState<import('../storage/openError').OpenNotice | null>(null)
  // Open failures happen while the initiating editor is UNMOUNTED (open-begin hides the doc), so
  // the message parks in storage/openError and the instance that mounts after the restore shows it.
  useEffect(() => {
    const show = () => { const m = takeOpenError(); if (m) setFileOpenError(m) }
    show()
    window.addEventListener('inkwave:open-error', show)
    return () => window.removeEventListener('inkwave:open-error', show)
  }, [])
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // ── Citation / bibliography state ─────────────────────────────────────────
  const [bibPanelOpen, setBibPanelOpen] = useState(false)
  const bibBtnRef = useRef<HTMLButtonElement>(null)
  const [citationStyle, setCitationStyle] = useState(doc.citationStyle ?? 'apa')
  const [shareCapture, setShareCapture] = useState<string | null>(null)

  // Hydrate the native citation library (OPFS) and seed the render bus with the doc's style.
  // THEN fill any citekeys the device library lacks from the doc's own embedded bibliography —
  // the documented offline-resolution source (resolve.ts). A phone whose library file never
  // persisted (the iOS dead-worker OPFS history / Safari eviction) otherwise boots with an EMPTY
  // bibProvider and every in-text citation renders as an unresolved red "?key" with no tappable
  // hook (Peter's 2026-07-11 phone report). Library entries win (fresher verify metadata); the
  // heal is persisted so the next boot resolves from the library file directly.
  useEffect(() => {
    void loadLibrary().catch(() => {}).then(() => {
      const embedded = docRef.current.bibliography?.entries ?? []
      const missing = embedded.filter((it) => !bibProvider.get(it.id))
      for (const it of missing) bibProvider.upsert(it, 'library')
      if (missing.length) void persistLibrary().catch(() => {}) // best-effort — resolution already works in-memory
    })
    setCitationStyleBus(doc.citationStyle ?? 'apa')
  }, [doc.citationStyle]) // eslint-disable-line react-hooks/exhaustive-deps -- docRef is the stable mirror

  // Listen for citations handed over by the Inkwave browser extension (Phase 2 bridge).
  useEffect(() => startExtensionChannel(), [])

  // PWA Web Share Target: an app shared "→ Inkwave" arrives as /?url=…&text=…&title=…. Open the
  // citation panel pre-loaded with the shared URL so the user can capture it as a source, then strip
  // the params so a reload doesn't re-trigger. The universal (mobile-Chrome-safe) capture route.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const shared = p.get('url') || p.get('text') || ''
    if (/^https?:\/\//i.test(shared)) {
      setShareCapture(shared)
      setBibPanelOpen(true)
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState(null, '', clean)
    }
  }, [])

  // Toolbar customisation slots
  // THE LAYOUT FOLLOWS THE DOCUMENT (Peter, 2026-07-17). The chain — doc config → this writer's own
  // last layout → the first-run six — is `resolveToolbarRow`; it is not re-decided here.
  const toolbarRead = readToolbarConfig(docRef.current.toolbar)
  const [toolbarSlots, setToolbarSlots] = useState<SlotId[]>(
    () => resolveToolbarRow(toolbarRead, readStoredRow()),
  )
  const [toolbarPickerOpen, setToolbarPickerOpen] = useState(false)
  // A SLOT IS A TRIGGER, NEVER AN OWNER (toolbarContract.ts). The ledger drop-up's open state lives
  // HERE, not in the clock button: the row is SIX (Peter), so `clock` competes and sits in the ▲
  // overflow by default — its button is frequently unmounted. The slot and the countdown are two
  // access paths to ONE setter.
  const [ledgerOpen, setLedgerOpen] = useState(false)
  // Stable opener — the countdown, the clock slot AND the end-of-session reflection watcher all set
  // ONE state (a slot is a trigger, never an owner). Stable so ReflectionAutoOpen's listener never
  // re-subscribes per render.
  const openLedger = useCallback(() => setLedgerOpen(true), [])
  // The measured-charts panel (P1a-viz), opened FROM the clock drop-up. Its own lifted state — a
  // second surface, one owner — following the ReceiptPanel precedent Peter named.
  const [graphsOpen, setGraphsOpen] = useState(false)
  const [, setLedgerGoalsTick] = useState(0) // re-render the drop-up after a goals write
  const [oppsOpen, setOppsOpen] = useState(false)
  const toolbarPickerRef = useRef<HTMLDivElement>(null)

  function updateSlots(newSlots: SlotId[]) {
    setToolbarSlots(newSlots)
    // TWO writes, two meanings. The document keeps this layout (open the score again, get the
    // score's tools); the writer's own storage becomes the default their NEXT new document
    // inherits, so curating once is not a chore they repeat per file.
    saveStoredRow(newSlots)
    // ...but NEVER write back over a config we merely failed to parse. That read-failure-causes-
    // write shape is 15 July in miniature — the day a null-for-broken read minted a blank document
    // over real thesis annotations. A broken toolbar loses less, but the shape is the bug.
    if (!mayPersistConfig(toolbarRead)) return
    const updated = {
      ...docRef.current,
      // mergeRowIntoConfig, not the raw row: `newSlots` can only name buttons THIS build draws, so
      // writing it verbatim would delete a flagged-off slot from the author's document on the first
      // drag — the loss carryToolbarConfig refuses at both ends, walking in through the middle.
      toolbar: mergeRowIntoConfig(docRef.current.toolbar, newSlots),
      updatedAt: new Date().toISOString(),
    }
    commitDoc(updated)
  }

  const toolbarSlotsRef = useRef<SlotId[]>(toolbarSlots)
  useEffect(() => { toolbarSlotsRef.current = toolbarSlots }, [toolbarSlots])

  const dragIdRef = useRef<SlotId | null>(null)

  // ─── Phone: touch-hold drag-to-reorder for the row's slot circles ──────────
  // HTML5 drag events never fire from touch here (the iOS long-press guards swallow the native
  // gestures), so this is hand-rolled: hold ~400ms → arm → drag → FLIP-slide preview → commit.
  // It coexists with the guards, and each slot wrapper needs its OWN `touch-action: none`.
  // → docs/archive/editor-surface.md#editor-slot-drag
  const HOLD_MS = 400
  const slotElsRef = useRef<(HTMLDivElement | null)[]>([])

  // ─── Hotkeys: Alt+1…6 = the row, Alt+0 = the ▲ drawer, Mod+, = Settings ────
  // ⚠ THE HOTKEY IS THE TAP: it dispatches the slot's OWN button click, never a registered action.
  // Every slot owns its open state privately, so an action registry would be a SECOND way to
  // trigger each one — two roads that drift the first time a slot changes what its tap does (R2).
  // `altHeld` flips only on Alt's own down/up, and the ref guard stops key-repeat setting state
  // 30×/second. → docs/archive/editor-surface.md#editor-hotkey-tap
  const [altHeld, setAltHeld] = useState(false)
  const altHeldRef = useRef(false)
  const altArmRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isTouchDevice()) return   // no Alt on a phone; render no hints and bind nothing
    const setAlt = (v: boolean) => {
      if (altHeldRef.current === v) return
      altHeldRef.current = v
      setAltHeld(v)
    }
    // ⚠ THE HINTS MUST NOT REACT TO A SHORTCUT IN PROGRESS. Alt is a MODIFIER before it is a hint
    // trigger (⌥⌫ is delete-word-left), so showing badges on its keydown re-rendered this whole
    // tree BETWEEN the modifier and the key it modifies. The hint waits for a DELIBERATE hold, and
    // any other key cancels it — which is exactly what a chord is. Alt+digit still works instantly
    // either way, because the hotkey handler never consults `altHeld`.
    // → docs/archive/editor-surface.md#editor-alt-hints
    const ALT_HINT_DELAY_MS = 400
    const cancelArm = () => { if (altArmRef.current) { clearTimeout(altArmRef.current); altArmRef.current = null } }
    const armHint = () => {
      if (altHeldRef.current || altArmRef.current) return   // already shown, or already waiting
      altArmRef.current = setTimeout(() => { altArmRef.current = null; setAlt(true) }, ALT_HINT_DELAY_MS)
    }
    const dropHint = () => { cancelArm(); setAlt(false) }
    const clickSlot = (el: HTMLElement | null | undefined) => {
      const btn = el?.querySelector('button')
      if (btn) { btn.click(); return true }
      return false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Alt PRESSED BY ITSELF starts the hold timer; Alt as part of a chord cancels it outright.
      if (e.key === 'Alt') armHint()
      else if (altArmRef.current || altHeldRef.current) dropHint()
      // ⌘,/Ctrl, — the idiomatic preferences key on macOS, and unbound in browsers elsewhere.
      if ((e.metaKey || e.ctrlKey) && e.key === ',' && !e.altKey) {
        const idx = toolbarSlotsRef.current.indexOf('settings')
        // Settings may live in the ▲ drawer; its button is still in the DOM there, so the
        // shortcut works from either home. That is the point of one population.
        const el = idx >= 0 ? slotElsRef.current[idx] : document.querySelector<HTMLElement>('.iw-slot [title="Settings"]')?.parentElement
        if (clickSlot(el ?? undefined)) e.preventDefault()
        return
      }
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      if (e.key === '0') {
        const btn = toolbarPickerRef.current?.querySelector('button')
        if (btn) { e.preventDefault(); btn.click() }
        return
      }
      const idx = slotIndexForDigit(e.key)
      if (idx === null) return
      if (clickSlot(slotElsRef.current[idx])) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => { if (!e.altKey) dropHint() }
    // Alt+Tab away with Alt down and the keyup never arrives — the hints would latch on forever.
    const onBlur = () => dropHint()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      cancelArm() // a pending hold timer must not fire into an unmounted tree
    }
  }, [])
  const slotDragRef = useRef<{
    fromIdx: number
    startX: number
    startY: number
    centers: number[]
    step: number
    armed: boolean
    dropping: boolean
    moved: boolean
    timer: number
    overIdx: number
  } | null>(null)
  // Render-side mirror: neighbours read their preview shift from this (null = no drag).
  const [slotDragView, setSlotDragView] = useState<{ fromIdx: number; overIdx: number; step: number } | null>(null)
  const suppressSlotClickUntilRef = useRef(0)

  const slotDragStyle = (el: HTMLDivElement | null, t: string, transition: string) => {
    if (!el) return
    el.style.transition = transition
    el.style.transform = t
  }
  const armSlotDrag = () => {
    const st = slotDragRef.current
    if (!st) return
    const els = slotElsRef.current
    const rects = toolbarSlots.map((_, j) => els[j]?.getBoundingClientRect())
    if (rects.some(r => !r)) { slotDragRef.current = null; return }
    st.centers = rects.map(r => r!.left + r!.width / 2)
    st.step = st.centers.length > 1 ? st.centers[1] - st.centers[0] : 0
    st.armed = true
    const el = els[st.fromIdx]
    if (el) {
      el.style.zIndex = '30'
      el.style.position = 'relative'
      slotDragStyle(el, 'scale(1.18)', 'transform 120ms ease') // the arm pulse
    }
    setSlotDragView({ fromIdx: st.fromIdx, overIdx: st.fromIdx, step: st.step })
  }
  const endSlotDrag = (commit: boolean) => {
    const st = slotDragRef.current
    if (!st) return
    clearTimeout(st.timer)
    if (!st.armed || st.dropping) { if (!st.armed) slotDragRef.current = null; return }
    st.dropping = true
    suppressSlotClickUntilRef.current = Date.now() + 400
    const el = slotElsRef.current[st.fromIdx]
    const { fromIdx, overIdx, centers } = st
    const finish = () => {
      if (slotDragRef.current !== st) return
      slotDragRef.current = null
      // Clear the imperative styles IN THE SAME COMMIT as the reorder: the element lands at
      // its new layout slot exactly where the drop animation left it — no flash.
      if (el) { el.style.transform = ''; el.style.transition = ''; el.style.zIndex = ''; el.style.position = '' }
      setSlotDragView(null)
      if (commit && overIdx !== fromIdx) {
        updateSlots(moveSlot(toolbarSlots, fromIdx, overIdx))
      }
    }
    if (el && commit) {
      // Drop animation: glide from the finger to the target slot's centre, then commit.
      slotDragStyle(el, `translateX(${centers[overIdx] - centers[fromIdx]}px) scale(1)`, 'transform 150ms ease')
      window.setTimeout(finish, 160)
    } else {
      if (el) slotDragStyle(el, '', 'transform 150ms ease')
      window.setTimeout(finish, 160)
    }
  }
  const slotTouchHandlers = (slotIdx: number) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1 || slotDragRef.current) return
      const t = e.touches[0]
      slotDragRef.current = {
        fromIdx: slotIdx,
        startX: t.clientX,
        startY: t.clientY,
        centers: [],
        step: 0,
        armed: false,
        dropping: false,
        moved: false,
        timer: window.setTimeout(armSlotDrag, HOLD_MS),
        overIdx: slotIdx,
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      const st = slotDragRef.current
      if (!st || st.dropping) return
      const t = e.touches[0]
      const dx = t.clientX - st.startX
      const dy = t.clientY - st.startY
      if (!st.armed) {
        // A real drag begins with stillness — movement before the hold elapses is a tap/slide.
        // Same rule as the drop-up drag below; see `brokeHoldSlop`.
        if (brokeHoldSlop(dx, dy)) { clearTimeout(st.timer); slotDragRef.current = null }
        return
      }
      st.moved = true
      const el = slotElsRef.current[st.fromIdx]
      // Follow the finger raw (no transition while tracking — the pulse transition ends itself).
      slotDragStyle(el, `translateX(${dx}px) scale(1.18)`, st.moved ? 'none' : 'transform 120ms ease')
      const over = nearestSlot(st.centers, st.centers[st.fromIdx] + dx)
      if (over !== st.overIdx) {
        st.overIdx = over
        setSlotDragView({ fromIdx: st.fromIdx, overIdx: over, step: st.step })
      }
    },
    onTouchEnd: () => endSlotDrag(true),
    onTouchCancel: () => endSlotDrag(false),
  })

  // ─── Phone: touch-hold drag FROM the ▲ drop-up ONTO a row slot ─────────────
  // The overflow entries are the same population as the row circles — hold one (same 400ms
  // arm + pulse), drag it down over the row, the hovered slot shrinks/dims (it will be
  // displaced back into the ▲ pool), release to swap. 2D follow (popup sits above the row).
  const popupDragRef = useRef<{
    id: SlotId
    el: HTMLElement
    startX: number
    startY: number
    slotRects: DOMRect[]
    armed: boolean
    dropping: boolean
    timer: number
    targetIdx: number | null
  } | null>(null)
  const [popupDragTarget, setPopupDragTarget] = useState<number | null>(null)
  const armPopupDrag = () => {
    const st = popupDragRef.current
    if (!st) return
    const rects = toolbarSlots.map((_, j) => slotElsRef.current[j]?.getBoundingClientRect())
    if (rects.some(r => !r)) { popupDragRef.current = null; return }
    st.slotRects = rects as DOMRect[]
    st.armed = true
    st.el.style.zIndex = '40'
    st.el.style.position = 'relative'
    slotDragStyle(st.el as HTMLDivElement, 'scale(1.18)', 'transform 120ms ease')
    setPopupDragActive(true)
  }
  const endPopupDrag = (commit: boolean) => {
    const st = popupDragRef.current
    if (!st) return
    clearTimeout(st.timer)
    if (!st.armed || st.dropping) { if (!st.armed) popupDragRef.current = null; return }
    st.dropping = true
    suppressSlotClickUntilRef.current = Date.now() + 400
    popupDragRef.current = null
    st.el.style.transform = ''
    st.el.style.transition = ''
    st.el.style.zIndex = ''
    st.el.style.position = ''
    setPopupDragTarget(null)
    setPopupDragActive(false)
    if (commit && st.targetIdx != null) {
      // Swap: the popup entry takes the hovered slot; the displaced circle returns to the
      // ▲ pool (it's simply no longer in the slots array). Same semantics as desktop's
      // popup→row HTML5 drop.
      const next = [...toolbarSlots]
      next[st.targetIdx] = st.id
      updateSlots(next)
      setToolbarPickerOpen(false)
    }
  }
  const [popupDragActive, setPopupDragActive] = useState(false)
  const popupTouchHandlers = (id: SlotId) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1 || popupDragRef.current || slotDragRef.current) return
      const t = e.touches[0]
      const el = e.currentTarget as HTMLElement
      popupDragRef.current = {
        id, el,
        startX: t.clientX,
        startY: t.clientY,
        slotRects: [],
        armed: false,
        dropping: false,
        timer: window.setTimeout(armPopupDrag, HOLD_MS),
        targetIdx: null,
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      const st = popupDragRef.current
      if (!st || st.dropping) return
      const t = e.touches[0]
      const dx = t.clientX - st.startX
      const dy = t.clientY - st.startY
      if (!st.armed) {
        if (brokeHoldSlop(dx, dy)) { clearTimeout(st.timer); popupDragRef.current = null }
        return
      }
      slotDragStyle(st.el as HTMLDivElement, `translate(${dx}px, ${dy}px) scale(1.18)`, 'none')
      // Hit-test the FINGER against the row slots (rects inflated 8px — forgiving targets).
      let target: number | null = null
      for (let j = 0; j < st.slotRects.length; j++) {
        const r = st.slotRects[j]
        if (t.clientX >= r.left - 8 && t.clientX <= r.right + 8 && t.clientY >= r.top - 8 && t.clientY <= r.bottom + 8) { target = j; break }
      }
      if (target !== st.targetIdx) {
        st.targetIdx = target
        setPopupDragTarget(target)
      }
    },
    onTouchEnd: () => endPopupDrag(true),
    onTouchCancel: () => endPopupDrag(false),
  })
  // ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!toolbarPickerOpen) return
    function closeOnOutside(e: MouseEvent) {
      if (toolbarPickerRef.current && !toolbarPickerRef.current.contains(e.target as Node)) {
        setToolbarPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [toolbarPickerOpen])

  // Formatting (font/size/align) is per-selection via marks, persisted in the content.
  const styleBarOpen = activeBar === 'style'
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close ONE layer, and only if it is the one open — the dismiss paths below (water click, the
  // style bar's own idle timer, the ▲ picker) each mean "retract the style bar", never "retract
  // whatever happens to be open". Closing blind here would let the water-click dismiss silently
  // swallow the review bar.
  function closeBarLayer(which: BarLayerId) {
    setActiveBar(a => (a === which ? null : a))
    if (which === 'style') clearStyleTimer()
  }

  // Clicking the WATER (surface outside the paper), a page GAP, or anywhere non-interactive on the
  // page dismisses the floating style bar (Peter, 2026-07-09: it only auto-hid via its timer).
  // Native clicks in text already collapse the selection; this covers the targets that don't.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !t.closest('.inkwave-editor-surface')) return          // footer/panels/portals: not ours
      if (t.closest('.ProseMirror, .scas-cycle-card, button, [role="menu"], [role="dialog"], input, select')) return
      closeBarLayer('style')
      const ed = editorRef.current
      if (ed && !ed.state.selection.empty) {
        ed.chain().setTextSelection(ed.state.selection.head).run()     // collapse → selection bar retracts
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  // One bar fully retreats before the other rises (Peter, 2026-07-10: pressing S then R had the
  // style bar riding the review bar). 240ms = the collapse transition + a beat.
  const barSeqRef = useRef(0)
  const [barsAnimating, setBarsAnimating] = useState(false)
  const barsAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function markBarsAnimating() {
    setBarsAnimating(true)
    if (barsAnimTimer.current) clearTimeout(barsAnimTimer.current)
    barsAnimTimer.current = setTimeout(() => setBarsAnimating(false), 520) // covers close+defer+open
  }
  // Comment notes mount only after the review row has landed — their full-doc scan + per-note
  // getBoundingClientRect were riding the R-tap's frame ("bars lag on opening", 2026-07-11).
  const [notesReady, setNotesReady] = useState(false)
  useEffect(() => {
    if (!reviewOpen) { setNotesReady(false); return }
    const t = setTimeout(() => setNotesReady(true), 260)
    return () => clearTimeout(t)
  }, [reviewOpen])

  // ⚠ TRACK CHANGES CANNOT OUTLIVE ITS OWN CONTROL (R4). The ✎ toggle lives on the review row and
  // nowhere else, so a closed row left the mode invisible AND unreachable while it kept rewriting
  // every keystroke into a red insertion mark. The suggestions already made survive — they are
  // marks in the document. → docs/archive/editor-surface.md#editor-track-changes
  useEffect(() => { if (!reviewOpen) setSuggestOn(false) }, [reviewOpen])
  // The exclusion RULE is pure and lives in toolbarContract.ts (`planBarToggle`). This function is
  // only its hands — timing, sequence guard, idle timer. Adding a layer changes NOTHING here.
  function toggleBar(which: BarLayerId) {
    const seq = ++barSeqRef.current
    markBarsAnimating()
    const plan = planBarToggle(activeBar, which)
    const land = (id: BarLayerId | null) => {
      setActiveBar(id)
      if (id === 'style') armStyleTimer()
      else clearStyleTimer()
    }
    if (!plan.handoff) { land(plan.open); return }
    // A different layer is open: it must fully retreat before this one rises (Peter, 2026-07-10 —
    // pressing S then R had the style bar riding the review bar). The seq guard is what stops a
    // fast double-tap landing a stale open on top of a newer one.
    setActiveBar(null)
    clearStyleTimer()
    setTimeout(() => { if (barSeqRef.current === seq) land(plan.open) }, BAR_HANDOFF_MS)
  }

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

  // SINGLE-OPEN: another window on this device took this document over. The write freeze
  // (storage/opfs.ts) already stops the bytes; making the editor non-editable stops the writer typing
  // into a document that no longer accepts their edits — the confusing "I typed and it vanished" case
  // Edit.tsx's read-only banner explains. Belt-and-braces to the storage freeze, never a substitute.
  useEffect(() => {
    const onSurrendered = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id && id === docRef.current.id) editorRef.current?.setEditable(false)
    }
    window.addEventListener('inkwave:doc-surrendered', onSurrendered as EventListener)
    return () => window.removeEventListener('inkwave:doc-surrendered', onSurrendered as EventListener)
  }, [])

  function armStyleTimer() {
    if (styleTimerRef.current) clearTimeout(styleTimerRef.current)
    styleTimerRef.current = setTimeout(() => closeBarLayer('style'), 5000)
  }
  function clearStyleTimer() {
    if (styleTimerRef.current) { clearTimeout(styleTimerRef.current); styleTimerRef.current = null }
  }
  const [selectionEmpty, setSelectionEmpty] = useState(true)
  // Mirror of "the selection is a single atom node (citation/refList/math)" — those own their own
  // popovers, so the TEXT style bar must not summon for them. State (not a render-time
  // editor.state read): the editor no longer re-renders per transaction (see useEditor options).
  const [selIsAtomNode, setSelIsAtomNode] = useState(false)

  // Ref to the relative container div — passed to ThesaurusPopover for accurate positioning.
  const containerRef = useRef<HTMLDivElement>(null)
  // Ref to the parchment/scroll column — its right edge anchors the options panel.
  const paperRef = useRef<HTMLDivElement>(null)
  // Footer bar + live mirrors of derived flags, read by the caret-keep-visible handler.
  const footerRef = useRef<HTMLDivElement>(null)
  // The footer's fixed WRAPPER — the keyboard dock lifts it with a compositor transform
  // (see toolbarDock.ts; layout-property writes on fixed elements don't apply mid-pan on iOS).
  const footerWrapRef = useRef<HTMLDivElement>(null)
  // False while a visual-viewport pan / keyboard slide is in flight — programmatic caret
  // reveals must NOT run then (they fight iOS's own reveal pan = the double-jump).
  const vvSettledRef = useRef(true)
  const keyboardUpRef = useRef(false)
  const barVisibleRef = useRef(false)

  // Shared mutable ref read synchronously by the decoration plugin.
  const hintStateRef = useRef<HintState>({ focusedPos: null, showHints: true, focusedMinWidth: null, lineCompressionRange: null, animate: true, durationMs: REFLOW_OPEN_MS })

  // Debounced prefetch — fires after typing pauses so popover opens instantly.
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const compliance = useComplianceProvider()
  const emailDocument = emailEnabled() && doc.docType === 'email'
  const [emailSurfaceMode, setEmailSurfaceMode] = useState<ApplicationSurfaceMode>(() =>
    emailDocument ? readApplicationSurfaceMode('email', doc.id) : 'isolated',
  )
  const isolatedEmail = emailDocument && emailSurfaceMode === 'isolated'

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  function handleHintChange(
    pos: number | null,
    minWidth?: number | null,
    lineRange?: LineRange | null,
    animate: boolean = true,
    durationMs: number = REFLOW_OPEN_MS,
  ) {
    hintStateRef.current = {
      ...hintStateRef.current,
      focusedPos: pos,
      focusedMinWidth: minWidth ?? null,
      lineCompressionRange: lineRange ?? null,
      animate,
      durationMs,
    }
    const ed = editorRef.current
    if (ed && !ed.isDestroyed) {
      ed.view.dispatch(ed.state.tr.setMeta(SCAS_HINT_META, true))
    }
  }

  const editor = useEditor({
    // ⚠ THIS MUST STAY FALSE — it was the ablation's #1 keystroke cost. @tiptap/react's legacy
    // default re-ran this whole ~2,500-line tree on EVERY transaction. CONSEQUENCE: the render body
    // must NEVER read `editor.state` / `editor.isActive`; mirror what it needs into React state
    // from an editor subscription. → docs/archive/editor-surface.md#editor-rerender
    shouldRerenderOnTransaction: false,
    // THE ONE EXTENSION LIST (R2), in extensions/editorExtensions.ts so /snapshot — which has no
    // editor — builds the SAME schema. A schema-only COPY was rejected: two lists is how the model
    // drifts from what the editor paginates.
    extensions: buildEditorExtensions({
      getDoc: () => docRef.current,
      getHintState: () => hintStateRef.current,
      getScasLookup: () => scasRef.current!.lookup(),
      presentation: isolatedEmail ? 'application' : 'document',
    }),
    content: doc.contentJson,
    // ⚠ THIS COMPONENT MUST MOUNT IN A DEFAULT-LANE RENDER, never a time-sliced one (lazy/Suspense
    // retry): useEditor's in-render creation and its 1ms scheduleDestroy timer race across the
    // slices, giving two full editor creations and a doubled reveal chain per load. Edit.tsx holds
    // the resolved module in state precisely for this.
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        'data-placeholder': 'Begin writing…',
        'aria-label': doc.docType === 'email' ? 'Message body editor' : 'Document body editor',
        spellcheck: 'false',
      },
      // Keydown-synchronous typing (`inkwave:kdSync`; desktop ON, touch OFF — ⚠ the virtual
      // keyboard's native path and autocorrect must never be intercepted). A printable key
      // dispatches its transaction IN the keydown task, so it paints in the SAME frame.
      // `handleTextInput` runs first, exactly like the native path, so input rules behave
      // identically. → docs/archive/editor-surface.md#editor-kdsync
      handleKeyDown: (view, event) => {
        if (!kdSyncEnabled()) return false
        if (event.ctrlKey || event.metaKey || event.altKey) return false
        if (event.key.length !== 1 || event.isComposing || view.composing) return false
        if (hintStateRef.current.focusedPos !== null) return false
        const { state } = view
        if (!(state.selection instanceof TextSelection)) return false
        const t0 = performance.now()
        const { from, to } = state.selection
        const deflt = () => state.tr.insertText(event.key, from, to) // what the native path would apply
        const handled = view.someProp('handleTextInput', (f) => f(view, from, to, event.key, deflt))
        if (!handled) view.dispatch(state.tr.insertText(event.key).scrollIntoView())
        notePerf('kd-sync', performance.now() - t0)
        return true // preventDefault — the async browser-mutation path is skipped entirely
      },
    },
    onTransaction: ({ editor: e, transaction }) => {
      // ── Insignia (paid): keystroke-cadence tap. Counts only — never chars — and inert for the
      // free tier (the tap is never created).
      if (cadenceTierActive()) {
        if (!cadenceTapRef.current) cadenceTapRef.current = new CadenceTap()
        cadenceTapRef.current.record(transaction.steps)
      }

      // ── Productivity ledger session capture (spec v0.2 §A4): rides the SAME stream and the SAME
      // `countSteps` primitive — O(steps), and every O(doc) number is computed at session CLOSE.
      if (prodLedgerEnabled()) getCapture().record(transaction.steps)

      // ── ⚠ SCAS tick — CONSOLE-SNAPPY RULE: a keystroke does no O(doc) work. The engine scan and
      // the decoration rebuild move to ONE debounced tick; the decoration plugin meanwhile just
      // position-maps its existing marks. The tick's own repaint carries SCAS_HINT_META so it can
      // never re-arm. → docs/archive/editor-surface.md#editor-scas-tick
      if (!transaction.getMeta(SCAS_HINT_META) && (transaction.docChanged || transaction.selectionSet)) {
        if (transaction.docChanged) {
          const size = e.state.doc.content.size
          if (prevDocSizeRef.current >= 0 && size < prevDocSizeRef.current) scasHadDeletionRef.current = true
          prevDocSizeRef.current = size
          // SCAN WINDOW bookkeeping: accumulate WHERE this window's edits landed, in current-doc
          // coordinates, so the tick's scan is O(window) not O(doc). Cost here is O(steps) per
          // keystroke — no doc walks.
          scasLastCaretRef.current = transaction.mapping.map(scasLastCaretRef.current)
          let wf = scasWinRef.current ? transaction.mapping.map(scasWinRef.current.from, -1) : Infinity
          let wt = scasWinRef.current ? transaction.mapping.map(scasWinRef.current.to, 1) : -Infinity
          const maps = transaction.mapping.maps
          for (let i = 0; i < maps.length; i++) {
            const remain = transaction.mapping.slice(i + 1)
            maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
              wf = Math.min(wf, remain.map(newStart, -1))
              wt = Math.max(wt, remain.map(newEnd, 1))
            })
          }
          if (wt >= wf) scasWinRef.current = { from: wf, to: wt }
        }
        if (scasTickTimerRef.current) clearTimeout(scasTickTimerRef.current)
        // ENGINE KILL SWITCH (diagnostic only): `inkwave:scasEngineOff` disables the whole tick.
        // ⚠ NOT the same as the USER's "SCAS suggestions" toggle (`inkwave:scasOff`), which is
        // DISPLAY-only and must never stop the tick — the words stay remembered.
        if (scasEngineOffRef.current) return
        // Phone waits 250ms rather than 120: the scan is O(doc) and at 120 it landed between
        // keystrokes. Verdicts freeze at commit, so a later repaint changes nothing semantically.
        scasTickTimerRef.current = setTimeout(function tick() {
          if (e.isDestroyed) return
          // ⚠ ZOOM-GESTURE DEFERRAL: a decoration repaint REBUILDS paragraph DOM, which detaches
          // an active pinch's touch target (iOS keeps dispatching to the original node, so the
          // gesture dies). Park while `__iwZoomHold` is set and retry after the settle.
          if ((window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) {
            scasTickTimerRef.current = setTimeout(tick, 150)
            return
          }
          const tickT0 = performance.now()
          const hadDeletion = scasHadDeletionRef.current
          scasHadDeletionRef.current = false
          // WINDOWED TICK on both platforms: scan only where this tick's edits and caret moves
          // happened — the window is the accumulated edit range ∪ last-tick caret ∪ current caret,
          // because a word commits when the caret LEAVES it and both paragraphs must be scanned.
          // Windowed ≡ full equivalence is unit-pinned (scas/controller.window.test.ts +
          // extensions/redHighlightWindow.test.ts).
          const caretNow = e.state.selection.from
          const acc = scasWinRef.current
          scasWinRef.current = null
          const lastCaret = scasLastCaretRef.current
          scasLastCaretRef.current = caretNow
          // Deletion ticks are windowed TOO: the controller's whole-doc presence INDEX answers the
          // vanished-lemma pass, so the scan never needs to leave the window.
          const win = {
            from: Math.min(acc ? acc.from : caretNow, caretNow, lastCaret),
            to: Math.max(acc ? acc.to : caretNow, caretNow, lastCaret),
          }
          const stateChanged = scasRef.current!.processDoc(e.state.doc, caretNow, hadDeletion, win)
          // ⚠ Always repaint, but a WINDOWED SPLICE is legal only when nothing outside the window
          // can differ (no state change, no open popover) — a verdict change repaints that lemma
          // doc-wide. Else a full rebuild.
          const meta = win && !stateChanged && hintStateRef.current.focusedPos === null
            ? { window: win } : true
          e.view.dispatch(e.state.tr.setMeta(SCAS_HINT_META, meta))
          notePerf('scas-tick', performance.now() - tickT0)
        }, isTouchDevice() ? 250 : 120)
      }

      // The paragraph index feeds the thesaurus popover and must track SELECTION moves too, so it
      // stays ABOVE the docChanged gate. O(blocks-before-caret): returning false at each textblock
      // keeps it out of inline content, and React bails on the same value.
      const { $from } = e.state.selection
      let pIdx = 0
      e.state.doc.nodesBetween(0, $from.pos, (node) => {
        if (node.type.name === 'paragraph') { pIdx++; return false }
        return !node.isTextblock // headings etc.: nothing inside a textblock can be a paragraph
      })
      setCurrentParagraphIndex(Math.max(0, pIdx - 1))

      // ── ⚠ docChanged gate (THE typing-lag fix) ───────────────────────────────
      // Everything below serializes the document or re-renders the shell, and this handler fires
      // for EVERY transaction — caret moves, the SCAS repaint, the paginator's two per-keystroke
      // metas. Selection-only transactions STOP HERE.
      // → docs/archive/editor-surface.md#editor-docchanged-gate
      if (!transaction.docChanged) return

      // CONSOLE-SNAPPY RULE: no serialization on the keystroke either. The document object is
      // rebuilt LAZILY (`ensureDocFresh`) at the first point that actually needs it — the save
      // beat, snapshot/signing work, or a mirror.
      docStaleRef.current = true
      // The unsynced clock: only a change the WRITER caused counts. The reducer returns its input
      // unchanged once started, so this costs nothing per keystroke.
      if (sawUserInputRef.current) {
        dispatchUnsynced({ type: 'edit', now: Date.now(), syncActive: syncActiveRef.current })
      }
      scheduleSave(() => {
        const t0 = performance.now() // perflog: the save beat's O(doc) doc build (desktop lag hunt)
        const d = ensureDocFresh()
        notePerf('autosave-build', performance.now() - t0)
        return d
      }, () => {
        const d = docRef.current
        if (d.title !== lastNotifiedTitleRef.current) {
          lastNotifiedTitleRef.current = d.title
          onDocChange(d)
        }
        void upsertMeta({ id: d.id, title: d.title, updatedAt: d.updatedAt })
      })

      // Prefetch synonyms for all visible red words after a short pause.
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = setTimeout(() => {
        const words = Array.from(
          e.view.dom.querySelectorAll<HTMLElement>('.scas-red')
        ).map(el => el.dataset.word ?? '').filter(Boolean)
        if (words.length > 0) prefetchSynonyms([...new Set(words)])
      }, 600)

      // ── ⚠ Paragraph snapshot: ENTER MUST DO NO O(doc) WORK ON THE KEYSTROKE. A cheap top-level
      // count first; the paragraph TEXTS are collected only when the count actually grew by one.
      // → docs/archive/editor-surface.md#editor-enter
      {
        let paraCount = 0
        e.state.doc.forEach((node) => { if (node.type.name === 'paragraph') paraCount++ })
        const prev = prevParaCountRef.current
        prevParaCountRef.current = paraCount

        // Only trigger on a single new paragraph (Enter key, not paste of multiple blocks).
        if (paraCount === prev + 1 && pIdx >= 2) {
          // ONLY the completed paragraph's text — collecting every paragraph's was an O(doc) string
          // build ON the keystroke. pIdx-1 is the new empty paragraph; pIdx-2 the just-completed one.
          let completedRaw = ''
          let paraIdx = 0
          e.state.doc.forEach((node) => {
            if (node.type.name !== 'paragraph') return
            if (paraIdx === pIdx - 2) completedRaw = node.textContent
            paraIdx++
          })
          const completedText = completedRaw.trim()
          if (completedText.length > 0) {
            const wordCount = completedText.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

            // ⚠ The snapshot chain (getJSON + JCS + hash + OPFS write + OTS stamp) is DEFERRED to a
            // genuine input pause — content is still captured at WORK time, as it always was. The
            // buffer bookkeeping stays synchronous so Enter ordering is deterministic.
            const takeParaSnapshot = (summaryFn: () => Promise<string>) => runWhenQuiet(() => {
              enqueueSnapshotWork(async () => {
                const snap = await createSnapshotIfChanged(docRef.current, 'paragraph', sessionRef.current?.receipts ?? [])
                if (!snap) return
                setSnapshots((prev) => [...prev, toSnapshotMeta(snap)])
                const stamped = await stampSnapshot(snap.documentId, snap.id)
                if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? toSnapshotMeta(stamped) : s)))
                mirrorIfActive()
                // Async summary — patch when it resolves (does not block the snapshot chain).
                summaryFn().then((summary) => {
                  if (!summary) return
                  enqueueSnapshotWork(async () => {
                    const patched = await patchSnapshotSummary(docRef.current.id, snap.id, summary)
                    if (patched) setSnapshots((prev) => prev.map((s) => (s.id === patched.id ? toSnapshotMeta(patched) : s)))
                  })
                }).catch(() => {})
              })
            }, 1500)

            if (wordCount >= 70) {
              // Flush any buffered short paras first.
              if (shortParaBufferRef.current.length > 0) {
                const flushed = [...shortParaBufferRef.current]
                shortParaBufferRef.current = []
                takeParaSnapshot(() => summariseBullets(flushed))
              }
              takeParaSnapshot(() => summariseParagraph(completedText))
            } else {
              shortParaBufferRef.current.push(completedText)
              if (shortParaBufferRef.current.length >= 3) {
                const group = [...shortParaBufferRef.current]
                shortParaBufferRef.current = []
                takeParaSnapshot(() => summariseBullets(group))
              }
            }
          }
        }
      }
    },
  })

  // Keep editorRef in sync so the hint-change handler can reach the editor.
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Presentation switches in place. Recreating Tiptap would violate the one-editor-per-load
  // invariant and risk losing the latest unsaved transaction merely to change page chrome.
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !emailDocument) return
    setPaginationGappedMode(editor.view.dom, emailSurfaceMode === 'contextual' && gappedPagesEnabled())
  }, [editor, emailDocument, emailSurfaceMode])

  // ── Productivity ledger: bind the doc + close sessions at real boundaries (spec v0.2 §A4).
  // Binding takes the word baseline ONCE per open, off the keystroke path — that is what makes a
  // session's `words_start` free. Close on `visibilitychange → hidden`, while the page is still
  // ALIVE: pagehide is too late for async work and a backgrounded tab throttles timers.
  useEffect(() => {
    if (!editor || !prodLedgerEnabled()) return
    const cap = getCapture()
    // Dynamic (see the lazy note at the top): installSource.ts reaches the ledger's aggregate +
    // store modules, 2.2KB gzip that a writer with the flag OFF has no use for. This runs only
    // inside the `prodLedgerEnabled()` gate above.
    void import('../productivity/installSource').then(m => m.installLedgerSource())
    void cap.bindDoc({ docId: doc.id, getDoc: () => ensureDocFresh() })
    cap.startIdleWatch()

    const onHide = () => { if (document.visibilityState === 'hidden') void cap.closeAndFlush('exit') }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      cap.stopIdleWatch()
      void cap.closeAndFlush('doc-switch')
    }
  }, [editor, doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // DEV-ONLY: expose SCAS internals for manual/automated inspection. Stripped from prod builds.
  useEffect(() => {
    if (import.meta.env.DEV && editor) {
      ;(window as unknown as { __scas?: unknown }).__scas = {
        get state() { return scasRef.current!.state },
        get lookup() { const l = scasRef.current!.lookup(); return { version: l.version, locked: [...l.locked], liveKicks: [...l.liveKicks], immune: [...l.immune] } },
        inSv: (lemma: string) => scasRef.current!.inSv(lemma),
        get hint() { return hintStateRef.current },
        get session() {
          const r = sessionRef.current
          return r ? { token: r.sessionToken.slice(0, 12), setVersion: r.current.setVersion, receipts: r.receipts.length } : null
        },
        runPeriod: () => runPeriodRef.current(), // fire a signing period now (test/debug)
      }
    }
  }, [editor])

  // Track whether the selection is collapsed — on touch the toolbar hides while typing
  // (empty selection) but stays up when text is selected so it can be formatted.
  useEffect(() => {
    if (!editor) return
    const upd = () => {
      setSelectionEmpty(editor.state.selection.empty)
      const n = (editor.state.selection as unknown as { node?: { type: { name: string } } }).node
      setSelIsAtomNode(!!n && ['citation', 'referenceList', 'mathInline', 'mathBlock'].includes(n.type.name))
    }
    const onSel = upd
    // Also track native browser selection changes — iOS long-press doesn't always fire
    // Tiptap's selectionUpdate, so we read the DOM selection directly.
    const onNativeSel = () => {
      const sel = document.getSelection()
      const pm = editor.view.dom
      if (sel && !sel.isCollapsed && pm.contains(sel.anchorNode)) {
        setSelectionEmpty(false)
      } else {
        setSelectionEmpty(editor.state.selection.empty)
      }
    }
    upd()
    editor.on('selectionUpdate', onSel)
    editor.on('transaction', upd)
    document.addEventListener('selectionchange', onNativeSel)
    return () => {
      editor.off('selectionUpdate', onSel)
      editor.off('transaction', upd)
      document.removeEventListener('selectionchange', onNativeSel)
    }
  }, [editor])


  // Detect the on-screen keyboard from the visual viewport: when it is up the visible height drops
  // well below the LARGEST height seen. Compare against that tracked max, never `innerHeight` (iOS
  // has it track the keyboard), and ignore `offsetTop` — a scroll offset, not the keyboard.
  // → docs/archive/editor-surface.md#editor-keyboard-dock
  const kbMaxRef = useRef(0)
  useEffect(() => {
    // ⚠ TOUCH ONLY: on desktop, browser ZOOM also shrinks visualViewport.height, which reads as
    // "keyboard up" and hides the pills while skewing the baseline so they never return.
    if (!isTouchDevice()) return
    const vv = window.visualViewport
    if (!vv) return
    const onVV = () => {
      if (vv.scale > 1.01) return // pinch-zoomed: the viewport shrink is zoom, not the keyboard
      kbMaxRef.current = Math.max(kbMaxRef.current, vv.height)
      setKeyboardUp(vv.height < kbMaxRef.current - 150)
    }
    const onOrient = () => { kbMaxRef.current = vv.height; setKeyboardUp(false) }
    onVV()
    vv.addEventListener('resize', onVV)
    window.addEventListener('orientationchange', onOrient)
    return () => { vv.removeEventListener('resize', onVV); window.removeEventListener('orientationchange', onOrient) }
  }, [])
  // Mirrored to a window flag for non-React readers — PaginationExtension stretches its phone edit
  // debounce while the keyboard is up (a reflow mid-composition is worthless).
  useEffect(() => {
    ;(window as unknown as { __iwKeyboardUp?: boolean }).__iwKeyboardUp = keyboardUp
  }, [keyboardUp])

  // ⚠ PHONE: the footer toolbar HUGS the keyboard by TRANSFORM, never by a layout property. iOS
  // never resizes the layout viewport for the keyboard and composites keyboard-up pans WITHOUT
  // re-running layout, so a `bottom` write does not apply mid-pan and the bar drifts wherever the
  // pan takes it. The dock (editor/toolbarDock.ts) writes translateY(-off) per frame while the
  // geometry moves, and `--iw-kb-offset` carries the same value for the scroll-padding reserve.
  // → docs/archive/editor-surface.md#editor-keyboard-dock
  useEffect(() => {
    if (!isTouchDevice()) return
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let lastApplied = 0
    let clearTransTimer = 0
    let revealTimers: number[] = []
    const dock = createDock({
      readGeom: () => {
        // Rubber-band detection: under elastic overscroll the vv geometry is garbage, so the dock
        // freezes whole (see toolbarDock.ts).
        const se = document.scrollingElement
        const maxY = se ? Math.max(0, se.scrollHeight - se.clientHeight) : Infinity
        const y = window.scrollY
        return {
          innerHeight: window.innerHeight,
          offsetTop: vv.offsetTop,
          height: vv.height,
          scale: vv.scale,
          overscroll: y < -1 || y > maxY + 1,
        }
      },
      apply: (off) => {
        vvSettledRef.current = false
        revealTimers.forEach(clearTimeout)
        revealTimers = []
        root.style.setProperty('--iw-kb-offset', `${off}px`)
        const wrap = footerWrapRef.current
        if (wrap) {
          // KEYBOARD-SLIDE CHASE: iOS reports the keyboard's final geometry in one or two big
          // steps, and a raw write teleports the bar — a LARGE jump gets a short ease-out.
          // ⚠ Small per-frame follow deltas (pans, momentum) must NEVER be transitioned: the
          // compositor tracking IS the mechanism.
          clearTimeout(clearTransTimer)
          const jump = Math.abs(off - lastApplied)
          wrap.style.transition = jump > 60 ? 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)' : ''
          if (jump > 60) clearTransTimer = window.setTimeout(() => { wrap.style.transition = '' }, 300)
          wrap.style.transform = off ? `translate3d(0, ${-off}px, 0)` : ''
        }
        lastApplied = off
      },
      onSettled: () => {
        // Geometry is still — NOW follow-up reveals can't fight an in-flight iOS pan.
        vvSettledRef.current = true
        const el = footerRef.current
        if (el) syncPmScrollReserve(Math.ceil(el.getBoundingClientRect().height))
        keepCaretRef.current()
        // TAP-REVEAL: iOS runs its OWN focus pan AFTER the geometry settles, which can re-park the
        // caret above the keyboard but BEHIND the pill. Two delayed no-op-guarded passes catch
        // whatever it does after our settle (keepCaret only scrolls when actually obstructed).
        revealTimers = [
          window.setTimeout(() => keepCaretRef.current(), 250),
          window.setTimeout(() => keepCaretRef.current(), 600),
        ]
      },
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
    })
    const kick = () => dock.kick()
    const check = () => dock.check()
    vv.addEventListener('resize', kick)
    vv.addEventListener('scroll', kick)
    window.addEventListener('resize', kick)
    // vv events go missing in momentum tails and around load/orientation races, so a window-scroll
    // listener and a 500ms drift probe re-kick the loop — the bar can never stick wrong. `check()`
    // is two property reads and only kicks on real drift.
    window.addEventListener('scroll', check, { passive: true })
    const watchdog = setInterval(check, 500)
    kick()
    return () => {
      vv.removeEventListener('resize', kick)
      vv.removeEventListener('scroll', kick)
      window.removeEventListener('resize', kick)
      window.removeEventListener('scroll', check)
      clearInterval(watchdog)
      dock.stop()
      revealTimers.forEach(clearTimeout)
      clearTimeout(clearTransTimer)
      root.style.removeProperty('--iw-kb-offset')
      if (footerWrapRef.current) {
        footerWrapRef.current.style.transform = ''
        footerWrapRef.current.style.transition = ''
      }
      vvSettledRef.current = true
    }
  }, [])

  // The toolbar band is RESERVED space: `--iw-toolbar-h` mirrors the pill's LIVE height (the RO
  // tracks the row animations), so index.css can pad the phone surface and scroll-padding every
  // scroller — the caret, selection handles and scrollIntoView targets stay ABOVE the toolbar.
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const root = document.documentElement
    const write = () => {
      // Rect height (not offsetHeight): includes the desktop ×1.12 scale transform.
      const h = Math.ceil(el.getBoundingClientRect().height)
      root.style.setProperty('--iw-toolbar-h', `${h}px`)
      syncPmScrollReserve(h)
      keepCaretRef.current() // rows opening/closing move the pill's top edge — keep the caret clear
    }
    const ro = new ResizeObserver(write)
    ro.observe(el)
    write()
    return () => { ro.disconnect(); root.style.removeProperty('--iw-toolbar-h') }
  }, [])
  // ⚠ PM's own scrollIntoView IGNORES CSS scroll-padding, so Enter parked the new caret line
  // BEHIND the floating toolbar and only the next character — which triggers the BROWSER's native
  // caret-reveal, and that DOES honour scroll-padding — brought it back. Give PM the same reserve
  // through its own mechanism (scrollThreshold + scrollMargin), kept in sync with the live toolbar
  // height by the RO above, and with ANY new floating bottom chrome.
  // → docs/archive/editor-surface.md#editor-keyboard-dock
  const lastPmReserveRef = useRef<{ view: unknown; bottom: number } | null>(null)
  const syncPmScrollReserve = (h: number) => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    // ⚠ PILL HEIGHT ONLY — never add the keyboard offset. prosemirror-view's windowRect bottom is
    // ALREADY visualViewport.height, so a kb-inclusive reserve DOUBLE-COUNTS the keyboard: probed
    // at +180px of over-scroll then −84 back on alternating Enters, a screen bounce per keystroke.
    // The CSS scroll-padding is the LAYOUT-viewport mechanism, and that one does need --iw-kb-offset.
    // +28 over the pill clears the whole line box, not just PM's caret rect.
    const bottom = h + 28
    // setProps triggers a full PM updateState — skip when nothing changed (the dock settles after
    // every scroll episode), but never skip a NEW view (editor recreation must be re-synced).
    if (lastPmReserveRef.current?.view === ed.view && lastPmReserveRef.current.bottom === bottom) return
    lastPmReserveRef.current = { view: ed.view, bottom }
    const reserve = { top: 8, left: 0, right: 0, bottom }
    ed.view.setProps({ scrollThreshold: reserve, scrollMargin: reserve })
  }
  useEffect(() => {
    // The RO's first write can precede editor creation (immediatelyRender: false) — re-sync when
    // the editor lands.
    if (!editor || editor.isDestroyed) return
    const el = footerRef.current
    if (el) syncPmScrollReserve(Math.ceil(el.getBoundingClientRect().height))
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⚠ MENU FOCUS GUARD: on iOS any tap outside the contenteditable blurs it, the keyboard
  // dismisses, and the docked pill and its just-opened menu slide to the screen bottom. Every
  // drop-up PANEL is PORTALED to <body>, so the guard is ONE document-level capture handler over
  // every `.iw-touch-guard` surface — a new footer drop-up without that class retracts the
  // keyboard. Real form fields are exempt. → docs/archive/editor-surface.md#editor-keyboard-dock
  useEffect(() => {
    if (!isTouchDevice()) return
    const onPointerDown = (e: PointerEvent) => {
      const pm = editorRef.current?.view.dom
      if (!pm || !(pm === document.activeElement || pm.contains(document.activeElement))) return
      const t = e.target as Element | null
      if (!t?.closest?.('.iw-touch-guard')) return
      // Real form fields — and reading surfaces (the source reader's article body) — are exempt:
      // they legitimately take focus / a selection. See the .iw-touch-guard CSS note.
      if (t.closest('input, textarea, select, [contenteditable], [data-iw-selectable]')) return
      e.preventDefault()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions)
  }, [])

  // iOS touch-and-hold guard, half two (half one is the `.iw-touch-guard` user-select CSS): touch
  // events keep firing on their START target, so a finger that starts on the toolbar and slides
  // onto the editor would begin a selection. ONE document-level non-passive touchmove
  // preventDefault covers every guard surface, portaled menus included; touches that start in the
  // editor are untouched. Capture-phase + first-touch-only, so a second finger cannot drop it.
  useEffect(() => {
    if (!isTouchDevice()) return
    let guarded = false
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.target as Element | null
      // A reading surface inside a guarded panel is exempt (see the .iw-touch-guard CSS note):
      // this half preventDefaults touchmove, which cancels a drag-select as surely as the CSS does.
      guarded = !!t?.closest?.('.iw-touch-guard') && !t.closest('[data-iw-selectable]')
    }
    const move = (e: TouchEvent) => { if (guarded && e.cancelable) e.preventDefault() }
    const end = (e: TouchEvent) => { if (e.touches.length === 0) guarded = false }
    document.addEventListener('touchstart', start, { capture: true, passive: true })
    document.addEventListener('touchmove', move, { capture: true, passive: false })
    document.addEventListener('touchend', end, { capture: true, passive: true })
    document.addEventListener('touchcancel', end, { capture: true, passive: true })
    return () => {
      document.removeEventListener('touchstart', start, { capture: true } as EventListenerOptions)
      document.removeEventListener('touchmove', move, { capture: true } as EventListenerOptions)
      document.removeEventListener('touchend', end, { capture: true } as EventListenerOptions)
      document.removeEventListener('touchcancel', end, { capture: true } as EventListenerOptions)
    }
  }, [])

  // On-device input-latency capture (gated: localStorage 'inkwave:perflog' = '1', see perflog.ts).
  // Per keystroke: how long the beforeinput event WAITED for the main thread (a deferred tick /
  // measure still running) + the synchronous work until the next frame could start. The worst value
  // per 2s window prints as one console.info — capture numbers on the phone without devtools.
  useEffect(() => {
    if (!editor || !perflogEnabled()) return
    const dom = editor.view.dom
    const onBeforeInput = (ev: Event) => {
      const queuedMs = Math.max(0, performance.now() - ev.timeStamp)
      const t0 = performance.now()
      requestAnimationFrame(() => notePerf('input-task', queuedMs + (performance.now() - t0)))
    }
    dom.addEventListener('beforeinput', onBeforeInput, true)
    return () => dom.removeEventListener('beforeinput', onBeforeInput, true)
  }, [editor])

  // Keep the caret above the keyboard / bottom toolbar. While the keyboard is up, if typing or
  // a caret move would put the caret below the keyboard top (or the visible bar above it),
  // scroll down just enough to lift it back into view. Reads live values via refs so the
  // editor subscription can be set up once. No-op while the keyboard is down (desktop too).
  const keepCaretRef = useRef<() => void>(() => {})
  keepCaretRef.current = () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed || !keyboardUpRef.current) return
    // A keyboard slide / vv pan is in flight: iOS is running its OWN caret-reveal pan and the
    // geometry we'd measure against is mid-animation — scrolling now fights it (the tap-to-type
    // "screen moves, then moves again" double-jump). The dock's onSettled re-runs us once still.
    if (!vvSettledRef.current) return
    const vv = window.visualViewport
    let obstructionTop = vv ? vv.offsetTop + vv.height : window.innerHeight
    if (footerRef.current && barVisibleRef.current) {
      const t = footerRef.current.getBoundingClientRect().top
      if (t > 0 && t < obstructionTop) obstructionTop = t
    }
    let caretBottom: number
    try { caretBottom = ed.view.coordsAtPos(ed.state.selection.head).bottom } catch { return }
    const overshoot = caretBottom - (obstructionTop - 12)
    if (overshoot > 4) window.scrollBy(0, overshoot)
  }
  useEffect(() => {
    if (!editor) return
    let raf = 0
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => keepCaretRef.current()) }
    editor.on('selectionUpdate', onChange)
    editor.on('update', onChange)
    // Fresh focus (tap-to-type): the reveal belongs to the tap, not the first keystroke — the
    // dock's settle + its delayed passes do the work once the keyboard geometry lands; this
    // covers the keyboard-ALREADY-up refocus case where no geometry episode fires.
    editor.on('focus', onChange)
    return () => { editor.off('selectionUpdate', onChange); editor.off('update', onChange); editor.off('focus', onChange); cancelAnimationFrame(raf) }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal gate (see `settled` above): fonts.ready + first pagination measure, capped at 1.2s.
  useEffect(() => {
    if (!editor) return
    let done = false
    let revealTimer: ReturnType<typeof setTimeout> | undefined
    let revealRaf = 0
    let revealed = false
    const reveal = () => {
      if (revealed) return // idempotent — the rAF path and the safety cap both call it
      revealed = true
      setSettled(true)
      // Same-task dispatch → React batches Edit's loading-shell unmount with this reveal into ONE
      // commit: the shell disappears in the exact frame the parchment fades in on this surface
      // (which the shell was covering, already phase-synced, coasting and rastered).
      window.dispatchEvent(new Event('inkwave:editor-revealed'))
    }
    const finish = () => {
      if (done) return
      done = true
      // ⚠ START THE COAST FIRST, on this LIGHT frame: the freeze must not share the reveal commit,
      // the busiest frame of the load. The compositor keeps drifting while that commit blocks the
      // main thread, so a same-commit freeze snapshots a stale offset and the waves snap ~7px
      // BACKWARD. → docs/archive/editor-surface.md#editor-reveal
      window.dispatchEvent(new Event('inkwave:reveal-imminent'))
      if (isTouchDevice()) {
        // PHONE: waves decelerate first, the shell drops at 1.5s, and the page fades in over the
        // still-coasting waves so the fade completes at 2s — the moment the waves reach rest.
        revealTimer = setTimeout(reveal, 1200)
        return
      }
      // DESKTOP: the page fade-in starts AT coast start, with two clean frames between the class
      // swap and the heavy commit, so the compositor-driven coast is already easing when it lands.
      revealRaf = requestAnimationFrame(() => { revealRaf = requestAnimationFrame(reveal) })
      // rAF can starve on a wedged/backgrounded main thread and the reveal must still happen.
      revealTimer = setTimeout(reveal, 1500)
    }
    // ── THE DELIBERATE DELAY: show at least one wave-video loop before the document appears.
    // "Warm up the document" needs no code of its own — fonts.ready, the first pagination measure
    // and the editor's mount are ALREADY running through this window; the delay only stops the
    // reveal cutting them short.
    // ⚠ THE FLAG IS READ INLINE, never imported from waveVideo: importing a helper to decide
    // whether to wait would pull the whole video module into the editor bundle on every load.
    let waveVideoOn = false
    try { const v = localStorage.getItem('inkwave:waveVideo'); waveVideoOn = v === '1' || v === 'debug' } catch { /* private mode */ }
    // ⚠ ASK, THEN SUBSCRIBE, IN ONE SYNCHRONOUS BLOCK — the video can loop before we get here, and
    // a bare addEventListener would wait for an event already in the past, forever. waveVideo fires
    // this on EVERY exit, so it always arrives — but it is CAPPED here independently anyway,
    // because that guarantee holds only if the module LOADED. The document must never depend on
    // the animation succeeding. → docs/archive/editor-surface.md#editor-reveal
    const waveLooped: Promise<void> = !waveVideoOn
      ? Promise.resolve()
      : new Promise<void>((res) => {
          if ((window as unknown as { __iwWaveVideoLoopDone?: boolean }).__iwWaveVideoLoopDone) { res(); return }
          const on = () => { window.removeEventListener('inkwave:wave-video-loop', on); res() }
          window.addEventListener('inkwave:wave-video-loop', on)
          setTimeout(() => { console.warn('[inkwave] wave video never reported a loop — revealing anyway'); on() }, 7000)
        })
    // The 1200ms safety cap predates the video and would fire straight through a ~2s loop; with the
    // video ON it becomes the loop gate's own backstop plus the old margin, and OFF it is untouched.
    const cap = setTimeout(finish, waveVideoOn ? 8200 : 1200)
    const fontsReady: Promise<unknown> = (typeof document !== 'undefined' && document.fonts?.ready) || Promise.resolve()
    // Pagination measures in BOTH page modes, so always wait for its first measure — the cap covers
    // any mode where it never fires.
    const paginationReady: Promise<void> =
      (window as unknown as { __iwPaginationReady?: boolean }).__iwPaginationReady
        ? Promise.resolve()
        : new Promise((res) => {
            const on = () => { window.removeEventListener('inkwave:pagination-ready', on); res() }
            window.addEventListener('inkwave:pagination-ready', on)
          })
    void Promise.all([fontsReady, paginationReady, waveLooped]).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(finish)), // one clean frame after the last reflow
    )
    return () => { clearTimeout(cap); if (revealTimer) clearTimeout(revealTimer); if (revealRaf) cancelAnimationFrame(revealRaf) }
  }, [editor])

  // ── iOS break-table store test (`inkwave:btDebug`, default OFF) — the on-device half of the OPFS
  // store's proof: Chromium has createWritable, iOS takes opfsWrite.ts's OTHER branch, and CI
  // cannot reach it. ⚠ Flag read INLINE + dynamic import, so nothing reaches the bundle when off.
  // → docs/archive/editor-surface.md#editor-lazy-chunks
  useEffect(() => {
    let on = false
    try { const v = localStorage.getItem('inkwave:btDebug'); on = v === '1' || v === 'race' } catch { /* private mode */ }
    if (!on) return
    let cancelled = false
    void import('./breakTableDebug').then((m) => { if (!cancelled) void m.runBreakTableDebug() })
    return () => { cancelled = true }
  }, [])

  // ── textRender probe surface — MEASUREMENT ONLY, and it must NEVER install for a real writer.
  // ⚠ DELIBERATELY NOT gated on `textRenderEnabled()`: that flag is DEFAULT ON, so gating the probe
  // on it would hand every writer the harness. It arms on the FRESH `?textRender` URL param — what
  // every .prove.mjs navigates to, and only them. R5: the renderer is measured IN THE REAL APP,
  // never in a harness that reimplements the context.
  // → docs/archive/editor-surface.md#editor-lazy-chunks
  useEffect(() => {
    if (!editor) return
    let armed = false
    try { const p = new URLSearchParams(window.location.search); armed = p.has('textRender') && p.get('textRender') !== 'off' } catch { armed = false }
    if (!armed) return
    let cancelled = false
    void import('./textRenderProbe').then((m) => { if (!cancelled) m.installTextRenderProbe(editor) })
    return () => {
      cancelled = true
      try { delete (window as unknown as { __iwTextRenderProbe?: unknown }).__iwTextRenderProbe } catch { /* noop */ }
    }
  }, [editor])

  // ⚠ WORD COUNT RUNS ONLY WHILE THE ◈ PANEL IS OPEN, on both platforms: `getText()` is an O(doc)
  // string build plus a unicode regex plus a shell re-render, and it was landing in every typing
  // pause for a number nobody could see. Debounced too — a panel readout does not need
  // per-keystroke precision. → docs/archive/editor-surface.md#editor-word-count
  useEffect(() => {
    if (!editor) return
    const touch = isTouchDevice()
    if (!receiptOpen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const count = () => { const m = editor.getText().match(/[\p{L}\p{N}]+/gu); setWordCount(m ? m.length : 0) }
    const delay = touch ? 1000 : 300
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(count, delay) }
    count()
    editor.on('update', schedule)
    return () => { editor.off('update', schedule); if (timer) clearTimeout(timer) }
  }, [editor, receiptOpen])
  // "Sync editor" from the PDF viewer: scroll to the citation OCCURRENCE a highlight belongs to.
  useEffect(() => {
    if (!editor) return
    const onGoto = (e: Event) => {
      const iid = (e as CustomEvent<{ instanceId?: string }>).detail?.instanceId
      if (!iid) return
      let found = -1
      editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.type.name === 'citation' && node.attrs.instanceId === iid) found = pos
        return found < 0
      })
      if (found < 0) return
      const dom = editor.view.nodeDOM(found) as HTMLElement | null
      const el = dom && dom.nodeType === 1 ? dom : (dom?.parentElement ?? null)
      if (!el) return
      // Same class as the ⤵ jump: any programmatic scroll of the writer's document must be
      // reversible and must SAY it happened, or it reads as the page moving on its own.
      rememberReturn()
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('inkwave:goto-citation-instance', onGoto)
    return () => window.removeEventListener('inkwave:goto-citation-instance', onGoto)
  }, [editor])

  // Ctrl/Cmd+Shift+> / Ctrl/Cmd+Shift+< — step the selection's font size up / down through the same
  // ladder the style bar uses (stored in em, base 18px, so it matches the size picker's readout).
  useEffect(() => {
    if (!editor) return
    const SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]
    const BASE = 18, PT_PX = 96 / 72
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return
      const up = e.key === '>' || e.key === '.'
      const down = e.key === '<' || e.key === ','
      if ((!up && !down) || !editor.isFocused) return
      e.preventDefault()
      const raw = editor.getAttributes('textStyle').fontSize as string | undefined
      const px = raw ? (raw.endsWith('em') ? parseFloat(raw) * BASE : parseInt(raw, 10) || BASE) : BASE
      const curPt = Math.round(px / PT_PX)
      let idx = 0, best = Infinity
      SIZES_PT.forEach((s, i) => { const d = Math.abs(s - curPt); if (d < best) { best = d; idx = i } })
      const next = SIZES_PT[Math.max(0, Math.min(SIZES_PT.length - 1, idx + (up ? 1 : -1)))]
      editor.chain().focus().setMark('textStyle', { fontSize: `${+((next * PT_PX) / BASE).toFixed(4)}em` }).run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor])
  // (The old "lift once when keyboardUp flips" effect is gone: it fired MID-SLIDE, the settle
  // gate skipped it, and it never retried — the caret only surfaced on the first keystroke.
  // The dock's onSettled + its 250/600ms follow-up passes own that reveal now.)

  // Track the paper's right edge in viewport coords (used to position the options menu).
  // Viewport-space consumer (fixed chrome), so the VISUAL rect is the right value — but it moves
  // when the page is transform-magnified, so re-read on magnify changes too (deferred a frame so
  // Scroll's subscriber has applied the new scale first).
  useEffect(() => {
    function update() {
      if (paperRef.current)
        setPaperRight(paperRef.current.getBoundingClientRect().right)
    }
    update()
    window.addEventListener('resize', update)
    let raf = 0
    const unsubMagnify = subscribeMagnify(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; update() })
    })
    return () => { window.removeEventListener('resize', update); unsubMagnify(); if (raf) cancelAnimationFrame(raf) }
  }, [])


  // Warm the synonym cache as soon as the editor is ready (existing red words).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    requestAnimationFrame(() => {
      const words = Array.from(
        editor.view.dom.querySelectorAll<HTMLElement>('.scas-red')
      ).map(el => el.dataset.word ?? '').filter(Boolean)
      if (words.length > 0) prefetchSynonyms([...new Set(words)])
    })
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const currentContent = JSON.stringify(editor.getJSON())
    const incomingContent = JSON.stringify(doc.contentJson)
    if (currentContent !== incomingContent) {
      editor.commands.setContent(doc.contentJson, false)
    }
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switching to a different document → reseat the controller onto its persisted state.
  useEffect(() => {
    scasRef.current!.reseat(
      normalizeScasState(docRef.current.scasState),
      docRef.current.scasSeedRef ?? docRef.current.scasSessionSeed,
      docRef.current.id,
      docRef.current.scasSetSize ?? DEFAULT_SET_SIZE,
    )
    prevDocSizeRef.current = -1
    scasWinRef.current = null   // positions from the previous document are meaningless
    scasLastCaretRef.current = 1
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_HINT_META, true))
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // ⚠ THE CLOCK STARTS AT REAL WORK — a document change the WRITER caused. Both halves are needed
  // and both were PROBED: a docChanged transaction ALONE starts it at PAGE LOAD (the editor fires
  // them then), and `beforeinput` alone never fires at all under ProseMirror — a signal that never
  // arrives silently disables the feature. So user input ARMS, the next real change STARTS.
  // → docs/archive/editor-surface.md#editor-unsynced-clock
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const arm = () => { sawUserInputRef.current = true }
    dom.addEventListener('keydown', arm)
    dom.addEventListener('paste', arm)
    return () => { dom.removeEventListener('keydown', arm); dom.removeEventListener('paste', arm) }
  }, [editor])

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
    const docId = doc.id
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
  }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot trigger: on a resolved kick, snapshot if the content hash changed (M1), then anchor it
  // to Bitcoin via OpenTimestamps (M2 → pending in seconds). Ordinary typing / pastes resolve no
  // kick, so they never snapshot.
  useEffect(() => {
    if (!editor) return
    const off = scasRef.current!.nudges.on((event) => {
      periodKicksRef.current.push(event) // buffer this kick for the signing call below
      enqueueSnapshotWork(async () => {
        // Sign now so the snapshot's bundleHash anchors the receipt covering this kick (M3).
        await runPeriodRef.current()
        const nudgeWord = event.replacement ? { from: event.lemma, to: event.replacement } : undefined
        // State holds metadata only — read the FULL previous snapshot (cached) for the diff below.
        // ⚠ THE SILENT-DISABLE SEAM (R4): `createSnapshotIfChanged` refuses rather than write over
        // a history it could not read, which on its own would make provenance stop accruing behind
        // a console warning while the writer believed he was building his trace. Reading through
        // the guard makes the failure SEEN. This queue is off the typing path either way.
        const before = await snapshotsForAction('this snapshot')
        if (!before) return
        const prevSnap = before[before.length - 1] ?? null
        const snap = await createSnapshotIfChanged(docRef.current, 'word-nudge', [...priorReceiptsRef.current, ...(sessionRef.current?.receipts ?? [])], undefined, false, nudgeWord)
        if (!snap) return
        setSnapshots((prev) => [...prev, toSnapshotMeta(snap)])
        const stamped = await stampSnapshot(snap.documentId, snap.id) // pending proof
        if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? toSnapshotMeta(stamped) : s)))
        mirrorIfActive()
        // Background diff summary (Haiku, fire-and-forget)
        if (prevSnap) void summariseDiff(pmToText(prevSnap.contentJson), pmToText(snap.contentJson)).then(async (ds) => {
          if (!ds) return
          await patchSnapshotDiffSummary(snap.documentId, snap.id, ds)
          setSnapshots((prev) => prev.map((s) => s.id === snap.id ? { ...s, diffSummary: ds } : s))
        })
      })
    })
    return off
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual "save version" — always creates a snapshot regardless of whether content changed.
  function saveVersion() {
    enqueueSnapshotWork(async () => {
      // Guarded for the same reason as the word-nudge path: a "Save version" that silently did
      // nothing is the worst possible answer at the moment the writer is deliberately marking work.
      const before = await snapshotsForAction('this version')
      if (!before) return
      const prevSnap = before[before.length - 1] ?? null
      const snap = await createSnapshotIfChanged(docRef.current, 'manual', sessionRef.current?.receipts ?? [], undefined, true)
      if (!snap) return
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
    })
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
  }

  // Primary "Save" — works on every browser. Chromium (Chrome/Edge/Brave) mirrors to a granted
  // folder via File System Access; Firefox/Safari (no folder API) download the record instead.
  function saveRecord() {
    if (fileSaveAvailable()) void saveToFile()
    else exportBundle()
  }

  // Mirror the record to whatever the writer linked — a granted folder (Chromium) and/or OneDrive
  // (any browser). No-op if neither is active. OneDrive auto-sync is silent (no popup); if the
  // token has expired it simply skips until the next explicit sync.
  function mirrorIfActive() {
    ensureDocFresh() // mirrors write docRef — never a stale one
    if (folderActiveRef.current) {
      // ⚠ The archive READ is separated from the WRITE deliberately: sharing a `.catch` reports a
      // transient archive fault as "your folder permission lapsed" and drops the link. A failed
      // read means only "skip THIS mirror" — the next kick mirrors the full archive.
      void readSnapshotArchive(docRef.current.id)
        .then((r) => {
          if (r.kind === 'error') { console.warn('[inkwave] folder mirror skipped — archive unreadable:', r.error); return }
          return writeBundleToFile(docRef.current, r.snapshots)
            // A failed write means permission lapsed — stop claiming "synced" and prompt a reconnect.
            .then((ok) => { if (ok) { setLastFileSave(Date.now()); setDocSource(docRef.current.id, 'local') } else { folderActiveRef.current = false; setNeedsReconnect(true) } })
            .catch(() => { folderActiveRef.current = false; setNeedsReconnect(true) })
        })
    }
    if (oneDriveActiveRef.current) scheduleOneDriveSync()
    if (gdriveActiveRef.current) {
      // Silent auto-mirror: a failed archive read skips this cycle rather than pushing a SHORT
      // archive at Drive. It must never reach `syncToGoogleDrive`.
      void readSnapshotArchive(docRef.current.id)
        .then((r) => {
          if (r.kind === 'error') { console.warn('[inkwave] Drive mirror skipped — archive unreadable:', r.error); return }
          return syncToGoogleDrive(docRef.current, r.snapshots)
            .then((res) => { if (res.ok) { setLastGdriveSync(Date.now()); setGdriveUrl(res.webUrl) } })
        })
        .catch(() => {})
    }
  }

  // Throttled OneDrive write: at most one PUT per interval, with a trailing flush so the final state
  // always lands. Fewer writes ⇒ fewer races with the OneDrive desktop client ⇒ no machine-name copies.
  const ONEDRIVE_MIN_INTERVAL = 20_000
  function oneDriveWriteNow() {
    oneDriveLastWriteRef.current = Date.now()
    // Same rule as the other silent mirrors: never PUT an archive derived from a failed read.
    // ⚠ THIS CHECK IS DEFENCE IN DEPTH, NOT THE LOAD-BEARING GUARD — recorded because it was once
    // claimed to be the latter, and a lane trusting the wrong line stops guarding the right one.
    // What stands between a failed local read and the archive is `readSnapshotsFromDisk`'s THROW
    // (mutation-proved in `storage/cloudLocalRead.test.ts`). This earns its place by making the
    // refusal VISIBLE, and because the `SnapshotRead` union is what stops the next edit here
    // writing `.catch(() => [])`. → docs/archive/editor-surface.md#editor-archive-reads
    void readSnapshotArchive(docRef.current.id)
      .then((r) => {
        if (r.kind === 'error') { console.warn('[inkwave] OneDrive mirror skipped — archive unreadable:', r.error); return }
        return syncToOneDrive(docRef.current, r.snapshots)
          .then((res) => { if (res.ok) { setLastSync(Date.now()); setOneDriveUrl(res.webUrl) } })
      })
      .catch(() => {})
  }
  function scheduleOneDriveSync() {
    if (oneDriveTrailingRef.current) clearTimeout(oneDriveTrailingRef.current)
    const since = Date.now() - oneDriveLastWriteRef.current
    if (since >= ONEDRIVE_MIN_INTERVAL) oneDriveWriteNow()
    else oneDriveTrailingRef.current = setTimeout(oneDriveWriteNow, ONEDRIVE_MIN_INTERVAL - since)
  }

  // "Sync to OneDrive". If signed in → sync silently now. If not → start the same-window sign-in
  // redirect (sets a pending flag); on return we sync automatically (see the reconnect effect).
  async function syncOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return } // navigates away, comes back signed in
    const snaps = await snapshotsForAction('the sync to OneDrive')
    if (!snaps) return
    const r = await syncToOneDrive(docRef.current, snaps)
    if (r.ok) {
      oneDriveActiveRef.current = true
      gdriveActiveRef.current = false // one cloud destination at a time
      setGdriveActive(false)
      setOneDriveAcct(acct)
      setLastSync(Date.now())
      setOneDriveUrl(r.webUrl)
      oneDriveLastWriteRef.current = Date.now()
    } else {
      // Signed in but the token/scope isn't valid (e.g. the new Files.ReadWrite consent) → re-consent.
      await startOneDriveSignIn()
    }
  }

  // Google Drive: sign in (interactive popup — must be from a click) then sync. Once active,
  // mirrorIfActive() keeps it updated as you write.
  async function syncGoogleDrive() {
    const wasActive = gdriveActiveRef.current
    const ok = await startGoogleDriveSignIn()
    if (!ok) return
    const snaps = await snapshotsForAction('the sync to Google Drive')
    if (!snaps) return
    const r = await syncToGoogleDrive(docRef.current, snaps)
    if (r.ok) {
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false // one cloud destination at a time
      setGdriveActive(true)
      setLastGdriveSync(Date.now())
      setGdriveUrl(r.webUrl)
      // Fresh connect (from "Sync to Google Drive") → open the Google picker straight away so the
      // writer can pick a folder, instead of having to reopen the menu + Save again.
      if (!wasActive) setGdrivePickerOpen(true)
    }
  }

  // "Save a copy" to Google Drive: forget the current Drive file so a fresh one is created, then sync.
  // "Save a copy" to Google Drive: forget the current file, then open the picker to choose a folder +
  // name for the NEW copy. The picker's "Sync here" creates a fresh file there (the old one is left
  // as-is). Same UI as choosing a sync folder — just preceded by clearing the file id.
  async function saveAsGoogleDrive() {
    if (!(await startGoogleDriveSignIn())) return
    clearGoogleDriveFile(docRef.current.id) // ensure the picker creates a NEW file
    setGdriveUrl(null)
    setGdrivePickerOpen(true)
  }

  // Pick a Google Drive folder — our OWN picker (lists the folders Inkwave created on drive.file,
  // make new ones, rename the file). Opens in-page; on pick we target the folder and sync into it.
  function chooseGoogleDriveFolder() { setGdrivePickerOpen(true) }
  async function onGdriveFolderPicked(folderId: string) {
    // The picker shows "Syncing…" while this runs and closes itself when the promise resolves.
    setChosenGDriveFolder(folderId || null) // '' = My Drive root
    clearGoogleDriveFile(docRef.current.id)
    setGdriveUrl(null)
    const snaps = await snapshotsForAction('the sync to Google Drive')
    if (!snaps) return
    const r = await syncToGoogleDrive(docRef.current, snaps)
    if (r.ok) {
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false
      setGdriveActive(true)
      setLastGdriveSync(Date.now())
      setGdriveUrl(r.webUrl)
    }
  }

  // Choose which OneDrive folder to sync into. Needs a signed-in session; otherwise start sign-in
  // (we resume on return). On pick, remember the folder and sync there now.
  async function chooseOneDriveFolder() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setFolderPickerOpen(true)
  }
  async function onFolderPicked(folder: OneDriveFolder) {
    setChosenFolder(folder)
    void addRecentFolder(folder) // remember the choice (OPFS) for the picker's "Recent folders"
    await syncOneDrive() // picker shows "Syncing…" until this resolves, then closes itself
  }

  // Inline rename from the pickers' file-name field: rename the live synced file, then re-sync.
  async function renameGdriveFileNow(name: string) {
    if (await renameGoogleDriveFile(docRef.current.id, name)) await syncGoogleDrive()
  }
  async function renameOneDriveFileNow(name: string) {
    if (await renameOneDriveFile(docRef.current, name)) await syncOneDrive()
  }

  // Upload: open a file FROM Google Drive (incl. shared with you) and adopt it as the sync target, so
  // it keeps syncing there with no Save. openInkwaveFile reloads; the resume effect below re-links it.
  async function uploadFromGoogleDrive() {
    // Get the token INSIDE the click (interactive sign-in if needed) so the opener can list silently —
    // an interactive request from the opener's effect isn't a user gesture and hangs.
    if (!(await startGoogleDriveSignIn())) return
    setGdriveOpenerOpen(true)
  }

  // Print / Export PDF — the print stylesheet renders just the writing; the browser dialog lets the
  // writer pick a printer or "Save as PDF". Set the title so the PDF gets a sensible filename.
  function printDoc() {
    // ⚠ PRINT FLOOR: breaks may be lazily stale between a scoped measure and its idle refresh, and
    // print is a canonical consumer that must NEVER see that. The plugin runs a synchronous FULL
    // measure on this event (belt) and on 'beforeprint' (braces — some engines are flaky).
    window.dispatchEvent(new Event('inkwave:measure-now'))
    const prev = document.title
    document.title = (docRef.current.title || 'inkwave').trim()
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }
  // Export PDF → server-rendered, selectable-text A4 PDF in a new tab (no print dialog). Falls back to
  // the browser print dialog if the /api/pdf route is unavailable (e.g. local dev with no Chrome).
  async function exportPdf() {
    // exportPdfToNewTab CLONES the live body — the gap widgets in it must be the exact canonical
    // breaks, not a lazily-stale set (print floor, round-6).
    window.dispatchEvent(new Event('inkwave:measure-now'))
    const ok = await exportPdfToNewTab(docRef.current.title || 'inkwave')
    if (!ok) printDoc()
  }
  // Export the document as a .tex source file (walks the live ProseMirror doc).
  function exportLatex() {
    const ed = editorRef.current
    if (!ed) return
    exportLatexDownload(ed.getJSON() as Parameters<typeof exportLatexDownload>[0], docRef.current.title || 'inkwave')
  }
  // Export block equations as a numbered plain-text list.
  function exportEquations() {
    const ed = editorRef.current
    if (!ed) return
    exportEquationsDownload(ed.getJSON() as Parameters<typeof exportEquationsDownload>[0], docRef.current.title || 'inkwave')
  }
  // Fetch a cloud file's bytes THROUGH the OPFS open cache: tag match → cached bytes; mismatch →
  // download + refill; download failed but bytes cached → the stale copy (airplane-mode opens keep
  // working). ⚠ A cache HIT may only ever compare a TRUSTED tag (a fresh listing, or a live
  // metadata GET) — a stale listing tag can FALSE-HIT and open outdated content that the next sync
  // writes back over the newer remote. A wrong STORED tag can only cause a miss, which is safe.
  async function fetchCloudBytes(
    provider: OpenCacheProvider,
    itemId: string,
    listingTag: string | undefined,
    listingFresh: boolean,
    fetchTag: (id: string) => Promise<string | null>,
    download: (id: string) => Promise<Blob | null>,
  ): Promise<{ blob: Blob; how: string } | null> {
    const cached = await getCachedOpen(provider, itemId)
    let tag = listingTag
    if (cached && !listingFresh) tag = (await fetchTag(itemId)) ?? undefined // verify before trusting a hit
    if (cached && tag && cached.tag === tag) return { blob: cached.blob, how: listingFresh ? 'cache hit' : 'cache hit, tag verified' }
    const blob = await download(itemId)
    if (blob) {
      if (tag) void putCachedOpen(provider, itemId, tag, blob) // refill behind the open
      return { blob, how: cached ? 'cache stale, re-downloaded' : 'cache miss' }
    }
    if (cached) return { blob: cached.blob, how: 'offline — stale cached copy' }
    return null
  }

  async function onGdriveFileOpen(f: { id: string; name: string; folderId: string; folderName: string; tag?: string; fresh?: boolean }) {
    window.dispatchEvent(new Event('inkwave:open-begin')) // see OneDrive note
    openPerfStart('gdrive')
    // Bytes, not text — the opener can pick a .studio.gz; readStudioFile gunzips by magic bytes.
    const got = await fetchCloudBytes('gdrive', f.id, f.tag, !!f.fresh, getGDriveFileTag, downloadGoogleDriveFileBlob)
    if (!got) { openPerfAbort(); window.dispatchEvent(new Event('inkwave:open-failed')); reportOpenError(`Couldn't download "${f.name}" from Google Drive — check the connection and try again.`); return }
    openPerfStep('download', got.how)
    void addRecentGDriveFolder({ id: f.folderId === 'root' ? '' : f.folderId, name: f.folderName })
    try {
      await openInkwaveFile(new File([got.blob], f.name), { googleFileId: f.id })
      setGdriveOpenerOpen(false) // see OneDrive note — same-id opens don't remount the editor
    } catch (err) {
      reportOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
    }
  }
  // Upload from OneDrive (esp. phone). Open the file browser; on pick, download + adopt + resume.
  async function uploadFromOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setOdOpenerOpen(true)
  }
  async function onOneDriveFileOpen(f: { itemId: string; name: string; folder: OneDriveFolder; cTag?: string; fresh?: boolean }) {
    // Choreography: page hides + waves drift for the WHOLE load, download included.
    window.dispatchEvent(new Event('inkwave:open-begin'))
    openPerfStart('onedrive')
    // Bytes, not text — the opener can pick a .studio.gz; readStudioFile gunzips by magic bytes.
    const got = await fetchCloudBytes('onedrive', f.itemId, f.cTag, !!f.fresh, getOneDriveItemTag, downloadOneDriveFile)
    // NEVER fail silently ("tapped the file, nothing happened" on phone): every exit is visible.
    if (!got) { openPerfAbort(); window.dispatchEvent(new Event('inkwave:open-failed')); reportOpenError(`Couldn't download "${f.name}" from OneDrive — check the connection and try again.`); return }
    openPerfStep('download', got.how)
    void addRecentFolder(f.folder)
    try {
      await openInkwaveFile(new File([got.blob], f.name), { oneDriveFile: { folder: f.folder, name: f.name } })
      // Close the opener explicitly: opening a doc with the SAME id as the active one doesn't
      // remount the editor (key unchanged), so nothing else would dismiss the panel.
      setOdOpenerOpen(false)
    } catch (err) {
      reportOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
    }
  }

  // "Save a copy" for OneDrive (Firefox/Safari): name a NEW file, point future syncs at it (the old
  // file stays as it was). Mirrors the Chromium "Save a copy".
  // "Save a copy" to OneDrive: open the folder picker (choose folder + name) — picking a new
  // folder/name writes a new file there, leaving the old one. Same UI as choosing a sync folder.
  async function saveAsOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setFolderPickerOpen(true)
  }

  // Resume Google Drive sync when a gdrive-synced doc loads (e.g. opened via Upload) — so it keeps
  // syncing without the writer hitting Save. Silent: uses the cached/silent token; no token → no-op.
  useEffect(() => {
    if (!googleDriveConfigured() || getDocSource(docRef.current.id) !== 'gdrive' || !googleDriveFileId(docRef.current.id)) return
    // LOAD-PATH RULE: resume must NOT rebuild + re-upload the bundle (that cost ~1s of parse/encode/
    // network on every open of a big doc, for a byte-identical file). A metadata GET validates the
    // token and fetches the link; the next provenance checkpoint mirrors as usual (mirrorIfActive).
    void getGDriveFileInfo(docRef.current.id).then((info) => {
      if (!info) return // no silent token → stay inactive until the writer clicks sync
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false
      setGdriveActive(true)
      setLastGdriveSync(Date.now()) // link verified + nothing changed locally since load ⇒ in sync
      setGdriveUrl(info.webUrl)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect a prior OneDrive session on load (also completes a sign-in we returned from).
  useEffect(() => {
    if (!oneDriveConfigured()) return
    void oneDriveAccount().then((acc) => {
      oneDriveActiveRef.current = !!acc
      setOneDriveAcct(acc)
      if (acc && oneDriveSyncPending()) {
        clearOneDriveSyncPending()
        // The post-sign-in resume sync. Guarded like every other write-back — and this one had no
        // `.catch` at all, so a throw here would surface only as an unhandled rejection.
        void snapshotsForAction('the sync to OneDrive')
          .then((s) => {
            if (!s) return
            return syncToOneDrive(docRef.current, s).then((r) => {
              if (r.ok) {
                setLastSync(Date.now()); setOneDriveUrl(r.webUrl)
                oneDriveActiveRef.current = true
                // We just returned from the Microsoft sign-in redirect → open the OneDrive folder picker.
                setFolderPickerOpen(true)
              }
            })
          })
      } else if (acc && getDocSource(docRef.current.id) === 'onedrive' && oneDriveFilename(docRef.current.id)) {
        // A OneDrive-synced doc loaded (e.g. opened via Upload) → resume syncing it (no Save needed).
        // LOAD-PATH RULE: metadata GET only — no bundle rebuild/upload on open (see gdrive resume).
        void getRemoteFileInfo(docRef.current)
          .then((info) => { if (info) { oneDriveActiveRef.current = true; setLastSync(Date.now()); setOneDriveUrl(info.webUrl) } })
      }
    })
  }, [])

  // "Save" — on first use, open the save-file picker so the writer names + places their single
  // .trace.json; after that, write back to the same file. The picker must run inside the click's
  // gesture, so on first save we call it FIRST (no await before it).
  async function saveToFile() {
    if (!folderActiveRef.current) {
      const handle = await pickSaveFile(docRef.current) // picker is the first call inside → in-gesture
      if (!handle) return
      folderActiveRef.current = true
      setFileName(handle.name)
    } else {
      const handle = await getSaveFileHandle(docRef.current.id, true)
      if (!handle) { folderActiveRef.current = false; setFileName(null); return }
      setFileName(handle.name)
    }
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    await writeBundleToFile(docRef.current, snaps)
    setLastFileSave(Date.now())
  }

  // "Show in folder" — open a native picker started IN the saved file's folder, so the writer can
  // see where it lives (the File System Access API has no direct "reveal in Explorer"). Cancelling
  // is fine — they've seen the folder.
  async function showInFolder() {
    const handle = await getSaveFileHandle(docRef.current.id, false)
    if (!handle) return
    try {
      await (window as unknown as { showOpenFilePicker: (o: unknown) => Promise<unknown> })
        .showOpenFilePicker({ startIn: handle, multiple: false })
    } catch { /* cancelled — the folder was shown */ }
  }

  // "Save a copy" — always prompt for a NEW file, then keep that one updated as you write.
  async function saveAsFile() {
    const handle = await pickSaveFile(docRef.current)
    if (!handle) return
    folderActiveRef.current = true
    setFileName(handle.name)
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    await writeBundleToFile(docRef.current, snaps)
    setLastFileSave(Date.now())
  }

  // Link THIS document's save file (if any) and sync to it immediately — on load and after "Open…".
  // Silent re-link only works while the browser still grants write permission (same session, or an
  // installed PWA); otherwise the writer re-grants on the next manual Save.
  async function linkSaveFileNow() {
    const h = await getSaveFileHandle(docRef.current.id, false)
    if (h) {
      folderActiveRef.current = true
      setNeedsReconnect(false)
      setFileName(h.name)
      // ⚠ LOAD-PATH RULE: RE-LINK ONLY — never rebuild and rewrite the bundle here. That write
      // re-read, re-encoded and rewrote a possibly-20MB file before anything had changed, and was
      // most of the ~1.5s open block. The next provenance checkpoint mirrors as usual.
      setLastFileSave(Date.now())
      return
    }
    // A linked file exists but we don't currently have write permission → show a clear "reconnect"
    // state (never a false "synced"), so the writer knows it ISN'T saving until they re-allow it.
    const name = await getSaveFileName(docRef.current.id)
    folderActiveRef.current = false
    if (name) { setFileName(name); setNeedsReconnect(true) } else { setNeedsReconnect(false) }
  }
  // Re-grant write access (shows the browser's permission popup) and resume saving.
  async function reconnectFolder() {
    const h = await getSaveFileHandle(docRef.current.id, true)
    if (!h) return
    folderActiveRef.current = true
    setNeedsReconnect(false)
    setFileName(h.name)
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    if (await writeBundleToFile(docRef.current, snaps)) setLastFileSave(Date.now())
  }
  useEffect(() => {
    void linkSaveFileNow()
    const onLinked = () => void linkSaveFileNow() // fired by "Open…" so a same-id open re-links live
    window.addEventListener('inkwave:save-file-linked', onLinked)
    return () => window.removeEventListener('inkwave:save-file-linked', onLinked)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the once-per-session grow-only merges at IDLE. The first mirror to a linked target fires on
  // a provenance checkpoint MID-TYPING, so paying the whole-archive read+parse there was an
  // inconsistent typing spike. Doing it here heals OPFS while the writer is idle; if the idle pass
  // doesn't run (no permission yet / offline), the first sync still merges as before.
  useEffect(() => {
    let cancelled = false
    runWhenQuiet(() => {
      if (cancelled) return
      void preMergeSaveFile(docRef.current.id)
      if (oneDriveActiveRef.current) void preMergeRemote(docRef.current)
      if (gdriveActiveRef.current) void preMergeGDrive(docRef.current.id)
      // Heal missing PDF sidecars (idempotent — skips bytes already local). iOS trap: savePdf threw
      // on WebKit until the OPFS write shim, so earlier sidecar passes could complete with nothing
      // stored; this quiet-pass refetch restores them for the cited items.
      if (oneDriveActiveRef.current) {
        void loadLibrary().then(() => fetchMissingSidecars(docRef.current.id, bibProvider.getAll())).catch(() => {})
      }
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the cloud OPEN paths at idle: silent tokens (MSAL chunk / GIS script), the pickers' folder
  // listings (so "Open from OneDrive/Drive" paints instantly), and the bytes of the most recent
  // .studio files (so even a first open after sign-in skips the download). Entirely silent — no
  // auth UI can ever appear from here, and every failure is swallowed (see warmCloudOpen).
  useEffect(() => {
    runWhenQuiet(() => warmCloudOpen(), 3000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Advisory multi-device guard: read the synced file's heartbeat (on load + every 45s) and warn if
  // ANOTHER device wrote it recently — i.e. it looks open on another computer. Never locks: the doc
  // stays editable and saved locally. Resets the dismissal when the document switches.
  useEffect(() => {
    setOtherDevice(false)
    setConflictDismissed(false)
    let cancelled = false
    const check = async () => {
      const hb = oneDriveActiveRef.current
        ? await readRemoteHeartbeat(docRef.current)
        : folderActiveRef.current
          ? await readLocalHeartbeat(docRef.current.id)
          : null
      if (!cancelled) setOtherDevice(!!hb && isOtherDeviceActive(hb.session, hb.exportedAt))
    }
    void check()
    const id = setInterval(() => void check(), 45_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [doc.id])

  // Open a live-composition signing session when the document opens / switches. On success the
  // controller adopts the server's S_v; on failure (offline / service down) we leave the session
  // null and the controller keeps its locally-derived S_v (composition degrades visibly).
  useEffect(() => {
    let cancelled = false
    sessionRef.current = null
    periodKicksRef.current = []
    setReceipts([])
    setChainStatus(null)
    const docId = doc.id
    void SessionRunner.open(docId).then(async (runner) => {
      if (cancelled || !runner || docRef.current.id !== docId) return
      sessionRef.current = runner
      // Adopt the server set + repaint IMMEDIATELY. The recovery/purge below is heavy (archive
      // reads + an Ed25519 verify per historical chain) and must run at browser IDLE — right here
      // it competed with the writer's first scrolls and keystrokes.
      priorReceiptsRef.current = docRef.current.scasReceipts ?? []
      scasRef.current!.useServerSet(runner.current.lemmas, runner.current.setVersion)
      if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_HINT_META, true))

      const recoverAndPurge = async () => {
      if (cancelled || docRef.current.id !== docId) return
      // Recover receipts lost to the old cross-session overwrite bug: collect any that appear in
      // the snapshots but not in `doc.scasReceipts`, and only from sessions whose counter-0 is
      // present, so the chain stays verifiable end-to-end.
      const knownSigs = new Set((docRef.current.scasReceipts ?? []).map((r) => r.signature))
      const knownSessions = new Set((docRef.current.scasReceipts ?? []).map((r) => r.sessionToken))
      // ⚠ THIS PASS DELETES SNAPSHOTS, so it may never run on a view of the archive it is unsure
      // of. On a failed read the old `[]` was a no-op BY LUCK, and the purge reasons from ABSENCE
      // ("no good receipt ⇒ purge") — exactly the reasoning an empty archive corrupts (R1). Bail.
      const recoverRead = await readSnapshotArchive(docId)
      if (recoverRead.kind === 'error') {
        console.warn('[inkwave] receipt recovery skipped — archive unreadable:', recoverRead.error)
        return
      }
      const snaps = recoverRead.snapshots
      // Build a per-session receipt map from all embedded snapshot receipts
      const candidatesBySession = new Map<string, Map<number, import('../types/document').SignedReceipt>>()
      for (const s of snaps) {
        for (const r of (s.receipts ?? [])) {
          if (knownSessions.has(r.sessionToken) || knownSigs.has(r.signature)) continue
          const m = candidatesBySession.get(r.sessionToken) ?? new Map()
          if (!m.has(r.counter)) m.set(r.counter, r)
          candidatesBySession.set(r.sessionToken, m)
        }
      }
      // Only recover sessions whose chain starts at counter=0 (otherwise the verifier would fail)
      const recovered: import('../types/document').SignedReceipt[] = []
      for (const [, byCounter] of candidatesBySession) {
        if (!byCounter.has(0)) continue
        const sorted = [...byCounter.values()].sort((a, b) => a.counter - b.counter)
        // Only include if counters are contiguous (no gaps)
        if (sorted.every((r, i) => r.counter === i)) recovered.push(...sorted)
      }
      if (recovered.length && !cancelled && docRef.current.id === docId) {
        const merged = [...recovered, ...(docRef.current.scasReceipts ?? [])]
        const updated: InkwaveDocument = { ...docRef.current, scasReceipts: merged }
        commitDoc(updated)
      }

      // Purge sessions whose receipts fail cryptographic verification, once at session open, so the
      // next export bundle only carries verifiable chains. (A bad signature means signed with a dev
      // key, or corrupted by the old kicks-array reference bug.)
      const pubKey = signingPublicKeys()
      const bySession = new Map<string, SignedReceipt[]>()
      for (const r of (docRef.current.scasReceipts ?? [])) {
        const arr = bySession.get(r.sessionToken) ?? []
        arr.push(r)
        bySession.set(r.sessionToken, arr)
      }
      const badSessions = new Set<string>()
      for (const [token, receipts] of bySession) {
        receipts.sort((a, b) => a.counter - b.counter)
        const v = await verifyChain(receipts, token, pubKey)
        if (!v.ok) badSessions.add(token)
        // Yield between chains: the Ed25519 sweep is main-thread crypto — unsliced it was the
        // "on-and-off 1s lags 5-10s after refresh" once the quiet scheduler let it run.
        await new Promise((r) => setTimeout(r, 0))
        if (cancelled || docRef.current.id !== docId) return
      }
      if (badSessions.size && !cancelled && docRef.current.id === docId) {
        const cleanReceipts = (docRef.current.scasReceipts ?? []).filter(
          (r) => !badSessions.has(r.sessionToken),
        )
        // Remove snapshots that only embed bad-session receipts (so content integrity passes).
        // Re-read (the recovery above may have appended) — and bail again rather than delete from
        // a list we couldn't confirm.
        const afterRead = await readSnapshotArchive(docId)
        if (afterRead.kind === 'error') {
          console.warn('[inkwave] receipt purge skipped — archive unreadable:', afterRead.error)
          return
        }
        // ⚠ A FAILED VERIFICATION IS NOT A FORGED SNAPSHOT, and NOTHING HERE MAY DELETE PROVENANCE.
        // This loop once deleted every snapshot whose receipts were all "bad" and destroyed 79
        // Bitcoin-anchored snapshots down to 4, twice. The premise was the bug: a failed
        // `verifyChain` shows only that THIS BUILD, with THIS KEY, could not verify it — and the
        // commonest cause is innocent (a production-signed document opened against the dev key on
        // localhost). Report the chain as unverified; the snapshots STAY. A genuine forgery case
        // belongs behind an explicit writer-initiated action, never a background sweep.
        // → docs/archive/editor-surface.md#editor-no-auto-delete
        const unverifiable = afterRead.snapshots.filter((s) => {
          const rs = s.receipts ?? []
          return rs.length > 0 && rs.every((r) => badSessions.has(r.sessionToken))
        })
        if (unverifiable.length) {
          console.warn(
            `[inkwave] ${unverifiable.length} snapshot(s) carry receipts this build cannot verify ` +
            `(${badSessions.size} session(s)). They are KEPT — an unverifiable chain is not a forged ` +
            `one, and the commonest cause is a signing-key mismatch (e.g. a production-signed ` +
            `document opened against the dev key on localhost).`,
          )
        }
        const updated: InkwaveDocument = { ...docRef.current, scasReceipts: cleanReceipts }
        commitDoc(updated)
      }

      priorReceiptsRef.current = docRef.current.scasReceipts ?? []
      }
      runWhenQuiet(() => void recoverAndPurge(), 5000)
    })
    return () => { cancelled = true }
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // The signing period: with a session, sign the period's receipt and adopt the next server set;
  // without one, fall back to a local resample. Verdicts are frozen, so neither reflows committed
  // text. Held in a REF so the interval always runs the latest closure, and it RETURNS A PROMISE so
  // the nudge handler can await signing — the snapshot's bundleHash must cover this nudge's receipt.
  const runPeriodRef = useRef<() => Promise<void>>(async () => {})
  runPeriodRef.current = async () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    ensureDocFresh() // the receipt hashes the exact current content
    const runner = sessionRef.current
    if (runner) {
      const kicks = [...periodKicksRef.current] // snapshot — a second nudge must not mutate this
      const cHash = await contentHash(docRef.current.contentJson)
      // Insignia: drain this period's cadence bins + send the Clerk token so the server can gate
      // the signed digest on an active subscription. Free tier sends neither (cadence undefined).
      let cadence: ReturnType<CadenceTap['drain']> | undefined
      let authToken: string | undefined
      if (cadenceTierActive() && cadenceTapRef.current?.hasData) {
        cadence = cadenceTapRef.current.drain()
        authToken = (await getClerkToken()) ?? undefined
      }
      const receipt = await runner.closePeriod(cHash, kicks, cadence, authToken)
      if (!receipt) return // offline — keep the kicks buffered, retry next nudge
      periodKicksRef.current = []
      scasRef.current!.useServerSet(
        applyNLimit(runner.current.lemmas, docRef.current.scasSetSize ?? 0),
        runner.current.setVersion,
      )
      const allReceipts = [...priorReceiptsRef.current, ...runner.receipts]
      setReceipts(allReceipts)
      const updated: InkwaveDocument = {
        ...docRef.current,
        scasState: scasRef.current!.state,
        scasReceipts: allReceipts,
      }
      commitDoc(updated)
      mirrorIfActive()
      if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(SCAS_HINT_META, true))
    } else {
      scasRef.current!.resampleNow()
      const updated: InkwaveDocument = { ...docRef.current, scasState: scasRef.current!.state }
      commitDoc(updated)
    }
  }

  // Apply the user's N limit to a server-provided lemma set.
  // 0 = infinite = use the full set unchanged.
  // N > 0 = take the first N lemmas (a deterministic approximation; the server issues the
  // correctly-sampled set on the next period).
  function applyNLimit(lemmas: Set<string>, n: number): Set<string> {
    if (!n || n >= lemmas.size) return lemmas
    const out = new Set<string>()
    let count = 0
    for (const l of lemmas) { if (count++ >= n) break; out.add(l) }
    return out
  }

  // Verify the held receipt chain against the published key (the guarantee, client-side).
  function verifyReceiptChain() {
    const runner = sessionRef.current
    if (!runner || runner.receipts.length === 0) { setChainStatus('no receipts yet'); return }
    void verifyChain(runner.receipts, runner.sessionToken, signingPublicKeys()).then((v) => {
      setChainStatus(v.ok ? `✓ ${v.verified} receipts verified` : `✗ ${v.reason}`)
    })
  }

  function handleLimitChange(next: number | 'infinite') {
    const newSetSize = next === 'infinite' ? 0 : next
    const scas = scasRef.current!
    if (sessionRef.current) {
      // M3 live: the server owns S_v. Filter its current lemma set to the requested size
      // for immediate feedback (the server will issue a properly-sampled set next period).
      scas.useServerSet(
        applyNLimit(sessionRef.current.current.lemmas, newSetSize),
        sessionRef.current.current.setVersion,
      )
    } else {
      // M0/offline: derive S_v locally from the session seed.
      scas.reseat(
        scas.state,
        docRef.current.scasSeedRef ?? docRef.current.scasSessionSeed,
        docRef.current.id,
        newSetSize,
      )
    }
    scas.clearStaleKicks()
    const updated: InkwaveDocument = {
      ...docRef.current,
      scasLimitN: next,
      scasSetSize: newSetSize,
      scasState: scas.state,
      updatedAt: new Date().toISOString(),
    }
    commitDoc(updated)
    // Force the highlight plugin to rebuild decorations from the updated lookup.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_HINT_META, true))
    // Re-focusing keeps the cursor in the editor on desktop; on a phone it would re-open
    // the keyboard and hide the toolbar (so the toolbar appears to "run away" when you
    // tap its controls), so skip the re-focus on touch-only devices.
    if (!window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches) {
      editor?.commands.focus()
    }
  }

  // Hide the toolbar only on touch-only devices (phones/tablets — they have no hover)
  // while the keyboard is up. Touchscreen laptops keep it (they report hover via trackpad).
  const isTouch = isTouchDevice()

  // A single atom node (citation / reference list / math) selected by click-hold must not summon
  // the TEXT formatting bar — those carry their own popovers — so it reads as "no text selection".
  // ⚠ `selIsAtomNode` is STATE, mirrored by the selection effect: the render body must never read
  // `editor.state` now that per-transaction re-renders are off.
  const selectionOnPhone = isTouch && keyboardUp && !selectionEmpty && !selIsAtomNode
  const selectionOnDesktop = !isTouch && !!editor && !selectionEmpty && !selIsAtomNode
  // The main row no longer retracts while typing on phone — the footer hugs the keyboard instead
  // (the --iw-kb-offset tracker above), so it stays visible and usable the whole time.
  const showMainRow = true
  // Style bar auto-expands on phone text selection or desktop text selection.
  const styleBarExpanded = (selectionOnPhone || selectionOnDesktop || styleBarOpen) && !!editor
  const barVisible = showMainRow || selectionOnPhone
  keyboardUpRef.current = keyboardUp
  barVisibleRef.current = barVisible

  // ONE renderer for every slot button — the same population renders in the main row and in
  // the ▲ drop-up (wherever the id currently lives), so behaviour can't drift between homes.
  const renderSlotButton = (id: SlotId, inRow: boolean) => (
    <>
      {id === 'guide' && <GuideMenu />}
      {id === 'math' && <MathMenuButton editor={editor} />}
      {id === 'bib' && (
        <button ref={inRow ? bibBtnRef : undefined} type="button"
          onClick={() => setBibPanelOpen(o => !o)}
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${bibPanelOpen ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
          title="Bibliography / citations"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-xs leading-none font-serif" style={{ fontStyle: 'italic' }}>‟</span>
        </button>
      )}
      {id === 'receipt' && (
        <button type="button"
          data-iw-bar="review" onClick={() => toggleBar('review')}
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${reviewOpen ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
          title="Review — comments & track changes"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">R</span>
        </button>
      )}
      {id === 'page' && <PageMenu editor={editor ?? undefined} />}
      {id === 'style' && (
        <button
          type="button"
          aria-pressed={styleBarOpen}
          data-iw-bar="style"
          onClick={() => toggleBar('style')}
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${styleBarOpen ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
          title="Style"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">S</span>
        </button>
      )}
      {id === 'settings' && <SettingsMenu limitN={doc.scasLimitN} onLimitChange={handleLimitChange} />}
      {id === 'media' && (
        <MediaMenu
          assets={doc.media ?? []}
          onImported={(asset) => {
            // The bytes are already in OPFS; this records the REFERENCE on the document. Same
            // write shape as a header edit (EmailComposePanel): docRef first, then onDocChange,
            // then scheduleSave — nothing else saves it, because the editor's own update handler
            // never fires for a change the writer made outside the contenteditable.
            const updated = {
              ...docRef.current,
              media: [...(docRef.current.media ?? []), asset],
              updatedAt: new Date().toISOString(),
            }
            commitDoc(updated)
          }}
        />
      )}
      {id === 'clock' && <ClockSlotButton open={ledgerOpen} onToggle={() => setLedgerOpen(o => !o)} />}
      {id === 'music' && (
        // A SLOT IS A TRIGGER, NEVER AN OWNER (toolbarContract.ts): this opens the music BAR layer;
        // it does not own music. `data-iw-bar="music"` marks it so the row's onClickCapture leaves
        // its own toggle sequencing (toggleBar) alone. Mutually exclusive with S and R by the TYPE
        // (planBarToggle) — never by this button remembering to close them.
        <button
          type="button"
          aria-pressed={activeBar === 'music'}
          data-iw-bar="music"
          onClick={() => toggleBar('music')}
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${activeBar === 'music' ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
          title="Music — turn a photo into a piece"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">♪</span>
        </button>
      )}
    </>
  )

  // ONE editor body, placed either directly on document paper or inside a reusable application
  // surface. Do not fork this subtree for email: the same EditorContent, gutters, SCAS popover,
  // autosave and provenance path must serve every presentation.
  const editorBody = (
    <>
      <div style={{ '--inkwave-lh': lineHeight } as React.CSSProperties}><EditorContent editor={editor} /></div>
      {editor && (
        <CaretGutter editor={editor} containerEl={containerRef as RefObject<HTMLDivElement>} side="left" />
      )}
      {editor && (
        <CaretGutter editor={editor} containerEl={containerRef as RefObject<HTMLDivElement>} side="right" />
      )}
      {editor && (
        <ThesaurusPopover
          editor={editor}
          paragraphIndex={currentParagraphIndex}
          containerEl={containerRef as RefObject<HTMLDivElement>}
          onHintChange={handleHintChange}
          isLockedLemma={(lemma) => scasRef.current!.lookup().locked.has(lemma)}
          firstNudgeAt={(word) => scasRef.current!.firstNudgeAt(word)}
        />
      )}
    </>
  )
  return (
    <ComplianceContext.Provider value={compliance}>
      {/* Phone reveal chrome choreography — see chromeDone above (.iw-chrome-hold / .iw-chrome-in). */}
      <div className={isTouch ? (!settled ? 'iw-chrome-hold' : !chromeDone ? 'iw-chrome-in' : undefined) : undefined}>
        {otherDevice && !conflictDismissed && (
          <div
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-2 text-sm font-serif"
            style={{ background: 'var(--iw-notice-bg, #fff7ed)', borderBottom: '1px solid var(--iw-notice-edge, #f0c98a)', color: 'var(--iw-notice-fg, #92400e)' }}
          >
            <span>
              ⚠ This document looks open on another device — edits there and here may overwrite each
              other. Your work is always saved on this device.
            </span>
            <button
              type="button"
              onClick={() => setConflictDismissed(true)}
              className="underline whitespace-nowrap hover:opacity-70"
            >
              Got it
            </button>
          </div>
        )}
        {fileOpenError && (
          <div
            // KIND, not one voice for everything: the blind-overwrite guard's messages are GOOD
            // news, and shouting them in the red ⚠ banner told the writer their thesis was in
            // trouble at the moment it had just been protected. ⚠ `iw-nightable` on the INFO
            // variant ONLY — the night tokens are scoped inside that class, and the ERROR variant
            // must keep its red. → docs/archive/editor-surface.md#editor-banner-kind
            className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-2 text-sm font-serif${fileOpenError.kind === 'info' ? ' iw-nightable' : ''}`}
            style={fileOpenError.kind === 'info'
              ? {
                  background: '#faf7ff', // literal: .iw-nightable already overrides it at night, and
                  // a token here would need a day value that disagrees with --iw-subtle-bg.
                  borderBottom: '1px solid var(--iw-nightable-border, #e7e5e4)',
                  color: 'var(--iw-ink, #302438)',
                }
              : { background: 'var(--iw-alert-bg, #fef2f2)', borderBottom: '1px solid var(--iw-alert-edge, #fca5a5)', color: 'var(--iw-alert-fg, #991b1b)' }}
          >
            <span>{fileOpenError.kind === 'info' ? '✓' : '⚠'} {fileOpenError.message}</span>
            <button
              type="button"
              onClick={() => setFileOpenError(null)}
              className="underline whitespace-nowrap hover:opacity-70"
            >
              Dismiss
            </button>
          </div>
        )}
        <Scroll
          paperRef={paperRef}
          containerRef={containerRef}
          phone={isTouch}
          fill
          presentation={isolatedEmail ? 'application' : 'document'}
          revealed={settled}
          covered={isTouch ? !waveRest : !settled}
        >
          {emailDocument ? (
            <EmailComposePanel
              doc={doc}
              getCurrentDoc={ensureDocFresh}
              surfaceMode={emailSurfaceMode}
              onSurfaceModeChange={(mode) => {
                writeApplicationSurfaceMode('email', doc.id, mode)
                setEmailSurfaceMode(mode)
              }}
              onDocChange={(updated) => {
                // ⚠ A header edit is a document edit and NOTHING else saves it — autosave is driven
                // by the editor's own update handler, which a header field never fires. This is the
                // live instance of the commitDoc rule.
                commitDoc(updated)
              }}
            >
              {editorBody}
            </EmailComposePanel>
          ) : editorBody}
        </Scroll>

        {/* The faint desktop countdown. Renders NOTHING unless a block is running and the flag is
            on; it portals itself to <body>, so despite sitting here in the tree it is never a
            DESCENDANT of the editor and its per-second write cannot invalidate the page subtree.
            It is the SECOND access path to the ledger — same setter as the toolbar's clock slot. */}
        {prodLedgerEnabled() && <CountdownOverlay onOpen={openLedger} />}
        {/* At the end of a longer session, surface the reflection (Peter). Null render; opens the
            drop-up only when a reflection is genuinely due. Same setter as the countdown/clock. */}
        {prodLedgerEnabled() && <ReflectionAutoOpen onDue={openLedger} />}
        {/* When a Start-work block ends, open the drop-up so it can ask for the block summary. Null
            render; the drop-up lands on the work view because a summary is pending. */}
        {prodLedgerEnabled() && <WorkSummaryAutoOpen onDue={openLedger} />}
        {prodLedgerEnabled() && ledgerOpen && (
          <LedgerDropUp
            docId={doc.id}
            docLabel={doc.title}
            goals={docRef.current.goals}
            // §A5b: goals are a DOCUMENT property, so they persist the way every other document
            // property does — through the editor's own autosave. One writer, no race.
            onGoalsChange={(g) => {
              docRef.current = { ...ensureDocFresh(), goals: g }
              scheduleSave(() => docRef.current, () => { void upsertMeta({ id: docRef.current.id, title: docRef.current.title, updatedAt: docRef.current.updatedAt }) })
              setLedgerGoalsTick(n => n + 1)
            }}
            // The charts live behind their own default-ON flag; offer the button only when it's on.
            // Opening the charts closes the drop-up (the charts are a full modal over the same surface).
            onOpenGraphs={prodGraphsEnabled() ? () => { setLedgerOpen(false); setGraphsOpen(true) } : undefined}
            // Reporting — the AI work report (P1c). Same lift: offer only behind its flag, and opening
            // it closes the drop-up (a full modal over the same surface).
            onOpenReport={reportFlag ? () => { setLedgerOpen(false); setReportOpen(true) } : undefined}
            onClose={() => setLedgerOpen(false)}
          />
        )}
        {graphsOpen && (
          // fallback={null}: the writer opened a modal; a flash of placeholder chrome is worse than
          // the modal appearing when its chunk lands (same choice as the report modal below).
          <Suspense fallback={null}>
            <ProductivityGraphsPanel onClose={() => setGraphsOpen(false)} />
          </Suspense>
        )}

        {/* ReceiptPanel: always in the tree on phone (no !keyboardUp guard) so the panel
            stays mounted during and after async save-version work. The trigger is hidden
            on touch (lives in toolbar) and when keyboard is up (visually inaccessible). */}
        <ReceiptPanel
          documentId={doc.id}
          snapshots={snapshots}
          onCheckBitcoin={checkBitcoin}
          onOpened={runOtsSweep}
          onSaveVersion={saveVersion}
          receiptCount={receipts.length}
          chainStatus={chainStatus}
          onVerifyChain={verifyReceiptChain}
          wordCount={wordCount}
          compact={isTouch}
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          hideTrigger={isTouch || keyboardUp}
        />

        {/* Review layer — mounted ONLY while the R button is on, so it does ZERO work during normal
            writing (it rescans the doc for comment marks, which was per-keystroke lag otherwise). */}
        {editor && reviewOpen && notesReady && <CommentNotes editor={editor} paperRef={paperRef} />}
        {/* ReviewBar now renders as the toolbar's second row (see below) — not a floating pill. */}

        {/* One sync indicator. Regular browser (File System Access) → local folder only; Firefox/
            Safari → OneDrive. The label reads clearly in every state. Hidden while the phone
            keyboard is up so it never sits over the writing. */}
        {!keyboardUp && (() => {
          // On mobile, ◈ and ☁ live inside the toolbar — hide the fixed-position triggers.
          // On desktop they stay as floating corner pills.
          const syncProps = isTouch ? { open: syncOpen, onOpenChange: setSyncOpen, hideTrigger: true as const } : {}
          if (fileSaveAvailable()) {
            // Regular browser → local folder. Honest states so the writer is never misled into
            // thinking it's saving when it isn't:
            if (needsReconnect) {
              return (
                <SyncStatus compact={isTouch}
                  label="Reconnect to keep saving"
                  multiline
                  synced={false}
                  path={fileName}
                  tooltip={fileName ? `Click to re-allow saving to ${fileName}` : 'Click to re-allow saving'}
                  onClick={() => void reconnectFolder()}
                  {...syncProps}
                />
              )
            }
            return fileName ? (
              <SyncStatus compact={isTouch}
                label={lastFileSave ? 'Synced to folder' : 'Sync pending'}
                synced={!!lastFileSave}
                path={fileName}
                lastSync={lastFileSave}
                tooltip={`Saving to ${fileName}`}
                onShowInFolder={showInFolder}
                onChangeFolder={saveAsFile}
                {...syncProps}
              />
            ) : (
              <SyncStatus compact={isTouch} label="Save to folder" synced={false} onClick={() => void saveToFile()} {...syncProps} />
            )
          }
          // Google Drive (Firefox/Safari) takes the indicator once the writer has connected it.
          if (gdriveActive) {
            return (
              <SyncStatus
                compact={isTouch}
                label={lastGdriveSync ? 'Synced to Google Drive' : '▴ Sync pending'}
                synced={!!lastGdriveSync}
                lastSync={lastGdriveSync}
                webUrl={gdriveUrl}
                tooltip="Google Drive"
                {...syncProps}
              />
            )
          }
          if (!oneDriveConfigured()) return null
          return oneDriveAcct ? (
            <SyncStatus compact={isTouch}
              label={lastSync ? 'Synced to OneDrive' : '☁ Sync pending'}
              synced={!!lastSync}
              path={oneDrivePath(doc)}
              displayName={doc.title || undefined}
              lastSync={lastSync}
              tooltip={`OneDrive: ${oneDriveAcct}`}
              webUrl={oneDriveUrl}
              onChangeFolder={chooseOneDriveFolder}
              onClick={lastSync ? undefined : syncOneDrive}
              {...syncProps}
            />
          ) : (
            <SyncStatus compact={isTouch} label={<span className="inline-flex items-center gap-1.5"><span className="iw-subtle-flash" style={{ fontSize: '1.5em', lineHeight: 1, position: 'relative', top: '-0.14em' }}>…</span><span style={{ fontSize: '1.4em', lineHeight: 1 }}>☁</span></span>} synced={false} tooltip="OneDrive — disconnected, sign in to sync" onClick={syncOneDrive} {...syncProps} />
          )
        })()}

        {/* Peter's 5-minute unsynced-work warning. Sits by the sync pill (where the writer already
            looks for this) and never over the text. Hidden while the keyboard is up, like the pill
            itself — a phone writer mid-sentence is the one person who must not be interrupted. */}
        {!keyboardUp && (
          <UnsyncedNotice
            show={warnUnsynced}
            minutes={Math.max(5, Math.round((unsyncedNow - (unsynced.firstUnsyncedEditAt ?? unsyncedNow)) / 60_000))}
            onSetUpSync={() => window.dispatchEvent(new Event('inkwave:open-save'))}
            onDismiss={() => dispatchUnsynced({ type: 'dismiss' })}
          />
        )}

        {gdrivePickerOpen && (
          <GoogleDriveFolderPicker
            currentName={gDriveFilename(docRef.current.id) ?? bundleFilename(docRef.current)}
            onRename={renameGdriveFileNow}
            onPick={onGdriveFolderPicked}
            onClose={() => setGdrivePickerOpen(false)}
          />
        )}
        {gdriveOpenerOpen && (
          <GoogleDriveFileOpener onOpen={onGdriveFileOpen} onClose={() => setGdriveOpenerOpen(false)} />
        )}
        {odOpenerOpen && (
          <OneDriveFileOpener onOpen={onOneDriveFileOpen} onClose={() => setOdOpenerOpen(false)} />
        )}
        {folderPickerOpen && (
          <OneDriveFolderPicker
            currentName={oneDriveFilename(docRef.current.id) ?? bundleFilename(docRef.current)}
            onRename={renameOneDriveFileNow}
            onPick={onFolderPicked} onClose={() => setFolderPickerOpen(false)} />
        )}

        {/* Footer bar. On a phone it docks flush to the bottom (the top of the Safari URL
            bar) with flat bottom corners; on desktop it floats as a rounded pill. */}
        <div
          ref={footerWrapRef}
          className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none"
          style={{
            // Phone: the safe-area padding melts away as the keyboard overlap grows (max() keeps the
            // slide continuous) so the bar sits truly flush on the keyboard's top edge.
            paddingBottom: isTouch ? 'max(0px, calc(env(safe-area-inset-bottom) - var(--iw-kb-offset, 0px)))' : `${TOOLBAR_BOTTOM_PX * zoom}px`,
            // Landscape phones (viewport-fit=cover): keep the docked bar clear of the notch/home-bar
            // side insets, matching the bottom inset above. Zero in portrait / on desktop.
            paddingLeft: isTouch ? 'env(safe-area-inset-left)' : undefined,
            paddingRight: isTouch ? 'env(safe-area-inset-right)' : undefined,
            // When the PDF panel is open: a side dock stops the centring box at the docked edge
            // (--iw-pdf-room right / --iw-pdf-room-left left) so the toolbar recentres over the
            // writing; a bottom dock lifts the whole toolbar above it (--iw-pdf-room-bottom).
            left: 'var(--iw-pdf-room-left, 0px)',
            right: 'var(--iw-pdf-room, 0px)',
            // ⚠ Phone: the keyboard lift is NOT part of `bottom` — the dock writes a transform on
            // this wrapper per frame. NEVER move it back into a layout property, and never
            // transition transform here.
            bottom: 'var(--iw-pdf-room-bottom, 0px)',
            willChange: isTouch ? 'transform' : undefined,
            transition: isTouch ? 'left 0.18s ease, right 0.18s ease' : 'left 0.18s ease, right 0.18s ease, bottom 0.18s ease',
          }}
        >
          <div
            ref={footerRef}
            className={`iw-nightable iw-touch-guard iw-toolbar-outline pointer-events-auto flex flex-col bg-white shadow-sm ${barsAnimating ? 'overflow-hidden' : ''} ${isTouch ? 'w-full' : ''}`}
            style={{
              // ── ⚠ ONE BUDGET, TWO CONSUMERS. `--iw-bar-budget` is the maximum width the toolbar
              // may occupy, and BOTH this box's max-width and the per-circle shrink clamp in
              // index.css derive from it — they cannot disagree, because there is only one of them.
              // Capping only the box leaves the circles spilling past the rounded border; capping
              // neither lets the centred pill grow into the edge-anchored sync pill below ~650px.
              // ⚠ Divided by the transform scale, because max-width is a LAYOUT property while the
              // collision happens in PAINTED px. Sweep the WIDTH RANGE when testing this: it is
              // invisible above ~700px. → docs/archive/editor-surface.md#editor-side-reserve
              ...(isTouch ? {} : {
                ['--iw-bar-budget' as string]: `calc((100vw - ${TOOLBAR_SIDE_RESERVE_PX * 2}px) / ${(zoom * 1.12).toFixed(4)})`,
                maxWidth: 'var(--iw-bar-budget)',
              }),
              border: '1px solid var(--iw-nightable-border, rgb(var(--iw-ink-rgb) / 0.75))',
              borderRadius: isTouch ? '15px 15px 0 0' : '15px',
              opacity: barVisible ? 1 : 0,
              pointerEvents: barVisible ? 'auto' : 'none',
              transition: 'opacity 160ms ease',
              // Counter browser zoom so the pill stays a constant physical size. TRANSFORM, never
              // `zoom`: zoom scales the positioned `bottom` offset and the pill drifts. ×1.12 is
              // the "bigger pills" boost, desktop ONLY — the phone bar is w-full and would clip.
              transform: `scale(${zoom * (isTouch ? 1 : 1.12)})`,
              transformOrigin: 'bottom center',
            }}
          >
            {/* Style bar — animates down/up; max-height:0 collapses it without removing from DOM.
                Auto-expands on phone text-selection even when the main toolbar row is hidden. */}
            {(showMainRow || selectionOnPhone || selectionOnDesktop) && (
              <div style={{
                overflow: 'hidden',
                maxHeight: styleBarExpanded ? '60px' : '0',
                opacity: styleBarExpanded ? 1 : 0,
                pointerEvents: styleBarExpanded ? 'auto' : 'none',
                transition: 'max-height 220ms ease, opacity 160ms ease',
                // ⚠ A COLLAPSED ROW STILL HAS A WIDTH — the real cause of the toolbar's proportions
                // repeatedly drifting back. `max-height: 0` hides this row but leaves it in the
                // pill's WIDTH calculation, and the pill is a flex COLUMN sized by its widest
                // child, so the invisible style bar was sizing it (86px of dead pill past the last
                // circle). `width: 0; min-width: 100%` drops the contribution while collapsed
                // without breaking the layout when it expands.
                ...(styleBarExpanded ? {} : { width: 0, minWidth: '100%' }),
              }}>
                {/* Phone: slim side padding — nine 38px circles + the font/size pills need the room */}
                <div className={`flex items-center ${isTouch ? 'px-1.5' : 'px-4'} py-2 border-b border-stone-200`}>
                  {editor && <StyleBar editor={editor} onActivity={armStyleTimer} phone={isTouch} barVisible={styleBarExpanded} />}
                </div>
              </div>
            )}

            {/* Review row — stacks ABOVE the main toolbar (like the style bar): the pill is
                bottom-anchored, so this grows upward and the main row never moves. */}
            {editor && (
              <div style={{
                overflow: 'hidden',
                maxHeight: reviewOpen ? '60px' : '0',
                opacity: reviewOpen ? 1 : 0,
                pointerEvents: reviewOpen ? 'auto' : 'none',
                transition: 'max-height 220ms ease, opacity 160ms ease',
              }}>
                {reviewOpen && <ReviewBar editor={editor} phone={isTouch} />}
              </div>
            )}

            {/* Music row — the second-bar layer the music slot opens, MUTUALLY EXCLUSIVE with the
                style/review rows by the TYPE (`activeBar` holds ONE id — toolbarContract.ts). */}
            {musicEnabled() && (
              <div style={{
                overflow: 'hidden',
                maxHeight: activeBar === 'music' ? '60px' : '0',
                opacity: activeBar === 'music' ? 1 : 0,
                pointerEvents: activeBar === 'music' ? 'auto' : 'none',
                transition: 'max-height 220ms ease, opacity 160ms ease',
              }}>
                {activeBar === 'music' && <MusicBar phone={isTouch} documentId={doc.id} mediaAssets={doc.media ?? []} />}
              </div>
            )}

            {/* Main toolbar row. Phone: `iw-phone-toolbar` (index.css) sizes the circles from
                --iw-row-slots and caps each button's 44px min-WIDTH at the same size; the footer RO
                mirrors whatever height results into --iw-toolbar-h + the PM scroll reserve, so
                NEVER hardcode the pill height anywhere. */}
            {showMainRow && (
            <div className={`iw-toolbar-circles flex items-center ${isTouch ? 'iw-phone-toolbar justify-between px-0 py-1.5' : 'iw-desktop-toolbar'} ${slotDragView || popupDragActive ? 'iw-slot-dragging' : ''}`}
              // ⚠ ONE ROW SIZE, DERIVED FROM THE ROW ITSELF (R2). index.css once divided by a
              // literal 8 — a second copy of ROW_SLOTS in another language — and this then fed it
              // the static constant rather than the live length, so a seventh slot left exactly one
              // circle's width unaccounted for and the ⋮ hung off the right. `toolbarSlots.length`
              // is the exact array rendered below, so it cannot drift from what is on screen.
              // → docs/archive/editor-surface.md#editor-row-slots
              style={{ ['--iw-row-slots' as string]: String(toolbarSlots.length) }}
              onClickCapture={(e) => {
                // A click synthesised from a just-finished touch-hold drag must not activate the
                // dropped button (or close the bars) — swallow it here in the capture phase.
                if (Date.now() < suppressSlotClickUntilRef.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  return
                }
                // Any toolbar button closes the style + review bars — except each bar's own toggle
                // (its onClick still runs after this capture, so its toggle semantics survive).
                const b = (e.target as HTMLElement).closest('button')
                if (!b) return
                if (b.dataset.iwBar) return // S/R toggles own their sequencing (toggleBar) — don't pre-close
                setActiveBar(null); clearStyleTimer()
              }}>
              {/* ▲-in-circle: manage toolbar slots — thin popup shows only the off-toolbar buttons */}
              <div className="relative" ref={toolbarPickerRef}>
                <button type="button"
                  onClick={() => { setToolbarPickerOpen(o => !o); closeBarLayer('style') }}
                  className={`flex items-center justify-center ${isTouch ? '' : 'min-w-[44px]'} min-h-[44px] transition-colors font-serif ${toolbarPickerOpen ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
                  title="Customise toolbar"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current">
                    <svg viewBox="0 0 16 17" width="15" height="15" fill="currentColor" aria-hidden="true">
                      <path d="M8 1.5 L14.5 15 Q8 11.5 1.5 15 Z" />
                    </svg>
                  </span>
                </button>
                {(() => {
                  const available = overflowSlots(toolbarSlots)
                  return (
                    <div className={`absolute bottom-full left-0 mb-2 bg-white shadow-md rounded-xl flex items-center z-[120] ${toolbarPickerOpen ? '' : 'invisible pointer-events-none'}`}
                      style={{ border: '1px solid rgb(var(--iw-ink-rgb) / 0.75)' }}
                      onMouseDown={e => e.stopPropagation()}>
                      {/* + add more opps */}
                      <div className="flex items-center">
                        <button type="button"
                          onClick={() => setOppsOpen(o => !o)}
                          className="flex items-center justify-center min-w-[44px] min-h-[44px] text-stone-400 hover:text-[#302438] transition-colors"
                          title="More options coming">
                          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-base leading-none">+</span>
                        </button>
                        {oppsOpen && createPortal(
                          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 font-serif" onMouseDown={() => setOppsOpen(false)}>
                            <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
                            <div className="relative iw-nightable bg-white rounded-2xl shadow-xl px-12 py-10 text-center" style={{ border: `1px solid ${INK}bf` }} onMouseDown={e => e.stopPropagation()}>
                              <p className="text-2xl" style={{ color: INK }}>New features coming soon</p>
                              <p className="mt-6 text-stone-400 italic">~ The Developer</p>
                            </div>
                          </div>,
                          document.body,
                        )}
                      </div>
                      {/* Phone-only: ◈ provenance/snapshots — moved here from the main row
                          (Peter 2026-07-11: fewer circles, more breathing room). */}
                      {isTouch && (
                        <>
                          <div className="w-px h-6 bg-stone-100 mx-1" />
                          <button type="button"
                            onClick={() => { setReceiptOpen(o => !o); setToolbarPickerOpen(false) }}
                            className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                            style={{ color: '#302438' }}
                            title="Provenance record — snapshots"
                          >
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgb(var(--iw-ink-rgb) / 0.75)] text-sm">◈</span>
                          </button>
                        </>
                      )}
                      {/* Phone-only: ☁ sync in the popup (hideable from main toolbar) */}
                      {isTouch && (fileSaveAvailable() || gdriveActive || oneDriveConfigured()) && (
                        <>
                          <div className="w-px h-6 bg-stone-100 mx-1" />
                          <button type="button"
                            onClick={() => { setSyncOpen(o => !o); setToolbarPickerOpen(false) }}
                            className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                            style={{ color: (fileSaveAvailable() ? !!lastFileSave && !needsReconnect : gdriveActive ? !!lastGdriveSync : !!lastSync) ? '#6b7280' : '#b45309' }}
                            title="Sync status">
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgb(var(--iw-ink-rgb) / 0.5)] text-base">☁</span>
                          </button>
                        </>
                      )}
                      {/* divider if there are available slots */}
                      {available.length > 0 && <div className="w-px h-6 bg-stone-100 mx-1" />}
                      {available.map(id => (
                        <div key={id}
                          className="iw-slot"
                          draggable={!isTouch}
                          onDragStart={() => { dragIdRef.current = id }}
                          onDragEnd={() => { dragIdRef.current = null }}
                          onClick={() => setToolbarPickerOpen(false)}
                          {...(isTouch ? popupTouchHandlers(id) : {})}
                          style={isTouch ? { touchAction: 'none' } : undefined}
                        >
                          {renderSlotButton(id, false)}
                        </div>
                      ))}
                    </div>
                  )
                })()}</div>
              {/* Customisable slots — desktop: HTML5 drag between slots or from the ▲ popup;
                  phone: touch-hold a circle to arm, drag sideways, neighbours FLIP-slide out of
                  the way (slotDragView preview), release to drop (see slotTouchHandlers above). */}
              {toolbarSlots.map((slotId, slotIdx) => (
                <div key={slotId}
                  className="iw-slot relative"
                  ref={el => { slotElsRef.current[slotIdx] = el }}
                  draggable={!isTouch}
                  onDragStart={() => { dragIdRef.current = slotId }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const from = dragIdRef.current; dragIdRef.current = null
                    if (!from || from === slotId) return
                    const newSlots = [...toolbarSlots]
                    const fromIdx = newSlots.indexOf(from as SlotId)
                    if (fromIdx >= 0) newSlots[fromIdx] = slotId  // swap: put old slot where new slot was
                    newSlots[slotIdx] = from as SlotId
                    updateSlots(newSlots)
                    setToolbarPickerOpen(false)
                  }}
                  onDragEnd={() => { dragIdRef.current = null }}
                  {...(isTouch ? slotTouchHandlers(slotIdx) : {})}
                  style={isTouch ? (() => {
                    // touch-action:none is per-element (it does NOT inherit) — required so the
                    // armed drag owns the gesture. Neighbour preview: transform-only FLIP slide;
                    // the transition is dropped the instant the drag ends so the commit's
                    // layout-reorder + transform-reset land as one motionless frame.
                    const base: React.CSSProperties = { touchAction: 'none' }
                    if (slotDragView && slotIdx !== slotDragView.fromIdx) {
                      const shift = neighborShift(slotIdx, slotDragView.fromIdx, slotDragView.overIdx) * slotDragView.step
                      base.transform = `translateX(${shift}px)`
                      base.transition = 'transform 180ms ease'
                    } else if (popupDragTarget === slotIdx) {
                      // A ▲-menu entry hovers this slot: it will be displaced back into the
                      // pool — shrink/dim as the drop preview.
                      base.transform = 'scale(0.72)'
                      base.opacity = 0.45
                      base.transition = 'transform 150ms ease, opacity 150ms ease'
                    }
                    return base
                  })() : undefined}
                >
                  {renderSlotButton(slotId, true)}
                  {/* HOTKEY TEACHING — the hint appears only while Alt is held, which is the
                      moment of intent: reach for the modifier and the row tells you its numbers.
                      Calm, not loud (Peter: "sexy = considered"), and desktop-only — a phone has
                      no Alt, renders nothing, and loses nothing. Pointer-events-none so it can
                      never eat the tap it is advertising. */}
                  {altHeld && !isTouch && hotkeyHintFor(slotIdx) && (
                    <span
                      aria-hidden="true"
                      className="absolute pointer-events-none flex items-center justify-center rounded-full"
                      style={{
                        top: -1, right: -1, width: 15, height: 15, fontSize: 10, lineHeight: 1,
                        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                        background: 'var(--iw-ink, #302438)',
                        color: 'var(--iw-hotkey-hint-fg, #fff)',
                      }}
                    >
                      {hotkeyHintFor(slotIdx)}
                    </span>
                  )}
                </div>
              ))}
              <OptionsMenu
                paperRight={paperRight}
                installPrompt={installPrompt}
                onExportBundle={exportBundle}
                onSave={saveRecord}
                onSaveAs={fileSaveAvailable() ? saveAsFile : undefined}
                folderAvailable={fileSaveAvailable()}
                folderName={fileName}
                onSyncOneDrive={oneDriveConfigured() ? syncOneDrive : undefined}
                onChooseOneDriveFolder={chooseOneDriveFolder}
                onSaveAsOneDrive={oneDriveConfigured() ? saveAsOneDrive : undefined}
                oneDriveAccount={oneDriveAcct}
                onSyncGoogleDrive={googleDriveConfigured() ? syncGoogleDrive : undefined}
                onSaveAsGoogleDrive={googleDriveConfigured() ? saveAsGoogleDrive : undefined}
                onChooseGoogleDriveFolder={googleDriveConfigured() ? chooseGoogleDriveFolder : undefined}
                onUploadGoogleDrive={googleDriveConfigured() ? uploadFromGoogleDrive : undefined}
                onUploadOneDrive={oneDriveConfigured() ? uploadFromOneDrive : undefined}
                onPrint={printDoc}
                onExportPdf={exportPdf}
                onExportLatex={exportLatex}
                onExportEquations={exportEquations}
                googleDriveActive={gdriveActive}
                onVerifyRecord={() => setVerifyOpen(true)}
                onWorkReport={reportFlag ? () => setReportOpen(true) : undefined}
                onFileOpenError={reportOpenError}
              />
              <InstallPromptBanner installPrompt={installPrompt} />
            </div>
            )}

          </div>
        </div>
        {verifyOpen && (
          <VerifyModal
            doc={docRef.current}
            onClose={() => setVerifyOpen(false)}
          />
        )}
        {reportOpen && (
          // fallback={null}: the writer opened a modal, and a flash of placeholder chrome is worse
          // than the modal appearing when its chunk lands.
          <Suspense fallback={null}>
            <ProductivityReportModal onClose={() => setReportOpen(false)} />
          </Suspense>
        )}
        {editor && <CiteAutocomplete editor={editor} />}
        <PdfSidePanel />
        <Toast />
        {bibPanelOpen && editor && (
          <CitationPanel
            editor={editor}
            citationStyle={citationStyle}
            btnRef={bibBtnRef}
            initialCapture={shareCapture}
            onInitialCaptureConsumed={() => setShareCapture(null)}
            onStyleChange={s => {
              setCitationStyle(s)
              setCitationStyleBus(s)
              const updated = { ...docRef.current, citationStyle: s, updatedAt: new Date().toISOString() }
              commitDoc(updated)
            }}
            onClose={() => setBibPanelOpen(false)}
          />
        )}
      </div>
    </ComplianceContext.Provider>
  )
}

// Task #28: keydown-synchronous typing flag — 'inkwave:kdSync' = '1'/'0'; unset defaults to ON
// for mouse/keyboard devices and OFF on touch (never intercept the virtual keyboard/autocorrect).
// Cached at first read (it's on the per-keystroke path); toggling requires a reload.
let _kdSync: boolean | null = null
function kdSyncEnabled(): boolean {
  if (_kdSync !== null) return _kdSync
  try {
    const v = window.localStorage.getItem('inkwave:kdSync')
    _kdSync = v === null ? !isTouchDevice() : v === '1'
  } catch { _kdSync = false }
  return _kdSync
}


const INK = '#302438'
