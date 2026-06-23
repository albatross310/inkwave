import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { getSynonyms } from '../thesaurus'
import { getFont } from '../textMetrics'
import { CYCLE_SIZE, DELETE_SENTINEL } from './popoverConstants'
import type { CycleState, OnHintChange, LineRange } from './popoverConstants'
import { posOf, measureNaturalLineRight, computeLineCompressionRange } from './popoverGeometry'
import { SCAS_REVEAL_META } from '../../extensions/RedHighlightExtension'
import { buildSynonyms } from './popoverFallbacks'
import { lemmaOf } from '../../../scas/engine'

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
  isLockedLemma?: (lemma: string) => boolean,
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

  // Close-animation teardown timer (clears the decoration once the reflow-back has played).
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearCloseTimer = () => { if (closeTimerRef.current !== null) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null } }
  // Last applied compression range — so the close can ramp ITS spans' letter-spacing back to 0
  // (same ranges → the transition fires) rather than dropping them with a snap.
  const lastLineRangeRef = useRef<LineRange | null>(null)

  // ── Shared layout pass (Fix 2): always re-measure the NATURAL line fresh ──────
  // Clear decorations, re-find the live element, measure rect + line-right ANEW, recompute
  // compression, apply INSTANTLY. Never reuse coords captured at open time — they go stale after
  // scroll or iOS toolbar resize. Idempotent. (The animated open/glide was ripped out with the
  // flip-book animation — the compressed layout now snaps in.)
  function applyLayout(from: number, to: number, minWidth: number, overlay: boolean) {
    clearCloseTimer()
    if (overlay) { onHintChange(from, null); return }   // overlay mode never compresses
    onHintChange(null, null)                            // clear so we measure the natural line
    const fe = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
      .find(el => posOf(el, editor) === from)
    const pe = fe?.closest('p')
    if (!fe || !pe) return
    const rect         = fe.getBoundingClientRect()
    const naturalWidth = rect.width
    const natRight     = measureNaturalLineRight(rect, pe)
    const lineRange = computeLineCompressionRange(
      rect.top, rect.bottom, natRight, naturalWidth, minWidth, from, to, pe, editor,
    )
    const alignFraction = lineRange?.alignFraction ?? 0
    lastLineRangeRef.current = lineRange
    setCycle(prev => (prev && prev.from === from) ? { ...prev, alignFraction, naturalWidth } : prev)
    // Apply the compressed layout INSTANTLY. (The FLIP-open glide was ripped out with the rest of the
    // flip-book animation — it's static now.)
    onHintChange(from, minWidth, lineRange, false)
  }

  // Animate the reflow back to natural, then tear the cycle down. Called on dismiss/commit so
  // the surrounding text eases back instead of snapping. `targetWidth` is where the box should
  // settle: the original word's width on dismiss, or the CHOSEN synonym's width on commit — in
  // either case it ramps to the layout the committed/restored text will actually occupy (box at
  // that width, no compression), so the swap at the end is seamless.
  function closeWithAnimation(after?: () => void, _targetWidth?: number) {
    clearCloseTimer()
    const c = cycle
    if (!c || c.overlay) { onHintChange(null, null); setCycle(null); after?.(); return }
    // Tear down IMMEDIATELY. (The flip-book de-compress slide was ripped out — it left the word
    // focused/transparent for ~240ms after a dismiss or an unchanged commit, and never looked
    // crisp. Swap FIRST so the original word is never revealed for a frame, then clear the reel.)
    after?.()
    onHintChange(null, null)
    setCycle(null)
  }

  // SWAP-FIRST commit. Clear the reel/decoration, replace the word NOW (committed text shows
  // immediately, in place, at the final rewrapped layout), then tear the cycle down. The post-commit
  // de-compress slide (the "flip-book" animation) was ripped out — it never looked crisp, and the
  // extra invert/play/cleanup transactions kept rebuilding the decorations, replaying the
  // annotations' fade-in ("wawaa"). A clean snap is what's left.
  function commitWithSlide(swap: () => void, from: number, _replacementLen: number) {
    clearCloseTimer()
    onHintChange(null, null)
    swap()
    // The swap built a FRESH element for the new word, so its cross-out/stamp would pop in instead
    // of fading. Mark the slot "revealing" (hidden, no transition) for this rebuild, then clear it
    // a double-rAF later so the now-persisted element transitions 0 → visible after the ghost.
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(SCAS_REVEAL_META, { pos: from }))
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(SCAS_REVEAL_META, { clear: true }))
      }))
    }
    setCycle(null)
  }

  // Expand/compress immediately (no deferral). We tried deferring the pass while a touch was
  // held — to avoid rebuilding the DOM under an active gesture — but with no reserved space
  // during the hold, wide synonyms had nowhere to go (they overlapped, then clipped, the
  // surrounding text). The iOS gesture is instead kept alive by the on-node touchmove
  // suppressor in ThesaurusPopover (Fix 4), which survives the rebuild, so we can apply the
  // layout right away and the reel always has its box.

  // Resize safety net — re-measure & re-apply for the current cycle (idempotent).
  useEffect(() => {
    if (!cycle || cycle.overlay) return
    const c = cycle
    const onResize = () => applyLayout(c.from, c.to, c.minWidth, c.overlay)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [cycle?.from, cycle?.minWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCycleForElement(target: HTMLElement) {
    clearCloseTimer()   // re-opening during a close-animation cancels its pending teardown
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

    // Apply provisional focus immediately (instant, no transition) to prevent the null-gap flash
    // on Tab nav and to give the open animation a clean natural starting box.
    onHintChange(domPos, rect.width, null, false)
    // The focus above made the word transparent SYNCHRONOUSLY (PM); the reel is React state. Because
    // this runs in a NATIVE pointerdown listener (not a React synthetic event), React would not
    // guarantee the reel mounts before the browser's next paint — leaving a frame of "transparent
    // word, no reel" = the word VANISHES then reappears. flushSync commits the reel in the same
    // paint as the transparency, closing that gap.
    flushSync(() => setCycle({
      word: lookupWord, from: domPos, to: domPos + displayWord.length,
      synonyms: Array(CYCLE_SIZE).fill(displayWord),
      reelPos: 0, overlay,
      minWidth: rect.width, naturalWidth: rect.width, naturalLeft: rect.left, alignFraction: 0.5,
      naturalTop: rect.top, naturalBottom: rect.bottom, naturalLineRight: natRight,
    }))

    getSynonyms(lookupWord).then(candidates => {
      // Bail if the cycle closed or another word was focused while fetching.
      const fe = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
      if (!fe || posOf(fe, editor) !== domPos) return

      // Suppress Locked lemmas from the suggestion list (§4.4): a word with an outstanding
      // ban-credit debt can't be acquired cheaply as someone else's synonym.
      const offered = isLockedLemma ? candidates.filter(c => !isLockedLemma(lemmaOf(c))) : candidates

      // Slot 0 is the ORIGINAL word (lookupWord = the managed slot's original, or the
      // word itself when unmanaged), so a managed word re-offers the original's list.
      // Match the flagged word's leading case: a capitalised word keeps its capital
      // through every slot (and on commit).
      const capitalize = /^[A-Z]/.test(displayWord)
      const { synonyms, minWidth } = buildSynonyms(lookupWord, offered, font, rect.width, capitalize)
      // Centre the reel on the word currently in the text (may differ from the original for a
      // managed slot), so reopening shows what's there, not the original.
      const cur = displayWord.toLowerCase()
      let reelPos = synonyms.findIndex(s => s !== DELETE_SENTINEL && s.toLowerCase() === cur)
      if (reelPos < 0) reelPos = 0
      setCycle(prev => prev?.from === domPos ? { ...prev, synonyms, minWidth, reelPos } : prev)
      // Animate the OPEN (FLIP-out): the box expands and the after-text glides out to make room
      // (compositor transform — no per-frame layout), mirroring the commit's inward slide.
      applyLayout(domPos, domPos + displayWord.length, minWidth, overlay)
    })
  }

  return { cycle, setCycle, openCycleForElement, closeWithAnimation, commitWithSlide }
}
