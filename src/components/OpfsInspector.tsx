// OpfsInspector — "Storage" in the hamburger (⋮) menu: every document this device is actually
// holding, and a way to get any of them back.
//
// WHY THIS EXISTS (Peter, 2026-07-17, after losing real annotation work):
//   "we need opfs to parallelise aggressively by tab and be manually examinable somehow. There
//    needs to be maybe an opfs button in hamburger menu where users can go in and inspect all the
//    opfs instances they have open in case this happens again once actual users are using it"
//
// It is a RECOVERY SURFACE, not a debug view. The person opening it has just lost work and wants
// their words back, so the listing leads with what a writer recognises — title, when it was last
// written, the opening words — and every row offers Open and Download. Byte counts are present but
// secondary; nothing here is a hex dump.
//
// THE LISTING MUST COME FROM STORAGE, NOT THE INDEX. It enumerates `documents/` via
// `listOpfsDocuments()` (OPFS directly), never `listMeta()` (IndexedDB). An ORPHANED document is
// BY DEFINITION one that OPFS has and the index does not surface — the old origin-wide
// `inkwave:activeDocumentId` pointer let one tab re-point another and strand its file
// intact-but-unreachable. A listing built from the index could not show the very documents this
// panel exists to recover. The index is read ONLY to decide which rows get the "not in the index"
// badge — i.e. it is the thing being CHECKED, never the source of truth.
//
// NO DELETE, DELIBERATELY. Every control here either opens or preserves. Someone arrives at this
// panel confused and frightened about missing work; a destructive button next to a row they cannot
// identify is how the near-miss becomes the real loss. Deleting is available at the OS/browser
// level for anyone who truly needs it.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listOpfsDocuments, readDocumentBytes } from '../storage/opfs'
import { listMeta } from '../storage/indexeddb'
import { heldDocIds, switchTabToDocument, tabDocId, DOC_LOCK_PREFIX } from '../storage/tabDoc'
import { listSnapshotMeta } from '../provenance/snapshots'
import { buildExportBundleWithPdfs, bundleFilename, downloadBundle, pmToText } from '../provenance/bundle'
import { readSnapshotArchive } from '../provenance/snapshots'
import type { InkwaveDocument } from '../types/document'

const INK = '#5c2d8a'

interface Row {
  id: string
  title: string
  updatedAt: number      // ms — doc.updatedAt when parseable, else the file's mtime
  size: number
  words: number
  preview: string
  orphaned: boolean      // in OPFS but NOT in the IndexedDB meta index
  isThisTab: boolean
  busyElsewhere: boolean // another LIVE tab holds this document's Web Lock
  readable: boolean      // false ⇒ current.json missing or unparseable
  doc: InkwaveDocument | null
}

// The ONE definition, imported from the module that takes the locks (tabDoc.ts). A private copy of
// this string here would let a rename there put this badge silently to sleep — and a badge that has
// stopped firing is indistinguishable from "no other tab has it open".
const LOCK_PREFIX = DOC_LOCK_PREFIX

/**
 * Which documents are held by SOME live tab, per Web Locks. Read-only: `locks.query()` observes,
 * it does not claim — calling `claimDocLock()` to test would make THIS tab the holder, which is
 * exactly the side effect a listing must not have.
 *
 * Absent `navigator.locks` (older WebKit) ⇒ empty set ⇒ no badge. Degrade to telling the writer
 * less, NEVER to blocking them out of their own document.
 */
