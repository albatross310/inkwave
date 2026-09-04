import { describe, it, expect } from 'vitest'
import * as copy from './copy'
import { FORBIDDEN, affirmativeOnly, violates } from '../copy/claimMatchers'

// §B6 makes the in-product wording an ACCEPTANCE CRITERION: it must state what the provenance
// proves and must not claim proof of sending. §C1.4: "Overclaiming on a trust brand is existential."
//
// THE TRAP THIS FILE IS BUILT AROUND: "assert the bad phrase is absent" is a check that passes
// trivially — it passes on correct copy, on empty copy, and on a typo'd matcher that can never match
// anything. That is the house disease (CLAUDE.md: a self-check that measures in a fiction does not
// fail loudly, it silently disables the thing it guards). So every matcher is proved to fire on
// known-bad copy THROUGH THE SAME PIPELINE the real copy goes through, and proved NOT to fire on an
// honest control, before any verdict on the real strings is read.
//
// The control caught a real bug on first run: a naive /prove.{0,40}sent/ matcher cannot tell an
// assertion from its DENIAL, so it flagged "It does not prove that you sent the email" — the very
// sentence §B2.2 requires. Hence the two matcher classes below.

// ─── The pipeline ────────────────────────────────────────────────────────────
// MOVED 2026-07-17 to `src/copy/claimMatchers.ts`, byte-for-byte, and imported here. §C1.4 is a
// PRODUCT rule, but ALL_COPY below can only ever see this ONE file — so the same matchers now also
// drive a repo-wide sweep (`copy/claims.test.ts`). Extracted, never copied: two copies of these
// regexes is how one guard silently stops matching what the other catches.
// Everything below is unchanged; this suite remains the EMAIL lane's verdict.

const ALL_COPY: [string, string][] = Object.entries(copy).filter(
  ([, v]) => typeof v === 'string',
) as [string, string][]

// ─── Prove the instrument before reading it ──────────────────────────────────

describe('the forbidden-claim matchers actually fire (prove the negative FIRST)', () => {
  for (const m of FORBIDDEN) {
    it(`catches known-bad copy for: ${m.name}`, () => {
      // Through the SAME pipeline as the real copy — a negative proved on a different code path
      // proves nothing about the path that matters.
      expect(violates(m, m.knownBad)).toBe(true)
    })
  }

  it('does NOT fire on the honest control sentence (the known-positive)', () => {
    // Correct copy must pass every matcher, or the matchers are noise that would force the copy to
    // be WRONG to stay green. This control is what caught the assertion-vs-denial bug.
    const honest =
      'This records that this exact content existed by this time. It does not prove that you sent ' +
      'the email, that it arrived, or who it came from. Stored on your device and we never hold it; ' +
      'this is not end-to-end encrypted mail.'
    for (const m of FORBIDDEN) {
      expect(violates(m, honest), `${m.name} false-positived on honest copy`).toBe(false)
    }
  })

  it('the negation-stripper does not simply delete everything', () => {
    // If affirmativeOnly() returned '' the affirmative matchers would pass vacuously forever.
    expect(affirmativeOnly('Cryptographic proof that you sent this email.').trim().length)
      .toBeGreaterThan(10)
    expect(affirmativeOnly('It does not prove that you sent the email.')).not.toMatch(/does not prove/)
  })

  it('there is copy to check at all (a matcher over an empty set proves nothing)', () => {
    expect(ALL_COPY.length).toBeGreaterThanOrEqual(7)
    for (const [k, v] of ALL_COPY) expect(v.length, `${k} is empty`).toBeGreaterThan(10)
  })
})

// ─── The verdict on the real strings ─────────────────────────────────────────

describe('the EMAIL lane\'s in-product copy (src/email/copy.ts) makes no forbidden claim', () => {
  for (const m of FORBIDDEN) {
    it(`makes no claim of: ${m.name}`, () => {
      for (const [key, text] of ALL_COPY) {
        expect(violates(m, text), `${key} claims ${m.name}: "${text}"`).toBe(false)
      }
    })
  }
})

describe('the copy makes the claims §B2.2 REQUIRES it to make', () => {
  it('names the explicit provenance action as a snapshot, not ordinary draft saving', () => {
    expect(copy.FINALISE_LABEL).toBe('Snapshot this draft')
  })

  it('the always-visible brief states the claim and its limit in one line', () => {
    expect(copy.PROVENANCE_BRIEF).toMatch(/existed by/i)
    expect(copy.PROVENANCE_BRIEF).toMatch(/not that it was sent, delivered, or read/i)
  })

  it('the explainer states the actual claim — content existed by a time, verifiable independently', () => {
    expect(copy.PROVENANCE_EXPLAINER).toMatch(/existed by/i)
    expect(copy.PROVENANCE_EXPLAINER).toMatch(/verif/i)
  })

  it('the limit explicitly denies sending, arrival and origin', () => {
    expect(copy.PROVENANCE_LIMIT).toMatch(/does not prove/i)
    expect(copy.PROVENANCE_LIMIT).toMatch(/sent/i)
    expect(copy.PROVENANCE_LIMIT).toMatch(/arrived/i)
    expect(copy.PROVENANCE_LIMIT).toMatch(/came from/i)
  })

  it('the recorded state still denies sending in the past tense', () => {
    expect(copy.PROVENANCE_RECORDED).toMatch(/not that it was sent/i)
  })

  it('the recorded state does NOT claim a CONFIRMED Bitcoin anchor — it is pending for hours', () => {
    // The OTS proof is 'pending' at this moment (unstamped → pending → confirmed). Saying "is
    // anchored to Bitcoin" would be true only later. A provenance product that rounds "submitted"
    // up to "anchored" has already started lying.
    expect(copy.PROVENANCE_RECORDED).toMatch(/submitted|confirmation takes/i)
    expect(/is anchored to Bitcoin/i.test(copy.PROVENANCE_RECORDED)).toBe(false)
  })

  it('the storage claim says on-device + zero-retention, and disclaims E2E mail', () => {
    expect(copy.STORAGE_CLAIM).toMatch(/stored on your device/i)
    expect(copy.STORAGE_CLAIM).toMatch(/we never hold it/i)
    expect(copy.STORAGE_CLAIM).toMatch(/not end-to-end encrypted/i)
  })

  it('the storage claim does NOT claim at-rest encryption — this build has none', () => {
    // The guard for the bug this file actually had: §C2 promises at-rest encryption, the code does
    // not implement it, and the copy repeated the promise. Copy tracks the CODE, not the spec.
    expect(/stored encrypted|encrypted on your device/i.test(copy.STORAGE_CLAIM)).toBe(false)
  })

  it('the handoff copy scopes provenance to the Inkwave draft, not the sent bytes', () => {
    expect(copy.HANDOFF_EXPLAINER).toMatch(/outside the recorded draft/i)
  })

  it('the handoff copy states we never touch the inbox (§B5 minimal scope)', () => {
    expect(copy.HANDOFF_EXPLAINER).toMatch(/never connects to your inbox/i)
  })
})
