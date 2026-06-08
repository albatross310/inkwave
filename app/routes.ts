import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  // The editor IS the landing page (low friction — no dashboard).
  index('routes/home.tsx'),
  route('about', 'routes/about.tsx'),
] satisfies RouteConfig
