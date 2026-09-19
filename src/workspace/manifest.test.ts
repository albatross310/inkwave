import { describe, expect, it } from 'vitest'
import {
  EMAIL_MANIFEST_CONTAINER,
  containersForNewEmail,
  containersForPlacement,
  embeddedMembershipsFor,
  emptyWorkspaceManifestStore,
  parseWorkspaceManifestStore,
  setEmbeddedMemberships,
} from './manifest'

const NOW = '2026-09-07T00:00:00.000Z'
const email = { id: 'email-1', title: 'Project update' }
const project = { id: 'project', title: 'Project Kookaburra' }
const month = { id: 'september', title: 'September email' }

describe('many-to-many workspace membership', () => {
  it('places one stable email identity in one or many existing .studio documents', () => {
    const next = setEmbeddedMemberships(emptyWorkspaceManifestStore(), email, [project, month], NOW)
    expect(embeddedMembershipsFor(next, email.id).map((m) => m.container_id)).toEqual(['project', 'september'])
    expect(next.containers.project.items.map((item) => item.subdoc_id)).toEqual(['project', 'email-1'])
    expect(next.containers.september.items.map((item) => item.subdoc_id)).toEqual(['september', 'email-1'])
  })

  it('removing one membership leaves the canonical subdoc and its other membership intact', () => {
    const both = setEmbeddedMemberships(emptyWorkspaceManifestStore(), email, [project, month], NOW)
    const one = setEmbeddedMemberships(both, email, [project], '2026-09-08T00:00:00.000Z')
    expect(embeddedMembershipsFor(one, email.id).map((m) => m.container_id)).toEqual(['project'])
    expect(one.containers.september.items.map((item) => item.subdoc_id)).toEqual(['september'])
  })

  it('a standalone choice creates the smallest one-subdoc container', () => {
    const desired = containersForPlacement(
      { kind: 'standalone' },
      project,
      { id: email.id, title: email.title },
    )
    const next = setEmbeddedMemberships(emptyWorkspaceManifestStore(), email, desired, NOW)
    expect(next.containers[email.id].items).toEqual([
      { subdoc_id: email.id, position: '000000001024', added_at: NOW },
    ])
  })

  it('refuses a corrupt manifest store rather than treating it as no memberships', () => {
    expect(() => parseWorkspaceManifestStore({ v: 1, containers: { project: { items: [] } } })).toThrow(/unreadable/i)
  })

  it('models the Email manifest as a container, not a fake authored document', () => {
    const next = setEmbeddedMemberships(emptyWorkspaceManifestStore(), email, [EMAIL_MANIFEST_CONTAINER, project], NOW)
    expect(next.containers[EMAIL_MANIFEST_CONTAINER.id].items).toEqual([
      { subdoc_id: email.id, position: '000000001024', added_at: NOW },
    ])
    expect(next.containers[EMAIL_MANIFEST_CONTAINER.id].active_subdoc_id).toBeUndefined()
  })

  it('always keeps a new email in Email and deduplicates optional destinations', () => {
    expect(containersForNewEmail([
      project,
      project,
      { id: EMAIL_MANIFEST_CONTAINER.id, title: 'a picker must not rename this' },
      month,
    ])).toEqual([EMAIL_MANIFEST_CONTAINER, project, month])
  })
})
