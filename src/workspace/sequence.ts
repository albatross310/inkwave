/**
 * One tab's local spatial document sequence.
 *
 * This is presentation state, not document content and not a second document store. The ids still
 * point at ordinary OPFS Inkwave documents. sessionStorage is deliberate: it survives a reload and
 * an OAuth round trip, while two independent windows do not silently reorder one another.
 */

export interface WorkspaceSequence {
  version: 1
  order: string[]
  activeId: string
}

export type WorkspaceDirection = -1 | 1

const KEY = 'inkwave:workspaceSequence:v1'

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function normaliseWorkspaceSequence(value: unknown, fallbackActiveId: string): WorkspaceSequence {
  const candidate = value && typeof value === 'object' ? value as Partial<WorkspaceSequence> : {}
  const order = uniqueIds(candidate.order)
  const activeId = typeof candidate.activeId === 'string' && candidate.activeId
    ? candidate.activeId
    : fallbackActiveId

  if (!order.includes(activeId)) order.unshift(activeId)
  if (!order.includes(fallbackActiveId)) order.unshift(fallbackActiveId)

  return { version: 1, order, activeId: fallbackActiveId }
}

export function readWorkspaceSequence(activeId: string): WorkspaceSequence {
  try {
    const raw = sessionStorage.getItem(KEY)
    return normaliseWorkspaceSequence(raw ? JSON.parse(raw) : null, activeId)
  } catch {
    return normaliseWorkspaceSequence(null, activeId)
  }
}

export function writeWorkspaceSequence(sequence: WorkspaceSequence): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(sequence)) } catch { /* private mode */ }
}

/**
 * A newly opened panel is placed immediately LEFT of the surface that opened it. This keeps the
 * source page visible/available on the right, matching Inkwave's spatial "open into" model.
 */
export function openLeftOfActive(sequence: WorkspaceSequence, id: string): WorkspaceSequence {
  const without = sequence.order.filter((candidate) => candidate !== id)
  const activeIndex = Math.max(0, without.indexOf(sequence.activeId))
  without.splice(activeIndex, 0, id)
  return { version: 1, order: without, activeId: id }
}

export function activateWorkspaceItem(sequence: WorkspaceSequence, id: string): WorkspaceSequence {
  if (!sequence.order.includes(id)) return openLeftOfActive(sequence, id)
  return { ...sequence, activeId: id }
}

export function workspaceNeighbourId(
  sequence: WorkspaceSequence,
  direction: WorkspaceDirection,
): string | null {
  const index = sequence.order.indexOf(sequence.activeId)
  if (index < 0) return null
  return sequence.order[index + direction] ?? null
}

