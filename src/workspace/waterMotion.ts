// One water position across editor remounts. Page scroll is local to each document; the water is
// local to the window. Reading the live surface matters on Safari, whose CSS scroll timeline adds
// motion without changing the inline --wave-x value.
export interface WorkspaceWaterMotion { pose: number; active: boolean }
export const WATER_SCROLL_GAIN = 0.06

let carried: WorkspaceWaterMotion | null = null
const readers = new Map<HTMLElement, () => WorkspaceWaterMotion>()

export function registerWorkspaceWaterReader(
  surface: HTMLElement,
  read: () => WorkspaceWaterMotion,
): () => void {
  readers.set(surface, read)
  return () => { readers.delete(surface) }
}

export function peekWorkspaceWaterMotion(): WorkspaceWaterMotion | null {
  return carried
}

export function readSurfaceWaterMotion(surface: HTMLElement): WorkspaceWaterMotion | null {
  return readers.get(surface)?.() ?? null
}

export function readWorkspaceWaterMotion(): WorkspaceWaterMotion | null {
  for (const [surface, read] of [...readers].reverse()) {
    if (!surface.isConnected) continue
    return read()
  }
  return carried
}

function remember(motion: WorkspaceWaterMotion): void {
  carried = motion
  // Diagnostic mirror used by browser proofs. Application state lives in this module.
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __iwWorkspaceWavePose?: number }).__iwWorkspaceWavePose = motion.pose
  }
}

/** Capture the departing water before React replaces its scroll surface. */
export function carryWorkspaceWaterMotion(): void {
  const motion = readWorkspaceWaterMotion()
  if (motion) remember(motion)
}

export function publishWorkspaceWaterMotion(pose: number, active: boolean): void {
  if (!Number.isFinite(pose)) return
  remember({ pose, active })
  window.dispatchEvent(new CustomEvent('inkwave:workspace-wave-motion', { detail: { pose, active } }))
}
