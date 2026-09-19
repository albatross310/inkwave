import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import {
  newWorkspaceGesture,
  pushWorkspaceGesture,
  workspaceSwipeRelease,
  workspaceSwipeSettleX,
  workspaceSwipeVisualX,
  type WorkspaceGestureState,
} from '../workspace/gesture'
import { workspacePanelIdFromHistory } from '../workspace/history'
import type { WorkspaceDirection } from '../workspace/sequence'
import { capturePaintedWorkspacePreview, mountPaintedWorkspacePreview } from '../workspace/paintedPreview'
import { captureWorkspaceViewState } from '../workspace/viewState'
import { publishWorkspaceWaterMotion, readWorkspaceWaterMotion } from '../workspace/waterMotion'

const WHEEL_IDLE_MS = 90
const SWIPE_PREVIEW_CHARS = 12_000
const SWIPE_WAVE_GAIN = 0.06 // exactly the vertical-scroll water displacement ratio

function textOf(node: TiptapJSON | undefined): string {
  if (!node) return ''
  const own = typeof node.text === 'string' ? node.text : ''
  const children = Array.isArray(node.content) ? node.content.map(textOf).join('') : ''
  const blockEnd = node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem'
  return `${own}${children}${blockEnd ? '\n' : ''}`
}

const tidyPreviewText = (content: TiptapJSON) => textOf(content).replace(/\n{3,}/g, '\n\n').trim()

export function workspacePreviewText(doc: InkwaveDocument): string {
  return tidyPreviewText(doc.contentJson)
}

/** Bound the static neighbour to a few pages so a huge document cannot double the live DOM. */
export function workspacePreviewJson(doc: TiptapJSON, maxChars = SWIPE_PREVIEW_CHARS): TiptapJSON {
  let remaining = Math.max(0, maxChars)
  const visit = (node: TiptapJSON, root = false): TiptapJSON | null => {
    const out: TiptapJSON = {}
    if (node.type) out.type = node.type
    if (node.attrs) out.attrs = node.attrs
    if (node.marks) out.marks = node.marks
    if (typeof node.text === 'string') {
      if (remaining <= 0) return null
      out.text = node.text.slice(0, remaining)
      remaining -= out.text.length
      return out
    }
    // Atom nodes cost one unit. Keeping early media/citations makes the preview resemble its page
    // while the same budget still bounds prose.
    if (!node.content?.length) {
      if (!root && remaining <= 0) return null
      if (!root) remaining -= 1
      return out
    }
    const content: TiptapJSON[] = []
    for (const child of node.content) {
      const kept = visit(child)
      if (kept) content.push(kept)
      if (remaining <= 0) break
    }
    if (content.length) out.content = content
    return root || content.length ? out : null
  }
  return visit(doc, true) ?? { type: 'doc', content: [] }
}

function previewMarks(content: ReactNode, marks: TiptapJSON['marks']): ReactNode {
  let rendered = content
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') rendered = <strong>{rendered}</strong>
    else if (mark.type === 'italic') rendered = <em>{rendered}</em>
    else if (mark.type === 'underline') rendered = <u>{rendered}</u>
    else if (mark.type === 'strike') rendered = <s>{rendered}</s>
    else if (mark.type === 'code') rendered = <code>{rendered}</code>
    else if (mark.type === 'textStyle') {
      const attrs = mark.attrs ?? {}
      rendered = <span style={{
        fontFamily: typeof attrs.fontFamily === 'string' ? attrs.fontFamily : undefined,
        fontSize: typeof attrs.fontSize === 'string' ? attrs.fontSize : undefined,
        color: typeof attrs.color === 'string' ? attrs.color : undefined,
      }}>{rendered}</span>
    }
  }
  return rendered
}

function previewInline(nodes: TiptapJSON[] | undefined): ReactNode {
  return (nodes ?? []).map((node, index) => {
    if (node.type === 'hardBreak') return <br key={index} />
    if (node.type === 'text') return <Fragment key={index}>{previewMarks(node.text ?? '', node.marks)}</Fragment>
    if (node.type === 'citation') {
      const keys = Array.isArray(node.attrs?.citekeys) ? node.attrs.citekeys.join('; ') : 'citation'
      return <span key={index} className="iw-workspace-swipe-slot__citation">({keys})</span>
    }
    if (node.type === 'mathInline') {
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '∑'
      return <span key={index} className="iw-workspace-swipe-slot__math">{latex}</span>
    }
    return <Fragment key={index}>{previewInline(node.content)}</Fragment>
  })
}

