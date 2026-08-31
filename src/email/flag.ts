// The email layer's feature flag — DEFAULT OFF (P1b ships dark; send is blocked on Google
// verification, so the flag has not earned graduation).
//
//   ?email / ?email=1   enable (sticky)
//   ?email=off          disable + clear
//
// UNSET ⇒ OFF. SSR/prerender has no localStorage/location → false.
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
  defaultOn: false,
  onParam: 'present',
  cache: false,
})

export function emailEnabled(): boolean { return flag.enabled() }
