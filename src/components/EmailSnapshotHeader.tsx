// The read-only face of an email snapshot. It receives the SNAPSHOT'S frozen headers, never the
// live document's current headers: /snapshot is a historical view, and showing today's recipient
// beside yesterday's anchored body would be a provenance lie.

import type { Snapshot } from '../types/document'

const CARD = 'var(--iw-snap-card, #ffffff)'
const TEXT = 'var(--iw-snap-text, #3a3a3a)'
const MUTED = 'var(--iw-snap-muted, #6f6a7d)'
const EDGE = 'var(--iw-snap-card-edge, rgba(92,45,138,0.4))'
const INK = 'var(--iw-snap-ink, #5c2d8a)'

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '4.5rem minmax(0, 1fr)', gap: '0.75rem', padding: '0.5rem 0' }}>
      <dt style={{ color: MUTED }}>{label}</dt>
      <dd style={{ color: TEXT, margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  )
}

export function EmailSnapshotHeader({ snapshot }: { snapshot: Pick<Snapshot, 'email'> }) {
  const headers = snapshot.email
  if (!headers) return null
  const to = headers.to.join(', ')
  const cc = headers.cc?.join(', ') ?? ''
  const bcc = headers.bcc?.join(', ') ?? ''
  return (
    <section
      aria-label="Email headers recorded in this snapshot"
      style={{
        margin: '0 0 1.5rem', padding: '0.75rem 1rem', background: CARD, color: TEXT,
        border: `1px solid ${EDGE}`, borderRadius: '0.75rem', fontFamily: 'inherit', fontSize: '0.92rem',
      }}
    >
      <div style={{ color: INK, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Recorded email
      </div>
      <dl style={{ margin: '0.35rem 0 0' }}>
        <HeaderRow label="To" value={to || '(no recipient)'} />
        {cc && <HeaderRow label="Cc" value={cc} />}
        {bcc && <HeaderRow label="Bcc" value={bcc} />}
        <HeaderRow label="Subject" value={headers.subject || '(no subject)'} />
      </dl>
    </section>
  )
}
