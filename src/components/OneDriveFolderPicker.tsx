import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listFolders, listQuickFolders, getRecentFolders, createOneDriveFolder, type DriveFolder, type OneDriveFolder } from '../storage/onedrive'

// A small folder browser for OneDrive: drill into folders from the root, create new ones, then
// "Sync here" to choose the destination for the .trace.json. Reads folders live via Microsoft Graph
// (the writer must be signed in). Returns { id, path } — id '' means the OneDrive root.
// Styled to read as OneDrive (Microsoft blue + cloud mark), the way the Insignia PayPal button reads
// as PayPal.
const ONE = '#0364B8'        // OneDrive brand blue
const ONE_HOVER = '#f1f7fc'  // pale blue row hover

// A clean blue cloud — the OneDrive mark, paired with the wordmark below.
function OneDriveCloud() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style={{ display: 'block' }}>
      <path fill={ONE} d="M6.6 19A4.6 4.6 0 0 1 5.8 9.9 6 6 0 0 1 17.7 8.8 4.6 4.6 0 0 1 18.2 19H6.6z" />
    </svg>
  )
}

type Crumb = { id: string; name: string }

const stripExt = (name: string) => name.replace(/\.(studio|inkwave)$|\.(trace|insig)\.json$/i, '')

export function OneDriveFolderPicker({ currentName, onRename, onPick, onClose }: {
  currentName?: string
  onRename?: (name: string) => void | Promise<void>
  onPick: (folder: OneDriveFolder) => void | Promise<void>
  onClose: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [crumbs, setCrumbs] = useState<Crumb[]>([]) // [] = root
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [quick, setQuick] = useState<DriveFolder[]>([])
  const [recent, setRecent] = useState<OneDriveFolder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const currentId = crumbs.length ? crumbs[crumbs.length - 1].id : null
  const currentPath = crumbs.map((c) => c.name).join('/')

  // Shortcuts shown at the root: the writer's RECENT choices (from OPFS) if any, else common folders.
  useEffect(() => {
    void getRecentFolders().then(setRecent).catch(() => {})
    void listQuickFolders().then(setQuick).catch(() => {})
  }, [])
  // Recent folders are pickable directly (id '' = root). Shown as {id, name=path||'OneDrive (root)'}.
  const shortcuts: DriveFolder[] = recent.length
    ? recent.map((f) => ({ id: f.id, name: f.path || 'OneDrive (root)' }))
    : quick
  const shortcutsLabel = recent.length ? 'Recent folders' : 'Common folders'

  useEffect(() => {
    let cancelled = false
    setFolders(null); setError(null)
    listFolders(currentId)
      .then((f) => { if (!cancelled) setFolders(f) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [currentId, reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Inline file rename (double-click).
  const [editing, setEditing] = useState(false)
  const [nameVal, setNameVal] = useState(stripExt(currentName ?? ''))
  useEffect(() => { setNameVal(stripExt(currentName ?? '')) }, [currentName])
  async function commitName() {
    setEditing(false)
    const n = nameVal.trim()
    if (n && n !== stripExt(currentName ?? '')) {
      setRenaming(true) // show "Loading…" instantly while the rename PATCH + re-sync run
      try { await onRename?.(n) } finally { setRenaming(false) }
    }
  }

  async function createFolder() {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setError(null)
    try {
      await createOneDriveFolder(currentId, name)
      setCreating(false); setNewName('')
      setReload((r) => r + 1) // re-list so the new folder shows
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Choose OneDrive folder" onMouseDown={(e) => e.stopPropagation()}
        className="relative bg-white w-full max-w-md p-6 flex flex-col shadow-xl" style={{ border: `1px solid ${ONE}66`, borderRadius: 14 }}>
        {/* OneDrive-branded header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <OneDriveCloud />
            <span className="font-sans font-semibold text-xl tracking-tight" style={{ color: ONE }}>OneDrive</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>

        {/* Breadcrumb */}
        <div className="text-xs text-stone-500 mb-2 flex flex-wrap items-center gap-1 font-sans">
          <button type="button" className="hover:underline" style={{ color: ONE }} onClick={() => setCrumbs([])}>OneDrive</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <span className="text-stone-300">/</span>
              <button type="button" className="hover:underline" style={{ color: ONE }} onClick={() => setCrumbs(crumbs.slice(0, i + 1))}>{c.name}</button>
            </span>
          ))}
        </div>

        {/* Shortcuts at the root: RECENT choices (tracked in OPFS) → pick instantly; otherwise common
            OneDrive folders → drill in. NB: Windows Explorer "Quick access" pins have no web API. */}
        {crumbs.length === 0 && shortcuts.length > 0 && (
          <div className="mb-2">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">{shortcutsLabel}</div>
            <div className="flex flex-wrap gap-1.5">
              {shortcuts.map((f, i) => (
                <button key={`${f.id}-${i}`} type="button"
                  onClick={() => (recent.length ? onPick({ id: f.id, path: recent[i].path }) : setCrumbs([{ id: f.id, name: f.name }]))}
                  className="text-xs px-2.5 py-1 rounded-full font-sans hover:bg-[#f1f7fc]" style={{ border: `1px solid ${ONE}40`, color: ONE }}>
                  🗁 {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Folder-list header with the New folder control. */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">Folders</div>
          {!creating && (
            <button type="button" onClick={() => setCreating(true)} className="text-xs font-sans hover:underline flex items-center gap-1" style={{ color: ONE }}>
              <span className="text-sm leading-none">＋</span> New folder
            </button>
          )}
        </div>
        {creating && (
          <div className="flex gap-1.5 mb-2">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name"
              onKeyDown={(e) => { if (e.key === 'Enter') void createFolder(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
              className="flex-1 text-sm font-sans rounded px-2 py-1 outline-none" style={{ border: `1px solid ${ONE}66` }} />
            <button type="button" onClick={() => void createFolder()} disabled={!newName.trim() || busy}
              className="text-xs font-sans text-white px-3 rounded disabled:opacity-50" style={{ background: ONE }}>Create</button>
            <button type="button" onClick={() => { setCreating(false); setNewName('') }} className="text-xs font-sans text-stone-400 px-2 hover:text-stone-600">Cancel</button>
          </div>
        )}

        <div className="border rounded-lg max-h-64 overflow-auto" style={{ borderColor: '#e6eef5' }}>
          {error && <p className="text-xs text-red-700 p-3">⚠ {error}</p>}
          {!error && folders === null && <p className="text-sm text-stone-400 p-3">Loading…</p>}
          {!error && folders?.length === 0 && <p className="text-sm text-stone-400 p-3">No sub-folders here.</p>}
          {folders?.map((f) => (
            <button key={f.id} type="button" onClick={() => setCrumbs([...crumbs, { id: f.id, name: f.name }])}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2"
              style={{ borderColor: '#f0f4f8', color: '#33414f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = ONE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">🗁</span>{f.name}
            </button>
          ))}
        </div>

        {/* Inline file name (double-click to rename). */}
        {onRename && currentName && (
          <div className="flex items-center gap-2 mt-3 text-sm">
            <span className="text-stone-400 text-xs">File:</span>
            {syncing || renaming ? (
              <span className="font-sans text-stone-400">Loading…</span>
            ) : editing ? (
              <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameVal(stripExt(currentName)); setEditing(false) } }}
                className="flex-1 text-sm font-sans rounded px-2 py-0.5 outline-none" style={{ border: `1px solid ${ONE}66` }} />
            ) : (
              <>
                <span onDoubleClick={() => setEditing(true)} className="font-sans text-stone-600 truncate">{stripExt(currentName)}<span className="text-stone-300">.studio</span></span>
                <button type="button" onClick={() => setEditing(true)} title="Rename file"
                  className="text-xs font-sans px-1.5 py-0.5 rounded hover:bg-stone-100 whitespace-nowrap" style={{ color: ONE }}>✎ Rename</button>
              </>
            )}
          </div>
        )}

        <button type="button" disabled={syncing}
          onClick={async () => { setSyncing(true); try { await onPick({ id: currentId ?? '', path: currentPath }) } finally { onClose() } }}
          className="mt-4 px-4 py-2.5 font-sans font-medium text-white hover:brightness-105 transition disabled:opacity-70" style={{ background: ONE, borderRadius: 10 }}>
          {syncing ? 'Loading…' : `Sync here${currentPath ? ` — ${currentPath}` : ' — OneDrive (root)'}`}
        </button>
      </div>
    </div>,
    document.body,
  )
}
