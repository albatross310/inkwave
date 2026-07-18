import { lazy, Suspense, useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useZoomScale } from './useZoomScale'
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
import { syncReviewVisibilityStyles } from './review/reviewState'
import { CommentNotes } from '../components/CommentNotes'
import { ReviewBar } from '../components/ReviewBar'
import { Scroll, isTouchDevice } from './Scroll'
import { textRenderEnabled } from './textRenderFlag'
import { createDock } from './toolbarDock'
import { moveSlot, nearestSlot, neighborShift } from './toolbarSlots'
import {
  SlotId, BarLayerId, BAR_HANDOFF_MS, ROW_SLOTS,
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
import { createSnapshotIfChanged, readSnapshotArchive, toSnapshotMeta, deleteSnapshot, stampSnapshot, drainUnstamped, upgradePending, patchSnapshotSummary, patchSnapshotDiffSummary } from '../provenance/snapshots'
import { summariseParagraph, summariseBullets, summariseDiff } from '../provenance/summarise'
import { ReceiptPanel } from '../components/ReceiptPanel'
import { EmailComposePanel } from '../components/EmailComposePanel'
import { emailEnabled } from '../email/flag'
import { titleForEmail } from '../email/newEmail'
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
// LAZY, AND IT MUST STAY LAZY (2026-07-17). A static import here put the whole report lane —
// the modal, report/compile.ts and its prompt strings — inside THIS chunk, which every writer
// loads, with the flag off and no chunk of its own to show for it. `{reportOpen && <Modal/>}` is a
// RENDER guard and `if (reportFlag)` is a RUNTIME guard; neither can stop the bundler. flag.ts's
// "ZERO load-path cost … neither panel is imported unless asked for" was measured false in the
// built output while that comment sat two lines above the flag it described. Verify in
// `react-router build` output, never in the source: a separate chunk file is NOT evidence of
// laziness (fixtures had its own chunk and was still statically imported, hence preloaded).
const ProductivityReportModal = lazy(() =>
  import('../components/ProductivityReportModal').then(m => ({ default: m.ProductivityReportModal })),
)
import { prodReportEnabled } from '../productivity/flag'
import { SettingsMenu } from '../components/SettingsMenu'
import { MediaMenu } from '../components/MediaMenu'
import { ClockSlotButton, LedgerDropUp } from '../components/ClockMenu'
import { CountdownOverlay } from '../components/CountdownOverlay'
import { MusicBar } from '../components/MusicBar'
import { musicEnabled } from '../music/flag'
import { PageMenu } from '../components/PageMenu'
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
import { verifyChain, signingPublicKeyHex } from '../provenance/receipts'
import type { Snapshot, SnapshotMeta, SignedReceipt, WordNudgeEvent } from '../types/document'

// No wall-clock resample timer — S_v rotation and receipt signing happen on word nudge only.
// This keeps the green/red word set stable between nudges and avoids spurious receipts.

// ─── Toolbar slot customisation ───
// The population, the row size, the migration and the bar-layer exclusion all live in ONE place:
// `editor/toolbarContract.ts`. They are NOT re-declared here. Three lanes take toolbar real
// estate at once (feat/prod-ledger, feat/music-piece-photo, feat/music-musicxml) and this
// codebase's recurring wound is two implementations of one rule — so a lane registers a button by
// adding a member to SlotId + ALL_SLOTS there, and gets the row, the ▲ overflow, the drag-to-swap
// and the migration for free. Read that file before adding anything to this one.

interface TiptapEditorProps {
  doc: InkwaveDocument
  onDocChange: (updated: InkwaveDocument) => void
}

export function TiptapEditor({ doc, onDocChange }: TiptapEditorProps) {
  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])


  // Mirror the saved cross-out mode onto the document root so the memory cross-out CSS applies.
  useEffect(() => { applyCrossoutMode() }, [])

  // Realise the persisted review-visibility state (global show/hide + hidden layers) on boot —
  // a hidden layer must stay hidden across reloads even before the review bar is ever opened.
  useEffect(() => { syncReviewVisibilityStyles() }, [])

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
  // A slow tick, and ONLY while a warning is actually pending: nothing to re-render once sync is
  // live, dismissed, or before the first unsynced edit. (The reducer returns its input unchanged on
  // a no-op edit, so useReducer bails out and typing never re-renders the shell — the
  // console-snappy rule.)
  // PROBE SEAM (the `__iwRasterDprCap` / `__iwAnchorRule` pattern): shorten the threshold so the
  // wiring can be DRIVEN and observed in a live browser instead of waiting five real minutes — a
  // feature whose only proof is "the rule is unit-tested" is a feature nobody has ever seen fire.
  // Undefined in every real session ⇒ the constant in unsyncedWatch.ts applies.
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
  // Flag-gated (`?prodReport=1`, default OFF) — the free paste-back work report (§A7.1, Path 1).
  const [reportOpen, setReportOpen] = useState(false)
  const reportFlag = prodReportEnabled()
  // Dynamic: demo.ts statically pulls fixtures.ts (2.8KB gzip of synthetic prose that ONLY
  // `?prodReport=demo` ever reads). As a static import it rode into the editor chunk and was
  // preloaded from home-*.js for every writer, flag off.
  useEffect(() => {
    if (!reportFlag) return
    void import('../productivity/demo').then(m => m.installProdReportDemo())
  }, [reportFlag])
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
    docRef.current = updated
    onDocChange(updated)
    scheduleSave(updated)
  }

  const toolbarSlotsRef = useRef<SlotId[]>(toolbarSlots)
  useEffect(() => { toolbarSlotsRef.current = toolbarSlots }, [toolbarSlots])

  const dragIdRef = useRef<SlotId | null>(null)

  // ─── Phone: touch-hold drag-to-reorder for the row's slot circles ──────────
  // HTML5 drag events never fire from touch in this UI (and the iOS long-press guards
  // deliberately swallow the native gestures), so phone reorder is hand-rolled: hold a
  // circle ~400ms → it arms (scale-up pulse = the haptic-feel cue), drag horizontally →
  // neighbours FLIP-slide out of the way (transform-only, 180ms) previewing the drop,
  // release → the order commits + persists. Coexists with the guards: .iw-touch-guard
  // suppresses selection/loupe, the slot wrappers get touch-action:none (per-element —
  // it doesn't inherit), and the post-drop synthetic click is swallowed.
  const HOLD_MS = 400
  const slotElsRef = useRef<(HTMLDivElement | null)[]>([])

  // ─── Hotkeys: Alt+1…6 = the row, Alt+0 = the ▲ drawer, Mod+, = Settings ────
  // THE HOTKEY IS THE TAP. It dispatches the slot's OWN button click rather than calling the
  // slot's action, and that is deliberate: every slot owns its open state privately (GuideMenu,
  // PageMenu, MediaMenu, SettingsMenu, ClockSlotButton all differ), so an "action registry" would
  // mean a SECOND way to trigger each one — two roads that drift the first time a slot changes
  // what its tap does. Routing through the real button makes divergence unrepresentable: the
  // keyboard and the finger are the same event, by construction.
  // `altHeld` shows the hints. It flips only on Alt's own down/up — never per keystroke — and the
  // ref guard stops key-repeat from setting state 30×/second while Alt is held.
  const [altHeld, setAltHeld] = useState(false)
  const altHeldRef = useRef(false)
  useEffect(() => {
    if (isTouchDevice()) return   // no Alt on a phone; render no hints and bind nothing
    const setAlt = (v: boolean) => {
      if (altHeldRef.current === v) return
      altHeldRef.current = v
      setAltHeld(v)
    }
    const clickSlot = (el: HTMLElement | null | undefined) => {
      const btn = el?.querySelector('button')
      if (btn) { btn.click(); return true }
      return false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setAlt(true)
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
    const onKeyUp = (e: KeyboardEvent) => { if (!e.altKey) setAlt(false) }
    // Alt+Tab away with Alt down and the keyup never arrives — the hints would latch on forever.
    const onBlur = () => setAlt(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
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
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { clearTimeout(st.timer); slotDragRef.current = null }
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
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { clearTimeout(st.timer); popupDragRef.current = null }
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
  // The exclusion RULE is pure and lives in toolbarContract.ts (planBarToggle, swept over every
  // (active, which) pair by its tests). This function is only its hands: it does the timing, the
  // sequence guard and the style bar's idle timer. Adding a layer changes NOTHING here.
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
    // RE-RENDER STORM FIX (2026-07-11, the ablation's #1 keystroke cost): @tiptap/react's legacy
    // default re-renders the OWNING component on EVERY transaction — every keystroke, caret move,
    // SCAS repaint and pagination meta re-ran this whole ~2,500-line tree (footer, panels, menus).
    // With it off, re-renders happen only when React state actually changes. Everything the render
    // body used to read live off editor.state is mirrored into state by the selection-tracking
    // effect below (selectionEmpty + selIsAtomNode); StyleBar/ReviewBar self-subscribe.
    shouldRerenderOnTransaction: false,
    // THE ONE EXTENSION LIST — moved verbatim to extensions/editorExtensions.ts so /snapshot, which
    // has no editor, can build the SAME schema and turn a version's contentJson into a real PM Node
    // (the plaintext renderer's blocker). Same entries, same order, same configure() args; this call
    // returns a fresh array per render exactly as the inline literal did. A schema-only COPY of the
    // list was rejected — two lists is how the model drifts from what the editor paginates.
    extensions: buildEditorExtensions({
      getDoc: () => docRef.current,
      getHintState: () => hintStateRef.current,
      getScasLookup: () => scasRef.current!.lookup(),
    }),
    content: doc.contentJson,
    // DOUBLE-MOUNT NOTE (2026-07-11): this component must mount in a default-lane render — NOT a
    // time-sliced one (lazy/Suspense retry). useEditor's in-render creation + its 1ms
    // scheduleDestroy safety timer otherwise race across the slices: two full editor creations
    // and a doubled reveal chain per load. Edit.tsx holds the resolved module in state (no
    // Suspense) precisely for this — see the note there before changing how this mounts.
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        'data-placeholder': 'Begin writing…',
        spellcheck: 'false',
      },
      // ── Task #28: keydown-synchronous typing (flag: inkwave:kdSync; desktop default ON,
      // touch default OFF — the virtual keyboard's native path + autocorrect must never be
      // intercepted). Plain printable keys dispatch their ProseMirror transaction synchronously
      // IN the keydown task, so the character paints in the SAME frame — instead of the native
      // route (browser mutates the DOM → PM's MutationObserver reconciles a task later).
      // handleTextInput runs first, exactly like the native path, so input rules (smart quotes,
      // math shortcuts, citation triggers) behave identically. Backspace/Enter are already
      // keydown-synchronous via the keymaps. Guards: no modifiers (shift ok), no IME
      // composition, no open word-cycle (it owns j/k/space/tab), text selections only.
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
      // ── Insignia (paid): keystroke-cadence tap ───────────────────────────────
      // Fold this transaction's steps into the current 0.5s cadence bin. Counts only — never chars.
      // Inert for the free tier (cadenceTierActive() false → tap never created).
      if (cadenceTierActive()) {
        if (!cadenceTapRef.current) cadenceTapRef.current = new CadenceTap()
        cadenceTapRef.current.record(transaction.steps)
      }

      // ── Productivity ledger: session capture (spec §A4) ──────────────────────
      // Rides the SAME stream, derives counts from the SAME countSteps primitive — no new content
      // instrumentation. O(steps): it compares two numbers and increments three fields. Every
      // O(doc) number the ledger needs is computed at session CLOSE, off this path. Flag default
      // OFF and cached in a module variable, so the disabled cost is one boolean test.
      if (prodLedgerEnabled()) getCapture().record(transaction.steps)

      // ── SCAS tick (deferred): CONSOLE-SNAPPY RULE — a keystroke does no O(doc) work. ──────────
      // The engine scan (processDoc walks every committed word) and the decoration rebuild both
      // move to ONE debounced tick ~120ms after the last input; the decoration plugin meanwhile
      // just position-maps its existing marks through each edit (see RedHighlightExtension.apply).
      // Deletion tracking accumulates across the debounce window so the lock-on-delete rule still
      // sees every deletion. The tick's own repaint transaction carries SCAS_HINT_META → never re-arms.
      if (!transaction.getMeta(SCAS_HINT_META) && (transaction.docChanged || transaction.selectionSet)) {
        if (transaction.docChanged) {
          const size = e.state.doc.content.size
          if (prevDocSizeRef.current >= 0 && size < prevDocSizeRef.current) scasHadDeletionRef.current = true
          prevDocSizeRef.current = size
          // SCAN WINDOW bookkeeping (phone): accumulate WHERE this debounce window's edits landed,
          // in current-doc coordinates — map the running range and the last-tick caret through this
          // edit, then union this transaction's own changed range (each step's new range, mapped
          // through the steps after it). The tick below hands the union to processDoc so the scan
          // is O(window), not O(doc). Cost here is O(steps) per keystroke — no doc walks.
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
        // ENGINE KILL SWITCH (diagnostic/benchmark only): inkwave:scasEngineOff='1' disables the whole
        // SCAS tick (scan + decorations). NB the USER's "SCAS suggestions" toggle (inkwave:scasOff) is
        // a separate DISPLAY-only flag and must NOT stop the tick — the words stay remembered.
        if (scasEngineOffRef.current) return
        // PHONE: the tick's engine scan + decoration rebuild is O(doc) — ~7ms/10k words in Node,
        // several × slower on a phone CPU (tens of ms on a thesis-length doc), and at 120ms it
        // landed between keystrokes during normal typing. 250ms keeps it in genuine gaps; verdicts
        // freeze at commit anyway, so a later repaint changes nothing semantically. Desktop stays 120.
        scasTickTimerRef.current = setTimeout(function tick() {
          if (e.isDestroyed) return
          // ZOOM-GESTURE DEFERRAL (Peter, 2026-07-10 "lag in the reflow zoom"): the tick's engine
          // scan + decoration rebuild is the heaviest non-visual work that can land mid-gesture —
          // and a decoration repaint REBUILDS paragraph DOM, which detaches an active pinch's
          // touch target (iOS keeps dispatching to the original node → the gesture dies). While a
          // zoom gesture holds the painters (__iwZoomHold, cleared at settle), park the tick and
          // retry — it flushes ≤150ms after the settle. Verdicts freeze at commit anyway, so a
          // deferred repaint changes nothing semantically.
          if ((window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) {
            scasTickTimerRef.current = setTimeout(tick, 150)
            return
          }
          const tickT0 = performance.now()
          const hadDeletion = scasHadDeletionRef.current
          scasHadDeletionRef.current = false
          // WINDOWED TICK (phone 2026-07-10; desktop joined 2026-07-11 — the tick's O(doc) scan +
          // decoration rebuild at the 120ms cadence was part of the desktop "waves of lag"): scan
          // only where this tick's edits/caret moves happened — the window = accumulated edit
          // range ∪ last-tick caret ∪ current caret (a word commits when the caret LEAVES it, so
          // both caret paragraphs must be scanned). Full scan stays for: any tick with a DELETION
          // (the engine's vanished-lemma pass needs whole-doc word presence — the phantom-snapshot
          // guard), and the decoration repaint whenever the tick DID change state (a verdict
          // change repaints every instance of that lemma doc-wide). Windowed ≡ full equivalence is
          // unit-pinned in scas/controller.window.test.ts + extensions/redHighlightWindow.test.ts.
          const caretNow = e.state.selection.from
          const acc = scasWinRef.current
          scasWinRef.current = null
          const lastCaret = scasLastCaretRef.current
          scasLastCaretRef.current = caretNow
          // Deletion ticks are windowed too (round-4 "deleting lags in waves"): the controller's
          // whole-doc presence INDEX answers the vanished-lemma pass, so the scan never needs to
          // leave the window.
          const win = {
            from: Math.min(acc ? acc.from : caretNow, caretNow, lastCaret),
            to: Math.max(acc ? acc.to : caretNow, caretNow, lastCaret),
          }
          const stateChanged = scasRef.current!.processDoc(e.state.doc, caretNow, hadDeletion, win)
          // Always repaint: the deferred decorations need it after edits, and it refreshes the
          // cursor-word suppression after pure caret moves. Windowed splice only when nothing
          // outside the window can differ (no state change, no open popover) — else full rebuild.
          const meta = win && !stateChanged && hintStateRef.current.focusedPos === null
            ? { window: win } : true
          e.view.dispatch(e.state.tr.setMeta(SCAS_HINT_META, meta))
          notePerf('scas-tick', performance.now() - tickT0)
        }, isTouchDevice() ? 250 : 120)
      }

      // Paragraph index feeds the thesaurus popover — must track SELECTION moves too (clicking into
      // a paragraph), so it stays above the docChanged gate. O(blocks-before-caret) walk (return
      // false at each textblock so it never descends into inline content); React bails on same value.
      const { $from } = e.state.selection
      let pIdx = 0
      e.state.doc.nodesBetween(0, $from.pos, (node) => {
        if (node.type.name === 'paragraph') { pIdx++; return false }
        return !node.isTextblock // headings etc.: nothing inside a textblock can be a paragraph
      })
      setCurrentParagraphIndex(Math.max(0, pIdx - 1))

      // ── docChanged gate (THE typing-lag fix) ─────────────────────────────────
      // Everything below serializes the document / re-renders the shell — and this handler fires for
      // EVERY transaction: caret moves, the SCAS hint repaint above, and the pagination extension's
      // two per-keystroke meta dispatches. Paying full-doc getJSON + a React re-render + an IndexedDB
      // write up to 3× per keystroke was the dominant lag source. Selection-only transactions stop here.
      if (!transaction.docChanged) return

      // CONSOLE-SNAPPY RULE: no serialization on the keystroke either. The document object is
      // rebuilt lazily (ensureDocFresh: getJSON + title + bibliography) at the first point that
      // actually needs it — the 200ms save beat, any snapshot/signing work, or a mirror. The beat
      // stays data-only; the shell re-renders only when the title changed.
      docStaleRef.current = true
      // Peter's 5-minute unsynced clock: only a change the WRITER caused counts (see the arming
      // effect below). The reducer returns its input unchanged once started or while sync is live,
      // so useReducer bails and this costs nothing per keystroke.
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

      // ── Paragraph snapshot: fire when Enter creates a new top-level paragraph ──
      // (Already behind the docChanged gate above.) Cheap top-level count first; only collect the
      // paragraph TEXTS when the count actually grew by one — the full textContent collection on
      // every keystroke was an O(doc) walk for a check that's almost always false.
      {
        let paraCount = 0
        e.state.doc.forEach((node) => { if (node.type.name === 'paragraph') paraCount++ })
        const prev = prevParaCountRef.current
        prevParaCountRef.current = paraCount

        // Only trigger on a single new paragraph (Enter key, not paste of multiple blocks).
        if (paraCount === prev + 1 && pIdx >= 2) {
          // ONLY the completed paragraph's text (round-4 Enter "mega lag": collecting EVERY
          // paragraph's textContent was an O(doc) string build ON the Enter keystroke).
          // pIdx-1 is the 0-based current (new empty) paragraph; pIdx-2 is the just-completed one.
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

            // Round-4 Enter "mega lag" (b): the snapshot chain (ensureDocFresh getJSON +
            // JCS canonicalize + hash + OPFS write + OTS stamp) started right on the Enter
            // keystroke. Defer it to a GENUINE input pause — content is captured at WORK time
            // (enqueueSnapshotWork always ran ensureDocFresh at work time, so the capture-drift
            // semantics are unchanged in kind); the buffer bookkeeping below stays synchronous
            // so Enter ordering is deterministic.
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

  // ── Productivity ledger: bind the doc + close sessions at real boundaries (§A4) ──
  // Binding takes the document's word baseline ONCE per open (an O(doc) count, off the keystroke
  // path) — that baseline is what makes a session's words_start free. A doc switch closes the
  // outgoing session; `visibilitychange → hidden` closes and flushes while the page is still alive
  // (pagehide is too late to do async work reliably, and a backgrounded tab throttles timers).
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


  // Detect the on-screen keyboard from the visual viewport: when it's up, the visible height
  // drops well below the LARGEST height seen (its no-keyboard height). Comparing to the
  // tracked max — rather than to window.innerHeight — is robust to iOS quirks where
  // innerHeight tracks the keyboard, and we ignore offsetTop (a scroll offset, not the
  // keyboard) so page scroll doesn't fool it. 150px threshold ignores URL-bar resizes.
  const kbMaxRef = useRef(0)
  useEffect(() => {
    // Soft keyboards only exist on touch devices. On desktop, browser ZOOM (Ctrl +/−) also shrinks
    // visualViewport.height — which would falsely read as "keyboard up" and hide the snapshot/sync
    // pills (and skew the baseline so they never return). So only run this on touch; pinch-zoom on
    // touch is filtered via visualViewport.scale below.
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
  // Mirror keyboardUp to a window flag so non-React code can read it — PaginationExtension's phone
  // edit debounce stretches while the keyboard is up (reflow mid-composition is worthless).
  useEffect(() => {
    ;(window as unknown as { __iwKeyboardUp?: boolean }).__iwKeyboardUp = keyboardUp
  }, [keyboardUp])

  // PHONE: the footer toolbar HUGS the keyboard instead of retracting — pinned flush to the visual
  // viewport's bottom edge (keyboard top / URL bar) at ALL times. iOS never resizes the layout
  // viewport for the keyboard, and scrolling with the keyboard up PANS the visual viewport within
  // it — during which WebKit composites the pan WITHOUT re-running layout, so writing a layout
  // property (the old `bottom`) left the bar drifting anywhere the pan took it ("all over the
  // shop"). The dock (editor/toolbarDock.ts) instead slaves a compositor-path transform:
  // translateY(-off) on the fixed wrapper, one write per frame while the geometry moves (rAF
  // follow loop — vv events are sparse mid-slide and unreliable in momentum tails), parked once
  // stable. --iw-kb-offset still carries the same value for the scroll-padding reserve (outside
  // React, so re-renders never clobber it).
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
        // Rubber-band detection: during elastic overscroll fixed elements ride the elastic
        // layout viewport and vv geometry goes garbage — the dock freezes (see toolbarDock.ts).
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
          // KEYBOARD-SLIDE CHASE (Peter round 2, nice-to-have): iOS reports the keyboard's
          // final geometry in one/few big resize steps — a raw write teleports the bar. A
          // LARGE jump gets a short ease-out transition (transform-only; CSS retargets
          // smoothly if another step lands mid-glide), so the bar visually chases the slide.
          // Small per-frame follow deltas (pans, momentum) stay immediate — never transition
          // those, the compositor tracking IS the mechanism.
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
        // TAP-REVEAL (Peter round 2: "revealed the moment you tap, not on the first key"):
        // iOS runs its OWN focus pan AFTER the keyboard geometry settles, which can re-park
        // the caret just above the keyboard but BEHIND the pill. Two delayed no-op-guarded
        // passes (keepCaret only scrolls when actually obstructed >4px — the single-reveal
        // rule holds) catch whatever iOS does after our settle. Cleared on any new episode.
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
    // Keyboard-up page scrolls fire window scroll even when vv events go missing (momentum
    // tails); check() is two property reads and only kicks on real drift.
    window.addEventListener('scroll', check, { passive: true })
    // Watchdog: vv events can be missed around load/orientation races — a drift probe every
    // 500ms re-kicks the loop if the parked value has gone stale, so the bar can never stick wrong.
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

  // The toolbar band is RESERVED space: --iw-toolbar-h mirrors the footer pill's LIVE height
  // (grows when the style/review rows open — the RO tracks the animation) so index.css can
  // (a) pad the phone surface's bottom and (b) scroll-padding every scroller, keeping the caret,
  // selection handles and scrollIntoView targets ABOVE the toolbar + keyboard, never behind them.
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
  // ENTER-CARET FIX (2026-07-11, Peter: "press Enter … the cursor isn't visible until you type"):
  // ProseMirror's own scrollIntoView (what Tiptap's Enter/splitBlock dispatches) IGNORES CSS
  // scroll-padding — it scrolls the new caret line to the scroller's RAW bottom edge, which is
  // exactly the band the floating toolbar reserves via scroll-padding-bottom (index.css). The
  // new empty line (and its caret) settled BEHIND the toolbar; the next typed character made the
  // BROWSER's native caret-reveal run, which does honour scroll-padding — hence "appears when
  // you type". Give PM the same reserve through its own mechanism: scrollThreshold (when a
  // position counts as too close to the edge) + scrollMargin (how far clear to scroll), kept in
  // sync with the live toolbar height by the ResizeObserver above.
  const lastPmReserveRef = useRef<{ view: unknown; bottom: number } | null>(null)
  const syncPmScrollReserve = (h: number) => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    // Pill height ONLY — do NOT add the keyboard offset. prosemirror-view's windowRect bottom is
    // ALREADY visualViewport.height (the keyboard is excluded from PM's window box), so a
    // kb-inclusive reserve DOUBLE-COUNTS it: the bottom rule then fires on every Enter (bounds
    // 328 − 421 < 0) → +180px over-scroll, and the next Enter's top rule yanks −84 back — the
    // probed "screen moves, then moves again" bounce. The toolbar band above the vv bottom is a
    // CONSTANT h regardless of keyboard state; the CSS scroll-padding (a LAYOUT-viewport
    // scroller mechanism) is the one that needs --iw-toolbar-h + --iw-kb-offset.
    // +28 over the pill: PM scrolls the CARET rect clear, but the paragraph's line box extends a
    // few px of leading below it — clear the whole line, with margin to spare.
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

  // MENU FOCUS GUARD (Peter round 2: "the toolbar retracts when opening menus"): on iOS any tap
  // outside the contenteditable blurs it → the keyboard dismisses → the docked pill (and the
  // just-opened menu) slide to the screen bottom mid-interaction. The pill used to preventDefault
  // its own pointerdowns, but every drop-up PANEL is PORTALED to <body> — taps inside Settings/
  // Options/Page/Guide/Math dropped focus. One document-level capture guard covers the pill AND
  // every portaled panel (they all carry .iw-touch-guard): while the editor owns focus,
  // preventDefault pointerdowns on guard surfaces so focus (and the keyboard) stay put. Real
  // form fields inside menus are exempt — they legitimately take focus.
  useEffect(() => {
    if (!isTouchDevice()) return
    const onPointerDown = (e: PointerEvent) => {
      const pm = editorRef.current?.view.dom
      if (!pm || !(pm === document.activeElement || pm.contains(document.activeElement))) return
      const t = e.target as Element | null
      if (!t?.closest?.('.iw-touch-guard')) return
      if (t.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions)
  }, [])

  // iOS touch-and-hold guard, half two (half one = .iw-touch-guard user-select CSS): a touch that
  // STARTS on the toolbar or any of its drop-ups must never start a text selection mid-slide when
  // the finger moves up onto the editor — touch events keep firing on their START target, so one
  // document-level non-passive touchmove preventDefault covers every guard surface, including
  // portaled menus. Touches that start in the editor itself are untouched (long-press selection
  // there still works). Capture-phase + first-touch-only so a second finger can't drop the guard.
  useEffect(() => {
    if (!isTouchDevice()) return
    let guarded = false
    const start = (e: TouchEvent) => {
      if (e.touches.length === 1) guarded = !!(e.target as Element | null)?.closest?.('.iw-touch-guard')
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
      // BOTH platforms: start the coast FIRST, on this light frame — 'inkwave:reveal-imminent'
      // freezes + class-swaps every drifting surface (shell + this editor's own, in lockstep —
      // see Scroll.tsx). The freeze must NOT share the reveal commit (the busiest frame of the
      // load): the compositor kept drifting while that commit blocked the main thread, so a
      // same-commit freeze snapshotted a stale offset and the waves snapped ~7px BACKWARD when
      // the coast started (the reveal flicker, Chrome + Firefox desktop, 2026-07-09).
      window.dispatchEvent(new Event('inkwave:reveal-imminent'))
      if (isTouchDevice()) {
        // PHONE (Peter's spec): waves decelerate first; at 1.5s the shell drops instantly and the
        // page + chrome fade IN over the still-coasting waves for the remaining 0.5s — the fade
        // completes at 2s, the moment the waves reach rest (see Edit.tsx + the phone transition
        // in Scroll.tsx + .iw-chrome-in below).
        revealTimer = setTimeout(reveal, 1200) // 0.8s fade lands exactly in the coast tail (ends at 2s = wave rest)
        return
      }
      // DESKTOP (Peter, 2026-07-10, second tune): the page fade-in starts AT coast start — no
      // extra wait (the 1s fade runs over the first 1s of the 2.5s coast; the slowdown stays
      // visible for another 1.5s after the fade completes). Two clean frames between the coast
      // class swap and the heavy reveal commit, as before — the coast is compositor-driven and
      // already easing smoothly when the commit lands (the 2026-07-09 backward-flick fix).
      revealRaf = requestAnimationFrame(() => { revealRaf = requestAnimationFrame(reveal) })
      // rAF can starve on a wedged/backgrounded main thread — the reveal must still happen
      // (bulletproof cap; reveal is idempotent).
      revealTimer = setTimeout(reveal, 1500)
    }
    // ── THE DELIBERATE DELAY (Peter, 2026-07-17: "make it show at least one loop before the file
    // comes up. purposefully delay it. (And use that time to warm up the document)") ────────────
    // "Warm up the document" needs NO code of its own: fonts.ready, the first pagination measure
    // and the editor's own mount are ALREADY running through this window. The delay just stops the
    // reveal cutting them short — the warm-up is what the load was doing anyway, given room.
    //
    // THE FLAG IS READ INLINE, never imported from waveVideo: importing a helper to decide whether
    // to wait would pull the whole video module into the editor bundle on every load and make "off
    // costs nothing" false (the reason btDebug/textRender read their flags inline, below).
    // OFF ⇒ `waveLooped` is an already-resolved promise and this gate is byte-for-byte the old one.
    let waveVideoOn = false
    try { const v = localStorage.getItem('inkwave:waveVideo'); waveVideoOn = v === '1' || v === 'debug' } catch { /* private mode */ }
    // ASK, THEN SUBSCRIBE, in ONE synchronous block — the video can loop before we get here, and a
    // bare addEventListener would then wait for an event already in the past, forever. waveVideo
    // fires this on EVERY exit (wrap, bail, decode timeout, autoplay refusal, settle), so it is a
    // signal that always arrives.
    //
    // AND IT IS CAPPED HERE, INDEPENDENTLY. That guarantee only holds if the MODULE LOADED — a
    // chunk 404 or a parse error fires nothing, and the failure mode would be a document that never
    // appears. The document must never depend on the animation succeeding.
    const waveLooped: Promise<void> = !waveVideoOn
      ? Promise.resolve()
      : new Promise<void>((res) => {
          if ((window as unknown as { __iwWaveVideoLoopDone?: boolean }).__iwWaveVideoLoopDone) { res(); return }
          const on = () => { window.removeEventListener('inkwave:wave-video-loop', on); res() }
          window.addEventListener('inkwave:wave-video-loop', on)
          setTimeout(() => { console.warn('[inkwave] wave video never reported a loop — revealing anyway'); on() }, 7000)
        })
    // The 1200ms safety cap predates the video and would fire straight through a ~2s loop, undoing
    // the delay on every load. With the video ON it becomes the loop gate's own backstop (7s) plus
    // the old margin; with it OFF the constant is untouched.
    const cap = setTimeout(finish, waveVideoOn ? 8200 : 1200)
    const fontsReady: Promise<unknown> = (typeof document !== 'undefined' && document.fonts?.ready) || Promise.resolve()
    // The pagination extension measures in BOTH page modes now (gap widgets / break markers), so
    // always wait for its first measure — the 1.2s cap covers any mode where it never fires.
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

  // ── iOS break-table store test (flag `inkwave:btDebug`, default OFF) ──────────────────────────
  // Peter opens `/?btDebug=1` on his iPhone 8, on the live site. The store's OPFS layer is proved
  // on Chromium, but Chromium has createWritable — iOS takes opfsWrite.ts's OTHER branch (worker
  // createSyncAccessHandle, ONE handle per file or it throws), which has never executed with this
  // store and which CI physically cannot reach. The store's first execution found two bugs that were
  // invisible until the code ran; this asks those same questions on the device.
  // ZERO COST WHEN OFF, BY CONSTRUCTION: the flag read is a localStorage get and the module is a
  // dynamic import, so nothing of this reaches the bundle — let alone the typing path — unless
  // Peter turns it on. It self-mounts a fullscreen overlay; it touches no editor state.
  useEffect(() => {
    // The flag is read INLINE, not imported from the debug module: importing a `btDebugEnabled()`
    // helper to decide whether to import the module would pull the module on every load and make
    // "off costs nothing" false — the exact reason textRenderFlag.ts lives alone (see its header).
    let on = false
    try { const v = localStorage.getItem('inkwave:btDebug'); on = v === '1' || v === 'race' } catch { /* private mode */ }
    if (!on) return
    let cancelled = false
    void import('./breakTableDebug').then((m) => { if (!cancelled) void m.runBreakTableDebug() })
    return () => { cancelled = true }
  }, [])

  // ── textRender probe surface (flag `inkwave:textRender`, default OFF) ─────────────────────────
  // The plaintext page renderer is measured IN THE REAL APP — live doc, real shipped fonts, real
  // DPR — never a harness that reimplements the context (the trap that has burned this codebase
  // five times). Dynamic import ⇒ the module stays out of the bundle entirely when the flag is off.
  useEffect(() => {
    if (!editor || !textRenderEnabled()) return
    let cancelled = false
    void import('./textRenderProbe').then((m) => { if (!cancelled) m.installTextRenderProbe(editor) })
    return () => {
      cancelled = true
      try { delete (window as unknown as { __iwTextRenderProbe?: unknown }).__iwTextRenderProbe } catch { /* noop */ }
    }
  }, [editor])

  // Live word count for the record panel. Debounced: getText() walks the whole doc, and a panel
  // readout doesn't need per-keystroke precision — 300ms after the last edit is indistinguishable.
  // The readout only renders INSIDE the open ◈ panel (ReceiptPanel is controlled on all platforms
  // now), so while it's CLOSED we don't count AT ALL — the O(doc) string build + unicode regex +
  // the editor-shell re-render otherwise landed in every typing pause (desktop counted every 300ms
  // of a 100-page doc for a hidden number — 2026-07-11 ablation). Opening the panel counts
  // immediately (the effect re-runs on receiptOpen) and keeps counting while open.
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
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
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
      // First block only — deriveTitle(e.getText()) walked the ENTIRE doc to read one line.
      // An EMAIL titles itself from its SUBJECT, not its body: the generic rule would overwrite the
      // subject with the first line of the message ("Dear Ada,") on the next save beat, so the
      // library and the ledger's doc_label would show the greeting instead of the subject.
      title: docRef.current.docType === 'email' && docRef.current.email
        ? titleForEmail(docRef.current.email)
        : deriveTitle(e.state.doc.firstChild?.textContent ?? '') || docRef.current.title,
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
  // THE CLOCK STARTS AT REAL WORK — a document change the WRITER caused.
  //
  // Both halves are needed, and each was PROBED (scripts/tabdoc-probe/unsynced.mjs):
  //  · A docChanged transaction ALONE is wrong: the editor fires them during LOAD, so the clock
  //    started at page load and the notice would nag someone who opened Inkwave, typed nothing and
  //    walked away (cells 1+3 caught exactly that).
  //  · `beforeinput` alone is wrong too: it never fires here — ProseMirror's input pipeline means
  //    the event is simply absent (measured: 0 events at document capture while typing). A signal
  //    that never arrives silently disables the feature, which is this codebase's signature bug.
  // So: user input ARMS the clock, and the next real document change starts it. Caret moves and
  // load-time transactions do neither.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const arm = () => { sawUserInputRef.current = true }
    dom.addEventListener('keydown', arm)
    dom.addEventListener('paste', arm)
    return () => { dom.removeEventListener('keydown', arm); dom.removeEventListener('paste', arm) }
  }, [editor])

  // A failed read must never REPLACE a good list with an empty one — the panel would then assert,
  // in the UI, the exact lie the storage layer no longer tells. Keep what we have and log.
  const refreshSnapshots = async (docId: string) => {
    const r = await readSnapshotArchive(docId)
    if (r.kind === 'error') { console.warn('[inkwave] snapshot list refresh skipped — archive unreadable:', r.error); return }
    setSnapshots(r.snapshots.map(toSnapshotMeta))
  }

  // Load existing snapshots when the document opens / switches. The LIST loads EAGERLY — rapid snapshot
  // scrubbing is a core feature, so the reviewer never waits for it. The OTS Bitcoin re-check does NOT
  // run here: it re-writes the compressed snapshot file per snapshot + does serial calendar round-trips
  // (~10s), which was the startup lag. It now runs only when the receipts panel is opened (runOtsSweep),
  // throttled. New snapshots are still stamped on creation, so nothing is lost by not sweeping on load.
  useEffect(() => {
    const docId = doc.id
    let cancelled = false
    // Reads through the same cache, so this still warms the full list for scrubbing.
    // THE EAGER LOAD IS WHERE A FAILED READ WOULD BECOME VISIBLE AS A LIE: leave `snapshots` at []
    // and the receipts panel renders "no snapshots yet" over a full archive — the storage bug's
    // exact claim, now made by the UI, at the moment the writer opens his thesis. It also had no
    // `.catch`, so the throw would only ever be an unhandled rejection. Say it plainly instead.
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
        // THE SILENT-DISABLE SEAM. createSnapshotIfChanged reads the archive itself and now refuses
        // rather than write over a history it couldn't read — correct, but on its own it would make
        // provenance stop accruing with nothing but a console warning (enqueueSnapshotWork swallows
        // the throw). Peter would keep writing, believing he was building his authorship trace, and
        // find the gap when it was too late to fix. Reading through the guard here means the failure
        // is SEEN. Typing is untouched either way: this whole queue runs off the typing path.
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
      // State holds metadata only — read the FULL previous snapshot (cached) for the diff below.
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

  // THE ARCHIVE READ FOR ANY ACTION THAT PUBLISHES OR OVERWRITES THE RECORD.
  //
  // `listSnapshots` now THROWS when it cannot read the archive rather than answering `[]` — because
  // `[]` meant "no history" and every one of these actions would then have written or exported an
  // empty history over Peter's real one (see provenance/snapshots.ts). But a throw reaching a click
  // handler is just a button that does nothing, so each action reads through here: on a failure the
  // action is CANCELLED and says so, instead of quietly shipping a gutted record.
  //
  // Cancelling is the safe direction for all of them and none of it touches typing: an export, a
  // cloud sync and a folder mirror are all re-runnable, and the archive is still on disk. What is
  // NOT re-runnable is a .studio the writer believes holds his proof, or a OneDrive copy overwritten
  // with one snapshot. Note this returns `[]` happily for a genuinely new document — an established
  // emptiness is not a failed read, and first-save must keep working forever.
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
      // The archive read is separated from the WRITE deliberately. Both used to land in the same
      // `.catch`, which would now report a transient archive fault as "your folder permission
      // lapsed" and drop the link — a wrong story and a needless interruption. A failed read means
      // only: skip THIS mirror. The link stays live and the next kick mirrors the full archive.
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
      // Silent auto-mirror: a failed archive read skips this cycle rather than pushing a short
      // archive at Drive. `.catch(() => {})` already swallowed sync errors here; the read failure
      // joins them, but it must never reach syncToGoogleDrive.
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
    //
    // ⚠ THIS CHECK IS DEFENCE IN DEPTH, NOT THE LOAD-BEARING GUARD — recorded because it was
    // claimed to be the latter, and a lane that trusts the wrong line stops guarding the right one.
    // PROBED + mutation-proved (`storage/cloudLocalRead.test.ts`): the PRE-FIX composition
    // `listSnapshots(id).then(s => syncToOneDrive(doc, s)).catch(() => {})` ALSO refuses — because
    // `listSnapshots` now THROWS on a failed read and the fire-and-forget `.catch` swallows the
    // throw before the sync is ever called. What actually stands between a failed local read and
    // Peter's archive is `readSnapshotsFromDisk`'s throw (M13: restore its `catch { return [] }`
    // and cells die). This check earns its place for two OTHER reasons, both worth keeping: it
    // makes the refusal VISIBLE (a named warning, not a silently swallowed rejection), and the
    // `SnapshotRead` union is what stops the next edit here writing `.catch(() => [])` — the one
    // caller shape that still destroys the archive, pinned as a known-negative in that file.
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
    // PRINT FLOOR (round-6): breaks may be lazily stale between a scoped measure and its idle
    // refresh — print is a canonical consumer and must NEVER see that. The pagination plugin runs
    // a synchronous FULL canonical measure + repaint on this event (belt) and on 'beforeprint'
    // (braces — Chromium fires it before the dialog; some engines are flaky, hence the event).
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
  // Fetch a cloud file's bytes THROUGH the OPFS open cache: change-tag match → cached bytes, no
  // download (instant); mismatch/unknown → download + refill; download failed but bytes cached →
  // serve the stale copy (airplane-mode opens keep working). Returns null only with nothing at all.
  // A cache HIT only ever compares against a TRUSTED tag: the tag from a fresh listing, or a live
  // metadata GET when the picker was still showing its cached listing — a stale listing tag could
  // false-hit and silently open OUTDATED content, which the next sync would then write back over
  // the newer remote copy. A wrong STORED tag, by contrast, can only cause a miss (safe).
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
      // LOAD-PATH RULE: re-link only — do NOT rebuild + rewrite the bundle here. The old load-time
      // write re-read/re-encoded/rewrote the whole (possibly 20 MB) file before anything changed and
      // was most of the ~1.5s open block. The file already holds our last write and nothing local has
      // changed since load, so the verified link means "in sync"; the next provenance checkpoint
      // mirrors as usual (mirrorIfActive), which also runs the once-per-session grow-only merge then.
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
      // Adopt the server set + repaint IMMEDIATELY; the receipt recovery/purge below is heavy
      // (snapshot archive reads + an Ed25519 verify per historical receipt chain) and used to run
      // right here — landing in the first seconds after load, where it competed with first scrolls
      // and keystrokes (part of the "shaky first 2 seconds"). It now runs at browser idle.
      priorReceiptsRef.current = docRef.current.scasReceipts ?? []
      scasRef.current!.useServerSet(runner.current.lemmas, runner.current.setVersion)
      if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_HINT_META, true))

      const recoverAndPurge = async () => {
      if (cancelled || docRef.current.id !== docId) return
      // Recover any receipts from previous sessions that were lost due to the cross-session
      // overwrite bug (now fixed). Scan OPFS snapshots; collect receipts from sessions that
      // appear in the snapshots but not in doc.scasReceipts. Only adds receipts from sessions
      // whose counter-0 is present (so the chain can be verified end-to-end). Saves back to
      // OPFS so future exports include the full receipt history.
      const knownSigs = new Set((docRef.current.scasReceipts ?? []).map((r) => r.signature))
      const knownSessions = new Set((docRef.current.scasReceipts ?? []).map((r) => r.sessionToken))
      // THIS PASS DELETES SNAPSHOTS, so it may never run on a view of the archive it isn't sure of.
      // On a failed read the old `[]` made it a no-op by luck (no candidates ⇒ no badSessions); that
      // luck is not a guard, and the purge below reasons from ABSENCE ("no good receipt for this
      // session ⇒ purge it"), which is precisely the reasoning an empty archive corrupts. Bail.
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
        docRef.current = updated
        onDocChange(updated)
        scheduleSave(updated)
      }

      // Purge sessions whose receipts fail cryptographic verification (bad signature = was signed
      // with a dev key, or corrupted by the kicks-array reference bug). Done once at session open
      // so the next export bundle only includes verifiable receipt chains. Also removes any OPFS
      // snapshots whose embedded receipts were all from purged sessions (so content integrity
      // checks won't fail on receipts that are no longer in bundle.receipts).
      const pubKey = signingPublicKeyHex()
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
        const snapsAfterRecovery = afterRead.snapshots
        for (const s of snapsAfterRecovery) {
          await new Promise((r) => setTimeout(r, 0)) // slice the rewrite loop too
          const snapReceipts = s.receipts ?? []
          const allBad = snapReceipts.length > 0 && snapReceipts.every((r) => badSessions.has(r.sessionToken))
          if (allBad) await deleteSnapshot(docId, s.id)
        }
        const updated: InkwaveDocument = { ...docRef.current, scasReceipts: cleanReceipts }
        docRef.current = updated
        onDocChange(updated)
        scheduleSave(updated)
      }

      priorReceiptsRef.current = docRef.current.scasReceipts ?? []
      }
      runWhenQuiet(() => void recoverAndPurge(), 5000)
    })
    return () => { cancelled = true }
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // The signing period. With a session: sign the period's receipt (content + resolved kicks), chain
  // it, and adopt the next server-issued set. Without one: fall back to a local resample (M0).
  // Verdicts are frozen (locked ∪ liveKicks persist), so neither reflows committed text. Held in a
  // ref so the interval always runs the latest closure (no stale editor/refs).
  // Returns a promise so the nudge handler can await signing before snapshotting,
  // ensuring the snapshot's bundleHash covers the receipt for this nudge.
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
      docRef.current = updated
      onDocChange(updated)
      scheduleSave(updated)
      mirrorIfActive()
      if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(SCAS_HINT_META, true))
    } else {
      scasRef.current!.resampleNow()
      const updated: InkwaveDocument = { ...docRef.current, scasState: scasRef.current!.state }
      docRef.current = updated
      onDocChange(updated)
      scheduleSave(updated)
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
    void verifyChain(runner.receipts, runner.sessionToken, signingPublicKeyHex()).then((v) => {
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
    docRef.current = updated
    onDocChange(updated)
    scheduleSave(updated)
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

  // A single atom node (citation / reference list / math) selected via click-hold shouldn't summon the
  // TEXT formatting bar — those have their own popovers (e.g. the citation locator card). Treat that as
  // "no text selection" for the style bar. (selIsAtomNode is state, mirrored by the selection effect —
  // the render body must not read editor.state now that per-transaction re-renders are off.)
  // On phone with keyboard up + text selected: show ONLY the style bar (not the full toolbar).
  // styleBarOpen keeps the main row alive while the user is actively formatting.
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
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${bibPanelOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
          title="Bibliography / citations"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-xs leading-none font-serif" style={{ fontStyle: 'italic' }}>‟</span>
        </button>
      )}
      {id === 'receipt' && (
        <button type="button"
          data-iw-bar="review" onClick={() => toggleBar('review')}
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${reviewOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
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
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${styleBarOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
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
            docRef.current = updated
            onDocChange(updated)
            scheduleSave(updated)
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
          className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${activeBar === 'music' ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
          title="Music — turn a photo into a piece"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">♪</span>
        </button>
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
            style={{ background: '#fff7ed', borderBottom: '1px solid #f0c98a', color: '#92400e' }}
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
            // news ("nothing was overwritten"), and shouting them in the red ⚠ error banner told
            // the writer their thesis was in trouble at the moment it had just been protected.
            // The info variant is calm and themed (tokens with day fallbacks); the error variant
            // keeps its existing red.
            // `iw-nightable` on the INFO variant only: the night tokens (--iw-ink et al) are scoped
            // INSIDE that class, so without it these vars would silently resolve to their day
            // fallbacks on a night background. It also re-surfaces the banner to dolphin grey in
            // night, which is right. The ERROR variant must keep its red — being alarming is its
            // job — so it stays outside the themed surface.
            className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-2 text-sm font-serif${fileOpenError.kind === 'info' ? ' iw-nightable' : ''}`}
            style={fileOpenError.kind === 'info'
              ? {
                  background: '#faf7ff', // night: .iw-nightable overrides to dolphin grey
                  borderBottom: '1px solid var(--iw-nightable-border, #e7e5e4)',
                  color: 'var(--iw-ink, #5c2d8a)',
                }
              : { background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#991b1b' }}
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
        <Scroll paperRef={paperRef} containerRef={containerRef} phone={isTouch} fill revealed={settled} covered={isTouch ? !waveRest : !settled}>
          {/* Email header block (§B2.1), behind the default-OFF flag. The BODY below is the
              ordinary editor — which is what makes an email an ordinary document. */}
          {emailEnabled() && doc.docType === 'email' && (
            <EmailComposePanel
              doc={doc}
              onDocChange={(updated) => {
                // A header edit is a document edit, and NOTHING else saves it: scheduleSave is
                // driven by the editor's own update handler, which a header field never fires. Left
                // to onDocChange alone the headers lived in React state and vanished on reload
                // unless the writer happened to also touch the body. docRef is updated FIRST so any
                // snapshot/finalise work that reads it sees the new headers immediately.
                docRef.current = updated
                onDocChange(updated)
                scheduleSave(updated)
              }}
            />
          )}
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
        </Scroll>

        {/* The faint desktop countdown. Renders NOTHING unless a block is running and the flag is
            on; it portals itself to <body>, so despite sitting here in the tree it is never a
            DESCENDANT of the editor and its per-second write cannot invalidate the page subtree.
            It is the SECOND access path to the ledger — same setter as the toolbar's clock slot. */}
        {prodLedgerEnabled() && <CountdownOverlay onOpen={() => setLedgerOpen(true)} />}
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
            onClose={() => setLedgerOpen(false)}
          />
        )}

        {/* ReceiptPanel: always in the tree on phone (no !keyboardUp guard) so the panel
            stays mounted during and after async save-version work. The trigger is hidden
            on touch (lives in toolbar) and when keyboard is up (visually inaccessible). */}
        <ReceiptPanel
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
                  label="⚠ Reconnect to keep saving"
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
                label={lastFileSave ? '✓ Synced to folder' : '🗀 Sync pending'}
                synced={!!lastFileSave}
                path={fileName}
                lastSync={lastFileSave}
                tooltip={`Saving to ${fileName}`}
                onShowInFolder={showInFolder}
                onChangeFolder={saveAsFile}
                {...syncProps}
              />
            ) : (
              <SyncStatus compact={isTouch} label="🗀 Save to a folder" synced={false} onClick={() => void saveToFile()} {...syncProps} />
            )
          }
          // Google Drive (Firefox/Safari) takes the indicator once the writer has connected it.
          if (gdriveActive) {
            return (
              <SyncStatus
                compact={isTouch}
                label={lastGdriveSync ? '✓ Synced to Google Drive' : '▴ Sync pending'}
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
              label={lastSync ? '✓ Synced to OneDrive' : '☁ Sync pending'}
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
            paddingBottom: isTouch ? 'max(0px, calc(env(safe-area-inset-bottom) - var(--iw-kb-offset, 0px)))' : `${28 * zoom}px`,
            // Landscape phones (viewport-fit=cover): keep the docked bar clear of the notch/home-bar
            // side insets, matching the bottom inset above. Zero in portrait / on desktop.
            paddingLeft: isTouch ? 'env(safe-area-inset-left)' : undefined,
            paddingRight: isTouch ? 'env(safe-area-inset-right)' : undefined,
            // When the PDF panel is open: a side dock stops the centring box at the docked edge
            // (--iw-pdf-room right / --iw-pdf-room-left left) so the toolbar recentres over the
            // writing; a bottom dock lifts the whole toolbar above it (--iw-pdf-room-bottom).
            left: 'var(--iw-pdf-room-left, 0px)',
            right: 'var(--iw-pdf-room, 0px)',
            // Phone: the keyboard/URL-bar lift is NOT part of `bottom` — the dock
            // (editor/toolbarDock.ts) writes translate3d(0,-kbOffset,0) imperatively on this
            // wrapper per frame. transform composites during iOS pans; `bottom` (layout) does
            // NOT apply mid-pan, which left the bar floating "all over the shop". Never move
            // the lift back into a layout property, and never transition transform here.
            bottom: 'var(--iw-pdf-room-bottom, 0px)',
            willChange: isTouch ? 'transform' : undefined,
            transition: isTouch ? 'left 0.18s ease, right 0.18s ease' : 'left 0.18s ease, right 0.18s ease, bottom 0.18s ease',
          }}
        >
          <div
            ref={footerRef}
            className={`iw-nightable iw-touch-guard pointer-events-auto flex flex-col bg-white shadow-sm ${barsAnimating ? 'overflow-hidden' : ''} ${isTouch ? 'w-full' : ''}`}
            style={{
              border: '1px solid var(--iw-nightable-border, rgba(92, 45, 138, 0.75))',
              borderRadius: isTouch ? '15px 15px 0 0' : '15px',
              opacity: barVisible ? 1 : 0,
              pointerEvents: barVisible ? 'auto' : 'none',
              transition: 'opacity 160ms ease',
              // Counter browser zoom so the pill stays a constant physical size.
              // transform instead of zoom: zoom scales the positioned `bottom` offset, causing
              // the pill to drift up/down on zoom. transform does not affect the offset.
              // ×1.12 = the "bigger pills" boost — desktop only. On a phone the bar is w-full, so
              // any upscale makes it VISUALLY 12% wider than the screen and the end buttons clip.
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

            {/* Music row — the second-bar layer the music slot opens. Same collapse animation as
                the style/review rows; MUTUALLY EXCLUSIVE with them by the TYPE (activeBar holds ONE
                id — toolbarContract.ts). This lane owns the SHELL; components/MusicBar.tsx is the
                clearly-labelled STUB the music lane (feat/music-piece-photo) fills. Gated on the
                music flag so it is byte-invisible on the live toolbar until that lane ships. */}
            {musicEnabled() && (
              <div style={{
                overflow: 'hidden',
                maxHeight: activeBar === 'music' ? '60px' : '0',
                opacity: activeBar === 'music' ? 1 : 0,
                pointerEvents: activeBar === 'music' ? 'auto' : 'none',
                transition: 'max-height 220ms ease, opacity 160ms ease',
              }}>
                {activeBar === 'music' && <MusicBar phone={isTouch} />}
              </div>
            )}

            {/* Main toolbar row. Phone: iw-phone-toolbar (index.css) sizes the EIGHT circles
                (▲ + 6 slots + ⋮ — S and ⚙ are SLOTS now; ◈/☁ live in the ▲ drop-up) to
                (100vw − 45px)/8 and caps each button's 44px min-WIDTH at the same size;
                justify-between spreads the ~45px of slack as ~6px breathing-room gaps. py-1.5
                (vs desktop py-0.5) gives the row vertical air — the footer RO mirrors whatever
                height results into --iw-toolbar-h + the PM scroll reserve, so never hardcode
                the pill height anywhere. iw-slot-dragging paints every circle's disc opaque
                while a drag is live so the lifted one passes OVER its neighbours. */}
            {showMainRow && (
            <div className={`flex items-center ${isTouch ? 'iw-phone-toolbar justify-between px-0 py-1.5' : 'gap-0.5 px-2 py-0.5'} ${slotDragView || popupDragActive ? 'iw-slot-dragging' : ''}`}
              // PHONE AND DESKTOP ARE ONE EXPERIENCE, SO THEY ARE ONE NUMBER (Peter, 2026-07-17:
              // "there's only 6 slots not 7 which I think is a good number because it fits well on
              // phone… we want to keep the phone and desktop experience continuous"). The phone
              // circle size is (100vw − 45px) / (the row + ▲ + ⋮), and index.css used to divide by a
              // literal 8 — a SECOND copy of ROW_SLOTS, in another language, that no lane would think
              // to update. The whole justification for six is that it fits the phone, so the phone's
              // fit must be derived from six rather than agree with it by coincidence.
              style={{ ['--iw-row-slots' as string]: String(ROW_SLOTS) }}
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
                  className={`flex items-center justify-center ${isTouch ? '' : 'min-w-[44px]'} min-h-[44px] transition-colors font-serif ${toolbarPickerOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
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
                      style={{ border: '1px solid rgba(92,45,138,0.75)' }}
                      onMouseDown={e => e.stopPropagation()}>
                      {/* + add more opps */}
                      <div className="flex items-center">
                        <button type="button"
                          onClick={() => setOppsOpen(o => !o)}
                          className="flex items-center justify-center min-w-[44px] min-h-[44px] text-stone-400 hover:text-[#5c2d8a] transition-colors"
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
                            style={{ color: '#5c2d8a' }}
                            title="Provenance record — snapshots"
                          >
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgba(92,45,138,0.75)] text-sm">◈</span>
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
                            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgba(92,45,138,0.5)] text-base">☁</span>
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
                        background: 'var(--iw-ink, #5c2d8a)',
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
              docRef.current = updated
              onDocChange(updated)
              scheduleSave(updated)
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

function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  return first.slice(0, 80)
}


const INK = '#5c2d8a'
