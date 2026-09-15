// ─── Toolbar slot customisation ───
// ⚠ The population, the row size, the migration and the bar-layer exclusion live ONLY in
// `editor/toolbarContract.ts` and are never re-declared here. Register a button by adding a member
// to `SlotId` + `ALL_SLOTS` there and the row, the ▲ overflow, drag-to-swap and migration follow.
//
// WHAT THIS FILE IS (2026-09-15, docs/REFACTOR-QUEUE.md item 3, seam 1): the writer's arrangement of
// the footer toolbar's slot row — which six circles it holds and in what order, the ▲ drawer that
// holds the rest, every way the writer rearranges it (desktop HTML5 drag, phone touch-hold reorder,
// touch-hold drag from the ▲ drop-up onto the row), the write-back to the document and to the
// writer's own default, and the POSITIONAL hotkeys that address that row by index. Moved VERBATIM
// out of TiptapEditor.tsx; the circles themselves (the footer JSX) stay there, and
// `toolbarSlotsWiring.test.ts` pins that they still attach what this hook hands back
// (`slotElsRef` by row index, `toolbarPickerRef` on the ▲, the touch handlers, the click swallow).
// Behaviour is pinned in `useToolbarSlots.test.tsx`; the in-browser truth is `scripts/toolbar.prove.mjs`.
//
// ⚠ EFFECT ORDER (docs/RULES.md R7). React runs a component's effects in declaration order, and a
// hook's effects run at the hook's CALL position. TiptapEditor calls this hook at exactly the
// position the block occupied, so its three effects keep their place in the component's effect
// sequence. Do not move the call.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, type TouchEvent as ReactTouchEvent } from 'react'
import type { InkwaveDocument } from '../types/document'
import { isTouchDevice } from './isTouchDevice'
import { moveSlot, nearestSlot, brokeHoldSlop } from './toolbarSlots'
import {
  SlotId, readStoredRow, saveStoredRow, slotIndexForDigit,
  readToolbarConfig, resolveToolbarRow, mayPersistConfig, mergeRowIntoConfig,
} from './toolbarContract'

export interface ToolbarSlotsInput {
  /** The component's live document mirror — read for the config, never written here. */
  docRef: MutableRefObject<InkwaveDocument>
  /** THE ONE COMMIT PATH (commitDoc.test.ts): the rearranged layout reaches the disk through it. */
  commitDoc: (updated: InkwaveDocument) => void
}

/** The row circle being dragged and the slot it hovers; neighbours read their FLIP shift from it. */
export interface SlotDragView { fromIdx: number; overIdx: number; step: number }

export interface SlotTouchHandlers {
  onTouchStart: (e: ReactTouchEvent) => void
  onTouchMove: (e: ReactTouchEvent) => void
  onTouchEnd: () => void
  onTouchCancel: () => void
}

export interface ToolbarSlots {
  /** The row, in the writer's order — exactly the array the footer renders. */
  toolbarSlots: SlotId[]
  /** The ONE write path: state + the writer's stored default + the document's config. */
  updateSlots: (newSlots: SlotId[]) => void
  toolbarPickerOpen: boolean
  setToolbarPickerOpen: Dispatch<SetStateAction<boolean>>
  /** The ▲ wrapper. Alt+0 clicks its FIRST button; the outside-mousedown close tests containment. */
  toolbarPickerRef: RefObject<HTMLDivElement>
  /** Each row circle's wrapper, BY ROW INDEX — how Alt+N finds the Nth circle. */
  slotElsRef: MutableRefObject<(HTMLDivElement | null)[]>
  /** The desktop HTML5 drag source, row circle or ▲ entry. */
  dragIdRef: MutableRefObject<SlotId | null>
  /** Clicks before this instant were synthesised by a just-finished touch-hold drag: swallow them. */
  suppressSlotClickUntilRef: MutableRefObject<number>
  /** Alt has been held alone for ALT_HINT_DELAY_MS — wear the positional hints (desktop only). */
  altHeld: boolean
  slotDragView: SlotDragView | null
  slotTouchHandlers: (slotIdx: number) => SlotTouchHandlers
  popupDragTarget: number | null
  popupDragActive: boolean
  popupTouchHandlers: (id: SlotId) => SlotTouchHandlers
}

