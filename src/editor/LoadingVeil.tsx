import { useEffect, useRef, useState } from 'react'
import { Scroll, EmptyEditorSurface, isTouchDevice } from './Scroll'
import { LoadingTip } from '../components/LoadingTip'

// ─── LoadingVeil — the wave loading choreography for secondary routes (Peter, 2026-07-09) ────
// A route-level, full-screen wave shell (Edit.tsx's persistent loading shell, distilled): it
// mounts covering everything — waves drifting on the shared sibling-adopted clock. `ready` starts
// the coast; the three-second tip countdown and readiness form the reveal barrier. At wave-rest the
// loading surface holds still with sparkles looping until that automatic reveal begins. ONE-SHOT:
// once revealed it never re-covers, so in-view navigation (snapshot scrubbing) is unaffected.
//
// PLATFORM ORDERING (2026-07-11, the phone "white background early" fix — same invariant as the
// editor's loading shell): the veil is the ONLY water on its route, so on PHONE it must stay
// fully OPAQUE until 'inkwave:wave-rest' (its own Scroll dispatches it at coast end) — the old
// fixed 1.5s timer started the fade MID-COAST, exposing the parchment content under moving
// water, and then unmounted at 520ms into Scroll's 0.8s fade (an opacity pop). Now: opaque
// through the whole coast → after countdown/readiness, fade over STILL water (the .iw-loading-veil CSS keeps the
// phone surface pinned + water-painted through waveMode 'off' — a bare phone surface reverts to
// parchment there). Desktop and phone now share the same stationary pre-reveal boundary.
export function LoadingVeil({ ready, zIndex = 300 }: { ready: boolean; zIndex?: number }) {
  const [phase, setPhase] = useState<'up' | 'fading' | 'down'>('up')
  const [continueRequested, setContinueRequested] = useState(false)
  const [waterRested, setWaterRested] = useState(false)
  const coastStarted = useRef(false)
  const revealStarted = useRef(false)

  // Loading completion starts the coast, not the page. The tip/button remain over the water and
  // the deterministic sparkle hold takes over at rest until the writer continues.
  useEffect(() => {
    if (!ready || coastStarted.current) return
    coastStarted.current = true
    const rested = () => setWaterRested(true)
    window.addEventListener('inkwave:wave-rest', rested)
    window.addEventListener('inkwave:load-watchdog', rested)
    window.dispatchEvent(new Event('inkwave:reveal-imminent'))
    return () => {
      window.removeEventListener('inkwave:wave-rest', rested)
      window.removeEventListener('inkwave:load-watchdog', rested)
    }
  }, [ready])

  useEffect(() => {
    if (!continueRequested || !waterRested || revealStarted.current) return
    revealStarted.current = true
    // Let the stationary wave/twinkle handoff paint before the veil begins uncovering the page.
    const timer = window.setTimeout(() => setPhase('fading'), 34)
    return () => window.clearTimeout(timer)
  }, [continueRequested, waterRested])
  useEffect(() => {
    if (phase !== 'fading') return
    // Unmount only AFTER Scroll's fadingOut transition completes (0.56s phone / 0.7s desktop) —
    // the old fixed 520ms removed the veil mid-fade: a visible opacity pop on both platforms.
    const t = setTimeout(() => setPhase('down'), isTouchDevice() ? 610 : 750)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'down') return null
  return (
    <div
      className="iw-loading-veil"
      style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: phase === 'fading' ? 'none' : 'auto' }}
    >
      <Scroll
        phone={isTouchDevice()}
        fill
        revealed={false}
        fadingOut={phase === 'fading'}
        loadingTwinkles={phase === 'up'}
      >
        <EmptyEditorSurface />
      </Scroll>
      {phase === 'up' && <LoadingTip ready={ready} onContinue={() => setContinueRequested(true)} />}
    </div>
  )
}
