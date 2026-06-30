// Setup panel for connecting a Zotero / Better BibTeX .bib file.
// Channel A: File System Access API — pick the BBT auto-exported .bib.
// Channel B probe: reads the BBT local HTTP API status (optional enhancement).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  fileChannelAvailable,
  pickBibFile,
  hasBibFile,
  requestPermissionIfNeeded,
  startPolling,
} from '../citations/fileChannel'
import { bibProvider } from '../citations/bibProvider'

const INK = '#5c2d8a'
const BBT_PROBE = 'http://127.0.0.1:23119/better-bibtex/cayw?probe=probe'

interface Props {
  onClose: () => void
}

type BbtStatus = 'unknown' | 'live' | 'offline'

export function ZoteroSetup({ onClose }: Props) {
  const [step, setStep] = useState<'intro' | 'channel-a' | 'done'>('intro')
  const [picking, setPicking] = useState(false)
  const [permRequired, setPermRequired] = useState(false)
  const [bibCount, setBibCount] = useState(bibProvider.status().entries)
  const [bbtStatus, setBbtStatus] = useState<BbtStatus>('unknown')

  useEffect(() => {
    const unsub = bibProvider.subscribe(() => setBibCount(bibProvider.status().entries))
    return unsub
  }, [])

  // Probe Channel B on mount
  useEffect(() => {
    fetch(BBT_PROBE, { signal: AbortSignal.timeout(2000) })
      .then(r => r.text())
      .then(t => setBbtStatus(t.trim() === 'ready' ? 'live' : 'offline'))
      .catch(() => setBbtStatus('offline'))
  }, [])

  async function handlePick() {
    if (!fileChannelAvailable()) return
    setPicking(true)
    const ok = await pickBibFile()
    setPicking(false)
    if (ok) { startPolling(); setStep('done') }
  }

  async function handleRePermission() {
    const ok = await requestPermissionIfNeeded()
    if (ok) { startPolling(); setPermRequired(false); setStep('done') }
    else setPermRequired(true)
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[150] bg-black/30" onClick={onClose} />
      <div
        role="dialog" aria-label="Connect Zotero"
        className="fixed z-[151] bg-white rounded-xl shadow-2xl"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(480px, 95vw)', maxHeight: '80vh', overflowY: 'auto',
          padding: '28px 28px 20px',
          border: `1px solid ${INK}33`,
        }}
      >
        <div style={{ color: INK, fontWeight: 600, fontSize: '1rem', marginBottom: 8 }}>
          Connect Zotero
        </div>
        <p className="text-sm text-stone-500 mb-4">
          Inkwave reads your Zotero library from a Better BibTeX auto-exported{' '}
          <code className="text-xs bg-stone-100 px-1 rounded">.bib</code> file.
          No data ever leaves your device.
        </p>

        {step === 'intro' && (
          <>
            <ol className="text-sm text-stone-600 space-y-2 mb-5 list-decimal list-inside">
              <li>Install <strong>Zotero</strong> and the <strong>Zotero Connector</strong> browser extension.</li>
              <li>Install the <strong>Better BibTeX</strong> plugin in Zotero.</li>
              <li>In BBT preferences, set a citekey format and enable &ldquo;pin citekeys on export&rdquo;.</li>
              <li>
                Right-click your library → <strong>Export Library</strong> → format{' '}
                <em>Better BibLaTeX</em> → tick <strong>Keep updated</strong> → save as{' '}
                <code className="text-xs bg-stone-100 px-1 rounded">inkwave-library.bib</code>.
              </li>
            </ol>
            <div className="flex gap-3">
              <button onClick={() => setStep('channel-a')} type="button"
                className="px-4 py-1.5 rounded-full text-sm font-medium text-white"
                style={{ background: INK }}>
                Connect .bib file
              </button>
              <button onClick={onClose} type="button"
                className="px-4 py-1.5 rounded-full text-sm text-stone-500 border border-stone-200">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'channel-a' && (
          <>
            <p className="text-sm text-stone-600 mb-4">
              Grant Inkwave read access to your{' '}
              <code className="text-xs bg-stone-100 px-1 rounded">inkwave-library.bib</code> file.
              Inkwave will re-read it automatically when it changes.
            </p>
            {!fileChannelAvailable() && (
              <div className="text-sm text-red-600 bg-red-50 rounded p-3 mb-3">
                File System Access API not available in this browser. Use Chrome or Edge.
              </div>
            )}
            {permRequired && (
              <div className="text-sm text-amber-600 bg-amber-50 rounded p-3 mb-3">
                Permission needed. Click below to grant access.
              </div>
            )}
            <div className="flex gap-3">
              {hasBibFile() ? (
                <button onClick={handleRePermission} type="button"
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white"
                  style={{ background: INK }}>
                  Re-grant access
                </button>
              ) : (
                <button onClick={handlePick} type="button" disabled={picking || !fileChannelAvailable()}
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: INK }}>
                  {picking ? 'Selecting…' : 'Pick .bib file'}
                </button>
              )}
              <button onClick={() => setStep('intro')} type="button"
                className="px-4 py-1.5 rounded-full text-sm text-stone-500 border border-stone-200">
                Back
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="text-sm text-stone-600 mb-4">
              <span className="text-green-600 font-medium">✓ Connected.</span>{' '}
              {bibCount} {bibCount === 1 ? 'entry' : 'entries'} loaded.
              Inkwave will refresh automatically on window focus.
            </div>
            <div className="text-xs text-stone-400 mb-4">
              Type <kbd className="bg-stone-100 px-1 rounded">@</kbd> in the editor to cite a source.
            </div>
            {/* Channel B status */}
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2 h-2 rounded-full ${bbtStatus === 'live' ? 'bg-green-400' : bbtStatus === 'offline' ? 'bg-amber-400' : 'bg-stone-300'}`} />
              <span className="text-xs text-stone-400">
                {bbtStatus === 'live' ? 'Zotero is running (live picker available)' :
                 bbtStatus === 'offline' ? 'Zotero not running — using .bib file' :
                 'Checking Zotero…'}
              </span>
            </div>
            <button onClick={onClose} type="button"
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white"
              style={{ background: INK }}>
              Done
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
