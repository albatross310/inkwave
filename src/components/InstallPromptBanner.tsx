// Shows a one-time install nudge after 10 minutes of use.
// Appears on Chrome/Edge (any platform) when the PWA install prompt is available,
// and on iOS (share-sheet instructions). Never shows if already running as an installed PWA.

import { useEffect, useRef, useState } from 'react'

const FIRST_VISIT_KEY = 'inkwave:first-visit'
const DISMISSED_KEY   = 'inkwave:install-nudge-dismissed'
const DELAY_MS        = 10 * 60 * 1000  // 10 minutes

const INK = '#5c2d8a'

function isAlreadyInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true
}

function isDismissed() {
  try { return !!localStorage.getItem(DISMISSED_KEY) } catch { return false }
}

function dismiss() {
  try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* private mode */ }
}

function recordFirstVisit() {
  try {
    if (!localStorage.getItem(FIRST_VISIT_KEY)) {
      localStorage.setItem(FIRST_VISIT_KEY, String(Date.now()))
    }
  } catch { /* private mode */ }
}

function msSinceFirstVisit(): number {
  try {
    const t = localStorage.getItem(FIRST_VISIT_KEY)
    return t ? Date.now() - Number(t) : 0
  } catch { return 0 }
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

// Should we show anything? Need either a Chrome/Edge install prompt or iOS share instructions.
function canNudge(installPrompt: any) {
  return !!installPrompt || isIOS()
}

export function InstallPromptBanner({ installPrompt }: { installPrompt: any }) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    recordFirstVisit()
    if (isAlreadyInstalled() || isDismissed() || !canNudge(installPrompt)) return

    const elapsed = msSinceFirstVisit()
    const remaining = Math.max(0, DELAY_MS - elapsed)
    timerRef.current = setTimeout(() => setVisible(true), remaining)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [installPrompt])

  // If the install prompt arrives after the 10 min mark, show immediately.
  useEffect(() => {
    if (isAlreadyInstalled() || isDismissed()) return
    if (canNudge(installPrompt) && msSinceFirstVisit() >= DELAY_MS) setVisible(true)
  }, [installPrompt])

  if (!visible) return null

  const ios = isIOS()

  function close() { dismiss(); setVisible(false) }

  async function install() {
    if (installPrompt) {
      installPrompt.prompt()
      const { outcome } = await (installPrompt as any).userChoice
      if (outcome === 'accepted') { dismiss(); setVisible(false) }
    }
  }

  return (
    <div style={{
      position: 'fixed', bottom: '80px', right: '16px',
      width: 'min(320px, calc(100vw - 32px)',
      zIndex: 300,
      background: 'white', border: `1px solid ${INK}44`,
      borderRadius: '14px', padding: '16px 18px 14px',
      boxShadow: '0 8px 32px rgba(92,45,138,0.18)',
      fontFamily: 'IM Fell DW Pica, serif',
    }}>
      <button
        type="button" onClick={close} aria-label="Dismiss"
        style={{ position: 'absolute', top: '10px', right: '14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#a89d96', lineHeight: 1 }}
      >✕</button>

      <p style={{ margin: '0 0 6px', fontWeight: 600, color: INK, fontSize: '0.95rem' }}>
        Enjoying Inkwave?
      </p>
      <p style={{ margin: '0 0 12px', color: '#5a504a', fontSize: '0.82rem', lineHeight: 1.45 }}>
        Install the free app to open and sync all your Studio notes and projects on the fly — no App Store needed.
      </p>

      {ios ? (
        <div style={{ background: 'rgba(92,45,138,0.06)', borderRadius: '8px', padding: '10px 12px', fontSize: '0.8rem', color: '#4a3f3a', lineHeight: 1.5 }}>
          Tap the iOS share button&nbsp;
          <span style={{ display: 'inline-block', padding: '0 3px 1px', background: '#007AFF', color: 'white', borderRadius: 4, fontSize: '0.75rem', verticalAlign: 'middle', lineHeight: '1.4' }}>↑</span>
          &nbsp;in the browser toolbar, then <strong>Add to Home Screen</strong>
        </div>
      ) : (
        <button
          type="button" onClick={install}
          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: 'none', background: INK, color: 'white', fontSize: '0.88rem', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500 }}
        >
          Install Inkwave — it's free
        </button>
      )}

      <button
        type="button" onClick={close}
        style={{ display: 'block', width: '100%', marginTop: '8px', padding: '5px', background: 'none', border: 'none', color: '#a89d96', fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer' }}
      >
        Maybe later
      </button>
    </div>
  )
}
