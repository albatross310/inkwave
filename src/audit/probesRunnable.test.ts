// EVERY PROBE MUST BE RUNNABLE, AND EVERY PROBE MUST BE ABLE TO SAY "I CANNOT TELL".
// ~10ms, no browser.
//
// ─── WHY ─────────────────────────────────────────────────────────────────────────────────────────
// This repo had 73 `.prove.mjs` files and 21 `prove:*` scripts. The other 52 were reachable only by
// knowing the path, so in practice each was run once, by the agent that wrote it, and never again.
// That is how a proof rots: `prove:arith` — named in CLAUDE.md as the graduation keeper for
// `?arithLayout` — was RED for two days and nobody knew, because it was one of the unwired 52.
//
// Wiring them was the fix. This is what keeps them wired: a new probe that nobody can run is a probe
// that will be wrong within the month, and the gate should say so on the day it lands rather than
// six weeks later.
//
// ─── THE SECOND ASSERTION IS THE MORE IMPORTANT ONE ──────────────────────────────────────────────
// A probe with only PASS and FAIL cannot report that its own premise moved. `readerext.prove.mjs`
// spent a day accusing the extension fetch path because a routing decision changed underneath it;
// four checks in `toolbar.prove.mjs` did the same, each asserting an incidental — a count, a copy
// string, a timing — instead of the property it was written to protect. Every one of them failed
// in the direction of "the feature is broken", which is the expensive direction: it trains the one
// person whose eyes are ground truth to distrust the instrument.
//
// So a probe must have a third answer. This asserts the MECHANISM exists (a void/skip/inconclusive
// path); it cannot assert that it is used well. That part is review.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import baseline from './probeVoidBaseline.json'

const ROOT = new URL('../..', import.meta.url).pathname
const SCRIPTS = join(ROOT, 'scripts')

function proveFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { proveFiles(full, acc); continue }
    if (name.endsWith('.prove.mjs')) acc.push(full)
  }
  return acc
}

const FILES = proveFiles(SCRIPTS)
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
const WIRED = new Set(
  Object.values(PKG.scripts).flatMap((v) => [...v.matchAll(/scripts\/[\w/.-]*\.prove\.mjs/g)].map((m) => m[0])),
)

/** A way for a run to end "inconclusive" rather than pass or fail. Any of these shapes counts. */
const VOID_RE = /\bVOID\b|\bvoid_\b|INCONCLUSIVE|CANNOT-JUDGE|\bskip\b|UNRUNNABLE|DECLARED-DEFER|\bDEFER\b/i

describe('the probe suite is runnable', () => {
  // VOID GUARD for this guard: an empty sweep would satisfy every assertion below.
  it('found the probes it reasons about', () => {
    expect(FILES.length).toBeGreaterThan(60)
    expect(WIRED.size).toBeGreaterThan(60)
  })

  it('every .prove.mjs is reachable as a pnpm script', () => {
    const orphans = FILES.map((f) => relative(ROOT, f)).filter((rel) => !WIRED.has(rel))
    expect(
      orphans,
      `unreachable probes — add a "prove:<name>" script, or they will be run once and rot:\n${orphans.join('\n')}`,
    ).toEqual([])
  })

  it('every wired path exists — a script pointing at a deleted probe is a green that runs nothing', () => {
    const real = new Set(FILES.map((f) => relative(ROOT, f)))
    const dangling = [...WIRED].filter((w) => !real.has(w))
    expect(dangling, `package.json points at missing probes: ${dangling.join(', ')}`).toEqual([])
  })
})

// A RATCHET, not a wall — 27 of 73 probes have no third answer today, and rewriting all of them in
// one commit would be a worse change than the debt. The baseline records exactly which; the gate
// fails when a probe NOT on the list is mute, and when a listed path disappears. Fixing one means
// deleting a line, so the number can only fall.
//
// Same shape as `styles/colourBaseline.json`, and for the same reason: a defect you can only fix
// all-at-once does not get fixed, and a defect nobody counts does not get noticed.
describe('every probe can report that its own premise moved', () => {
  const mute = FILES.filter((f) => !VOID_RE.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))
  const known = new Set(baseline as string[])

  it('NO NEW mute probes — a new one must be able to say "I cannot tell"', () => {
    // Not a style rule. A probe with only two answers reports a moved precondition as a broken
    // feature, and someone then debugs the wrong subsystem — which has happened twice here.
    const fresh = mute.filter((m) => !known.has(m))
    expect(
      fresh,
      `these probes can only ever blame the product — give each a void/inconclusive path:\n${fresh.join('\n')}`,
    ).toEqual([])
  })

  it('the baseline does not rot — every listed probe still exists and is still mute', () => {
    // A stale entry silently re-opens room for a mute probe under a reused name, and an entry that
    // has since GAINED a void path should be removed so the count reflects the real debt.
    const real = new Set(FILES.map((f) => relative(ROOT, f)))
    const gone = [...known].filter((k) => !real.has(k))
    expect(gone, `baseline names probes that no longer exist: ${gone.join(', ')}`).toEqual([])
    const fixed = [...known].filter((k) => real.has(k) && !mute.includes(k))
    expect(fixed, `these gained a void path — delete them from the baseline: ${fixed.join(', ')}`).toEqual([])
  })

  it('the debt is counted, and only ever falls', () => {
    expect(mute.length).toBeLessThanOrEqual(known.size)
  })
})
