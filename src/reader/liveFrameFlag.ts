// LIVE FRAMING — DEFAULT OFF (2026-08-30), after a day of building it and an hour of it breaking.
//
// Peter: "literally nothings working. not even google" → "Try a bit more then revert."
//
// WHAT THIS TURNS OFF: the extension's header-stripping, which lets the reader show sites that
// refuse to be displayed inside another page. It does NOT touch page FETCHING from the writer's own
// connection (that path is older, independent, and works), nor reader mode, nor anything else.
//
// WHY OFF RATHER THAN DELETED. The mechanism is real and measured — `pnpm prove:framing` shows a
// live canary, a control that refuses, and REFUSED → framed for a page, a sibling subdomain and a
// click-through. What is NOT established is that it is an improvement in daily use: it went in and
// out of working for an hour while Peter was trying to read, I shipped four corrections in that
// time, and two of them broke something that had been fine. Shipping churn to someone mid-thesis is
// worse than shipping less.
//
// AND THE HONEST LIMIT, MEASURED, which is why the feature is smaller than it looked: stripping the
// headers makes a page FRAMEABLE, not usable. In one run with the rule live — abc.net.au rendered
// 14,662 chars and set cookies normally, while jstor.org served an 87-char "Client Challenge",
// youtube.com 159 chars, and google.com/search redirected itself to /sorry. Those are bot-detection
// and login-context failures, not header failures, and no rule we install can reach them. A framed
// page is also a third-party context, so `SameSite=Lax` — the default a cookie gets when it says
// nothing — is never sent: a site you are signed into renders signed out.
//
// TO TURN IT BACK ON: `?liveFrame=1` (sticky, the `?auth` pattern). `?liveFrame=off` clears it.
// Graduating it needs a day of ordinary use without a regression, not another probe.
const KEY = 'inkwave:liveFrame'

export function liveFrameEnabled(): boolean {
  if (typeof window === 'undefined') return false          // SSR/prerender: never
  try {
    const p = new URLSearchParams(window.location.search).get('liveFrame')
    if (p === '1') localStorage.setItem(KEY, '1')
    else if (p === 'off' || p === '0') localStorage.removeItem(KEY)
    return localStorage.getItem(KEY) === '1'
  } catch { return false }                                  // private mode → the safe answer
}
