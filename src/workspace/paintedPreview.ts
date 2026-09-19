import { scaleFor } from '../editor/magnify'

// A bounded cache of inert, last-painted workspace panels.
//
// The interactive swipe used to approximate neighbours from JSON with its own font, margins and
// application chrome. The real editor necessarily corrected that approximation when it mounted,
// producing the visible post-slide lurch. A detached clone of the already-painted magnify box is
// the browser-native equivalent of a desktop thumbnail: no second EditorView, observers, storage,
// signing or event handlers, but exactly the pixels/geometry the writer last saw.

export interface PaintedWorkspacePreview {
  box: HTMLElement
  surface: HTMLElement
  left: number
  top: number
  surfaceVariables: Record<string, string>
  version?: string
  layoutSignature: string
  viewportWidth: number
  viewportHeight: number
  boxWidth: number
  nativeFit: boolean
}

const previews = new Map<string, PaintedWorkspacePreview>()
let persistedLoaded = false
const MAX_PREVIEWS = 2
const PERSISTED_KEY = 'inkwave:workspace-painted-v1'
const MAX_PREVIEW_HTML = 250_000
const SURFACE_VARIABLES = [
  '--iw-editor-zoom',
  '--iw-magnify',
  '--iw-page-side-margin',
  '--iw-page-top-margin',
  '--iw-page-bottom-margin',
  '--para-spacing',
] as const

function layoutSignature(id: string): string {
  try {
    return JSON.stringify([
      'sideMargin', 'topMargin', 'btmMargin', 'paraSpacing', 'columns', 'paperSize', 'orientation', 'gappedPages',
      `editorZoom:document:${id}`, `editorZoom:email:${id}`, `applicationSurface:email:mode:${id}`,
      'applicationSurface:email:isolated:widthScale', 'applicationSurface:email:contextual:widthScale',
    ].map((key) => localStorage.getItem(`inkwave:${key}`)))
  } catch { return '' }
}

function persistPreviews(): void {
  try {
    const rows = [...previews].flatMap(([id, preview]) => {
      const html = preview.box.outerHTML
      if (html.length > MAX_PREVIEW_HTML) return []
      return [[id, { ...preview, box: html, surface: preview.surface.outerHTML }]]
    })
    sessionStorage.setItem(PERSISTED_KEY, JSON.stringify(rows))
  } catch { /* a regenerable local viewport cache must never block navigation */ }
}

function readPersistedPreview(id: string): PaintedWorkspacePreview | null {
  try {
    const raw = sessionStorage.getItem(PERSISTED_KEY)
    if (!raw || raw.length > (MAX_PREVIEW_HTML + 15_000) * MAX_PREVIEWS) return null
    const rows = JSON.parse(raw) as [string, Omit<PaintedWorkspacePreview, 'box' | 'surface'> & { box: string; surface: string }][]
    if (!Array.isArray(rows) || rows.length > MAX_PREVIEWS) return null
    const saved = rows.find(([key]) => key === id)?.[1]
    if (!saved || typeof saved.box !== 'string' || saved.box.length > MAX_PREVIEW_HTML
      || typeof saved.surface !== 'string' || saved.surface.length > 10_000) return null
    const template = document.createElement('template')
    template.innerHTML = saved.box
    const box = template.content.firstElementChild as HTMLElement | null
    template.innerHTML = saved.surface
    const surface = template.content.firstElementChild as HTMLElement | null
    if (!box?.classList.contains('iw-magnify-box') || !surface?.classList.contains('iw-workspace-preview-surface')) return null
    return { ...saved, box, surface }
  } catch { return null }
}

function restorePersistedPreviews(): void {
  if (persistedLoaded) return
  persistedLoaded = true
  try {
    const rows = JSON.parse(sessionStorage.getItem(PERSISTED_KEY) || '[]') as [string, unknown][]
    if (!Array.isArray(rows) || rows.length > MAX_PREVIEWS) return
    for (const [id] of rows) {
      const preview = readPersistedPreview(id)
      if (preview) previews.set(id, preview)
    }
  } catch { /* no previous local paint */ }
}

