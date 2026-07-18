// Camera capture for the media-import PHOTO button — Peter's laptop webcam.
//
// ─── THE ONLY MODULE IN INKWAVE THAT NAMES getUserMedia, AND IT OPENS A CAMERA ────────────────
//
// The constraints are `{ video: true, audio: false }` — a photo button has no use for a microphone.
// getUserMedia is CAMERA-OR-MICROPHONE and a source scan cannot read the constraints, so this file
// is the single declared `CAMERA_CAPABLE` entry in the mic firebreak (`music/lesson/micBoundary.ts`).
// The microphone guarantee does NOT weaken: `Permissions-Policy: microphone=()` in vercel.json is
// UNTOUCHED, so even a mistaken `audio:true` here would be denied by the browser at the platform.
// The camera is granted `camera=(self)` (this origin only) — the change this feature required.
//
// ─── RELEASE THE CAMERA THE INSTANT WE ARE DONE ──────────────────────────────────────────────
//
// A left-on camera light is a privacy alarm and a real leak. `stopStream` stops EVERY track, and the
// popup calls it on capture AND on close/unmount. It is the guard most worth a test — mutation-proved
// in `camera.test.ts`. Null-safe by design so cleanup can call it unconditionally, before it even
// knows whether a stream opened.

/**
 * Can this browser open a camera at all? Used to ROUTE the Photo button (desktop → webcam popup)
 * and to DEGRADE — never to gate. When this is false, or a real call rejects, the caller falls back
 * to the file picker; the feature is never a dead end.
 */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
}

/**
 * Open the camera as a VIDEO-ONLY stream. Audio is explicitly off — see the header. Rejects on
 * permission denied / no device / an insecure context; the caller degrades to the file picker.
 */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
}

/**
 * THE RELEASE GUARD. Stop every track so the camera light goes out immediately. Iterates EVERY
 * track (a video stream can carry more than one) — stopping only the first would leave the device
 * live. Null-safe so the popup's cleanup can call it whether or not a stream ever opened.
 */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Grab the current video frame as an image Blob (JPEG). Draws the live `<video>` to an offscreen
 * canvas at the camera's NATIVE resolution. Rejects if the frame is not ready or encoding fails —
 * a null blob must never become an asset with no bytes (the media lane's "no reference without
 * bytes" rule).
 */
export function captureFrame(
  video: HTMLVideoElement,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return Promise.reject(new Error('The camera is not ready yet — try again.'))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not read the camera frame on this device.'))
  ctx.drawImage(video, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the photo.'))),
      type,
      quality,
    )
  })
}

/**
 * A captured frame becomes a `File` so it flows through the SAME `importMedia` path a file import
 * uses — one importer, one OPFS write, one size rule (mediaStore.ts). The captured photo never
 * forks a second media store.
 */
export function frameToFile(blob: Blob, now = new Date()): File {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const type = blob.type || 'image/jpeg'
  return new File([blob], `photo-${stamp}.jpg`, { type })
}
