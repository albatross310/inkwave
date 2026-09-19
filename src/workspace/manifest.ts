import type { InkwaveDocument } from '../types/document'
import { readAppJsonStrict, writeAppJsonStrict } from '../storage/opfs'

export type SubdocId = string
export type StudioContainerId = string

export interface WorkspaceItem {
  subdoc_id: SubdocId
  position: string
  added_at: string
}

export interface StudioWorkspaceManifest {
  v: 1
  container_id: StudioContainerId
  title: string
  items: WorkspaceItem[]
  active_subdoc_id?: SubdocId
  updated_at: string
}

export interface SubdocMembership {
  container_id: StudioContainerId
  subdoc_id: SubdocId
  role: 'embedded' | 'linked'
  added_at: string
}

export interface WorkspaceManifestStore {
  v: 1
  containers: Record<StudioContainerId, StudioWorkspaceManifest>
}

export interface ContainerDescriptor {
  id: StudioContainerId
  title: string
}

/** The provider-neutral local home for every email subdoc. Gmail remains the remote backup. */
export const EMAIL_MANIFEST_CONTAINER: ContainerDescriptor = {
  id: 'inkwave:email-manifest',
  title: 'Email',
}

export type NewSubdocPlacement =
  | { kind: 'current' }
  | { kind: 'standalone' }
  | { kind: 'existing'; containers: ContainerDescriptor[] }

const STORE_PATH = 'workspaces/manifests-v1.json'

export function emptyWorkspaceManifestStore(): WorkspaceManifestStore {
  return { v: 1, containers: {} }
}

function isItem(value: unknown): value is WorkspaceItem {
  const item = value as Partial<WorkspaceItem> | null
  return !!item && typeof item.subdoc_id === 'string' && typeof item.position === 'string'
    && typeof item.added_at === 'string'
}

function isManifest(value: unknown, id: string): value is StudioWorkspaceManifest {
  const manifest = value as Partial<StudioWorkspaceManifest> | null
  return !!manifest && manifest.v === 1 && manifest.container_id === id
    && typeof manifest.title === 'string' && Array.isArray(manifest.items)
    && manifest.items.every(isItem) && typeof manifest.updated_at === 'string'
}

/** A corrupt/unreadable manifest store is UNKNOWN, never an empty workspace. */
export function parseWorkspaceManifestStore(value: unknown): WorkspaceManifestStore {
  const store = value as Partial<WorkspaceManifestStore> | null
  if (!store || store.v !== 1 || !store.containers || typeof store.containers !== 'object') {
    throw new Error('The workspace membership index is not a recognised Inkwave manifest store.')
  }
  for (const [id, manifest] of Object.entries(store.containers)) {
    if (!isManifest(manifest, id)) throw new Error(`The workspace manifest for “${id}” is unreadable.`)
  }
  return store as WorkspaceManifestStore
}

export async function readWorkspaceManifestStore(): Promise<WorkspaceManifestStore> {
  const stored = await readAppJsonStrict<unknown>(STORE_PATH)
  return stored === null ? emptyWorkspaceManifestStore() : parseWorkspaceManifestStore(stored)
}

export async function writeWorkspaceManifestStore(store: WorkspaceManifestStore): Promise<void> {
  await writeAppJsonStrict(STORE_PATH, store)
}

function positionAfter(items: WorkspaceItem[]): string {
  const last = items.reduce((max, item) => Math.max(max, Number(item.position) || 0), 0)
  return String(last + 1024).padStart(12, '0')
}

function singletonManifest(container: ContainerDescriptor, now: string): StudioWorkspaceManifest {
  // Email is a real container but not itself an authored subdoc. Ordinary legacy documents begin
  // as one-subdoc containers; the synthetic Email manifest begins empty and receives emails below.
  const isEmailManifest = container.id === EMAIL_MANIFEST_CONTAINER.id
  return {
    v: 1,
    container_id: container.id,
    title: container.title || 'Untitled',
    items: isEmailManifest ? [] : [{ subdoc_id: container.id, position: '000000001024', added_at: now }],
    active_subdoc_id: isEmailManifest ? undefined : container.id,
    updated_at: now,
  }
}

function ensureContainer(
  store: WorkspaceManifestStore,
  container: ContainerDescriptor,
  now: string,
): StudioWorkspaceManifest {
  return store.containers[container.id] ?? singletonManifest(container, now)
}

