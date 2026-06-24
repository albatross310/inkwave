// VerifyModal — inline verifier opened from the toolbar. Auto-verifies the current document
// on mount; also accepts drag-and-drop of external bundles. Same logic as /verify but in a
// bottom-sheet modal so the writer never leaves the editor.

import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import { verifyBundle, type VerifyReport } from '../verify'
import { computeAnalytics, type Analytics } from '../verify/analytics'
import { ActivityGraph } from '../verify/ActivityGraph'
import { signingPublicKeyHex } from '../provenance/receipts'
import { parseTraceFile, buildExportBundle, type ExportBundle } from '../provenance/bundle'
import type { InkwaveDocument, Snapshot } from '../types/document'

const INK = '#5c2d8a'

export function VerifyModal({
  doc,
  snapshots,
  onClose,
}: {
  doc: InkwaveDocument
  snapshots: Snapshot[]
  onClose: () => void
}) {
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [verifiedTitle, setVerifiedTitle] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function runBundle(bundle: ExportBundle) {
    setError(null); setReport(null); setAnalytics(null); setVerifiedTitle(null); setBusy(true)
    try {
      if (bundle.v !== 1 || !Array.isArray(bundle.receipts) || !Array.isArray(bundle.snapshots)) {
        throw new Error('not an Inkwave export bundle')
      }
      setVerifiedTitle(bundle.document?.title ?? null)
      setReport(await verifyBundle(bundle, signingPublicKeyHex()))
      setAnalytics(computeAnalytics(bundle))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Auto-verify the current document immediately on open.
  useEffect(() => {
    void runBundle(buildExportBundle(doc, snapshots))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((t) => runBundle(parseTraceFile(t)))
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) void file.text().then((t) => runBundle(parseTraceFile(t)))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-stone-900/30" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Verify record"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-white shadow-2xl font-serif"
        style={{
          borderRadius: '18px 18px 0 0',
          borderTop: `2px solid ${INK}`,
          borderLeft: `1px solid ${INK}40`,
          borderRight: `1px solid ${INK}40`,
        }}
      >
        {/* Sticky header */}
        <div
          className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 pt-4 pb-3"
          style={{ borderBottom: '1px solid #eee' }}
        >
          <h2 className="text-base font-serif" style={{ color: INK }}>Verify record</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 text-stone-700">
          {busy && (
            <p className="text-stone-500 mb-4">Verifying…</p>
          )}
          {error && (
            <p className="text-red-700 mb-4">⚠ {error}</p>
          )}

          {report && (
            <div className="mb-5">
              <div
                className="rounded-xl px-4 py-3 mb-4 text-base"
                style={{
                  border: `1px solid ${INK}`,
                  background: report.overall ? '#f3fbf3' : '#fdf3f3',
                  color: report.overall ? '#246b24' : '#9b2226',
                }}
              >
                {report.overall ? '✓ Authentic Inkwave record' : '✗ Verification failed'}
                {verifiedTitle
                  ? <span className="text-sm text-stone-500"> — "{verifiedTitle}"</span>
                  : null}
              </div>

              <Row label="Content integrity" ok={report.contentIntegrity.ok}
                detail={report.contentIntegrity.ok ? `${report.contentIntegrity.checked} snapshot(s) intact` : report.contentIntegrity.reason} />
              <Row label="Readable copy" ok={report.textIntegrity.ok}
                detail={report.textIntegrity.ok ? report.contentBinding.note : report.textIntegrity.reason} />
              <Row label="Signed chain" ok={report.chain.ok}
                detail={report.chain.ok ? `${report.chain.verified} receipt(s) across ${report.chain.sessions} session(s) verify` : report.chain.reason} />
              <Row label="Kick consistency" ok={report.kickConsistency.ok}
                detail={report.kickConsistency.ok ? `${report.kickConsistency.checked} kick(s) match the signed sets` : report.kickConsistency.reason} />
              <Row label="Friction" detail={report.friction.note} />
              <Row label="Bitcoin anchoring"
                ok={report.anchor.tampered > 0 || !report.anchor.timeConsistent ? false
                  : report.anchor.confirmed > 0 ? true : undefined}
                detail={report.anchor.note} />

              <p className="mt-4 text-xs text-stone-400">
                Confirms an authentic Inkwave session composed live against unpredictable constraints,
                tamper-evident and signed — not that a human wrote every word.
              </p>
            </div>
          )}

          {analytics && (analytics.stats.periods > 0 || analytics.stats.snapshots > 0) && (
            <div className="mb-5">
              <h3 className="text-sm mb-3 text-stone-500 uppercase tracking-wide">Provenance analytics</h3>
              <ActivityGraph a={analytics} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 mt-4">
                <Stat label="Final words" value={analytics.stats.finalWords} />
                <Stat label="Words added" value={`≥ ${analytics.stats.addedWords}`} hint="lower bound" />
                <Stat label="Words deleted" value={`≥ ${analytics.stats.deletedWords}`} hint="lower bound" />
                <Stat label="Churn" value={`${Math.round(analytics.stats.churn * 100)}%`} hint="deleted ÷ added" />
                <Stat label="Kicks" value={analytics.stats.totalKicks} hint={`${analytics.stats.swaps} swapped`} />
                <Stat label="Snapshots" value={analytics.stats.snapshots} />
                <Stat label="Sessions" value={analytics.stats.sessions} hint={`${analytics.stats.periods} period(s)`} />
                {analytics.stats.durationMs != null && <Stat label="Duration" value={fmtDur(analytics.stats.durationMs)} />}
                {analytics.stats.wpm != null && <Stat label="Words / min" value={analytics.stats.wpm} />}
              </div>
            </div>
          )}

          {/* Drop zone to verify a different (external) file */}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="block border-2 border-dashed rounded-xl px-4 py-4 text-center cursor-pointer transition-colors mb-2"
            style={{ borderColor: dragOver ? INK : `${INK}44`, background: dragOver ? `${INK}0d` : undefined }}
          >
            <input
              type="file"
              accept=".studio,.inkwave,application/json,.json,.trace.json,.insig.json"
              className="hidden"
              onChange={onFile}
            />
            <span className="text-sm" style={{ color: `${INK}99` }}>
              {dragOver ? 'Drop to verify' : 'Drop a different record here to verify it instead'}
            </span>
          </label>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Row({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b" style={{ borderColor: '#eee' }}>
      <span className="w-5 shrink-0">{ok === undefined ? '·' : ok ? '✓' : '✗'}</span>
      <span className="w-36 shrink-0 text-sm" style={{ color: INK }}>{label}</span>
      <span className="text-sm text-stone-500 flex-1">{detail}</span>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-2xl leading-none" style={{ color: INK }}>{value}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
      {hint ? <div className="text-[11px] text-stone-400">{hint}</div> : null}
    </div>
  )
}

function fmtDur(msTotal: number): string {
  const s = Math.round(msTotal / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
