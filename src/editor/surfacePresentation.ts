import type { PaperSize } from './pageSettings'

export type SurfacePresentation = 'document' | 'application'

/** Document paper uses Scroll's magnify pipeline; isolated applications own their equivalent fit wrapper. */
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

/** Application layout owns its pixel width; document layout retains its selected physical width. */
export function presentedPaperWidth(presentation: SurfacePresentation, physicalWidth: string): string {
  return presentation === 'application' ? '100%' : physicalWidth
}
