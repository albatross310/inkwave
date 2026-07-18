// The one security-surface change this lane makes: `camera=()` → `camera=(self)` in vercel.json's
// Permissions-Policy, so `getUserMedia({video:true})` can open the webcam for THIS origin.
//
// A green gate is not a guard (CLAUDE.md): `pnpm build` never reads vercel.json, so this pins the
// exact invariant a careless edit could undo — the camera is granted to self, and NOTHING ELSE in
// the lockdown moved. It is the camera analogue of `micBoundary.test.ts`'s layer-1 binding.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'))

/** The Permissions-Policy served for every path (source '/(.*)'). */
function globalPermissionsPolicy(): string {
  const block = vercel.headers.find(
    (h: { source: string; headers: { key: string }[] }) =>
      h.source === '/(.*)' && h.headers.some((x) => x.key === 'Permissions-Policy'),
  )
  return block?.headers.find((x: { key: string }) => x.key === 'Permissions-Policy')?.value ?? ''
}

/** directive → allow-list contents, e.g. `camera=(self)` → { camera: 'self' }. */
function directives(policy: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of policy.matchAll(/([a-z-]+)=\(([^)]*)\)/g)) out[m[1]] = m[2].trim()
  return out
}

describe('vercel.json Permissions-Policy — camera granted to self, the rest untouched', () => {
  const d = directives(globalPermissionsPolicy())

  it('CAMERA is granted to this origin (the change webcam capture required)', () => {
    // `self` — not `*` (never all origins), not `()` (which is what blocked the webcam).
    expect(d.camera, 'camera must be camera=(self) for getUserMedia to work').toBe('self')
  })

  it('MICROPHONE is still off — the mic firebreak is not touched by the camera change', () => {
    // The whole point of the analogue: the camera opens, the microphone stays disabled for the
    // origin. If this ever reads non-empty, §A5's audio decision was made HERE by accident.
    expect(d.microphone, 'microphone=() must be unchanged').toBe('')
  })

  it('GEOLOCATION and PAYMENT are byte-for-byte the pre-existing lockdown', () => {
    expect(d.geolocation).toBe('')
    // payment keeps self + Stripe.
    expect(directives(globalPermissionsPolicy()).payment).toBe('self "https://js.stripe.com"')
  })

  it('KNOWN-POSITIVE: the directive parser really reads values (not blind)', () => {
    // Without this, the assertions above pass just as well on a parser that returns {} always. The
    // real policy uses the parenthesised form throughout, which is what this parser matches.
    const probe = directives('camera=(self), microphone=(), geolocation=(self)')
    expect(probe).toEqual({ camera: 'self', microphone: '', geolocation: 'self' })
  })
})
