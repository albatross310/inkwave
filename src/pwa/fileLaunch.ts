// Installed-PWA .studio launches have two independent clocks:
//   1. the OS/browser delivers LaunchParams;
//   2. React mounts Edit's in-place `inkwave:open-doc` listener.
//
// LaunchQueue may win on a cold start. Calling openInkwaveFile before (2) still parses and writes
// the file, but its final open-doc event disappears into an empty window — the exact kind of
// one-click path that appears to do nothing. This module makes both facts askable and queues the
// launch until the editor listener explicitly announces readiness.

export const STUDIO_FILE_ACTION_PARAM = 'file-launch'
export const STUDIO_FILE_LAUNCH_START = 'inkwave:studio-file-launch-start'
export const OPEN_DOC_LISTENER_READY = 'inkwave:open-doc-listener-ready'

type LaunchParamsLike = { files?: FileSystemFileHandle[] }
type LaunchQueueLike = { setConsumer: (consumer: (params: LaunchParamsLike) => void) => void }
type LaunchWindow = Window & {
  launchQueue?: LaunchQueueLike
  __iwOpenDocListenerReady?: boolean
  __iwStudioFileLaunchPending?: boolean
}

const host = () => window as LaunchWindow

export function setOpenDocListenerReady(ready: boolean): void {
  host().__iwOpenDocListenerReady = ready
  if (ready) window.dispatchEvent(new Event(OPEN_DOC_LISTENER_READY))
}

export function waitForOpenDocListener(): Promise<void> {
  if (host().__iwOpenDocListenerReady) return Promise.resolve()
  return new Promise((resolve) => window.addEventListener(OPEN_DOC_LISTENER_READY, () => resolve(), { once: true }))
}

/** Used by Edit's init path to avoid opening the recent document underneath an OS-delivered file. */
export async function waitForStudioFileLaunch(timeoutMs = 2500): Promise<boolean> {
  if (host().__iwStudioFileLaunchPending) return true
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener(STUDIO_FILE_LAUNCH_START, onStart)
      resolve(value)
    }
    const onStart = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    window.addEventListener(STUDIO_FILE_LAUNCH_START, onStart, { once: true })
  })
}

export function installStudioFileLaunch(
  open: (handle: FileSystemFileHandle) => Promise<void>,
  onError: (error: unknown) => void,
): boolean {
  const queue = host().launchQueue
  if (!queue || typeof queue.setConsumer !== 'function') return false
  let chain = Promise.resolve()
  queue.setConsumer((params) => {
    const handle = params.files?.[0]
    if (!handle) return
    host().__iwStudioFileLaunchPending = true
    window.dispatchEvent(new Event(STUDIO_FILE_LAUNCH_START))
    chain = chain.then(async () => {
      try {
        await waitForOpenDocListener()
        await open(handle)
      } catch (error) {
        onError(error)
      } finally {
        host().__iwStudioFileLaunchPending = false
      }
    })
  })
  return true
}
