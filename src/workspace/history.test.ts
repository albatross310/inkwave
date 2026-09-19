// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  pushWorkspacePanelHistory,
  replaceWorkspacePanelHistory,
  workspacePanelIdFromHistory,
} from './history'

describe('workspace browser history projection', () => {
  beforeEach(() => window.history.replaceState({ routerKey: 'kept' }, '', '/'))

  it('marks the current entry without discarding unrelated state', () => {
    replaceWorkspacePanelHistory('page-a')
    expect(workspacePanelIdFromHistory(window.history.state)).toBe('page-a')
    expect(window.history.state.routerKey).toBe('kept')
    expect(new URL(window.location.href).searchParams.get('doc')).toBe('page-a')
  })

  it('preserves the outgoing panel and pushes the target panel', () => {
    replaceWorkspacePanelHistory('page-a')
    const before = window.history.length
    pushWorkspacePanelHistory('page-a', 'email-b')
    expect(window.history.length).toBe(before + 1)
    expect(workspacePanelIdFromHistory(window.history.state)).toBe('email-b')
    expect(new URL(window.location.href).searchParams.get('doc')).toBe('email-b')
  })

  it('ignores unrelated and malformed browser entries', () => {
    expect(workspacePanelIdFromHistory(null)).toBeNull()
    expect(workspacePanelIdFromHistory({ __inkwaveWorkspacePanel: { version: 2, id: 'old' } })).toBeNull()
    expect(workspacePanelIdFromHistory({ __inkwaveWorkspacePanel: { version: 1, id: '' } })).toBeNull()
  })
})

