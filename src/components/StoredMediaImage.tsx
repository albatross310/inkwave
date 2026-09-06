import {
  useEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from 'react'
import { loadMedia, sha256Blob } from '../media/mediaStore'
import { mediaReadyVersion } from '../media/ready'

export interface StoredMediaImageAttrs {
  assetId: string
  mime: string
  name: string
  alt?: string | null
  sha256?: string | null
  title?: string | null
  source?: string | null
  addedAt?: string | null
  captionPosition?: 'top' | 'bottom' | null
  captionFontFamily?: string | null
  widthPct?: number | null
  heightPx?: number | null
  xPct?: number | null
}

export function storedMediaFigureStyle(attrs: StoredMediaImageAttrs): CSSProperties {
  const width = Math.min(100, Math.max(10, Number(attrs.widthPct) || 100))
  const x = Math.min(100 - width, Math.max(0, Number(attrs.xPct) || 0))
  return { width: `${width}%`, marginLeft: `${x}%`, marginRight: 0 }
}

/** One renderer for the live NodeView and read-only snapshot views. */
export function StoredMediaImage({ attrs }: { attrs: StoredMediaImageAttrs }) {
  const [reload, setReload] = useState(0)
  const [src, setSrc] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const onReady = (event: Event) => {
      const id = (event as CustomEvent<{ assetId?: string }>).detail?.assetId
      if (id === attrs.assetId) setReload((value) => value + 1)
    }
    window.addEventListener('inkwave:media-ready', onReady)
    return () => window.removeEventListener('inkwave:media-ready', onReady)
  }, [attrs.assetId])

  useEffect(() => {
    let live = true
    let url: string | null = null
    const readyAtStart = mediaReadyVersion(attrs.assetId)
    setSettled(false)
    void loadMedia({ id: attrs.assetId, mime: attrs.mime }).then(async (blob) => {
      if (!live) return
      if (blob) {
        if (attrs.sha256 && await sha256Blob(blob) !== attrs.sha256) {
          setSrc(null)
          setSettled(true)
          return
        }
        url = URL.createObjectURL(blob)
        setSrc(url)
      } else {
        setSrc(null)
        // The write completed while this read was in flight, before the effect's event listener
        // necessarily mounted. Retry only on a version change, never in an unbounded polling loop.
        if (mediaReadyVersion(attrs.assetId) > readyAtStart) setReload((value) => value + 1)
      }
      setSettled(true)
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [attrs.assetId, attrs.mime, attrs.sha256, reload])

  if (src) return <img className="iw-media-image__img" src={src} alt={attrs.alt || attrs.name} draggable={false}
    style={{ height: attrs.heightPx ? `${attrs.heightPx}px` : 'auto' }} />
  return (
    <span className="iw-media-image__status" role="status">
      {settled ? `Image unavailable or does not match this document: ${attrs.name}` : `Importing ${attrs.name}…`}
    </span>
  )
}

export function MediaImageCaption({
  attrs,
  onTitleClick,
  onSourceClick,
  titleEditor,
}: {
  attrs: StoredMediaImageAttrs
  onTitleClick?: () => void
  onSourceClick?: MouseEventHandler<HTMLElement>
  titleEditor?: ReactNode
}) {
  const source = String(attrs.source ?? '').trim()
  const href = /^https?:\/\//i.test(source) ? source : null
  return (
    <figcaption className="iw-media-image__caption" style={{ fontFamily: attrs.captionFontFamily || undefined }}>
      {titleEditor ?? (attrs.title && <span className="iw-media-image__title" onClick={onTitleClick}>{attrs.title}</span>)}
      <span className="iw-media-image__meta">
        {attrs.addedAt && <time dateTime={attrs.addedAt}>Date added {displayMediaDate(attrs.addedAt)}</time>}
        {attrs.addedAt && <span aria-hidden="true"> · </span>}
        {onSourceClick
          ? <button type="button" className={`iw-media-image__source${source ? '' : ' is-empty'}`} title={source || 'No source added'} onClick={onSourceClick}>Source</button>
          : href
            ? <a className="iw-media-image__source" href={href} target="_blank" rel="noopener noreferrer" title={source}>Source</a>
            : <span className={`iw-media-image__source${source ? '' : ' is-empty'}`} title={source || 'No source added'}>Source</span>}
      </span>
    </figcaption>
  )
}

function displayMediaDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function StoredMediaFigureContents({
  attrs,
  pictureProps,
  pictureOverlay,
  onTitleClick,
  onSourceClick,
  titleEditor,
}: {
  attrs: StoredMediaImageAttrs
  pictureProps?: HTMLAttributes<HTMLDivElement>
  pictureOverlay?: ReactNode
  onTitleClick?: () => void
  onSourceClick?: MouseEventHandler<HTMLElement>
  titleEditor?: ReactNode
}) {
  const caption = <MediaImageCaption attrs={attrs} onTitleClick={onTitleClick} onSourceClick={onSourceClick} titleEditor={titleEditor} />
  const picture = <div className="iw-media-image__picture" {...pictureProps}>
    <StoredMediaImage attrs={attrs} />
    {pictureOverlay}
  </div>
  return <>
    {attrs.captionPosition === 'top' && caption}
    {picture}
    {attrs.captionPosition !== 'top' && caption}
  </>
}
