import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  // The editor IS the landing page (low friction — no dashboard).
  index('routes/home.tsx'),
  route('about', 'routes/about.tsx'),
  // Redirect any unmatched path (e.g. a stale `/edit` bookmark from before the editor
  // moved to `/`) to the editor, restoring the old SPA's catch-all behaviour.
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig
