import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MediaImageView } from './MediaImageView'

export interface MediaImageAttrs {
  assetId: string
  mime: string
  name: string
  alt?: string | null
  sha256?: string | null
  title?: string | null
  source?: string | null
  /** Stable id of a source selected from this document's reference library. */
  sourceCitekey?: string | null
  addedAt?: string | null
  captionPosition?: 'top' | 'bottom'
  captionFontFamily?: string | null
  widthPct?: number
  heightPx?: number | null
  xPct?: number
}

export interface MediaImageOptions {
  /** Recovers the import date for nodes created before addedAt became a node attribute. */
  getAddedAt: (assetId: string) => string | null
}

export const MediaImage = Node.create<MediaImageOptions>({
  name: 'mediaImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { getAddedAt: () => null }
  },

  addAttributes() {
    return {
      assetId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-asset-id') ?? '',
        renderHTML: (attrs) => ({ 'data-asset-id': String(attrs.assetId ?? '') }),
      },
      mime: {
        default: 'image/png',
        parseHTML: (element) => element.getAttribute('data-mime') ?? 'image/png',
        renderHTML: (attrs) => ({ 'data-mime': String(attrs.mime ?? 'image/png') }),
      },
      name: {
        default: 'Pasted image',
        parseHTML: (element) => element.getAttribute('data-name') ?? 'Pasted image',
        renderHTML: (attrs) => ({ 'data-name': String(attrs.name ?? 'Pasted image') }),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-alt'),
        renderHTML: (attrs) => attrs.alt ? { 'data-alt': String(attrs.alt) } : {},
      },
      sha256: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sha256'),
        renderHTML: (attrs) => attrs.sha256 ? { 'data-sha256': String(attrs.sha256) } : {},
      },
      title: {
        default: 'Pasted image',
        parseHTML: (element) => element.getAttribute('data-title') ?? 'Pasted image',
        renderHTML: (attrs) => ({ 'data-title': String(attrs.title ?? 'Pasted image') }),
      },
      source: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-source') ?? '',
        renderHTML: (attrs) => attrs.source ? { 'data-source': String(attrs.source) } : {},
      },
      sourceCitekey: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-source-citekey') ?? '',
        renderHTML: (attrs) => attrs.sourceCitekey ? { 'data-source-citekey': String(attrs.sourceCitekey) } : {},
      },
      addedAt: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-added-at') ?? '',
        renderHTML: (attrs) => attrs.addedAt ? { 'data-added-at': String(attrs.addedAt) } : {},
      },
      captionPosition: {
        default: 'bottom',
        parseHTML: (element) => element.getAttribute('data-caption-position') === 'top' ? 'top' : 'bottom',
        renderHTML: (attrs) => ({ 'data-caption-position': attrs.captionPosition === 'top' ? 'top' : 'bottom' }),
      },
      captionFontFamily: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption-font-family'),
        renderHTML: (attrs) => attrs.captionFontFamily ? { 'data-caption-font-family': String(attrs.captionFontFamily) } : {},
      },
      widthPct: {
        default: 100,
        parseHTML: (element) => Number(element.getAttribute('data-width-pct')) || 100,
        renderHTML: (attrs) => ({ 'data-width-pct': String(Number(attrs.widthPct) || 100) }),
      },
      heightPx: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-height-px')) || null,
        renderHTML: (attrs) => attrs.heightPx ? { 'data-height-px': String(Number(attrs.heightPx)) } : {},
      },
      xPct: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute('data-x-pct')) || 0,
        renderHTML: (attrs) => ({ 'data-x-pct': String(Number(attrs.xPct) || 0) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-iw-media-image]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-iw-media-image': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaImageView)
  },
})
