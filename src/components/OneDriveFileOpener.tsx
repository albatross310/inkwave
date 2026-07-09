import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listFolders, listOneDriveFiles, getRecentFolders, createOneDriveFolder, type DriveFolder, type OneDriveFolder, type OneDriveFileEntry } from '../storage/onedrive'
import { getListing, putListing, listingKey, type CachedListing } from '../storage/openCache'

// Open a .studio/.inkwave file FROM OneDrive (for phones, where OneDrive isn't a mounted Explorer
// folder). Browse folders, pick a file → the caller downloads it, opens it, and adopts it as the
// sync target so it keeps syncing there. OneDrive-branded, matches the folder picker.
const ONE = '#0364B8'
const ONE_HOVER = '#f1f7fc'

function OneDriveCloud() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style={{ display: 'block' }}>
      <path fill={ONE} d="M6.6 19A4.6 4.6 0 0 1 5.8 9.9 6 6 0 0 1 17.7 8.8 4.6 4.6 0 0 1 18.2 19H6.6z" />
    </svg>
  )
}

type Crumb = { id: string; name: string }

export function OneDriveFileOpener({ onOpen, onClose }: {
  onOpen: (f: { itemId: string; name: string; folder: OneDriveFolder; cTag?: string; fresh?: boolean }) => void | Promise<void>
  onClose: () => void
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [files, setFiles] = useState<OneDriveFileEntry[] | null>(null)
  // Whether the SHOWING listing came from the live API (vs the instant cached seed) — the open
  // cache only trusts a fresh listing's cTag directly; a cached one is re-verified before a hit.
  const [listingFresh, setListingFresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [recent, setRecent] = useState<OneDriveFolder[]>([])
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const currentId = crumbs.length ? crumbs[crumbs.length - 1].id : null
  const currentPath = crumbs.map((c) => c.name).join('/')

  useEffect(() => { void getRecentFolders().then(setRecent).catch(() => {}) }, [])

  useEffect(() => {
    let cancelled = false
    let gotFresh = false
    setFolders(null); setFiles(null); setError(null); setListingFresh(false)
    const key = listingKey('od', currentId)
    type L = CachedListing<DriveFolder, OneDriveFileEntry>
    // Cached listing → the picker paints instantly (the idle warm pass pre-populates it); the fresh
    // fetch below replaces it in the background. Skipped on explicit reloads (new-folder create).
    if (!reload) {
      void getListing<L>(key).then((c) => {
        if (!cancelled && !gotFresh && c) { setFolders(c.value.folders); setFiles(c.value.files) }
      })
    }
    Promise.all([listFolders(currentId), listOneDriveFiles(currentId)])
      .then(([fo, fi]) => {
        if (cancelled) return
        gotFresh = true
        setFolders(fo); setFiles(fi); setListingFresh(true)
        putListing(key, { folders: fo, files: fi } satisfies L)
      })
      .catch((e) => {
        if (cancelled) return
        // Offline / expired token: keep (or restore) the cached listing so the picker still works —
        // opening then falls back to the OPFS byte cache. Error only when there's nothing to show.
        void getListing<L>(key).then((c) => {
          if (cancelled || gotFresh) return
          if (c) { setFolders(c.value.folders); setFiles(c.value.files) }
          else setError((e as Error).message)
        })
      })
    return () => { cancelled = true }
  }, [currentId, reload])

  async function createFolder() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try { await createOneDriveFolder(currentId, name); setCreating(false); setNewName(''); setReload((r) => r + 1) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function open(file: OneDriveFileEntry) {
    setOpening(true)
    // cTag rides along so the open path can serve cached bytes when the content hasn't changed.
    try { await onOpen({ itemId: file.id, name: file.name, folder: { id: currentId ?? '', path: currentPath }, cTag: file.cTag, fresh: listingFresh }) }
    finally { onClose() }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Open from OneDrive" onMouseDown={(e) => e.stopPropagation()}
        className="relative iw-nightable bg-white w-full max-w-md p-6 flex flex-col shadow-xl" style={{ border: `1px solid ${ONE}66`, borderRadius: 14 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <OneDriveCloud />
            <span className="font-sans font-semibold text-xl tracking-tight" style={{ color: ONE }}>OneDrive</span>
            <span className="text-xs text-stone-400">· open</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>

        <div className="text-xs text-stone-500 mb-2 flex flex-wrap items-center gap-1 font-sans">
          <button type="button" className="hover:underline" style={{ color: ONE }} onClick={() => setCrumbs([])}>OneDrive</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <span className="text-stone-300">/</span>
              <button type="button" className="hover:underline" style={{ color: ONE }} onClick={() => setCrumbs(crumbs.slice(0, i + 1))}>{c.name}</button>
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
                  onClick={() => setCrumbs([{ id: f.id, name: f.path || 'OneDrive (root)' }])}
                  className="text-xs px-2.5 py-1 rounded-full font-sans hover:bg-[#f1f7fc]" style={{ border: `1px solid ${ONE}40`, color: ONE }}>
                  🗁 {f.path || 'OneDrive (root)'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">{currentPath || 'OneDrive'}</div>
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

        <div className="border rounded-lg max-h-72 overflow-auto" style={{ borderColor: '#e6eef5' }}>
          {error && <p className="text-xs text-red-700 p-3">⚠ {error}</p>}
          {!error && (folders === null || files === null) && <p className="text-sm text-stone-400 p-3">{opening ? 'Opening…' : 'Loading…'}</p>}
          {/* Folders to drill into */}
          {folders?.map((f) => (
            <button key={f.id} type="button" onClick={() => setCrumbs([...crumbs, { id: f.id, name: f.name }])}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2"
              style={{ borderColor: '#f0f4f8', color: '#33414f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = ONE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">🗁</span>{f.name}
            </button>
          ))}
          {/* .studio files to open */}
          {files?.map((f) => (
            <button key={f.id} type="button" disabled={opening} onClick={() => void open(f)}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: '#f0f4f8', color: ONE }}
              onMouseEnter={(e) => (e.currentTarget.style.background = ONE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">📄</span>{f.name}
            </button>
          ))}
          {!error && folders?.length === 0 && files?.length === 0 && <p className="text-sm text-stone-400 p-3">Nothing here. Open a sub-folder, or pick a .studio file.</p>}
        </div>
        <p className="text-xs text-stone-400 mt-3">Pick a file — it opens and keeps syncing back to OneDrive (no Save needed).</p>
      </div>
    </div>,
    document.body,
  )
}
