/** Small, lazy menu integration. No editor document, provenance or route changes. */
let panel: HTMLDialogElement | null = null
let frame: HTMLIFrameElement | null = null
let priorFocus: HTMLElement | null = null
function close(): void {
  frame?.contentWindow?.postMessage({ type: 'inkwave-readalong:pause' }, window.location.origin)
  panel?.close()
  priorFocus?.focus()
}
export function openReadAlong(returnFocus?: HTMLElement | null): void {
  if (typeof window === 'undefined') return
  priorFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  if (!panel) {
    panel = document.createElement('dialog')
    panel.className = 'iw-nightable'
    panel.setAttribute('aria-label', 'Inkwave Read along')
    panel.style.cssText = 'padding:0;border:0;border-radius:12px;width:calc(100vw - 24px);max-width:1600px;height:calc(100dvh - 24px);max-height:none;background:var(--iw-reader-paper);overflow:hidden;box-shadow:0 12px 80px var(--iw-reader-shadow)'
    frame = document.createElement('iframe')
    frame.title = 'Inkwave Read along — recorded narration and text'
    frame.src = '/readalong/index.html'
    // This frame runs only our static app. Imported books are inert text, never HTML.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals')
    frame.setAttribute('allow', 'autoplay; clipboard-write')
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block'
    panel.append(frame)
    panel.addEventListener('cancel', event => { event.preventDefault(); close() })
    document.body.append(panel)
    window.addEventListener('message', event => {
      if (event.origin === window.location.origin && event.source === frame?.contentWindow && event.data?.type === 'inkwave-readalong:close') close()
    })
  }
  if (!panel.open) panel.showModal()
  frame?.focus()
}
