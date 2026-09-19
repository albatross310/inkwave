import type { WorkspaceDirection } from './sequence'

export const WORKSPACE_SWIPE_THRESHOLD_PX = 34
export const WORKSPACE_SWIPE_CLAIM_PX = 6
export const WORKSPACE_SWIPE_DOMINANCE = 1.3
export const WORKSPACE_SWIPE_VELOCITY_PX_PER_MS = 0.36

export interface WorkspaceGestureState {
  x: number
  y: number
  claimed: boolean
  fired: boolean
}

export interface WorkspaceGestureAnswer {
  claimed: boolean
  direction: WorkspaceDirection | null
}

export interface WorkspaceSwipeRelease {
  direction: WorkspaceDirection | null
  distanceThreshold: number
}

export function newWorkspaceGesture(): WorkspaceGestureState {
  return { x: 0, y: 0, claimed: false, fired: false }
}

/**
 * Accumulate one physical gesture. Vertical/diagonal movement remains native until horizontal
 * intent wins; once one panel move fires, momentum from that same swipe is consumed but cannot
 * advance a second panel.
 */
export function pushWorkspaceGesture(
  state: WorkspaceGestureState,
  deltaX: number,
  deltaY: number,
): WorkspaceGestureAnswer {
  state.x += Number.isFinite(deltaX) ? deltaX : 0
  state.y += Number.isFinite(deltaY) ? deltaY : 0
  // Reserve a clearly horizontal stream on its first few pixels, before Safari has enough travel
  // to begin native page-history navigation. The larger threshold below still decides whether an
  // Inkwave panel actually moves, so a tiny gesture is consumed but never causes navigation.
  if (!state.claimed) {
    state.claimed = Math.abs(state.x) >= WORKSPACE_SWIPE_CLAIM_PX
      && Math.abs(state.x) > Math.abs(state.y) * WORKSPACE_SWIPE_DOMINANCE
  }
  if (!state.claimed) return { claimed: false, direction: null }
  const horizontal = Math.abs(state.x) >= WORKSPACE_SWIPE_THRESHOLD_PX
    && Math.abs(state.x) > Math.abs(state.y) * WORKSPACE_SWIPE_DOMINANCE
  if (!horizontal) return { claimed: true, direction: null }
  if (state.fired) return { claimed: true, direction: null }
  state.fired = true
  // WebKit/Chromium wheel signs match the existing snapshot scrubber: positive deltaX is a
  // fingers-right gesture and therefore moves to the spatial item on the left.
  return { claimed: true, direction: state.x > 0 ? -1 : 1 }
}

/** Spaces-style release: a deliberate distance or a shorter fast flick commits; otherwise return. */
export function workspaceSwipeRelease(
  x: number,
  velocityX: number,
  viewportWidth: number,
  hasLeft: boolean,
  hasRight: boolean,
): WorkspaceSwipeRelease {
  const width = Number.isFinite(viewportWidth) ? Math.max(320, viewportWidth) : 320
  const distanceThreshold = Math.min(140, Math.max(56, width * 0.12))
  const direction: WorkspaceDirection = x > 0 ? -1 : 1
  const targetExists = direction < 0 ? hasLeft : hasRight
  const distanceCommit = Math.abs(x) >= distanceThreshold
  const velocityCommit = Math.abs(velocityX) >= WORKSPACE_SWIPE_VELOCITY_PX_PER_MS
    && Math.abs(x) >= WORKSPACE_SWIPE_CLAIM_PX * 2
  return {
    direction: targetExists && (distanceCommit || velocityCommit) ? direction : null,
    distanceThreshold,
  }
}

/** Resist an edge with no neighbour; valid cards follow the fingers one-for-one. */
export function workspaceSwipeVisualX(
  x: number,
  viewportWidth: number,
  hasTarget: boolean,
): number {
  if (!Number.isFinite(x)) return 0
  const width = Number.isFinite(viewportWidth) ? Math.max(320, viewportWidth) : 320
  if (hasTarget) return Math.max(-width, Math.min(width, x))
  const resisted = Math.min(48, Math.pow(Math.abs(x), 0.72) * 1.55)
  return Math.sign(x) * resisted
}

/** Critically damped release trajectory with the finger's actual velocity as its initial
 * derivative. Sampled into compositor keyframes by WorkspaceNavigation, so live paper and primed
 * neighbour share one curve without a slow-start ease followed by an endpoint snap. */
export function workspaceSwipeSettleX(
  from: number,
  target: number,
  velocityPxPerMs: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (![from, target, velocityPxPerMs, elapsedMs, durationMs].every(Number.isFinite) || durationMs <= 0) return target
  if (elapsedMs <= 0) return from
  if (elapsedMs >= durationMs) return target
  const distance = target - from
  if (distance === 0) return target
  const omega = 9 / durationMs
  const toward = velocityPxPerMs * Math.sign(distance) > 0 ? velocityPxPerMs : 0
  const velocity = Math.sign(distance) * Math.min(Math.abs(toward), Math.abs(distance) * omega * 0.9)
  const a = from - target
  const b = velocity + omega * a
  return target + (a + b * elapsedMs) * Math.exp(-omega * elapsedMs)
}
