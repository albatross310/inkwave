import { useEffect, useRef, useState } from 'react'
import { Scroll, EmptyEditorSurface, isTouchDevice } from './Scroll'

// ─── LoadingVeil — the wave loading choreography for secondary routes (Peter, 2026-07-09) ────
// A route-level, full-screen wave shell (Edit.tsx's persistent loading shell, distilled): it
// mounts covering everything — waves drifting on the shared --wave-phase clock — and when
// `ready` flips true it runs the SAME reveal sequence as the editor: the coast starts FIRST on a
// light frame ('inkwave:reveal-imminent', which every drifting surface obeys; see Scroll.tsx and
// the backward-flicker fix in TiptapEditor's gate), then the veil fades out over 0.5s so the
// content beneath appears over the decaying waves. Phone delays the fade into the coast's tail
// (1.5s + 0.5s = the 2s phone coast), matching the editor's phone choreography. ONE-SHOT: once
// revealed it never re-covers, so in-view navigation (snapshot scrubbing) is unaffected. The
// wrapper carries an explicit z-index so the veil covers the route's own fixed chrome (headers,
// hints); it blocks input while covering and lets it through the moment the fade starts.
export function LoadingVeil({ ready, zIndex = 300 }: { ready: boolean; zIndex?: number }) {
  const [phase, setPhase] = useState<'up' | 'fading' | 'down'>('up')
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    window.dispatchEvent(new Event('inkwave:reveal-imminent')) // coast starts NOW, on a light frame
    const t = setTimeout(() => setPhase('fading'), isTouchDevice() ? 1500 : 34)
    return () => clearTimeout(t)
  }, [ready])
  useEffect(() => {
    if (phase !== 'fading') return
    const t = setTimeout(() => setPhase('down'), 520)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'down') return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: phase === 'fading' ? 'none' : 'auto' }}
      aria-hidden="true"
    >
      <Scroll phone={isTouchDevice()} fill revealed={false} fadingOut={phase === 'fading'}>
        <EmptyEditorSurface />
      </Scroll>
    </div>
  )
}
