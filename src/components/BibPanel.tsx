// Bibliography panel — shows connected entries, missing keys, refresh, style picker.
// Floats as a slide-in panel from the right side.

import { useState, useEffect } from 'react'
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
}

export function BibPanel({ doc, citationStyle, onStyleChange, onConnectZotero, onClose }: Props) {
  const [status, setStatus] = useState(bibProvider.status())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const unsub = bibProvider.subscribe(() => setStatus(bibProvider.status()))
    return unsub
  }, [])

  async function refresh() {
    if (!hasBibFile()) { onConnectZotero(); return }
    setRefreshing(true)
    await pollIfChanged()
    setRefreshing(false)
  }

  const usedKeys = usedCitekeys(doc.contentJson)
  const embedded = doc.bibliography?.entries ?? []
  const missingKeys = usedKeys.filter(k => !bibProvider.get(k) && !embedded.find(e => e.id === k))

  const allEntries = bibProvider.getAll()

  return createPortal(
    <>
      <div className="fixed inset-0 z-[140]" onClick={onClose} />
      <div
        role="dialog" aria-label="Bibliography"
        className="fixed right-0 top-0 bottom-0 z-[141] bg-white shadow-2xl overflow-y-auto"
        style={{
          width: 'min(340px, 95vw)',
          borderLeft: `1px solid ${INK}22`,
          fontFamily: 'inherit',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <span style={{ color: INK, fontWeight: 600, fontSize: '0.9rem' }}>Bibliography</span>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

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

        {/* Available but not cited */}
        {allEntries.length > 0 && (
          <div className="px-4 pt-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-2">
              Library ({allEntries.length})
            </div>
            <div className="max-h-56 overflow-y-auto">
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
