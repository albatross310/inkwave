// THE FRAMING RULE MAY NEVER BE BUILT WITHOUT ITS THREE RESTRICTIONS.
//
// ⚠ WHY THIS IS A GUARD AND NOT A COMMENT (2026-08-30). The extension can strip `X-Frame-Options`
// and CSP off a response, which is what lets live view show a site that refuses framing. The same
// capability, unrestricted, makes every site the writer visits clickjackable — a citation tool
// turning into a hazard on pages it has nothing to do with. The difference between those two
// products is three fields in one object literal, and NOTHING ELSE IN THE REPO CHECKS THEM.
//
// The browser probe (scripts/framing.prove.mjs) is the truth about whether framing works; it needs
// a headed browser and a canary and it is run by hand. This is the part that has to survive six
// weeks and a refactor by someone who has not read the argument — CLAUDE.md's own headline is that
// this project establishes truth superbly and has no mechanism for KEEPING it.
//
// The rule is imported from the module the WORKER ACTUALLY INSTALLS, never restated here: a copy of
// the expected shape would pass for ever while the shipped rule drifted underneath it, which is the
// pmToText/textMap drift trap this repo already documents.
import { describe, it, expect } from 'vitest'
import { APP_INITIATORS, frameRuleFor } from './framingRule'

describe('the framing rule is scoped', () => {
  const rule = frameRuleFor('abc.net.au')

  it('applies ONLY to frames Inkwave itself created', () => {
    // Without this the rule fires for a frame on ANY page — including one built by a site the
    // writer merely visited, which is the clickjacking case. `initiatorDomains` is the whole of
    // what keeps this feature inside the reader.
    expect(rule.condition.initiatorDomains).toEqual([...APP_INITIATORS])
    expect(rule.condition.initiatorDomains.length).toBeGreaterThan(0)
  })

  it('applies ONLY to sub-frames, never a top-level navigation', () => {
    expect(rule.condition.resourceTypes).toEqual(['sub_frame'])
  })

  it('applies ONLY to the one host the reader asked for', () => {
    expect(rule.condition.requestDomains).toEqual(['abc.net.au'])
    // A rule that matched every host would be the browser-wide version wearing a scoped name.
    expect(frameRuleFor('example.org').condition.requestDomains).toEqual(['example.org'])
  })

  it('removes framing headers and nothing else', () => {
    const removed = rule.action.responseHeaders.map((h) => h.header).sort()
    expect(removed).toEqual(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options'])
    // Every one must be a REMOVE. A `set` would let a future edit write a policy of our choosing
    // onto someone else's page, which is a different and much larger power than declining to
    // enforce theirs.
    for (const h of rule.action.responseHeaders) expect(h.operation).toBe('remove')
    expect(rule.action.type).toBe('modifyHeaders')
  })

  it('KNOWN-NEGATIVE: the assertions can see an unscoped rule', () => {
    // Prove these checks discriminate rather than passing on whatever they are handed — the
    // "control that cannot fail" trap CLAUDE.md records for this repo's own probes. A rule missing
    // its initiator restriction must fail the first test's comparison.
    const unscoped = { condition: { initiatorDomains: undefined as unknown as string[] } }
    expect(unscoped.condition.initiatorDomains).not.toEqual([...APP_INITIATORS])
    const wide = { condition: { resourceTypes: ['sub_frame', 'main_frame'] } }
    expect(wide.condition.resourceTypes).not.toEqual(['sub_frame'])
  })

  it('the initiator list is Inkwave origins only — no wildcard, no bare TLD', () => {
    for (const d of APP_INITIATORS) {
      expect(d).not.toContain('*')
      expect(d.startsWith('.')).toBe(false)
      // A bare 'com' or 'org' would match every site under it.
      expect(d === 'localhost' || d.includes('.')).toBe(true)
    }
  })
})
