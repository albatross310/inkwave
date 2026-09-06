// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installStudioFileLaunch,
  setOpenDocListenerReady,
  waitForStudioFileLaunch,
  STUDIO_FILE_ACTION_PARAM,
} from './fileLaunch'

type TestWindow = Window & {
  launchQueue?: { setConsumer: (consumer: (params: { files?: FileSystemFileHandle[] }) => void) => void }
  __iwOpenDocListenerReady?: boolean
  __iwStudioFileLaunchPending?: boolean
}

const w = () => window as TestWindow

afterEach(() => {
  delete w().launchQueue
  delete w().__iwOpenDocListenerReady
  delete w().__iwStudioFileLaunchPending
  vi.useRealTimers()
})

describe('installed PWA .studio launch', () => {
  it('queues a cold OS launch until Edit has mounted its open-doc listener', async () => {
    let consume: ((params: { files?: FileSystemFileHandle[] }) => void) | undefined
    w().launchQueue = { setConsumer: (consumer) => { consume = consumer } }
    const open = vi.fn(async () => {})
    const onError = vi.fn()
    const handle = { getFile: vi.fn() } as unknown as FileSystemFileHandle

    expect(installStudioFileLaunch(open, onError)).toBe(true)
    consume?.({ files: [handle] })
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
    expect(await waitForStudioFileLaunch(0)).toBe(true)

    setOpenDocListenerReady(true)
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(handle))
    expect(onError).not.toHaveBeenCalled()
  })

  it('opens immediately when the listener was already ready', async () => {
    let consume: ((params: { files?: FileSystemFileHandle[] }) => void) | undefined
    w().launchQueue = { setConsumer: (consumer) => { consume = consumer } }
    const open = vi.fn(async () => {})
    const handle = {} as FileSystemFileHandle
    setOpenDocListenerReady(true)
    installStudioFileLaunch(open, vi.fn())
    consume?.({ files: [handle] })
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(handle))
  })

  it('does nothing in browsers without LaunchQueue', () => {
    expect(installStudioFileLaunch(vi.fn(), vi.fn())).toBe(false)
  })

  it('uses a stable one-shot action parameter', () => {
    expect(STUDIO_FILE_ACTION_PARAM).toBe('file-launch')
  })
})
