// OptionsMenu — kebab button at the right of the footer toolbar.
//
// Opens the app menu: About + conventional New / Open / Open Recent / Save. Document switching
// (open/new) persists the active id and reloads — the editor's loader (Edit.tsx) then opens it.

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readSnapshotArchive } from '../provenance/snapshots'
import { useNavigate } from 'react-router'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentMeta, InkwaveDocument } from '../types/document'
import { listMeta, upsertMeta } from '../storage/indexeddb'
import { saveDocument, emptyTiptapDoc } from '../storage/opfs'
import { withScasDefaults } from '../scas/state'
import { emailEnabled } from '../email/flag'
import { openInkwaveFile } from '../storage/openDoc'
import { isTouchDevice } from '../editor/Scroll'
import { oneDriveFilename } from '../storage/onedrive'
import { googleDriveConfigured, preloadGis } from '../storage/gdrive'
import { AccountMenuItems } from './AccountControl'
import { CLERK_PUBLISHABLE_KEY, clerkProviderMounted } from '../auth/config'
import { armHeadless } from '../auth/clerkHeadless'
import { getSaveFileName } from '../storage/folder'
import { getDocSource } from '../storage/docSource'
import { inkwaveFileName } from '../provenance/bundle'
import { switchTabToDocument, tabDocId } from '../storage/tabDoc'
import { OpfsInspector } from './OpfsInspector'

const INK = '#5c2d8a'
// Shared gap between a footer button and the panel it opens (same across all footer panels).
const PANEL_GAP = 14

type ModalKey = 'recent' | 'save' | 'upload' | 'savecopy' | 'export' | 'noprov' | 'provunread'
const MODAL_TITLES: Record<ModalKey, string> = { recent: 'Open Recent', save: 'Save', upload: 'Open', savecopy: 'Save a copy', export: 'Export', noprov: '', provunread: '' }

