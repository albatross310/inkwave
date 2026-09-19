// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { document.body.replaceChildren(); vi.resetModules() })

describe('water continuity across workspace surfaces', () => {
  it('carries the actual threaded scroll pose across the gap between two editor mounts', async () => {
    const motion = await import('./waterMotion')
    const outgoing = document.createElement('div')
    document.body.append(outgoing)
    outgoing.style.setProperty('--wave-x', '12') // inline pose predates native scroll
    let nativeScroll = 0
    const unregister = motion.registerWorkspaceWaterReader(outgoing, () => ({
      pose: 12 + nativeScroll * motion.WATER_SCROLL_GAIN, active: false,
    }))
    nativeScroll = 1820
    motion.carryWorkspaceWaterMotion()
    unregister()
    outgoing.remove()
    expect(motion.peekWorkspaceWaterMotion()).toEqual({ pose: 121.2, active: false })

    const incoming = document.createElement('div')
    document.body.append(incoming)
    const adopted = motion.peekWorkspaceWaterMotion()!
    motion.registerWorkspaceWaterReader(incoming, () => adopted)
    expect(motion.readWorkspaceWaterMotion()).toEqual(adopted)
  })

  it('delivers the current coast while the replacement surface is being prepared', async () => {
    const motion = await import('./waterMotion')
    const received: unknown[] = []
    const onMotion = (event: Event) => received.push((event as CustomEvent).detail)
    window.addEventListener('inkwave:workspace-wave-motion', onMotion)
    try {
      motion.publishWorkspaceWaterMotion(54, true)
      motion.publishWorkspaceWaterMotion(55, true)
      expect(motion.peekWorkspaceWaterMotion()).toEqual({ pose: 55, active: true })
      motion.publishWorkspaceWaterMotion(56, false)
      motion.publishWorkspaceWaterMotion(Number.NaN, false)
      expect(received).toEqual([
        { pose: 54, active: true }, { pose: 55, active: true }, { pose: 56, active: false },
      ])
      expect(motion.readWorkspaceWaterMotion()).toEqual({ pose: 56, active: false })
    } finally { window.removeEventListener('inkwave:workspace-wave-motion', onMotion) }
  })
})
