import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  // The editor IS the landing page (low friction — no dashboard).
  index('routes/home.tsx'),
  route('about', 'routes/about.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('verify', 'routes/verify.tsx'), // open, client-side provenance verification (M5)
  route('login', 'routes/login.tsx'),   // paid-tier sign-in (Clerk) — dormant until configured
  route('snapshot', 'routes/snapshot.tsx'), // read-only viewer for a past snapshot (+ diff vs now)
  // NOTE: the `/productivity` route was RETIRED 2026-07-18 (feat/prodgraphs-panel). Peter's ethos is
  // "no routes, all panels" (the /music and /ledger routes went the same way). The measured writing
  // charts (`?prodGraphs`, now default ON) are a portalled night-mode PANEL reached from the clock
  // drop-up (components/ProductivityGraphsPanel.tsx). A stale `/productivity` bookmark falls through
  // the catch-all below to the editor.
  // NOTE: the `/music` route was RETIRED 2026-07-18 (feat/music-layer). Peter: "no /music doesn't
  // survive. it should all be in panels." The music module is now reachable as the toolbar's ♪ BAR
  // LAYER over the editor (components/MusicBar.tsx → MusicStudio / MusicPanel as a panel), so there
  // is no route to render — a stale `/music` bookmark falls through to the catch-all → the editor.
  // Redirect any unmatched path (e.g. a stale `/edit` bookmark from before the editor
  // moved to `/`) to the editor, restoring the old SPA's catch-all behaviour.
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig
