// ThesaurusPopover — Word-cycle synonym interface.
// Keyboard: j/k cycle, Space accept+advance, Tab prev word, Shift+Tab next, Esc dismiss
// Slots: 0 = original word, 1–7 = synonyms (no delete slot — double-tap a word to delete it)
// Mouse: press opens; drag spins the reel and it rests; short click commits,
// press-and-hold (anywhere) keeps it open to keep changing; double-tap selects for deletion.
// Touch (phone model, 2026-07-09): a still TAP opens the cycle (on pointerup) and it STAYS open;
// browsing is then a NEW vertical drag starting on the open word/reel (touch-action:none there —
// the reel owns that gesture exclusively, the page never moves); a pan starting anywhere else —
// including an UNOPENED red word — is native page scroll exclusively and never touches the reel.
// Tap the reel to confirm, tap outside to dismiss, double-tap to select for deletion.
//
// Stage D animation model: the reel is a CONTINUOUS scroll position (cycle.reelPos,
// in slot units) rather than discrete steps. A drag moves it 1:1 with the pointer; on
// release a single rAF physics loop coasts with the release velocity (exponential
// decay) and then eases to the nearest slot — Apple-picker momentum, not snapping.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useCompliance } from '../../../scas/compliance'
import { CYCLE_SIZE, DELETE_SENTINEL, REFLOW_COMMIT_MS, REFLOW_EASE } from './popoverConstants'
import type { OnHintChange } from './popoverConstants'
import { posOf } from './popoverGeometry'
import { displayFor } from './popoverFallbacks'
import { measureTextWidth, getFont } from '../textMetrics'
import { usePopoverLayout } from './usePopoverLayout'
import { scaleFor, unscale, subscribe as subscribeMagnify } from '../../magnify'

// The selected slot for a given continuous position = nearest ring, wrapped into [0,SIZE).
const slotAt = (pos: number) => ((Math.round(pos) % CYCLE_SIZE) + CYCLE_SIZE) % CYCLE_SIZE

// Commit choreography — a strict 3-event clock, NOTHING else moving in between:
//   EVENT 1  press        — open: reel out in a flash, no fade/drift (handled at open).
//   EVENT 2  release (T=0) — the reel rolls back to centre (settleTo); nothing else.
//   EVENT 3  the moment it lands — the action: neighbour rows REPLACED in-place by ghosts
//                            (seamless freeze-frame, fading out), the line reflows/commits in one
//                            clean SNAP, and FADE_MS later the cross-out + date fade in. Ghost-out
//                            and fade-in never overlap.
// GHOST_MS mirrored in CSS as scasReelOut; FADE_MS (500) as the annotations' animation-delay.
const GHOST_MS = 500

// ── Momentum tuning ──────────────────────────────────────────────────────────
const MAX_VEL    = 0.060   // slots/ms — capped so a frame never jumps the whole window
const FLING_TAU  = 260     // ms; coast distance ≈ v0 · TAU, so larger = more glide / browse
const VEL_STOP   = 0.0006  // slots/ms; below this the fling hands off to the settle ease

// Pointer travel under this = a still tap/click (opens the cycle on touch, commits on release).
const TAP_PX = 6

interface ThesaurusPopoverProps {
  editor: Editor
  paragraphIndex: number
  containerEl: React.RefObject<HTMLDivElement>
  onHintChange: OnHintChange
  onCycleChange?: (active: boolean) => void // optional — no current caller consumes it
  isLockedLemma?: (lemma: string) => boolean
  firstNudgeAt?: (word: string) => number | undefined
}

