# /snapshot scrub-bitmap probe harness

Headless measurement harness for the snapshot scrub-bitmap layer (`editor/scrubRaster.ts` +
`routes/SnapshotView.tsx`). Drives the REAL production scrub paths against a fallback-faithful
static server with an OPFS-seeded thesis-scale doc, and reads the `__iwPerf` probes
(`scrub.want`/`scrub.shown`/`scrub.exact`/`scrub.capture`/`scrub.step`).

Caveat: WSL/CI has no GPU — Chromium falls back to software raster (SwiftShader), so per-frame
GPU/compositor timings are inflated and NOT representative of a real device. JS timings
(`scrub.step` ≈ 0.2ms) and CPU render/capture latency (`scrub.capture` ≈ 360ms idle) ARE
representative. Confirm frame smoothness on real hardware.

## Run

```sh
# 1. build the app, then serve build/client (NOT vite preview — hydration mismatch kills the water)
pnpm build
node scripts/scrub-probe/server.mjs "$(pwd)/build/client" 4225 &   # own port + PID

# 2. run a probe (headless chromium; NODE_PATH points at the app's node_modules for @playwright/test)
PROBE_PORT=4225 NODE_PATH="$(pwd)/node_modules" node scripts/scrub-probe/probe-coldwarm.mjs
```

## Files

- `server.mjs` — fallback-faithful static server (SPA fallback + prod-like CSP; the data:-URI SVG
  raster path runs under the real image policy).
- `probe.mjs` — shared seed (36-snapshot ~20k-word doc), OPFS read-path shim (Playwright's Linux
  WebKit has no `navigator.storage`), and burst helpers. Other probes slice its helpers.
- `probe-coldwarm.mjs` — cold-range warm-up: fling-into-cold fidelity, sit-idle backfill,
  slow-scroll warm-up throughput, per-capture render cost.
- `probe-thumbsize.mjs` — pre-bake assessment: WebP/PNG thumbnail byte sizes + `.studio` bundle
  projection (no server needed).
- `probe-shiftwheel.mjs` / `probe-flipbook-clean.mjs` — shift-wheel flipbook advance + fidelity +
  swap-cost isolation.
