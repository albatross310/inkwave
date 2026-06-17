import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listGoogleDriveFolders, listGoogleDriveFiles, getRecentGDriveFolders, createGoogleDriveFolder, type GDriveRecent } from '../storage/gdrive'

// Open a .studio/.inkwave file FROM Google Drive — folder-navigable (matches the OneDrive opener).
// drive.file only lets Inkwave see files/folders IT created, so this browses the app's own folders +
// files (not your whole Drive). Pick a file → the caller downloads it, opens it, keeps syncing to it,
// and remembers its folder as a Recent folder. Files OTHERS shared with you aren't visible to
// drive.file — open those via "This computer" (the mounted Drive folder) on desktop.
const G_BLUE = '#4285F4'
const G_HOVER = '#f5f9ff'

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
function GoogleWordmark() {
  const colors = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853', '#EA4335']
  return (
    <span className="font-sans font-semibold text-xl tracking-tight">
      {'Google'.split('').map((ch, i) => <span key={i} style={{ color: colors[i] }}>{ch}</span>)}
      <span style={{ color: '#5f6368' }}> Drive</span>
    </span>
  )
}

type Crumb = { id: string; name: string }
type Item = { id: string; name: string }

export function GoogleDriveFileOpener({ onOpen, onClose }: {
  onOpen: (f: { id: string; name: string; folderId: string; folderName: string }) => void | Promise<void>
  onClose: () => void
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<Item[] | null>(null)
  const [files, setFiles] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [recent, setRecent] = useState<GDriveRecent[]>([])
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const currentId = crumbs.length ? crumbs[crumbs.length - 1].id : 'root'
  const currentPath = crumbs.map((c) => c.name).join('/')

  useEffect(() => { void getRecentGDriveFolders().then(setRecent).catch(() => {}) }, [])

  useEffect(() => {
    let cancelled = false
    setFolders(null); setFiles(null); setError(null)
    Promise.all([listGoogleDriveFolders(currentId), listGoogleDriveFiles(currentId)])
      .then(([fo, fi]) => { if (!cancelled) { setFolders(fo); setFiles(fi) } })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [currentId, reload])

  async function createFolder() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try { await createGoogleDriveFolder(name, currentId); setCreating(false); setNewName(''); setReload((r) => r + 1) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function open(file: Item) {
    setOpening(true)
    try { await onOpen({ id: file.id, name: file.name, folderId: currentId, folderName: currentPath || 'My Drive (root)' }) }
    finally { onClose() }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Open from Google Drive" onMouseDown={(e) => e.stopPropagation()}
        className="relative bg-white w-full max-w-md p-6 flex flex-col shadow-xl" style={{ border: `1px solid ${G_BLUE}55`, borderRadius: 14 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DriveMark />
            <GoogleWordmark />
            <span className="text-xs text-stone-400">· open</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>

        <div className="text-xs text-stone-500 mb-2 flex flex-wrap items-center gap-1 font-sans">
          <button type="button" className="hover:underline" style={{ color: G_BLUE }} onClick={() => setCrumbs([])}>My Drive</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <span className="text-stone-300">/</span>
              <button type="button" className="hover:underline" style={{ color: G_BLUE }} onClick={() => setCrumbs(crumbs.slice(0, i + 1))}>{c.name}</button>
            </span>
          ))}
        </div>

        {/* Recent folders → jump straight there (only at the root view). */}
        {crumbs.length === 0 && recent.length > 0 && (
          <div className="mb-2">
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1">Recent folders</div>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((f, i) => (
                <button key={`${f.id}-${i}`} type="button"
                  onClick={() => setCrumbs(f.id ? [{ id: f.id, name: f.name }] : [])}
                  className="text-xs px-2.5 py-1 rounded-full font-sans hover:bg-[#f5f9ff]" style={{ border: `1px solid ${G_BLUE}40`, color: '#3c4043' }}>
                  🗁 {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">{currentPath || 'My Drive'}</div>
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

        <div className="border rounded-lg max-h-72 overflow-auto" style={{ borderColor: '#e6eef5' }}>
          {error && <p className="text-xs text-red-700 p-3">⚠ {error}</p>}
          {!error && (folders === null || files === null) && <p className="text-sm text-stone-400 p-3">{opening ? 'Opening…' : 'Loading…'}</p>}
          {folders?.map((f) => (
            <button key={f.id} type="button" onClick={() => setCrumbs([...crumbs, { id: f.id, name: f.name }])}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2"
              style={{ borderColor: '#f0f4f8', color: '#33414f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = G_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">🗁</span>{f.name}
            </button>
          ))}
          {files?.map((f) => (
            <button key={f.id} type="button" disabled={opening} onClick={() => void open(f)}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: '#f0f4f8', color: '#1a73e8' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = G_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">📄</span>{f.name}
            </button>
          ))}
          {!error && folders?.length === 0 && files?.length === 0 && <p className="text-sm text-stone-400 p-3">Nothing here. Open a sub-folder, or pick a .studio file.</p>}
        </div>
        <p className="text-xs text-stone-400 mt-3">Pick a file — it opens and keeps syncing back to Drive (no Save needed). For files shared with you, use “This computer” on desktop.</p>
      </div>
    </div>,
    document.body,
  )
}
