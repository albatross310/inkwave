// VerifyModal — inline verifier opened from the toolbar. Auto-verifies the current document
// on mount; also accepts drag-and-drop of external bundles. Same logic as /verify but in a
// bottom-sheet modal so the writer never leaves the editor.

import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/Scroll'
import { useState, useEffect } from 'react'
import { verifyBundle, type VerifyReport } from '../verify'
import { computeAnalytics, type Analytics } from '../verify/analytics'
import { ActivityGraph } from '../verify/ActivityGraph'
import { signingPublicKeys } from '../provenance/receipts'
import { parseTraceFile, buildExportBundle, type ExportBundle } from '../provenance/bundle'
import { readSnapshotArchive } from '../provenance/snapshots'
import type { InkwaveDocument } from '../types/document'

const INK = '#5c2d8a'

export function VerifyModal({
  doc,
  onClose,
}: {
  doc: InkwaveDocument
  onClose: () => void
}) {
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [verifiedTitle, setVerifiedTitle] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Countdown from 15 while verifying, so a slow check doesn't feel stuck (holds at 1 if it
  // overruns). Rendered big, inside a conic-gradient progress ring (Peter, 2026-07-10).
  const COUNTDOWN_FROM = 15
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM)
  useEffect(() => {
    if (!busy) return
    setCountdown(COUNTDOWN_FROM)
    const id = setInterval(() => setCountdown(c => (c > 1 ? c - 1 : 1)), 1000)
    return () => clearInterval(id)
  }, [busy])

  async function runBundle(bundle: ExportBundle) {
    setError(null); setReport(null); setAnalytics(null); setVerifiedTitle(null); setBusy(true)
    try {
      if (bundle.v !== 1 || !Array.isArray(bundle.receipts) || !Array.isArray(bundle.snapshots)) {
        throw new Error('not an Inkwave export bundle')
      }
      setVerifiedTitle(bundle.document?.title ?? null)
      setReport(await verifyBundle(bundle, signingPublicKeys()))
      setAnalytics(computeAnalytics(bundle))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Auto-verify the current document immediately on open. Full snapshots are fetched here AT
  // ACTION TIME (cached read) — the editor's React state carries only SnapshotMeta.
  useEffect(() => {
    // A VERDICT IS THE ONE THING THIS MODAL MUST NEVER GUESS. If the archive read fails, the old
    // `[]` would have built a bundle with NO snapshots and cheerfully verified it — reporting a
    // clean result over an empty history, which is the exact opposite of what a verifier is for.
    // Say we could not read it. (No `.catch` existed here either: a throw would spin `busy` forever.)
    void readSnapshotArchive(doc.id).then((r) => {
      if (r.kind === 'error') {
        setBusy(false)
        setError(
          "Couldn't read this document's history from local storage, so it can't be verified right " +
          'now. This does not mean anything is wrong with it — try again in a moment.',
        )
        return
      }
      return runBundle(buildExportBundle(doc, r.snapshots))
    })
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
        className="relative w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto iw-nightable bg-white shadow-2xl font-serif"
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
            <div className="flex items-center gap-4 mb-4">
              {/* Progress ring: the conic fill sweeps as the countdown runs; the inner disc keeps
                  the bg-white class so .iw-nightable themes it. */}
              <div
                aria-hidden="true"
                style={{
                  width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `conic-gradient(${INK} ${((COUNTDOWN_FROM - countdown) / COUNTDOWN_FROM) * 360}deg, rgba(92,45,138,0.14) 0deg)`,
                }}
              >
                <div
                  className="bg-white tabular-nums"
                  style={{
                    width: 54, height: 54, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.7rem', fontWeight: 700, color: INK, lineHeight: 1,
                  }}
                >
                  {countdown}
                </div>
              </div>
              <p className="text-stone-500">Verifying…</p>
            </div>
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
              <Row label="Word nudge consistency" ok={report.nudgeConsistency.ok}
                detail={report.nudgeConsistency.ok ? `${report.nudgeConsistency.checked} word nudge(s) match the signed sets` : report.nudgeConsistency.reason} />
              <Row label="Friction" detail={report.friction.note} />
              <Row label="Cadence"
                ok={!report.cadence.integrityOk ? false : report.cadence.pasteSuspectBins > 0 ? false : report.cadence.withDigest > 0 ? true : undefined}
                detail={report.cadence.note} />
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
                <Stat label="Word Nudges" value={analytics.stats.totalNudges} hint={`${analytics.stats.swaps} swapped`} />
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
              accept={isTouchDevice() ? undefined : '.studio,.inkwave,.gz,application/gzip,application/json,.json,.trace.json,.insig.json'}
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
      <span className="w-5 shrink-0" style={{ color: ok ? 'var(--iw-verify-tick, #246b24)' : ok === false ? '#9b2226' : undefined }}>{ok === undefined ? '·' : ok ? '✓' : '✗'}</span>
      <span className="w-36 shrink-0 text-sm" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>{label}</span>
      <span className="text-sm text-stone-500 flex-1">{detail}</span>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-2xl leading-none" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>{value}</div>
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