// Open via the native picker on Chromium (gives a WRITABLE handle so edits flow back to the file);
// fall back to the plain file input elsewhere (OneDrive still resumes via the preserved id + name).
async function openViaPicker(fileInput: HTMLInputElement | null): Promise<void> {
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }
  if (!w.showOpenFilePicker) { fileInput?.click(); return }
  let handle: FileSystemFileHandle
  try {
    ;[handle] = await w.showOpenFilePicker({
      multiple: false,
      // .gz belongs here: our own "🗜 Zipped" exports are .studio.gz, and parseStudioBuffer
      // gunzips by sniffing the magic bytes — without this the picker greys out our own exports.
      types: [{ description: 'Inkwave record', accept: { 'text/plain': ['.studio', '.inkwave', '.json'], 'application/gzip': ['.gz'] } }],
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return // user cancelled — fine
    fileInput?.click() // any other failure → fall back to the plain file input
    return
  }
  // Ask for write access now (in the click gesture) so edits can save back to this file.
  try { await (handle as unknown as { requestPermission?: (d: { mode: string }) => Promise<string> }).requestPermission?.({ mode: 'readwrite' }) } catch { /* read-only is fine */ }
  await openInkwaveFile(await handle.getFile(), { handle })
}

// Switch the active document by id and reload so the editor loads it cleanly (reliable for New /
// Open Recent). The writable-handle "Open…" path switches in place instead (see openInkwaveFile).
//
// The claim-for-this-tab + flush-first-and-ABORT-on-failure guard (2026-07-10) now lives in
// switchTabToDocument (tabDoc.ts), so this path and the OPFS inspector's "Open" cannot drift apart.
const openDocument = switchTabToDocument

async function createDocument(
  title: string,
  contentJson: InkwaveDocument['contentJson'],
  id: string = uuidv4(),
  // Extra document fields — used by "+ New email" to stamp `docType: 'email'` + empty headers.
  // An email is created through THIS path on purpose: it must be an ordinary document in every
  // respect (same storage, same meta index, same open flow) or none of the inherited behaviour
  // (edit history, provenance hashing, session capture) applies to it.
  extra: Partial<InkwaveDocument> = {},
): Promise<void> {
  const now = new Date().toISOString()
  const doc = withScasDefaults({
    id, title, contentJson, createdAt: now, updatedAt: now,
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: uuidv4(),
    ...extra,
  })
  await saveDocument(doc)
  await upsertMeta({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt })
  openDocument(doc.id)
}

export function OptionsMenu({
  paperRight,
  installPrompt,
  onExportBundle,
  onSave,
  onSaveAs,
  folderAvailable,
  folderName,
  onSyncOneDrive,
  onChooseOneDriveFolder,
  onSaveAsOneDrive,
  oneDriveAccount,
  onSyncGoogleDrive,
  onSaveAsGoogleDrive,
  onChooseGoogleDriveFolder,
  onUploadGoogleDrive,
  onUploadOneDrive,
  onPrint,
  onExportPdf,
  onExportLatex,
  onExportEquations,
  googleDriveActive,
  onVerifyRecord,
  onWorkReport,
  onFileOpenError,
}: {
  paperRight: number
  installPrompt?: any
  onExportBundle?: (stripPdfs?: 'all' | 'public', gzip?: boolean) => void
  onSave?: () => void
  onSaveAs?: () => void
  folderAvailable?: boolean
  folderName?: string | null
  onSyncOneDrive?: () => void
  onChooseOneDriveFolder?: () => void
  onSaveAsOneDrive?: () => void
  oneDriveAccount?: string | null
  onSyncGoogleDrive?: () => void
  onSaveAsGoogleDrive?: () => void
  onChooseGoogleDriveFolder?: () => void
  onUploadGoogleDrive?: () => void
  onUploadOneDrive?: () => void
  onPrint?: () => void
  onExportPdf?: () => void
  onExportLatex?: () => void
  onExportEquations?: () => void
  googleDriveActive?: boolean
  onVerifyRecord?: () => void
  /** Flag-gated work report (§A7.1). Absent ⇒ the menu item does not exist. */
  onWorkReport?: () => void
  onFileOpenError?: (msg: string) => void
}) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<ModalKey | null>(null)
  // The OPFS inspector is NOT a ModalKey: it is a full recovery panel with its own portal +
  // sizing, not one of the little drop-ups anchored over the kebab.
  const [inspector, setInspector] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Clicking the sync pill (SyncStatus) opens this Save menu.
  useEffect(() => {
    const open = () => { setMenuOpen(false); setModal('save') }
    window.addEventListener('inkwave:open-save', open)
    return () => window.removeEventListener('inkwave:open-save', open)
  }, [])

  // Warm the Google Identity script while a Drive-capable panel is open (menu, Save, Save a copy,
  // Open) — the eventual "Google Drive" tap then finds it cached, so requestAccessToken runs inside
  // the tap's transient activation and iOS Safari doesn't block the consent popup (see preloadGis).
  useEffect(() => {
    if ((menuOpen || modal === 'save' || modal === 'savecopy' || modal === 'upload') && googleDriveConfigured()) preloadGis()
  }, [menuOpen, modal])

  // Warm clerk-js the same way while the menu is open (headless path only — with the provider
  // mounted Clerk is already live). armHeadless is an idempotent singleton, so this either starts
  // the load early or no-ops; the eventual "Sign in" tap then finds Clerk ready and openSignIn runs
  // inside the tap's transient activation — no network wait between click and modal.
  useEffect(() => {
    if (menuOpen && CLERK_PUBLISHABLE_KEY && !clerkProviderMounted()) void armHeadless()
  }, [menuOpen])

  // Keyboard shortcuts: ⌘/Ctrl+S Save · ⌘/Ctrl+⇧S Save a copy · ⌘/Ctrl+O Open · ⌘/Ctrl+N New ·
  // ⌘/Ctrl+P Print. (Ctrl+N may be reserved by the browser for a new window and can't always be
  // intercepted.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'p') { e.preventDefault(); onPrint?.() }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); setModal('savecopy') }
      else if (k === 's') { e.preventDefault(); setModal('save') }
      else if (k === 'o') { e.preventDefault(); setModal('upload') }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); void createDocument('Untitled', emptyTiptapDoc()) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrint]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onOpenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      await openInkwaveFile(file)
    } catch (err) {
      onFileOpenError?.(err instanceof Error ? err.message : `Could not open "${file.name}"`)
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  // Two columns (Peter, 2026-07-10): RIGHT = file ops ending with Export; LEFT = the rest, ending
  // with Sign in/Logout (AccountMenuItems renders after the left column).
  const fileItems: Array<{ label: string; run: () => void }> = [
    { label: 'New', run: () => void createDocument('Untitled', emptyTiptapDoc()) },
    // An email is created exactly like any other document (§B2.1) — same path, one extra field.
    // Flag-gated, so the menu is unchanged until `?email=1`.
    ...(emailEnabled() ? [{
      label: 'New email',
      run: () => void createDocument('Untitled email', emptyTiptapDoc(), uuidv4(), {
        docType: 'email' as const,
        email: { to: [], cc: [], bcc: [], subject: '' },
      }),
    }] : []),
    { label: 'Open…', run: () => setModal('upload') },
    { label: 'Recent', run: () => setModal('recent') },
    { label: 'Save…', run: () => setModal('save') },
    { label: 'Save as…', run: () => setModal('savecopy') },
    { label: 'Export…', run: () => setModal('export') },
  ]
  const items: Array<{ label: string; run: () => void }> = [
    // Flag-gated (`?prodReport=1`, default OFF) — the free paste-back work report (§A7.1).
    ...(onWorkReport ? [{ label: 'Work report', run: onWorkReport }] : []),
    { label: 'Verify', run: () => onVerifyRecord ? onVerifyRecord() : navigate('/verify') },
    { label: 'About', run: () => navigate('/about') },
    { label: 'Privacy', run: () => navigate('/privacy') },
    { label: 'Print', run: () => onPrint?.() },
    // Peter's "opfs button" (2026-07-17) — named for what a WRITER is looking for, not for the
    // API. Every document this device is actually holding, including any the Recent list can't
    // see, with Open + Download on each. See OpfsInspector.tsx.
    { label: 'Storage', run: () => setInspector(true) },
    {
      label: 'Provenance',
      run: () => {
        // Open the snapshot view at the MOST RECENT snapshot of the active doc.
        void (async () => {
          try {
            const docId = tabDocId() // THIS tab's document — never whatever another tab last opened
            if (!docId) return
            // 'noprov' says "No snaps or provenance info yet recorded" — TRUE for a new document and
            // a LIE for a failed read, which is the whole distinction this lane exists for. The
            // archive read used to answer `[]` for both and this menu told the writer his thesis had
            // no history. Now the two answers are different, so the two messages are different.
            // (`catch` alone would be honest but silent: a menu item that does nothing at all.)
            const r = await readSnapshotArchive(docId)
            if (r.kind === 'error') { console.error('[inkwave] snapshots menu:', r.error); setModal('provunread'); return }
            const last = r.snapshots[r.snapshots.length - 1]
            if (last) window.open(`/snapshot?doc=${encodeURIComponent(docId)}&snap=${encodeURIComponent(last.id)}`, '_blank', 'noopener')
            else setModal('noprov')
          } catch { /* no snapshots yet */ }
        })()
      },
    },
  ]
  if (installPrompt) {
    items.push({
      label: 'Install app…',
      run: async () => {
        installPrompt.prompt()
        const { outcome } = await (installPrompt as any).userChoice
        if (outcome === 'accepted') { /* parent clears prompt via appinstalled event */ }
      },
    })
  }

  // Centre a panel horizontally over the kebab, clamped to the viewport, PANEL_GAP above the toolbar.
  // Shared by the menu AND its modals so both read as one continuous panel over the button.
  const EDGE_BUFFER = 10
  const panelAnchor = (): CSSProperties => {
    const br = btnRef.current?.getBoundingClientRect()
    const bottom = br ? Math.round(window.innerHeight - br.top + PANEL_GAP) : 60
    // Phone: hug the right edge (the ⋮ button is the rightmost control; the old centre-clamp used
    // HALF of the WIDEST panel, which shoved the little menu toward mid-screen — Peter, 2026-07-09).
    if (isTouchDevice()) return { position: 'fixed', bottom, right: EDGE_BUFFER }
    const HALF = 150 // ~half the widest panel, for edge clamping
    const center = br ? br.left + br.width / 2 : (paperRight || window.innerWidth / 2)
    return {
      position: 'fixed',
      bottom,
      left: Math.round(Math.max(EDGE_BUFFER + HALF, Math.min(window.innerWidth - EDGE_BUFFER - HALF, center))),
      transform: 'translateX(-50%)',
    }
  }
  const menuStyle: CSSProperties = { ...(menuOpen ? panelAnchor() : {}), border: `1px solid ${INK}66`, borderRadius: '10px' }

  return (
    <div ref={rootRef} className="relative" onPointerDown={e => e.stopPropagation()}>
      {/* Hidden input: "Open…" clicks it directly so the OS file dialog opens immediately (no drop zone).
          NO accept on touch/iOS: Safari maps accept extensions to registered UTIs, and .studio/.inkwave
          have none — every Inkwave file showed GREYED OUT in the iOS picker. Omitting accept makes all
          files selectable; openInkwaveFile validates by CONTENT, so a wrong pick just errors politely.
          Desktop keeps the extension filter for a tidier dialog. */}
      <input ref={fileInputRef} type="file" accept={isTouchDevice() ? undefined : '.studio,.inkwave,.gz,application/gzip,application/json,.json,.trace.json,.insig.json'} className="hidden" onChange={onOpenFile} />
      <button
        ref={btnRef} type="button" aria-label="Options" aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
        className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-stone-400 hover:text-[#5c2d8a] transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {menuOpen && createPortal(
        <>
          {/* Backdrop — dismiss on outside click; sits below the menu in the portal layer */}
          <div className="fixed inset-0 z-[55]" aria-hidden="true" onMouseDown={() => setMenuOpen(false)} />
          {/* Menu rendered in document.body so position:fixed is relative to the viewport,
              not the pill's CSS-transform context (which would break the coordinates). */}
          <div role="menu" className="iw-nightable iw-touch-guard iw-no-print z-[60] w-[11.5rem] py-0.5 bg-white shadow-md text-[17px] text-stone-600 font-serif flex" style={menuStyle}
            onMouseDown={e => e.stopPropagation()}>
            {/* LEFT column: Verify/About/Privacy/Print/Provenance … ending with Sign in/Logout. */}
            <div className="flex-1 border-r border-stone-100">
              {items.map(it => (
                <button key={it.label} role="menuitem" type="button"
                  onClick={() => { setMenuOpen(false); it.run() }}
                  className="w-full text-left pl-3 pr-1 py-1.5 hover:bg-stone-100 hover:text-[#5c2d8a] transition-colors"
                >
                  {it.label}
                </button>
              ))}
              <AccountMenuItems onClose={() => setMenuOpen(false)} />
            </div>
            {/* RIGHT column: file ops, ending with Export. */}
            <div className="flex-1">
              {fileItems.map(it => (
                <button key={it.label} role="menuitem" type="button"
                  onClick={() => { setMenuOpen(false); it.run() }}
                  className="w-full text-left pl-3 pr-1 py-1.5 hover:bg-stone-100 hover:text-[#5c2d8a] transition-colors"
                >
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {inspector && <OpfsInspector onClose={() => setInspector(false)} />}

      {modal && (
        <Modal title={MODAL_TITLES[modal]} anchorStyle={panelAnchor()} onClose={() => setModal(null)}>
          {modal === 'save' && <SavePanel onExportBundle={onExportBundle} onSave={onSave} folderAvailable={folderAvailable} folderName={folderName} onSyncOneDrive={onSyncOneDrive} onChooseOneDriveFolder={onChooseOneDriveFolder} oneDriveAccount={oneDriveAccount} onSyncGoogleDrive={onSyncGoogleDrive} onChooseGoogleDriveFolder={onChooseGoogleDriveFolder} googleDriveActive={googleDriveActive} onDone={() => setModal(null)} />}
          {modal === 'upload' && <UploadPanel onComputer={() => { void openViaPicker(fileInputRef.current); setModal(null) }} onGoogleDrive={onUploadGoogleDrive} onOneDrive={onUploadOneDrive} onDone={() => setModal(null)} />}
          {modal === 'savecopy' && <SaveCopyPanel folderAvailable={folderAvailable} onSaveAs={onSaveAs} onSaveAsOneDrive={onSaveAsOneDrive} onSaveAsGoogleDrive={onSaveAsGoogleDrive} onExportBundle={onExportBundle} onDone={() => setModal(null)} />}
          {modal === 'export' && <ExportPanel onExportPdf={onExportPdf} onExportLatex={onExportLatex} onExportEquations={onExportEquations} onExportBundle={onExportBundle} onDone={() => setModal(null)} />}
          {modal === 'recent' && <RecentPanel />}
          {modal === 'noprov' && (
            <div className="iw-nightable iw-no-print fixed z-[70] bg-white shadow-md rounded-xl border px-5 py-4 font-serif text-stone-600"
              style={{ bottom: 76, left: '50%', transform: 'translateX(-50%)', borderColor: '#5c2d8a44' }}>
              No snaps or provenance info yet recorded.
              <button type="button" onClick={() => setModal(null)} className="ml-4 text-stone-400 hover:text-stone-600">✕</button>
            </div>
          )}
          {modal === 'provunread' && (
            <div className="iw-nightable iw-no-print fixed z-[70] bg-white shadow-md rounded-xl border px-5 py-4 font-serif text-stone-600"
              style={{ bottom: 76, left: '50%', transform: 'translateX(-50%)', borderColor: '#5c2d8a44' }}>
              Couldn't read this document's history just now — it hasn't been lost. Try again in a moment.
              <button type="button" onClick={() => setModal(null)} className="ml-4 text-stone-400 hover:text-stone-600">✕</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function MenuButton({ onClick, children, title }: { onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} title={title}
      className="w-full text-left px-4 py-2.5 font-serif transition-colors disabled:opacity-40"
      style={{ border: `1px solid ${INK}55`, borderRadius: 10, color: INK }}
      onMouseOver={e => { if (onClick) e.currentTarget.style.background = '#faf7fd' }}
      onMouseOut={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function SavePanel({ onExportBundle, onSave, folderAvailable, folderName, onSyncOneDrive, onChooseOneDriveFolder, oneDriveAccount, onSyncGoogleDrive, onChooseGoogleDriveFolder, googleDriveActive, onDone }: {
  onExportBundle?: () => void; onSave?: () => void; folderAvailable?: boolean; folderName?: string | null
  onSyncOneDrive?: () => void; onChooseOneDriveFolder?: () => void; oneDriveAccount?: string | null
  onSyncGoogleDrive?: () => void; onChooseGoogleDriveFolder?: () => void; googleDriveActive?: boolean; onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <MenuButton onClick={onExportBundle ? () => { onExportBundle(); onDone() } : undefined}>
        ⤓ Download a copy<span className="block text-xs text-stone-400">a self-verifying file you can keep or check at /verify</span>
      </MenuButton>
      {/* Chromium (File System Access): native "Save to folder"; once linked it shows the file name. */}
      {folderAvailable && (
        <MenuButton onClick={onSave ? () => { onSave(); onDone() } : undefined}>
          {folderName ? `✓ Synced to ${folderName}` : 'Save to folder'}
          <span className="block text-xs text-stone-400">
            {folderName ? 'updates here automatically as you write' : 'choose where to save it; it updates there as you write'}
          </span>
        </MenuButton>
      )}
      {/* OneDrive only on browsers that need it (Firefox/Safari — no File System Access). */}
      {!folderAvailable && onSyncOneDrive && !oneDriveAccount && (
        <MenuButton onClick={() => { onSyncOneDrive(); onDone() }}>
          ☁ Sync to OneDrive<span className="block text-xs text-stone-400">sign in with Microsoft — works in Firefox &amp; Safari</span>
        </MenuButton>
      )}
      {!folderAvailable && oneDriveAccount && onChooseOneDriveFolder && (
        <MenuButton onClick={() => { onChooseOneDriveFolder(); onDone() }}>
          🗁 Choose OneDrive folder<span className="block text-xs text-stone-400">signed in as {oneDriveAccount} · syncs as you write</span>
        </MenuButton>
      )}
      {/* Google Drive — the other cross-platform option for Firefox/Safari. */}
      {!folderAvailable && onSyncGoogleDrive && !googleDriveActive && (
        <MenuButton onClick={() => { onSyncGoogleDrive(); onDone() }}>
          ▴ Sync to Google Drive<span className="block text-xs text-stone-400">sign in with Google — works in Firefox &amp; Safari</span>
        </MenuButton>
      )}
      {!folderAvailable && googleDriveActive && onChooseGoogleDriveFolder && (
        <MenuButton onClick={() => { onChooseGoogleDriveFolder(); onDone() }}>
          🗁 Choose Google Drive folder<span className="block text-xs text-stone-400">pick where it syncs · updates as you write</span>
        </MenuButton>
      )}
    </div>
  )
}

// Save a copy — a separate file that then stays updated; pick where it goes. (Consolidated here from
// the per-destination "Save a copy" buttons.)
function SaveCopyPanel({ folderAvailable, onSaveAs, onSaveAsOneDrive, onSaveAsGoogleDrive, onExportBundle, onDone }: {
  folderAvailable?: boolean; onSaveAs?: () => void
  onSaveAsOneDrive?: () => void; onSaveAsGoogleDrive?: () => void; onExportBundle?: () => void; onDone: () => void
}) {
  // Gated on the destination being CONFIGURED (handler present), not on it being currently active —
  // so you can save a copy to Drive/OneDrive even if you're not syncing there now (it signs in on click).
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <p className="text-xs text-stone-400 px-1">Save a separate copy that then keeps updating — pick where it goes.</p>
      {onExportBundle && (
        <MenuButton onClick={() => { onExportBundle(); onDone() }}>⤓ Download a copy<span className="block text-xs text-stone-400">a self-verifying file you can keep or check at /verify</span></MenuButton>
      )}
      {folderAvailable && onSaveAs && (
        <MenuButton onClick={() => { onSaveAs(); onDone() }}>🗁 This device<span className="block text-xs text-stone-400">a new file in a folder, then keep it updated</span></MenuButton>
      )}
      {onSaveAsOneDrive && (
        <MenuButton onClick={() => { onSaveAsOneDrive(); onDone() }}>☁ OneDrive<span className="block text-xs text-stone-400">name a new file in OneDrive, then keep it updated</span></MenuButton>
      )}
      {onSaveAsGoogleDrive && (
        <MenuButton onClick={() => { onSaveAsGoogleDrive(); onDone() }}>▴ Google Drive<span className="block text-xs text-stone-400">name a new file in Drive, then keep it updated</span></MenuButton>
      )}
    </div>
  )
}

// Export the finished document — a typeset PDF (printed on-device via the browser) or LaTeX source.
function ExportPanel({ onExportPdf, onExportLatex, onExportEquations, onExportBundle, onDone }: {
  onExportPdf?: () => void; onExportLatex?: () => void; onExportEquations?: () => void
  onExportBundle?: (stripPdfs?: 'all' | 'public', gzip?: boolean) => void; onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-2 mt-2">
      <p className="text-xs text-stone-400 px-1">Choose a format (hover for details).</p>
      {onExportPdf && (
        <MenuButton onClick={() => { onExportPdf(); onDone() }} title="A finished A4 document, selectable text. Our algorithm uses a highly curated version of the browser's print and print-to-PDF functions, so the document never leaves your device.">📄 PDF</MenuButton>
      )}
      {onExportLatex && (
        <MenuButton onClick={() => { onExportLatex(); onDone() }} title="A .tex source file to typeset yourself">∑ LaTeX</MenuButton>
      )}
      {onExportEquations && (
        <MenuButton onClick={() => { onExportEquations(); onDone() }} title="Block equations as a numbered list (.txt)">≡ Equations</MenuButton>
      )}
      {onExportBundle && (
        <>
          <MenuButton onClick={() => { onExportBundle('public'); onDone() }} title='A .studio without the PDFs you marked "publicly available" — smaller, safe to share'>🌐 Studio, public PDFs stripped</MenuButton>
          <MenuButton onClick={() => { onExportBundle('all'); onDone() }} title="A .studio with no embedded PDFs at all">📄✕ Document without PDFs</MenuButton>
          <MenuButton onClick={() => { onExportBundle('all', true); onDone() }} title="No PDFs, gzip-compressed — smallest, for emailing. Inkwave opens it directly">🗜 Zipped and no PDFs (.studio.gz)</MenuButton>
          <MenuButton onClick={() => { onExportBundle('public', true); onDone() }} title='"Publicly available" PDFs stripped, gzip-compressed. Inkwave opens it directly'>🗜 Zipped and public (.studio.gz)</MenuButton>
          <MenuButton onClick={() => { onExportBundle(undefined, true); onDone() }} title="Everything, gzip-compressed. Inkwave opens it directly">🗜 Zipped, with PDFs (.studio.gz)</MenuButton>
        </>
      )}
    </div>
  )
}

// Per-source mini logos + a label, shown on each recent file.
function DriveMini() {
  return (
    <svg viewBox="0 0 87.3 78" width="13" height="12" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}
function OneDriveMini() {
  return <svg viewBox="0 0 24 24" width="15" height="13" aria-hidden="true"><path fill="#0364B8" d="M6.6 19A4.6 4.6 0 0 1 5.8 9.9 6 6 0 0 1 17.7 8.8 4.6 4.6 0 0 1 18.2 19H6.6z" /></svg>
}
function ExplorerMini() {
  return <svg viewBox="0 0 24 24" width="14" height="13" aria-hidden="true"><path fill="#ffb900" d="M3 5h6l2 2h10v12H3z" /><path fill="#ffcf4d" d="M3 9h18v10H3z" /></svg>
}
const SOURCE_COLOR: Record<string, string> = { gdrive: '#5f6368', onedrive: '#0364B8', local: '#2b2b2b' }
function SourceTag({ source }: { source: string }) {
  const label = source === 'gdrive' ? 'Google Drive' : source === 'onedrive' ? 'OneDrive' : source === 'local' ? 'This PC' : ''
  if (!label) return null
  return (
    <span className="flex items-center gap-1 text-[11px] text-stone-400 whitespace-nowrap">
      {source === 'gdrive' ? <DriveMini /> : source === 'onedrive' ? <OneDriveMini /> : <ExplorerMini />}
      {label}
    </span>
  )
}

// Open a file and keep syncing to where it lives — no Save needed.
function UploadPanel({ onComputer, onGoogleDrive, onOneDrive, onDone }: { onComputer: () => void; onGoogleDrive?: () => void; onOneDrive?: () => void; onDone: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2.5">
      <p className="text-xs text-stone-400 px-1">Open a file — it keeps syncing to where it lives, so you only Save for a new file or a copy.</p>
      <MenuButton onClick={onComputer}>
        🗁 This device<span className="block text-xs text-stone-400">use Chrome/Edge/Brave to sync via Windows Explorer (incl. your Drive/OneDrive folders)</span>
      </MenuButton>
      {onOneDrive && (
        <MenuButton onClick={() => { onOneDrive(); onDone() }}>
          ☁ OneDrive<span className="block text-xs text-stone-400">pick a file from OneDrive — best on phone</span>
        </MenuButton>
      )}
      {onGoogleDrive && (
        <MenuButton onClick={() => { onGoogleDrive(); onDone() }}>
          ▴ Google Drive<span className="block text-xs text-stone-400">pick a file from Drive (incl. shared with you) — best on phone</span>
        </MenuButton>
      )}
    </div>
  )
}

function RecentPanel() {
  const [recents, setRecents] = useState<DocumentMeta[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  useEffect(() => {
    void listMeta().then(async (metas) => {
      setRecents(metas)
      // Show the FILE NAME, not the content preview: prefer the saved OneDrive/local file name,
      // else the .studio name the title would produce. Also tag each with where it's synced.
      const map: Record<string, string> = {}
      const src: Record<string, string> = {}
      for (const m of metas) {
        const local = await getSaveFileName(m.id)
        map[m.id] = oneDriveFilename(m.id) ?? local ?? inkwaveFileName(m.title)
        const s = getDocSource(m.id) ?? (local ? 'local' : null)
        if (s) src[m.id] = s
      }
      setNames(map)
      setSources(src)
    })
  }, [])
  return (
    <div className="mt-2 flex flex-col gap-1.5 max-h-72 overflow-auto">
      <MenuButton onClick={() => void createDocument('Untitled', emptyTiptapDoc())}>+ New document</MenuButton>
      {recents === null && <p className="text-sm text-stone-400 px-1">Loading…</p>}
      {recents?.length === 0 && <p className="text-sm text-stone-400 px-1">No documents yet.</p>}
      {recents?.map(m => (
        <button key={m.id} type="button" onClick={() => openDocument(m.id)}
          className="w-full text-left px-4 py-2 font-serif hover:bg-stone-50 transition-colors flex items-center justify-between gap-2"
          style={{ border: '1px solid #eee', borderRadius: 8 }}
        >
          <span className="min-w-0">
            <span className="block truncate" style={{ color: SOURCE_COLOR[sources[m.id]] ?? INK }}>{names[m.id] ?? inkwaveFileName(m.title)}</span>
            <span className="block text-xs text-stone-400">{new Date(m.updatedAt).toLocaleString()}</span>
          </span>
          {sources[m.id] && <SourceTag source={sources[m.id]} />}
        </button>
      ))}
    </div>
  )
}

function Modal({ title, onClose, children, anchorStyle }: { title: string; onClose: () => void; children: ReactNode; anchorStyle?: CSSProperties }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal to body so the backdrop reliably covers the viewport and catches outside clicks (not
  // trapped in the footer's pointer-events/stacking context). Positioned above the kebab (same anchor as
  // the menu) so it reads as one continuous panel.
  return createPortal(
    <div className="fixed inset-0 z-[100]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}
        className="iw-nightable bg-white w-[300px] max-w-[92vw] p-5 flex flex-col shadow-xl"
        style={{ ...anchorStyle, border: `1px solid ${INK}bf`, borderRadius: '14px' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-serif" style={{ color: INK }}>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-stone-400 hover:text-[#5c2d8a] text-2xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
