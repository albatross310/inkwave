// §C1.4 — the forbidden-claim matchers. ONE definition, for the WHOLE product.
//
// These began life inside `email/copy.test.ts`, which is the best-engineered guard in the repo:
// every matcher is proved to FIRE on known-bad copy through the same pipeline the real copy takes,
// and proved NOT to fire on an honest control first. That discipline is unchanged — it just could
// not see past one file. `ALL_COPY = Object.entries(copy)` is scoped to `src/email/copy.ts`, while
// the describe block read "the real in-product copy makes no forbidden claim". §C1.4 is a PRODUCT
// rule, not an email rule: nothing stopped another lane shipping "encrypted" copy with that suite
// green — and the music lanes are being built right now against a spec whose §0 asserts encryption
// at rest, which this build does not have.
//
// So the matchers live here, exported, and are consumed by BOTH the email suite (unchanged
// semantics) and the repo-wide sweep (`copy/claims.test.ts`). Extracted rather than copied: a
// second copy of these regexes is exactly how two guards drift and one starts certifying a fiction
// — the same reason `citationText` is exported from bundle.ts rather than duplicated.
//
// PROPHYLACTIC, NOT A LIVE LEAK: the sweep finds 0 violations today. It is here so the NEXT lane
// cannot introduce one quietly.

const NEGATOR = /\b(not|never|n't|cannot|no)\b/i

/**
 * Drop clauses that DENY something. An affirmative-claim matcher must only see affirmative text, or
 * it reads a disclaimer as the claim it disclaims. Clauses split on sentence/list punctuation,
 * em-dashes, AND coordinating conjunctions — which is where English hangs its contrasts.
 *
 * This earned its keep immediately: the naive matchers flagged "It does not prove that you sent the
 * email" — they could not tell an assertion from its denial.
 *
 * ─── THE CONJUNCTION SPLIT (added 2026-07-17, and it closed a real hole) ────────────────────────
 * The original split was punctuation-only, so a negator ANYWHERE in an unpunctuated clause deleted
 * the whole clause — including any affirmative overclaim sharing it. MEASURED:
 *
 *   "Every note is tamper-proof."                       → caught
 *   "Every note is tamper-proof, and we cannot read it." → caught (the comma split it)
 *   "Every note is tamper-proof and we cannot read it."  → MISSED — stripped to "" and passed
 *
 * One absent comma hid a forbidden claim: a matcher that cannot catch the thing it names. Splitting
 * on and/but/though/although/while/yet fixes it, and the fix is proved BOTH ways in claims.test.ts —
 * every knownBad still fires, and the honest control still fires nothing.
 *
 * THE TRADE-OFF, STATED: a finer split exposes more short clauses standalone (the honest control now
 * yields "that it arrived" and "or who it came from" as their own clauses). That is safe ONLY
 * because every affirmative matcher is CONJUNCTIVE — each needs its "prov…" stem in the SAME clause
 * as its object. A future matcher that keys on a bare object word (/arrived/) would false-positive
 * here and force the copy to be wrong to stay green. Keep new affirmative matchers conjunctive.
 */
export function affirmativeOnly(text: string): string {
  return text
    .split(/[.;:,]|\s—\s|\s\b(?:and|but|though|although|while|yet)\b\s/i)
    .filter((clause) => clause && !NEGATOR.test(clause))
    .join('. ')
}

export type Scope = 'affirmative' | 'literal'

export interface Matcher { name: string; re: RegExp; scope: Scope; knownBad: string }

export const FORBIDDEN: Matcher[] = [
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
    // "stored encrypted on your device", which the email copy shipped until the code was checked.
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
export function violates(m: Matcher, text: string): boolean {
  return m.re.test(m.scope === 'affirmative' ? affirmativeOnly(text) : text)
}
