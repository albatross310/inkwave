import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { LinksFunction } from 'react-router'
import { useEffect } from 'react'
import { FONT_PRELOAD } from './fontPreload'

const TAB_TITLES = [
  'Inkwave Zero: writing that remembers',
  'Inkwave Zero: a mnemonic environment',
  'Inkwave Zero: a calm place to write',
  'Inkwave Zero: writing with memory',
  'Inkwave Zero: every word intentional',
]

// The single global stylesheet (Tailwind + the editor/SCAS styles). Keep it as an EXPLICIT link in
// the React-owned head rather than a Vite side-effect injection: if a browser host inserts a node
// before hydration, React may recover by client-rendering the whole document. A side-effect <style>
// belongs to the discarded server head and disappears in that recovery; <Links> recreates this
// declared stylesheet in the replacement head, so the editor cannot mount completely unstyled.
import stylesheetHref from '../src/styles/index.css?url'

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheetHref },
  // NO SVG favicon: our logo SVG uses userSpaceOnUse gradients that Firefox can't rasterise at tab size —
  // and Firefox, having "preferred" the SVG, then shows its generic page icon WITHOUT falling back to the
  // PNGs. Rasterised PNG/ICO render reliably in every browser (a 128px PNG is crisp at tab size). The ?v
  // bump is a fresh URL that finally displaces the stale icon Firefox's favicon store (places.sqlite —
  // NOT the web cache, so a normal cache-clear never touched it) was pinning.
  // SOLVED 2026-07-10 ("logo momentarily then the default"): these links were fine all along — a
  // TiptapEditor effect swapped the first icon link to an inline document-glyph SVG at editor mount,
  // which at tab size looks like Firefox's default page icon. The swap is removed (see TiptapEditor);
  // ?v=20 displaces the doc glyph any returning Firefox profile has stored against the page URL.
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/fav-32.png?v=20' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/fav-16.png?v=20' },
  { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/fav-128.png?v=20' },
  { rel: 'icon', href: '/favicon.ico?v=20', sizes: 'any' },
  { rel: 'shortcut icon', href: '/favicon.ico?v=20' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=20' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
  // Fonts: SELF-HOSTED (public/fonts/inkwave-fonts.css → /fonts/*.woff2), not Google Fonts. Same-origin
  // so the calm serif identity is deterministic everywhere — including the server-side PDF/print render,
  // which previously raced the external Google fetch and fell back to Georgia. See src/editor/exportPdf.ts.
  // Preload the latin/latin-ext faces (auto-generated list in app/fontPreload.ts → re-run
  // scripts/fetch-fonts.mjs to refresh) so the body paints in the serif with no flash. `crossOrigin` is
  // required on font preloads even same-origin, else the browser double-fetches.
  ...FONT_PRELOAD.map((href) => ({
    rel: 'preload',
    as: 'font',
    type: 'font/woff2',
    href,
    crossOrigin: 'anonymous' as const,
  })),
  { rel: 'stylesheet', href: '/fonts/inkwave-fonts.css' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Pre-paint theme: the prerendered HTML is day-themed and JS applies data-theme only after
            the bundle executes — night users got a bright flash for the whole JS fetch on cold
            loads. This runs before first paint; the CSP middleware nonces every inline script.
            (The warm-client iw-water-ready pre-stamp that used to live here is GONE, 2026-07-10:
            the atomic-water gate now also waits for the twinkle field to mount, so pre-opening it
            painted waves without twinkles. Every load holds pure white until the whole
            water — tiles + twinkles — can land in one paint. See entry.client.tsx.) */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{document.documentElement.dataset.theme=localStorage.getItem('inkwave:theme')==='night'?'night':'day'}catch(e){}`,
        }} />
        <meta charSet="utf-8" />
        {/* viewport-fit=cover: extend under the iOS notch/home-indicator so env(safe-area-inset-*)
            is non-zero and the footer toolbar can pad itself clear of them (landscape phones). */}
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#427b82" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141313" />
        <meta name="google-site-verification" content="h79VCdHP57BlmRzPhYg_vgOKBj1iMfKkq4J1gpAIvR4" />
        <meta name="robots" content="index, follow" />
        <meta name="application-name" content="Inkwave Zero" />
        <meta property="og:site_name" content="Inkwave Zero" />
        <meta property="og:image" content="https://iwzero.me/inkwave-seal-512.webp" />
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta property="og:image:alt" content="The Inkwave seal — a great wave within a circle" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://iwzero.me/inkwave-seal-512.webp" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
<ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

// SPA-FALLBACK FIRST PAINT (2026-07-11): routes with no prerendered HTML (/snapshot in a new
// tab, /login, unknown paths) are served build/client/__spa-fallback.html, whose body is THIS
// component rendered at build time. Without it the fallback painted bare parchment for the whole
// JS fetch + hydration — the first stretch of the "white background early" on the snapshot
// window. A static water placeholder (see .iw-boot-water in index.css) keeps the tab water-
// coloured until the route mounts its real wave choreography (LoadingVeil).
export function HydrateFallback() {
  return <div className="iw-boot-water" aria-hidden="true" />
}

export default function App() {
  useEffect(() => {
    const pick = TAB_TITLES[Math.floor(Math.random() * TAB_TITLES.length)]
    document.title = pick
  }, [])
  return <Outlet />
}
