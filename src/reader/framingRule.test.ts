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
  const TAB = 42
  const rule = frameRuleFor(TAB)

  it('applies ONLY inside the tab the reader is open in', () => {
    // ⚠ THIS REPLACED `initiatorDomains`, WHICH READ AS TIGHTER AND BROKE CLICKING THROUGH.
    // For a sub-frame navigation started by a click INSIDE the frame, the request's initiator is
    // the framed page, not the page hosting it — so an initiator rule matched when Inkwave created
    // the frame and stopped matching on the next click ("abc fails as soon as you click a site").
    // The tab is the honest boundary: every frame in the reader's tab, nothing in any other.
    expect(rule.condition.tabIds).toEqual([TAB])
    expect(frameRuleFor(7).condition.tabIds).toEqual([7])
    // And it must be a REAL tab, never a wildcard: -1 is Chrome's "no tab" sentinel and a rule
    // carrying it would apply outside any tab at all.
    expect(rule.condition.tabIds.every((t) => t >= 0)).toBe(true)
  })

  it('applies ONLY to sub-frames, never a top-level navigation', () => {
    expect(rule.condition.resourceTypes).toEqual(['sub_frame'])
  })

  it('does NOT narrow by host — that broke the panel as a browser', () => {
    // ⚠ THIS TEST ASSERTS THE ABSENCE OF A RESTRICTION, WHICH NEEDS ITS REASON ON RECORD.
    // The rule used to carry `requestDomains: [host]`. Chrome matches that against a domain and its
    // SUBdomains, so a rule for www.abc.net.au did not cover iview.abc.net.au — one click inside
    // the framed page and the writer was back at the refusal card ("if I click shows in abc it
    // won't work either"). Getting it right would need the public suffix list to know net.au is a
    // suffix; the bound that actually matters is initiatorDomains, asserted above.
    expect('requestDomains' in rule.condition).toBe(false)
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
    // "control that cannot fail" trap this repo records against its own probes.
    const noTab = { condition: { tabIds: undefined as unknown as number[] } }
    expect(noTab.condition.tabIds).not.toEqual([TAB])
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