function previewBlock(node: TiptapJSON, key: number): ReactNode {
  const children = node.content
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2)))
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      return <Tag key={key}>{previewInline(children)}</Tag>
    }
    case 'bulletList': return <ul key={key}>{(children ?? []).map(previewBlock)}</ul>
    case 'orderedList': return <ol key={key}>{(children ?? []).map(previewBlock)}</ol>
    case 'listItem': return <li key={key}>{(children ?? []).map(previewBlock)}</li>
    case 'blockquote': return <blockquote key={key}>{(children ?? []).map(previewBlock)}</blockquote>
    case 'codeBlock': return <pre key={key}><code>{previewInline(children)}</code></pre>
    case 'paragraph': return <p key={key}>{previewInline(children)}</p>
    case 'mathBlock': {
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '∑'
      return <div key={key} className="iw-workspace-swipe-slot__math-block">{latex}</div>
    }
    case 'mediaImage': return <div key={key} className="iw-workspace-swipe-slot__media">Image</div>
    default: return children ? <Fragment key={key}>{children.map(previewBlock)}</Fragment> : null
  }
}

function PreviewContent({ doc }: { doc: TiptapJSON }) {
  return <>{(doc.content ?? []).map(previewBlock)}</>
}

function labelFor(doc: InkwaveDocument): string {
  if (doc.docType === 'email') return doc.email?.subject?.trim() || 'Untitled email'
  return doc.title?.trim() || 'Untitled'
}

function Neighbour({
  side,
  doc,
  onOpen,
}: {
  side: 'left' | 'right'
  doc: InkwaveDocument
  onOpen: () => void
}) {
  const text = tidyPreviewText(workspacePreviewJson(doc.contentJson, 1_200))
  const title = labelFor(doc)
  return (
    <button
      type="button"
      className={`iw-workspace-neighbour iw-workspace-neighbour--${side}`}
      onClick={onOpen}
      aria-label={`Open ${side} panel: ${title}`}
      title={title}
    >
      <span className="iw-workspace-neighbour__kind">{doc.docType === 'email' ? 'Email' : 'Page'}</span>
      <strong>{title}</strong>
      {doc.docType === 'email' && doc.email?.to?.length ? (
        <span className="iw-workspace-neighbour__meta">To {doc.email.to.join(', ')}</span>
      ) : null}
      {text ? <span className="iw-workspace-neighbour__text">{text}</span> : (
        <span className="iw-workspace-neighbour__empty">Blank page</span>
      )}
      <span className="iw-workspace-neighbour__arrow" aria-hidden="true">
        {side === 'left' ? '←' : '→'}
      </span>
    </button>
  )
}

function SwipeSlot({ doc, side }: { doc: InkwaveDocument; side: 'left' | 'right' }) {
  const exactRef = useRef<HTMLDivElement>(null)
  const [exact, setExact] = useState(false)
  const title = labelFor(doc)
  const email = doc.docType === 'email' ? doc.email : null
  const content = workspacePreviewJson(doc.contentJson)
  const hasText = !!tidyPreviewText(content)
  useLayoutEffect(() => {
    const host = exactRef.current
    if (!host) return
    const paint = () => setExact(mountPaintedWorkspacePreview(doc.id, host, doc.updatedAt))
    paint()
    window.addEventListener('resize', paint)
    window.addEventListener('inkwave:page-settings-changed', paint)
    return () => {
      window.removeEventListener('resize', paint)
      window.removeEventListener('inkwave:page-settings-changed', paint)
    }
  }, [doc.id, doc.updatedAt])
  return (
    <section
      className={`iw-workspace-swipe-slot iw-workspace-swipe-slot--${side}`}
      data-iw-swipe-side={side}
      data-iw-swipe-document={doc.id}
      aria-hidden="true"
    >
      <div ref={exactRef} className="iw-workspace-swipe-slot__exact" data-iw-exact-preview={exact || undefined} />
      {!exact && <div className={`iw-workspace-swipe-slot__paper${email ? ' iw-workspace-swipe-slot__paper--email' : ''}`}>
        {email ? (
          <div className="iw-workspace-swipe-slot__email">
            <div className="iw-workspace-swipe-slot__email-label">Email draft</div>
            <div><span>To</span>{email.to.join(', ') || ' '}</div>
            {!!email.cc?.length && <div><span>Cc</span>{email.cc.join(', ')}</div>}
            <div><span>Subject</span>{email.subject || 'Untitled email'}</div>
            <div className="iw-workspace-swipe-slot__body"><PreviewContent doc={content} /></div>
          </div>
        ) : (
          <article className="iw-workspace-swipe-slot__document">
            {hasText ? <PreviewContent doc={content} /> : <p>{title}</p>}
          </article>
        )}
      </div>}
    </section>
  )
}

