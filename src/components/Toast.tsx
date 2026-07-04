// Minimal transient toast, mounted once in the editor. Listens for inkwave:toast and shows the
// message centred at the bottom for a few seconds (or until dismissed).

import { useEffect, useState } from 'react'
import { CITATION_TOAST_EVENT } from '../citations/citationToast'

const INK = '#5c2d8a'

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
      onClick={() => setMsg(null)}
      style={{
        position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
        maxWidth: 'min(460px, 92vw)', background: '#fff', color: '#3a3a3a',
        border: `1px solid ${INK}44`, borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        padding: '12px 16px', fontSize: '0.92rem', lineHeight: 1.45, cursor: 'pointer',
        fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif',
      }}
    >
      <span style={{ color: INK, fontWeight: 600, marginRight: 6 }}>✦</span>{msg}
    </div>
  )
}
