import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { STUDIO_FILE_SETUP_TIP } from '../pwa/studioFileSetup'

export const LOADING_TIPS = [
  'Install Inkwave from your browser’s Share or app menu for a focused writing window.',
  'Choose New doc to open the next available recent document in another window.',
  'Press ⌘/Ctrl+N to change this window to a blank document.',
  'Press ⌘/Ctrl+Shift+N to create a blank document in a new window.',
  'On Mac, use ⌥Tab for the next Inkwave window and ⌃⌥Tab for the previous one.',
  'On Windows, use Ctrl+Alt+→ for the next Inkwave window and Ctrl+Alt+← for the previous one.',
  'Use ⌘W to close only this Inkwave window. ⌘Q quits every window in the installed app.',
  'Zoom two ways: pinch naturally or hold Shift with any two-finger direction to reflow text; hold ⌘ to magnify the whole page and water.',
  STUDIO_FILE_SETUP_TIP,
] as const

export const LOADING_TIP_COUNTDOWN_MS = 3000

export function loadingTipIndex(random: () => number = Math.random): number {
  return Math.min(LOADING_TIPS.length - 1, Math.max(0, Math.floor(random() * LOADING_TIPS.length)))
}

export function loadingTipFontSize(text: string): string {
  if (text.length > 110) return '0.74rem'
  if (text.length > 72) return '0.8rem'
  return '0.86rem'
}

/**
 * A loading-screen hint that joins the water's existing first-paint gate.
 *
 * Both strings are server-rendered but paint-hidden. The client chooses one in a layout effect and
 * records that choice as a data attribute before paint; CSS reveals only that child when
 * `.iw-water-ready` opens the water gate. This avoids random server/client text (a hydration
 * mismatch) and avoids inserting anything imperatively into React's document before hydration.
 */
export function LoadingTip({ ready, onContinue }: { ready: boolean; onContinue: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const chosenRef = useRef<number | null>(null)
  const continuingRef = useRef(false)
  const [secondsRemaining, setSecondsRemaining] = useState(LOADING_TIP_COUNTDOWN_MS / 1000)
  const [continuing, setContinuing] = useState(false)

  useEffect(() => {
    if (secondsRemaining <= 0) return
    const timer = window.setTimeout(() => setSecondsRemaining((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [secondsRemaining])

  // Scroll's 30-second watchdog exists for a load that never becomes ready. Once this fact is true,
  // waiting is intentional and user-controlled; tell the water driver not to mistake a leisurely
  // pause on the tip for a wedged reveal chain.
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event('inkwave:load-awaiting-continue'))
  }, [ready])

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    // React StrictMode replays mount effects in development. Keep one choice for this component
    // instance and clear the marker before reapplying it, so an effect replay can never expose two
    // tips during one load.
    const index = chosenRef.current ?? loadingTipIndex()
    chosenRef.current = index
    for (const tip of root.querySelectorAll<HTMLElement>('[data-loading-tip-text]')) {
      tip.removeAttribute('data-active')
    }
    root.querySelector<HTMLElement>(`[data-loading-tip-text="${index}"]`)?.setAttribute('data-active', '')
    root.setAttribute('data-loading-tip', String(index))
  }, [])

  const showTip = (index: number) => {
    const root = ref.current
    if (!root) return
    for (const tip of root.querySelectorAll<HTMLElement>('[data-loading-tip-text]')) {
      tip.toggleAttribute('data-active', tip.dataset.loadingTipText === String(index))
    }
    chosenRef.current = index
    root.setAttribute('data-loading-tip', String(index))
  }
  const showNextTip = () => showTip(((chosenRef.current ?? 0) + 1) % LOADING_TIPS.length)
  const continueLoad = () => {
    if (!ready || secondsRemaining > 0 || continuingRef.current) return
    continuingRef.current = true
    setContinuing(true)
    onContinue()
  }

  // The countdown and readiness are a two-input barrier. Whichever arrives second opens the page:
  // a fast document waits for zero; a slow document opens the instant it becomes ready after zero.
  useEffect(() => {
    if (secondsRemaining === 0 && ready) continueLoad()
  }, [secondsRemaining, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // The loading layer owns Tab while visible so it can request another tip. Other keys are left
  // alone; completing the countdown no longer requires or waits for an input gesture.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      event.stopImmediatePropagation()
      showNextTip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} className="iw-loading-tip" role="dialog" aria-label="Inkwave loading tip">
      {LOADING_TIPS.map((tip, index) => (
        <span
          key={tip}
          className="iw-loading-tip__text"
          data-loading-tip-text={index}
          style={{ fontSize: loadingTipFontSize(tip) }}
        >
          <strong>Tip:</strong> {tip}
        </span>
      ))}
      <button
        type="button"
        className="iw-loading-tip__new"
        data-loading-new-tip
        onClick={showNextTip}
      >
        New tip (Tab)
      </button>
      {secondsRemaining > 0 ? (
        <span className="iw-loading-tip__countdown" aria-live="polite">
          Ready in {secondsRemaining}…
        </span>
      ) : continuing || ready ? (
        <span className="iw-loading-tip__countdown" aria-live="polite">Opening…</span>
      ) : (
        <span className="iw-loading-tip__countdown" aria-live="polite">Finishing…</span>
      )}
    </div>
  )
}
