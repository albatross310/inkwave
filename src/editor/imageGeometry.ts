export type ImageDragMode = 'move-x' | 'resize-width' | 'resize-height' | 'resize-both' | 'resize-both-left'

export interface ImageGeometry {
  widthPct: number
  xPct: number
  heightPx: number | null
}

export function clampImageGeometry(value: ImageGeometry): ImageGeometry {
  const widthPct = Math.min(100, Math.max(10, value.widthPct))
  const xPct = Math.min(100 - widthPct, Math.max(0, value.xPct))
  const heightPx = value.heightPx === null ? null : Math.min(2400, Math.max(44, value.heightPx))
  return { widthPct, xPct, heightPx }
}

export function dragImageGeometry(
  start: ImageGeometry,
  mode: ImageDragMode,
  dxPx: number,
  dyPx: number,
  parentWidthPx: number,
  renderedHeightPx: number,
): ImageGeometry {
  const dxPct = parentWidthPx > 0 ? dxPx / parentWidthPx * 100 : 0
  if (mode === 'move-x') return clampImageGeometry({ ...start, xPct: start.xPct + dxPct })
  const startHeight = start.heightPx ?? renderedHeightPx

  if (mode === 'resize-both' || mode === 'resize-both-left') {
    const startWidthPx = parentWidthPx * start.widthPct / 100
    const scaleX = startWidthPx > 0
      ? (startWidthPx + (mode === 'resize-both-left' ? -dxPx : dxPx)) / startWidthPx
      : 1
    const scaleY = startHeight > 0 ? (startHeight + dyPx) / startHeight : 1
    // A diagonal pull is one proportional scale, never two unrelated dimensions. Whichever axis
    // moved further relative to the image wins, which keeps the interaction stable with a mouse or
    // trackpad even when the pointer does not follow the exact aspect-ratio diagonal.
    const requestedScale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
    const minScale = Math.max(10 / start.widthPct, 44 / startHeight)
    const maxWidthPct = mode === 'resize-both-left' ? start.xPct + start.widthPct : 100 - start.xPct
    const maxScale = Math.min(maxWidthPct / start.widthPct, 2400 / startHeight)
    const scale = Math.min(maxScale, Math.max(minScale, requestedScale))
    const widthPct = start.widthPct * scale
    return {
      widthPct,
      xPct: mode === 'resize-both-left' ? start.xPct + start.widthPct - widthPct : start.xPct,
      heightPx: startHeight * scale,
    }
  }

  if (mode === 'resize-width') {
    return {
      ...start,
      // Keep the left edge anchored. Reaching the writing-column edge stops the resize rather than
      // silently pushing the image left.
      widthPct: Math.min(100 - start.xPct, Math.max(10, start.widthPct + dxPct)),
    }
  }

  return clampImageGeometry({ ...start, heightPx: startHeight + dyPx })
}