async function heldByAnyTab(): Promise<Set<string>> {
  try {
    const locks = (navigator as unknown as {
      locks?: { query?: () => Promise<{ held?: Array<{ name?: string }> }> }
    }).locks
    if (!locks?.query) return new Set()
    const { held } = await locks.query()
    return new Set(
      (held ?? [])
        .map(l => l.name ?? '')
        .filter(n => n.startsWith(LOCK_PREFIX))
        .map(n => n.slice(LOCK_PREFIX.length)),
    )
  } catch { return new Set() }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtWhen(ms: number): string {
  if (!ms) return 'unknown'
  const d = new Date(ms)
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago · ${d.toLocaleTimeString()}`
  return d.toLocaleString()
}

// The opening words, so the writer RECOGNISES the document. Never logged, never sent anywhere —
// it is rendered into this panel and nowhere else (thesis-integrity rule).
function previewOf(doc: InkwaveDocument | null): { preview: string; words: number } {
  if (!doc?.contentJson) return { preview: '', words: 0 }
  let text = ''
  try { text = pmToText(doc.contentJson).replace(/\s+/g, ' ').trim() } catch { return { preview: '', words: 0 } }
  const words = text ? text.split(/\s+/).length : 0
  return { preview: text.length > 160 ? `${text.slice(0, 160)}…` : text, words }
}

export function OpfsInspector({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [snapCounts, setSnapCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setRows(null)
    const entries = await listOpfsDocuments()
    // The index is CHECKED against storage, never used to build the listing (see the header).
    let indexed = new Set<string>()
    try { indexed = new Set((await listMeta()).map(m => m.id)) } catch { /* index unreadable — every row simply reads as orphaned, which is the safe direction */ }
    const mine = tabDocId()
    // "Held by some tab" minus "held by THIS tab" = held by ANOTHER live tab. One live tab per
    // document (Web Locks, tabDoc.ts), so Open on such a row would not do what it says.
    const anyTab = await heldByAnyTab()
    const ours = new Set(heldDocIds())
    const next: Row[] = entries.map(e => {
      const { preview, words } = previewOf(e.doc)
      const updatedAt = e.doc?.updatedAt ? Date.parse(e.doc.updatedAt) || e.lastModified : e.lastModified
      return {
        id: e.id,
        title: e.doc?.title?.trim() || (e.doc ? 'Untitled' : 'Unreadable document'),
        updatedAt, size: e.size, words, preview,
        orphaned: !indexed.has(e.id),
        isThisTab: e.id === mine,
        busyElsewhere: anyTab.has(e.id) && !ours.has(e.id) && e.id !== mine,
        readable: !!e.doc,
        doc: e.doc,
      }
    })
    // Most recently written first — the lost document is nearly always the one just worked on.
    next.sort((a, b) => b.updatedAt - a.updatedAt)
    setRows(next)

    // Snapshot counts are a SECOND pass on purpose: each one reads + gunzips a snapshots file, so
    // doing it inline would hold the listing hostage to the slowest document. The rows render
    // immediately and the counts fill in.
    for (const r of next) {
      try {
        const metas = await listSnapshotMeta(r.id)
        if (metas.length) setSnapCounts(c => ({ ...c, [r.id]: metas.length }))
        // No snapshots ⇒ no count shown; an unreadable archive ⇒ also no count, and that is the
        // right degrade for a per-row decoration in a listing whose job is to show what EXISTS.
        // The count's absence never licenses a write, and `download` above refuses outright.
      } catch { /* no snapshots, or the archive would not read — either way, no count */ }
    }
  }, [])

  useEffect(() => { void scan() }, [scan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Download — reuse the real export path (buildExportBundleWithPdfs + downloadBundle), the same
  // self-verifying .studio the Save panel's "⤓ Download a copy" produces. A recovered document
  // must come out as a FIRST-CLASS file (snapshots, receipts, embedded PDFs), not a debug blob:
  // the writer downloading it here is trying to make sure it can never be lost again.
  // The raw bytes, for a document we could not parse. No bundle, no interpretation — just the file,
  // so the writer keeps everything that is actually on disk.
  async function downloadRaw(row: Row) {
    setBusy(row.id); setError(null)
    try {
      const blob = await readDocumentBytes(row.id)
      if (!blob) { setError(`"${row.title}" could not be read from storage at all.`); return }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inkwave-unreadable-${row.id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(`Could not download "${row.title}": ${String((err as Error)?.message ?? err)}`)
    } finally { setBusy(null) }
  }

  async function download(row: Row) {
    if (!row.doc) return
    setBusy(row.id); setError(null)
    try {
      // NO `.catch(() => [])` HERE — that silently produced a .studio with an EMPTY history from a
      // failed archive read, which is the one thing the comment above forbids ("a FIRST-CLASS file
      // (snapshots, receipts…)"), and it did it in the recovery tool, to a writer whose whole reason
      // for being here is making sure nothing is lost. A bundle that quietly drops the provenance is
      // worse than no bundle: he would keep it as his proof. Refuse and say so — `downloadRaw` above
      // is the escape hatch that still gets his bytes out, so refusing costs him nothing.
      const archive = await readSnapshotArchive(row.id)
      if (archive.kind === 'error') {
        setError(
          `Could not read the history for "${row.title}", so it wasn't downloaded — a copy without ` +
          `its history would look like proof and wouldn't be. Nothing was changed; try again, or use ` +
          `"raw" to save the underlying file.`,
        )
        return
      }
      const bundle = await buildExportBundleWithPdfs(row.doc, archive.snapshots)
      downloadBundle(bundle, bundleFilename(row.doc))
    } catch (err) {
      setError(`Could not download "${row.title}": ${String((err as Error)?.message ?? err)}`)
    } finally { setBusy(null) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
      {/* iw-nightable: without it this panel renders white-on-white in night mode (CLAUDE.md).
          iw-touch-guard: portaled panel over the editor — taps must not blur the contenteditable
          and retract the iOS keyboard. */}
      <div
        role="dialog" aria-modal="true" aria-label="Documents on this device"
        onMouseDown={e => e.stopPropagation()}
        className="iw-nightable iw-touch-guard iw-no-print relative bg-white w-[560px] max-w-[94vw] max-h-[86vh] flex flex-col shadow-xl font-serif text-stone-600"
        style={{ border: `1px solid ${INK}bf`, borderRadius: 14 }}
      >
        <div className="flex items-start justify-between px-5 pt-4">
          <div>
            <h2 className="text-lg" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Documents on this device</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
              Everything Inkwave is storing here, read straight from storage. Nothing is deleted from this panel.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            className="text-stone-400 hover:text-[#5c2d8a] text-2xl leading-none -mt-1">×</button>
        </div>

        {error && (
          <p className="mx-5 mt-3 text-xs px-3 py-2" style={{ color: 'var(--iw-ink, #5c2d8a)', border: '1px solid var(--iw-nightable-border, #e7e5e4)', borderRadius: 8 }}>{error}</p>
        )}

        <div className="flex-1 overflow-auto px-5 py-3 flex flex-col gap-2">
          {rows === null && <p className="text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>Looking through storage…</p>}
          {rows?.length === 0 && <p className="text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>No documents are stored on this device.</p>}
          {rows?.map(r => (
            <div key={r.id} data-testid="opfs-row" data-doc-id={r.id}
              className="px-3.5 py-2.5 flex flex-col gap-1.5"
              style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', borderRadius: 10 }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>{r.title}</span>
                {r.isThisTab && <Badge kind="tab">this tab’s document</Badge>}
                {r.busyElsewhere && <Badge kind="busy">open in another tab</Badge>}
                {r.orphaned && <Badge kind="orphan">not in the index</Badge>}
                {!r.readable && <Badge kind="orphan">unreadable</Badge>}
              </div>

              {r.preview && (
                <p className="text-xs leading-snug line-clamp-2" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{r.preview}</p>
              )}

              <div className="text-[11px] tabular-nums" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
                last written {fmtWhen(r.updatedAt)} · {r.words.toLocaleString()} words · {fmtBytes(r.size)}
                {snapCounts[r.id] ? ` · ${snapCounts[r.id]} snapshots` : ''}
              </div>

              {r.orphaned && !r.busyElsewhere && (
                <p className="text-[11px] leading-snug" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
                  This document is on disk but isn’t listed under Recent. Open it to bring it back, or download a copy to keep it safe.
                </p>
              )}

              {/* Say WHY Open is unavailable rather than letting the tab reload into a different
                  document — a silent wrong-document switch is how this panel's own bug started. */}
              {r.busyElsewhere && (
                <p className="text-[11px] leading-snug" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
                  Another tab has this document open, so only one tab can write to it. Switch to that tab to keep working — or download a copy from here.
                </p>
              )}

              <div className="flex gap-2 pt-0.5">
                <RowButton
                  onClick={() => switchTabToDocument(r.id)}
                  disabled={!r.readable || r.busyElsewhere || r.isThisTab}
                  testid="opfs-open"
                  title={r.busyElsewhere ? 'Open in another tab' : r.isThisTab ? 'Already open here' : undefined}
                >
                  {r.isThisTab ? 'Open here' : 'Open'}
                </RowButton>
                {/* An UNREADABLE document still has its bytes on disk, with the prose legible
                    inside them — and it is the row whose words the writer most needs back. Offering
                    nothing here would make the recovery surface a dead end at the exact moment it
                    exists for. So: the real .studio export when we can parse it, the raw file when
                    we cannot. */}
                <RowButton
                  onClick={() => void (r.readable ? download(r) : downloadRaw(r))}
                  disabled={busy === r.id}
                  testid="opfs-download"
                  title={r.readable ? undefined : 'This document could not be parsed — download the raw file so nothing is lost'}
                >
                  {busy === r.id ? 'Preparing…' : r.readable ? '⤓ Download' : '⤓ Download raw'}
                </RowButton>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-4 pt-1 flex items-center justify-between">
          <span className="text-[11px]" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            {rows ? `${rows.length} document${rows.length === 1 ? '' : 's'} in storage` : ''}
          </span>
          <button type="button" onClick={() => void scan()}
            className="text-xs px-2.5 py-1 rounded-full transition-colors"
            style={{ color: 'var(--iw-ink, #5c2d8a)', border: '1px solid var(--iw-nightable-border, #5c2d8a44)' }}
          >
            Rescan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Badge({ kind, children }: { kind: 'tab' | 'orphan' | 'busy'; children: React.ReactNode }) {
  // Every badge colour is a token with a day fallback — a hard-coded hex here would be invisible
  // or garish in night mode, the exact failure the theming rule prevents.
  const color = kind === 'tab'
    ? 'var(--iw-verified, #15803d)'
    : kind === 'busy'
      ? 'var(--iw-pill-fg, #78716c)'
      : 'var(--iw-ink, #5c2d8a)'
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, border: `1px solid ${color}` , opacity: kind === 'busy' ? 0.8 : 1 }}>
      {children}
    </span>
  )
}

function RowButton({ onClick, disabled, children, testid, title }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode; testid?: string; title?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid} title={title}
      className="text-xs px-3 py-1 transition-colors disabled:opacity-40"
      style={{ color: 'var(--iw-ink, #5c2d8a)', border: '1px solid var(--iw-nightable-border, #5c2d8a55)', borderRadius: 8 }}
    >
      {children}
    </button>
  )
}
