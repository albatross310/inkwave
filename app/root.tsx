import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { LinksFunction } from 'react-router'

// The single global stylesheet (Tailwind + the editor/SCAS styles). Importing it here as a
// side-effect lets the React Router Vite plugin collect it into the document <head> for both
// the dev server AND the prerendered HTML — so the static landing page is styled by exactly
// the same CSS as the live editor.
import '../src/styles/index.css'

export const links: LinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: '/icons/icon.svg' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
  // Fonts: preconnect + preload the stylesheet so the calm serif identity paints fast.
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=IM+Fell+DW+Pica:ital@0;1&family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap',
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#2a3b5f" />
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
  return <Outlet />
}
