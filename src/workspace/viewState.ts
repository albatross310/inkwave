import { getMagnify } from '../editor/magnify'
import { writeScrollMemory } from '../editor/scrollMemory'

export interface WorkspaceViewState {
  magnify: number
  scrollLeft: number
}

const viewKey = (id: string) => `inkwave:workspace-view:${id}`

/** View choices are local and per document; they are never part of a .studio or its provenance. */
export function readWorkspaceViewState(id: string): WorkspaceViewState | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(viewKey(id)) || 'null') as WorkspaceViewState | null
    return value && Number.isFinite(value.magnify) && value.magnify > 0
      && Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0 ? value : null
  } catch { return null }
}

export function workspaceTextZoomKey(id: string, email: boolean): string {
  const key = email ? `inkwave:editorZoom:email:${id}` : `inkwave:editorZoom:document:${id}`
  // Preserve the writer's previous manuscript preference on first visit. From then on every
  // panel retains its own size, so an email or another manuscript cannot resize its neighbour.
  if (!email) {
    try {
      if (localStorage.getItem(key) == null) localStorage.setItem(key, localStorage.getItem('inkwave:editorZoom') || '1')
    } catch { /* view persistence is best effort */ }
  }
  return key
}

export function captureWorkspaceViewState(id: string): void {
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill:not(.is-phone)') as HTMLElement | null
  if (!surface || !surface.isConnected || surface.scrollHeight <= 0) return
  writeScrollMemory(id, surface.scrollTop, surface.scrollHeight)
  try {
    sessionStorage.setItem(viewKey(id), JSON.stringify({ magnify: getMagnify(), scrollLeft: surface.scrollLeft }))
  } catch { /* view persistence is best effort */ }
}
