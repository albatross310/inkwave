// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../types/document'
import { EmailSnapshotSurface } from '../components/EmailSnapshotSurface'

function snapshot(email?: Snapshot['email']): Snapshot {
  return {
    id: 'snap-1',
    documentId: 'email-1',
    createdAt: '2026-09-03T18:29:30+10:00',
    trigger: 'manual',
    wordCount: 2,
    contentHash: 'body-hash',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Historical body' }] }] },
    email,
    emailHash: email ? 'email-hash' : undefined,
    bundleHash: 'bundle-hash',
    ots: { status: 'pending', proofBase64: 'AA==' },
  }
}

afterEach(cleanup)

describe('/snapshot email rendering', () => {
  it('shows the frozen To, Cc, Bcc, and Subject from the selected snapshot', () => {
    render(
      <EmailSnapshotSurface snapshot={snapshot({
        to: ['ada@example.com'],
        cc: ['charles@example.com'],
        bcc: ['archive@example.com'],
        subject: 'Notes on the engine',
      })}>
        <p>Historical body</p>
      </EmailSnapshotSurface>,
    )

    const surface = screen.getByRole('region', { name: 'Email recorded in this snapshot' })
    expect(surface.getAttribute('data-iw-surface-mode')).toBe('isolated')
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.getByText('charles@example.com')).toBeTruthy()
    expect(screen.getByText('archive@example.com')).toBeTruthy()
    expect(screen.getByText('Notes on the engine')).toBeTruthy()
    expect(screen.getByLabelText('Recorded message body').contains(screen.getByText('Historical body'))).toBe(true)
  })

  it('renders an ordinary snapshot without email chrome', () => {
    render(<EmailSnapshotSurface snapshot={snapshot()}><p>Ordinary body</p></EmailSnapshotSurface>)
    expect(screen.queryByRole('region', { name: 'Email recorded in this snapshot' })).toBeNull()
    expect(screen.getByText('Ordinary body')).toBeTruthy()
  })

  it('omits empty optional recipient rows without hiding an empty required field', () => {
    render(<EmailSnapshotSurface snapshot={snapshot({ to: [], cc: [], bcc: [], subject: '' })}><p>Body</p></EmailSnapshotSurface>)
    expect(screen.queryByText('Cc')).toBeNull()
    expect(screen.queryByText('Bcc')).toBeNull()
    expect(screen.getByText('(no recipient)')).toBeTruthy()
    expect(screen.getByText('(no subject)')).toBeTruthy()
  })
})
