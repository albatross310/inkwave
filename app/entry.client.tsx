import { startTransition, StrictMode, useEffect, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

// Build marker — confirms the live build in the console (helps catch stale-cache situations).
console.log(`%c[inkwave] build: ${__BUILD_ID__} · ${__BUILD_COMMIT__}`, 'color:#5c2d8a;font-weight:bold')

// Apply the saved theme (night/day) before hydration so a night-mode reader doesn't flash light.
import { applyTheme } from '../src/editor/theme'
applyTheme()

// Flags are togglable via URL so they can be flipped ON A PHONE without a console (mirrors the
// ?auth sticky pattern in auth/config): `?<flag>` sets it sticky ON ('1'), `?<flag>=off` sets it
// OFF ('0'). Runs before the app reads any flag. `=off` must WRITE '0' (not remove the key) —
// arithLayout/renderFill now default ON (they read `!== '0'`), so clearing would re-enable them.
// e.g. `/?renderFill=off` to opt out of phone render-fill, `/?waveVideo` to try the water video.
;(() => {
  try {
    const params = new URLSearchParams(location.search)
    // `btDebug` — the on-device break-table store test (iPhone 8, live site). iOS Safari has no
    // createWritable, so every OPFS write there takes opfsWrite.ts's WORKER createSyncAccessHandle
    // branch, which CI cannot reach (Playwright's Linux WebKit has no navigator.storage at all).
    // Sticky, like the rest: a flag read fresh from the URL dies the moment nav rewrites it.
    // `snapBreaks` — the /snapshot break-table sweep. Sticky for the reason the round-8 note gives
    // in the sharpest form: /snapshot's local-first nav REWRITES THE URL on every scrub step, so a
    // flag read fresh from the URL dies on the first scrub — silently disabling the very feature you
    // came to test, exactly when you started testing it.
    // `prodGraphs`/`prodReport`/`prodLedger`/`music`/`musicXml` — 2026-07-17. These MUST be synced
    // here and not left to their own modules, and the reason is the chicken-and-egg this codebase
    // keeps rediscovering: each flag's reader lives INSIDE the lazy chunk the flag gates, so on `/`
    // nothing calls it, the URL param is seen by nobody, and it's gone by the time you navigate to
    // the route that would have read it. Peter hit exactly that: `/?prodGraphs=demo` did nothing,
    // because the only caller of `prodGraphsEnabled()` used to be the /productivity route, which he
    // hadn't reached yet. (`prodGraphs` is now read on `/` by the clock drop-up too, but this boot
    // sync still owns the sticky `=off`/`=demo` writes so a URL param can never be missed.)
    // The feature could not be turned on because the code that reads the switch is behind the switch.
    // Cost is a URLSearchParams read already being done on this line — not a load-path regression.
    for (const f of ['arithLayout', 'renderFill', 'waveVideo', 'textRender', 'btDebug', 'snapBreaks',
                     'prodGraphs', 'prodReport', 'prodLedger', 'music', 'musicXml']) {
      const v = params.get(f)
      if (v === 'off') localStorage.setItem(`inkwave:${f}`, '0')
      // `?prodGraphs=demo` / `?prodReport=demo` / `?music=demo` — on, PLUS a LABELLED synthetic
      // fixture ledger, so the panel is reviewable before real capture exists. Never silent.
      else if (v === 'demo') { localStorage.setItem(`inkwave:${f}`, '1'); localStorage.setItem(`inkwave:${f}Demo`, '1') }
      // `?waveVideo=debug` — same as on, PLUS the on-device diagnostic overlay (no console needed:
      // Peter tests on an iPhone 8 with no Mac/Web Inspector, and our AV1→H.264→CSS fallback chain
      // is otherwise SILENT and looks identical to the CSS water he's judging).
      else if (v === 'debug') localStorage.setItem(`inkwave:${f}`, 'debug')
      // `?btDebug=race` — the KNOWN-NEGATIVE: build the tables WITHOUT waiting for the async
      // library hydration, reproducing the exact race Peter's iPhone found (capa@0 baked at build,
      // capa@20 after the reload ⇒ every lookup misses forever). It must FAIL.
      else if (v === 'race') localStorage.setItem(`inkwave:${f}`, 'race')
      else if (params.has(f)) localStorage.setItem(`inkwave:${f}`, '1')
    }
  } catch { /* private mode / no localStorage */ }
})()

// Wrap the app in Clerk ONLY when configured (paid-tier auth, M6). Dynamic import keeps Clerk out
// of the bundle entirely when unconfigured, and entry.client is client-only so it never touches
// the prerender/SSR build. The publishable key is public (safe in the client).
// ─── The hydration beacon ─────────────────────────────────────────────────────────────────────
// The one fact anything imperative must know before it may touch the DOM: REACT HAS COMMITTED.
// `hydrateRoot` offers no completion callback, so render a null component and let its effect say
// so. It renders NO host node, so it cannot itself perturb the hydration it reports on.
//
// STATE **AND** EVENT, deliberately (2026-07-17, the second round of Peter's iPhone bug). The
// video's barrier first keyed on `inkwave:twinkles-ready`, which was post-hydration but is NOT
// guaranteed to arrive: the twinkle pool announces only once BOTH its sets generate, while the
// water gate opens anyway on its own 1500ms timeout — so a load where the pool never announced
// left the barrier waiting for a signal that was never coming, forever (PROBED). A signal you
// wait on must be one that ALWAYS fires, and it must be ASKABLE ("has it already happened?") so a
// late subscriber can never wait for a past event. React always commits, so this always fires.
function HydrationBeacon(): null {
  useEffect(() => {
    ;(window as unknown as { __iwHydrated?: boolean }).__iwHydrated = true
    window.dispatchEvent(new Event('inkwave:hydrated'))
  }, [])
  return null
}

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
    // The beacon renders LAST so its effect runs after the app's own mount effects: when it fires,
    // the commit is done and every host node (including the `.iw-wave-twinkles` the video needs)
    // is in the DOM and owned by React.
    hydrateRoot(document, <StrictMode>{tree}<HydrationBeacon /></StrictMode>)
  })
}
void bootstrap()

