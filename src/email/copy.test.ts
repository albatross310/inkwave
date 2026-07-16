import { describe, it, expect } from 'vitest'
import * as copy from './copy'

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

const NEGATOR = /\b(not|never|n't|cannot|no)\b/i

/**
 * Drop clauses that DENY something. An affirmative-claim matcher must only see affirmative text, or
 * it reads a disclaimer as the claim it disclaims. Clauses split on sentence/list punctuation and
 * em-dashes, which is where English hangs its "…, not …" contrasts.
 */
function affirmativeOnly(text: string): string {
  return text
    .split(/[.;:,]|\s—\s/)
    .filter((clause) => !NEGATOR.test(clause))
    .join('. ')
}

type Scope = 'affirmative' | 'literal'

interface Matcher { name: string; re: RegExp; scope: Scope; knownBad: string }

const FORBIDDEN: Matcher[] = [
  // ── Claims the MVP crypto cannot support. OTS timestamps a hash; it cannot witness an SMTP
  // transaction. Only DKIM (Phase 3, NOT in this build) could speak to origin or sending.
  {
    name: 'proof of sending',
    scope: 'affirmative',
    re: /\bprov(e|es|en|ing|able)?\b[^.]{0,40}\bsent\b|\bproof (of|that)[^.]{0,20}\bsen[dt]\b/i,
    knownBad: 'Cryptographic proof that you sent this email.',
  },
  {
    name: 'proof of delivery',
    scope: 'affirmative',
    re: /\bprov(e|es|en|ing|able)?\b[^.]{0,40}\b(deliver(ed|y)|arrived|received)\b|\bproof of deliver/i,
    knownBad: 'A permanent proof of delivery, anchored to Bitcoin.',
  },
  {
    name: 'proof of origin',
    scope: 'affirmative',
    re: /\bprov(e|es|en|ing|able)?\b[^.]{0,40}\b(it came from you|who sent|origin)\b/i,
    knownBad: 'This proves the origin of the message.',
  },
  {
    name: 'end-to-end encryption',
    scope: 'affirmative',
    re: /\bend[- ]to[- ]end\b|\be2ee?\b|\bfully encrypted\b/i,
    knownBad: 'Your email is end-to-end encrypted.',
  },
  {
    name: 'tamper-proof / unforgeable absolutes',
    scope: 'affirmative',
    re: /\btamper[- ]proof\b|\bunforgeable\b|\bimpossible to (fake|forge)\b/i,
    knownBad: 'A tamper-proof record of your correspondence.',
  },
  {
    // VERIFIED IN THE CODE 2026-07-17: storage/opfs.ts writes JSON.stringify(data) in PLAINTEXT,
    // there is no crypto.subtle.encrypt/AES-GCM in src, and no crypto library in package.json. Spec
    // §C2's at-rest encryption is design intent, not this build. So ANY at-rest encryption claim is
    // an overclaim on the exact axis §C1.4 calls existential — including the innocent-looking
    // "stored encrypted on your device", which this file shipped until the code was checked.
    name: 'at-rest encryption (NOT implemented in this build)',
    scope: 'affirmative',
    re: /\b(stored|store|storage|saved|kept|held|encrypted)\b[^.]{0,30}\bencrypt/i,
    knownBad: 'Your draft is stored encrypted on your device.',
  },
  // ── A forbidden claim that is ITSELF phrased as a negation, so it must be matched literally:
  // stripping negated clauses would hide it. §C2: encryption is recoverable by default, so "we
  // cannot read it" is a zero-knowledge claim this build does not get to make.
  {
    name: 'we-cannot-read-it (a zero-knowledge claim this build does not make)',
    scope: 'literal',
    re: /\bwe (can(no|')t|cannot|are unable to) read\b/i,
    knownBad: 'We cannot read your drafts.',
  },
]

/** The one function both the known-bads and the real copy are judged by. */
function violates(m: Matcher, text: string): boolean {
  return m.re.test(m.scope === 'affirmative' ? affirmativeOnly(text) : text)
}

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

describe('the real in-product copy makes no forbidden claim', () => {
  for (const m of FORBIDDEN) {
    it(`makes no claim of: ${m.name}`, () => {
      for (const [key, text] of ALL_COPY) {
        expect(violates(m, text), `${key} claims ${m.name}: "${text}"`).toBe(false)
      }
    })
  }
})

describe('the copy makes the claims §B2.2 REQUIRES it to make', () => {
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
