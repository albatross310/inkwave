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
// `?liveFrame=off` (or `=0`) turns it off and is sticky; `?liveFrame=1` clears that.
//
// ─── THE THREE SPEC FIELDS THAT ARE NOT DEFAULTS, AND WHY ────────────────────────────────────
// • `onNoWindow: false` against `onFault: true` — the two environment failures answer OPPOSITELY,
//   deliberately. Prerender must not bake live framing into static HTML; a writer in a private
//   window must get the feature rather than a silent downgrade they cannot see.
// • `cache: false` — SourceBrowser re-reads this per effect precisely because "the extension can
//   be granted mid-session, and liveFrameEnabled() can be flipped". A resolve-once cache would
//   freeze the answer at whatever the first read saw.
// • `onWrite: 'clear'` — `?liveFrame=1` removes the key rather than writing '1'. Under an
//   absent-means-on reader both read ON, so only storage inspection tells them apart; it is kept
//   because it is what already shipped, not because it matters to the answer.
import { stickyFlag } from '../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:liveFrame',
  param: 'liveFrame',
  defaultOn: true,
  offValues: ['off', '0'],
  onWrite: 'clear',
  onFault: true,
  onNoWindow: false,
  cache: false,
})

export function liveFrameEnabled(): boolean {
  return flag.enabled()
}
