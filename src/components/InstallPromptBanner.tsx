// Shows a one-time install nudge after 10 minutes of use.
// Appears on Chrome/Edge (any platform) when the PWA install prompt is available,
// and on iOS (share-sheet instructions). Never shows if already running as an installed PWA.

import { useEffect, useRef, useState } from 'react'

const FIRST_VISIT_KEY = 'inkwave:first-visit'
const DISMISSED_KEY   = 'inkwave:install-nudge-dismissed'
const DELAY_MS        = 10 * 60 * 1000  // 10 minutes

const INK = '#35283e'

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
  // iPadOS 13+ masquerades as macOS Safari — the UA says "Macintosh" but a Mac has no touch
  // points. Without this, iPads (the platform where the PWA matters most) never saw the banner.
  return /iPhone|iPod/i.test(navigator.userAgent)
    || (/Macintosh|iPad/i.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1)
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
      boxShadow: '0 8px 32px rgb(var(--iw-ink-rgb) / 0.18)',
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
        <div style={{ background: 'rgb(var(--iw-ink-rgb) / 0.06)', borderRadius: '8px', padding: '10px 12px', fontSize: '0.8rem', color: '#4a3f3a', lineHeight: 1.5 }}>
          Tap the&nbsp;
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 5px', background: '#007AFF', color: 'white', borderRadius: 4, verticalAlign: 'middle' }}>
            <svg width="10" height="13" viewBox="0 0 10 13" fill="none" aria-hidden="true" style={{ display: 'block' }}>
              <path d="M5 8V1M5 1L2.5 3.5M5 1L7.5 3.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 7V11C1 11.2761 1.22386 11.5 1.5 11.5H8.5C8.77614 11.5 9 11.2761 9 11V7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </span>
          &nbsp;share button (just above the address bar on iPhone; top right of the toolbar on iPad), then <strong>Add to Home Screen</strong>
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
