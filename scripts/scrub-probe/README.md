# scrub-probe/

Only `server.mjs` lives here now — the fallback-faithful static server (SPA fallback + prod-like CSP)
that the textrender and wave probes start by hand:

```sh
pnpm build
node scripts/scrub-probe/server.mjs "$(pwd)/build/client" 4225 &   # own port + PID; never 5173
```

The seventeen `probe*.mjs` measurement scripts that used to sit beside it, and the README that
described them, were retired to `docs/archive/probes/scrub-probe/` on 2026-09-16. Their claims are
held by unit tests now (`src/routes/snapshotScrubDriver.test.ts`, `src/routes/snapshotSwipe.test.ts`,
`src/editor/scrubRecorder.test.ts`, `src/editor/scrubBakeBox.test.ts`, `src/routes/snapshotAnchor.test.ts`,
`src/editor/scrubRaster.test.ts`, `src/provenance/diffCache.test.ts`) — see the table in
`docs/archive/probes/README.md` for the row-by-row map.
