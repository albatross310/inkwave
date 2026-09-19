import type { WorkspaceDirection } from './sequence'

type ViewTransitionLike = {
  finished: Promise<void>
  ready?: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike
}

export type WorkspaceTransitionResult = 'animated' | 'instant'

/**
 * Animate one already-authorised in-place panel swap without keeping two editors alive. The View
 * Transitions API owns bounded visual snapshots while `update` performs the ordinary save/lock/
 * editor remount. No opacity animation is permitted; CSS provides the directional slide.
 */
export async function runWorkspacePanelTransition(
  direction: WorkspaceDirection,
  update: () => void | Promise<void>,
): Promise<WorkspaceTransitionResult> {
  const doc = document as ViewTransitionDocument
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill') as HTMLElement | null
  const outgoing = surface?.querySelector(':scope > .iw-magnify-box') as HTMLElement | null
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (!doc.startViewTransition || !surface || !outgoing || reduceMotion) {
    await update()
    return 'instant'
  }

  const root = document.documentElement
  const value = direction < 0 ? 'left' : 'right'
  root.dataset.iwWorkspaceSlide = value
  // The rule is already loaded, but force its named snapshot onto the old surface before WebKit
  // captures. This avoids a first-use transition silently becoming the API's default cross-fade.
  outgoing.style.viewTransitionName = 'iw-workspace-outgoing'
  void getComputedStyle(outgoing).viewTransitionName
  window.dispatchEvent(new CustomEvent('inkwave:workspace-transition-start', { detail: { direction: value } }))

  let transition: ViewTransitionLike
  let incoming: HTMLElement | null = null
  try {
    transition = doc.startViewTransition(async () => {
      await update()
      outgoing.style.removeProperty('view-transition-name')
      incoming = document.querySelector('.inkwave-editor-surface.iw-fill > .iw-magnify-box') as HTMLElement | null
      if (incoming) incoming.style.viewTransitionName = 'iw-workspace-incoming'
    })
  } catch {
    outgoing.style.removeProperty('view-transition-name')
    delete root.dataset.iwWorkspaceSlide
    await update()
    return 'instant'
  }

  void transition.ready?.then(() => {
    window.dispatchEvent(new CustomEvent('inkwave:workspace-transition-ready', { detail: { direction: value } }))
  }).catch(() => {})
  try {
    await transition.finished
    return 'animated'
  } finally {
    outgoing.style.removeProperty('view-transition-name')
    ;(incoming as HTMLElement | null)?.style.removeProperty('view-transition-name')
    delete root.dataset.iwWorkspaceSlide
    window.dispatchEvent(new CustomEvent('inkwave:workspace-transition-end', { detail: { direction: value } }))
  }
}
