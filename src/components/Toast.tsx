// Minimal transient toast, mounted once in the editor. Listens for inkwave:toast and shows the
// message centred at the bottom for a few seconds (or until dismissed).

import { useEffect, useState } from 'react'
import { CITATION_TOAST_EVENT } from '../citations/citationToast'

// A floating panel, so it takes the shared chrome surface via `iw-nightable` (which supplies the
// dolphin-grey fill and light text with `!important`, overriding the inline day values below). The
// ✦ must therefore resolve --iw-ink — that token is LIGHT purple inside night chrome, and the day
// literal #5c2d8a on #454e59 measures 1.5:1, the exact bug --iw-on-ink was introduced for.
const INK = 'var(--iw-ink, #5c2d8a)'

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onToast = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text
      if (!text) return
      setMsg(text)
      clearTimeout(timer)
      timer = setTimeout(() => setMsg(null), 8000)
    }
    window.addEventListener(CITATION_TOAST_EVENT, onToast)
    return () => { window.removeEventListener(CITATION_TOAST_EVENT, onToast); clearTimeout(timer) }
  }, [])

  if (!msg) return null
  return (
    <div
      role="status"
      className="iw-nightable"
      onClick={() => setMsg(null)}
      style={{
        position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
        maxWidth: 'min(460px, 92vw)', background: '#fff', color: '#3a3a3a',
        border: `1px solid var(--iw-nightable-border, rgba(92,45,138,0.27))`, borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        padding: '12px 16px', fontSize: '0.92rem', lineHeight: 1.45, cursor: 'pointer',
        fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif',
      }}
    >
      <span style={{ color: INK, fontWeight: 600, marginRight: 6 }}>✦</span>{msg}
    </div>
  )
}
