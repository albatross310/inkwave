import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listGoogleDriveFiles } from '../storage/gdrive'

// Open a .studio/.inkwave file FROM Google Drive — a reliable custom lister (no hosted picker, which
// was flaking). Shows the files Inkwave can see on drive.file (your own synced files, across
// devices). Pick one → the caller downloads it, opens it, and keeps syncing to it (no Save). Files
// OTHERS shared with you aren't visible to drive.file — open those via "This computer" on desktop.
const G_BLUE = '#4285F4'

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

export function GoogleDriveFileOpener({ onOpen, onClose }: {
  onOpen: (f: { id: string; name: string }) => void | Promise<void>
  onClose: () => void
}) {
  const [files, setFiles] = useState<Array<{ id: string; name: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let cancelled = false
    listGoogleDriveFiles()
      .then((f) => { if (!cancelled) setFiles(f) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function open(f: { id: string; name: string }) {
    setOpening(true)
    try { await onOpen(f) } finally { onClose() }
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

        <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1.5">Your Inkwave files</div>
        <div className="border rounded-lg max-h-72 overflow-auto" style={{ borderColor: '#e6eef5' }}>
          {error && <p className="text-xs text-red-700 p-3">⚠ {error}</p>}
          {!error && files === null && <p className="text-sm text-stone-400 p-3">{opening ? 'Opening…' : 'Loading…'}</p>}
          {!error && files?.length === 0 && <p className="text-xs text-stone-400 p-3">No Inkwave files in this Google account yet.</p>}
          {files?.map((f) => (
            <button key={f.id} type="button" disabled={opening} onClick={() => void open(f)}
              className="w-full text-left px-3 py-2 text-sm font-sans border-b last:border-b-0 flex items-center gap-2 disabled:opacity-50"
              style={{ borderColor: '#f0f4f8', color: '#33414f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f9ff')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span aria-hidden="true">📄</span>{f.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-400 mt-3">Pick a file — it opens and keeps syncing back to Drive (no Save needed). For files shared with you, use “This computer” on desktop.</p>
      </div>
    </div>,
    document.body,
  )
}
