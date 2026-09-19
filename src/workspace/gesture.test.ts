import { describe, expect, it } from 'vitest'
import {
  newWorkspaceGesture,
  pushWorkspaceGesture,
  workspaceSwipeRelease,
  workspaceSwipeVisualX,
} from './gesture'

describe('workspace two-finger gesture', () => {
  it('does not claim ordinary vertical or small diagonal scrolling', () => {
    const state = newWorkspaceGesture()
    expect(pushWorkspaceGesture(state, 4, 30)).toEqual({ claimed: false, direction: null })
    expect(pushWorkspaceGesture(state, 12, 20)).toEqual({ claimed: false, direction: null })
  })

  it('reserves clear horizontal intent before the panel-move threshold', () => {
    const state = newWorkspaceGesture()
    expect(pushWorkspaceGesture(state, 8, 1)).toEqual({ claimed: true, direction: null })
    expect(pushWorkspaceGesture(state, 28, 0)).toEqual({ claimed: true, direction: -1 })
  })

  it('maps fingers right to the left panel and fingers left to the right panel', () => {
    expect(pushWorkspaceGesture(newWorkspaceGesture(), 40, 2).direction).toBe(-1)
    expect(pushWorkspaceGesture(newWorkspaceGesture(), -40, 2).direction).toBe(1)
  })

  it('latches one physical swipe even when momentum keeps sending events', () => {
    const state = newWorkspaceGesture()
    expect(pushWorkspaceGesture(state, -36, 0)).toEqual({ claimed: true, direction: 1 })
    expect(pushWorkspaceGesture(state, -90, 0)).toEqual({ claimed: true, direction: null })
  })

  it('commits a Spaces-style drag by distance or flick velocity only when that neighbour exists', () => {
    expect(workspaceSwipeRelease(-130, -0.1, 1000, true, true).direction).toBe(1)
    expect(workspaceSwipeRelease(18, 0.5, 1000, true, true).direction).toBe(-1)
    expect(workspaceSwipeRelease(20, 0.1, 1000, true, true).direction).toBeNull()
    expect(workspaceSwipeRelease(-130, -1, 1000, true, false).direction).toBeNull()
  })

  it('follows valid movement exactly and resists a missing edge', () => {
    expect(workspaceSwipeVisualX(123, 1000, true)).toBe(123)
    expect(workspaceSwipeVisualX(500, 1000, false)).toBeLessThanOrEqual(48)
  })
})
