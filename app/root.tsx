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

// The single global stylesheet (Tailwind + the editor/SCAS styles). Importing it here as a
// side-effect lets the React Router Vite plugin collect it into the document <head> for both
// the dev server AND the prerendered HTML — so the static landing page is styled by exactly
// the same CSS as the live editor.
import '../src/styles/index.css'

export const links: LinksFunction = () => [
  // SVG first — Firefox prefers a scalable icon and caches it under a fresh URL it hasn't seen, which
  // finally displaces the stale generic-page icon its favicon store was pinning.
  { rel: 'icon', type: 'image/svg+xml', href: '/inkwave-logo.svg?v=18' },
  { rel: 'icon', href: '/favicon.ico?v=18', sizes: 'any' },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/fav-32.png?v=17' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/fav-16.png?v=17' },
  { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/fav-128.png?v=17' },
  { rel: 'shortcut icon', href: '/favicon.ico?v=17' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=17' },
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
            loads. This runs before first paint; the CSP middleware nonces every inline script. */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{document.documentElement.dataset.theme=localStorage.getItem('inkwave:theme')==='night'?'night':'day'}catch(e){}`,
        }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#9fd9c8" />
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

export default function App() {
  useEffect(() => {
    const pick = TAB_TITLES[Math.floor(Math.random() * TAB_TITLES.length)]
    document.title = pick
  }, [])
  return <Outlet />
}
