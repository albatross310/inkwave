// The music module ships LIVE — the toolbar's ♪ slot and the bar it opens are always available
// (graduated 2026-07-18; the last flag came off 2026-09-18). Nothing is gated here any more.
// Load performance is unaffected: the module's chunks are dynamic and only fetched when a writer
// opens the ♪ bar and clicks a button (`music/chunk.test.ts` asserts it).
//
// What is left is the DEMO data switch, which is not a gate — see flags/demoParam.ts.
import { demoParam } from '../flags/demoParam'

/** `?music=demo` — render a synthetic, clearly-labelled piece. Never silent, never a real score. */
export function musicDemo(): boolean { return demoParam('music', 'inkwave:musicDemo', '__iwMusicDemo') }
