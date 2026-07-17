// ─── vercel.json must be DEPLOYABLE, not merely parseable ────────────────────
//
// THE BUG THIS KEEPS FIXED (af3fba9, 2026-07-17): a `"//"` comment key in `headers[0]` made Vercel
// hard-reject the config server-side, so **every deploy from 473013f onward silently failed** — for
// days — while `pnpm test` and `pnpm build` stayed green. Peter found it, not the gate.
//
// WHY THE GATE COULD NOT SEE IT, and it is this repo's own headline disease: `pnpm build` never
// reads vercel.json, and the three suites that DO read it (`micBoundary.test.ts`, `probe.test.ts`)
// only ever `JSON.parse` it and inspect the headers. **A `"//"` key is perfectly valid JSON.** So
// every existing check passed on a file the platform refuses — the instrument could not report its
// own subject. Green gate, nothing shipped.
//
// ⚠️ THIS TRAP IS *DOCUMENTED AS A CONVENTION*, which is why it needs a guard rather than care.
// CLAUDE.md describes vercel.json's `"//"` notes approvingly ("its `"//"` JSON notes explain the
// very rule they encode"), and `probe.test.ts` still carries a comment about "the rule's OWN `"//"`
// note". Someone WILL add one back — the repo tells them to. This makes that loud in ~5ms.
//
// SCOPE, STATED HONESTLY: this does NOT reimplement Vercel's schema (I cannot verify it from here,
// and a guess at the full allow-list would fail the other way — silently, on a valid file). It pins
// exactly the key that actually bit, plus the top-level shape. A future rejection of some OTHER
// unknown property is NOT covered; only a real deploy can prove that.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const RAW = readFileSync(join(REPO, 'vercel.json'), 'utf8')

/** Every JSON path holding a `"//"` key, walked structurally — not grepped. */
function commentKeyPaths(o: unknown, path = ''): string[] {
  if (Array.isArray(o)) return o.flatMap((v, i) => commentKeyPaths(v, `${path}[${i}]`))
  if (o && typeof o === 'object') {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      k === '//' ? [`${path}."//"`] : commentKeyPaths(v, `${path}.${k}`),
    )
  }
  return []
}

describe('vercel.json is deployable', () => {
  it('parses (the precondition every other vercel.json test silently assumes)', () => {
    expect(() => JSON.parse(RAW)).not.toThrow()
  })

  it('carries NO "//" comment keys — Vercel rejects the config outright', () => {
    const found = commentKeyPaths(JSON.parse(RAW))
    expect(
      found,
      found.length
        ? `vercel.json has ${found.length} "//" comment key(s) at ${found.join(', ')}.\n` +
          `Vercel validates this file SERVER-SIDE and hard-rejects unknown properties, so this ` +
          `DOES NOT fail the build — it fails the DEPLOY, silently, while the gate stays green ` +
          `(that is exactly what af3fba9 fixed after days of dead deploys).\n` +
          `Put the rationale in CLAUDE.md or a comment in the code that reads the header — ` +
          `never in the JSON.`
        : undefined,
    ).toEqual([])
  })

  it('KNOWN-POSITIVE: the walker really can find a "//" key (it is not blind)', () => {
    // Without this, `toEqual([])` above passes just as well on a walker that returns [] always —
    // the "negative that cannot fail" this repo keeps catching. Proved on the SHAPE that bit:
    // a comment nested inside headers[0], exactly where af3fba9 removed one.
    const planted = { headers: [{ '//': 'rationale', source: '/(.*)', headers: [] }] }
    expect(commentKeyPaths(planted)).toEqual(['.headers[0]."//"'])
  })

  it('keeps the top-level shape the deploy depends on', () => {
    const d = JSON.parse(RAW)
    expect(Object.keys(d).sort()).toEqual(
      ['buildCommand', 'functions', 'headers', 'outputDirectory', 'rewrites'].sort(),
    )
  })
})
