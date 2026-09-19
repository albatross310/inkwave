import { describe, expect, it } from 'vitest'
import { emailPlacementCandidates } from './NewEmailPlacementDialog'
import type { OpfsDocEntry } from '../storage/opfs'

function entry(id: string, title: string, updatedAt: string, docType?: 'email'): OpfsDocEntry {
  return {
    id,
    size: 100,
    lastModified: 0,
    doc: {
      id,
      title,
      updatedAt,
      createdAt: updatedAt,
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      schemaVersion: '0.1.0',
      scasLimitN: 'infinite',
      scasSessionSeed: id,
      docType,
    },
  }
}

describe('new-email membership picker', () => {
  it('pins the current document, retains other readable .studio documents, and labels emails', () => {
    const candidates = emailPlacementCandidates([
      entry('recent', 'Recent project', '2026-09-07T03:00:00.000Z'),
      entry('current', 'Current project', '2026-09-07T01:00:00.000Z'),
      entry('mail', 'Earlier email', '2026-09-07T02:00:00.000Z', 'email'),
      { id: 'broken', size: 0, lastModified: 0, doc: null },
    ], 'current')

    expect(candidates.map(({ id, kind, current }) => ({ id, kind, current }))).toEqual([
      { id: 'current', kind: 'Document', current: true },
      { id: 'recent', kind: 'Document', current: false },
      { id: 'mail', kind: 'Email', current: false },
    ])
  })
})