// ─── Blank white until the wave video comes up (Peter, 2026-07-17) ────────────────────────────
// "we have to just have blank white screen until the video comes up and play the video every time".
// The CSS water paints from the PRERENDERED `.iw-wave-anim` class (that is the design — it runs
// from first paint), so with the video flag on a load shows CSS water and then swaps to the video:
// two waters in one load. `.iw-wave-video-wait` holds the surface white until waveVideo.ts either
// becomes master or bails.
//
// A CLASS ON <html>, exactly like `.iw-water-ready` below and `data-theme` — NOT a node append.
// Appending anything into React's tree before hydration is the #418 catastrophe this file's other
// comments document at length; a root className is the shape this app already ships twice.
//
// THE TIMEOUT IS NOT THE "papered-over one-shot signal" this codebase warns about — it is an
// independent liveness backstop for a failure waveVideo.ts CANNOT report, because it IS the
// failure of that module to load at all (a chunk 404, an offline SW miss, a parse error). That
// module's own exits are covered by its `endWait()`. What must never happen is a permanent white
// screen, and the module that would clear it is precisely the one that may be missing. 4s > its
// 2.5s decode budget, so on any load where waveVideo is alive this never fires.
function armWaveVideoWait(): void {
  document.documentElement.classList.add('iw-wave-video-wait')
  setTimeout(() => document.documentElement.classList.remove('iw-wave-video-wait'), 4000)
}

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
// waveTwinkle aligns its precomputed pool's playback clock to the drift's literal startTime in
// the same first-visible frame (alignTracks — once per load).
// REFRESH: the old localStorage pre-stamp (root.tsx head script) opened the gate pre-paint on
// warm clients — which would let the water paint long before the twinkles mount. Removed: every
// load gates identically now (the tiles are data URIs, so "warm" never made decoding faster
// anyway — the wait is hydration-bound either way, and atomicity wins per Peter's directive).
{
  let stamped = false
  const ready = () => {
    if (stamped) return
    stamped = true
    document.documentElement.classList.add('iw-water-ready')
    // ASKABLE, like __iwTwinklesReady: `inkwave:water-ready` is one-shot, and the class is not a
    // safe proxy for "it happened" (a hydration recovery can strip it). A late subscriber must be
    // able to ASK rather than wait forever for a past event.
    ;(window as unknown as { __iwWaterReady?: boolean }).__iwWaterReady = true
    window.dispatchEvent(new Event('inkwave:water-ready'))
  }
  // GUARD (2026-07-10, the iOS "gradient without waves"): if hydration ever fails, React 18's
  // recovery client-renders <html> from scratch and STRIPS the stamps it doesn't render —
  // .iw-water-ready and data-theme both vanish, the wave pseudos go display:none for the whole
  // session, and a night client falls back to day. Re-assert both the moment they vanish;
  // MutationObserver callbacks are microtasks, so they run before the wiped frame can paint. A
  // legitimate theme toggle always SETS data-theme (never removes it), so re-applying only when
  // it's absent can't fight Settings.
  //
  // ⚠️ THIS GUARD WAS A FICTION UNTIL 2026-07-17, and it failed the ONE case it was written for.
  // React's recovery does not strip attributes off <html> — it REPLACES the <html> ELEMENT. The
  // old code captured `const root = document.documentElement` once and observed THAT node, so
  // after a recovery the guard was watching a DETACHED element and re-stamping it forever while
  // the live <html> stayed bare. PROBED: with the wave-video flag on, the original node fails an
  // identity check and both stamps are gone for the session. So: never hold the node — resolve
  // `document.documentElement` at every use, and watch `document` itself (which is never
  // replaced) for the swap, re-stamping and re-arming on the new element.
  const restamp = () => {
    const root = document.documentElement
    if (stamped && !root.classList.contains('iw-water-ready')) root.classList.add('iw-water-ready')
    if (!root.dataset.theme) applyTheme()
  }
  const attrObserver = new MutationObserver(restamp)
  const armAttrs = () => attrObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['class', 'data-theme'],
  })
  armAttrs()
  // <html> swapped out entirely: re-stamp the NEW element and re-point the attribute observer at
  // it (observing a detached node is exactly how the stamps were lost).
  new MutationObserver(() => { restamp(); attrObserver.disconnect(); armAttrs() })
    .observe(document, { childList: true })
  if (document.documentElement.classList.contains('iw-water-ready')) {
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
      // The WAVE VIDEO (flag `inkwave:waveVideo`) starts its fetch+decode NOW so the clip is ready
      // the moment the gate opens — but it is NOT a gate condition and must NOT be awaited here:
      // it inserts its <video> into the React-rendered `.iw-wave-twinkles` host and therefore waits
      // for this gate itself (post-gate = post-hydration, or React reconciles the element away).
      // Awaiting it here would deadlock. See src/editor/waveVideo.ts.
      let videoFlag = false
      try { const v = localStorage.getItem('inkwave:waveVideo'); videoFlag = v === '1' || v === 'debug' } catch { /* private mode */ }
      if (videoFlag) { armWaveVideoWait(); void import('../src/editor/waveVideo').then((m) => m.prepareWaveVideo()).catch(() => {}) }
      const t = setTimeout(ready, 1500) // generous — twinkles wait through hydration; never hostage
      void Promise.all([tiles, twinkles]).then(() => { clearTimeout(t); ready() })
    }
  }
}

