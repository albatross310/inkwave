import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  StoredMediaFigureContents,
  type StoredMediaImageAttrs,
} from '../../components/StoredMediaImage'
import {
  clampImageGeometry,
  dragImageGeometry,
  type ImageDragMode,
  type ImageGeometry,
} from '../imageGeometry'
import { bibProvider } from '../../citations/bibProvider'
import { openCitationPanel } from '../../citations/panelOpen'
import type { CSLItem, IwCitationMeta } from '../../types/document'

interface OpenPanel {
  left: number
  top: number
}

function geometryFromAttrs(attrs: StoredMediaImageAttrs): ImageGeometry {
  return clampImageGeometry({
    widthPct: Number(attrs.widthPct) || 100,
    xPct: Number(attrs.xPct) || 0,
    heightPx: typeof attrs.heightPx === 'number' ? attrs.heightPx : null,
  })
}

export function MediaImageView({ node, selected, updateAttributes, extension }: NodeViewProps) {
  const attrs = node.attrs as StoredMediaImageAttrs
  const figureRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const dragRef = useRef<{
    mode: ImageDragMode
    startX: number
    startY: number
    start: ImageGeometry
    parentWidth: number
    renderedHeight: number
  } | null>(null)
  const dragListenersRef = useRef<{
    move: (event: PointerEvent) => void
    finish: () => void
  } | null>(null)
  const latestGeometryRef = useRef<ImageGeometry>(geometryFromAttrs(attrs))
  const [geometry, setGeometry] = useState<ImageGeometry>(() => geometryFromAttrs(attrs))
  const [panel, setPanel] = useState<OpenPanel | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(String(attrs.title ?? ''))
  const [draftSource, setDraftSource] = useState(String(attrs.source ?? ''))
  const [draftSourceCitekey, setDraftSourceCitekey] = useState(String(attrs.sourceCitekey ?? ''))
  const [, setReferenceVersion] = useState(0)

  useEffect(() => bibProvider.subscribe(() => setReferenceVersion((version) => version + 1)), [])
  const references = bibProvider.getAll()

  useEffect(() => {
    if (dragRef.current) return
    const next = geometryFromAttrs(attrs)
    latestGeometryRef.current = next
    setGeometry(next)
  }, [attrs.widthPct, attrs.xPct, attrs.heightPx])

  useEffect(() => {
    if (attrs.addedAt) return
    const getAddedAt = (extension.options as { getAddedAt?: (assetId: string) => string | null }).getAddedAt
    const addedAt = getAddedAt?.(attrs.assetId)
    if (addedAt) updateAttributes({ addedAt })
  }, [attrs.addedAt, attrs.assetId, extension.options, updateAttributes])

  useEffect(() => {
    if (!panel) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as globalThis.Node)) setPanel(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    window.addEventListener('pointerdown', closeOnOutsidePress)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePress)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [panel])

  useEffect(() => () => {
    const listeners = dragListenersRef.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.move)
    window.removeEventListener('pointerup', listeners.finish)
    window.removeEventListener('pointercancel', listeners.finish)
    document.body.classList.remove('iw-media-image-is-dragging')
  }, [])

  const figureStyle = useMemo(() => ({
    width: `${geometry.widthPct}%`,
    marginLeft: `${geometry.xPct}%`,
    marginRight: 0,
  }), [geometry.widthPct, geometry.xPct])

  function beginDrag(mode: ImageDragMode, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const figure = figureRef.current
    if (!figure) return
    const image = figure.querySelector<HTMLImageElement>('.iw-media-image__img')
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: geometry,
      parentWidth: figure.parentElement?.getBoundingClientRect().width || figure.getBoundingClientRect().width,
      renderedHeight: image?.getBoundingClientRect().height || figure.getBoundingClientRect().height,
    }
    document.body.classList.add('iw-media-image-is-dragging')

    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const next = dragImageGeometry(
        drag.start,
        drag.mode,
        moveEvent.clientX - drag.startX,
        moveEvent.clientY - drag.startY,
        drag.parentWidth,
        drag.renderedHeight,
      )
      latestGeometryRef.current = next
      setGeometry(next)
    }
    const finish = () => {
      const next = latestGeometryRef.current
      dragRef.current = null
      dragListenersRef.current = null
      document.body.classList.remove('iw-media-image-is-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      updateAttributes(next)
    }
    dragListenersRef.current = { move, finish }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function editTitle() {
    setDraftTitle(String(attrs.title ?? ''))
    setEditingTitle(true)
    requestAnimationFrame(() => {
      const input = titleInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  function openDetails(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDraftSource(String(attrs.source ?? ''))
    setDraftSourceCitekey(String(attrs.sourceCitekey ?? ''))
    const width = 320
    const left = Math.max(12, Math.min(event.clientX, window.innerWidth - width - 12))
    const top = Math.max(12, Math.min(event.clientY, window.innerHeight - 270))
    setPanel({ left, top })
  }

  const detailsPanel = panel && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      className="iw-media-image__details iw-nightable iw-touch-guard"
      role="dialog"
      aria-label="Image details"
      style={{ left: panel.left, top: panel.top }}
      onContextMenu={(event) => event.preventDefault()}
      contentEditable={false}
    >
      <label>
        <span>Reference in this document</span>
        <select
          value={draftSourceCitekey}
          onChange={(event) => {
            const citekey = event.target.value
            setDraftSourceCitekey(citekey)
            if (!citekey) {
              updateAttributes({ sourceCitekey: '' })
              return
            }
            const item = bibProvider.get(citekey)
            if (!item) return
            const source = sourceForReference(item)
            setDraftSource(source)
            updateAttributes({ sourceCitekey: citekey, source })
          }}
        >
          <option value="">No linked reference</option>
          {references.map((item) => <option key={item.id} value={item.id}>{referenceLabel(item)}</option>)}
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          setPanel(null)
          openCitationPanel({ newReference: true })
        }}
      >
        Add new reference
      </button>
      <label>
        <span>Web address or description</span>
        <input
          value={draftSource}
          placeholder="Webpage URL or description, e.g. screenshot"
          onChange={(event) => {
            const source = event.target.value
            setDraftSource(source)
            setDraftSourceCitekey('')
            updateAttributes({ source, sourceCitekey: '' })
          }}
          autoFocus
        />
      </label>
      {/^https?:\/\//i.test(draftSource.trim()) && <a
        className="iw-media-image__open-source"
        href={draftSource.trim()}
        target="_blank"
        rel="noopener noreferrer"
      >Open source ↗</a>}
      <button
        type="button"
        onClick={() => updateAttributes({ captionPosition: attrs.captionPosition === 'top' ? 'bottom' : 'top' })}
      >
        {attrs.captionPosition === 'top' ? 'Move title underneath' : 'Move title to top'}
      </button>
    </div>,
    document.body,
  ) : null

  return <>
    <NodeViewWrapper
      ref={figureRef}
      as="figure"
      className={`iw-media-image${selected ? ' ProseMirror-selectednode' : ''}${panel ? ' iw-media-image--details-open' : ''}`}
      data-asset-id={attrs.assetId}
      data-sha256={attrs.sha256 || undefined}
      data-added-at={attrs.addedAt || undefined}
      data-caption-position={attrs.captionPosition || 'bottom'}
      data-caption-font-family={attrs.captionFontFamily || undefined}
      data-width-pct={geometry.widthPct}
      data-height-px={geometry.heightPx || undefined}
      data-x-pct={geometry.xPct}
      style={figureStyle}
      contentEditable={false}
      onMouseDown={(event: ReactMouseEvent<HTMLElement>) => {
        if (event.button !== 2) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLElement>) => openDetails(event)}
    >
      <StoredMediaFigureContents
        attrs={{ ...attrs, ...geometry }}
        pictureProps={{
          onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => beginDrag('move-x', event),
          title: 'Drag left or right to move. Right-click for image details.',
        }}
        onTitleClick={editTitle}
        onSourceClick={(event) => openDetails(event)}
        titleEditor={editingTitle ? <input
          ref={titleInputRef}
          className="iw-media-image__title-input"
          aria-label="Image title"
          value={draftTitle}
          size={Math.max(1, draftTitle.length + 1)}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const title = event.target.value
            setDraftTitle(title)
            updateAttributes({ title })
          }}
          onBlur={() => setEditingTitle(false)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              titleInputRef.current?.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              const title = String(attrs.title ?? '')
              setDraftTitle(title)
              setEditingTitle(false)
            }
          }}
        /> : undefined}
        pictureOverlay={<>
          <span
            className="iw-media-image__resize iw-media-image__resize--width"
            role="button"
            aria-label="Resize image width"
            onPointerDown={(event) => beginDrag('resize-width', event)}
          />
          <span
            className="iw-media-image__resize iw-media-image__resize--height"
            role="button"
            aria-label="Resize image height"
            onPointerDown={(event) => beginDrag('resize-height', event)}
          />
          <span
            className="iw-media-image__resize iw-media-image__resize--both"
            role="button"
            aria-label="Resize image width and height"
            onPointerDown={(event) => beginDrag('resize-both', event)}
          />
          {geometry.xPct > 0.05 && <span
            className="iw-media-image__resize iw-media-image__resize--both-left"
            role="button"
            aria-label="Resize image proportionally from bottom left"
            onPointerDown={(event) => beginDrag('resize-both-left', event)}
          />}
        </>}
      />
    </NodeViewWrapper>
    {detailsPanel}
  </>
}

function sourceForReference(item: CSLItem): string {
  const meta = (item as { _iw?: IwCitationMeta })._iw
  const direct = meta?.sourceUrl ?? item.URL
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof item.DOI === 'string' && item.DOI.trim()) return `https://doi.org/${item.DOI.trim()}`
  return String(item.title ?? item.id)
}

function referenceLabel(item: CSLItem): string {
  const author = item.author?.[0]?.family ?? item.author?.[0]?.literal
  const year = item.issued?.['date-parts']?.[0]?.[0]
  const lead = [author, year].filter(Boolean).join(', ')
  const title = String(item.title ?? item.id)
  return lead ? `${lead} — ${title}` : title
}
