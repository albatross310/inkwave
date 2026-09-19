import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateWorkspaceItem,
  normaliseWorkspaceSequence,
  openLeftOfActive,
  readWorkspaceSequence,
  workspaceNeighbourId,
  writeWorkspaceSequence,
} from './sequence'

describe('local workspace sequence', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
  })

  it('opens a new panel on the left and leaves its source page on the right', () => {
    const blank = normaliseWorkspaceSequence(null, 'blank')
    const email = openLeftOfActive(blank, 'email')
    expect(email).toEqual({ version: 1, order: ['email', 'blank'], activeId: 'email' })
    expect(workspaceNeighbourId(email, 1)).toBe('blank')
    expect(workspaceNeighbourId(email, -1)).toBeNull()
  })

  it('moves through existing items without duplicating or reordering them', () => {
    const sequence = { version: 1 as const, order: ['mail', 'page', 'note'], activeId: 'mail' }
    const page = activateWorkspaceItem(sequence, 'page')
    expect(page.order).toEqual(sequence.order)
    expect(workspaceNeighbourId(page, -1)).toBe('mail')
    expect(workspaceNeighbourId(page, 1)).toBe('note')
  })

  it('survives reload-shaped reads and repairs duplicate or malformed ids', () => {
    sessionStorage.setItem('inkwave:workspaceSequence:v1', JSON.stringify({
      version: 1,
      order: ['mail', 'mail', null, 'page'],
      activeId: 'mail',
    }))
    expect(readWorkspaceSequence('mail')).toEqual({
      version: 1,
      order: ['mail', 'page'],
      activeId: 'mail',
    })
  })

  it('persists only presentation ids, never document bytes', () => {
    const sequence = { version: 1 as const, order: ['mail', 'page'], activeId: 'mail' }
    writeWorkspaceSequence(sequence)
    expect(readWorkspaceSequence('mail')).toEqual(sequence)
    expect(sessionStorage.getItem('inkwave:workspaceSequence:v1')).not.toContain('contentJson')
  })
})
