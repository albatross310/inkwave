import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listGoogleDriveFolders, createGoogleDriveFolder, getChosenGDriveFolder } from '../storage/gdrive'

// Custom Google Drive folder picker — the counterpart to OneDriveFolderPicker, Google-coloured.
// Because Inkwave uses the privacy-preserving `drive.file` scope, this can only see the folders the
// app CREATED (it can't enumerate your whole Drive). So it shows those + a New-folder button to make
// more, lets you sync into one (or My Drive root), and rename the synced file in place. To open a
// file someone ELSE sent, that's the separate per-file import (Google's file picker), not this.
const G_BLUE = '#4285F4'   // Google brand blue, for input focus + the selected-row tint
const G_HOVER = '#e8f0fe'  // Google's light-blue selection tint

// The actual Google Drive logo (the prism of green/blue/yellow), not a flat triangle.
function DriveMark() {
  return (
    <svg viewBox="0 0 87.3 78" width="22" height="20" aria-hidden="true" style={{ display: 'block' }}>
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}

// The iconic multi-colour "Google" + grey "Drive" wordmark — the treatment that makes it read as
// Google at a glance (the way the gold wordmark reads as PayPal).
function GoogleWordmark() {
  const colors = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853', '#EA4335']
  return (
    <span className="font-sans font-semibold text-xl tracking-tight">
      {'Google'.split('').map((ch, i) => <span key={i} style={{ color: colors[i] }}>{ch}</span>)}
      <span style={{ color: '#5f6368' }}> Drive</span>
    </span>
  )
}

function stripExt(name: string) {
  return name.replace(/\.(studio|inkwave)$|\.(trace|insig)\.json$/i, '')
}

export function GoogleDriveFolderPicker({ currentName, onRename, onPick, onClose }: {
  currentName: string
  onRename?: (name: string) => void | Promise<void>
  onPick: (folderId: string) => void | Promise<void> // '' = My Drive root
  onClose: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [folders, setFolders] = useState<Array<{ id: string; name: string }> | null>(null)
  const [selected, setSelected] = useState<string>(getChosenGDriveFolder() ?? '')
  const [selectedName, setSelectedName] = useState<string>('My Drive (root)')
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFolders(null); setError(null)
    listGoogleDriveFolders()
      .then((f) => { if (!cancelled) setFolders(f) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function createFolder() {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setError(null)
    try {
      const f = await createGoogleDriveFolder(name)
      setCreating(false); setNewName('')
      if (f) { setSelected(f.id); setSelectedName(f.name) }
      setReload((r) => r + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Inline filename rename (double-click).
  const [editing, setEditing] = useState(false)
  const [nameVal, setNameVal] = useState(stripExt(currentName))
  useEffect(() => { setNameVal(stripExt(currentName)) }, [currentName])
  async function commitName() {
    setEditing(false)
    const n = nameVal.trim()
    if (n && n !== stripExt(currentName)) {
      setRenaming(true) // show "Loading…" instantly while the rename PATCH + re-sync run
      try { await onRename?.(n) } finally { setRenaming(false) }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Choose Google Drive folder" onMouseDown={(e) => e.stopPropagation()}
        className="relative bg-white w-full max-w-md p-6 flex flex-col shadow-xl" style={{ border: `1px solid ${G_BLUE}55`, borderRadius: 14 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DriveMark />
            <GoogleWordmark />
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>

        {/* Folder-list header + New folder. */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">Your Inkwave folders</div>
          {!creating && (
            <button type="button" onClick={() => setCreating(true)} className="text-xs font-sans hover:underline flex items-center gap-1 text-[#5f6368]">
              <span className="text-sm leading-none">＋</span> New folder
            </button>
          )}
        </div>
        {creating && (
          <div className="flex gap-1.5 mb-2">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name"
              onKeyDown={(e) => { if (e.key === 'Enter') void createFolder(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
              className="flex-1 text-sm font-sans rounded px-2 py-1 outline-none" style={{ border: `1px solid ${G_BLUE}66` }} />
            <button type="button" onClick={() => void createFolder()} disabled={!newName.trim() || busy}
              className="text-xs font-sans px-3 rounded bg-[#f1f3f4] text-[#3c4043] hover:bg-[#e8eaed] disabled:opacity-50">Create</button>
            <button type="button" onClick={() => { setCreating(false); setNewName('') }} className="text-xs font-sans text-stone-400 px-2 hover:text-stone-600">Cancel</button>
          </div>
        )}

        <div className="border rounded-lg max-h-56 overflow-auto" style={{ borderColor: '#e6eef5' }}>
          {/* My Drive root is always selectable. */}
          <FolderRow name="My Drive (root)" selected={selected === ''} onClick={() => { setSelected(''); setSelectedName('My Drive (root)') }} />
          {error && <p className="text-xs text-red-700 p-3">⚠ {error}</p>}
          {!error && folders === null && <p className="text-sm text-stone-400 p-3">Loading…</p>}
          {!error && folders?.length === 0 && <p className="text-xs text-stone-400 p-3">No Inkwave folders yet — make one above.</p>}
          {folders?.map((f) => (
            <FolderRow key={f.id} name={f.name} selected={selected === f.id} onClick={() => { setSelected(f.id); setSelectedName(f.name) }} />
          ))}
        </div>

        {/* Inline file name with an explicit Rename button (double-click works too). While syncing,
            the name is replaced by "Loading…". */}
        {onRename && (
          <div className="flex items-center gap-2 mt-3 text-sm">
            <span className="text-stone-400 text-xs">File:</span>
            {syncing || renaming ? (
              <span className="font-sans text-stone-400">Loading…</span>
            ) : editing ? (
              <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameVal(stripExt(currentName)); setEditing(false) } }}
                className="flex-1 text-sm font-sans rounded px-2 py-0.5 outline-none" style={{ border: `1px solid ${G_BLUE}66` }} />
            ) : (
              <>
                <span onDoubleClick={() => setEditing(true)} className="font-sans text-stone-600 truncate">{stripExt(currentName)}<span className="text-stone-300">.studio</span></span>
                <button type="button" onClick={() => setEditing(true)} title="Rename file"
                  className="text-xs font-sans px-1.5 py-0.5 rounded hover:bg-[#f1f3f4] whitespace-nowrap text-[#5f6368]">✎ Rename</button>
              </>
            )}
          </div>
        )}

        <button type="button" disabled={syncing}
          onClick={async () => { setSyncing(true); try { await onPick(selected) } finally { onClose() } }}
          className="mt-4 px-4 py-2.5 font-sans font-medium rounded-[10px] bg-[#f1f3f4] text-[#3c4043] hover:bg-[#e8eaed] transition disabled:opacity-70">
          {syncing ? 'Loading…' : `Sync here — ${selectedName}`}
        </button>
      </div>
    </div>,
    document.body,
  )
}

function FolderRow({ name, selected, onClick }: { name: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2"
      style={{ borderColor: '#f0f4f8', color: '#33414f', background: selected ? G_HOVER : 'transparent' }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#fafbfc' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}>
      <span aria-hidden="true">{selected ? '🗁' : '🗀'}</span>{name}
    </button>
  )
}
