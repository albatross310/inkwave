import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listOpfsDocumentsStrict, type OpfsDocEntry } from '../storage/opfs'
import type { ContainerDescriptor } from '../workspace/manifest'

interface PlacementCandidate extends ContainerDescriptor {
  current: boolean
  updatedAt: number
  kind: 'Email' | 'Document'
}

/** Build the explicit picker list from storage, never from the lossy recent-document index. */
export function emailPlacementCandidates(
  entries: OpfsDocEntry[],
  currentDocumentId: string | null,
): PlacementCandidate[] {
  return entries
    .filter((entry): entry is OpfsDocEntry & { doc: NonNullable<OpfsDocEntry['doc']> } => !!entry.doc)
    .map((entry) => ({
      id: entry.doc.id,
      title: entry.doc.title.trim() || 'Untitled',
      current: entry.doc.id === currentDocumentId,
      updatedAt: Date.parse(entry.doc.updatedAt) || entry.lastModified,
      kind: entry.doc.docType === 'email' ? 'Email' as const : 'Document' as const,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
}

export function NewEmailPlacementDialog({
  currentDocumentId,
  onClose,
  onConfirm,
}: {
  currentDocumentId: string | null
  onClose: () => void
  onConfirm: (additionalContainers: ContainerDescriptor[]) => Promise<void>
}) {
  const [candidates, setCandidates] = useState<PlacementCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const scan = useCallback(async () => {
    setCandidates(null)
    setError(null)
    try {
      setCandidates(emailPlacementCandidates(await listOpfsDocumentsStrict(), currentDocumentId))
    } catch (cause) {
      setError(`Inkwave couldn't read your other documents just now. Nothing has been created. ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }, [currentDocumentId])

  useEffect(() => { void scan() }, [scan])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const toggle = (id: string) => setSelected((before) => {
    const next = new Set(before)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const start = async () => {
    if (!candidates || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(candidates.filter((candidate) => selected.has(candidate.id)).map(({ id, title }) => ({ id, title })))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden p-2 sm:p-4" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose documents for new email"
        onMouseDown={(event) => event.stopPropagation()}
        className="iw-nightable iw-touch-guard iw-no-print relative flex max-h-[calc(100dvh-1rem)] min-w-0 w-full max-w-[620px] flex-col overflow-hidden bg-white shadow-xl font-serif text-stone-600"
        style={{ border: '1px solid var(--iw-nightable-border)', borderRadius: 14 }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4">
          <div>
            <h2 className="text-lg" style={{ color: 'var(--iw-ink)' }}>Start a new email</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--iw-pill-fg)' }}>
              Every email is kept in the Email manifest. Optionally include this one in any other .studio documents too.
            </p>
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose}
            className="-mt-1 text-2xl leading-none text-stone-400 disabled:opacity-40">×</button>
        </div>

        <div className="mx-5 mt-4 flex items-center gap-3 px-3 py-2.5"
          style={{ border: '1px solid var(--iw-nightable-border)', borderRadius: 10 }}>
          <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-xs"
            style={{ background: 'var(--iw-verified)', color: 'white' }}>✓</span>
          <span className="min-w-0 flex-1">
            <strong className="block font-normal" style={{ color: 'var(--iw-ink)' }}>Email</strong>
            <span className="block text-[11px]" style={{ color: 'var(--iw-pill-fg)' }}>Always included · Gmail keeps its own copy once synced</span>
          </span>
        </div>

        <div className="mx-5 mt-3 min-h-0 flex-1 overflow-y-auto">
          <p className="mb-2 text-[11px] uppercase tracking-wide" style={{ color: 'var(--iw-pill-fg)' }}>Also include in</p>
          {candidates === null && !error && <p className="py-3 text-sm" style={{ color: 'var(--iw-pill-fg)' }}>Reading documents…</p>}
          {candidates?.length === 0 && (
            <p className="py-3 text-sm" style={{ color: 'var(--iw-pill-fg)' }}>No other documents are stored on this device yet.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {candidates?.map((candidate) => (
              <label key={candidate.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
                style={{ border: '1px solid var(--iw-nightable-border)', borderRadius: 10 }}>
                <input type="checkbox" checked={selected.has(candidate.id)} onChange={() => toggle(candidate.id)}
                  aria-label={`Include ${candidate.title}`} className="h-4 w-4 accent-[var(--iw-ink)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: 'var(--iw-ink)' }}>{candidate.title}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--iw-pill-fg)' }}>
                    {candidate.current ? 'This window · ' : ''}{candidate.kind} · {new Date(candidate.updatedAt).toLocaleString()}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="mx-5 mt-3 px-3 py-2 text-xs"
            style={{ color: 'var(--iw-danger)', border: '1px solid var(--iw-danger)', borderRadius: 9 }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4">
          <span className="text-xs" style={{ color: 'var(--iw-pill-fg)' }}>
            {selected.size ? `Email + ${selected.size} other document${selected.size === 1 ? '' : 's'}` : 'Email manifest only'}
          </span>
          <div className="flex gap-2">
            {error && candidates === null && (
              <button type="button" onClick={() => void scan()} className="px-4 py-2 text-sm"
                style={{ color: 'var(--iw-ink)', border: '1px solid var(--iw-nightable-border)', borderRadius: 9 }}>Try again</button>
            )}
            <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm disabled:opacity-40"
              style={{ color: 'var(--iw-ink)', border: '1px solid var(--iw-nightable-border)', borderRadius: 9 }}>Cancel</button>
            <button type="button" onClick={() => void start()} disabled={!candidates || busy} className="px-4 py-2 text-sm disabled:opacity-40"
              style={{ color: 'white', background: 'var(--iw-ink)', borderRadius: 9 }}>
              {busy ? 'Starting…' : 'Start email'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
