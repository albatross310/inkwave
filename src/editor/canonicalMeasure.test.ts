import { describe, it, expect } from 'vitest'
import { forceCanonicalContext, CANONICAL_FONT_SIZE, type ElementLike } from './canonicalMeasure'

// A minimal inline-style double: distinguishes "unset" (absent) from "set to a value", like the
// real CSSStyleDeclaration inline map does.
function fakeEl(initial: Record<string, string> = {}): ElementLike & { props: Map<string, string> } {
  const props = new Map(Object.entries(initial))
  return {
    props,
    style: {
      getPropertyValue: (n: string) => props.get(n) ?? '',
      setProperty: (n: string, v: string) => { props.set(n, v) },
      removeProperty: (n: string) => { const v = props.get(n) ?? ''; props.delete(n); return v },
    },
  }
}

const GEOM = { pageWidthPx: 793.7007874015748, sideMarginPx: 96 }

describe('forceCanonicalContext', () => {
  it('forces the canonical layout on all four targets', () => {
    const paper = fakeEl({ width: '210mm' })
    const sheet = fakeEl({ 'padding-left': '1.25rem', 'padding-right': '1.25rem' })
    const surface = fakeEl({ '--iw-editor-zoom': '1.36' })
    const editor = fakeEl()
    forceCanonicalContext({ paper, sheet, surface, editor }, GEOM)
    expect(paper.props.get('width')).toBe(`${GEOM.pageWidthPx}px`)
    expect(sheet.props.get('padding-left')).toBe('96px')
    expect(sheet.props.get('padding-right')).toBe('96px')
    expect(surface.props.get('--iw-editor-zoom')).toBe('1')
    expect(surface.props.get('--iw-magnify')).toBe('1')
    expect(editor.props.get('font-size')).toBe(CANONICAL_FONT_SIZE)
  })

  it('restore puts previously-set values back exactly', () => {
    const paper = fakeEl({ width: '215.9mm' })
    const surface = fakeEl({ '--iw-editor-zoom': '2.197' })
    const restore = forceCanonicalContext({ paper, surface }, GEOM)
    restore()
    expect(paper.props.get('width')).toBe('215.9mm')
    expect(surface.props.get('--iw-editor-zoom')).toBe('2.197')
  })

  it('restore REMOVES properties that were unset before (phone paper has no inline width)', () => {
    const paper = fakeEl() // phone: w-full class, no inline width
    const editor = fakeEl() // font-size comes from the stylesheet, never inline
    const surface = fakeEl({ '--iw-editor-zoom': '1' }) // magnify var never set on master
    const restore = forceCanonicalContext({ paper, editor, surface }, GEOM)
    restore()
    expect(paper.props.has('width')).toBe(false)
    expect(editor.props.has('font-size')).toBe(false)
    expect(surface.props.has('--iw-magnify')).toBe(false)
    expect(surface.props.get('--iw-editor-zoom')).toBe('1')
  })

  it('tolerates missing targets', () => {
    const sheet = fakeEl({ 'padding-left': '96px' })
    const restore = forceCanonicalContext({ sheet, paper: null, surface: undefined }, GEOM)
    expect(sheet.props.get('padding-left')).toBe('96px') // canonical == prior is fine
    expect(() => restore()).not.toThrow()
  })

  it('restore is idempotent (second call is a no-op even after new writes)', () => {
    const surface = fakeEl({ '--iw-editor-zoom': '1.5' })
    const restore = forceCanonicalContext({ surface }, GEOM)
    restore()
    surface.style.setProperty('--iw-editor-zoom', '0.8') // a later live zoom
    restore()
    expect(surface.props.get('--iw-editor-zoom')).toBe('0.8') // NOT clobbered back to 1.5
  })
})
