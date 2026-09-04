// The webcam photo-capture popup — Peter's "the photo button… should work with my laptop's webcam".
//
// Peter's rule: popups/panels, NEVER a route/page. So this is a PORTALED drop-up anchored to the
// media button, exactly like MediaMenu. It shows a live preview, a Capture button grabs a frame, and
// the frame imports through the SAME `importMedia` path a file import uses — no second media store.
//
// TWO THINGS THIS FILE IS RESPONSIBLE FOR ABOVE ALL:
//   1. RELEASE THE CAMERA the instant we're done — `stopStream` on capture AND on close/unmount.
//      The cleanup effect is unconditional; a left-on camera light is the failure that matters.
//   2. DEGRADE, DON'T GATE — if `getUserMedia` is absent/denied/throws, offer the file picker with a
//      short note. Never a dead end.
//
// Theming (CLAUDE.md, mandatory for every floating panel): `iw-nightable` + `iw-touch-guard` on the
// portaled container; custom colours via tokens with day fallbacks; every control ≥16px and ≥44px
// touch target (the shared `music/typeScale.ts` ramp). Filled controls use `--iw-on-ink`, never a
// literal white — `--iw-ink` is LIGHT purple in night, where white text vanishes.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import { captureFrame, frameToFile, openCamera, stopStream } from '../media/camera'
import { importMedia } from '../media/mediaStore'
import type { MediaAsset } from '../media/types'
import { TOUCH_MIN, TYPE } from '../music/typeScale'

const INK = 'var(--iw-ink, #302438)'
const ON_INK = 'var(--iw-on-ink, #ffffff)'

type Phase =
  | { k: 'starting' }
  | { k: 'live' }
  | { k: 'capturing' }
  // 'unavailable' = the camera could not open (absent/denied/error). This is the DEGRADE path: the
  // panel offers the file picker rather than dead-ending. `note` is the writer-facing reason.
  | { k: 'unavailable'; note: string }
  | { k: 'error'; note: string }

export function CameraCapturePopup({
  anchor,
  onImported,
  onClose,
  onUseFile,
}: {
  anchor: { left: number; bottom: number }
  onImported: (asset: MediaAsset) => void
  onClose: () => void
  /** Degrade to the existing file picker (MediaMenu owns the <input>). Never a dead end. */
  onUseFile: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'starting' })
  const videoRef = useRef<HTMLVideoElement>(null)
  // The live stream, held in a ref so the unmount cleanup always sees the latest one — a stale
  // closure here is a camera left on.
  const streamRef = useRef<MediaStream | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // ─── Open the camera on mount; RELEASE it on unmount (stop-on-close). ──────────────────────────
  useEffect(() => {
    let cancelled = false
    openCamera()
      .then((stream) => {
        if (cancelled) {
          // Unmounted while getUserMedia was still resolving — release immediately, never attach.
          stopStream(stream)
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          void v.play().catch(() => {/* autoplay is best-effort; the frame grab does not need it */})
        }
        setPhase({ k: 'live' })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setPhase({ k: 'unavailable', note: reasonFor(e) })
      })
    return () => {
      cancelled = true
      stopStream(streamRef.current) // ← stop-on-close / stop-on-unmount. Do not remove.
      streamRef.current = null
    }
    // Mount-only: opening the camera is a one-shot per popup instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Outside-tap closes the popup (which releases the camera via the cleanup above).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose])

  async function onCapture() {
    const v = videoRef.current
    if (!v) return
    setPhase({ k: 'capturing' })
    try {
      const blob = await captureFrame(v)
      const res = await importMedia(frameToFile(blob), uuidv4())
      // Release the camera the moment we have the bytes — stop-on-capture. Independent of whether
      // the import then succeeds: the frame is already grabbed, so there is no reason to keep the
      // device live while OPFS writes.
      stopStream(streamRef.current)
      streamRef.current = null
      if (!res.ok) { setPhase({ k: 'error', note: res.reason }); return }
      onImported(res.asset)
      onClose()
    } catch (e) {
      stopStream(streamRef.current)
      streamRef.current = null
      setPhase({ k: 'error', note: reasonFor(e) })
    }
  }

  const showVideo = phase.k === 'starting' || phase.k === 'live' || phase.k === 'capturing'
  const degraded = phase.k === 'unavailable' || phase.k === 'error'

  const panel = (
    <div
      ref={panelRef}
      className="iw-nightable iw-touch-guard fixed z-[130] bg-white rounded-2xl shadow-xl font-serif flex flex-col"
      style={{
        left: anchor.left,
        bottom: anchor.bottom,
        transform: 'translateX(-50%)',
        border: `1px solid var(--iw-nightable-border, ${INK}bf)`,
        fontSize: TYPE.label,
        width: 320,
        maxWidth: 'calc(100vw - 24px)',
        padding: 10,
        gap: 8,
      }}
      role="dialog"
      aria-label="Take a photo with your camera"
    >
      {showVideo && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: '#000', aspectRatio: '4 / 3', width: '100%' }}
        >
          {/* muted + playsInline: an autoplaying preview must not demand a gesture or make sound. */}
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: 'scaleX(-1)' }}
          />
        </div>
      )}

      {degraded && (
        <div
          style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)', padding: '4px 2px', lineHeight: 1.35 }}
        >
          {phase.note}
        </div>
      )}

      <div className="flex items-center" style={{ gap: 8 }}>
        {phase.k !== 'unavailable' && phase.k !== 'error' && (
          <button
            type="button"
            onClick={onCapture}
            disabled={phase.k !== 'live'}
            className="flex-1 flex items-center justify-center rounded-xl disabled:opacity-50 font-serif"
            style={{
              minHeight: TOUCH_MIN,
              fontSize: TYPE.label,
              background: INK,
              color: ON_INK,
            }}
          >
            {phase.k === 'capturing' ? 'Capturing…' : phase.k === 'starting' ? 'Starting camera…' : 'Take photo'}
          </button>
        )}

        <button
          type="button"
          onClick={onUseFile}
          className="flex items-center justify-center rounded-xl hover:bg-stone-50 font-serif"
          style={{
            minHeight: TOUCH_MIN,
            minWidth: TOUCH_MIN,
            padding: '0 14px',
            fontSize: TYPE.label,
            color: INK,
            border: `1px solid var(--iw-nightable-border, ${INK}55)`,
            // When degraded this is the PRIMARY action — a real way forward, never a dead end.
            flex: degraded ? 1 : '0 0 auto',
          }}
        >
          Choose a file
        </button>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

/** A short, writer-facing reason. The failure is the writer's to see, not the console's. */
function reasonFor(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name?: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. You can choose a photo file instead.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Choose a photo file instead.'
  }
  return 'The camera is unavailable on this device — choose a photo file instead.'
}
