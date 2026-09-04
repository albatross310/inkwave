import type { PaperSize } from './pageSettings'

export type SurfacePresentation = 'document' | 'application'

/** Document paper preserves its physical layout by scaling; applications reflow at a stable type size. */
export function usesTransformMagnify({
  fill,
  phone,
  paperSize,
  presentation,
}: {
  fill: boolean
  phone: boolean
  paperSize: PaperSize
  presentation: SurfacePresentation
}): boolean {
  return fill && !phone && paperSize !== 'scroll' && presentation === 'document'
}

/** Application width is responsive up to the selected physical page width; document width is fixed. */
export function presentedPaperWidth(presentation: SurfacePresentation, physicalWidth: string): string {
  return presentation === 'application' ? `min(100%, ${physicalWidth})` : physicalWidth
}
