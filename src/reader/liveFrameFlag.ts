// LIVE FRAMING — DEFAULT ON.
//
// ⚠ THIS FLAG WENT OFF AND BACK ON WITHIN AN HOUR, AND THE REASON MATTERS MORE THAN THE VALUE.
// It was switched off after live view went in and out of working while Peter was reading. But the
// instability was FOUR BUGS I INTRODUCED WHILE PATCHING IT, not the mechanism:
//   1. a cleanup written for one lifetime ("while live view is on") attached to an effect with
//      another ("this page"), so every navigation raced a release against its own install;
//   2. `frameKey` bumped on every install, remounting an iframe mid-load — and mid-VIDEO;
//   3. an `isPlayable` skip that returned early AFTER the cleanup had already removed the rule,
//      so opening one video tore down framing for the whole tab;
//   4. the flag itself read in two places where only one was updated, so search routed to a live
//      page that framing had been switched off for.
// All four are fixed and each is pinned. Turning the feature off was treating the symptom.
//
// Peter: "I want live working on all websites like it used to." That is the feature working, and
// with framing OFF it cannot: every site that sends X-Frame-Options refuses, and — less obviously —
// a SEARCH is pinned to reader view by `mustUseReader`, so the ⌂/▤ toggle looks dead from the one
// page a writer starts on. Off was not a smaller version of the feature; it was a broken one.
//
// WHAT IT STILL DOES NOT FIX, measured with the rule live and not to be re-litigated: abc.net.au
// renders 14,662 chars and sets cookies normally, while jstor.org serves an 87-char "Client
// Challenge", youtube.com's HOME page 159 chars, and google.com/search redirects itself to /sorry.
// Those are bot-detection and login-context failures — a framed page is a third-party context, so
// `SameSite=Lax` (the default) is never sent and a site you are signed into renders signed out.
// No header we remove reaches any of that.
//
// `?liveFrame=off` turns it off and is sticky; `?liveFrame=1` clears that.
const KEY = 'inkwave:liveFrame'

export function liveFrameEnabled(): boolean {
  if (typeof window === 'undefined') return false          // SSR/prerender: never
  try {
    const p = new URLSearchParams(window.location.search).get('liveFrame')
    if (p === 'off' || p === '0') localStorage.setItem(KEY, '0')
    else if (p === '1') localStorage.removeItem(KEY)
    return localStorage.getItem(KEY) !== '0'                // absent means ON
  } catch { return true }                                   // storage refused → the feature, not a
                                                            // silent downgrade the writer cannot see
}