export function useToolbarSlots({ docRef, commitDoc }: ToolbarSlotsInput): ToolbarSlots {
  // Toolbar customisation slots
  // THE LAYOUT FOLLOWS THE DOCUMENT (Peter, 2026-07-17). The chain — doc config → this writer's own
  // last layout → the first-run six — is `resolveToolbarRow`; it is not re-decided here.
  const toolbarRead = readToolbarConfig(docRef.current.toolbar)
  const [toolbarSlots, setToolbarSlots] = useState<SlotId[]>(
    () => resolveToolbarRow(toolbarRead, readStoredRow()),
  )
  const [toolbarPickerOpen, setToolbarPickerOpen] = useState(false)
  const toolbarPickerRef = useRef<HTMLDivElement>(null)

  function updateSlots(newSlots: SlotId[]) {
    setToolbarSlots(newSlots)
    // TWO writes, two meanings. The document keeps this layout (open the score again, get the
    // score's tools); the writer's own storage becomes the default their NEXT new document
    // inherits, so curating once is not a chore they repeat per file.
    saveStoredRow(newSlots)
    // ...but NEVER write back over a config we merely failed to parse. That read-failure-causes-
    // write shape is 15 July in miniature — the day a null-for-broken read minted a blank document
    // over real thesis annotations. A broken toolbar loses less, but the shape is the bug.
    if (!mayPersistConfig(toolbarRead)) return
    const updated = {
      ...docRef.current,
      // mergeRowIntoConfig, not the raw row: `newSlots` can only name buttons THIS build draws, so
      // writing it verbatim would delete a flagged-off slot from the author's document on the first
      // drag — the loss carryToolbarConfig refuses at both ends, walking in through the middle.
      toolbar: mergeRowIntoConfig(docRef.current.toolbar, newSlots),
      updatedAt: new Date().toISOString(),
    }
    commitDoc(updated)
  }

  const toolbarSlotsRef = useRef<SlotId[]>(toolbarSlots)
  useEffect(() => { toolbarSlotsRef.current = toolbarSlots }, [toolbarSlots])

  const dragIdRef = useRef<SlotId | null>(null)

  // ─── Phone: touch-hold drag-to-reorder for the row's slot circles ──────────
  // HTML5 drag events never fire from touch here (the iOS long-press guards swallow the native
  // gestures), so this is hand-rolled: hold ~400ms → arm → drag → FLIP-slide preview → commit.
  // It coexists with the guards, and each slot wrapper needs its OWN `touch-action: none`.
  // → docs/archive/editor-surface.md#editor-slot-drag
  const HOLD_MS = 400
  const slotElsRef = useRef<(HTMLDivElement | null)[]>([])

  // ─── Hotkeys: Alt+1…6 = the row, Alt+0 = the ▲ drawer, Mod+, = Settings ────
  // ⚠ THE HOTKEY IS THE TAP: it dispatches the slot's OWN button click, never a registered action.
  // Every slot owns its open state privately, so an action registry would be a SECOND way to
  // trigger each one — two roads that drift the first time a slot changes what its tap does (R2).
  // `altHeld` flips only on Alt's own down/up, and the ref guard stops key-repeat setting state
  // 30×/second. → docs/archive/editor-surface.md#editor-hotkey-tap
  const [altHeld, setAltHeld] = useState(false)
  const altHeldRef = useRef(false)
  const altArmRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isTouchDevice()) return   // no Alt on a phone; render no hints and bind nothing
    const setAlt = (v: boolean) => {
      if (altHeldRef.current === v) return
      altHeldRef.current = v
      setAltHeld(v)
    }
    // ⚠ THE HINTS MUST NOT REACT TO A SHORTCUT IN PROGRESS. Alt is a MODIFIER before it is a hint
    // trigger (⌥⌫ is delete-word-left), so showing badges on its keydown re-rendered this whole
    // tree BETWEEN the modifier and the key it modifies. The hint waits for a DELIBERATE hold, and
    // any other key cancels it — which is exactly what a chord is. Alt+digit still works instantly
    // either way, because the hotkey handler never consults `altHeld`.
    // → docs/archive/editor-surface.md#editor-alt-hints
    const ALT_HINT_DELAY_MS = 400
    const cancelArm = () => { if (altArmRef.current) { clearTimeout(altArmRef.current); altArmRef.current = null } }
    const armHint = () => {
      if (altHeldRef.current || altArmRef.current) return   // already shown, or already waiting
      altArmRef.current = setTimeout(() => { altArmRef.current = null; setAlt(true) }, ALT_HINT_DELAY_MS)
    }
    const dropHint = () => { cancelArm(); setAlt(false) }
    const clickSlot = (el: HTMLElement | null | undefined) => {
      const btn = el?.querySelector('button')
      if (btn) { btn.click(); return true }
      return false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Alt PRESSED BY ITSELF starts the hold timer; Alt as part of a chord cancels it outright.
      if (e.key === 'Alt') armHint()
      else if (altArmRef.current || altHeldRef.current) dropHint()
      // ⌘,/Ctrl, — the idiomatic preferences key on macOS, and unbound in browsers elsewhere.
      if ((e.metaKey || e.ctrlKey) && e.key === ',' && !e.altKey) {
        const idx = toolbarSlotsRef.current.indexOf('settings')
        // Settings may live in the ▲ drawer; its button is still in the DOM there, so the
        // shortcut works from either home. That is the point of one population.
        const el = idx >= 0 ? slotElsRef.current[idx] : document.querySelector<HTMLElement>('.iw-slot [title="Settings"]')?.parentElement
        if (clickSlot(el ?? undefined)) e.preventDefault()
        return
      }
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      if (e.key === '0') {
        const btn = toolbarPickerRef.current?.querySelector('button')
        if (btn) { e.preventDefault(); btn.click() }
        return
      }
      const idx = slotIndexForDigit(e.key)
      if (idx === null) return
      if (clickSlot(slotElsRef.current[idx])) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => { if (!e.altKey) dropHint() }
    // Alt+Tab away with Alt down and the keyup never arrives — the hints would latch on forever.
    const onBlur = () => dropHint()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      cancelArm() // a pending hold timer must not fire into an unmounted tree
    }
  }, [])
  const slotDragRef = useRef<{
    fromIdx: number
    startX: number
    startY: number
    centers: number[]
    step: number
    armed: boolean
    dropping: boolean
    moved: boolean
    timer: number
    overIdx: number
  } | null>(null)
  // Render-side mirror: neighbours read their preview shift from this (null = no drag).
  const [slotDragView, setSlotDragView] = useState<{ fromIdx: number; overIdx: number; step: number } | null>(null)
  const suppressSlotClickUntilRef = useRef(0)

  const slotDragStyle = (el: HTMLDivElement | null, t: string, transition: string) => {
    if (!el) return
    el.style.transition = transition
    el.style.transform = t
  }
  const armSlotDrag = () => {
    const st = slotDragRef.current
    if (!st) return
    const els = slotElsRef.current
    const rects = toolbarSlots.map((_, j) => els[j]?.getBoundingClientRect())
    if (rects.some(r => !r)) { slotDragRef.current = null; return }
    st.centers = rects.map(r => r!.left + r!.width / 2)
    st.step = st.centers.length > 1 ? st.centers[1] - st.centers[0] : 0
    st.armed = true
    const el = els[st.fromIdx]
    if (el) {
      el.style.zIndex = '30'
      el.style.position = 'relative'
      slotDragStyle(el, 'scale(1.18)', 'transform 120ms ease') // the arm pulse
    }
    setSlotDragView({ fromIdx: st.fromIdx, overIdx: st.fromIdx, step: st.step })
  }
  const endSlotDrag = (commit: boolean) => {
    const st = slotDragRef.current
    if (!st) return
    clearTimeout(st.timer)
    if (!st.armed || st.dropping) { if (!st.armed) slotDragRef.current = null; return }
    st.dropping = true
    suppressSlotClickUntilRef.current = Date.now() + 400
    const el = slotElsRef.current[st.fromIdx]
    const { fromIdx, overIdx, centers } = st
    const finish = () => {
      if (slotDragRef.current !== st) return
      slotDragRef.current = null
      // Clear the imperative styles IN THE SAME COMMIT as the reorder: the element lands at
      // its new layout slot exactly where the drop animation left it — no flash.
      if (el) { el.style.transform = ''; el.style.transition = ''; el.style.zIndex = ''; el.style.position = '' }
      setSlotDragView(null)
      if (commit && overIdx !== fromIdx) {
        updateSlots(moveSlot(toolbarSlots, fromIdx, overIdx))
      }
    }
    if (el && commit) {
      // Drop animation: glide from the finger to the target slot's centre, then commit.
      slotDragStyle(el, `translateX(${centers[overIdx] - centers[fromIdx]}px) scale(1)`, 'transform 150ms ease')
      window.setTimeout(finish, 160)
    } else {
      if (el) slotDragStyle(el, '', 'transform 150ms ease')
      window.setTimeout(finish, 160)
    }
  }
  const slotTouchHandlers = (slotIdx: number) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1 || slotDragRef.current) return
      const t = e.touches[0]
      slotDragRef.current = {
        fromIdx: slotIdx,
        startX: t.clientX,
        startY: t.clientY,
        centers: [],
        step: 0,
        armed: false,
        dropping: false,
        moved: false,
        timer: window.setTimeout(armSlotDrag, HOLD_MS),
        overIdx: slotIdx,
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      const st = slotDragRef.current
      if (!st || st.dropping) return
      const t = e.touches[0]
      const dx = t.clientX - st.startX
      const dy = t.clientY - st.startY
      if (!st.armed) {
        // A real drag begins with stillness — movement before the hold elapses is a tap/slide.
        // Same rule as the drop-up drag below; see `brokeHoldSlop`.
        if (brokeHoldSlop(dx, dy)) { clearTimeout(st.timer); slotDragRef.current = null }
        return
      }
      st.moved = true
      const el = slotElsRef.current[st.fromIdx]
      // Follow the finger raw (no transition while tracking — the pulse transition ends itself).
      slotDragStyle(el, `translateX(${dx}px) scale(1.18)`, st.moved ? 'none' : 'transform 120ms ease')
      const over = nearestSlot(st.centers, st.centers[st.fromIdx] + dx)
      if (over !== st.overIdx) {
        st.overIdx = over
        setSlotDragView({ fromIdx: st.fromIdx, overIdx: over, step: st.step })
      }
    },
    onTouchEnd: () => endSlotDrag(true),
    onTouchCancel: () => endSlotDrag(false),
  })

  // ─── Phone: touch-hold drag FROM the ▲ drop-up ONTO a row slot ─────────────
  // The overflow entries are the same population as the row circles — hold one (same 400ms
  // arm + pulse), drag it down over the row, the hovered slot shrinks/dims (it will be
  // displaced back into the ▲ pool), release to swap. 2D follow (popup sits above the row).
  const popupDragRef = useRef<{
    id: SlotId
    el: HTMLElement
    startX: number
    startY: number
    slotRects: DOMRect[]
    armed: boolean
    dropping: boolean
    timer: number
    targetIdx: number | null
  } | null>(null)
  const [popupDragTarget, setPopupDragTarget] = useState<number | null>(null)
  const armPopupDrag = () => {
    const st = popupDragRef.current
    if (!st) return
    const rects = toolbarSlots.map((_, j) => slotElsRef.current[j]?.getBoundingClientRect())
    if (rects.some(r => !r)) { popupDragRef.current = null; return }
    st.slotRects = rects as DOMRect[]
    st.armed = true
    st.el.style.zIndex = '40'
    st.el.style.position = 'relative'
    slotDragStyle(st.el as HTMLDivElement, 'scale(1.18)', 'transform 120ms ease')
    setPopupDragActive(true)
  }
  const endPopupDrag = (commit: boolean) => {
    const st = popupDragRef.current
    if (!st) return
    clearTimeout(st.timer)
    if (!st.armed || st.dropping) { if (!st.armed) popupDragRef.current = null; return }
    st.dropping = true
    suppressSlotClickUntilRef.current = Date.now() + 400
    popupDragRef.current = null
    st.el.style.transform = ''
    st.el.style.transition = ''
    st.el.style.zIndex = ''
    st.el.style.position = ''
    setPopupDragTarget(null)
    setPopupDragActive(false)
    if (commit && st.targetIdx != null) {
      // Swap: the popup entry takes the hovered slot; the displaced circle returns to the
      // ▲ pool (it's simply no longer in the slots array). Same semantics as desktop's
      // popup→row HTML5 drop.
      const next = [...toolbarSlots]
      next[st.targetIdx] = st.id
      updateSlots(next)
      setToolbarPickerOpen(false)
    }
  }
  const [popupDragActive, setPopupDragActive] = useState(false)
  const popupTouchHandlers = (id: SlotId) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1 || popupDragRef.current || slotDragRef.current) return
      const t = e.touches[0]
      const el = e.currentTarget as HTMLElement
      popupDragRef.current = {
        id, el,
        startX: t.clientX,
        startY: t.clientY,
        slotRects: [],
        armed: false,
        dropping: false,
        timer: window.setTimeout(armPopupDrag, HOLD_MS),
        targetIdx: null,
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      const st = popupDragRef.current
      if (!st || st.dropping) return
      const t = e.touches[0]
      const dx = t.clientX - st.startX
      const dy = t.clientY - st.startY
      if (!st.armed) {
        if (brokeHoldSlop(dx, dy)) { clearTimeout(st.timer); popupDragRef.current = null }
        return
      }
      slotDragStyle(st.el as HTMLDivElement, `translate(${dx}px, ${dy}px) scale(1.18)`, 'none')
      // Hit-test the FINGER against the row slots (rects inflated 8px — forgiving targets).
      let target: number | null = null
      for (let j = 0; j < st.slotRects.length; j++) {
        const r = st.slotRects[j]
        if (t.clientX >= r.left - 8 && t.clientX <= r.right + 8 && t.clientY >= r.top - 8 && t.clientY <= r.bottom + 8) { target = j; break }
      }
      if (target !== st.targetIdx) {
        st.targetIdx = target
        setPopupDragTarget(target)
      }
    },
    onTouchEnd: () => endPopupDrag(true),
    onTouchCancel: () => endPopupDrag(false),
  })
  // ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!toolbarPickerOpen) return
    function closeOnOutside(e: MouseEvent) {
      if (toolbarPickerRef.current && !toolbarPickerRef.current.contains(e.target as Node)) {
        setToolbarPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [toolbarPickerOpen])

  return {
    toolbarSlots, updateSlots, toolbarPickerOpen, setToolbarPickerOpen, toolbarPickerRef,
    slotElsRef, dragIdRef, suppressSlotClickUntilRef, altHeld, slotDragView, slotTouchHandlers,
    popupDragTarget, popupDragActive, popupTouchHandlers,
  }
}
