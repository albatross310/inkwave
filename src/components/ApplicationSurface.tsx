import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { fitScaleForWidth, WATER_MARGIN_PX } from '../editor/magnify'
import {
  DEFAULT_APPLICATION_SURFACE_WIDTH_PROFILE,
  screenAdjustedSurfaceWidth,
  surfaceMinHeight,
  surfaceWidthLimits,
  surfaceWidthScale,
  symmetricSurfaceWidth,
  type ApplicationSurfaceWidthProfile,
  type ApplicationSurfaceResizeEdge,
} from './applicationSurfaceResize'

/**
 * The shared frame for a focused Inkwave tool. Email owns the fields inside it; future music and
 * other tools reuse the same isolated/contextual shell instead of growing parallel page chrome.
 */
export type ApplicationSurfaceMode = 'isolated' | 'contextual'

export function ApplicationSurfaceModeSwitch({
  mode,
  onChange,
  isolatedLabel = 'Focus',
  contextualLabel = 'Studio',
}: {
  mode: ApplicationSurfaceMode
  onChange: (mode: ApplicationSurfaceMode) => void
  isolatedLabel?: string
  contextualLabel?: string
}) {
  return (
    <div className="iw-application-mode-switch" role="group" aria-label="Application layout">
      <button
        type="button"
        aria-pressed={mode === 'isolated'}
        title="Show only this application"
        onClick={() => onChange('isolated')}
      >
        {isolatedLabel}
      </button>
      <button
        type="button"
        aria-pressed={mode === 'contextual'}
        title="Place this application on a writing page"
        onClick={() => onChange('contextual')}
      >
        {contextualLabel}
      </button>
    </div>
  )
}

