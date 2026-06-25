import { useState } from 'react'
import { Link } from 'react-router'
import { verifyBundle, type VerifyReport } from '../verify'
import { computeAnalytics, type Analytics } from '../verify/analytics'
import { ActivityGraph } from '../verify/ActivityGraph'
import { signingPublicKeyHex } from '../provenance/receipts'
import { parseTraceFile } from '../provenance/bundle'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

// Open verification page (M5). Drop in an Inkwave export bundle; everything runs in YOUR browser
// against the published signing key — no Inkwave login, nothing sent anywhere.
export function Verify() {
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState<string | null>(null)

  async function run(text: string) {
    setError(null); setReport(null); setAnalytics(null); setTitle(null); setBusy(true)
    try {
      const bundle = parseTraceFile(text)
      if (bundle.v !== 1 || !Array.isArray(bundle.receipts) || !Array.isArray(bundle.snapshots)) {
        throw new Error('not an Inkwave export bundle')
      }
      setTitle(bundle.document?.title ?? null)
      // Verify against the published key (dev uses the dev placeholder, matching dev-signed bundles).
      setReport(await verifyBundle(bundle, signingPublicKeyHex()))
      setAnalytics(computeAnalytics(bundle)) // descriptive, derived from the same signed data
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(run)
  }

  const [dragOver, setDragOver] = useState(false)
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) void file.text().then(run)
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10 font-serif" style={{ color: '#3a3a3a' }}>
      <div className="w-full max-w-3xl">
        <div className="flex items-start gap-4 mb-5">
          <img src="/inkwave-logo-colour-512.png?v=4" alt="Inkwave" width={72} height={72} style={{ borderRadius: '50%' }} />
          <div>
            <h1 className="text-2xl mb-1" style={{ color: INK }}>Verify an Inkwave record</h1>
            <p className="text-sm text-stone-500">
              Runs entirely in your browser against Inkwave's published signing key — and, for anchored
              snapshots, against the Bitcoin blockchain via independent explorers. No sign-in, nothing
              uploaded. <Link to="/" className="underline" style={{ color: LIGHT }}>← editor</Link>
              {' · '}<Link to="/about" className="underline" style={{ color: LIGHT }}>about</Link>
            </p>
          </div>
        </div>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className="block border-2 border-dashed rounded-xl px-4 py-10 text-center cursor-pointer transition-colors"
          style={{ borderColor: dragOver ? INK : `${INK}55`, background: dragOver ? `${INK}0d` : undefined }}
        >
          <input type="file" accept=".studio,.inkwave,application/json,.json,.trace.json,.insig.json" className="hidden" onChange={onFile} />
          <span style={{ color: INK }}>{dragOver ? 'Drop to verify' : 'Drop a record here, or choose one'}</span>
          <span className="block text-xs text-stone-400 mt-1">a .studio file (or .inkwave) from the editor</span>
        </label>

        {busy && <p className="mt-4 text-stone-500">Verifying…</p>}
        {error && <p className="mt-4 text-red-700">⚠ {error}</p>}

        {report && (
          <div className="mt-6">
            <div
              className="rounded-xl px-4 py-3 mb-4 text-lg"
              style={{ border: `1px solid ${INK}`, background: report.overall ? '#f3fbf3' : '#fdf3f3', color: report.overall ? '#246b24' : '#9b2226' }}
            >
              {report.overall ? '✓ Authentic Inkwave record' : '✗ Verification failed'}
              {title ? <span className="text-sm text-stone-500"> — “{title}”</span> : null}
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
              This confirms an authentic Inkwave session composed live against unpredictable
              constraints, tamper-evident and signed — not that a human wrote every word.
            </p>
          </div>
        )}

        {analytics && (analytics.stats.periods > 0 || analytics.stats.snapshots > 0) && (
          <div className="mt-8">
            <h2 className="text-lg mb-2" style={{ color: INK }}>Provenance analytics</h2>
            <ActivityGraph a={analytics} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 mt-5">
              <Stat label="Final words" value={analytics.stats.finalWords} />
              <Stat label="Words added" value={`≥ ${analytics.stats.addedWords}`} hint="lower bound" />
              <Stat label="Words deleted" value={`≥ ${analytics.stats.deletedWords}`} hint="lower bound" />
              <Stat label="Churn" value={`${Math.round(analytics.stats.churn * 100)}%`} hint="deleted ÷ added" />
              <Stat label="Kicks" value={analytics.stats.totalKicks} hint={`${analytics.stats.swaps} swapped`} />
              <Stat label="Snapshots" value={analytics.stats.snapshots} />
              <Stat label="Sessions" value={analytics.stats.sessions} hint={`${analytics.stats.periods} period(s)`} />
              {analytics.stats.durationMs != null && <Stat label="Duration" value={fmtDur(analytics.stats.durationMs)} />}
              {analytics.stats.wpm != null && <Stat label="Words / min" value={analytics.stats.wpm} />}
              {analytics.stats.avgDeliberationMs != null && <Stat label="Avg deliberation" value={`${(analytics.stats.avgDeliberationMs / 1000).toFixed(1)}s`} hint="per kick" />}
            </div>
            <p className="mt-3 text-xs text-stone-400">
              Drawn from the signed, Bitcoin-anchored record. Words added/deleted are LOWER BOUNDS from
              the snapshot contents — rework between snapshots that cancels out isn't counted. Word counts
              at snapshots are exact.
            </p>
          </div>
        )}
      </div>
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

function Row({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b" style={{ borderColor: '#eee' }}>
      <span className="w-5">{ok === undefined ? '·' : ok ? '✓' : '✗'}</span>
      <span className="w-40" style={{ color: INK }}>{label}</span>
      <span className="text-sm text-stone-500 flex-1">{detail}</span>
    </div>
  )
}
