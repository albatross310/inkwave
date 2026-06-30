import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useZoomScale } from './useZoomScale'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
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
import { RedHighlightExtension, SCAS_HINT_META } from './extensions/RedHighlightExtension'
import { PaginationExtension } from './extensions/PaginationExtension'
import { ListStyle } from './extensions/ListStyle'
import { gappedPagesEnabled } from './pageView'
import { applyCrossoutMode } from './crossout'
import { exportPdfToNewTab } from './exportPdf'
import { exportLatexDownload, exportEquationsDownload } from './exportLatex'
import type { HintState } from './extensions/RedHighlightExtension'
import { REFLOW_OPEN_MS, type LineRange } from './suggestions/ThesaurusPopover/popoverConstants'
import { ScasSlotMark } from './extensions/ScasSlotMark'
import { MathInline } from './extensions/MathInline'
import { MathBlock } from './extensions/MathBlock'
import { MathPasteHandler } from './extensions/MathPasteHandler'
import { TabIndent } from './extensions/TabIndent'
import { LineNumbers } from './extensions/LineNumbers'
import { Scroll, isTouchDevice } from './Scroll'
import { ThesaurusPopover } from './suggestions/ThesaurusPopover'
import { CaretGutter } from './CaretGutter'
import { prefetchSynonyms } from './suggestions/thesaurus'
import { LimitSelector } from '../components/LimitSelector'
import { OptionsMenu } from '../components/OptionsMenu'
import { StyleBar } from '../components/StyleBar'
import { GuideMenu } from '../components/GuideMenu'
import { ComplianceContext, useComplianceProvider } from '../scas/compliance'
import { ScasController } from '../scas/controller'
import { normalizeScasState, DEFAULT_SET_SIZE } from '../scas/state'
import { createSnapshotIfChanged, listSnapshots, stampSnapshot, drainUnstamped, upgradePending, patchSnapshotSummary, patchSnapshotDiffSummary } from '../provenance/snapshots'
import { summariseParagraph, summariseBullets, summariseDiff } from '../provenance/summarise'
import { ReceiptPanel } from '../components/ReceiptPanel'
import { SessionRunner } from '../provenance/session'
import { CadenceTap } from '../provenance/cadence'
import { cadenceTierActive, getClerkToken } from '../auth/entitlement'
import { buildExportBundle, bundleFilename, downloadBundle, pmToText } from '../provenance/bundle'
import { fileSaveAvailable, pickSaveFile, getSaveFileHandle, getSaveFileName, writeBundleToFile, readLocalHeartbeat } from '../storage/folder'
import { oneDriveConfigured, oneDriveAccount, syncToOneDrive, startOneDriveSignIn, oneDriveSyncPending, clearOneDriveSyncPending, oneDrivePath, setChosenFolder, addRecentFolder, renameOneDriveFile, oneDriveFilename, setOneDriveFilename, downloadOneDriveFile, readRemoteHeartbeat, type OneDriveFolder } from '../storage/onedrive'
import { googleDriveConfigured, startGoogleDriveSignIn, syncToGoogleDrive, clearGoogleDriveFile, setChosenGDriveFolder, gDriveFilename, renameGoogleDriveFile, downloadGoogleDriveFile, googleDriveFileId, addRecentGDriveFolder } from '../storage/gdrive'
import { isOtherDeviceActive } from '../sync/presence'
import { SyncStatus } from '../components/SyncStatus'
import { VerifyModal } from '../components/VerifyModal'
import { SettingsMenu } from '../components/SettingsMenu'
import { PageMenu } from '../components/PageMenu'
import { getLineHeight } from './lineHeight'
import { CitationNode } from './extensions/CitationNode'
import { CiteSuggestion } from './extensions/CiteSuggestion'
import { CiteAutocomplete } from '../components/CiteAutocomplete'
import { BibPanel } from '../components/BibPanel'
import { ZoteroSetup } from '../components/ZoteroSetup'
import { loadPersistedHandle } from '../citations/fileChannel'
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

// Wall-clock resample cadence for the rotating exclusion set S_v (v4 spec §4.2: 20–60 s).
const RESAMPLE_INTERVAL_MS = 30_000

