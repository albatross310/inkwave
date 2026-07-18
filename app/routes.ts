import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  // The editor IS the landing page (low friction — no dashboard).
  index('routes/home.tsx'),
  route('about', 'routes/about.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('verify', 'routes/verify.tsx'), // open, client-side provenance verification (M5)
  route('login', 'routes/login.tsx'),   // paid-tier sign-in (Clerk) — dormant until configured
  route('snapshot', 'routes/snapshot.tsx'), // read-only viewer for a past snapshot (+ diff vs now)
  // Productivity report (P1a) — flag-gated, default OFF (`?prodGraphs=1` / `?prodGraphs=demo`).
  // NOT prerendered: private to the writer, no SEO value, and nothing to render without a ledger.
  route('productivity', 'routes/productivity.tsx'),
  // NOTE: the `/music` route was RETIRED 2026-07-18 (feat/music-layer). Peter: "no /music doesn't
  // survive. it should all be in panels." The music module is now reachable as the toolbar's ♪ BAR
  // LAYER over the editor (components/MusicBar.tsx → MusicStudio / MusicPanel as a panel), so there
  // is no route to render — a stale `/music` bookmark falls through to the catch-all → the editor.
  // Redirect any unmatched path (e.g. a stale `/edit` bookmark from before the editor
  // moved to `/`) to the editor, restoring the old SPA's catch-all behaviour.
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig
