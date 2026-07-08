import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useZoomScale } from './useZoomScale'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import { FontSize } from './extensions/FontSize'
import { ParagraphStyle } from './extensions/ParagraphStyle'
import type { InkwaveDocument } from '../types/document'
import { scheduleSave } from '../storage/opfs'
import { upsertMeta } from '../storage/indexeddb'
import { RedHighlightExtension, SCAS_HINT_META, getGreenAnchors } from './extensions/RedHighlightExtension'
import { PaginationExtension } from './extensions/PaginationExtension'
import { ListStyle } from './extensions/ListStyle'
import { gappedPagesEnabled } from './pageView'
import { applyCrossoutMode } from './crossout'
import { exportPdfToNewTab } from './exportPdf'
import { exportLatexDownload, exportEquationsDownload } from './exportLatex'
import type { HintState } from './extensions/RedHighlightExtension'
import { REFLOW_OPEN_MS, type LineRange } from './suggestions/ThesaurusPopover/popoverConstants'
import { ScasSlotMark } from './extensions/ScasSlotMark'
import { CommentMark } from './extensions/CommentMark'
import { InsertionMark, DeletionMark, TrackChanges } from './extensions/TrackChanges'
import { CommentNotes } from '../components/CommentNotes'
import { ReviewBar } from '../components/ReviewBar'
import { MathInline } from './extensions/MathInline'
import { MathBlock } from './extensions/MathBlock'
import { MathPasteHandler } from './extensions/MathPasteHandler'
import { TabIndent } from './extensions/TabIndent'
import { LineNumbers } from './extensions/LineNumbers'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Scroll, isTouchDevice } from './Scroll'
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
import { createSnapshotIfChanged, listSnapshots, deleteSnapshot, stampSnapshot, drainUnstamped, upgradePending, patchSnapshotSummary, patchSnapshotDiffSummary } from '../provenance/snapshots'
import { summariseParagraph, summariseBullets, summariseDiff } from '../provenance/summarise'
import { ReceiptPanel } from '../components/ReceiptPanel'
import { SessionRunner } from '../provenance/session'
import { CadenceTap } from '../provenance/cadence'
import { cadenceTierActive, getClerkToken } from '../auth/entitlement'
import { buildExportBundleWithPdfs, bundleFilename, downloadBundle, downloadBundleGz, pmToText } from '../provenance/bundle'
import { fileSaveAvailable, pickSaveFile, getSaveFileHandle, getSaveFileName, writeBundleToFile, readLocalHeartbeat, preMergeSaveFile } from '../storage/folder'
import { oneDriveConfigured, oneDriveAccount, syncToOneDrive, startOneDriveSignIn, oneDriveSyncPending, clearOneDriveSyncPending, oneDrivePath, setChosenFolder, addRecentFolder, renameOneDriveFile, oneDriveFilename, downloadOneDriveFile, readRemoteHeartbeat, getRemoteFileInfo, preMergeRemote, type OneDriveFolder } from '../storage/onedrive'
import { googleDriveConfigured, startGoogleDriveSignIn, syncToGoogleDrive, clearGoogleDriveFile, setChosenGDriveFolder, gDriveFilename, renameGoogleDriveFile, downloadGoogleDriveFile, googleDriveFileId, addRecentGDriveFolder, getGDriveFileInfo, preMergeGDrive } from '../storage/gdrive'
import { isOtherDeviceActive } from '../sync/presence'
import { SyncStatus } from '../components/SyncStatus'
import { VerifyModal } from '../components/VerifyModal'
import { SettingsMenu } from '../components/SettingsMenu'
import { PageMenu } from '../components/PageMenu'
import { getLineHeight } from './lineHeight'
import { CitationNode } from './extensions/CitationNode'
import { CiteSuggestion } from './extensions/CiteSuggestion'
import { ReferenceListNode } from './extensions/ReferenceListNode'
import { CiteAutocomplete } from '../components/CiteAutocomplete'
import { CitationPanel } from '../components/CitationPanel'
import { PdfSidePanel } from '../components/PdfSidePanel'
import { Toast } from '../components/Toast'
import { loadLibrary } from '../citations/library'
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
import { contentHash } from '../provenance/hash'
import { verifyChain, signingPublicKeyHex } from '../provenance/receipts'
import type { Snapshot, SignedReceipt, WordNudgeEvent } from '../types/document'

