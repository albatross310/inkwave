// @vitest-environment jsdom
//
// The webcam photo-capture popup's CONTRACT — and the two things that matter most:
//   1. THE CAMERA IS RELEASED on capture AND on close/unmount (stop() on every track). Both are
//      asserted, and both are the mutation target: remove either stopStream and a named test dies.
//   2. DEGRADE, DON'T GATE — when getUserMedia rejects, the panel offers the file picker with a
//      note and never dead-ends.
//
// The real `camera.ts` runs throughout (openCamera/stopStream/captureFrame are the code under test);
// only `getUserMedia` is stubbed at the navigator boundary and `importMedia` is mocked so no OPFS is
// needed. jsdom does not implement <video> playback or canvas.toBlob, so those are stubbed to let
// the real lifecycle reach the guard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// mediaStore is mocked with a PLAIN recorder built inside the factory (vi.mock is hoisted above
// vitest's own import in a .tsx file — nothing hoisted, nothing imported here).
vi.mock('../media/mediaStore', () => {
  const rec: {
    calls: { name: string }[]
    result: { ok: true; asset: unknown } | { ok: false; reason: string } | null
    reset(): void
  } = {
    calls: [],
    result: null,
    reset() { rec.calls = []; rec.result = null },
  }
  return {
    __rec: rec,
    importMedia: async (file: File) => {
      rec.calls.push({ name: file.name })
      return (
        rec.result ?? {
          ok: true,
          asset: { id: 'a1', kind: 'photo', mime: 'image/jpeg', name: file.name, size: 3, addedAt: 'now' },
        }
      )
    },
  }
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as mediaStore from '../media/mediaStore'
import { CameraCapturePopup } from './CameraCapturePopup'

const rec = (mediaStore as unknown as { __rec: { calls: { name: string }[]; result: unknown; reset(): void } }).__rec

const ANCHOR = { left: 100, bottom: 60 }

// A stream whose tracks record their own stop() — this is how we see the camera go off.
function trackedStream() {
  const tracks = [{ stop: vi.fn(), kind: 'video' }, { stop: vi.fn(), kind: 'video' }]
  const stream = { getTracks: () => tracks } as unknown as MediaStream
  return { stream, tracks }
}

let current: ReturnType<typeof trackedStream>
let getUserMedia: ReturnType<typeof vi.fn>

// Restore-me handles for the jsdom gaps we fill.
const vwDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')
const vhDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')
const realToBlob = HTMLCanvasElement.prototype.toBlob
const realGetContext = HTMLCanvasElement.prototype.getContext
const realPlay = HTMLMediaElement.prototype.play
const mdDesc = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

beforeEach(() => {
  rec.reset()
  current = trackedStream()
  getUserMedia = vi.fn(() => Promise.resolve(current.stream))
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  // <video> geometry + playback + canvas encoding — all absent in jsdom.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as unknown as typeof realPlay
  // jsdom has no 2D canvas backend — stub context + encoder so captureFrame reaches a real Blob.
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof realGetContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
  }
})

afterEach(() => {
  cleanup() // MANDATORY — this repo does not set globals:true, so nothing auto-unmounts.
  if (vwDesc) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', vwDesc)
  if (vhDesc) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', vhDesc)
  HTMLCanvasElement.prototype.toBlob = realToBlob
  HTMLCanvasElement.prototype.getContext = realGetContext
  HTMLMediaElement.prototype.play = realPlay
  if (mdDesc) Object.defineProperty(navigator, 'mediaDevices', mdDesc)
  else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
})

describe('CameraCapturePopup — the camera is released', () => {
  it('RELEASES THE CAMERA ON CAPTURE (stop() on every track) and imports the frame', async () => {
    const onImported = vi.fn()
    const onClose = vi.fn()
    render(<CameraCapturePopup anchor={ANCHOR} onImported={onImported} onClose={onClose} onUseFile={vi.fn()} />)

    // Wait for the live phase — the Take-photo button becomes enabled.
    const take = await screen.findByRole('button', { name: /take photo/i })
    await waitFor(() => expect((take as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(take)

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    // The frame went through the ONE importer.
    expect(rec.calls.length).toBe(1)
    // The component is STILL MOUNTED (onClose is a spy that does not unmount), so the only thing that
    // could have stopped these tracks is onCapture's stop-on-capture. This is the mutation target.
    expect(current.tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(current.tracks[1].stop).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('RELEASES THE CAMERA ON CLOSE/UNMOUNT even without capturing', async () => {
    const { unmount } = render(
      <CameraCapturePopup anchor={ANCHOR} onImported={vi.fn()} onClose={vi.fn()} onUseFile={vi.fn()} />,
    )
    // Let the stream attach first, or there is nothing to release.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    await waitFor(() => expect(current.tracks[0].stop).not.toHaveBeenCalled())

    unmount() // ← the close path. Break the cleanup's stopStream and this dies.

    expect(current.tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(current.tracks[1].stop).toHaveBeenCalledTimes(1)
  })

  it('a stored-import failure keeps the panel open and shows the reason (no lost bytes, no dead end)', async () => {
    rec.result = { ok: false, reason: 'Storage unavailable on this device.' }
    const onImported = vi.fn()
    const onClose = vi.fn()
    render(<CameraCapturePopup anchor={ANCHOR} onImported={onImported} onClose={onClose} onUseFile={vi.fn()} />)

    const take = await screen.findByRole('button', { name: /take photo/i })
    await waitFor(() => expect((take as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(take)

    await waitFor(() => expect(screen.getByText(/storage unavailable/i)).toBeTruthy())
    expect(onImported).not.toHaveBeenCalled()
    // Even a failed import releases the camera — the frame is already grabbed.
    expect(current.tracks[0].stop).toHaveBeenCalledTimes(1)
  })
})

describe('CameraCapturePopup — degrade, do not gate', () => {
  it('when getUserMedia rejects, it offers the file picker with a note (never a dead end)', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const onUseFile = vi.fn()
    render(<CameraCapturePopup anchor={ANCHOR} onImported={vi.fn()} onClose={vi.fn()} onUseFile={onUseFile} />)

    // The note explains, and the way forward is present.
    await waitFor(() => expect(screen.getByText(/blocked/i)).toBeTruthy())
    // Take-photo is gone (no camera), but "Choose a file" is the primary action now.
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull()
    const choose = screen.getByRole('button', { name: /choose a file/i })
    fireEvent.click(choose)
    expect(onUseFile).toHaveBeenCalledTimes(1)
  })

  it('a camera that never opened releases nothing but still degrades cleanly on unmount', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no device'), { name: 'NotFoundError' }))
    const { unmount } = render(
      <CameraCapturePopup anchor={ANCHOR} onImported={vi.fn()} onClose={vi.fn()} onUseFile={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText(/no camera was found/i)).toBeTruthy())
    // No stream ⇒ nothing to stop, and unmount must not throw.
    expect(() => unmount()).not.toThrow()
    expect(current.tracks[0].stop).not.toHaveBeenCalled()
  })
})
