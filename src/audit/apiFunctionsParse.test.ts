// ─── Every api/*.mjs must PARSE — the gate is otherwise blind to all of them ──
//
// THE GAP THIS CLOSES (auditor A, 2026-07-17, PROBED — not reasoned):
// append `broken syntax here (((` to `api/ots.mjs` — the LIVE Vercel entry point for OTS Bitcoin
// anchoring (M2) — and the FULL gate stays green: **typecheck exit 0, build exit 0, test exit 0
// (127 files / 1858 tests)**. The endpoint would 500 on every request in production and nothing
// here would say a word.
//
// WHY THE GATE CANNOT SEE IT — the vercel.json disease (af3fba9) at a second address:
//   · `tsc -b` includes ONLY `src`, `app`, `.react-router/types` and `vite.config.ts`. **`api/` is
//     in no tsconfig at all.**
//   · `pnpm build` is an SPA build (`ssr:false`). It emits NOTHING for `api/` and never parses it.
//   · The real consumer is **Vercel's Node function runtime** — a system no test speaks to.
// So these 20 files are checked by exactly one thing: whether some OTHER gated file happens to
// import them. `vite.config.ts`'s dev middleware incidentally covers 10 (a syntax error in
// `_ots-core.mjs` DOES fail the build, via esbuild loading the config — probed, it names the file).
// **That is luck, not a guard**, and it runs out exactly at the deployed entry points, which
// `vite.config.ts` does not import because it mirrors the ROUTES with its own middleware:
//     clerk-webhook.mjs · me.mjs · **ots.mjs** · **session.mjs** · **sign.mjs**
// Three of those five are the live provenance spine (M2 OTS, M3 session+sign). And the failure is
// SILENT by design: `provenance/ots.ts callRelay` returns null on `!res.ok` and "the caller keeps
// the prior state", so a 500ing relay reads exactly like being offline — stamping just stops.
//
// ⚠️ SCOPE, STATED HONESTLY — this is a PARSE check and nothing more. It catches the syntax error
// and the truncated file. It does NOT catch a bad import specifier, a missing env var, or any
// runtime fault; `import()`ing these for real would execute module-scope SDK setup and prove
// something else while looking stronger. A deploy is still the only proof that a function RUNS.
// Do not let this test's green be read as "the API works" — it means "the API is not gibberish".
//
// PARSER CHOICE: esbuild via `vite`, not `node --check`. Node's own parser is the truer consumer,
// but it needs a PROCESS PER FILE (~250ms × 20 = 5.4s on every gate run) and this box is already
// CPU-contended by concurrent lanes. esbuild parses the same ESM in ~1ms, and it is not a stand-in
// chosen for convenience: it is the parser that ALREADY catches `_ots-core.mjs` when
// `vite.config.ts` loads it in the build — i.e. the incidental coverage this test generalises.
// A guard nobody minds running is a guard that stays.
//
// It is imported from `vite` (a direct devDependency) rather than `esbuild`, which is only a
// TRANSITIVE one — pnpm's strict linking refuses that import, correctly. Adding `esbuild` to
// package.json to satisfy an audit test would put a new supply-chain dep in a repo that
// deliberately hand-rolls its own SVG charts to avoid one.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformWithEsbuild } from 'vite'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const API = join(REPO, 'api')

/** Parse as ESM. Returns null if it parses, else the first line of the error. */
async function parseErrorOf(source: string, name: string): Promise<string | null> {
  try {
    await transformWithEsbuild(source, name, { loader: 'js', format: 'esm' })
    return null
  } catch (e) {
    return String((e as Error).message).split('\n')[0].trim()
  }
}

const parseError = (file: string): Promise<string | null> =>
  parseErrorOf(readFileSync(file, 'utf8'), file)

const files = readdirSync(API).filter(f => f.endsWith('.mjs')).sort()

describe('every deployed api/*.mjs parses', () => {
  it('VOID GUARD: the api directory is actually there and populated', () => {
    // An empty sweep passing is the failure mode this repo keeps finding. If `api/` moves, this
    // suite must go red rather than report "all 0 files fine".
    expect(files.length).toBeGreaterThanOrEqual(15)
  })

  it('KNOWN-POSITIVE: the checker really rejects a broken file (it is not blind)', async () => {
    // Without this, `toBeNull()` below passes just as well on a checker that always returns null.
    // Uses the EXACT mutation that beat the full gate — a real reproduction, not a toy.
    expect(
      await parseErrorOf("import { x } from './y.mjs'\nbroken syntax here (((\n", 'broken.mjs'),
      'the checker cannot see a syntax error',
    ).not.toBeNull()

    // …and it must still ACCEPT a real handler, or it discriminates nothing and every file
    // below would "fail" for free.
    expect(
      await parseErrorOf('export default async function handler(req, res) { res.end("ok") }\n', 'ok.mjs'),
      'the checker rejects VALID code',
    ).toBeNull()
  })

  it.each(files)('%s parses', async file => {
    expect(await parseError(join(API, file))).toBeNull()
  })
})
