// §B5 — "MusicXML source + annotations + the written analysis are hashed and OTS-anchored, same as
// everything else."
//
// THE THING THAT MUST NOT BREAK: every document anchored BEFORE this feature existed must still
// hash byte-identically. A bundleHash is committed to Bitcoin; if v:1/v:2/v:3 shift by one byte,
// every existing proof stops verifying and the anchors are worthless. So the compatibility tests
// assert against LITERAL canonical strings computed by hand — never against `bundleHash`'s own
// output, which would pass no matter how the function changed (it would simply agree with itself).

import { describe, expect, it } from 'vitest'
import { bundleHash, musicAttachmentsHash, sha256Hex } from './hash'

const C = 'a'.repeat(64)
const M = { masters: [{ id: 'mx_1', contentHash: 'deadbeef' }], excerpts: [], annotations: [] }

describe('bundleHash — legacy forms are BYTE-IDENTICAL (the anchors must not move)', () => {
  it('v:1 — no citations, no email, no music', async () => {
    // Computed by hand from the documented shape, NOT from bundleHash. This is the assertion that
    // can actually catch the feature moving a legacy hash.
    const literal = await sha256Hex(`{"contentHash":"${C}","receipts":[],"v":1}`)
    expect(await bundleHash(C, [])).toBe(literal)
  })

  it('v:2 — a citing document', async () => {
    const literal = await sha256Hex(`{"bibHash":"bib1","contentHash":"${C}","receipts":[],"v":2}`)
    expect(await bundleHash(C, [], 'bib1')).toBe(literal)
  })

  it('v:3 — an email document', async () => {
    const literal = await sha256Hex(
      `{"bibHash":null,"contentHash":"${C}","emailHash":"em1","receipts":[],"v":3}`)
    expect(await bundleHash(C, [], undefined, 'em1')).toBe(literal)
  })

  it('adding music to the SIGNATURE changes nothing for a document without music', async () => {
    // The regression this whole block guards: a 5th parameter that silently altered the v:1 form.
    expect(await bundleHash(C, [], undefined, undefined, undefined)).toBe(await bundleHash(C, []))
  })
})

describe('bundleHash — v:4 (a document carrying a score)', () => {
  it('takes the v:4 form, with bibHash and emailHash carried explicitly as null', async () => {
    // ONE shape regardless — a music essay usually cites, so v:4 must not fork on whether it does.
    const literal = await sha256Hex(
      `{"bibHash":null,"contentHash":"${C}","emailHash":null,"musicHash":"mus1","receipts":[],"v":4}`)
    expect(await bundleHash(C, [], undefined, undefined, 'mus1')).toBe(literal)
  })

  it('keeps ONE shape when the music essay also cites', async () => {
    const literal = await sha256Hex(
      `{"bibHash":"bib1","contentHash":"${C}","emailHash":null,"musicHash":"mus1","receipts":[],"v":4}`)
    expect(await bundleHash(C, [], 'bib1', undefined, 'mus1')).toBe(literal)
  })

  it('music WINS over email — a document with both is v:4, not v:3', async () => {
    // Otherwise the musicHash would be silently dropped from the anchored hash and §B5's claim
    // would evaporate on exactly the documents that carry both.
    const h = await bundleHash(C, [], undefined, 'em1', 'mus1')
    expect(h).toBe(await sha256Hex(
      `{"bibHash":null,"contentHash":"${C}","emailHash":"em1","musicHash":"mus1","receipts":[],"v":4}`))
    expect(h).not.toBe(await bundleHash(C, [], undefined, 'em1'))
  })

  it('CHANGES when the music changes — the anchor actually binds the score', async () => {
    const base = await bundleHash(C, [], undefined, undefined, 'mus1')
    expect(await bundleHash(C, [], undefined, undefined, 'mus2')).not.toBe(base)
  })
})

describe('musicAttachmentsHash', () => {
  it('is deterministic', async () => {
    expect(await musicAttachmentsHash(M)).toBe(await musicAttachmentsHash(M))
  })

  it('CHANGES when a master’s notation changes — this is the §B5 claim', async () => {
    // Correct the score under an anchored analysis and the bundle must stop verifying. If this ever
    // passes, "the MusicXML source is hashed and anchored" is not true.
    const base = await musicAttachmentsHash(M)
    const swapped = { ...M, masters: [{ id: 'mx_1', contentHash: 'cafebabe' }] }
    expect(await musicAttachmentsHash(swapped)).not.toBe(base)
  })

  it('CHANGES when a master is added or removed', async () => {
    const base = await musicAttachmentsHash(M)
    expect(await musicAttachmentsHash({ ...M, masters: [] })).not.toBe(base)
    expect(await musicAttachmentsHash({
      ...M, masters: [...M.masters, { id: 'mx_2', contentHash: 'feed' }],
    })).not.toBe(base)
  })

  it('CHANGES when an excerpt’s bar range changes (§B6)', async () => {
    // "bars 12-16" is the claim the essay makes; it has to be part of what is anchored.
    const a = await musicAttachmentsHash({ ...M, excerpts: [{ id: 'tx_1', masterId: 'mx_1', barStart: '12', barEnd: '16', partIndex: 0 }] })
    const b = await musicAttachmentsHash({ ...M, excerpts: [{ id: 'tx_1', masterId: 'mx_1', barStart: '12', barEnd: '17', partIndex: 0 }] })
    expect(a).not.toBe(b)
  })

  it('IGNORES display metadata — a title is not evidence', async () => {
    // A corpus renaming a piece, or a title typo being fixed, must not look like tampering with the
    // notation. What is anchored is the id + the contentHash.
    const withTitle = { ...M, masters: [{ id: 'mx_1', contentHash: 'deadbeef', title: 'Nocturne', composer: 'Chopin' }] }
    expect(await musicAttachmentsHash(withTitle)).toBe(await musicAttachmentsHash(M))
  })

  it('treats an absent annotations array exactly as an empty one', async () => {
    const { annotations, ...without } = M
    void annotations
    expect(await musicAttachmentsHash(without)).toBe(await musicAttachmentsHash(M))
  })

  it('is FIXED at the v:1 shape, so §B4 can land without a protocol change', async () => {
    // The receipts precedent (`[]` until M3 wired the signing service): the field is hashed NOW, so
    // populating it later needs no new bundle version — and an empty array canonicalises to `[]`
    // whatever §B4 decides its element type is, so the contested anchor shape cannot move any hash
    // computed today.
    const literal = await sha256Hex(
      '{"annotations":[],"excerpts":[],"masters":[{"contentHash":"deadbeef","id":"mx_1"}],"v":1}')
    expect(await musicAttachmentsHash(M)).toBe(literal)
  })

  it('CHANGES once an annotation exists (the field is really in the hash)', async () => {
    // Without this, "annotations are hashed" would be an untested claim about an always-empty array.
    const base = await musicAttachmentsHash(M)
    expect(await musicAttachmentsHash({
      ...M, annotations: [{ id: 'an_1', createdAt: '2026-07-17T00:00:00Z', text: 'watch the dynamics' }],
    })).not.toBe(base)
  })
})
