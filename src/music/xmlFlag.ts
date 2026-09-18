// The MusicXML import path ships LIVE alongside the rest of the music module (2026-09-18) — it is
// no longer gated. What is left is the DEMO data switch, which is not a gate — see
// flags/demoParam.ts.
import { demoParam } from '../flags/demoParam'

/** `?musicXml=demo` — the labelled synthetic score. Never a real score, never silent. */
export function musicXmlDemo(): boolean { return demoParam('musicXml', 'inkwave:musicXmlDemo', '__iwMusicXmlDemo') }
