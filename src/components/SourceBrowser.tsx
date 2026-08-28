// THE IN-APP SOURCE READER — read the page a citation points at without leaving the document.
//
// Peter, 2026-08-28: "we need to find a way to have an inbuilt browser open up the webpage in
// question for e.g. Stanford EP articles. ChatGPT has managed to do this so I don't see why we
// can't." We can, and for the source he named it needs no server at all.
//
// ⚠ WHAT THIS IS, AND THE ONE THING IT CANNOT DO — measured, not assumed (2026-08-28):
//   • plato.stanford.edu sends NO `X-Frame-Options` and no frame-ancestors CSP ⇒ it FRAMES. So the
//     reader is a plain <iframe>: no proxy, no server, nothing of what you read passes through
//     Inkwave, and the request goes from your browser to theirs exactly as it would in a tab.
//   • plato.stanford.edu sends NO `Access-Control-Allow-Origin` ⇒ we CANNOT fetch its HTML from the
//     page. Which means we cannot render it in our own DOM, which means WE CANNOT SEE YOUR
//     SELECTION INSIDE IT. That is the browser's cross-origin boundary, not a gap in this file, and
//     no amount of code on this side removes it. "Highlight the heading to cite it" therefore works
//     in the PDF viewer (our own DOM, our own text layer) and NOT here. Making it work for the web
//     needs the page fetched by our server — the `api/pdf.mjs?proxy=` path this repo deleted on
//     purpose in 2026-07-08 as "the one PDF path through our server". That is a privacy decision,
//     and it is Peter's, so it is not taken here.
//   • Sites that refuse framing (JSTOR sends X-Frame-Options: DENY — checked) cannot be shown. The
//     panel SAYS SO and offers the tab, rather than presenting an empty white rectangle: a blank
//     frame and a slow frame look identical, and guessing which is how a reader concludes the
//     feature is broken.
//
// The frame is `sandbox`ed to scripts + same-origin-to-itself + forms + popups-by-user-gesture:
// enough for a modern article to render and for its own internal links to work, without granting it
// top-level navigation (it must never be able to replace the writer's document with a web page).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const INK = '#5c2d8a'

/** Hosts known to refuse framing, so the panel can say so BEFORE showing an empty rectangle. A
 *  short, honest list — it is a courtesy, not a security control, and the load timeout below is
 *  what actually catches the general case. */
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i]

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}
export function likelyRefusesFraming(url: string): boolean {
  const h = hostOf(url)
  return !!h && KNOWN_NO_FRAME.some((re) => re.test(h))
}

export function SourceBrowser({ url, title, onClose }: { url: string; title?: string | null; onClose: () => void }) {
  const [blocked, setBlocked] = useState(() => likelyRefusesFraming(url))
  const loadedRef = useRef(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  // A refused frame fires no error event — the browser simply never loads it. So the detector is a
  // deadline: nothing loaded by then and we stop pretending. Generous, because a cold SEP entry on
  // a slow connection is a real several seconds and calling that "blocked" would be the worse lie.
  useEffect(() => {
    if (blocked) return
    const t = setTimeout(() => { if (!loadedRef.current) setBlocked(true) }, 9000)
    return () => clearTimeout(t)
  }, [blocked, url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center" style={{ background: 'rgba(30,22,45,0.42)' }}
      onMouseDown={onClose}>
      <div className="iw-nightable iw-touch-guard flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 'min(1100px, 94vw)', height: 'min(860px, 90vh)', border: `1px solid ${INK}44` }}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200" style={{ fontSize: '13px' }}>
          <span style={{ color: INK, fontWeight: 600 }}>{title || hostOf(url)}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-stone-400" style={{ fontSize: '11px', flex: 1 }}>{url}</span>
          <a href={url} target="_blank" rel="noreferrer noopener" className="underline whitespace-nowrap" style={{ color: INK, fontSize: '12px' }}>
            open in a tab ↗
          </a>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#78716c', fontSize: '20px', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {blocked ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: '#57534e', fontSize: '14px' }}>
            <div style={{ fontSize: '15px', color: INK }}>{hostOf(url)} won’t open inside another page.</div>
            <div style={{ maxWidth: 460, lineHeight: 1.5 }}>
              That’s the publisher’s choice, sent as a header with the page — nothing here can override it.
              Stanford Encyclopedia entries and most open-access sources do open here.
            </div>
            <a href={url} target="_blank" rel="noreferrer noopener"
              className="rounded-full px-3 py-1.5 text-white"
              style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>
              Open it in a tab ↗
            </a>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            src={url}
            title={title || url}
            onLoad={() => { loadedRef.current = true }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
          />
        )}

        {/* The honest footer. A reader who selects a heading in here and finds nothing happens will
            assume the feature is broken; saying why costs one line. */}
        <div className="px-3 py-1.5 border-t border-stone-200 text-stone-400" style={{ fontSize: '11px' }}>
          Reading only — your browser keeps this page separate from Inkwave, so text selected in here can’t be
          picked up. To cite a section, type it in the citation’s locator (§, ¶, ch.).
        </div>
      </div>
    </div>,
    document.body,
  )
}
