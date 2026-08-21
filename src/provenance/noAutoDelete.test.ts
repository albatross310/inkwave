// NOTHING MAY DELETE PROVENANCE AUTOMATICALLY.
//
// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────────
// On 2026-08-20 a background sweep in TiptapEditor deleted 79 of Peter's Bitcoin-anchored snapshots,
// twice, leaving 4. Nobody decided to destroy his thesis history: `recoverAndPurge` verified each
// signed receipt chain, marked the ones that failed as "bad", and removed every snapshot whose
// receipts were all bad — reasonable-looking code whose PREMISE was wrong. A chain that fails
// `verifyChain` has not been shown to be forged, only to be unverifiable by this build with this
// key, and the commonest cause is innocent: `signingPublicKeyHex()` returns the DEV key under
// `import.meta.env.DEV`, so every production-signed document fails every chain on localhost — which
// is where Peter develops and where he opens his real thesis.
//
// The fix was to stop deleting. THIS FILE IS WHAT KEEPS IT FIXED. The proof that closed the bug was
// a browser probe against the real 40MB .studio (79 → 78 → 76 → 73 before, 79 → 79 → 79 → 79 after)
// — and CLAUDE.md's own headline lesson is that such a proof is not a guard: it needs a build, a
// server and a real file, it is in no CI, and six weeks from now a proof that ran once is
// indistinguishable from one that never ran. This runs in milliseconds with no browser.
//
// ─── WHAT IT ASSERTS ────────────────────────────────────────────────────────────────────────────
// `deleteSnapshot` is reachable from an ALLOW-LIST of modules, and nowhere else. The list is not a
// formality — it is the whole guard, and it is short on purpose:
//   · provenance/snapshots.ts  declares it.
//   · routes/SnapshotView.tsx  the writer's own delete button, behind a `confirm()`.
// An automatic path — a sweep, a repair, a sync, a migration — must not appear here. If deleting
// provenance is ever genuinely needed, it belongs behind an explicit writer action, and adding the
// module here should be a deliberate act with a reviewer attached, not a silent import.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, and that is load-bearing rather than tidiness: the fix
// in TiptapEditor.tsx NAMES `deleteSnapshot` in the comment explaining why it must never call it
// again. A guard that read raw text would fire on its own documentation and the tempting repair
// would be to delete the explanation — the exact corrosion CLAUDE.md records biting three lanes in
// one round. Judge what the code DOES.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('..', import.meta.url).pathname

/** Modules permitted to reach the delete. See the header — keep this short and deliberate. */
const ALLOWED = new Set([
  'provenance/snapshots.ts',   // the declaration itself
  'routes/SnapshotView.tsx',   // the writer's own confirm()-gated delete button
])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { sourceFiles(full, acc); continue }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\.(ts|tsx)$/.test(name)) continue // tests carry known-bad fixtures by design
    acc.push(full)
  }
  return acc
}

/** Block and line comments removed, so prose ABOUT the rule can never be mistaken for a violation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const files = sourceFiles(SRC)
const offenders = files
  .filter((f) => /\bdeleteSnapshot\b/.test(stripComments(readFileSync(f, 'utf8'))))
  .map((f) => f.slice(SRC.length).replace(/^\/+/, ''))

describe('provenance is append-only — no automatic path may delete a snapshot', () => {
  it('VOID GUARD: the sweep actually read the source tree', () => {
    // An empty scan passes every assertion below while proving nothing. Fail loudly instead.
    expect(files.length).toBeGreaterThan(50)
  })

  it('KNOWN-POSITIVE: the scanner can see a real call, and ignores one inside a comment', () => {
    expect(/\bdeleteSnapshot\b/.test(stripComments('await deleteSnapshot(id, s.id)'))).toBe(true)
    expect(/\bdeleteSnapshot\b/.test(stripComments('// we must never call deleteSnapshot here'))).toBe(false)
    expect(/\bdeleteSnapshot\b/.test(stripComments('/* deleteSnapshot ate 79 snapshots */'))).toBe(false)
  })

  it('only the allow-listed modules reach deleteSnapshot', () => {
    const unexpected = offenders.filter((f) => !ALLOWED.has(f))
    expect(unexpected).toEqual([])
  })

  it('the editor — where the background sweeps live — does not reach it at all', () => {
    // Named separately from the list above because this is the file that caused the incident, and a
    // failure here should say so rather than read as a generic allow-list violation.
    expect(offenders).not.toContain('editor/TiptapEditor.tsx')
  })
})
