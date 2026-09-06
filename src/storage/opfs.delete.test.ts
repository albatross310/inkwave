import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import type { InkwaveDocument } from '../types/document'

describe('explicit stored-document deletion', () => {
  beforeEach(() => { vi.resetModules(); resetOpfsShim(); installOpfsShim() })

  it('removes the complete document directory only when called explicitly', async () => {
    const { deleteStoredDocument, listDocumentIds, readDocument, saveDocument } = await import('./opfs')
    const doc: InkwaveDocument = {
      id: 'delete-me',
      title: 'Delete me',
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
      schemaVersion: '0.1.0',
      scasLimitN: 'infinite',
      scasSessionSeed: 'seed',
    }
    await saveDocument(doc)
    expect(await listDocumentIds()).toContain(doc.id)

    await deleteStoredDocument(doc.id)

    expect(await listDocumentIds()).not.toContain(doc.id)
    expect(await readDocument(doc.id)).toEqual({ kind: 'absent' })
  })
})
