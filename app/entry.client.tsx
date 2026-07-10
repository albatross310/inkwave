import { startTransition, StrictMode, useEffect, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

// Build marker — confirms the live build in the console (helps catch stale-cache situations).
console.log(`%c[inkwave] build: ${__BUILD_ID__}`, 'color:#5c2d8a;font-weight:bold')

// Apply the saved theme (night/day) before hydration so a night-mode reader doesn't flash light.
import { applyTheme } from '../src/editor/theme'
applyTheme()

// Wrap the app in Clerk ONLY when configured (paid-tier auth, M6). Dynamic import keeps Clerk out
// of the bundle entirely when unconfigured, and entry.client is client-only so it never touches
// the prerender/SSR build. The publishable key is public (safe in the client).
async function bootstrap() {
  const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
  // Only mount Clerk when auth is explicitly requested (?auth) — NOT on every free-tier load, where
  // its multi-second dev-instance init is the startup CPU whir. Same gate as authEnabled() so the
  // provider is present exactly when the auth UI (AccountControl / /login) renders. See auth/config.
  const { authRequested, markClerkProviderMounted } = await import('../src/auth/config')
  let tree: ReactNode = <HydratedRouter />
  if (pk && authRequested()) {
    // Record the mount BEFORE hydration: AccountControl branches on this (provider hooks vs the
    // headless clerk-js path) and must never see a half-set state.
    markClerkProviderMounted()
    // Same tripwire as the headless path: a CSP-blocked Clerk request must never fail silently.
    const { installClerkCspGuard } = await import('../src/auth/clerkHeadless')
    installClerkCspGuard()
    const { ClerkProvider, useClerk } = await import('@clerk/clerk-react')
    // After the lazy "Sign in" armed auth + reloaded, open the sign-in modal automatically (one-click).
    const AutoSignIn = () => {
      const clerk = useClerk()
      useEffect(() => {
        try {
          if (sessionStorage.getItem('inkwave:autoSignIn') === '1') {
            sessionStorage.removeItem('inkwave:autoSignIn')
            clerk.openSignIn()
          }
        } catch { /* private mode / not ready */ }
      }, [clerk])
      return null
    }
    tree = <ClerkProvider publishableKey={pk}><AutoSignIn />{tree}</ClerkProvider>
  }
  startTransition(() => {
    hydrateRoot(document, <StrictMode>{tree}</StrictMode>)
  })
}
void bootstrap()

// ─── Atomic water reveal ───
// The water (aqua gradient + wave tiles + ALL twinkle instances) is gated behind .iw-water-ready
// and appears in ONE paint. TWO conditions open the gate (2026-07-10, Peter: "glimmers and short
// lines … need to start atomically even if it takes longer"):
//   1. every wave-tile data-URI has decoded;
//   2. the twinkle field has generated + decoded + MOUNTED (hidden — the not-ready CSS keeps
//      .iw-wave-twinkles display:none) — waveTwinkle.ts announces via 'inkwave:twinkles-ready'
//      (+ the __iwTwinklesReady flag for the fired-before-we-listened race).
// Until both, the page holds the neutral parchment; then colour, waves and twinkles land in the
// same style recalc. The old single-condition gate let the twinkle layers mount LATER, mid-drift —
// on Firefox that late mount re-rastered the wave layers (a blank flash at a consistent moment)
// and the field popped in non-atomically. A generous timeout still opens the gate if anything
// wedges (a decode failure must never hold the page hostage). On gate-open we dispatch
// 'inkwave:water-ready': THAT style recalc creates the wave pseudos' CSS drift animations, and
// waveTwinkle re-anchors its (provisionally-clocked, hidden-mounted) WAAPI animations to the real
// drift's literal startTime in the same frame — drift/blink continuity across the gate.
// REFRESH: the old localStorage pre-stamp (root.tsx head script) opened the gate pre-paint on
// warm clients — which would let the water paint long before the twinkles mount. Removed: every
// load gates identically now (the tiles are data URIs, so "warm" never made decoding faster
// anyway — the wait is hydration-bound either way, and atomicity wins per Peter's directive).
{
  const root = document.documentElement
  let stamped = false
  const ready = () => {
    if (stamped) return
    stamped = true
    root.classList.add('iw-water-ready')
    window.dispatchEvent(new Event('inkwave:water-ready'))
  }
  // GUARD (2026-07-10, the iOS "gradient without waves"): if hydration ever fails, React 18's
  // recovery client-renders <html> from scratch and STRIPS attributes it doesn't render —
  // .iw-water-ready and data-theme both vanished, the wave pseudos went display:none for the whole
  // session (this block had already taken the pre-stamped branch, so nothing re-stamped), and a
  // night client fell back to day. The structural mismatch that triggered it is fixed in
  // Scroll.tsx, but the stamps must survive ANY future recovery: re-assert them the moment they
  // vanish. MutationObserver callbacks are microtasks — they run before the wiped frame can paint,
  // so recovery can never flash parchment or kill the water. A legitimate theme toggle always
  // SETS data-theme (never removes it), so re-applying only when it's absent can't fight Settings.
  new MutationObserver(() => {
    if (stamped && !root.classList.contains('iw-water-ready')) root.classList.add('iw-water-ready')
    if (!root.dataset.theme) applyTheme()
  }).observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  if (root.classList.contains('iw-water-ready')) {
    stamped = true // already stamped (bfcache restore / re-eval) — nothing to gate, guard armed
  } else {
    const surface = document.querySelector('.inkwave-editor-surface')
    if (!surface) ready() // no water on this page — nothing to gate
    else {
      // Condition 1 — the wave tiles. Decode every tile var the water uses (the sparkle tile
      // taught us: any wave layer the gate does NOT decode pops in a few frames late).
      const urls: string[] = []
      const cs = getComputedStyle(surface)
      for (const v of ['--iw-wave-a', '--iw-wave-b']) {
        const m = cs.getPropertyValue(v).match(/url\("(.+)"\)/)
        if (m) urls.push(m[1])
      }
      const tiles = Promise.all(urls.map((u) => { const img = new Image(); img.src = u; return img.decode() })).catch(() => {})
      // Condition 2 — the twinkle field, but only where one will mount: the live-editor (iw-fill)
      // surface's host div. /about, /verify etc. have no twinkles and must not wait 1.5s for them.
      const host = document.querySelector('.inkwave-editor-surface.iw-fill .iw-wave-twinkles')
      const twinkles = !host || (window as unknown as { __iwTwinklesReady?: boolean }).__iwTwinklesReady
        ? Promise.resolve()
        : new Promise<void>((res) => window.addEventListener('inkwave:twinkles-ready', () => res(), { once: true }))
      const t = setTimeout(ready, 1500) // generous — twinkles wait through hydration; never hostage
      void Promise.all([tiles, twinkles]).then(() => { clearTimeout(t); ready() })
    }
  }
}

// Suppress iOS Safari's native pinch zoom app-wide on phones: the proprietary gesture* events are
// the only reliable hook (Safari ignores user-scalable=no in-browser). Our own pinch handlers use
// touch events on their surfaces, so they keep working — this only stops the BROWSER's page zoom
// (over the toolbar, panels, everywhere) from fighting the app's zoom.
if (window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches) {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  }
  // gesture* events alone proved insufficient (2026-07-09): also cancel any two-finger touchmove
  // that nothing upstream handled. The editor's own pinch handler preventDefaults on the surface
  // first; this is the backstop for the toolbar, panels, and everything else.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault()
  }, { passive: false })
}