export function ThesaurusPopover({ editor, paragraphIndex, containerEl, onHintChange, onCycleChange, isLockedLemma, firstNudgeAt }: ThesaurusPopoverProps) {
  const { recordAccepted, recordIgnored } = useCompliance()
  const tabCursorRef = useRef<number | null>(null)
  const { cycle, setCycle, openCycleForElement, closeWithAnimation, commitWithSlide } = usePopoverLayout(editor, onHintChange, isLockedLemma)

  // Bump on scroll/resize so the memoised geometry recomputes; reel animation does NOT
  // touch this, so per-frame reelPos updates never redo getBoundingClientRect.
  const [geomNonce, setGeomNonce] = useState(0)
  // True during a commit: the chosen reel synonym slides from its (possibly shifted-left) reel
  // position to its committed natural-x over REFLOW_COMMIT_MS, in sync with the decoration's
  // left/right de-compression — so the word slides home WITH the surrounding text, not after it.
  const [committing, setCommitting] = useState(false)
  // Fading clones of the reel's ABOVE + BELOW neighbours, left at even heights around the committed
  // word on commit (the reel card itself tears down instantly; the committed word snaps to its final
  // spot via a decoration). Drives the visible reel "flash out" without overlapping the committed word
  // (an overlap double-images at zoom → stray lines). Cleared after the fade.
  const [ghosts, setGhosts] = useState<Array<{ top: number; left: number; rowH: number; text: React.ReactNode; color: string; fontFamily: string; fontSize: string }> | null>(null)

  useEffect(() => { onCycleChange?.(!!cycle); if (!cycle) setCommitting(false) }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  const redWords = () => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))

  // ── Reel animation state (refs — authoritative; cycle.reelPos mirrors for render) ──
  const reelRef   = useRef(0)              // live continuous position
  const velRef    = useRef(0)              // slots/ms, for momentum
  const targetRef = useRef(0)              // intended landing slot (keyboard/settle)
  const rafRef    = useRef<number | null>(null)
  const rowHRef   = useRef(20)             // current row height in px (from geometry)
  const engagedRef = useRef(false)         // has the reel reached a non-original slot this session?
  const openedByPointerRef = useRef(false) // did the in-flight press just open the cycle? (don't commit on its release)
  const draggingRef = useRef(false)        // pointer is held down and steering the reel

  // True while the reel is actually scrolling — drives the "original" marker, which
  // only shows in motion. Set on every reel frame; a short idle timer clears it.
  const [moving, setMoving] = useState(false)
  const movingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelAnim() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }
  // Turn the "moving" flag off once the reel is genuinely at rest — but NOT while a drag
  // is held (even paused/stationary) or an animation is running, so a slow drag never
  // blinks the marker off between pointer-move events.
  // Linger longer than a deliberate key-tap cadence so cycling j/k doesn't drop `moving` between
  // presses (which made the neighbour rows fade then snap back — the strobe). 300ms covers taps;
  // held key-repeat is far faster and stays continuously lit.
  function scheduleMovingOff(delay = 300) {
    if (movingTimerRef.current) clearTimeout(movingTimerRef.current)
    movingTimerRef.current = setTimeout(() => {
      if (!draggingRef.current && rafRef.current === null) setMoving(false)
    }, delay)
  }
  function pushReel() {
    if (!engagedRef.current && Math.round(reelRef.current) !== 0) engagedRef.current = true
    setMoving(true)
    scheduleMovingOff()
    setCycle(c => c ? { ...c, reelPos: reelRef.current } : c)
  }

  // ── Cursor management ─────────────────────────────────────────────────────

  function restoreCursor() {
    const pos = tabCursorRef.current; if (pos === null) return
    tabCursorRef.current = null
    requestAnimationFrame(() => { if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run() })
  }
  function pinCursor() {
    if (tabCursorRef.current !== null && !editor.isDestroyed)
      editor.commands.setTextSelection(tabCursorRef.current)
  }
  function closeCycle(record = true, restore = true) {
    if (record) recordIgnored()
    // Ease the reflow back to natural, then tear down (restoreCursor runs after the animation).
    closeWithAnimation(restore ? restoreCursor : undefined)
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function goNext(after: number, max?: number): boolean {
    const el = redWords().find(el => { const p = posOf(el, editor); return p > after && (max === undefined || p < max) })
    if (el) { openCycleForElement(el); return true }; return false
  }
  // ── Accept ────────────────────────────────────────────────────────────────

  function advanceOrRestore(from: number, advance: boolean) {
    if (advance) requestAnimationFrame(() => { if (!goNext(from, tabCursorRef.current ?? undefined)) restoreCursor() })
    else restoreCursor()
  }
  // EVENT-3 ghosts: a freeze-frame of the reel's neighbour rows (just above/below the chosen word),
  // captured from the reel's OWN geometry so each ghost sits EXACTLY where the reel drew it. Mounting
  // it in the same tick the reel tears down makes the swap seamless (no gap) and drift-free (no
  // shoot-back). Skips the delete sentinel.
  function captureReelGhosts(chosen: string) {
    const c = cycle; if (!c || !geom) return null
    const N = c.synonyms.length; const idx = Math.max(0, c.synonyms.indexOf(chosen))
    const mobile = window.innerWidth < 768 ? 1.4 : 1
    const { left, cardTop, cardH, rowH, slotLefts, fsz, fontFamily } = geom
    const centreTop = cardTop + (cardH - rowH) / 2
    const row = (delta: number) => {
      const slot = (((idx + delta) % N) + N) % N
      const w = c.synonyms[slot]
      if (w === DELETE_SENTINEL) return null
      return { top: centreTop + delta * rowH, left: left + slotLefts[slot], rowH,
               text: displayFor(w, mobile), color: w === c.synonyms[0] ? '#9b5ccc' : '#6f3b9e',
               fontFamily, fontSize: `${fsz}px` }
    }
    return [row(-1), row(1)].filter(Boolean) as Array<NonNullable<ReturnType<typeof row>>>
  }
  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!cycle) return
    const { from, to, word } = cycle; const wl = to - from
    const changed = replacement !== editor.state.doc.textBetween(from, to)
    recordAccepted()
    const ghostRows = captureReelGhosts(replacement)   // freeze-frame target (reel geometry, while open)
    // Preserve the slot's first-written stamp across re-cycles: reuse any existing firstCommitAt in
    // this range; otherwise the TRUE time the word first turned purple (firstNudgeAt); else now.
    // Also gather prior attrs for history/changes tracking (P3 memory slot persistence).
    let firstCommitAt: string | null = null
    let priorAttrs: Record<string, unknown> = {}
    editor.state.doc.nodesBetween(from, to, (node) => {
      const m = node.marks.find(mk => mk.type.name === 'scasSlot')
      if (m) {
        priorAttrs = m.attrs as Record<string, unknown>
        if (m.attrs.firstCommitAt) firstCommitAt = String(m.attrs.firstCommitAt)
      }
    })
    if (!firstCommitAt) firstCommitAt = String(firstNudgeAt?.(word) ?? Date.now())
    const prevHistory = (Array.isArray(priorAttrs.history) ? priorAttrs.history : []) as string[]
    const prevChanges = typeof priorAttrs.changes === 'number' ? (priorAttrs.changes as number) : 0
    const newHistory = changed ? [...prevHistory, replacement].slice(-3) : prevHistory
    const slotAttrs = {
      original: word,
      firstCommitAt,
      firstWord: (priorAttrs.firstWord as string | null) ?? replacement,
      lastCommitAt: new Date().toISOString(),
      history: newHistory.length ? newHistory : null,
      changes: changed ? prevChanges + 1 : prevChanges,
    }
    const swap = () => {
      if (changed) {
        if (tabCursorRef.current !== null && from < tabCursorRef.current) tabCursorRef.current += replacement.length - wl
        // Carry the SCAS-slot mark (anchored to the original word) so the position stays managed.
        editor.chain().deleteRange({ from, to }).insertContentAt(from, {
          type: 'text', text: replacement,
          marks: [{ type: 'scasSlot', attrs: slotAttrs }],
        }).run()
      } else {
        // Resolve IN PLACE: committing without scrolling still makes the word a managed slot.
        editor.chain().setTextSelection({ from, to }).setMark('scasSlot', slotAttrs).run()
      }
      pinCursor(); advanceOrRestore(from, advance)
    }
    // EVENT 2 — the reel rolls back to centre. EVENT 3 fires the MOMENT it lands (settleTo's onRest),
    // so a click/tab (already centred → dist 0 → instant) commits with no dead timer; only an
    // off-centre drag-release waits for the roll. At EVENT 3 the neighbour rows are replaced by ghosts
    // (same tick as the teardown → seamless) and the line reflows/commits — a clean SNAP (the
    // flip-book slide + its render-buffer beat were ripped out; they only made the commit look mushy).
    cancelAnim()
    settleTo(Math.round(reelRef.current), () => {
      if (ghostRows && ghostRows.length) { setGhosts(ghostRows); window.setTimeout(() => setGhosts(null), GHOST_MS + 60) }
      if (!changed) closeWithAnimation(swap)
      else commitWithSlide(swap, from, replacement.length)
    })
  }

  // Refs so the once-subscribed input handlers below read live state without
  // re-subscribing (which would reset the drag/wheel accumulators).
  const cycleRef = useRef(cycle)
  cycleRef.current = cycle
  const acceptRef = useRef(acceptSuggestion)
  acceptRef.current = acceptSuggestion

  // ── Reel motion ─────────────────────────────────────────────────────────────

  function acceptLanded(pos: number, advance: boolean) {
    const c = cycleRef.current; if (!c) return
    acceptRef.current(c.synonyms[slotAt(pos)], advance)
  }

  // Commit whatever slot the reel has come to rest on. A tap/rest on the ORIGINAL word (even
  // un-scrolled) now CONFIRMS it (records it as a deliberate choice and eases shut) rather than
  // dismissing — dropping the old "you must scroll the word around to confirm" requirement.
  // Dismiss is still available via Escape / Tab-away / tapping outside the reel.
  function commitLandedRest() {
    const c = cycleRef.current; if (!c) return
    acceptRef.current(c.synonyms[slotAt(reelRef.current)], false)
  }

  // Ease reelPos to an integer slot. `onRest` fires once it lands — fling passes the commit so a
  // released flick auto-accepts; keyboard/wheel settles pass nothing and just rest.
  function settleTo(target: number, onRest?: () => void) {
    cancelAnim()
    targetRef.current = target
    const start = reelRef.current
    const dist  = target - start
    if (Math.abs(dist) < 0.001) { reelRef.current = target; pushReel(); onRest?.(); return }
    const dur = Math.min(280, 130 + Math.abs(dist) * 90)
    let t0: number | null = null
    const step = (t: number) => {
      if (t0 === null) t0 = t
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)            // easeOutCubic
      reelRef.current = start + dist * e
      pushReel()
      if (p < 1) { rafRef.current = requestAnimationFrame(step) }
      else { rafRef.current = null; reelRef.current = target; pushReel(); onRest?.() }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  // Coast with the release velocity, decaying exponentially, then settle on the nearest slot and
  // COMMIT it — a released flick lands and accepts once its momentum runs out (no second tap).
  function fling(v0: number) {
    cancelAnim()
    velRef.current = Math.max(-MAX_VEL, Math.min(MAX_VEL, v0))
    let last: number | null = null
    const step = (t: number) => {
      if (last === null) last = t
      let dt = t - last; last = t
      if (dt > 50) dt = 50                         // clamp tab-switch / GC stalls
      reelRef.current += velRef.current * dt
      velRef.current  *= Math.exp(-dt / FLING_TAU)
      pushReel()
      if (Math.abs(velRef.current) < VEL_STOP) { rafRef.current = null; settleTo(Math.round(reelRef.current), commitLandedRest) }
      else rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  // Keyboard j/k: glide one slot, chaining off the pending target if mid-animation.
  function nudge(dir: number) {
    const base = rafRef.current !== null ? targetRef.current : Math.round(reelRef.current)
    settleTo(base + dir)
  }

  // ── Open (pointer) / focus reset ─────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return
    const edEl = editor.view.dom
    // PHONE TAP-TO-OPEN (2026-07-09). A touch on a red word must NOT open (or scroll) the cycle on
    // pointerDOWN — at gesture start the finger is ambiguous (tap vs page pan), and the old
    // open-on-down model made the SAME gesture both open the cycle and steer the reel while the
    // browser — whose gesture-start touch-action on the word is `pan-x pan-y` (the universal phone
    // rule in index.css) — was equally entitled to take it as a page pan. Whoever won the first
    // touchmove won: sometimes both ran (page panned WHILE the reel advanced), and a browser-claimed
    // pan fired pointercancel and killed the drag mid-way ("they restrict each other"). New model:
    // a still tap (< TAP_PX at release) opens the cycle on pointerUP; a moved finger is a native
    // page scroll and nothing opens. Browsing is then a NEW gesture that must start on the open
    // word/reel (see dragArmed), whose touch-action:none lets the reel own it outright.
    let pendingTouchOpen: { id: number; x: number; y: number } | null = null
    function openFor(t: HTMLElement) {
      tabCursorRef.current = null
      openedByPointerRef.current = true   // this press/tap opened the cycle — its release must not commit
      openCycleForElement(t)
    }
    function onPointerDown(e: PointerEvent) {
      const t = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!t || !edEl.contains(t)) return
      if (e.pointerType === 'touch') {
        // Arm the tap-open. preventDefault here suppresses only the compatibility mouse events
        // (no PM caret placement / iOS keyboard) — NOT the native pan, which stays free: a finger
        // that moves scrolls the page and the tap-open is abandoned by the distance gate at up.
        pendingTouchOpen = { id: e.pointerId, x: e.clientX, y: e.clientY }
        e.preventDefault()
        return
      }
      // Mouse/pen: unchanged press-opens model. Shrink the effective click target by 3px each
      // side so a click right at the word's edge falls through to ProseMirror's normal cursor
      // placement instead of opening the cycle.
      const r = t.getBoundingClientRect()
      if (e.clientX < r.left + 3 || e.clientX > r.right - 3) return
      e.preventDefault()
      openFor(t)
      // The open REBUILDS this .scas-red span (PM dispatch destroys it). The browser gives the
      // pointer an IMPLICIT capture to that span — but per spec it's set AFTER the pointerdown event
      // finishes dispatching, so a setPointerCapture() we call *synchronously* here gets clobbered by
      // it on some words (whichever way the per-word rebuild timing falls) → once that span detaches,
      // the gesture's pointermove/up bubble up an orphaned tree and never reach the document reel-drag
      // listener = "every second word won't scroll on first click". So re-assert capture on the editor
      // root (never rebuilt) in a MICROTASK too: that runs after dispatch (after the implicit capture
      // is set) but before the next pointer event, reliably overriding it. Belt-and-braces: both.
      const pid = e.pointerId
      const grab = () => { try { edEl.setPointerCapture(pid) } catch { /* pointer ended */ } }
      grab()
      queueMicrotask(grab)
    }
    function onPointerUp(e: PointerEvent) {
      const p = pendingTouchOpen; pendingTouchOpen = null
      if (!p || e.pointerId !== p.id) return
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAP_PX) return   // it panned — the page owned it
      // Touch implicit capture keeps e.target = the down element; if a SCAS tick rebuilt the span
      // mid-tap that node is detached, so fall back to a live hit-test at the release point.
      let t = (e.target as HTMLElement | null)?.closest?.('.scas-red') as HTMLElement | null
      if (!t || !edEl.contains(t))
        t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('.scas-red') as HTMLElement | null
      if (!t || !edEl.contains(t)) return
      openFor(t)
    }
    function onPointerCancel() { pendingTouchOpen = null }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('pointerup', onPointerUp, { capture: true })
    document.addEventListener('pointercancel', onPointerCancel, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('pointerup', onPointerUp, { capture: true })
      document.removeEventListener('pointercancel', onPointerCancel, { capture: true })
    }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the reel whenever a different word is focused (or the cycle opens/closes).
  // Keyed on `from` only — synonym loads (which keep `from`) must not reset position.
  // Also keyed on cycle.synonyms: when the real synonym list loads it carries the
  // reel position centred on the current word, so resync reelRef to it then.
  useEffect(() => {
    // Synonyms resolving mid-drag re-run this (cycle.synonyms changed). Don't reset reelRef under
    // the user's finger — that snapped the reel back and made the FIRST drag on a cold-cache word
    // (i.e. the original dark-purple word, whose synonyms aren't cached yet) feel dead, requiring a
    // second drag. While a drag is live, leave the reel alone.
    if (draggingRef.current && cycle) { setMoving(true); scheduleMovingOff(650); return }
    cancelAnim()
    velRef.current = 0
    engagedRef.current = false
    reelRef.current = cycle ? cycle.reelPos : 0
    targetRef.current = cycle ? Math.round(cycle.reelPos) : 0
    // Reveal the neighbour rows ONCE, only when the REAL synonyms land — so the writer can see
    // there are alternatives to scroll to. The flicker came from firing this on BOTH the placeholder
    // open (synonyms = [word,word,…], all identical) AND the real-synonym load: two reveal+fade
    // cycles read as a flash. The placeholder has no variety (Set size 1), so it's skipped; only the
    // real list (size > 1) lights the rows, then they linger and fade to the calm centre-only rest.
    if (cycle && new Set(cycle.synonyms).size > 1) { setMoving(true); scheduleMovingOff(900) }
    else if (!cycle) { if (movingTimerRef.current) clearTimeout(movingTimerRef.current); setMoving(false) }
  }, [cycle?.from, cycle?.synonyms]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return
    function onKeyDown(e: KeyboardEvent) {
      // Never intercept keys when a math field is active
      if (document.activeElement?.tagName === 'MATH-FIELD') return

      if (cycle) {
        // Don't intercept anything when any input/textarea has focus.
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); cancelAnim(); closeCycle(); return }
        // Alt+` / Alt+~ → insert the literal character (` and ~ are remapped to SCAS nav)
        if (e.altKey && (e.key === '`' || e.key === '~')) {
          e.preventDefault(); editor.commands.insertContent(e.key); return
        }
        // ` = prev synonym, ~ (shift+`) = next synonym
        if (e.key === '`') { e.preventDefault(); nudge(-1); return }
        if (e.key === '~') { e.preventDefault(); nudge(+1); return }
        if (e.key === ' ') {
          e.preventDefault()
          const sel = rafRef.current !== null ? targetRef.current : reelRef.current
          acceptSuggestion(cycle.synonyms[slotAt(sel)], true)
          return
        }
        if (e.key === 'Enter') { e.preventDefault(); return }
        e.preventDefault(); return
      }
      // ` = next red word, ~ = prev red word (mirrors synonym nav direction)
      // Alt+` / Alt+~ → insert the literal character instead
      if (e.key === '`' || e.key === '~') {
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
        if (e.altKey) { e.preventDefault(); editor.commands.insertContent(e.key); return }
        e.preventDefault()
        if (tabCursorRef.current === null) tabCursorRef.current = editor.state.selection.from
        const cur = editor.state.selection.from
        if (e.key === '~') {
          const reds = redWords()
          const t = reds.find(el => parseInt(el.dataset.para ?? '0', 10) === paragraphIndex && posOf(el, editor) >= cur)
               ?? reds.find(el => posOf(el, editor) > cur)
          if (t) openCycleForElement(t); else tabCursorRef.current = null
        } else {
          const prev = [...redWords()].reverse().find(el => posOf(el, editor) < cur)
          if (prev) openCycleForElement(prev); else tabCursorRef.current = null
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, cycle, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer / wheel input ─────────────────────────────────────────────────────
  // Subscribed once (deps: [editor]); reads live state via refs so the drag/wheel
  // accumulators survive the per-frame setCycle updates the animation fires.
  useEffect(() => {
    if (!editor) return
    const edEl = editor.view.dom

    const overTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (edEl.contains(el) || !!el.closest?.('.scas-cycle-card'))
    }

    // Trackpad/wheel reel-scrolling is DISABLED (per request): the reel is driven by press-drag and
    // the keyboard (j/k) only. Wheel events pass through, so the page scrolls normally (the popover
    // follows the word via the scroll handler). The physical wheel stays free for the anti-cheat gate.
    function onWheel() { /* no-op — trackpad/wheel reel scroll turned off */ }

    // Right-click with cycle open: accept the centred word + advance (same as Space).
    // Right-click on a committed slot with NO cycle: lock it in (normal colour, un-cyclable).
    function onContextMenu(e: MouseEvent) {
      if (cycleRef.current) {
        if (!overTarget(e.target)) return
        e.preventDefault()
        acceptLanded(reelRef.current, true)
        return
      }
      // No cycle — check for a committed (unlocked) slot under the cursor.
      const slotEl = (e.target as HTMLElement | null)
        ?.closest?.('[data-scas-slot]:not([data-scas-locked])') as HTMLElement | null
      if (!slotEl || !edEl.contains(slotEl)) return
      e.preventDefault()
      try {
        const from = editor.view.posAtDOM(slotEl, 0)
        const textLen = slotEl.textContent?.length ?? 0
        if (textLen === 0) return
        const to = from + textLen
        const { state } = editor
        // Find the existing scasSlot mark in this range.
        let existingAttrs: Record<string, unknown> | null = null
        state.doc.nodesBetween(from, to, node => {
          if (existingAttrs) return false
          const m = node.marks.find(mk => mk.type.name === 'scasSlot')
          if (m && !m.attrs.locked) { existingAttrs = m.attrs as Record<string, unknown> }
          return !existingAttrs
        })
        if (!existingAttrs) return
        const lockedAttrs = Object.assign({}, existingAttrs, { locked: true })
        const markType = state.schema.marks.scasSlot
        const newMark = markType.create(lockedAttrs)
        editor.view.dispatch(state.tr.addMark(from, to, newMark))
      } catch { /* posAtDOM can fail if element left the editor DOM between events */ }
    }

    // Select a word's range so it can be deleted — the only delete path now that the ⌫
    // slot is gone. Triggered by a double-tap (detected in onPointerUp; the browser never
    // fires a native dblclick because opening the cycle rebuilds the word's DOM node).
    function selectWordForDeletion(from: number, wordTo: number) {
      cancelAnim(); openedByPointerRef.current = false
      closeCycle(false, false)   // dismiss without committing or restoring a caret
      // The open-cycle effect put user-select:none on the editor; its async cleanup may
      // not have run yet, so restore it now or the programmatic selection won't render.
      edEl.style.userSelect = ''
      edEl.style.removeProperty('-webkit-user-select')
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.chain().focus().setTextSelection({ from, to: wordTo }).run()
      })
    }

    // Press + drag up/down spins the reel 1:1 with the pointer (one row-height = one
    // slot). Works for both mouse (button held) and touch (finger down) — we track
    // clientY deltas ourselves rather than movementY, which mobile browsers report
    // unreliably on touch pointers. Releasing flings with the gathered velocity and
    // the reel RESTS.
    //
    // Commit model: a STILL click (no scroll, any duration) commits the rested word. A press-and-
    // DRAG spins the reel; releasing a drag commits the landed word (or flings). Duration no longer
    // matters — only whether the pointer moved — so a slow deliberate tap still confirms.
    let lastY: number | null = null
    let lastT = 0
    let downX = 0, downY = 0
    let dragArmed = false   // only a press that STARTS on the word/reel may drag-scroll it
    let pointerIsDown = false  // OUR own down-tracking — touch/pen pointermove reports buttons:0 (a
                               // finger isn't a "button"), so we can't trust e.buttons there.
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0   // for manual double-tap detection
    let pushScheduled = false
    function schedulePush() {
      if (pushScheduled) return
      pushScheduled = true
      requestAnimationFrame(() => { pushScheduled = false; pushReel() })
    }
    function onPointerDown(e: PointerEvent) {
      pointerIsDown = true
      downX = e.clientX; downY = e.clientY
      lastY = null                                   // a drag begins on the first move
      // Arm the drag-to-scroll only if the press lands on the word or the reel — a drag that
      // begins on empty parchment / body text must NOT spin the reel.
      const el = e.target as HTMLElement | null
      if (e.pointerType === 'touch') {
        // PHONE: drag-to-scroll engages ONLY when a cycle is ALREADY open and the touch starts on
        // the open word/reel — both carry touch-action:none (index.css + inline card style), read
        // at gesture start, so the browser never contests the pan and the reel owns the gesture
        // outright (onTouchMove's preventDefault is the imperative half). A pan starting anywhere
        // else — including an UNOPENED red word — is native page scroll exclusively.
        dragArmed = !!cycleRef.current && !!el?.closest?.('.scas-cycle-card, .scas-focused')
      } else {
        // Mouse: arm if the press lands on the word/reel — OR if it just OPENED a cycle.
        // The opening press is, by definition, on a red word; but the capture-phase open handler
        // (which runs before this) rebuilds the DOM and applies compression, so a real hit-test can
        // resolve e.target to a sibling `.scas-comp-before/after` span (no matching class) →
        // dragArmed went false → the opening press couldn't scroll the reel. openedByPointerRef
        // (set by that handler) tells us this press opened a cycle, so arm it unconditionally.
        dragArmed = openedByPointerRef.current || !!el?.closest?.('.scas-red, .scas-cycle-card')
      }
    }
    function onPointerMove(e: PointerEvent) {
      // Mouse: trust e.buttons (catches button-released-without-pointerup). Touch/pen: that bit is
      // unreliably 0 during a drag, so use our own down-tracking instead — otherwise the FIRST
      // press-drag on a phone froze the reel (it reported buttons:0 and bailed every move).
      const held = e.pointerType === 'mouse' ? (e.buttons & 1) : pointerIsDown
      if (!held || !cycleRef.current || !dragArmed) { lastY = null; draggingRef.current = false; return }
      if (lastY === null) {                          // drag begins — grab any in-flight momentum
        cancelAnim()
        lastY = e.clientY; lastT = e.timeStamp; velRef.current = 0
        draggingRef.current = true; setMoving(true)   // held + steering: keep the marker lit
        return
      }
      // rowH is layout px; pointer travel is visual px — scale the row so a drag stays 1:1 with
      // the RENDERED row height under the transform-magnify (one visual row = one slot).
      const rowH = (rowHRef.current || 1) * scaleFor(edEl)
      const dPos = -(e.clientY - lastY) / rowH       // finger up → reel advances (k)
      lastY = e.clientY
      reelRef.current += dPos
      const dt = Math.max(1, e.timeStamp - lastT); lastT = e.timeStamp
      velRef.current = velRef.current * 0.6 + (dPos / dt) * 0.4   // smoothed slots/ms
      schedulePush()
    }
    // Commit the word the reel is resting on. Resting on the original (even un-scrolled) now
    // CONFIRMS it rather than dismissing — see commitLandedRest. Dismiss = Escape / Tab / outside tap.
    function commitRested() {
      const c = cycleRef.current; if (!c) return
      acceptRef.current(c.synonyms[slotAt(reelRef.current)], false)
    }
    function onPointerUp(e: PointerEvent) {
      pointerIsDown = false
      const wasDragging = lastY !== null
      lastY = null
      draggingRef.current = false
      if (wasDragging) scheduleMovingOff()   // released a drag: fade once the reel rests
      const opened = openedByPointerRef.current
      openedByPointerRef.current = false
      const c = cycleRef.current
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY)
      // A still release (no scroll) is a click → confirm, regardless of how long it was held. The
      // old `< TAP_MS` (250ms) gate meant a slow, deliberate tap fell through BOTH the tap and drag
      // branches and did nothing — so you had to nudge a pixel (which made it a drag) to commit.
      if (dist < TAP_PX) {
        // Double-tap (two quick taps near each other) on the open word selects it for
        // deletion. Detected manually — opening rebuilds the word node, so no native dblclick.
        if (c && e.timeStamp - lastTapTime < 320 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 16) {
          lastTapTime = 0
          selectWordForDeletion(c.from, c.to)
          return
        }
        lastTapTime = e.timeStamp; lastTapX = e.clientX; lastTapY = e.clientY
        if (!c) return
        const el = e.target as HTMLElement | null
        const onCard = !!el?.closest?.('.scas-cycle-card')
        if (opened) {
          // Touch (phone model): the tap that OPENED the cycle leaves it open — browsing is a new
          // drag on the word/reel; confirming is a tap on it; dismissing is a tap outside.
          if (e.pointerType === 'touch') return
          // Mouse: the press that OPENED this cycle, released with no drag, commits the centred
          // (original) word — a single click "snaps it back". (To pick a synonym you
          // press-hold-drag-release.)
          cancelAnim(); commitRested(); return
        }
        if (!onCard && el?.closest?.('.scas-red')) return   // tapped another red word — the open handler dealt with it
        cancelAnim()
        if (onCard) commitRested()                          // tap on the reel/word → confirm (even un-scrolled)
        else closeCycle()                                   // tap on empty space / body → dismiss
        return
      }
      if (wasDragging && c) {
        // Release → commit the nearest slot. acceptSuggestion is the central clock: its EVENT 2
        // rolls the reel back to centre (the only thing that moves on release), then EVENT 3 fires
        // a fixed time later. (No separate pre-settle/fling — that double-timed the commit.)
        cancelAnim()
        acceptRef.current(c.synonyms[slotAt(Math.round(reelRef.current))], false)
      }
    }
    function onPointerCancel() {
      pointerIsDown = false
      const wasDragging = lastY !== null
      lastY = null; draggingRef.current = false
      if (wasDragging) { fling(velRef.current); scheduleMovingOff() }
    }
    // Suppress text-selection (highlighting) anywhere while a cycle is open — e.g. a
    // second press-and-drag away from the word would otherwise select editor text.
    function onSelectStart(e: Event) { if (cycleRef.current) e.preventDefault() }
    // Keep a touch drag from scrolling the document while it's steering the reel.
    function onTouchMove(e: TouchEvent) { if (lastY !== null) e.preventDefault() }

    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('selectstart', onSelectStart)
    return () => {
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('selectstart', onSelectStart)
    }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // While a cycle is open, suppress text-selection on the editor. NOTE (phone model, 2026-07-09):
  // the old blanket `touch-action: none` on the whole editor is GONE — it froze page scrolling
  // everywhere while a popup was open (and, being applied after the opening gesture had started,
  // never governed that gesture anyway). Reel exclusivity now lives on the elements themselves:
  // .scas-focused (index.css) and the reel card (inline style) carry touch-action:none, which the
  // browser reads at gesture start — so a drag beginning there can never become a page pan, while
  // a pan beginning anywhere else scrolls natively. overscroll-behavior:none on the root scroller
  // while open stops any leaked pan from rubber-banding / bouncing mid-cycle.
  useEffect(() => {
    if (!cycle || !editor) return
    const el = editor.view.dom as HTMLElement
    const prevSelect = el.style.userSelect
    el.style.userSelect = 'none'
    el.style.setProperty('-webkit-user-select', 'none')
    const root = document.documentElement, body = document.body
    const prevRootOB = root.style.overscrollBehavior
    const prevBodyOB = body.style.overscrollBehavior
    root.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'
    return () => {
      el.style.userSelect = prevSelect
      el.style.removeProperty('-webkit-user-select')
      root.style.overscrollBehavior = prevRootOB
      body.style.overscrollBehavior = prevBodyOB
    }
  }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-measure geometry on scroll/resize — and on magnify changes (the paper's transform scale
  // moves every rect the memo reads; the re-render lands after Scroll's subscriber applied it).
  useEffect(() => {
    if (!cycle) return
    const bump = () => setGeomNonce(n => n + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    const unsubMagnify = subscribeMagnify(bump)
    return () => { window.removeEventListener('resize', bump); window.removeEventListener('scroll', bump, true); unsubMagnify() }
  }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Geometry (memoised — depends on the focused word, NOT the reel position) ──

  const geom = useMemo(() => {
    if (!cycle) return null
    const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
    const cRect     = containerEl.current?.getBoundingClientRect()
    if (!focusedEl || !cRect) return null

    const rect = focusedEl.getBoundingClientRect()
    const cs   = window.getComputedStyle(focusedEl)
    const fsz  = parseFloat(cs.fontSize) || 18
    // The card renders INSIDE the (possibly transform-magnified) paper: its inline left/top/width
    // are LAYOUT px, while the rects read here are VISUAL px. Unscale every rect DIFFERENCE
    // (magnify.ts) so card coords, canvas text widths (layout px) and fsz all share one space.
    const s = scaleFor(focusedEl)

    // EXIT-STATIONARY reel. Each synonym renders with its LEFT edge at the word's natural x —
    // exactly where it lands when committed (the text before it is unchanged), so the chosen
    // word doesn't jump on exit. A synonym wide enough to cross the writing-space edge is
    // shifted left ONLY as far as needed to stay inside it (such a word reflows to the next
    // line on commit anyway, so that residual offset is unavoidable — and kept minimal).
    const font         = getFont(focusedEl)
    const naturalLeftC = unscale(cycle.naturalLeft - cRect.left, s)
    // The reserved box IS the focused word's expanded rect; the after-text begins at its right
    // edge, so reel words must stay within [boxLeft, boxRight] or they paint over the text. We use
    // the LIVE rendered rect directly (single coordinate source). The open layout is applied
    // instantly, so there's no half-grown box to outrun — the old MODEL-box / `settled` swap only
    // existed for a CSS-transition grow that the default path never ran, and switching model→live
    // ~150ms after every open was itself a guaranteed horizontal pop (audit F1/F4). Gone now.
    const boxLeftC  = unscale(rect.left  - cRect.left, s)
    const boxRightC = unscale(rect.right - cRect.left, s)
    const widths    = cycle.synonyms.map(s => measureTextWidth(s, font))
    const DOT_PAD   = 8   // room left of the word for the origin ink-blot
    const left      = boxLeftC - DOT_PAD
    // Card is wide enough to hold any synonym at its committed natural-x (where it slides to on
    // commit), so the slide-home tail is never clipped — without needing overflow:visible (which
    // would leak the faded neighbour rows and flash). Card stays transparent + overflow:hidden.
    const cardW     = Math.max(boxRightC - left, (naturalLeftC - left) + Math.max(...widths) + DOT_PAD)
    // Per-slot left within the card: natural x, clamped to the box (never past its right edge,
    // never left of its left edge).
    const slotLefts = widths.map(w =>
      Math.max(boxLeftC, Math.min(naturalLeftC, boxRightC - w)) - left,
    )

    const textNode = focusedEl.firstChild
    let textMid: number
    if (textNode?.nodeType === Node.TEXT_NODE) {
      const rng = document.createRange(); rng.selectNodeContents(textNode)
      const tr  = rng.getBoundingClientRect()
      textMid   = unscale(tr.top - cRect.top + tr.height / 2, s)
    } else {
      textMid = unscale(rect.top - cRect.top + rect.height / 2, s)
    }

    const rowH  = Math.round(fsz * 1.15)
    const cardH = rowH * 3                    // prev / current / next visible at once
    return {
      fsz, left, rowH, cardH, slotLefts,
      naturalInCard: naturalLeftC - left,     // the word's committed x, in card coords (slide target)
      cardTop: textMid - cardH / 2,           // current row centred on the focused word
      width: cardW,
      fontFamily: cs.fontFamily,
    }
  }, [cycle?.from, cycle?.minWidth, cycle?.synonyms, geomNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  // Fading neighbour ghosts — rendered even after the reel (cycle) tears down on commit.
  const ghostEls = ghosts ? ghosts.map((g, i) => (
    <div key={i} className="absolute scas-reel-ghost"
      style={{ top: g.top, left: g.left, height: g.rowH, display: 'flex', alignItems: 'center',
               fontFamily: g.fontFamily, fontSize: g.fontSize,
               color: g.color, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 40 }}>
      {g.text}
    </div>
  )) : null

  if (!cycle || !geom) return <>{ghostEls}</>
  rowHRef.current = geom.rowH
  const { fsz, left, rowH, cardH, cardTop, width, fontFamily, slotLefts } = geom
  const reel   = cycle.reelPos
  const mobile = window.innerWidth < 768 ? 1.4 : 1
  // Overlay mode (touch): the word isn't expanded, so size the opaque card to the widest
  // synonym (minWidth) and give it the paper colour so it masks the text it floats over.
  const cardWidth = cycle.overlay ? Math.ceil(cycle.minWidth) : width
  const cardBg    = cycle.overlay ? '#f7f2e8' : 'transparent'

  // Continuous windowed reel: render a band of rings around the live position, each
  // placed by its real distance from centre so the whole strip glides as reel moves.
  // Keys are absolute ring indices, so a word keeps its DOM node as it crosses the
  // centre; rows only mount/unmount at the faded edges (invisible). WINDOW=3 keeps the
  // 3-row card filled plus a fade margin, so a fast spin never shows white.
  const WINDOW = 3
  const base = Math.round(reel)
  // On commit the WHOLE reel eases onto the integer grid (chosen word → centre): every row gets
  // this same vertical shift, so the words above and below glide WITH the chosen word instead of
  // hanging at their offset and blinking out. (reel-base) is the fraction to absorb; for the centre
  // row it equals -rel, so the chosen word lands exactly on the text line.
  const reelSettle = (reel - base) * rowH
  const rows: React.ReactNode[] = []
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const ring    = base + d
    const slotIdx = ((ring % CYCLE_SIZE) + CYCLE_SIZE) % CYCLE_SIZE
    const word    = cycle.synonyms[slotIdx]
    const rel     = ring - reel                       // continuous offset from centre, in rows
    const a       = Math.abs(rel)
    const isOrig  = word === cycle.synonyms[0]   // the original (dark); candidates are the lighter purple
    // The card is transparent and 3 rows tall, so at rest the peeking prev/next synonyms
    // bleed onto the text lines above and below (no background to mask them). So reveal the
    // neighbours ONLY while the reel is in motion: at rest just the centre word shows, in
    // place — calm, no bleed, nothing for the eye to read as movement. `reveal` collapses to
    // the centre row (a≈0) when still; the fade-out is transitioned (see row style) so the
    // ghosts settle softly, while motion keeps the per-frame opacity crisp (transition off).
    const reveal  = moving ? 1 : Math.max(0, 1 - a * 2.4)
    const opacity = Math.max(0, Math.min(1, 1.22 - a * 0.6)) * reveal
    rows.push(
      <div key={ring}
        style={{
          position: 'absolute', left: 0, right: 0, height: rowH,
          top: (cardH - rowH) / 2,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
          // No overflow:hidden here — the row box is only rowH tall (≈1.15em), so clipping it cut
          // the descenders (g/p/y) off the centre word. The CARD's overflow:hidden still bounds the
          // 3-row band; the centre row sits inside it, so its glyphs now show in full.
          whiteSpace: 'nowrap', cursor: 'pointer',
          fontSize: fsz,
          // Move via translateY only (compositor-only). No scale: scaling centred text
          // shifts its edges ~1px as the row's distance-from-centre wobbles, which reads
          // as a left/right jiggle while scrolling. Depth comes from the opacity fade.
          transform: `translateY(${(rel * rowH).toFixed(2)}px)`,
          // Promote to a compositor layer ONLY while the reel is actually moving (drag or settle).
          // Unconditional will-change created 7 layers the instant the card mounted — a GPU hitch on
          // open (the intermittent "frame drop on first click"). At rest/open the rows are static.
          willChange: (draggingRef.current || rafRef.current !== null) ? 'transform' : undefined,
          // Original word dark, secondary/candidate words the lighter purple — a committed
          // secondary word KEEPS this lighter colour (the page text matches it, see
          // .scas-secondary), so the colour never changes between reel, commit and page.
          color: isOrig ? '#9b5ccc' : '#6f3b9e',   // original = lighter; candidate synonyms = mid purple
          // On commit keep the chosen word opaque and fade the neighbours to 0 over the glide, so
          // they ease away in step with the reel settling rather than vanishing with the card.
          opacity: committing ? (ring === base ? 1 : 0) : opacity,
          // Only a continuous DRAG needs the crisp per-frame opacity (transition off, or it smears
          // the scrolling fade). A keyboard glide or the settle-to-rest should ease in/out — so the
          // neighbour rows fade rather than snap, killing the rapid-cycle strobe.
          transition: committing ? `opacity ${REFLOW_COMMIT_MS}ms ${REFLOW_EASE}` : (draggingRef.current ? 'none' : 'opacity 140ms ease'),
          WebkitTapHighlightColor: 'transparent',
        }}>
        {/* Left-align the word at its clamped natural-x offset within the card, so what's
            shown is exactly where it commits (no jump on exit). On COMMIT, slide it from there to
            its committed natural-x (translateX) over the same 240ms as the de-compression, so the
            word travels home WITH the surrounding text instead of snapping after it. The committed
            row (ring === base) ALSO glides vertically to the text line (translateY): if the reel
            was resting between slots, the chosen word eases onto the baseline instead of snapping. */}
        <span style={{ display: 'inline-block', whiteSpace: 'nowrap', marginLeft: `${slotLefts[slotIdx]}px`,
                       transform: committing
                         ? `translate(${(ring === base ? geom.naturalInCard - slotLefts[slotIdx] : 0).toFixed(2)}px, ${reelSettle.toFixed(2)}px)`
                         : 'none',
                       transition: committing ? `transform ${REFLOW_COMMIT_MS}ms ${REFLOW_EASE}` : 'none' }}>
        {displayFor(word, mobile)}
        </span>
      </div>,
    )
  }

  return (
    <>
      {ghostEls}
      {/* Sliding reel card — fully transparent: no border/shadow/background, so the
          word floats directly on the parchment (lines above/below may show through).
          NB: do NOT put a transform on this card to "snap" sub-pixel position — promoting it to a
          GPU layer disables subpixel-antialiasing on the reel text (visible colour/weight shift)
          and nudges horizontal sub-pixel position. Keep it a plain absolutely-positioned box. */}
      <div className="absolute z-50 select-none scas-cycle-card"
        style={{ top: cardTop, left, width: cardWidth, height: cardH, boxSizing: 'border-box',
                 fontFamily, fontSize: fsz, overflow: 'hidden',
                 // Reel exclusivity (phone): a touch STARTING on the card belongs to the reel —
                 // touch-action is read at gesture start, so the browser never begins a page pan
                 // (and never rubber-bands) from here. Beats the phone universal pan-x pan-y rule.
                 touchAction: 'none', overscrollBehavior: 'none',
                 background: cardBg, WebkitTapHighlightColor: 'transparent' }}>
        {rows}
      </div>
    </>
  )
}
