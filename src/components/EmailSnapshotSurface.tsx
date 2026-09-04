// The read-only face of an email snapshot. It receives the SNAPSHOT'S frozen headers, never the
// live document's current headers: /snapshot is a historical view, and showing today's recipient
// beside yesterday's anchored body would be a provenance lie.

import type { ReactNode } from 'react'
import type { Snapshot } from '../types/document'
import { ApplicationSurface, type ApplicationSurfaceMode } from './ApplicationSurface'

const TEXT = 'var(--iw-snap-text, #3a3a3a)'
const MUTED = 'var(--iw-snap-muted, #6f6a7d)'

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '4.5rem minmax(0, 1fr)', gap: '0.75rem', padding: '0.5rem 0' }}>
      <dt style={{ color: MUTED }}>{label}</dt>
      <dd style={{ color: TEXT, margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  )
}

export function EmailSnapshotSurface({
  snapshot,
  surfaceMode = 'isolated',
  children,
}: {
  snapshot: Pick<Snapshot, 'email'>
  surfaceMode?: ApplicationSurfaceMode
  children: ReactNode
}) {
  const headers = snapshot.email
  if (!headers) return <>{children}</>
  const to = headers.to.join(', ')
  const cc = headers.cc?.join(', ') ?? ''
  const bcc = headers.bcc?.join(', ') ?? ''
  return (
    <ApplicationSurface
      app="email"
      label="Recorded email"
      ariaLabel="Email recorded in this snapshot"
      mode={surfaceMode}
      resizable={surfaceMode === 'isolated'}
    >
      <dl className="iw-email-snapshot-headers" style={{ margin: 0 }}>
        <HeaderRow label="To" value={to || '(no recipient)'} />
        {cc && <HeaderRow label="Cc" value={cc} />}
        {bcc && <HeaderRow label="Bcc" value={bcc} />}
        <HeaderRow label="Subject" value={headers.subject || '(no subject)'} />
      </dl>
      <div className="iw-application-surface__body iw-email-message-body" aria-label="Recorded message body">
        {children}
      </div>
    </ApplicationSurface>
  )
}