// PWA file handling (Chrome/Edge/Brave, installed): double-clicking a .inkwave file launches the app
// here with the file handle. Open it (and resume syncing back to it). No-op in browsers without it.
const lq = (window as unknown as { launchQueue?: { setConsumer: (cb: (p: { files?: FileSystemFileHandle[] }) => void) => void } }).launchQueue
if (lq && typeof lq.setConsumer === 'function') {
  lq.setConsumer((params) => {
    const handle = params.files?.[0]
    if (!handle) return
    void (async () => {
      try {
        // Try for write access so edits save back to the opened file.
        try { await (handle as unknown as { requestPermission?: (d: { mode: string }) => Promise<string> }).requestPermission?.({ mode: 'readwrite' }) } catch { /* read-only ok */ }
        const file = await handle.getFile()
        const { openInkwaveFile } = await import('../src/storage/openDoc')
        await openInkwaveFile(file, { handle })
      } catch (err) {
        // Surface parse failures — a renamed plain-text file would otherwise silently do nothing.
        const msg = err instanceof Error ? err.message : 'Could not open file'
        alert(`Inkwave couldn't open this file:\n\n${msg}`)
      }
    })()
  })
}

// ─── Capability floor (iOS/Safari 16.4) ─────────────────────────────────────────
// CompressionStream gates the gzip snapshot archive (provenance/snapshots.ts) and its worker reads.
// Missing on older WebKit → snapshot creation already no-ops gracefully (see createSnapshotIfChanged);
// this banner tells the writer WHY their history features are off. Injected after `load` (post-
// hydration) so the extra node never disturbs React's hydration of the document.
if (typeof CompressionStream === 'undefined') {
  const DISMISS_KEY = 'inkwave:oldBrowserNoticeDismissed'
  let dismissed = false
  try { dismissed = !!localStorage.getItem(DISMISS_KEY) } catch { /* private mode */ }
  if (!dismissed) {
    window.addEventListener('load', () => {
      const bar = document.createElement('div')
      bar.setAttribute('role', 'status')
      bar.style.cssText =
        'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 12px);transform:translateX(-50%);' +
        'z-index:400;max-width:min(30rem,calc(100vw - 2rem));display:flex;align-items:flex-start;gap:10px;' +
        'background:#fff;color:#44403c;border:1px solid rgba(92,45,138,0.45);border-radius:12px;' +
        'padding:10px 12px;font:0.8rem/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(92,45,138,0.18);'
      const msg = document.createElement('span')
      msg.textContent =
        "This browser is too old for Inkwave's history features — update iOS/Safari (16.4+) or use another browser; " +
        'writing still works, provenance snapshots are disabled.'
      const x = document.createElement('button')
      x.type = 'button'
      x.setAttribute('aria-label', 'Dismiss')
      x.textContent = '✕'
      x.style.cssText = 'flex:none;background:none;border:none;cursor:pointer;color:#a89d96;font-size:0.9rem;line-height:1;padding:0;'
      x.onclick = () => {
        bar.remove()
        try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
      }
      bar.append(msg, x)
      document.body.appendChild(bar)
    })
  }
}

// Register the service worker for offline support and PWA install — PRODUCTION ONLY.
// In dev a cache-first SW poisons the dev server: it serves a stale cached app shell and JS,
// so live code changes never appear. So in dev we do the opposite — actively unregister any
// previously-installed worker and clear its caches, which also un-poisons a browser that
// installed the SW during an earlier session.
if (import.meta.env.PROD) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Versioned URL: a new build ⇒ a "new" SW script ⇒ update → cache purge + targeted self-heal.
      navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch((err) => {
        console.warn('[inkwave] SW registration failed:', err)
      })
      // Self-heal, but only when GENUINELY stale: the activating worker broadcasts its version and
      // we reload only if this page was built from an OLDER build. The page that just loaded the
      // new build matches the worker and stays put — no more "loads twice" after every deploy.
      navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data as { type?: string; version?: string } | null
        if (d?.type === 'inkwave-sw-version' && d.version && d.version !== __BUILD_ID__) {
          window.location.reload()
        }
      })
    })
  }
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
}
