// OptionsMenu — kebab button at the right of the footer toolbar.
//
// Opens the app menu: About + conventional New / Open / Open Recent / Save. Document switching
// (open/new) persists the active id and reloads — the editor's loader (Edit.tsx) then opens it.

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentMeta, InkwaveDocument } from '../types/document'
import { listMeta, upsertMeta } from '../storage/indexeddb'
import { saveDocument, emptyTiptapDoc } from '../storage/opfs'
import { withScasDefaults } from '../scas/state'
import { openInkwaveFile } from '../storage/openDoc'
import { oneDriveFilename } from '../storage/onedrive'
import { AccountMenuItems } from './AccountControl'
import { getSaveFileName } from '../storage/folder'
import { getDocSource } from '../storage/docSource'
import { inkwaveFileName } from '../provenance/bundle'

const ACTIVE_DOC_KEY = 'inkwave:activeDocumentId'
const INK = '#5c2d8a'

type ModalKey = 'recent' | 'save' | 'upload' | 'savecopy' | 'export'
const MODAL_TITLES: Record<ModalKey, string> = { recent: 'Open Recent', save: 'Save', upload: 'Open', savecopy: 'Save a copy', export: 'Export' }

// Open via the native picker on Chromium (gives a WRITABLE handle so edits flow back to the file);
// fall back to the plain file input elsewhere (OneDrive still resumes via the preserved id + name).
async function openViaPicker(fileInput: HTMLInputElement | null): Promise<void> {
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }
  if (!w.showOpenFilePicker) { fileInput?.click(); return }
  let handle: FileSystemFileHandle
  try {
    ;[handle] = await w.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Inkwave record', accept: { 'text/plain': ['.studio', '.inkwave', '.json'] } }],
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
function openDocument(id: string) {
  try { localStorage.setItem(ACTIVE_DOC_KEY, id) } catch { /* private mode */ }
  window.location.reload()
}

async function createDocument(title: string, contentJson: InkwaveDocument['contentJson'], id: string = uuidv4()): Promise<void> {
  const now = new Date().toISOString()
  const doc = withScasDefaults({
    id, title, contentJson, createdAt: now, updatedAt: now,
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: uuidv4(),
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
}: {
  paperRight: number
  installPrompt?: any
  onExportBundle?: () => void
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
}) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<ModalKey | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Clicking the sync pill (SyncStatus) opens this Save menu.
  useEffect(() => {
    const open = () => { setMenuOpen(false); setModal('save') }
    window.addEventListener('inkwave:open-save', open)
    return () => window.removeEventListener('inkwave:open-save', open)
  }, [])

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
    try { await openInkwaveFile(file) } catch { /* ignore a bad file; user can retry */ }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const items: Array<{ label: string; run: () => void }> = [
    { label: 'New', run: () => void createDocument('Untitled', emptyTiptapDoc()) },
    { label: 'Open…', run: () => setModal('upload') },
    { label: 'Open Recent', run: () => setModal('recent') },
    { label: 'Save…', run: () => setModal('save') },
    { label: 'Save a copy…', run: () => setModal('savecopy') },
    { label: 'Export…', run: () => setModal('export') },
    { label: 'Print', run: () => onPrint?.() },
    { label: 'Verify a record', run: () => onVerifyRecord ? onVerifyRecord() : navigate('/verify') },
    { label: 'About', run: () => navigate('/about') },
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
  if (import.meta.env.DEV) {
    const on = typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:debugHighlightAll') === '1'
    items.push({
      label: `Debug: highlight all ${on ? '✓' : '✗'}`,
      run: () => { try { localStorage.setItem('inkwave:debugHighlightAll', on ? '0' : '1') } catch { /* private */ } window.location.reload() },
    })
  }

  // Anchor the menu's right edge to the kebab (so it comes up overlapping the toolbar), extending
  // toward the page edge but never closer than EDGE_BUFFER — at which point it keeps that buffer.
  const EDGE_BUFFER = 10
  const menuStyle: CSSProperties = { border: `1px solid ${INK}66`, borderRadius: '10px' }
  if (menuOpen) {
    const br = btnRef.current?.getBoundingClientRect()
    menuStyle.position = 'fixed'
    menuStyle.bottom = br ? Math.round(window.innerHeight - br.top + 6) : 60
    menuStyle.right = br
      ? Math.max(EDGE_BUFFER, Math.round(window.innerWidth - br.right))
      : Math.max(EDGE_BUFFER, Math.round(window.innerWidth - paperRight + 12))
  }

  return (
    <div ref={rootRef} className="relative" onPointerDown={e => e.stopPropagation()}>
      {/* Hidden input: "Open…" clicks it directly so the OS file dialog opens immediately (no drop zone). */}
      <input ref={fileInputRef} type="file" accept=".studio,.inkwave,application/json,.json,.trace.json,.insig.json" className="hidden" onChange={onOpenFile} />
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
          <div role="menu" className="z-[60] w-44 py-1 bg-white shadow-md text-sm text-stone-600 font-serif" style={menuStyle}
            onMouseDown={e => e.stopPropagation()}>
            {items.map(it => (
              <button key={it.label} role="menuitem" type="button"
                onClick={() => { setMenuOpen(false); it.run() }}
                className="w-full text-left px-4 py-1.5 hover:bg-stone-100 hover:text-[#5c2d8a] transition-colors"
              >
                {it.label}
              </button>
            ))}
            <AccountMenuItems onClose={() => setMenuOpen(false)} />
          </div>
        </>,
        document.body,
      )}

      {modal && (
        <Modal title={MODAL_TITLES[modal]} onClose={() => setModal(null)}>
          {modal === 'save' && <SavePanel onExportBundle={onExportBundle} onSave={onSave} folderAvailable={folderAvailable} folderName={folderName} onSyncOneDrive={onSyncOneDrive} onChooseOneDriveFolder={onChooseOneDriveFolder} oneDriveAccount={oneDriveAccount} onSyncGoogleDrive={onSyncGoogleDrive} onChooseGoogleDriveFolder={onChooseGoogleDriveFolder} googleDriveActive={googleDriveActive} onDone={() => setModal(null)} />}
          {modal === 'upload' && <UploadPanel onComputer={() => { void openViaPicker(fileInputRef.current); setModal(null) }} onGoogleDrive={onUploadGoogleDrive} onOneDrive={onUploadOneDrive} onDone={() => setModal(null)} />}
          {modal === 'savecopy' && <SaveCopyPanel folderAvailable={folderAvailable} onSaveAs={onSaveAs} onSaveAsOneDrive={onSaveAsOneDrive} onSaveAsGoogleDrive={onSaveAsGoogleDrive} onExportBundle={onExportBundle} onDone={() => setModal(null)} />}
          {modal === 'export' && <ExportPanel onExportPdf={onExportPdf} onExportLatex={onExportLatex} onExportEquations={onExportEquations} onDone={() => setModal(null)} />}
          {modal === 'recent' && <RecentPanel />}
        </Modal>
      )}
    </div>
  )
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function MenuButton({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
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
      {/* Chromium (File System Access): native "Save to a folder"; once linked it shows the file name. */}
      {folderAvailable && (
        <MenuButton onClick={onSave ? () => { onSave(); onDone() } : undefined}>
          {folderName ? `✓ Synced to ${folderName}` : '🗀 Save to a folder'}
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
        <MenuButton onClick={() => { onSaveAs(); onDone() }}>🗁 This computer<span className="block text-xs text-stone-400">a new file in a folder, then keep it updated</span></MenuButton>
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

// Export the finished document — a typeset PDF (server-rendered, opens in a new tab) or LaTeX source.
function ExportPanel({ onExportPdf, onExportLatex, onExportEquations, onDone }: {
  onExportPdf?: () => void; onExportLatex?: () => void; onExportEquations?: () => void; onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <p className="text-xs text-stone-400 px-1">Choose a format. Both match what you see on the page.</p>
      {onExportPdf && (
        <MenuButton onClick={() => { onExportPdf(); onDone() }}>📄 PDF<span className="block text-xs text-stone-400">a finished A4 document — opens in a new tab, selectable text</span></MenuButton>
      )}
      {onExportLatex && (
        <MenuButton onClick={() => { onExportLatex(); onDone() }}>∑ LaTeX<span className="block text-xs text-stone-400">a .tex source file to typeset yourself</span></MenuButton>
      )}
      {onExportEquations && (
        <MenuButton onClick={() => { onExportEquations(); onDone() }}>≡ Equations<span className="block text-xs text-stone-400">block equations as a numbered list (.txt)</span></MenuButton>
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
        🗁 This computer<span className="block text-xs text-stone-400">use Chrome/Edge/Brave to sync via Windows Explorer (incl. your Drive/OneDrive folders)</span>
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal to body so the backdrop reliably covers the viewport and catches outside clicks (not
  // trapped in the footer's pointer-events/stacking context).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-end pb-20 pr-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}
        className="relative bg-white w-full max-w-sm p-6 flex flex-col shadow-xl"
        style={{ border: `1px solid ${INK}bf`, borderRadius: '14px' }}
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
