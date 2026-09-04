import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import {
  screenAdjustedSurfaceWidth,
  surfaceMinHeight,
  surfaceWidthLimits,
  surfaceWidthScale,
  symmetricSurfaceWidth,
  type ApplicationSurfaceResizeEdge,
} from './applicationSurfaceResize'

/**
 * The shared frame for a focused Inkwave tool. Email owns the fields inside it; future music and
 * other tools reuse the same isolated/contextual shell instead of growing parallel page chrome.
 */
export type ApplicationSurfaceMode = 'isolated' | 'contextual'

interface ApplicationSurfaceProps {
  app: string
  label: ReactNode
  ariaLabel?: string
  mode?: ApplicationSurfaceMode
  nightable?: boolean
  resizable?: boolean
  children: ReactNode
}

const WIDTH_STEP_PX = 12
const HEIGHT_STEP_PX = 16

function storedSizeKey(app: string, mode: ApplicationSurfaceMode, axis: 'widthScale' | 'height'): string {
  return `inkwave:applicationSurface:${app}:${mode}:${axis}`
}

export function ApplicationSurface({
  app,
  label,
  ariaLabel,
  mode = 'isolated',
  nightable = false,
  resizable = false,
  children,
}: ApplicationSurfaceProps) {
  const surfaceRef = useRef<HTMLElement>(null)
  const removeDragListenersRef = useRef<(() => void) | null>(null)

  const persistWidth = useCallback((width: number) => {
    if (!surfaceRef.current) return
    const pixels = Math.round(width)
    surfaceRef.current.style.width = `${pixels}px`
    try {
      localStorage.setItem(storedSizeKey(app, mode, 'widthScale'), String(surfaceWidthScale(pixels, window.screen.width)))
    } catch { /* private mode */ }
  }, [app, mode])

  const persistHeight = useCallback((height: number) => {
    if (!surfaceRef.current) return
    surfaceRef.current.style.minHeight = `${Math.round(height)}px`
    try { localStorage.setItem(storedSizeKey(app, mode, 'height'), String(Math.round(height))) } catch { /* private mode */ }
  }, [app, mode])

  const resetAxis = useCallback((axis: 'widthScale' | 'height') => {
    if (!surfaceRef.current) return
    if (axis === 'widthScale') surfaceRef.current.style.removeProperty('width')
    else surfaceRef.current.style.removeProperty('min-height')
    try { localStorage.removeItem(storedSizeKey(app, mode, axis)) } catch { /* private mode */ }
  }, [app, mode])

  useEffect(() => {
    if (!resizable || !surfaceRef.current) return
    const syncToScreen = () => {
      const baseWidth = screenAdjustedSurfaceWidth(window.screen.width)
      surfaceRef.current?.style.setProperty('--iw-application-default-width', `${baseWidth}px`)
      try {
        const scale = Number(localStorage.getItem(storedSizeKey(app, mode, 'widthScale')))
        if (Number.isFinite(scale) && scale >= 0.35 && scale <= 2) {
          surfaceRef.current!.style.width = `${Math.round(baseWidth * scale)}px`
        }
      } catch { /* private mode */ }
    }
    syncToScreen()
    window.addEventListener('resize', syncToScreen)
    try {
      const height = Number(localStorage.getItem(storedSizeKey(app, mode, 'height')))
      if (Number.isFinite(height) && height >= 240) surfaceRef.current.style.minHeight = `${height}px`
    } catch { /* private mode */ }
    return () => window.removeEventListener('resize', syncToScreen)
  }, [app, mode, resizable])

  useEffect(() => () => removeDragListenersRef.current?.(), [])

  const beginHorizontalResize = (event: PointerEvent<HTMLDivElement>, edge: ApplicationSurfaceResizeEdge) => {
    const surface = surfaceRef.current
    const parent = surface?.parentElement
    if (!surface || !parent) return
    event.preventDefault()
    removeDragListenersRef.current?.()
    const startX = event.clientX
    const startWidth = surface.getBoundingClientRect().width
    const limits = surfaceWidthLimits(parent.getBoundingClientRect().width - 48)
    let currentWidth = startWidth
    const move = (moveEvent: globalThis.PointerEvent) => {
      currentWidth = symmetricSurfaceWidth({
        startWidth,
        pointerDelta: moveEvent.clientX - startX,
        edge,
        minWidth: limits.min,
        maxWidth: limits.max,
      })
      surface.style.width = `${currentWidth}px`
    }
    const remove = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      removeDragListenersRef.current = null
    }
    const end = () => { remove(); persistWidth(currentWidth) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    removeDragListenersRef.current = remove
  }

  const beginVerticalResize = (event: PointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current
    if (!surface) return
    event.preventDefault()
    removeDragListenersRef.current?.()
    const startY = event.clientY
    const startHeight = surface.getBoundingClientRect().height
    const maxHeight = Math.max(startHeight, window.innerHeight * 2)
    let currentHeight = startHeight
    const move = (moveEvent: globalThis.PointerEvent) => {
      currentHeight = surfaceMinHeight({
        startHeight,
        pointerDelta: moveEvent.clientY - startY,
        minHeight: 240,
        maxHeight,
      })
      surface.style.minHeight = `${currentHeight}px`
    }
    const remove = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      removeDragListenersRef.current = null
    }
    const end = () => { remove(); persistHeight(currentHeight) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    removeDragListenersRef.current = remove
  }

  const resizeWidthByKey = (event: KeyboardEvent<HTMLDivElement>, edge: ApplicationSurfaceResizeEdge) => {
    if (event.key === 'Enter' || event.key === 'Home') { event.preventDefault(); resetAxis('widthScale'); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const surface = surfaceRef.current
    const parent = surface?.parentElement
    if (!surface || !parent) return
    event.preventDefault()
    const limits = surfaceWidthLimits(parent.getBoundingClientRect().width - 48)
    const pointerDelta = event.key === 'ArrowRight' ? WIDTH_STEP_PX : -WIDTH_STEP_PX
    persistWidth(symmetricSurfaceWidth({
      startWidth: surface.getBoundingClientRect().width,
      pointerDelta,
      edge,
      minWidth: limits.min,
      maxWidth: limits.max,
    }))
  }

  const resizeHeightByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === 'Home') { event.preventDefault(); resetAxis('height'); return }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const surface = surfaceRef.current
    if (!surface) return
    event.preventDefault()
    persistHeight(surfaceMinHeight({
      startHeight: surface.getBoundingClientRect().height,
      pointerDelta: event.key === 'ArrowDown' ? HEIGHT_STEP_PX : -HEIGHT_STEP_PX,
      minHeight: 240,
      maxHeight: Math.max(surface.getBoundingClientRect().height, window.innerHeight * 2),
    }))
  }

  return (
    <section
      ref={surfaceRef}
      className={`iw-application-surface iw-application-surface--${mode}${nightable ? ' iw-nightable' : ''}`}
      data-iw-application={app}
      data-iw-surface-mode={mode}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : `${app} application`)}
    >
      <div className="iw-application-surface__label">{label}</div>
      {children}
      {resizable && (
        <>
          <div
            className="iw-application-surface__resize iw-application-surface__resize--left"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${app} symmetrically from the left edge`}
            title="Drag to resize symmetrically · double-click to reset"
            tabIndex={0}
            onPointerDown={(event) => beginHorizontalResize(event, 'left')}
            onKeyDown={(event) => resizeWidthByKey(event, 'left')}
            onDoubleClick={() => resetAxis('widthScale')}
          />
          <div
            className="iw-application-surface__resize iw-application-surface__resize--right"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${app} symmetrically from the right edge`}
            title="Drag to resize symmetrically · double-click to reset"
            tabIndex={0}
            onPointerDown={(event) => beginHorizontalResize(event, 'right')}
            onKeyDown={(event) => resizeWidthByKey(event, 'right')}
            onDoubleClick={() => resetAxis('widthScale')}
          />
          <div
            className="iw-application-surface__resize iw-application-surface__resize--bottom"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${app} height from the bottom edge`}
            title="Drag to resize height · double-click to reset"
            tabIndex={0}
            onPointerDown={beginVerticalResize}
            onKeyDown={resizeHeightByKey}
            onDoubleClick={() => resetAxis('height')}
          />
        </>
      )}
    </section>
  )
}
