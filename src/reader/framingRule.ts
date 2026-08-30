// THE ONE declarativeNetRequest RULE THE EXTENSION MAY INSTALL, DEFINED ONCE.
//
// Peter, 2026-08-30: "build the extension." Live view shows the page itself rather than its
// extracted text, and most of the web refuses to be framed — `X-Frame-Options` and CSP
// `frame-ancestors` are enforced by the BROWSER, so a web app can never opt out of another site's
// refusal. An extension can, by removing those response headers before the browser reads them.
//
// ⚠ IT LIVES IN src/ AND NOT IN THE WORKER, for the reason extensionProtocol.ts gives for the wire
// names — the extension imports from src/ and never the reverse — plus one that matters more here:
// the gate can then check the SHIPPED rule instead of a restatement of it. A test carrying its own
// copy of the expected shape passes for ever while the real rule drifts underneath, which is the
// pmToText/textMap drift trap this repo already keeps a guard against.
//
// ⚠ AND THE SCOPING IS THE WHOLE PRODUCT. Unrestricted, this same capability makes every site the
// writer visits clickjackable — a citation tool becoming a hazard on pages it has nothing to do
// with. The difference is three fields, so `framingRule.test.ts` asserts all three and carries a
// known-negative proving those assertions can see an unscoped rule.

/** The origins a framing rule may be initiated FROM — i.e. Inkwave itself. `localhost` covers
 *  `pnpm dev`; the production app answers on iwzero.me (inkwave.studio 301s there). */
export const APP_INITIATORS = ['iwzero.me', 'inkwave.studio', 'localhost'] as const

/** One fixed id, so installing a rule for a new page REPLACES the previous one rather than
 *  accumulating: the panel shows a single page at a time, and a second call means the writer
 *  navigated, not that they want both hosts left open. */
export const FRAME_RULE_ID = 9101

export interface FramingRule {
  id: number
  priority: number
  action: {
    type: 'modifyHeaders'
    responseHeaders: { header: string; operation: 'remove' }[]
  }
  condition: {
    tabIds: number[]
    resourceTypes: ['sub_frame']
  }
}

export function frameRuleFor(tabId: number): FramingRule {
  return {
    id: FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        // ⚠ THE WHOLE CSP, NOT JUST frame-ancestors — A REAL COST, TAKEN KNOWINGLY.
        // declarativeNetRequest can remove, set or append a header; it cannot EDIT one, and a rule
        // written in advance cannot know a site's own policy in order to re-set it minus a single
        // directive. So a framed page loses its other CSP protections too, for as long as it is
        // open in the panel. Scoped as below that is the writer's own page in the writer's own
        // reader — but it is a cost rather than a technicality, and it is why this is opt-in.
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'content-security-policy-report-only', operation: 'remove' },
      ],
    },
    condition: {
      // ⚠ SCOPED BY TAB, NOT BY INITIATOR — AND THE DIFFERENCE IS WHAT MAKES IT A BROWSER.
      // It was `initiatorDomains: APP_INITIATORS`, which sounds exactly right and silently breaks
      // the moment the writer clicks a link. Peter: "abc fails as soon as you click a site."
      // The reason: for a sub-frame navigation started by a click INSIDE the frame, the request's
      // initiator is the FRAMED PAGE (abc.net.au), not the page hosting the frame. So the rule
      // matched when Inkwave created the frame and stopped matching on the very next click.
      //
      // ⚠ AND MY PROBE COULD NOT SEE IT. It only ever created frames from the top page, where the
      // initiator IS Inkwave — so it passed by construction, which is this repo's oldest trap
      // wearing a new hat. The probe now clicks a link inside the frame.
      //
      // `tabIds` is available ONLY on session rules, which is what these are. It scopes the rule to
      // the one tab the reader is open in: every frame inside that tab, for as long as the panel is
      // open, and nothing in any other tab. That is a HONEST statement of the reach — slightly
      // wider than "the page we asked for" (a framed page's own sub-frames are included), and
      // narrower in the way that matters, since a second tab on the same site is untouched.
      tabIds: [tabId],
      // NEVER a top-level navigation — the writer's own tab is never rewritten.
      resourceTypes: ['sub_frame'],
    },
  }
}