export function embeddedMembershipsFor(
  store: WorkspaceManifestStore,
  subdocId: SubdocId,
): SubdocMembership[] {
  const out: SubdocMembership[] = []
  for (const manifest of Object.values(store.containers)) {
    const item = manifest.items.find((candidate) => candidate.subdoc_id === subdocId)
    if (item) out.push({
      container_id: manifest.container_id,
      subdoc_id: subdocId,
      role: 'embedded',
      added_at: item.added_at,
    })
  }
  return out
}

/**
 * Set the exact embedded-container membership of one canonical subdoc. This edits manifests only;
 * the document body/id is neither copied nor mutated. The caller writes the returned store once,
 * so a one-to-many choice is one local atomic file replacement rather than N partial writes.
 */
export function setEmbeddedMemberships(
  store: WorkspaceManifestStore,
  subdoc: Pick<InkwaveDocument, 'id' | 'title'>,
  desired: ContainerDescriptor[],
  now: string,
): WorkspaceManifestStore {
  const wanted = new Map(desired.map((container) => [container.id, container]))
  const containers: Record<string, StudioWorkspaceManifest> = {}

  for (const [id, existing] of Object.entries(store.containers)) {
    const items = existing.items.filter((item) => item.subdoc_id !== subdoc.id)
    const target = wanted.get(id)
    if (target) {
      const prior = existing.items.find((item) => item.subdoc_id === subdoc.id)
      items.push(prior ?? { subdoc_id: subdoc.id, position: positionAfter(items), added_at: now })
      items.sort((a, b) => a.position.localeCompare(b.position))
    }
    containers[id] = {
      ...existing,
      title: target?.title || existing.title,
      items,
      active_subdoc_id: existing.active_subdoc_id && items.some((item) => item.subdoc_id === existing.active_subdoc_id)
        ? existing.active_subdoc_id
        : items[0]?.subdoc_id,
      updated_at: now,
    }
    wanted.delete(id)
  }

  for (const target of wanted.values()) {
    const base = ensureContainer({ v: 1, containers }, target, now)
    const items = base.items.some((item) => item.subdoc_id === subdoc.id)
      ? base.items
      : [...base.items, { subdoc_id: subdoc.id, position: positionAfter(base.items), added_at: now }]
    containers[target.id] = { ...base, items, updated_at: now }
  }

  return { v: 1, containers }
}

export function containersForPlacement(
  placement: NewSubdocPlacement,
  current: ContainerDescriptor,
  subdoc: ContainerDescriptor,
): ContainerDescriptor[] {
  if (placement.kind === 'current') return [current]
  if (placement.kind === 'standalone') return [subdoc]
  return placement.containers
}

export async function placeSubdoc(
  subdoc: Pick<InkwaveDocument, 'id' | 'title'>,
  current: ContainerDescriptor,
  placement: NewSubdocPlacement,
): Promise<SubdocMembership[]> {
  const store = await readWorkspaceManifestStore()
  const now = new Date().toISOString()
  const desired = containersForPlacement(placement, current, { id: subdoc.id, title: subdoc.title })
  if (!desired.length) throw new Error('Choose at least one .studio document for this email.')
  const next = setEmbeddedMemberships(store, subdoc, desired, now)
  await writeWorkspaceManifestStore(next)
  return embeddedMembershipsFor(next, subdoc.id)
}

/**
 * Put a new email in the Email manifest plus the zero-or-more ordinary `.studio` containers the
 * writer explicitly selected. The reserved Email destination cannot be removed or renamed by a
 * duplicate picker row, and repeated selections collapse to one membership.
 */
export async function placeNewEmail(
  subdoc: Pick<InkwaveDocument, 'id' | 'title'>,
  additionalContainers: ContainerDescriptor[],
): Promise<SubdocMembership[]> {
  const desired = containersForNewEmail(additionalContainers)
  const store = await readWorkspaceManifestStore()
  const now = new Date().toISOString()
  const next = setEmbeddedMemberships(store, subdoc, desired, now)
  await writeWorkspaceManifestStore(next)
  return embeddedMembershipsFor(next, subdoc.id)
}

export function containersForNewEmail(
  additionalContainers: ContainerDescriptor[],
): ContainerDescriptor[] {
  const unique = new Map<StudioContainerId, ContainerDescriptor>([
    [EMAIL_MANIFEST_CONTAINER.id, EMAIL_MANIFEST_CONTAINER],
  ])
  for (const container of additionalContainers) {
    if (container.id !== EMAIL_MANIFEST_CONTAINER.id) unique.set(container.id, container)
  }
  return [...unique.values()]
}
