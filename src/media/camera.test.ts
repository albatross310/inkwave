// @vitest-environment jsdom
//
// The webcam photo-capture lifecycle — and above all THE RELEASE GUARD.
//
// A camera left on is the failure that matters here (a privacy alarm and a real leak), so
// `stopStream` is mutation-proved: it must stop EVERY track, not the first. The video-only
// constraint is asserted too, because it is what keeps this path off the microphone — `openCamera`
// asks for `{ video: true, audio: false }`, and if that ever regresses the mic firebreak's
// platform header is the only thing left holding the line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFrame, cameraSupported, frameToFile, openCamera, stopStream } from './camera'

// A stream whose tracks record their own .stop() calls. No real getUserMedia in a unit test.
function mockStream(trackCount: number) {
  const tracks = Array.from({ length: trackCount }, () => ({ stop: vi.fn(), kind: 'video' }))
  const stream = { getTracks: () => tracks } as unknown as MediaStream
  return { stream, tracks }
}

describe('stopStream — THE release guard', () => {
  it('stops EVERY track (a two-track stream leaves nothing live)', () => {
    // The mutation discriminator: a loop that stopped only tracks[0] would leave track 2 live and
    // the camera light on. Both must be stopped.
    const { stream, tracks } = mockStream(2)
    stopStream(stream)
    expect(tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(tracks[1].stop).toHaveBeenCalledTimes(1)
  })

  it('stops the single track of an ordinary one-track stream', () => {
    const { stream, tracks } = mockStream(1)
    stopStream(stream)
    expect(tracks[0].stop).toHaveBeenCalledTimes(1)
  })

  it('is null-safe — cleanup calls it before it knows a stream opened', () => {
    // The popup's unmount cleanup runs `stopStream(streamRef.current)` unconditionally; a throw here
    // would surface as an error on close, which is exactly when the camera must go quietly off.
    expect(() => stopStream(null)).not.toThrow()
    expect(() => stopStream(undefined)).not.toThrow()
  })
})

describe('openCamera — video only, so it cannot open a microphone', () => {
  let restore: PropertyDescriptor | undefined
  beforeEach(() => { restore = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices') })
  afterEach(() => {
    if (restore) Object.defineProperty(navigator, 'mediaDevices', restore)
    else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
  })

  it('requests { video: true, audio: false } — audio is explicitly OFF', () => {
    const getUserMedia = vi.fn().mockResolvedValue(mockStream(1).stream)
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    void openCamera()
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false })
  })
})

describe('cameraSupported — detection for routing and degrading (never gating)', () => {
  let restore: PropertyDescriptor | undefined
  beforeEach(() => { restore = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices') })
  afterEach(() => {
    if (restore) Object.defineProperty(navigator, 'mediaDevices', restore)
    else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
  })

  it('true when navigator.mediaDevices.getUserMedia is a function', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => {} }, configurable: true })
    expect(cameraSupported()).toBe(true)
  })

  it('false when mediaDevices is absent (older/locked-down browsers)', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    expect(cameraSupported()).toBe(false)
  })

  it('false when getUserMedia is not a function', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
    expect(cameraSupported()).toBe(false)
  })
})

describe('captureFrame — a frame becomes a Blob, or refuses (never a bytes-less asset)', () => {
  const realToBlob = HTMLCanvasElement.prototype.toBlob
  const realGetContext = HTMLCanvasElement.prototype.getContext
  beforeEach(() => {
    // jsdom ships no 2D canvas backend, so getContext('2d') returns null. Stub a minimal context so
    // the real draw→encode path runs; the outcome is controlled by the toBlob stub per test.
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof realGetContext
  })
  afterEach(() => {
    HTMLCanvasElement.prototype.toBlob = realToBlob
    HTMLCanvasElement.prototype.getContext = realGetContext
  })

  const video = (w: number, h: number) =>
    ({ videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement)

  it('rejects when the frame is not ready (0×0) rather than encoding nothing', async () => {
    await expect(captureFrame(video(0, 0))).rejects.toThrow(/not ready/i)
  })

  it('resolves a Blob when the canvas encodes', async () => {
    // jsdom does not implement toBlob; stub it so the real draw+encode path runs to a Blob.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
    }
    // jsdom's 2D context drawImage is a no-op but present; that is enough to reach toBlob.
    const blob = await captureFrame(video(640, 480))
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/jpeg')
  })

  it('rejects when the encoder yields null (no silent bytes-less success)', async () => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(null) }
    await expect(captureFrame(video(640, 480))).rejects.toThrow(/capture the photo/i)
  })
})

describe('frameToFile — the frame joins the ONE importer path as a File', () => {
  it('produces an image/jpeg File so kindOf resolves it to a photo', () => {
    const f = frameToFile(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }))
    expect(f).toBeInstanceOf(File)
    expect(f.type).toBe('image/jpeg')
    expect(f.name).toMatch(/^photo-.*\.jpg$/)
  })
})
