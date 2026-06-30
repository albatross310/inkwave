// Bibliography panel — compact popup anchored to the ‟ toolbar button (like PageMenu).
import { useState, useEffect, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { bibProvider } from '../citations/bibProvider'
import { pollIfChanged, hasBibFile, fileChannelAvailable } from '../citations/fileChannel'
import { CSL_STYLES } from '../citations/styles'
import { usedCitekeys } from '../citations/resolve'
import type { InkwaveDocument } from '../types/document'

const INK = '#5c2d8a'

interface Props {
  doc: InkwaveDocument
  citationStyle: string
  onStyleChange: (s: string) => void
  onConnectZotero: () => void
  onClose: () => void
  btnRef?: RefObject<HTMLElement | null>
}

export function BibPanel({ doc, citationStyle, onStyleChange, onConnectZotero, onClose, btnRef }: Props) {
  const [status, setStatus] = useState(bibProvider.status())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const unsub = bibProvider.subscribe(() => setStatus(bibProvider.status()))
    return unsub
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onScroll = () => onClose()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll) }
  }, [onClose])

  async function refresh() {
    if (!hasBibFile()) { onConnectZotero(); return }
    setRefreshing(true)
    await pollIfChanged()
    setRefreshing(false)
  }

  function panelStyle(): React.CSSProperties {
    const br = btnRef?.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, right: 16 }
    const right = Math.max(8, window.innerWidth - br.right)
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), right }
  }

  const usedKeys = usedCitekeys(doc.contentJson)
  const embedded = doc.bibliography?.entries ?? []
  const missingKeys = usedKeys.filter(k => !bibProvider.get(k) && !embedded.find(e => e.id === k))
  const allEntries = bibProvider.getAll()

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={onClose} />
      <div
        role="dialog" aria-label="Bibliography"
        className="z-[91] bg-white shadow-xl font-serif text-sm text-stone-600 overflow-y-auto"
        style={{
          ...panelStyle(),
          width: 'min(340px, 95vw)',
          maxHeight: '80vh',
          border: `1px solid ${INK}55`,
          borderRadius: 14,
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-100">
          <span className="text-[11px] uppercase tracking-wide text-stone-400">Bibliography</span>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

        {/* Source status + actions */}
        <div className="px-4 py-3 border-b border-stone-100">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status.channel !== 'none' ? 'bg-green-400' : 'bg-stone-300'}`} />
            <span className="text-xs text-stone-500">
              {status.channel === 'none' ? 'No source connected' : `${status.entries} entries (${status.channel})`}
            </span>
          </div>
          <div className="flex gap-2">
            {fileChannelAvailable() && (
              <button type="button" onClick={refresh} disabled={refreshing}
                className="text-xs px-2 py-1 rounded border border-stone-200 text-stone-500 hover:border-stone-300 disabled:opacity-50">
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            <button type="button" onClick={onConnectZotero}
              className="text-xs px-2 py-1 rounded border border-stone-200 text-stone-500 hover:border-stone-300">
              {hasBibFile() ? 'Change file' : 'Connect Zotero'}
            </button>
          </div>
        </div>

        {/* Citation style picker */}
        <div className="px-4 py-2.5 border-b border-stone-100">
          <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-1.5">Citation style</div>
          <select
            value={citationStyle}
            onChange={e => onStyleChange(e.target.value)}
            className="text-xs text-stone-600 border border-stone-200 rounded px-2 py-1 w-full bg-white"
          >
            {CSL_STYLES.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Missing references warning */}
        {missingKeys.length > 0 && (
          <div className="mx-4 mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-xs font-medium text-red-700 mb-1">Missing references</div>
            {missingKeys.map(k => (
              <div key={k} className="text-xs text-red-600 font-mono">{k}</div>
            ))}
          </div>
        )}

        {/* Cited in this doc */}
        {usedKeys.length > 0 && (
          <div className="px-4 pt-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-2">Cited in this document</div>
            {usedKeys.map(key => {
              const item = bibProvider.get(key) ?? embedded.find(e => e.id === key)
              return (
                <div key={key} className="py-2 border-b border-stone-50 last:border-0">
                  <div className="text-xs font-medium" style={{ color: INK }}>{key}</div>
                  {item ? (
                    <div className="text-xs text-stone-500 leading-tight mt-0.5">{String(item.title ?? '')}</div>
                  ) : (
                    <div className="text-xs text-red-500">Not found in library</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Available library */}
        {allEntries.length > 0 && (
          <div className="px-4 pt-3 pb-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-2">
              Library ({allEntries.length})
            </div>
            <div className="max-h-48 overflow-y-auto">
              {allEntries.map(item => (
                <div key={item.id} className="py-1.5 border-b border-stone-50 last:border-0">
                  <div className="text-xs font-medium text-stone-600">{item.id}</div>
                  <div className="text-xs text-stone-400 truncate">{String(item.title ?? '')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {allEntries.length === 0 && status.channel === 'none' && (
          <div className="px-4 py-6 text-center text-sm text-stone-400">
            Connect a .bib file to see your library here.
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
