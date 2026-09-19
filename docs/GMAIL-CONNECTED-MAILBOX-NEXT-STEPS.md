# Gmail connected-mailbox next steps

Productivity + Email build spec v0.2, §§B3.1–B3.5. The send-only `gmail.send` path remains a
separate minimum-permission feature throughout.

## Implemented in `feat/gmail-send`

- [x] Show Inkwave's explicit capability/limits dialog before Google receives any restricted-scope
  request.
- [x] Request exactly `gmail.readonly` + `gmail.compose`; never request `gmail.modify` or the full
  mail scope. Keep the short-lived token in memory and independent from send-only authorization.
- [x] Provide real Primary Inbox, Promotions, Spam, Drafts and Sent views with explicit loading,
  offline, permission and failed states. Classification comes from Gmail's native category/system
  labels; Inkwave does not inspect bodies or invent a spam score.
- [x] Fetch lightweight thread/draft metadata for lists and full content only for the item the
  writer opens.
- [x] Render plain text only. Keep HTML and remote images inert. Show attachment metadata without
  fetching bytes; a deliberate Open action fetches and size-validates that attachment only, opens
  signature-checked PDF/image/text in the browser, and downloads native formats for the OS.
- [x] Make browsing inert. Only “Edit in Inkwave” creates an ordinary local email document and
  local-only Gmail draft binding.
- [x] Create/update Gmail drafts only after local persistence succeeds. Compare hashes against the
  last acknowledged ancestor; never overwrite independently changed remote content.
- [x] Reserve “Last synced” for a Gmail-acknowledged revision. Local autosave continues to say
  “Saved locally”.
- [x] Poll a lightweight Gmail history high-water marker once per minute only while the mailbox is
  visible/online, rebuilding on change or expiry rather than polling full bodies.
- [x] Disconnect by clearing token and in-memory mailbox state without deleting Gmail or Inkwave
  content.

## Remaining before public launch

1. Exercise the complete flow with the separate staging OAuth client and owner/test Gmail accounts:
   connect, Primary/Promotions/Spam/Sent open, Draft import, create, update, conflict, offline,
   revoked permission and disconnect.
2. Add connected `drafts.send` only with a persistent unknown-result reconciliation state. A lost
   response must check whether the stable draft still exists before any retry; an absent draft stays
   “possibly sent” until Sent confirms it.
3. Add a sanitised, isolated HTML renderer. Remote images stay off by default. Plain text remains
   the fallback; the explicit attachment fetch/validation action is already implemented.
4. Add a small local metadata index only if measured reopening latency justifies it. Hash account
   identity and retain no bodies or attachment bytes; the current build intentionally keeps indexes
   in memory.
5. Prepare Google's restricted-scope verification package: public privacy policy, exact scope
   justifications, demo video, disconnect/deletion demonstration, architecture showing browser ↔
   Google direct transport, and the required security-assessment decision.
6. Keep public mailbox UI gated until verification is approved. Direct `gmail.send`, provider
   handoff, local writing and local provenance must remain usable independently.

## Outlook-like mail client track

The first consent remains deliberately narrow; these are later, explicit capability steps rather
than reasons to over-scope the initial connection.

1. Request `gmail.modify` in a separate organiser consent to support read/unread, archive, star,
   labels and move-to-Trash, with undo and typed partial-failure states.
2. Add search, folders/labels, conversation actions, reply/forward and attachment composition on the
   provider-neutral mailbox contract before adding another provider.
3. Add Microsoft Graph/Outlook behind the same contract and capability-led consent UI.
4. Treat permanent deletion/empty-Trash as a final high-risk feature. Gmail requires its broad
   full-mail permission for permanent deletion; keep that permission separate, explain it at the
   point of use, and require a destructive confirmation.