// No wall-clock resample timer — S_v rotation and receipt signing happen on word nudge only.
// This keeps the green/red word set stable between nudges and avoids spurious receipts.

// ─── Toolbar slot customisation ───
type SlotId = 'bib' | 'guide' | 'math' | 'receipt' | 'page'
const SLOT_KEY = 'inkwave-toolbar-slots'
const DEFAULT_SLOTS: [SlotId, SlotId, SlotId, SlotId] = ['bib', 'guide', 'math', 'receipt']
const ALL_SLOTS: SlotId[] = ['bib', 'guide', 'math', 'receipt', 'page']

function loadToolbarSlots(): [SlotId, SlotId, SlotId, SlotId] {
  try {
    const raw = localStorage.getItem(SLOT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length >= 4) {
        const slice = parsed.slice(0, 4)
        const valid = slice.every(id => (ALL_SLOTS as string[]).includes(id as string))
        const unique = new Set(slice).size === 4
        if (valid && unique) return slice as [SlotId, SlotId, SlotId, SlotId]
      }
    }
  } catch {}
  return DEFAULT_SLOTS
}
// ─────────────────────────────────

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
  // race the OPFS read-modify-write.
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const snapshotsRef = useRef<Snapshot[]>([])
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

  // Swap to a document-style favicon while a studio file is open so browser tabs are
  // distinguishable from other Inkwave pages (the default is the wave/logo mark).
  useEffect(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect x="4" y="2" width="18" height="24" rx="2" fill="#f5f0eb" stroke="#5c2d8a" stroke-width="1.5"/>
      <path d="M19 2l5 5h-4a1 1 0 01-1-1z" fill="#c4a8e0" stroke="#5c2d8a" stroke-width="1"/>
      <line x1="8" y1="12" x2="18" y2="12" stroke="#5c2d8a" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="8" y1="16" x2="18" y2="16" stroke="#5c2d8a" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="8" y1="20" x2="14" y2="20" stroke="#5c2d8a" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
    const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    const link: HTMLLinkElement = existing ?? document.createElement('link')
    const prev = link.href
    if (!existing) { link.rel = 'icon'; document.head.appendChild(link) }
    link.type = 'image/svg+xml'
    link.href = url
    return () => { link.href = prev }
  }, [])

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
  // Console-snappy typing (see onTransaction): keystrokes do no O(doc) work. These carry the
  // deferred-tick + lazy-doc-build machinery.
  const docStaleRef = useRef(false)           // docRef.contentJson lags the editor until ensureDocFresh
  const scasTickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scasHadDeletionRef = useRef(false)    // deletions accumulate across the tick debounce window
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

  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0)
  const [paperRight, setPaperRight] = useState(0)
  // Mobile toolbar: controlled open state for the ◈ and ☁ triggers embedded in the toolbar.
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)   // review layer: sticky-note comments + track changes
  const [syncOpen, setSyncOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
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
  const [fileOpenError, setFileOpenError] = useState<string | null>(null)
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
  useEffect(() => {
    loadLibrary().catch(() => {})
    setCitationStyleBus(doc.citationStyle ?? 'apa')
  }, [doc.citationStyle])

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
  const [toolbarSlots, setToolbarSlots] = useState<[SlotId, SlotId, SlotId, SlotId]>(loadToolbarSlots)
  const [toolbarPickerOpen, setToolbarPickerOpen] = useState(false)
  const [oppsOpen, setOppsOpen] = useState(false)
  const toolbarPickerRef = useRef<HTMLDivElement>(null)

  function updateSlots(newSlots: [SlotId, SlotId, SlotId, SlotId]) {
    setToolbarSlots(newSlots)
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(newSlots)) } catch {}
  }

  const dragIdRef = useRef<SlotId | null>(null)

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
  const [styleBarOpen, setStyleBarOpen] = useState(false)
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function armStyleTimer() {
    if (styleTimerRef.current) clearTimeout(styleTimerRef.current)
    styleTimerRef.current = setTimeout(() => setStyleBarOpen(false), 5000)
  }
  function clearStyleTimer() {
    if (styleTimerRef.current) { clearTimeout(styleTimerRef.current); styleTimerRef.current = null }
  }
  const [selectionEmpty, setSelectionEmpty] = useState(true)

  // Ref to the relative container div — passed to ThesaurusPopover for accurate positioning.
  const containerRef = useRef<HTMLDivElement>(null)
  // Ref to the parchment/scroll column — its right edge anchors the options panel.
  const paperRef = useRef<HTMLDivElement>(null)
  // Footer bar + live mirrors of derived flags, read by the caret-keep-visible handler.
  const footerRef = useRef<HTMLDivElement>(null)
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
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Underline,
      ListStyle,
      PaginationExtension.configure({ enabled: gappedPagesEnabled() }),
      ScasSlotMark,
      CommentMark,
      InsertionMark,
      DeletionMark,
      TrackChanges,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['paragraph'] }),
      ParagraphStyle,
      // Standard Enter = new paragraph; Shift+Enter = hard break (via StarterKit's HardBreak).
      RedHighlightExtension.configure({
        getDoc: () => docRef.current,
        getHintState: () => hintStateRef.current,
        getScasLookup: () => scasRef.current!.lookup(),
      }),
      MathInline,
      MathBlock,
      MathPasteHandler,
      TabIndent,
      LineNumbers,
      CitationNode,
      CiteSuggestion,
      ReferenceListNode,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: doc.contentJson,
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        'data-placeholder': 'Begin writing…',
        spellcheck: 'false',
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
        }
        if (scasTickTimerRef.current) clearTimeout(scasTickTimerRef.current)
        scasTickTimerRef.current = setTimeout(() => {
          if (e.isDestroyed) return
          const hadDeletion = scasHadDeletionRef.current
          scasHadDeletionRef.current = false
          scasRef.current!.processDoc(e.state.doc, e.state.selection.from, hadDeletion)
          // Always repaint: the deferred decorations need it after edits, and it refreshes the
          // cursor-word suppression after pure caret moves.
          e.view.dispatch(e.state.tr.setMeta(SCAS_HINT_META, true))
        }, 120)
      }

      // Paragraph index feeds the thesaurus popover — must track SELECTION moves too (clicking into
      // a paragraph), so it stays above the docChanged gate. O(caret) walk; React bails on same value.
      const { $from } = e.state.selection
      let pIdx = 0
      e.state.doc.nodesBetween(0, $from.pos, (node) => {
        if (node.type.name === 'paragraph') pIdx++
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
      scheduleSave(() => ensureDocFresh(), () => {
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
          const allParas: string[] = []
          e.state.doc.forEach((node) => {
            if (node.type.name === 'paragraph') allParas.push(node.textContent)
          })
          // pIdx-1 is the 0-based current (new empty) paragraph; pIdx-2 is the just-completed one.
          const completedText = (allParas[pIdx - 2] ?? '').trim()
          if (completedText.length > 0) {
            const wordCount = completedText.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

            const takeParaSnapshot = (summaryFn: () => Promise<string>) => {
              enqueueSnapshotWork(async () => {
                const snap = await createSnapshotIfChanged(docRef.current, 'paragraph', sessionRef.current?.receipts ?? [])
                if (!snap) return
                setSnapshots((prev) => [...prev, snap])
                const stamped = await stampSnapshot(snap.documentId, snap.id)
                if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? stamped : s)))
                mirrorIfActive()
                // Async summary — patch when it resolves (does not block the snapshot chain).
                summaryFn().then((summary) => {
                  if (!summary) return
                  enqueueSnapshotWork(async () => {
                    const patched = await patchSnapshotSummary(docRef.current.id, snap.id, summary)
                    if (patched) setSnapshots((prev) => prev.map((s) => (s.id === patched.id ? patched : s)))
                  })
                }).catch(() => {})
              })
            }

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
    const upd = () => setSelectionEmpty(editor.state.selection.empty)
    const onSel = () => setSelectionEmpty(editor.state.selection.empty)
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

  // Keep the caret above the keyboard / bottom toolbar. While the keyboard is up, if typing or
  // a caret move would put the caret below the keyboard top (or the visible bar above it),
  // scroll down just enough to lift it back into view. Reads live values via refs so the
  // editor subscription can be set up once. No-op while the keyboard is down (desktop too).
  const keepCaretRef = useRef<() => void>(() => {})
  keepCaretRef.current = () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed || !keyboardUpRef.current) return
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
    return () => { editor.off('selectionUpdate', onChange); editor.off('update', onChange); cancelAnimationFrame(raf) }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal gate (see `settled` above): fonts.ready + first pagination measure, capped at 1.2s.
  useEffect(() => {
    if (!editor) return
    let done = false
    const finish = () => { if (!done) { done = true; setSettled(true) } }
    const cap = setTimeout(finish, 1200)
    const fontsReady: Promise<unknown> = (typeof document !== 'undefined' && document.fonts?.ready) || Promise.resolve()
    const paginationReady: Promise<void> = gappedPagesEnabled()
      ? ((window as unknown as { __iwPaginationReady?: boolean }).__iwPaginationReady
        ? Promise.resolve()
        : new Promise((res) => {
            const on = () => { window.removeEventListener('inkwave:pagination-ready', on); res() }
            window.addEventListener('inkwave:pagination-ready', on)
          }))
      : Promise.resolve()
    void Promise.all([fontsReady, paginationReady]).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(finish)), // one clean frame after the last reflow
    )
    return () => clearTimeout(cap)
  }, [editor])

  // Live word count for the record panel. Debounced: getText() walks the whole doc, and a panel
  // readout doesn't need per-keystroke precision — 300ms after the last edit is indistinguishable.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const count = () => { const m = editor.getText().match(/[\p{L}\p{N}]+/gu); setWordCount(m ? m.length : 0) }
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(count, 300) }
    count()
    editor.on('update', schedule)
    return () => { editor.off('update', schedule); if (timer) clearTimeout(timer) }
  }, [editor])
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
  // When the keyboard opens, the caret may already be behind it — lift it once.
  useEffect(() => {
    if (keyboardUp) requestAnimationFrame(() => keepCaretRef.current())
  }, [keyboardUp])

  // Track the paper's right edge in viewport coords (used to position the options menu).
  useEffect(() => {
    function update() {
      if (paperRef.current)
        setPaperRight(paperRef.current.getBoundingClientRect().right)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])


  // Show the style bar briefly when the editor first loads, then auto-retreat.
  useEffect(() => {
    if (!editor) return
    setStyleBarOpen(true)
    armStyleTimer()
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

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
      title: deriveTitle(e.state.doc.firstChild?.textContent ?? '') || docRef.current.title,
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
  const refreshSnapshots = async (docId: string) => { setSnapshots(await listSnapshots(docId)) }

  // Load existing snapshots when the document opens / switches. The LIST loads EAGERLY — rapid snapshot
  // scrubbing is a core feature, so the reviewer never waits for it. The OTS Bitcoin re-check does NOT
  // run here: it re-writes the compressed snapshot file per snapshot + does serial calendar round-trips
  // (~10s), which was the startup lag. It now runs only when the receipts panel is opened (runOtsSweep),
  // throttled. New snapshots are still stamped on creation, so nothing is lost by not sweeping on load.
  useEffect(() => {
    const docId = doc.id
    let cancelled = false
    void listSnapshots(docId).then((s) => { if (!cancelled) setSnapshots(s) })
    return () => { cancelled = true }
  }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot trigger: on a resolved kick, snapshot if the content hash changed (M1), then anchor it
  // to Bitcoin via OpenTimestamps (M2 → pending in seconds). Ordinary typing / pastes resolve no
  // kick, so they never snapshot.
  useEffect(() => {
    if (!editor) return
    const off = scasRef.current!.nudges.on((event) => {
      periodKicksRef.current.push(event) // buffer this kick for the signing call below
      const prevSnap = snapshotsRef.current[snapshotsRef.current.length - 1] ?? null
      enqueueSnapshotWork(async () => {
        // Sign now so the snapshot's bundleHash anchors the receipt covering this kick (M3).
        await runPeriodRef.current()
        const nudgeWord = event.replacement ? { from: event.lemma, to: event.replacement } : undefined
        const snap = await createSnapshotIfChanged(docRef.current, 'word-nudge', [...priorReceiptsRef.current, ...(sessionRef.current?.receipts ?? [])], undefined, false, nudgeWord)
        if (!snap) return
        setSnapshots((prev) => [...prev, snap])
        const stamped = await stampSnapshot(snap.documentId, snap.id) // pending proof
        if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? stamped : s)))
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
    const prevSnap = snapshotsRef.current[snapshotsRef.current.length - 1] ?? null
    enqueueSnapshotWork(async () => {
      const snap = await createSnapshotIfChanged(docRef.current, 'manual', sessionRef.current?.receipts ?? [], undefined, true)
      if (!snap) return
      setSnapshots((prev) => [...prev, snap])
      const stamped = await stampSnapshot(snap.documentId, snap.id)
      if (stamped) setSnapshots((prev) => prev.map((s) => (s.id === stamped.id ? stamped : s)))
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

  // Export the self-verifying bundle (content + snapshots + receipts + key ref) for /verify (M4).
  // Uses the async variant so embedded source PDFs travel inside the .studio file.
  async function exportBundle(stripPdfs?: 'all' | 'public', gzip?: boolean) {
    const bundle = await buildExportBundleWithPdfs(docRef.current, snapshots, stripPdfs)
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
      void listSnapshots(docRef.current.id)
        .then((snaps) => writeBundleToFile(docRef.current, snaps))
        // A failed write means permission lapsed — stop claiming "synced" and prompt a reconnect.
        .then((ok) => { if (ok) { setLastFileSave(Date.now()); setDocSource(docRef.current.id, 'local') } else { folderActiveRef.current = false; setNeedsReconnect(true) } })
        .catch(() => { folderActiveRef.current = false; setNeedsReconnect(true) })
    }
    if (oneDriveActiveRef.current) scheduleOneDriveSync()
    if (gdriveActiveRef.current) {
      void listSnapshots(docRef.current.id)
        .then((snaps) => syncToGoogleDrive(docRef.current, snaps))
        .then((r) => { if (r.ok) { setLastGdriveSync(Date.now()); setGdriveUrl(r.webUrl) } })
        .catch(() => {})
    }
  }

  // Throttled OneDrive write: at most one PUT per interval, with a trailing flush so the final state
  // always lands. Fewer writes ⇒ fewer races with the OneDrive desktop client ⇒ no machine-name copies.
  const ONEDRIVE_MIN_INTERVAL = 20_000
  function oneDriveWriteNow() {
    oneDriveLastWriteRef.current = Date.now()
    void listSnapshots(docRef.current.id)
      .then((snaps) => syncToOneDrive(docRef.current, snaps))
      .then((r) => { if (r.ok) { setLastSync(Date.now()); setOneDriveUrl(r.webUrl) } })
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
    const snaps = await listSnapshots(docRef.current.id)
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
    const snaps = await listSnapshots(docRef.current.id)
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
    const snaps = await listSnapshots(docRef.current.id)
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
    const prev = document.title
    document.title = (docRef.current.title || 'inkwave').trim()
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }
  // Export PDF → server-rendered, selectable-text A4 PDF in a new tab (no print dialog). Falls back to
  // the browser print dialog if the /api/pdf route is unavailable (e.g. local dev with no Chrome).
  async function exportPdf() {
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
  async function onGdriveFileOpen(f: { id: string; name: string; folderId: string; folderName: string }) {
    const text = await downloadGoogleDriveFile(f.id)
    if (!text) return
    void addRecentGDriveFolder({ id: f.folderId === 'root' ? '' : f.folderId, name: f.folderName })
    try {
      await openInkwaveFile(new File([text], f.name, { type: 'text/plain' }), { googleFileId: f.id })
    } catch (err) {
      setFileOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
    }
  }
  // Upload from OneDrive (esp. phone). Open the file browser; on pick, download + adopt + resume.
  async function uploadFromOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setOdOpenerOpen(true)
  }
  async function onOneDriveFileOpen(f: { itemId: string; name: string; folder: OneDriveFolder }) {
    const text = await downloadOneDriveFile(f.itemId)
    if (!text) return
    void addRecentFolder(f.folder)
    try {
      await openInkwaveFile(new File([text], f.name, { type: 'text/plain' }), { oneDriveFile: { folder: f.folder, name: f.name } })
    } catch (err) {
      setFileOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
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
        void listSnapshots(docRef.current.id)
          .then((s) => syncToOneDrive(docRef.current, s))
          .then((r) => {
            if (r.ok) {
              setLastSync(Date.now()); setOneDriveUrl(r.webUrl)
              oneDriveActiveRef.current = true
              // We just returned from the Microsoft sign-in redirect → open the OneDrive folder picker.
              setFolderPickerOpen(true)
            }
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
    const snaps = await listSnapshots(docRef.current.id)
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
    const snaps = await listSnapshots(docRef.current.id)
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
    const snaps = await listSnapshots(docRef.current.id)
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
    })
    return () => { cancelled = true }
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
      const snaps = await listSnapshots(docId)
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
      }
      if (badSessions.size && !cancelled && docRef.current.id === docId) {
        const cleanReceipts = (docRef.current.scasReceipts ?? []).filter(
          (r) => !badSessions.has(r.sessionToken),
        )
        // Remove snapshots that only embed bad-session receipts (so content integrity passes)
        const snapsAfterRecovery = await listSnapshots(docId)
        for (const s of snapsAfterRecovery) {
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
  // "no text selection" for the style bar.
  const selNode = (editor?.state.selection as unknown as { node?: { type: { name: string } } } | undefined)?.node
  const selIsAtomNode = !!selNode && ['citation', 'referenceList', 'mathInline', 'mathBlock'].includes(selNode.type.name)
  // On phone with keyboard up + text selected: show ONLY the style bar (not the full toolbar).
  // styleBarOpen keeps the main row alive while the user is actively formatting.
  const selectionOnPhone = isTouch && keyboardUp && !selectionEmpty && !selIsAtomNode
  const selectionOnDesktop = !isTouch && !!(editor?.state.selection && !editor.state.selection.empty) && !selIsAtomNode
  const showMainRow = !isTouch || !keyboardUp || styleBarOpen
  // Style bar auto-expands on phone text selection or desktop text selection.
  const styleBarExpanded = (selectionOnPhone || selectionOnDesktop || styleBarOpen) && !!editor
  const barVisible = showMainRow || selectionOnPhone
  keyboardUpRef.current = keyboardUp
  barVisibleRef.current = barVisible

  return (
    <ComplianceContext.Provider value={compliance}>
      <div>
        {/* Faded seal on every printed/PDF page (hidden on screen; fixed → repeats per print page). */}
        <div className="print-seal" aria-hidden="true"><img src="/fav-128.png" alt="" /></div>
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
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 py-2 text-sm font-serif"
            style={{ background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#991b1b' }}
          >
            <span>⚠ {fileOpenError}</span>
            <button
              type="button"
              onClick={() => setFileOpenError(null)}
              className="underline whitespace-nowrap hover:opacity-70"
            >
              Dismiss
            </button>
          </div>
        )}
        <Scroll paperRef={paperRef} containerRef={containerRef} phone={isTouch} fill revealed={settled}>
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
          open={isTouch ? receiptOpen : undefined}
          onOpenChange={isTouch ? setReceiptOpen : undefined}
          hideTrigger={isTouch || keyboardUp}
        />

        {/* Review layer — mounted ONLY while the R button is on, so it does ZERO work during normal
            writing (it rescans the doc for comment marks, which was per-keystroke lag otherwise). */}
        {editor && reviewOpen && <CommentNotes editor={editor} paperRef={paperRef} />}
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
          className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none"
          style={{
            paddingBottom: isTouch ? 'env(safe-area-inset-bottom)' : `${28 * zoom}px`,
            // When the PDF panel is open: a side dock stops the centring box at its left edge
            // (--iw-pdf-room) so the toolbar recentres over the writing; a bottom dock lifts the whole
            // toolbar above it (--iw-pdf-room-bottom).
            right: 'var(--iw-pdf-room, 0px)',
            bottom: 'var(--iw-pdf-room-bottom, 0px)',
            transition: 'right 0.18s ease, bottom 0.18s ease',
          }}
        >
          <div
            ref={footerRef}
            className={`iw-nightable pointer-events-auto flex flex-col bg-white shadow-sm ${isTouch ? 'w-full' : ''}`}
            onPointerDown={isTouch ? (e) => {
              // Prevent the toolbar from stealing focus from the editor on iOS.
              // Without this, tapping a toolbar button dismisses the text selection
              // before the click handler fires, making formatting impossible.
              const pm = editor?.view.dom
              if (pm && (pm === document.activeElement || pm.contains(document.activeElement))) {
                e.preventDefault()
              }
            } : undefined}
            style={{
              border: '1px solid var(--iw-nightable-border, rgba(92, 45, 138, 0.75))',
              borderRadius: isTouch ? '15px 15px 0 0' : '15px',
              opacity: barVisible ? 1 : 0,
              pointerEvents: barVisible ? 'auto' : 'none',
              transition: 'opacity 160ms ease',
              // Counter browser zoom so the pill stays a constant physical size.
              // transform instead of zoom: zoom scales the positioned `bottom` offset, causing
              // the pill to drift up/down on zoom. transform does not affect the offset.
              // ×1.25 base = the "25% bigger pills" (buttons + text scale together).
              transform: `scale(${zoom * 1.12})`,
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
                <div className="flex items-center px-4 py-2 border-b border-stone-200">
                  {editor && <StyleBar editor={editor} onActivity={armStyleTimer} phone={isTouch} />}
                </div>
              </div>
            )}

            {/* Main toolbar row */}
            {showMainRow && (
            <div className={`flex items-center px-2 py-0.5 ${isTouch ? 'justify-between' : 'gap-0.5'}`}>
              {/* Mobile-only: ◈ snapshot trigger (leftmost) */}
              {isTouch && (
                <button
                  type="button"
                  onClick={() => setReceiptOpen(o => !o)}
                  className="flex items-center justify-center min-h-[44px]"
                  style={{ color: '#5c2d8a' }}
                  title="Provenance record"
                >
                  <span className="flex items-center justify-center w-[30px] h-[30px] rounded-full bg-white border border-[rgba(92,45,138,0.75)] text-sm">◈</span>
                </button>
              )}
              {/* ▲-in-circle: manage toolbar slots — thin popup shows only the off-toolbar buttons */}
              <div className="relative" ref={toolbarPickerRef}>
                <button type="button"
                  onClick={() => { setToolbarPickerOpen(o => !o); setStyleBarOpen(false); clearStyleTimer() }}
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
                  const available = ALL_SLOTS.filter(id => !toolbarSlots.includes(id))
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
                          draggable
                          onDragStart={() => { dragIdRef.current = id }}
                          onDragEnd={() => { dragIdRef.current = null }}
                          onClick={() => setToolbarPickerOpen(false)}
                        >
                          {id === 'guide' && <GuideMenu />}
                          {id === 'math' && <MathMenuButton editor={editor} />}
                          {id === 'bib' && (
                            <button type="button"
                              onClick={() => { setBibPanelOpen(o => !o) }}
                              className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${bibPanelOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                              title="Bibliography / citations"
                            >
                              <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-xs leading-none font-serif" style={{ fontStyle: 'italic' }}>‟</span>
                            </button>
                          )}
                          {id === 'receipt' && (
                            <button type="button"
                              onClick={() => { setReviewOpen(o => !o) }}
                              className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${reviewOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                              title="Review — comments & track changes"
                            >
                              <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">R</span>
                            </button>
                          )}
                          {id === 'page' && <PageMenu editor={editor ?? undefined} />}
                        </div>
                      ))}
                    </div>
                  )
                })()}</div>
              {/* Customisable slots — drag between slots or from the ▲ popup to reorder */}
              {toolbarSlots.map((slotId, slotIdx) => (
                <div key={slotId}
                  style={isTouch ? { maxWidth: '40px' } : undefined}
                  draggable
                  onDragStart={() => { dragIdRef.current = slotId }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const from = dragIdRef.current; dragIdRef.current = null
                    if (!from || from === slotId) return
                    const newSlots = [...toolbarSlots] as typeof toolbarSlots
                    const fromIdx = newSlots.indexOf(from as SlotId)
                    if (fromIdx >= 0) newSlots[fromIdx] = slotId  // swap: put old slot where new slot was
                    newSlots[slotIdx] = from as SlotId
                    updateSlots(newSlots)
                    setToolbarPickerOpen(false)
                  }}
                  onDragEnd={() => { dragIdRef.current = null }}
                >
                  {slotId === 'guide' && <GuideMenu />}
                  {slotId === 'math' && <MathMenuButton editor={editor} />}
                  {slotId === 'bib' && (
                    <button ref={bibBtnRef} type="button"
                      onClick={() => setBibPanelOpen(o => !o)}
                      className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${bibPanelOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                      title="Bibliography / citations"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-xs leading-none font-serif" style={{ fontStyle: 'italic' }}>‟</span>
                    </button>
                  )}
                  {slotId === 'receipt' && (
                    <button type="button"
                      onClick={() => setReviewOpen(o => !o)}
                      className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${reviewOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                      title="Review — comments & track changes"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">R</span>
                    </button>
                  )}
                  {slotId === 'page' && <PageMenu editor={editor ?? undefined} />}
                </div>
              ))}
              {/* s-in-circle: toggle the style bar; auto-retreats after 5 s of inactivity */}
              <button
                type="button"
                aria-pressed={styleBarOpen}
                onClick={() => { const next = !styleBarOpen; setStyleBarOpen(next); if (next) armStyleTimer(); else clearStyleTimer() }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${styleBarOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                title="Style"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">
                  S
                </span>
              </button>
              <SettingsMenu limitN={doc.scasLimitN} onLimitChange={handleLimitChange} />
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
                onFileOpenError={setFileOpenError}
              />
              <InstallPromptBanner installPrompt={installPrompt} />
            </div>
            )}

            {/* Review row — the SECOND row of the merged toolbar rectangle, shown while R is on. */}
            {editor && reviewOpen && <ReviewBar editor={editor} />}
          </div>
        </div>
        {verifyOpen && (
          <VerifyModal
            doc={docRef.current}
            snapshots={snapshots}
            onClose={() => setVerifyOpen(false)}
          />
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

function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  return first.slice(0, 80)
}


const INK = '#5c2d8a'
