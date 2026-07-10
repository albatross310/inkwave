import { useEffect, useRef, useState } from 'react'
import { Scroll, EmptyEditorSurface, isTouchDevice } from './Scroll'

// ─── LoadingVeil — the wave loading choreography for secondary routes (Peter, 2026-07-09) ────
// A route-level, full-screen wave shell (Edit.tsx's persistent loading shell, distilled): it
// mounts covering everything — waves drifting on the shared --wave-phase clock — and when
// `ready` flips true it runs the SAME reveal sequence as the editor: the coast starts FIRST on a
// light frame ('inkwave:reveal-imminent', which every drifting surface obeys; see Scroll.tsx and
// the backward-flicker fix in TiptapEditor's gate), then the veil fades out so the content
// beneath appears over the waves. ONE-SHOT: once revealed it never re-covers, so in-view
// navigation (snapshot scrubbing) is unaffected. The wrapper carries an explicit z-index so the
// veil covers the route's own fixed chrome (headers, hints); it blocks input while covering and
// lets it through the moment the fade starts.
//
// PLATFORM ORDERING (2026-07-11, the phone "white background early" fix — same invariant as the
// editor's loading shell): the veil is the ONLY water on its route, so on PHONE it must stay
// fully OPAQUE until 'inkwave:wave-rest' (its own Scroll dispatches it at coast end) — the old
// fixed 1.5s timer started the fade MID-COAST, exposing the parchment content under moving
// water, and then unmounted at 520ms into Scroll's 0.8s fade (an opacity pop). Now: opaque
// through the whole coast → at rest, fade over STILL water (the .iw-loading-veil CSS keeps the
// phone surface pinned + water-painted through waveMode 'off' — a bare phone surface reverts to
// parchment there). A 4s cap keeps the reveal bulletproof if wave-rest never fires (Scroll's own
// coast finish() cap is 3.3s). Desktop keeps the editor's cadence — the fade starts with the
// coast (content cross-fades in over decaying waves) — but unmounts only after the full 1s fade.
export function LoadingVeil({ ready, zIndex = 300 }: { ready: boolean; zIndex?: number }) {
  const [phase, setPhase] = useState<'up' | 'fading' | 'down'>('up')
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    window.dispatchEvent(new Event('inkwave:reveal-imminent')) // coast starts NOW, on a light frame
    if (!isTouchDevice()) {
      const t = setTimeout(() => setPhase('fading'), 34) // ~2 frames — clear of the coast-start commit
      return () => clearTimeout(t)
    }
    // PHONE: fade only once the waves are at REST (parchment only at rest — the invariant).
    const fade = () => setPhase((p) => (p === 'up' ? 'fading' : p))
    const cap = setTimeout(fade, 4000) // fallback cap — the veil may never persist forever
    window.addEventListener('inkwave:wave-rest', fade)
    return () => {
      clearTimeout(cap)
      window.removeEventListener('inkwave:wave-rest', fade)
    }
  }, [ready])
  useEffect(() => {
    if (phase !== 'fading') return
    // Unmount only AFTER Scroll's fadingOut transition completes (0.8s phone / 1s desktop) —
    // the old fixed 520ms removed the veil mid-fade: a visible opacity pop on both platforms.
    const t = setTimeout(() => setPhase('down'), isTouchDevice() ? 850 : 1050)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'down') return null
  return (
    <div
      className="iw-loading-veil"
      style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: phase === 'fading' ? 'none' : 'auto' }}
      aria-hidden="true"
    >
      <Scroll phone={isTouchDevice()} fill revealed={false} fadingOut={phase === 'fading'}>
        <EmptyEditorSurface />
      </Scroll>
    </div>
  )
}