function copyLiveFormValues(source: HTMLElement, clone: HTMLElement): void {
  const sourceFields = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  const cloneFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  sourceFields.forEach((field, index) => {
    const copy = cloneFields[index]
    if (!copy) return
    if (copy instanceof HTMLInputElement && field instanceof HTMLInputElement) {
      copy.value = field.value
      copy.checked = field.checked
      copy.setAttribute('value', field.value)
      copy.toggleAttribute('checked', field.checked)
    } else if (copy instanceof HTMLTextAreaElement && field instanceof HTMLTextAreaElement) {
      copy.value = field.value
      copy.textContent = field.value
    } else if (copy instanceof HTMLSelectElement && field instanceof HTMLSelectElement) {
      copy.value = field.value
      ;[...copy.options].forEach((option, index) => option.toggleAttribute('selected', field.options[index]?.selected ?? false))
    }
  })
}

function makeInert(root: HTMLElement): void {
  root.removeAttribute('id')
  root.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'))
  root.querySelectorAll<HTMLElement>('[contenteditable], [tabindex]').forEach((element) => {
    element.setAttribute('contenteditable', 'false')
    element.setAttribute('tabindex', '-1')
  })
  root.querySelectorAll<HTMLElement>('button, input, textarea, select, a').forEach((element) => {
    element.setAttribute('tabindex', '-1')
    element.setAttribute('aria-hidden', 'true')
  })
  root.querySelectorAll<HTMLElement>('[aria-label], [aria-labelledby], [role]').forEach((element) => {
    element.removeAttribute('aria-label')
    element.removeAttribute('aria-labelledby')
    element.removeAttribute('role')
  })
}

/** Retain only what intersected the viewport. The clone keeps exact layout coordinates for those
 * blocks, but a thesis-length offscreen tail never becomes a second resident document tree. */
function cropToPaintedViewport(sourceBox: HTMLElement, cloneBox: HTMLElement, viewport: DOMRect): void {
  const sourceEditor = sourceBox.querySelector('.ProseMirror') as HTMLElement | null
  const cloneEditor = cloneBox.querySelector('.ProseMirror') as HTMLElement | null
  if (sourceEditor && cloneEditor) {
    const sourceBlocks = [...sourceEditor.children] as HTMLElement[]
    const cloneBlocks = [...cloneEditor.children] as HTMLElement[]
    cloneEditor.style.position = 'relative'
    cloneEditor.style.height = `${sourceEditor.scrollHeight}px`
    const editorRect = sourceEditor.getBoundingClientRect()
    const scale = scaleFor(sourceEditor)
    sourceBlocks.forEach((block, index) => {
      const copy = cloneBlocks[index]
      if (!copy) return
      const rect = block.getBoundingClientRect()
      const visible = rect.bottom >= viewport.top - 120 && rect.top <= viewport.bottom + 120
      if (!visible) {
        copy.remove()
        return
      }
      copy.style.position = 'absolute'
      // offsetTop belongs to the nearest positioned ancestor, which need not be ProseMirror.
      // The cloned editor IS the containing block, so derive its coordinates in one visual space.
      copy.style.top = `${(rect.top - editorRect.top) / scale}px`
      copy.style.left = `${(rect.left - editorRect.left) / scale}px`
      copy.style.width = `${rect.width / scale}px`
      copy.style.margin = '0'
    })
  }

  for (const selector of ['.inkwave-sheet', '.iw-page-guides > div']) {
    const sourceNodes = [...sourceBox.querySelectorAll<HTMLElement>(selector)]
    const cloneNodes = [...cloneBox.querySelectorAll<HTMLElement>(selector)]
    sourceNodes.forEach((node, index) => {
      const rect = node.getBoundingClientRect()
      if (rect.bottom < viewport.top - 120 || rect.top > viewport.bottom + 120) cloneNodes[index]?.remove()
    })
  }
  cloneBox.setAttribute('data-iw-workspace-preview-cropped', '')
}

/** Capture only a settled live panel. A box already being swiped has an intentional translation
 * and must never overwrite its good at-rest thumbnail. */
