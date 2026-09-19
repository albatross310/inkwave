/**
 * Browser-history projection for the local panel sequence.
 *
 * Document identity remains in sessionStorage; this marker only lets the browser's Back/Forward
 * controls revisit panel selections in this tab. URLs remain bookmarkable via the existing `doc`
 * query parameter, and unrelated router/user state is preserved.
 */

const STATE_KEY = '__inkwaveWorkspacePanel'

interface WorkspacePanelHistoryState {
  version: 1
  id: string
}

function stateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stateFor(current: unknown, id: string): Record<string, unknown> {
  return { ...stateRecord(current), [STATE_KEY]: { version: 1, id } }
}

function urlFor(id: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('doc', id)
  return url.toString()
}

export function workspacePanelIdFromHistory(state: unknown): string | null {
  const marker = stateRecord(state)[STATE_KEY]
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null
  const candidate = marker as Partial<WorkspacePanelHistoryState>
  return candidate.version === 1 && typeof candidate.id === 'string' && candidate.id
    ? candidate.id
    : null
}

/** Describe the current browser entry as the currently visible panel without adding an entry. */
export function replaceWorkspacePanelHistory(id: string): void {
  try {
    window.history.replaceState(stateFor(window.history.state, id), '', urlFor(id))
  } catch { /* History is optional presentation state; document identity remains in sessionStorage. */ }
}

/** Add one successful, in-place panel selection to browser Back/Forward history. */
export function pushWorkspacePanelHistory(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return
  try {
    // Correct the outgoing entry first. `claimTabDoc` subsequently sees the already-correct target
    // URL and therefore cannot replace the entry we just preserved.
    window.history.replaceState(stateFor(window.history.state, fromId), '', urlFor(fromId))
    window.history.pushState(stateFor(window.history.state, toId), '', urlFor(toId))
  } catch { /* The panel switch itself must remain usable when History API storage is unavailable. */ }
}

