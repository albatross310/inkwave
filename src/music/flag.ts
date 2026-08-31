// Music module feature flag — GRADUATED TO DEFAULT ON (2026-07-18).
//
// Peter, 2026-07-18: stop flagging finished features. Both halves of the module are now real — the
// toolbar's ♪ BAR LAYER opens MusicStudio / MusicPanel as a panel over the editor (the dead `/music`
// route is retired), the MusicXML import is reachable there, and the photo→Piece creation flow
// mints a real `docType:'music'` document from an imported photo — so the studio reaches a REAL
// score, not just the demo/harness. It ships live for every writer. `?music` remains only to turn it
// OFF or to force the demo:
//
//   (no param)   ON — the graduated default
//   ?music=1     on (explicit; also re-arms after a previous ?music=off)
//   ?music=demo  on + a synthetic, LABELLED demo piece (no real score — see fixtures.ts)
//   ?music=off   OFF — persisted as '0', sticky across loads (only an explicit '0' turns it off)
//
// A BARE `?music` is inert: this flag reads an exact value, unlike `?email`/`?lesson`/`?auth`,
// which enable on mere presence.
//
// STICKINESS IS THE POINT and it now comes from the shared core: a flag read fresh from the URL
// DIES the moment any local-first navigation rewrites it — which silently disabled snapThumbs
// exactly when it was being used. Resolve once, persist, then read from storage.
//
// LAZINESS SURVIVES GRADUATION: the heavy panels (OSMD, the detector) still sit behind
// `components/MusicBar.tsx`'s `lazy(() => import(...))`, itself behind the editor's own dynamic
// import, so the editor's static graph reaches ONLY this tiny flag leaf and the panels are fetched
// only when a writer opens the ♪ bar and clicks a button. `music/chunk.test.ts` asserts it. CLAUDE.md:
// load performance is sacred, flag on or off.
import { stickyFlag } from '../flags/stickyFlag'

// Every field here is a default except the demo companion and the two `__iw` overrides: default ON,
// an exact-value param, a sticky '0' opt-out, cached once per load, and a storage fault falling
// back to the graduated default (ON) — a private window gets the module, not a silent downgrade.
const flag = stickyFlag({
  key: 'inkwave:music',
  param: 'music',
  defaultOn: true,
  companionKey: 'inkwave:musicDemo',
  override: '__iwMusic',
  companionOverride: '__iwMusicDemo',
})

/** Whether the music module is available at all. Default ON (graduated 2026-07-18). */
export function musicEnabled(): boolean { return flag.enabled() }

/** `?music=demo` — render a synthetic, clearly-labelled piece. Never silent, never a real score. */
export function musicDemo(): boolean { return flag.demo() }

/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetMusicFlagForTest(): void { flag.reset() }

/**
 * Tests only: force the on-flag without a URL/localStorage/window (node env). Mirrors
 * ledgerFlag.setProdLedgerEnabled so the toolbar's music slot can be toggled the same way the
 * clock's is. Leaves `demo` as it was, and writes NO storage.
 */
export function setMusicEnabledForTest(on: boolean): void { flag.setCachedOnly(on) }
