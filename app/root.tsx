import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { LinksFunction } from 'react-router'
import { useEffect } from 'react'
import { FONT_PRELOAD } from './fontPreload'

const TAB_TITLES = [
  'Inkwave Solo: writing that remembers',
  'Inkwave Solo: a mnemonic environment',
  'Inkwave Solo: a calm place to write',
  'Inkwave Solo: writing with memory',
  'Inkwave Solo: every word intentional',
]

// The single global stylesheet (Tailwind + the editor/SCAS styles). Importing it here as a
// side-effect lets the React Router Vite plugin collect it into the document <head> for both
// the dev server AND the prerendered HTML — so the static landing page is styled by exactly
// the same CSS as the live editor.
import '../src/styles/index.css'

export const links: LinksFunction = () => [
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/fav-32.png?v=15' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/fav-16.png?v=15' },
  { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/fav-128.png?v=15' },
  { rel: 'shortcut icon', href: '/fav-32.png?v=15' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=15' },
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
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#2a3b5f" />
        <meta name="google-site-verification" content="h79VCdHP57BlmRzPhYg_vgOKBj1iMfKkq4J1gpAIvR4" />
        <meta name="robots" content="index, follow" />
        <meta name="application-name" content="Inkwave Solo" />
        <meta property="og:site_name" content="Inkwave Solo" />
        <meta property="og:image" content="https://iwsolo.me/inkwave-seal-512.webp" />
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta property="og:image:alt" content="The Inkwave seal — a great wave within a circle" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://iwsolo.me/inkwave-seal-512.webp" />
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
