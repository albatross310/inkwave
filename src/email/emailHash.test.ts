import { describe, it, expect } from 'vitest'
import { bundleHash, emailHeadersHash, hashCanonical } from '../provenance/hash'
import { normaliseHeaders } from './headers'

// The provenance boundary for the email layer. Two duties:
//   1. the email hash must actually BIND the headers (change a recipient ⇒ change the anchor);
//   2. adding it must not perturb ANY existing document's hash — every already-anchored snapshot in
//      the wild was computed by the v:1/v:2 code, and Peter's receipts are Bitcoin-anchored through
//      exactly those bytes.

describe('emailHeadersHash', () => {
  it('is deterministic', async () => {
    const h = { to: ['a@x.com'], cc: [], bcc: [], subject: 'hi' }
    expect(await emailHeadersHash(h)).toBe(await emailHeadersHash(h))
  })

  it('is stable across the JS object key order (JCS sorts keys)', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com'], cc: [], bcc: [], subject: 'hi' })
    const b = await emailHeadersHash({ subject: 'hi', bcc: [], cc: [], to: ['a@x.com'] })
    expect(a).toBe(b)
  })

  it('treats absent cc/bcc as empty — one header set, one hash', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['a@x.com'], cc: [], bcc: [], subject: 'hi' })
    expect(a).toBe(b)
  })

  // ── The binding negatives. Each one MUST change the hash, or the anchor proves less than the
  // copy claims. These are the "prove your negative fires" cases.
  it('CHANGES when the recipient changes', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['b@x.com'], subject: 'hi' })
    expect(a).not.toBe(b)
  })

  it('CHANGES when the subject changes', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['a@x.com'], subject: 'ho' })
    expect(a).not.toBe(b)
  })

  it('CHANGES when a bcc is added — an invisible recipient is still a committed fact', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['a@x.com'], bcc: ['secret@x.com'], subject: 'hi' })
    expect(a).not.toBe(b)
  })

  it('CHANGES when recipient ORDER changes', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com', 'b@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['b@x.com', 'a@x.com'], subject: 'hi' })
    expect(a).not.toBe(b)
  })

  it('does NOT change for case/whitespace variants, once canonicalised', async () => {
    const a = await emailHeadersHash(normaliseHeaders({ to: ['Ada@X.com'], subject: ' hi ' }))
    const b = await emailHeadersHash(normaliseHeaders({ to: [' ada@x.com '], subject: 'hi' }))
    expect(a).toBe(b)
  })

  it('cannot be confused by moving an address between to and cc', async () => {
    const a = await emailHeadersHash({ to: ['a@x.com', 'b@x.com'], subject: 'hi' })
    const b = await emailHeadersHash({ to: ['a@x.com'], cc: ['b@x.com'], subject: 'hi' })
    expect(a).not.toBe(b)
  })
})

describe('bundleHash — email (v:3) without perturbing v:1 / v:2', () => {
  const content = 'a'.repeat(64)
  const bib = 'b'.repeat(64)
  const email = 'e'.repeat(64)

  // ── The byte-identity guard. These assert against LITERAL canonical forms rather than against
  // the function's own output, so a change to the function cannot quietly redefine "unchanged".
  it('v:1 (no bib, no email) is byte-identical to the pre-email form', async () => {
    expect(await bundleHash(content, [])).toBe(await hashCanonical({ v: 1, contentHash: content, receipts: [] }))
  })

  it('v:2 (bib, no email) is byte-identical to the pre-email form', async () => {
    expect(await bundleHash(content, [], bib))
      .toBe(await hashCanonical({ v: 2, contentHash: content, bibHash: bib, receipts: [] }))
  })

  it('passing emailHash: undefined is exactly the v:1 path (the default-arg trap)', async () => {
    expect(await bundleHash(content, [], undefined, undefined)).toBe(await bundleHash(content, []))
  })

  it('v:3 commits to content AND headers', async () => {
    expect(await bundleHash(content, [], undefined, email))
      .toBe(await hashCanonical({ v: 3, contentHash: content, bibHash: null, emailHash: email, receipts: [] }))
  })

  it('v:3 carries bibHash when an email also cites', async () => {
    expect(await bundleHash(content, [], bib, email))
      .toBe(await hashCanonical({ v: 3, contentHash: content, bibHash: bib, emailHash: email, receipts: [] }))
  })

  // ── The binding negatives at the BUNDLE level — this is what OTS actually anchors.
  it('an email bundle differs from the same content with no headers', async () => {
    expect(await bundleHash(content, [], undefined, email)).not.toBe(await bundleHash(content, []))
  })

  it('changing ONLY the headers changes the anchored bundleHash', async () => {
    const a = await bundleHash(content, [], undefined, await emailHeadersHash({ to: ['a@x.com'], subject: 's' }))
    const b = await bundleHash(content, [], undefined, await emailHeadersHash({ to: ['b@x.com'], subject: 's' }))
    expect(a).not.toBe(b)
  })

  it('changing ONLY the body changes the anchored bundleHash', async () => {
    const e = await emailHeadersHash({ to: ['a@x.com'], subject: 's' })
    expect(await bundleHash(content, [], undefined, e)).not.toBe(await bundleHash('c'.repeat(64), [], undefined, e))
  })

  it('the v:3 tag makes an email bundle distinguishable from a bib bundle of the same digest', async () => {
    // Without the version tag, {contentHash, X, receipts} could be read as either. Prove they differ.
    expect(await bundleHash(content, [], email)).not.toBe(await bundleHash(content, [], undefined, email))
  })
})
