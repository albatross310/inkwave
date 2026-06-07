import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { getSynonyms } from '../thesaurus'
import { getFont } from '../textMetrics'
import { CYCLE_SIZE, DELETE_SENTINEL } from './popoverConstants'
import type { CycleState, OnHintChange } from './popoverConstants'
import { posOf, measureNaturalLineRight, computeLineCompressionRange } from './popoverGeometry'
import { buildSynonyms } from './popoverFallbacks'

// The in-place expand+compress popover is the experience on every device. The opaque
// overlay card is a dormant fallback, opt-in via ?overlay=1 only — used to compare or
// in case the in-place spacing can't be made reliable on iOS.
function wantsOverlay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('overlay') === '1'
  } catch { return false }
}

export function usePopoverLayout(
  editor: Editor,
  onHintChange: OnHintChange,
) {
  const [cycle, setCycle] = useState<CycleState | null>(null)
  const [, forceUpdate]   = useState(0)

  // Re-render on resize/scroll so live DOM positions stay in sync.
  useEffect(() => {
    if (!cycle) return
    const upd = () => forceUpdate(n => n + 1)
    window.addEventListener('resize', upd)
    window.addEventListener('scroll', upd, true)
    return () => { window.removeEventListener('resize', upd); window.removeEventListener('scroll', upd, true) }
  }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared layout pass (Fix 2): always re-measure the NATURAL line fresh ──────
  // Clear decorations, re-find the live element, measure rect + line-right ANEW, recompute
  // compression, apply. Never reuse coords captured at open time — they are viewport-relative
  // and go stale after any scroll or iOS toolbar resize, which made compression classify
  // against the wrong visual line and compound per pass. Idempotent by construction.
  function applyLayout(from: number, to: number, minWidth: number, overlay: boolean) {
    if (overlay) { onHintChange(from, null); return }   // overlay mode never compresses
    onHintChange(null, null)                            // clear so we measure the natural line
    const fe = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
      .find(el => posOf(el, editor) === from)
    const pe = fe?.closest('p')
    if (!fe || !pe) return
    const rect     = fe.getBoundingClientRect()
    const natRight = measureNaturalLineRight(rect, pe)
    const lineRange = computeLineCompressionRange(
      rect.top, rect.bottom, natRight, rect.width, minWidth, from, to, pe, editor,
    )
    onHintChange(from, minWidth, lineRange)
    const alignFraction = lineRange?.alignFraction ?? 0
    setCycle(prev => (prev && prev.from === from) ? { ...prev, alignFraction, naturalWidth: rect.width } : prev)
  }

  // ── Defer layout while a pointer is held (Fix 3) ─────────────────────────────
  // Expanding/compressing rebuilds the DOM; doing that under an active touch makes iOS drop
  // scroll-suppression and pan the page under the reel (synonyms landing mid-drag triggered
  // it). So while a pointer is down we record the intended pass and flush it on release.
  const pointerHeldRef = useRef(false)
  const pendingRef = useRef<{ from: number; to: number; minWidth: number; overlay: boolean } | null>(null)
  function requestLayout(from: number, to: number, minWidth: number, overlay: boolean) {
    if (pointerHeldRef.current) pendingRef.current = { from, to, minWidth, overlay }
    else applyLayout(from, to, minWidth, overlay)
  }
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    applyLayout(p.from, p.to, p.minWidth, p.overlay)
    forceUpdate(n => n + 1)   // the focused rect just changed — recompute geometry
  }
  useEffect(() => {
    const down = () => { pointerHeldRef.current = true }
    const up   = () => { pointerHeldRef.current = false; flushRef.current() }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', up, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', up, true)
    }
  }, [])

  // Resize safety net — re-measure & re-apply for the current cycle (deferred if held).
  useEffect(() => {
    if (!cycle || cycle.overlay) return
    const c = cycle
    const onResize = () => requestLayout(c.from, c.to, c.minWidth, c.overlay)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [cycle?.from, cycle?.minWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCycleForElement(target: HTMLElement) {
    const displayWord = target.textContent ?? ''
    const lookupWord  = target.dataset.word ?? displayWord.toLowerCase()
    if (!lookupWord) return
    const overlay = wantsOverlay()

    let domPos: number
    try { domPos = editor.view.posAtDOM(target.firstChild ?? target, 0) } catch { return }

    // Clear existing decoration synchronously — PM dispatch is sync so the DOM
    // reverts to natural layout before we measure.
    onHintChange(null, null)

    // Re-acquire a live element: the PM rebuild above may have destroyed the
    // original target if the previous compression range covered this word.
    const reds = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
    const live = reds.find(el => posOf(el, editor) === domPos)
    if (!live) return

    const rect   = live.getBoundingClientRect()
    const font   = getFont(live)
    const pEl    = live.closest('p')
    const natRight = pEl ? measureNaturalLineRight(rect, pEl) : rect.right

    // Apply provisional focus immediately to prevent the null-gap flash on Tab nav.
    onHintChange(domPos, rect.width)
    setCycle({
      word: lookupWord, from: domPos, to: domPos + displayWord.length,
      synonyms: Array(CYCLE_SIZE).fill(displayWord),
      reelPos: 0, overlay,
      minWidth: rect.width, naturalWidth: rect.width, naturalLeft: rect.left, alignFraction: 0.5,
      naturalTop: rect.top, naturalBottom: rect.bottom, naturalLineRight: natRight,
    })

    getSynonyms(lookupWord).then(candidates => {
      // Bail if the cycle closed or another word was focused while fetching.
      const fe = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
      if (!fe || posOf(fe, editor) !== domPos) return

      // Slot 0 is the ORIGINAL word (lookupWord = the managed slot's original, or the
      // word itself when unmanaged), so a managed word re-offers the original's list.
      // Match the flagged word's leading case: a capitalised word keeps its capital
      // through every slot (and on commit).
      const capitalize = /^[A-Z]/.test(displayWord)
      const { synonyms, minWidth } = buildSynonyms(lookupWord, candidates, font, rect.width, capitalize)
      // Centre the reel on the word currently in the text (may differ from the original for a
      // managed slot), so reopening shows what's there. Don't snap it under a steering finger
      // (Fix 3) — keep the live reel position while a pointer is held.
      const cur = displayWord.toLowerCase()
      let reelPos = synonyms.findIndex(s => s !== DELETE_SENTINEL && s.toLowerCase() === cur)
      if (reelPos < 0) reelPos = 0
      setCycle(prev => prev?.from === domPos
        ? { ...prev, synonyms, minWidth, reelPos: pointerHeldRef.current ? prev.reelPos : reelPos }
        : prev)
      // Apply the expand+compress pass via the shared, fresh-measuring path (deferred if held).
      requestLayout(domPos, domPos + displayWord.length, minWidth, overlay)
    })
  }

  return { cycle, setCycle, openCycleForElement }
}
