// The email layer's compatibility flag — DEFAULT ON. A Safari installed web app has its own fresh
// storage partition, so the former default-OFF rule made every email surface and creation action
// disappear there even after the writer had enabled email in the browser. The compose/mailbox layer
// is now real and tested; Google-dependent controls already gate themselves on configuration and
// consent, so public availability no longer depends on Google verification.
//
//   ?email / ?email=1   enable (sticky)
//   ?email=off          explicitly disable (sticky)
//
// UNSET ⇒ ON in a browser/PWA. SSR/prerender remains false so static HTML does not bake client-only
// editor controls into the document shell.
//
// Enables on PRESENCE, so `?email=yes` is on too — matching `?auth` and `?lesson`, and differing
// from `?music`/`?musicXml`/`?prod*`, which want an exact '1'. Persisting is what makes it survive
// a URL rewrite; the shared core owns that and the round-8 lesson behind it.
//
// `cache: false` — it re-reads storage on every call, which is what the shipped module did and
// what lets a mid-session change be seen. Nothing depends on it here the way `?auth` and
// `?liveFrame` depend on it, but it is behaviour, so it is preserved rather than quietly tightened.
import { stickyFlag } from '../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:email',
  param: 'email',
  defaultOn: true,
  onParam: 'present',
  onNoWindow: false,
  cache: false,
})

export function emailEnabled(): boolean { return flag.enabled() }