// ─── Toolbar slot customisation ───
type SlotId = 'bib' | 'guide' | 'math' | 'receipt'
const SLOT_KEY = 'inkwave-toolbar-slots'
const DEFAULT_SLOTS: [SlotId, SlotId] = ['bib', 'guide']
const ALL_SLOTS: SlotId[] = ['bib', 'guide', 'math', 'receipt']
const SLOT_LABELS: Record<SlotId, string> = {
  bib: '‟ References', guide: 'ⓘ Info', math: 'Σ Math', receipt: 'R Provenance',
}

function loadToolbarSlots(): [SlotId, SlotId] {
  try {
    const raw = localStorage.getItem(SLOT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length >= 2 &&
          (ALL_SLOTS as string[]).includes(parsed[0] as string) &&
          (ALL_SLOTS as string[]).includes(parsed[1] as string) &&
          parsed[0] !== parsed[1]) {
        return [parsed[0] as SlotId, parsed[1] as SlotId]
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
    document.title = `Inkwave Solo: ${tabName}`
  }, [doc.title, doc.id, fileName])
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
  const [needsReconnect, setNeedsReconnect] = useState(false) // linked file exists but write permission lapsed

  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0)
  const [cycleActive, setCycleActive] = useState(false)
  const [paperRight, setPaperRight] = useState(0)
  // Mobile toolbar: controlled open state for the ◈ and ☁ triggers embedded in the toolbar.
  const [receiptOpen, setReceiptOpen] = useState(false)
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
  const [zoteroSetupOpen, setZoteroSetupOpen] = useState(false)
  const [citationStyle, setCitationStyle] = useState(doc.citationStyle ?? 'apa')

  useEffect(() => {
    loadPersistedHandle().catch(() => {})
  }, [])

  // Toolbar customisation slots
  const [toolbarSlots, setToolbarSlots] = useState<[SlotId, SlotId]>(loadToolbarSlots)
  const [toolbarPickerOpen, setToolbarPickerOpen] = useState(false)
  const toolbarPickerRef = useRef<HTMLDivElement>(null)

  function updateSlots(newSlots: [SlotId, SlotId]) {
    setToolbarSlots(newSlots)
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(newSlots)) } catch {}
  }

  function addToSlots(id: SlotId) {
    const [s1, s2] = toolbarSlots
    if (s1 === id || s2 === id) return
    updateSlots([id, s1]) // newest in slot1; old slot1 bumps to slot2; old slot2 drops
  }

  function swapSlots() {
    updateSlots([toolbarSlots[1], toolbarSlots[0]])
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
      const current = docRef.current

      // ── Insignia (paid): keystroke-cadence tap ───────────────────────────────
      // Fold this transaction's steps into the current 0.5s cadence bin. Counts only — never chars.
      // Inert for the free tier (cadenceTierActive() false → tap never created).
      if (cadenceTierActive()) {
        if (!cadenceTapRef.current) cadenceTapRef.current = new CadenceTap()
        cadenceTapRef.current.record(transaction.steps)
      }

      // ── SCAS: drive the engine off the committed words ───────────────────────
      // Only on a real content change (skip the no-op SCAS_HINT_META repaint we dispatch below,
      // which would otherwise re-enter here with docChanged=false).
      let scasState = current.scasState
      if (transaction.docChanged) {
        const scas = scasRef.current!
        const size = e.state.doc.content.size
        const hadDeletion = prevDocSizeRef.current >= 0 && size < prevDocSizeRef.current
        prevDocSizeRef.current = size
        if (scas.processDoc(e.state.doc, e.state.selection.from, hadDeletion)) {
          scasState = scas.state
          // The decoration plugin already ran for THIS transaction with the pre-update lookup;
          // repaint with the new state in a microtask (avoids dispatching mid-dispatch).
          queueMicrotask(() => {
            if (!e.isDestroyed) e.view.dispatch(e.state.tr.setMeta(SCAS_HINT_META, true))
          })
        }
      }

      const base: InkwaveDocument = {
        ...current,
        contentJson: e.getJSON(),
        updatedAt: new Date().toISOString(),
        title: deriveTitle(e.getText()) || current.title,
        scasState,
      }
      const { doc: updated } = embedBibliography(base)
      docRef.current = updated
      onDocChange(updated)
      scheduleSave(updated)
      void upsertMeta({
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt,
      })

      // Prefetch synonyms for all visible red words after a short pause.
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = setTimeout(() => {
        const words = Array.from(
          e.view.dom.querySelectorAll<HTMLElement>('.scas-red')
        ).map(el => el.dataset.word ?? '').filter(Boolean)
        if (words.length > 0) prefetchSynonyms([...new Set(words)])
      }, 600)

      const { $from } = e.state.selection
      let pIdx = 0
      e.state.doc.nodesBetween(0, $from.pos, (node) => {
        if (node.type.name === 'paragraph') pIdx++
      })
      setCurrentParagraphIndex(Math.max(0, pIdx - 1))

      // ── Paragraph snapshot: fire when Enter creates a new top-level paragraph ──
      if (transaction.docChanged) {
        // Collect all top-level paragraphs so we can extract the just-completed one.
        const allParas: string[] = []
        e.state.doc.forEach((node) => {
          if (node.type.name === 'paragraph') allParas.push(node.textContent)
        })
        const paraCount = allParas.length
        const prev = prevParaCountRef.current
        prevParaCountRef.current = paraCount

        // Only trigger on a single new paragraph (Enter key, not paste of multiple blocks).
        if (paraCount === prev + 1 && pIdx >= 2) {
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

  // Live word count for the record panel.
  useEffect(() => {
    if (!editor) return
    const count = () => { const m = editor.getText().match(/[\p{L}\p{N}]+/gu); setWordCount(m ? m.length : 0) }
    count()
    editor.on('update', count)
    return () => { editor.off('update', count) }
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

  // Serialise all snapshot-file mutations through one promise chain (avoids OPFS read-modify-write
  // races between snapshot creation, OTS stamping, and upgrades).
  function enqueueSnapshotWork(work: () => Promise<void>) {
    snapQueueRef.current = snapQueueRef.current
      .then(work)
      .catch((err) => { console.warn('[inkwave] snapshot work failed:', err) })
  }
  const refreshSnapshots = async (docId: string) => { setSnapshots(await listSnapshots(docId)) }

  // Load existing snapshots when the document opens / switches, then (online) stamp any unstamped
  // backlog and upgrade pending proofs toward Bitcoin confirmation.
  useEffect(() => {
    const docId = doc.id
    void listSnapshots(docId).then(setSnapshots)
    enqueueSnapshotWork(async () => {
      await drainUnstamped(docId)
      await upgradePending(docId)
      await refreshSnapshots(docId)
    })
  }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot trigger: on a resolved kick, snapshot if the content hash changed (M1), then anchor it
  // to Bitcoin via OpenTimestamps (M2 → pending in seconds). Ordinary typing / pastes resolve no
  // kick, so they never snapshot.
  useEffect(() => {
    if (!editor) return
    const off = scasRef.current!.nudges.on((event) => {
      periodKicksRef.current.push(event) // buffer for the next signed period (M3)
      const prevSnap = snapshotsRef.current[snapshotsRef.current.length - 1] ?? null
      enqueueSnapshotWork(async () => {
        // Anchor the receipt chain so far into the snapshot's bundleHash (so OTS commits to it).
        const nudgeWord = event.replacement ? { from: event.lemma, to: event.replacement } : undefined
        const snap = await createSnapshotIfChanged(docRef.current, 'word-nudge', sessionRef.current?.receipts ?? [], undefined, false, nudgeWord)
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

  // Export the self-verifying bundle (content + snapshots + receipts + key ref) for /verify (M4).
  function exportBundle() {
    const bundle = buildExportBundle(docRef.current, snapshots)
    downloadBundle(bundle, bundleFilename(docRef.current))
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
    // Remember the file's folder as a Recent folder ('root' → '' to match the picker's root id).
    void addRecentGDriveFolder({ id: f.folderId === 'root' ? '' : f.folderId, name: f.folderName })
    await openInkwaveFile(new File([text], f.name, { type: 'text/plain' }), { googleFileId: f.id })
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
    void addRecentFolder(f.folder) // opening from a folder makes it a "Recent folder" too, not just saving
    await openInkwaveFile(new File([text], f.name, { type: 'text/plain' }), { oneDriveFile: { folder: f.folder, name: f.name } })
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
    void (async () => {
      const snaps = await listSnapshots(docRef.current.id)
      const r = await syncToGoogleDrive(docRef.current, snaps)
      if (r.ok) {
        gdriveActiveRef.current = true
        oneDriveActiveRef.current = false
        setGdriveActive(true)
        setLastGdriveSync(Date.now())
        setGdriveUrl(r.webUrl)
      }
    })()
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
        void listSnapshots(docRef.current.id)
          .then((s) => syncToOneDrive(docRef.current, s))
          .then((r) => { if (r.ok) { oneDriveActiveRef.current = true; setLastSync(Date.now()); setOneDriveUrl(r.webUrl) } })
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
      const snaps = await listSnapshots(docRef.current.id)
      if (await writeBundleToFile(docRef.current, snaps)) setLastFileSave(Date.now())
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
    void SessionRunner.open(docId).then((runner) => {
      if (cancelled || !runner || docRef.current.id !== docId) return
      sessionRef.current = runner
      scasRef.current!.useServerSet(runner.current.lemmas, runner.current.setVersion)
      if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_HINT_META, true))
    })
    return () => { cancelled = true }
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // The signing period. With a session: sign the period's receipt (content + resolved kicks), chain
  // it, and adopt the next server-issued set. Without one: fall back to a local resample (M0).
  // Verdicts are frozen (locked ∪ liveKicks persist), so neither reflows committed text. Held in a
  // ref so the interval always runs the latest closure (no stale editor/refs).
  const runPeriodRef = useRef<() => void>(() => {})
  runPeriodRef.current = () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const runner = sessionRef.current
    if (runner) {
      void (async () => {
        const kicks = periodKicksRef.current
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
        if (!receipt) return // offline — keep the kicks buffered, retry next period
        periodKicksRef.current = []
        scasRef.current!.useServerSet(
          applyNLimit(runner.current.lemmas, docRef.current.scasSetSize ?? 0),
          runner.current.setVersion,
        )
        setReceipts([...runner.receipts])
        const updated: InkwaveDocument = {
          ...docRef.current,
          scasState: scasRef.current!.state,
          scasReceipts: [...runner.receipts],
        }
        docRef.current = updated
        onDocChange(updated)
        scheduleSave(updated)
        mirrorIfActive()
        if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(SCAS_HINT_META, true))
      })()
    } else {
      scasRef.current!.resampleNow()
      const updated: InkwaveDocument = { ...docRef.current, scasState: scasRef.current!.state }
      docRef.current = updated
      onDocChange(updated)
      scheduleSave(updated)
    }
  }
  useEffect(() => {
    if (!editor) return
    const id = setInterval(() => runPeriodRef.current(), RESAMPLE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // On phone with keyboard up + text selected: show ONLY the style bar (not the full toolbar).
  // styleBarOpen keeps the main row alive while the user is actively formatting.
  const selectionOnPhone = isTouch && keyboardUp && !selectionEmpty
  const showMainRow = !isTouch || !keyboardUp || styleBarOpen
  // Style bar auto-expands on phone text selection (no S button toggle needed in that case).
  const styleBarExpanded = (selectionOnPhone || styleBarOpen) && !!editor
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
        <Scroll paperRef={paperRef} containerRef={containerRef} phone={isTouch}>
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
              onCycleChange={setCycleActive}
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
                displayName={doc.title || fileName}
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
            <SyncStatus compact={isTouch} label="☁ disconnected" synced={false} tooltip="OneDrive — sign in to sync" onClick={syncOneDrive} {...syncProps} />
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
          style={{ paddingBottom: isTouch ? 'env(safe-area-inset-bottom)' : '28px' }}
        >
          <div
            ref={footerRef}
            className={`pointer-events-auto flex flex-col bg-white shadow-sm ${isTouch ? 'w-full' : ''}`}
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
              border: '1px solid rgba(92, 45, 138, 0.75)',
              borderRadius: isTouch ? '15px 15px 0 0' : '15px',
              opacity: barVisible ? 1 : 0,
              pointerEvents: barVisible ? 'auto' : 'none',
              transition: 'opacity 160ms ease',
              // Counter browser zoom so the pill stays a constant physical size.
              // transform instead of zoom: zoom scales the positioned `bottom` offset, causing
              // the pill to drift up/down on zoom. transform does not affect the offset.
              transform: `scale(${zoom})`,
              transformOrigin: 'bottom right',
            }}
          >
            {/* Style bar — animates down/up; max-height:0 collapses it without removing from DOM.
                Auto-expands on phone text-selection even when the main toolbar row is hidden. */}
            {(showMainRow || selectionOnPhone) && (
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
                  className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                  style={{ color: '#5c2d8a' }}
                  title="Provenance record"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgba(92,45,138,0.75)] text-base">◈</span>
                </button>
              )}
              {/* Customisable slots — drag between slots or from the ▲ popup to reorder */}
              {toolbarSlots.map((slotId, slotIdx) => (
                <div key={slotId}
                  draggable
                  onDragStart={() => { dragIdRef.current = slotId }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const from = dragIdRef.current; dragIdRef.current = null
                    if (!from || from === slotId) return
                    const [s1, s2] = toolbarSlots
                    const newSlots: [SlotId, SlotId] = slotIdx === 0
                      ? [from, s2 === from ? s1 : s2]
                      : [s1 === from ? s2 : s1, from]
                    updateSlots(newSlots)
                    setToolbarPickerOpen(false)
                  }}
                  onDragEnd={() => { dragIdRef.current = null }}
                >
                  {slotId === 'guide' && <GuideMenu />}
                  {slotId === 'math' && <MathMenuButton editor={editor} />}
                  {slotId === 'bib' && (
                    <button type="button"
                      onClick={() => setBibPanelOpen(o => !o)}
                      className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${bibPanelOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                      title="Bibliography / citations"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-xs leading-none font-serif" style={{ fontStyle: 'italic' }}>‟</span>
                    </button>
                  )}
                  {slotId === 'receipt' && (
                    <button type="button"
                      onClick={() => setReceiptOpen(o => !o)}
                      className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${receiptOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                      title="Provenance record"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">R</span>
                    </button>
                  )}
                </div>
              ))}
              {/* ▲-in-circle: manage toolbar slots — thin popup shows only the 2 off-toolbar buttons */}
              <div className="relative" ref={toolbarPickerRef}>
                <button type="button"
                  onClick={() => { setToolbarPickerOpen(o => !o); setStyleBarOpen(false); clearStyleTimer() }}
                  className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${toolbarPickerOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                  title="Customise toolbar"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[13px] leading-none">▲</span>
                </button>
                {toolbarPickerOpen && (() => {
                  const available = ALL_SLOTS.filter(id => !toolbarSlots.includes(id))
                  return (
                    <div className="absolute bottom-full right-0 mb-2 bg-white shadow-md rounded-xl border border-stone-100 flex items-center z-[120]"
                      onMouseDown={e => e.stopPropagation()}>
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
                              onClick={() => { setReceiptOpen(o => !o) }}
                              className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${receiptOpen ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
                              title="Provenance record"
                            >
                              <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">R</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}</div>
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
              <PageMenu editor={editor ?? undefined} />
              <SettingsMenu limitN={doc.scasLimitN} onLimitChange={handleLimitChange} />
              {/* Mobile-only: ☁ sync trigger (right of guide, left of hamburger) */}
              {isTouch && (fileSaveAvailable() || gdriveActive || oneDriveConfigured()) && (
                <button
                  type="button"
                  onClick={() => setSyncOpen(o => !o)}
                  className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                  style={{ color: (fileSaveAvailable() ? !!lastFileSave && !needsReconnect : gdriveActive ? !!lastGdriveSync : !!lastSync) ? '#6b7280' : '#b45309' }}
                  title="Sync status"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[rgba(92,45,138,0.5)] text-base">☁</span>
                </button>
              )}
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
              />
              <InstallPromptBanner installPrompt={installPrompt} />
            </div>
            )}
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
        {bibPanelOpen && (
          <BibPanel
            doc={docRef.current}
            citationStyle={citationStyle}
            onStyleChange={s => {
              setCitationStyle(s)
              const updated = { ...docRef.current, citationStyle: s, updatedAt: new Date().toISOString() }
              docRef.current = updated
              onDocChange(updated)
              scheduleSave(updated)
            }}
            onConnectZotero={() => { setBibPanelOpen(false); setZoteroSetupOpen(true) }}
            onClose={() => setBibPanelOpen(false)}
          />
        )}
        {zoteroSetupOpen && <ZoteroSetup onClose={() => setZoteroSetupOpen(false)} />}
      </div>
    </ComplianceContext.Provider>
  )
}

function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  return first.slice(0, 80)
}

// ─── Math menu popup ─────────────────────────────────────────────────────────

import { getSymbols, deleteSymbol, setSymbol as saveSymbol, PRESETS, type MathSymbol } from './extensions/mathSymbols'

const MATH_ITEMS = [
  { label: 'Inline math',  hint: 'Alt+=',    action: (e: Editor) => e.commands.insertMathInline() },
  { label: 'Block math',   hint: 'Alt+⇧+=',  action: (e: Editor) => e.commands.insertMathBlock()  },
] as const

const INK = '#5c2d8a'

// MathLive inline shortcuts reference — type sequence then space to expand
// [sequence, rendered symbol or name, description]
const ML_SHORTCUT_SECTIONS: { title: string; rows: [string, string, string][] }[] = [
  { title: 'Greek (+ space)', rows: [
    ['alpha',   'α', ''], ['beta',    'β', ''], ['gamma',  'γ', ''], ['delta',  'δ', ''],
    ['epsilon', 'ε', ''], ['zeta',    'ζ', ''], ['eta',    'η', ''], ['theta',  'θ', ''],
    ['iota',    'ι', ''], ['kappa',   'κ', ''], ['lambda', 'λ', ''], ['mu',     'μ', ''],
    ['nu',      'ν', ''], ['xi',      'ξ', ''], ['pi',     'π', ''], ['rho',    'ρ', ''],
    ['sigma',   'σ', ''], ['tau',     'τ', ''], ['phi',    'φ', ''], ['chi',    'χ', ''],
    ['psi',     'ψ', ''], ['omega',   'ω', ''],
    ['Gamma',   'Γ', ''], ['Delta',   'Δ', ''], ['Theta',  'Θ', ''], ['Lambda', 'Λ', ''],
    ['Xi',      'Ξ', ''], ['Pi',      'Π', ''], ['Sigma',  'Σ', ''], ['Phi',    'Φ', ''],
    ['Psi',     'Ψ', ''], ['Omega',   'Ω', ''],
  ]},
  { title: 'Common symbols', rows: [
    ['oo',   '∞',  'infinity'],       ['+-',  '±',  'plus-minus'],
    ['xx',   '×',  'times'],          ['÷',   '÷',  'divide'],
    ['~~',   '≈',  'approx'],         ['!=',  '≠',  'not equal'],
    ['<=',   '≤',  'less or equal'],  ['>=',  '≥',  'greater or equal'],
    ['<<',   '≪',  'much less'],      ['>>',  '≫',  'much greater'],
    ['...',  '…',  'ellipsis'],       ['°',   '°',  'degree'],
    ['ii',   'i',  'imaginary i'],    ['ee',  'e',  "Euler's e"],
  ]},
  { title: 'Arrows', rows: [
    ['->',   '→',  ''],  ['<-',   '←',  ''],
    ['=>',   '⇒',  ''],  ['<=>',  '⟺',  'iff'],
    ['|->',  '↦',  'maps to'], ['uarr', '↑', ''], ['darr', '↓', ''],
  ]},
  { title: 'Sets & logic', rows: [
    ['in',   '∈',  ''],  ['!in',  '∉',  ''],
    ['uu',   '∪',  'union'],          ['nn',  '∩',  'intersect'],
    ['sub',  '⊂',  'subset'],         ['sup', '⊃',  'superset'],
    ['AA',   '∀',  'for all'],        ['EE',  '∃',  'exists'],
    ['!',    '¬',  'not'],
  ]},
  { title: 'Calculus', rows: [
    ['sum',   '∑',  ''],  ['int',   '∫',  ''],  ['prod',  '∏',  ''],
    ['del',   '∂',  ''],  ['nabla', '∇',  ''],
    ['lim',   'lim',''],  ['sqrt',  '√',  ''],
  ]},
  { title: 'Fractions & accents', rows: [
    ['1/2',  '½',  ''],   ['1/3',  '⅓',  ''],  ['2/3',  '⅔',  ''],
    ['1/4',  '¼',  ''],   ['3/4',  '¾',  ''],
    ['bar',  'x̄',  'overline'],  ['hat', 'x̂', ''],
    ['vec',  'x⃗',  ''],  ['dot',  'ẋ',  ''],
  ]},
  { title: 'Functions (expand on space)', rows: [
    ['sin','sin',''], ['cos','cos',''], ['tan','tan',''], ['log','log',''],
    ['ln','ln',''],   ['exp','exp',''], ['det','det',''], ['max','max',''],
    ['min','min',''], ['gcd','gcd',''],
  ]},
]

const ALIGN_OPTS = [
  { value: 'aligned', label: '=',  title: 'Align at =' },
  { value: 'center',  label: '⊙', title: 'Centre'     },
  { value: 'left',    label: '◁',  title: 'Left'       },
] as const

function MathMenuButton({ editor }: { editor: Editor | null }) {
  const [open, setOpen]           = useState(false)
  const [view, setView]           = useState<'menu' | 'symbols' | 'info'>('menu')
  const [symbols, setSymbols]     = useState<MathSymbol[]>([])
  const [newKey, setNewKey]       = useState('')
  const [newLatex, setNewLatex]   = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos]             = useState({ x: 0, y: 0 })

  const reload = () => setSymbols(getSymbols())

  const openMenu = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
    reload()
    setView('menu')
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, { passive: true })
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close) }
  }, [open])

  // Listen for symbol changes from the math input boxes.
  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('inkwave-symbols-changed', handler)
    return () => window.removeEventListener('inkwave-symbols-changed', handler)
  }, [])

  const addSymbol = () => {
    if (!newKey.trim() || !newLatex.trim()) return
    saveSymbol(newKey.trim(), newLatex.trim())
    setNewKey('')
    setNewLatex('')
    reload()
  }

  const removeSymbol = (key: string) => {
    deleteSymbol(key)
    reload()
  }

  const btn = (label: string, hint: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '6px 10px', borderRadius: '5px', border: 'none', background: 'transparent', cursor: 'pointer', gap: '16px', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(155,92,204,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: '0.9rem', color: '#3a3330' }}>{label}</span>
      <span style={{ fontSize: '0.7rem', color: '#a89d96', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{hint}</span>
    </button>
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        onMouseDown={e => e.preventDefault()}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Insert math"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none" style={{ fontFamily: 'serif' }}>Σ</span>
      </button>

      {open && createPortal(
        <div
          onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
          style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)', background: 'white', border: `1px solid ${INK}44`, borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '4px', zIndex: 200, minWidth: view === 'symbols' ? '280px' : '160px' }}
        >
          {view === 'menu' && (
            <>
              {MATH_ITEMS.map(item => btn(item.label, item.hint, () => { setOpen(false); if (editor) item.action(editor) }))}
              <div style={{ height: '1px', background: 'rgba(155,92,204,0.12)', margin: '4px 6px' }} />
              {/* Alignment — relevant when cursor is in a block math */}
              <div style={{ padding: '2px 8px 4px' }}>
                <div style={{ fontSize: '0.6rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>block alignment</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {ALIGN_OPTS.map(o => {
                    const cur = editor?.getAttributes('mathBlock').align
                    const active = cur === o.value
                    return (
                      <button key={o.value} type="button" title={o.title}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          // Dispatch custom event so the active math block picks it up
                          // even when ProseMirror's selection has moved to the math-field.
                          window.dispatchEvent(new CustomEvent('inkwave-math-align', { detail: { align: o.value } }))
                          // Also try via Tiptap selection (fallback for when no block is active)
                          editor?.chain().updateAttributes('mathBlock', { align: o.value }).run()
                          setOpen(false)
                        }}
                        style={{ fontSize: '0.72rem', padding: '2px 8px', border: `1px solid ${active ? INK : 'rgba(155,92,204,0.22)'}`, borderRadius: '4px', background: active ? 'rgba(155,92,204,0.10)' : 'transparent', color: active ? INK : '#8a7d74', cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
                      >{o.label}</button>
                    )
                  })}
                </div>
              </div>
              <div style={{ height: '1px', background: 'rgba(155,92,204,0.12)', margin: '4px 6px' }} />
              {btn('Shortcuts', '', () => setView('info'))}
            </>
          )}

          {view === 'info' && (
            <div style={{ padding: '6px 4px 4px', minWidth: '320px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 6px 8px', borderBottom: `1px solid ${INK}18` }}>
                <button type="button" onClick={() => setView('menu')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '0.8rem', padding: '0 2px' }}>←</button>
                <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace' }}>shortcuts</span>
              </div>
              <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '4px 0' }}>
                {ML_SHORTCUT_SECTIONS.map(({ title, rows }) => (
                  <div key={title} style={{ marginBottom: '10px' }}>
                    <div style={{ padding: '4px 10px 2px', fontSize: '0.58rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</div>
                    {rows.map(([k, sym, d]) => (
                      <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: '8px', padding: '1px 10px', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem', color: '#7a6e65', whiteSpace: 'nowrap' }}>{k}</span>
                        <span style={{ fontSize: '0.85rem', color: INK, minWidth: '1.2em', textAlign: 'center' }}>{sym}</span>
                        <span style={{ fontSize: '0.72rem', color: '#a89d96' }}>{d}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${INK}12`, marginTop: '4px', padding: '8px 10px 4px' }}>
                  <div style={{ fontSize: '0.62rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>Inkwave keys</div>
                  {([
                    ['hold CapsLock', 'Gk', 'Greek mode while held'],
                    ['//',  '\\frac',  'fraction'],
                    ['`',   '\\textsc','small caps'],
                    ['"',   '\\text', 'enter/exit text mode'],
                    ['space space', '·', 'text space'],
                    ['"name=\\cmd', '', 'define custom symbol'],
                    ['Ctrl+Q/E/L', '', 'block alignment'],
                  ] as [string, string, string][]).map(([k, sym, d]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: '8px', padding: '1px 0', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem', color: '#7a6e65', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontSize: '0.78rem', color: INK, minWidth: '1.2em', textAlign: 'center', fontFamily: 'ui-monospace,monospace' }}>{sym}</span>
                      <span style={{ fontSize: '0.72rem', color: '#a89d96' }}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === 'symbols' && (
            <div style={{ padding: '6px 4px 4px' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 6px 6px', borderBottom: `1px solid ${INK}18` }}>
                <button type="button" onClick={() => setView('menu')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '0.8rem', padding: '0 2px' }}>←</button>
                <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace' }}>symbols</span>
              </div>

              {/* User-defined symbols */}
              <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '4px 0' }}>
                {symbols.length === 0 && (
                  <div style={{ padding: '6px 10px', fontSize: '0.8rem', color: '#c0b8b0', fontStyle: 'italic' }}>none yet</div>
                )}
                {symbols.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', gap: '8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: INK }}>{s.key}</span>
                    <span style={{ fontSize: '0.75rem', color: '#7a6e65', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.latex}</span>
                    <button type="button" onClick={() => removeSymbol(s.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0b8b0', fontSize: '0.85rem', padding: '0 2px' }}>×</button>
                  </div>
                ))}
              </div>

              {/* Presets */}
              <div style={{ borderTop: `1px solid ${INK}12`, padding: '4px 0' }}>
                <div style={{ padding: '2px 8px', fontSize: '0.62rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em' }}>presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' }}>
                  {PRESETS.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.latex}
                      onClick={() => { saveSymbol(p.key, p.latex); reload() }}
                      style={{ fontSize: '0.72rem', padding: '2px 7px', border: `1px solid ${symbols.some(s => s.key === p.key) ? INK : 'rgba(155,92,204,0.2)'}`, borderRadius: '4px', background: symbols.some(s => s.key === p.key) ? 'rgba(155,92,204,0.10)' : 'transparent', color: symbols.some(s => s.key === p.key) ? INK : '#8a7d74', cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
                    >{p.key}</button>
                  ))}
                </div>
              </div>

              {/* Add new */}
              <div style={{ borderTop: `1px solid ${INK}12`, padding: '6px 8px 2px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="key"
                  onKeyDown={e => { if (e.key === 'Enter') addSymbol() }}
                  style={{ width: '56px', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', border: `1px solid ${INK}33`, borderRadius: '4px', padding: '3px 5px', outline: 'none' }}
                />
                <span style={{ color: '#b0a898', fontSize: '0.8rem' }}>=</span>
                <input
                  value={newLatex}
                  onChange={e => setNewLatex(e.target.value)}
                  placeholder="LaTeX"
                  onKeyDown={e => { if (e.key === 'Enter') addSymbol() }}
                  style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', border: `1px solid ${INK}33`, borderRadius: '4px', padding: '3px 5px', outline: 'none' }}
                />
                <button type="button" onClick={addSymbol}
                  style={{ background: INK, color: 'white', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>+</button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
