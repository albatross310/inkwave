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
    initiatorDomains: string[]
    resourceTypes: ['sub_frame']
  }
}

export function frameRuleFor(_host?: string): FramingRule {
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
      // ⚠ NO `requestDomains`, AND THAT IS A CORRECTION, NOT AN OVERSIGHT (2026-08-30).
      // It was `[host]` — the one page the panel was asked to show — which sounded tighter and
      // broke the panel as a BROWSER. Peter: "if I click shows in abc it won't work either."
      // Chrome matches `requestDomains` against a domain and its SUBdomains, so a rule for
      // `www.abc.net.au` does not cover `iview.abc.net.au`: a sibling host, one click away, and
      // the writer is back at the refusal card. Deriving the registrable domain instead would need
      // the public suffix list to know that `net.au` is a suffix and `abc.net.au` is the site —
      // a table we would be carrying, and getting wrong, for no gain.
      //
      // What actually bounds this rule is the next line, and it always was. `initiatorDomains`
      // means the rule can only ever apply to a frame INKWAVE ITSELF created; the same site opened
      // in the writer's own tab is untouched, because there the initiator is that page. Add the
      // session lifetime (installed when the panel shows a live page, removed when it closes) and
      // `sub_frame`, and the reach is "pages inside Inkwave's own reader, while it is open" —
      // which is the feature, stated exactly.
      initiatorDomains: [...APP_INITIATORS],
      // NEVER a top-level navigation.
      resourceTypes: ['sub_frame'],
    },
  }
}
