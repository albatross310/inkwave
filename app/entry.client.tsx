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
// The water (aqua gradient + wave tiles) is gated behind .iw-water-ready: decode EVERY wave tile
// FIRST, then stamp the class — colour and waves paint in the same style recalc instead of
// "blue first, waves a few frames later". Fallback timer covers decode() quirks. The generated
// twinkle layers (waveTwinkle.ts) pre-decode their own tiles before each mounts. REFRESH: root.tsx
// carries a pre-paint inline script that stamps the class immediately when the flag below says the
// tiles have decoded on this client before — the neutral-parchment hold is a COLD-load device
// only, so a refresh never flashes parchment→aqua again (the 2026-07-09 "refresh flash").
{
  const ready = () => {
    document.documentElement.classList.add('iw-water-ready')
    try { localStorage.setItem('inkwave:waterReady', '1') } catch { /* private mode */ }
  }
  if (document.documentElement.classList.contains('iw-water-ready')) {
    // Pre-stamped by the head script (warm client) — nothing to gate.
  } else {
    const surface = document.querySelector('.inkwave-editor-surface')
    const urls: string[] = []
    if (surface) {
      const cs = getComputedStyle(surface)
      // Decode every wave-tile var the water uses (the sparkle tile taught us: any wave layer the
      // gate does NOT decode pops in a few frames late, a visible hitch at a consistent time).
      for (const v of ['--iw-wave-a', '--iw-wave-b']) {
        const m = cs.getPropertyValue(v).match(/url\("(.+)"\)/)
        if (m) urls.push(m[1])
      }
    }
    if (urls.length === 0) ready()
    else {
      const t = setTimeout(ready, 500) // decode() should take ~a frame; never hold the water hostage
      void Promise.all(urls.map((u) => { const img = new Image(); img.src = u; return img.decode() }))
        .catch(() => {})
        .then(() => { clearTimeout(t); ready() })
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
