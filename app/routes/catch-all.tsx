import { redirect } from 'react-router'

// Catch-all for any unmatched path. The editor used to live at `/edit` (weeks 1–3) and moved to
// `/` in the React Router v7 migration; the old SPA redirected every unmatched path to the editor
// and that behaviour was lost. This restores it: a stale bookmark/cache (e.g. `/edit`) or a future
// not-yet-built path lands on the editor instead of React Router's bare "404 Not Found" page.
//
// SPA mode (ssr: false) → this runs client-side as a clientLoader. On Vercel an unmatched URL is
// rewritten to /__spa-fallback.html, RRv7 boots, matches this splat route, and redirects to `/`.
export function clientLoader() {
  return redirect('/')
}

// A loader that always redirects renders nothing, but React Router requires a default export.
export default function CatchAll() {
  return null
}
