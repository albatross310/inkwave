# Auditor A — findings, with the reproductions attached

Artifacts are `.txt` where they cannot compile against master (they test code that lives on
`feat/music-piece-photo`). The precedent is the test auditor's `probe-atompos.test.ts.txt`, which
CLAUDE.md records being ADOPTED by the lane rather than reinvented. Adopt these the same way.

- `src/audit/vercelDeployable.test.ts` — READY TO MERGE, compiles against master. Keeps af3fba9
  fixed. Proved BOTH ways: fires on the real pre-af3fba9 file (`.headers[0]."//"`), 4/4 green on
  the fixed one, 13ms, no browser.
- `probe-harness-id.test.ts.txt` — reproduces the `/music?music=1` piece-id defect (A2).
- `probe-savepiece-discriminating.test.ts.txt` — the DISCRIMINATING negative for `savePiece`'s
  failed-read guard (A1). The lane's own test cannot fail; this one can.

## Pass 2 (2026-07-17)

- `src/audit/apiFunctionsParse.test.ts` — READY TO MERGE. Closes the same class as the vercel.json
  guard at a second address: `api/*.mjs` is in NO tsconfig and `pnpm build` (ssr:false) emits
  nothing for it, so the gate's only coverage is whatever `vite.config.ts` happens to import.
  PROBED: a syntax error in `api/ots.mjs` (the LIVE Vercel entry for OTS Bitcoin anchoring) passes
  typecheck 0 / build 0 / test 0 (127 files, 1858 tests). Proved both ways, 182ms, no new dep.
