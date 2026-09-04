import { describe, expect, it } from 'vitest'
import { presentedPaperWidth, usesTransformMagnify } from './surfacePresentation'

describe('surface presentation sizing', () => {
  it('keeps fixed document paper on the transform-magnify path', () => {
    expect(usesTransformMagnify({ fill: true, phone: false, paperSize: 'a4', presentation: 'document' })).toBe(true)
    expect(presentedPaperWidth('document', '210mm')).toBe('210mm')
  })

  it('leaves application fitting to its reusable surface rather than document-paper magnify', () => {
    expect(usesTransformMagnify({ fill: true, phone: false, paperSize: 'a4', presentation: 'application' })).toBe(false)
    expect(presentedPaperWidth('application', '210mm')).toBe('100%')
  })

  it('keeps phone and continuous paper off the transform path', () => {
    expect(usesTransformMagnify({ fill: true, phone: true, paperSize: 'a4', presentation: 'document' })).toBe(false)
    expect(usesTransformMagnify({ fill: true, phone: false, paperSize: 'scroll', presentation: 'document' })).toBe(false)
  })
})