// ─── Wave video (EXPERIMENTAL — localStorage `inkwave:waveVideo` = '1') ───
// Fresh loads fold the video INTO the gate above (atomic). The WARM/bfcache path skips that gate
// (already stamped), so start it here too — prepareWaveVideo is idempotent (started guard) and
// attaches post-gate. See src/editor/waveVideo.ts.
try {
  const wv = localStorage.getItem('inkwave:waveVideo')
  if ((wv === '1' || wv === 'debug') && document.documentElement.classList.contains('iw-water-ready')) {
    armWaveVideoWait() // the warm path skips the gate above, so it must arm the white itself
    void import('../src/editor/waveVideo').then((m) => m.prepareWaveVideo())
  }
} catch { /* private mode */ }

// Suppress iOS Safari's native pinch zoom app-wide on phones: the proprietary gesture* events are
// the only reliable hook (Safari ignores user-scalable=no in-browser). Our own pinch handlers use
// touch events on their surfaces, so they keep working — this only stops the BROWSER's page zoom
// (over the toolbar, panels, everywhere) from fighting the app's zoom.
if (window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches) {
  // CAPTURE phase, both hooks (2026-07-10 audit — "native pinch still fighting ours"): at bubble
  // phase any descendant handler calling stopPropagation would shadow the suppression, and
  // Safari commits its native pinch for the WHOLE gesture if the first two-finger touchmove
  // isn't cancelled. Capture runs first, unshadowable, and this early non-passive registration
  // is also what makes WebKit dispatch two-finger moves as CANCELABLE at all (a listener armed
  // only mid-gesture may see cancelable=false). preventDefault doesn't stop propagation, so the
  // app's own pinch handlers (editor zoom, PDF viewer) still receive every event.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true })
  }
  // gesture* events alone proved insufficient (2026-07-09): also cancel any two-finger touchmove
  // that nothing upstream handled — the backstop for the toolbar, panels, and everything else.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault()
  }, { passive: false, capture: true })
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