interface ApplicationSurfaceProps {
  app: string
  label: ReactNode
  ariaLabel?: string
  mode?: ApplicationSurfaceMode
  nightable?: boolean
  resizable?: boolean
  /** App-specific natural width on a reference display; fitting/resizing remain shared. */
  widthProfile?: ApplicationSurfaceWidthProfile
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
  widthProfile = DEFAULT_APPLICATION_SURFACE_WIDTH_PROFILE,
  children,
}: ApplicationSurfaceProps) {
  const profileScreenWidthPx = widthProfile.screenWidthPx
  const profileSurfaceWidthPx = widthProfile.surfaceWidthPx
  const surfaceRef = useRef<HTMLElement>(null)
  const fitBoxRef = useRef<HTMLDivElement>(null)
  const fitScaleRef = useRef(1)
  const removeDragListenersRef = useRef<(() => void) | null>(null)

  const syncFit = useCallback(() => {
    const surface = surfaceRef.current
    const fitBox = fitBoxRef.current
    const container = fitBox?.parentElement
    if (!surface || !fitBox || !container) return

    if (mode !== 'isolated') {
      fitScaleRef.current = 1
      fitBox.style.removeProperty('width')
      fitBox.style.removeProperty('height')
      surface.style.removeProperty('--iw-application-fit-scale')
      surface.classList.remove('iw-application-surface--fit-capped')
      return
    }

    if (surface.closest('.inkwave-editor-surface.is-phone')) {
      fitScaleRef.current = 1
      fitBox.style.removeProperty('width')
      fitBox.style.removeProperty('height')
      surface.style.removeProperty('--iw-application-fit-scale')
      surface.classList.remove('iw-application-surface--fit-capped')
      return
    }

    const naturalWidth = surface.offsetWidth
      || Number.parseFloat(surface.style.width)
      || screenAdjustedSurfaceWidth(window.screen.width, {
        screenWidthPx: profileScreenWidthPx,
        surfaceWidthPx: profileSurfaceWidthPx,
      })
    const availableWidth = Math.max(60, container.clientWidth - 2 * WATER_MARGIN_PX)
    const scale = Math.min(1, fitScaleForWidth(availableWidth, naturalWidth))
    fitScaleRef.current = scale
    fitBox.style.width = `${naturalWidth * scale}px`
    fitBox.style.height = `${surface.offsetHeight * scale}px`
    surface.style.setProperty('--iw-application-fit-scale', String(scale))
    surface.classList.toggle('iw-application-surface--fit-capped', scale < 1)
  }, [mode, profileScreenWidthPx, profileSurfaceWidthPx])

  const persistWidth = useCallback((width: number) => {
    if (!surfaceRef.current) return
    const pixels = Math.round(width)
    surfaceRef.current.style.width = `${pixels}px`
    try {
      localStorage.setItem(storedSizeKey(app, mode, 'widthScale'), String(surfaceWidthScale(pixels, window.screen.width, {
        screenWidthPx: profileScreenWidthPx,
        surfaceWidthPx: profileSurfaceWidthPx,
      })))
    } catch { /* private mode */ }
    syncFit()
  }, [app, mode, profileScreenWidthPx, profileSurfaceWidthPx, syncFit])

  const persistHeight = useCallback((height: number) => {
    if (!surfaceRef.current) return
    surfaceRef.current.style.minHeight = `${Math.round(height)}px`
    try { localStorage.setItem(storedSizeKey(app, mode, 'height'), String(Math.round(height))) } catch { /* private mode */ }
    syncFit()
  }, [app, mode, syncFit])

  const resetAxis = useCallback((axis: 'widthScale' | 'height') => {
    if (!surfaceRef.current) return
    if (axis === 'widthScale') surfaceRef.current.style.removeProperty('width')
    else surfaceRef.current.style.removeProperty('min-height')
    try { localStorage.removeItem(storedSizeKey(app, mode, axis)) } catch { /* private mode */ }
    syncFit()
  }, [app, mode, syncFit])

  useLayoutEffect(() => {
    if (mode !== 'isolated' || !surfaceRef.current) return
    const syncToScreen = () => {
      const baseWidth = screenAdjustedSurfaceWidth(window.screen.width, {
        screenWidthPx: profileScreenWidthPx,
        surfaceWidthPx: profileSurfaceWidthPx,
      })
      surfaceRef.current?.style.setProperty('--iw-application-default-width', `${baseWidth}px`)
      if (resizable) {
        try {
          const scale = Number(localStorage.getItem(storedSizeKey(app, mode, 'widthScale')))
          if (Number.isFinite(scale) && scale >= 0.35 && scale <= 2) {
            surfaceRef.current!.style.width = `${Math.round(baseWidth * scale)}px`
          }
        } catch { /* private mode */ }
      }
      syncFit()
    }
    syncToScreen()
    window.addEventListener('resize', syncToScreen)
    if (resizable) {
      try {
        const height = Number(localStorage.getItem(storedSizeKey(app, mode, 'height')))
        if (Number.isFinite(height) && height >= 240) surfaceRef.current.style.minHeight = `${height}px`
      } catch { /* private mode */ }
    }
    return () => window.removeEventListener('resize', syncToScreen)
  }, [app, mode, profileScreenWidthPx, profileSurfaceWidthPx, resizable, syncFit])

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const fitBox = fitBoxRef.current
    const container = fitBox?.parentElement
    if (!surface || !fitBox || !container) return
    syncFit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncFit)
    observer.observe(surface)
    observer.observe(container)
    return () => observer.disconnect()
  }, [syncFit])

  useEffect(() => () => removeDragListenersRef.current?.(), [])

  const beginHorizontalResize = (event: PointerEvent<HTMLDivElement>, edge: ApplicationSurfaceResizeEdge) => {
    const surface = surfaceRef.current
    const container = fitBoxRef.current?.parentElement ?? surface?.parentElement
    if (!surface || !container) return
    event.preventDefault()
    removeDragListenersRef.current?.()
    const startX = event.clientX
    const scale = fitScaleRef.current
    const startWidth = surface.offsetWidth || surface.getBoundingClientRect().width / scale
    const containerWidth = container.getBoundingClientRect().width - 2 * WATER_MARGIN_PX
    const limits = surfaceWidthLimits(Math.max(startWidth, containerWidth))
    let currentWidth = startWidth
    const move = (moveEvent: globalThis.PointerEvent) => {
      currentWidth = symmetricSurfaceWidth({
        startWidth,
        pointerDelta: (moveEvent.clientX - startX) / scale,
        edge,
        minWidth: limits.min,
        maxWidth: limits.max,
      })
      surface.style.width = `${currentWidth}px`
      syncFit()
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
    const scale = fitScaleRef.current
    const startHeight = surface.offsetHeight || surface.getBoundingClientRect().height / scale
    const maxHeight = Math.max(startHeight, window.innerHeight * 2)
    let currentHeight = startHeight
    const move = (moveEvent: globalThis.PointerEvent) => {
      currentHeight = surfaceMinHeight({
        startHeight,
        pointerDelta: (moveEvent.clientY - startY) / scale,
        minHeight: 240,
        maxHeight,
      })
      surface.style.minHeight = `${currentHeight}px`
      syncFit()
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
    const container = fitBoxRef.current?.parentElement ?? surface?.parentElement
    if (!surface || !container) return
    event.preventDefault()
    const scale = fitScaleRef.current
    const startWidth = surface.offsetWidth || surface.getBoundingClientRect().width / scale
    const containerWidth = container.getBoundingClientRect().width - 2 * WATER_MARGIN_PX
    const limits = surfaceWidthLimits(Math.max(startWidth, containerWidth))
    const pointerDelta = (event.key === 'ArrowRight' ? WIDTH_STEP_PX : -WIDTH_STEP_PX) / scale
    persistWidth(symmetricSurfaceWidth({
      startWidth,
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
    const scale = fitScaleRef.current
    persistHeight(surfaceMinHeight({
      startHeight: surface.offsetHeight || surface.getBoundingClientRect().height / scale,
      pointerDelta: (event.key === 'ArrowDown' ? HEIGHT_STEP_PX : -HEIGHT_STEP_PX) / scale,
      minHeight: 240,
      maxHeight: Math.max(surface.getBoundingClientRect().height, window.innerHeight * 2),
    }))
  }

  const surface = (
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
  return (
    <div
      ref={fitBoxRef}
      className={`iw-application-fit-box${mode === 'contextual' ? ' iw-application-fit-box--contextual' : ''}`}
    >
      {surface}
    </div>
  )
}