export function capturePaintedWorkspacePreview(documentId: string, version?: string): boolean {
  if (!documentId || typeof document === 'undefined') return false
  // Hydrate both bounded entries before the first live capture writes back. Otherwise the newly
  // loaded active panel would erase its persisted neighbour before async document listing finds it.
  restorePersistedPreviews()
  const surface = document.querySelector('.inkwave-editor-surface.iw-fill:not(.iw-workspace-preview-surface)') as HTMLElement | null
  const box = surface?.querySelector(':scope > .iw-magnify-box') as HTMLElement | null
  if (!surface || !box || box.hasAttribute('data-iw-workspace-swipe-card')) return false

  const surfaceRect = surface.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  const clone = box.cloneNode(true) as HTMLElement
  const scope = surface.cloneNode(false) as HTMLElement
  scope.classList.remove('iw-fill', 'iw-wave-anim', 'iw-wave-coast', 'iw-wave-covered')
  scope.classList.add('iw-workspace-preview-surface')
  scope.removeAttribute('id')
  scope.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;padding:0;margin:0;overflow:visible;background:none;opacity:1;transition:none;'
  scope.style.left = `${surfaceRect.left}px`
  scope.style.top = `${surfaceRect.top}px`
  scope.style.width = `${surfaceRect.width}px`
  scope.style.height = `${surfaceRect.height}px`
  copyLiveFormValues(box, clone)
  cropToPaintedViewport(box, clone, surfaceRect)
  makeInert(clone)

  // The transform/zoom selectors are scoped to the real editor surface. Freeze the computed face
  // inline so the detached preview cannot choose a different raster path.
  const sourcePaper = box.firstElementChild as HTMLElement | null
  const clonePaper = clone.firstElementChild as HTMLElement | null
  if (sourcePaper && clonePaper) {
    const style = getComputedStyle(sourcePaper)
    clonePaper.style.transform = style.transform === 'none' ? 'none' : style.transform
    clonePaper.style.transformOrigin = style.transformOrigin
    clonePaper.style.setProperty('zoom', style.getPropertyValue('zoom') || '1')
  }
  clone.style.position = 'absolute'
  clone.style.left = '0'
  clone.style.top = '0'
  clone.style.margin = '0'
  clone.style.transform = 'none'
  clone.style.willChange = 'auto'

  const computedSurface = getComputedStyle(surface)
  const surfaceVariables: Record<string, string> = {}
  for (const name of SURFACE_VARIABLES) {
    const value = computedSurface.getPropertyValue(name)
    if (value) surfaceVariables[name] = value
  }
  previews.delete(documentId)
  previews.set(documentId, {
    box: clone,
    surface: scope,
    left: boxRect.left - surfaceRect.left,
    top: boxRect.top - surfaceRect.top,
    surfaceVariables,
    version,
    layoutSignature: layoutSignature(documentId),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    boxWidth: boxRect.width,
    nativeFit: !!box.querySelector('.iw-application-paper'),
  })
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!)
  persistPreviews()
  return true
}

export function hasPaintedWorkspacePreview(documentId: string): boolean {
  return previews.has(documentId)
}

/** Mount a fresh inert clone; a cached node is never moved between React-owned hosts. */
export function mountPaintedWorkspacePreview(documentId: string, host: HTMLElement, version?: string): boolean {
  host.replaceChildren()
  const preview = previews.get(documentId) ?? readPersistedPreview(documentId)
  if (!preview) return false
  const resized = window.innerWidth !== preview.viewportWidth || window.innerHeight !== preview.viewportHeight
  if (preview.version !== version || preview.layoutSignature !== layoutSignature(documentId)
    || (preview.nativeFit && resized)) return false
  for (const [name, value] of Object.entries(preview.surfaceVariables)) host.style.setProperty(name, value)
  const box = preview.box.cloneNode(true) as HTMLElement
  // Fixed manuscript layout retains its actual visual scale. Re-centre only the space around it;
  // a native-fit email instead invalidates above because its text really reflows on width change.
  const centreDelta = resized
    ? Math.max(0, (window.innerWidth - preview.boxWidth) / 2) - Math.max(0, (preview.viewportWidth - preview.boxWidth) / 2)
    : 0
  box.style.left = `${preview.left + centreDelta}px`
  box.style.top = `${preview.top}px`
  const scope = preview.surface.cloneNode(false) as HTMLElement
  if (resized) {
    scope.style.width = `${Number.parseFloat(scope.style.width) + window.innerWidth - preview.viewportWidth}px`
    scope.style.height = `${Number.parseFloat(scope.style.height) + window.innerHeight - preview.viewportHeight}px`
  }
  for (const [name, value] of Object.entries(preview.surfaceVariables)) scope.style.setProperty(name, value)
  scope.appendChild(box)
  host.appendChild(scope)
  return true
}

/** Tests and HMR may otherwise retain detached documents across runs. */
export function clearPaintedWorkspacePreviews(): void {
  previews.clear()
  persistedLoaded = false
  try { sessionStorage.removeItem(PERSISTED_KEY) } catch { /* private mode */ }
}