interface PreviewSet {
  left: InkwaveDocument | null
  right: InkwaveDocument | null
}

const flatTransform = (x: number) => `translate3d(${x.toFixed(2)}px,0,0)`

export function WorkspaceNavigation({
  activeId,
  activeVersion,
  left,
  right,
  onNavigate,
  onNavigateTo,
}: {
  activeId: string
  activeVersion?: string
  left: InkwaveDocument | null
  right: InkwaveDocument | null
  onNavigate: (direction: WorkspaceDirection, options?: { interactive?: boolean }) => Promise<void>
  onNavigateTo: (id: string) => Promise<void>
}) {
  const movingRef = useRef(false)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const activeVersionRef = useRef(activeVersion)
  activeVersionRef.current = activeVersion
  const pendingHistoryIdRef = useRef<string | null>(null)
  const historyMoveRef = useRef<(id: string) => void>(() => {})
  // Persist across active-document remounts: late trackpad momentum must not bounce the new panel.
  const wheelGestureRef = useRef(newWorkspaceGesture())
  const wheelIdleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settlingRef = useRef(false)
  const activeSwipeBoxRef = useRef<HTMLElement | null>(null)
  const swipeXRef = useRef(0)
  const swipeVelocityRef = useRef(0)
  const lastWheelAtRef = useRef(0)
  const stripRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const leftRef = useRef(left)
  const rightRef = useRef(right)
  leftRef.current = left
  rightRef.current = right
  // Freeze both painted neighbours while the live editor swaps underneath the landed slot.
  const [previews, setPreviews] = useState<PreviewSet>({ left, right })
  const wavePoseRef = useRef(0)
  const waveVelocityRef = useRef(0)
  const waveActiveRef = useRef(false)
  const waveSeededRef = useRef(false)
  const waveRafRef = useRef(0)
  const [edge, setEdge] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    if (!settlingRef.current && swipeXRef.current === 0) setPreviews({ left, right })
  }, [activeId, left, right])

  // Keep the current document's real, settled paint ready for the next back-swipe. This is inert
  // DOM only; the one-live-editor/write-lock invariant remains unchanged.
  useEffect(() => {
    if (!settlingRef.current && swipeXRef.current === 0) capturePaintedWorkspacePreview(activeId, activeVersion)
  }, [activeId, left, right])

  const finishMove = useCallback(() => {
    movingRef.current = false
    const pending = pendingHistoryIdRef.current
    pendingHistoryIdRef.current = null
    if (pending && pending !== activeIdRef.current) queueMicrotask(() => historyMoveRef.current(pending))
  }, [])

  const moveTo = useCallback((id: string) => {
    if (!id || id === activeIdRef.current) return
    if (movingRef.current) {
      pendingHistoryIdRef.current = id
      return
    }
    movingRef.current = true
    void onNavigateTo(id).finally(finishMove)
  }, [finishMove, onNavigateTo])
  historyMoveRef.current = moveTo

  const pulseEdge = useCallback((direction: WorkspaceDirection) => {
    setEdge(direction < 0 ? 'left' : 'right')
    clearTimeout(edgeTimerRef.current)
    edgeTimerRef.current = setTimeout(() => setEdge(null), 180)
  }, [])

  const emitWave = useCallback((active: boolean) => {
    waveActiveRef.current = active
    publishWorkspaceWaterMotion(wavePoseRef.current, active)
  }, [])

  const sampleWave = useCallback((deltaX: number, velocityX: number) => {
    if (waveRafRef.current) {
      cancelAnimationFrame(waveRafRef.current)
      waveRafRef.current = 0
    }
    if (!waveSeededRef.current) {
      wavePoseRef.current = readWorkspaceWaterMotion()?.pose ?? 0
      waveSeededRef.current = true
    }
    wavePoseRef.current += deltaX * SWIPE_WAVE_GAIN
    waveVelocityRef.current = velocityX * SWIPE_WAVE_GAIN
    emitWave(true)
  }, [emitWave])

  const coastTouchWaves = useCallback(() => {
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
    const velocity0 = waveVelocityRef.current
    const pose0 = wavePoseRef.current
    const started = performance.now()
    const tick = (now: number) => {
      const decay = Math.exp(-Math.max(0, now - started) / 180)
      const velocity = velocity0 * decay
      wavePoseRef.current = pose0 + velocity0 * 180 * (1 - decay)
      waveVelocityRef.current = velocity
      if (Math.abs(velocity) < 0.002) {
        waveRafRef.current = 0
        emitWave(false)
        return
      }
      emitWave(true)
      waveRafRef.current = requestAnimationFrame(tick)
    }
    waveRafRef.current = requestAnimationFrame(tick)
  }, [emitWave])

  const liveBox = useCallback(() => {
    const connected = activeSwipeBoxRef.current?.isConnected ? activeSwipeBoxRef.current : null
    const box = connected ?? document.querySelector(
      '.inkwave-editor-surface.iw-fill .iw-magnify-box',
    ) as HTMLElement | null
    activeSwipeBoxRef.current = box
    return box
  }, [])

  const applySwipeTransform = useCallback((x: number, promote = true) => {
    swipeXRef.current = x
    const transform = flatTransform(x)
    const box = liveBox()
    if (box) {
      if (!box.hasAttribute('data-iw-workspace-swipe-card')) {
        captureWorkspaceViewState(activeIdRef.current)
        capturePaintedWorkspacePreview(activeIdRef.current, activeVersionRef.current)
      }
      box.setAttribute('data-iw-workspace-swipe-card', '')
      if (promote) box.style.willChange = 'transform'
      box.style.transform = transform
    }
    const strip = stripRef.current
    if (strip) {
      if (promote) strip.style.willChange = 'transform'
      strip.style.transform = transform
    }
    if (promote) navigationRef.current?.setAttribute('data-iw-swipe-active', '')
  }, [liveBox])

  const applySwipe = useCallback((rawX: number, velocityX: number, deltaX: number) => {
    const direction: WorkspaceDirection = rawX > 0 ? -1 : 1
    const target = direction < 0 ? leftRef.current : rightRef.current
    const visualX = workspaceSwipeVisualX(rawX, window.innerWidth, !!target)
    swipeVelocityRef.current = velocityX
    applySwipeTransform(visualX)
    sampleWave(deltaX, velocityX)
  }, [applySwipeTransform, sampleWave])

  const animateVisual = useCallback(async (toX: number, commit: boolean) => {
    const box = activeSwipeBoxRef.current
    const strip = stripRef.current
    const fromX = swipeXRef.current
    const speed = Math.max(0.5, Math.abs(swipeVelocityRef.current))
    const distance = Math.abs(toX - fromX)
    const duration = commit
      ? Math.max(190, Math.min(360, distance / Math.max(3.8, speed * 2.4)))
      : Math.max(110, Math.min(210, 90 + Math.abs(fromX) * 0.45))
    const frameCount = Math.max(12, Math.ceil(duration / 12))
    const frames = Array.from({ length: frameCount + 1 }, (_, index) => {
      const offset = index / frameCount
      return {
        offset,
        transform: flatTransform(workspaceSwipeSettleX(
          fromX,
          toX,
          swipeVelocityRef.current,
          offset * duration,
          duration,
        )),
      }
    })
    const animations: Animation[] = []
    if (box?.animate) animations.push(box.animate(frames, { duration, easing: 'linear', fill: 'forwards' }))
    if (strip?.animate) animations.push(strip.animate(frames, { duration, easing: 'linear', fill: 'forwards' }))
    // Both elements share one document timeline instant; never let two independently-created
    // animations differ by the fraction of a frame on WebKit.
    const sharedStart = document.timeline?.currentTime
    if (sharedStart != null) animations.forEach((animation) => { animation.startTime = sharedStart })
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
    if (box?.isConnected) box.style.transform = flatTransform(toX)
    if (strip) strip.style.transform = flatTransform(toX)
    swipeXRef.current = toX
    for (const animation of animations) animation.cancel()
  }, [])

  const resetSwipeVisual = useCallback(() => {
    const box = activeSwipeBoxRef.current
    if (box?.isConnected) {
      box.removeAttribute('data-iw-workspace-swipe-card')
      box.style.removeProperty('transform')
      box.style.removeProperty('will-change')
    }
    activeSwipeBoxRef.current = null
    stripRef.current?.style.removeProperty('transform')
    stripRef.current?.style.removeProperty('will-change')
    navigationRef.current?.removeAttribute('data-iw-swipe-active')
    swipeXRef.current = 0
    swipeVelocityRef.current = 0
    lastWheelAtRef.current = 0
    waveSeededRef.current = false
    wheelGestureRef.current = newWorkspaceGesture()
  }, [])

  const settleSwipe = useCallback(async (gesture: WorkspaceGestureState, _source: 'wheel' | 'touch') => {
    if (!gesture.claimed || settlingRef.current) {
      if (!gesture.claimed) wheelGestureRef.current = newWorkspaceGesture()
      return
    }
    settlingRef.current = true
    const release = workspaceSwipeRelease(
      gesture.x,
      swipeVelocityRef.current,
      window.innerWidth,
      !!leftRef.current,
      !!rightRef.current,
    )
    // The paper's release animation continues from the finger velocity; the fixed water gets the
    // same short exponential tail in both touch and wheel paths and survives the editor remount.
    coastTouchWaves()

    if (!release.direction) {
      if ((gesture.x > 0 && !leftRef.current) || (gesture.x < 0 && !rightRef.current)) {
        pulseEdge(gesture.x > 0 ? -1 : 1)
      }
      await animateVisual(0, false)
      resetSwipeVisual()
      settlingRef.current = false
      return
    }

    const direction = release.direction
    const oldBox = activeSwipeBoxRef.current
    // Exactly one viewport: the neighbour whose fixed slot began at ±100vw lands at x=0.
    const destinationX = direction < 0 ? window.innerWidth : -window.innerWidth
    movingRef.current = true
    await animateVisual(destinationX, true)
    try {
      await onNavigate(direction, { interactive: true })
      emitWave(waveActiveRef.current)
      if (oldBox?.isConnected) {
        activeSwipeBoxRef.current = oldBox
        await animateVisual(0, false)
      }
    } finally {
      resetSwipeVisual()
      setPreviews({ left: leftRef.current, right: rightRef.current })
      settlingRef.current = false
      finishMove()
    }
  }, [animateVisual, coastTouchWaves, emitWave, finishMove, onNavigate, pulseEdge, resetSwipeVisual])

  const move = useCallback((direction: WorkspaceDirection) => {
    const exists = direction < 0 ? left : right
    if (!exists) { pulseEdge(direction); return }
    if (movingRef.current) return
    movingRef.current = true
    void onNavigate(direction).finally(finishMove)
  }, [finishMove, left, right, onNavigate, pulseEdge])

  useEffect(() => () => {
    clearTimeout(wheelIdleRef.current)
    clearTimeout(edgeTimerRef.current)
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current)
    emitWave(false)
    resetSwipeVisual()
  }, [emitWave, resetSwipeVisual])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('iw-no-swipe-nav')
    return () => root.classList.remove('iw-no-swipe-nav')
  }, [])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const id = workspacePanelIdFromHistory(event.state)
      if (id) moveTo(id)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [moveTo])

  useEffect(() => {
    const surface = document.querySelector('.inkwave-editor-surface.iw-fill') as HTMLElement | null
    if (!surface) return
    let touch = newWorkspaceGesture()
    let touchX: number | null = null
    let touchY: number | null = null
    let touchDistance: number | null = null
    let touchIsPinch = false
    let touchLastAt = 0
    let touchVelocity = 0
    const settleWheelSoon = () => {
      clearTimeout(wheelIdleRef.current)
      wheelIdleRef.current = setTimeout(() => {
        const completed = wheelGestureRef.current
        if (completed.claimed) void settleSwipe(completed, 'wheel')
        else wheelGestureRef.current = newWorkspaceGesture()
      }, WHEEL_IDLE_MS)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      if (settlingRef.current) {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault()
        return
      }
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, surface.clientWidth) : 1
      const dx = event.deltaX * unit
      const dy = event.deltaY * unit
      const answer = pushWorkspaceGesture(wheelGestureRef.current, dx, dy)
      settleWheelSoon()
      if (!answer.claimed) return
      event.preventDefault()
      const now = performance.now()
      const dt = lastWheelAtRef.current ? Math.max(4, now - lastWheelAtRef.current) : 16
      const instant = dx / dt
      swipeVelocityRef.current = lastWheelAtRef.current
        ? swipeVelocityRef.current * 0.32 + instant * 0.68
        : instant
      lastWheelAtRef.current = now
      applySwipe(wheelGestureRef.current.x, swipeVelocityRef.current, dx)
    }

    const onTouchStart = (event: globalThis.TouchEvent) => {
      if (event.touches.length !== 2) {
        touchX = null; touchY = null; touchDistance = null; touchIsPinch = false
        touch = newWorkspaceGesture()
        return
      }
      touchX = (event.touches[0].clientX + event.touches[1].clientX) / 2
      touchY = (event.touches[0].clientY + event.touches[1].clientY) / 2
      touchDistance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      )
      touchIsPinch = false
      touch = newWorkspaceGesture()
      touchLastAt = performance.now()
      touchVelocity = 0
    }
    const onTouchMove = (event: globalThis.TouchEvent) => {
      if (event.touches.length !== 2 || touchX == null || touchY == null || touchDistance == null) return
      const x = (event.touches[0].clientX + event.touches[1].clientX) / 2
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2
      const distance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      )
      if (Math.abs(distance - touchDistance) >= 7) touchIsPinch = true
      if (touchIsPinch) {
        if (touch.claimed) { resetSwipeVisual(); emitWave(false) }
        touchX = x; touchY = y; return
      }
      const dx = x - touchX
      const dy = y - touchY
      const answer = pushWorkspaceGesture(touch, dx, dy)
      touchX = x
      touchY = y
      if (!answer.claimed) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const now = performance.now()
      const dt = touchLastAt ? Math.max(4, now - touchLastAt) : 16
      const instant = dx / dt
      touchVelocity = touchLastAt ? touchVelocity * 0.32 + instant * 0.68 : instant
      touchLastAt = now
      swipeVelocityRef.current = touchVelocity
      applySwipe(touch.x, touchVelocity, dx)
    }
    const onTouchEnd = () => {
      const completed = touch
      touchX = null; touchY = null; touchDistance = null; touchIsPinch = false
      touch = newWorkspaceGesture()
      if (completed.claimed) void settleSwipe(completed, 'touch')
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }

    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    surface.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    surface.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    surface.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
    surface.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('wheel', onWheel, true)
      surface.removeEventListener('touchstart', onTouchStart, true)
      surface.removeEventListener('touchmove', onTouchMove, true)
      surface.removeEventListener('touchend', onTouchEnd, true)
      surface.removeEventListener('touchcancel', onTouchEnd, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeId, applySwipe, emitWave, move, resetSwipeVisual, settleSwipe])

  return (
    <nav
      ref={navigationRef}
      className="iw-workspace-navigation"
      data-iw-edge={edge ?? undefined}
      aria-label="Open document panels"
    >
      <div ref={stripRef} className="iw-workspace-swipe-strip" aria-hidden="true">
        {previews.left && <SwipeSlot doc={previews.left} side="left" />}
        {previews.right && <SwipeSlot doc={previews.right} side="right" />}
      </div>
      {left && <Neighbour side="left" doc={left} onOpen={() => move(-1)} />}
      {right && <Neighbour side="right" doc={right} onOpen={() => move(1)} />}
    </nav>
  )
}
